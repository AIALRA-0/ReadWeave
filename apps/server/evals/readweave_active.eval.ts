import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as settings from "../src/services/readweave_settings.js";
import * as search from "../src/services/readweave_search.js";
import { generateReadWeaveActiveAnswer } from "../src/services/readweave_active_ai.js";
import { readWeaveModelRates } from "../src/services/readweave_budget.js";

const proxy = process.env.READWEAVE_ACTIVE_PROXY, reportPath = process.env.READWEAVE_ACTIVE_REPORT;
if (!proxy || !reportPath) throw new Error("An explicit private proxy and report path are required for this paid opt-in evaluation");
const reports: unknown[] = [];
const remoteFetch: typeof fetch = async (url, init = {}) => {
    const raw = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [proxy], { windowsHide:true, stdio:["pipe","pipe","pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", c => stdout += c);
        child.stderr.on("data", c => stderr += c);
        child.on("error", reject);
        child.on("exit", code => code === 0 ? resolve(stdout) : reject(new Error(`Private proxy failed (${code}): ${stderr}`)));
        const abort = () => { child.kill(); reject(init.signal?.reason ?? new Error("Cancelled")); };
        if (init.signal?.aborted) { abort(); return; }
        init.signal?.addEventListener("abort", abort, {once:true});
        child.on("close", () => init.signal?.removeEventListener("abort", abort));
        child.stdin.end(JSON.stringify({url:String(url), method:init.method, headers:Object.fromEntries(new Headers(init.headers)), body:init.body}));
    });
    const response = JSON.parse(raw);
    if (String(url).includes("api.deepseek.com")) {
        const payload = JSON.parse(response.body);
        reports.push({transport:{status:response.status,requestCharacters:String(init.body).length,input:JSON.parse(String(init.body)).input,usage:payload.usage,output:payload.output}});
        writeFileSync(reportPath, JSON.stringify(reports, null, 2));
    }
    return new Response(response.body || null, {status:response.status,statusText:response.statusText,headers:response.headers});
};
vi.spyOn(settings, "getReadWeaveRuntimeConfig").mockReturnValue({baseUrl:"https://api.deepseek.com", model:"deepseek-v4-flash", providerType:"deepseek-official",apiKey:"placeholder",rates:readWeaveModelRates("deepseek-v4-flash")});
vi.spyOn(settings, "getReadWeaveSearchRuntimeConfig").mockReturnValue({mode:"always",budgetCny:0.009,serperApiKey:"placeholder"});
const actualSearch = search.searchReadWeaveActiveEvidence, actualPage = search.readReadWeavePageWithJina;
vi.spyOn(search, "searchReadWeaveActiveEvidence").mockImplementation((input, opts) => actualSearch(input, {...opts,fetcher:remoteFetch}));
vi.spyOn(search, "readReadWeavePageWithJina").mockImplementation((url, opts) => actualPage(url, {...opts,fetcher:remoteFetch}));
vi.stubGlobal("fetch", remoteFetch);
afterAll(() => { writeFileSync(reportPath, JSON.stringify(reports, null, 2)); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("two explicit live functional probes, no judge model", () => {
    it.each([
        {id:"contextual-kernel",title:"这里的内核是什么？",selected:"内核",context:"DREAMPlace 在图形处理器上计算线长和密度，并为线长和密度计算定制关键内核",expected:/计算|并行/u,forbidden:/这里的内核指操作系统|进程调度是其核心/u},
        {id:"scoped-bigint",title:"bigint 是什么？",selected:"bigint",context:"这段 TypeScript 代码使用 bigint 保存超过 Number.MAX_SAFE_INTEGER 的计数值",expected:/整数/u,forbidden:/无法确定.*含义|当前证据没有.*定义/u}
    ])("$id", async sample => {
        const progress: unknown[] = [];
        try {
            const result = await generateReadWeaveActiveAnswer({articleId:"fixture",anchorId:sample.id,anchorType:"range",kind:"question",title:sample.title,
                fragments:[{id:"selection",role:"selected",text:sample.selected},{id:"context",role:"previous",text:sample.context}],autoExternalSearch:true}, p => {
                progress.push(p); console.log(sample.id,p.stage,p.message);
            });
            reports.push({id:sample.id,result,progress});
            console.log(sample.id,JSON.stringify({cost:result.usage?.costCny,calls:result.usage?.modelCalls,queries:result.audit?.searchQueries,formatIssues:result.audit?.validationIssues}));
            expect(result.audit?.workflowVersion).toBe("active-research-v1");
            expect(result.body).toMatch(sample.expected);
            expect(result.body).not.toMatch(sample.forbidden);
            expect(result.externalSearchDecision?.executed).toBe(true);
            expect(result.usage?.withinBudget).toBe(true);
        } catch (error) {
            reports.push({id:sample.id,progress,error:error instanceof Error ? error.message : String(error)});
            throw error;
        }
    });
});
