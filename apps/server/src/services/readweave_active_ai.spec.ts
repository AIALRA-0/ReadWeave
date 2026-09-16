import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runtime, search } = vi.hoisted(() => ({
    runtime:{current:{baseUrl:"https://api.deepseek.com",apiKey:"placeholder",model:"deepseek-v4-flash",
        providerType:"deepseek-official",rates:{cacheHitInput:.1,cacheMissInput:3,output:9},pricingVersion:"test"}},
    search:vi.fn(async () => ({used:true,query:"compute kernel",sources:[{provider:"fixture",title:"Computation",
        url:"https://example.org/kernel",snippet:"A kernel performs a computation"}],providers:["fixture"],warnings:[],searchCostCny:.0072}))
}));
vi.mock("./readweave_settings.js", () => ({getReadWeaveRuntimeConfig:()=>runtime.current,
    getReadWeaveVerifierRuntimeConfig:()=>undefined,getReadWeaveSearchRuntimeConfig:()=>({mode:"always",budgetCny:.009})}));
vi.mock("./readweave_search.js", () => ({searchReadWeaveActiveEvidence:search,
    searchReadWeaveEvidence:vi.fn(),readReadWeavePageWithJina:vi.fn(),
    withReadWeaveSearchPolicy:<T>(_policy:unknown,run:()=>T)=>run()}));
vi.mock("./readweave_tokenizer.js", () => ({readWeavePromptInputTokens:()=>18_078}));
vi.mock("./readweave_writing_skill.js", () => ({readWeaveWritingSkill:()=>({prompt:"完整写作规则 JSON",revision:"test"})}));

import { generateReadWeaveActiveAnswer } from "./readweave_active_ai.js";
import { ReadWeaveBudget } from "./readweave_budget.js";
import { generateReadWeaveLocalRewrite } from "./readweave_unified_ai.js";

const request:ReadWeaveGenerateRequest={articleId:"a",anchorId:"b",anchorType:"range",kind:"question",title:"内核是什么？",
    fragments:[{id:"selected",role:"selected",text:"内核"},{id:"context",role:"section",text:"执行布局计算的计算内核"}]};
const ready=(result:unknown)=>({gaps:[],actions:[],readyReason:"已有必要资料",result});
function spentBudget() {
    const budget = new ReadWeaveBudget(.05,{hardLimitCny:.10});
    budget.raiseLimit(.10);
    budget.reportModelUsage(budget.reserveModelRequest(.07)!, .064021);
    return budget;
}
function transport(compatible=false, searchEnabled=true) {
    const responses=[
        {gaps:["需要语境"],actions:[{tool:"fragment",ids:["context"]}]},
        ready({normalizedQuestion:request.title,scope:"计算",needs:[{id:"N1",statement:"计算内核的含义"}],exclusions:[]}),
        ...(searchEnabled ? [{gaps:["核实机制"],actions:[{tool:"search",query:"compute kernel",direction:"计算机制",provider:"general"}]}] : []),
        ready({facts:[{needId:"N1",statement:"内核执行计算",basis:"source",sourceIds:["context"]}],
            nodes:[{id:"P1",statement:"内核执行计算",needIds:["N1"],dependsOn:[]}],terms:[]}),
        ready({body:"计算内核执行一个指定的计算任务，它接收输入数据并返回计算结果"}),
        ready({patches:[],remainingIssues:[]})
    ];
    const bodies:Record<string,unknown>[]=[];
    const fetcher=vi.fn(async (_url:unknown,init?:RequestInit)=>{
        bodies.push(JSON.parse(String(init?.body)));
        if (!responses.length) throw new Error("Unexpected extra model request");
        const answer=JSON.stringify(responses.shift());
        return new Response(JSON.stringify(compatible
            ? {choices:[{message:{content:answer},finish_reason:"stop"}],usage:{prompt_tokens:10000,completion_tokens:1000,total_tokens:11000}}
            : {status:"completed",output:[{type:"message",content:[{type:"output_text",text:answer}]}],
                usage:{input_tokens:10000,output_tokens:1000,total_tokens:11000,input_tokens_details:{cached_tokens:0}}}),
            {status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetcher);
    return {fetcher,bodies};
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();search.mockClear();});

describe("temporary generation budget suspension",()=>{
    it.each([false,true])("completes research, writing and format beyond the former cap, compatible=%s",async compatible=>{
        vi.stubEnv("READWEAVE_BUDGET_MODE","");
        vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-09-16T01:30:00Z"));
        runtime.current={...runtime.current,baseUrl:compatible?"https://gateway.example.org/v1":"https://api.deepseek.com",
            providerType:compatible?"deepseek-compatible":"deepseek-official"};
        const {fetcher,bodies}=transport(compatible), budget=spentBudget();
        const result=await generateReadWeaveActiveAnswer(request,undefined,undefined,{budget});
        expect(fetcher).toHaveBeenCalledTimes(6);
        expect(search).toHaveBeenCalledTimes(1);
        expect(result.body).toContain("计算内核执行");
        expect(result.usage).toMatchObject({budgetEnforced:false,withinBudget:true,modelCalls:7});
        expect(result.usage!.costCny).toBeGreaterThan(.10);
        expect(budget.unreportedModelCostCny).toBe(0);
        expect(budget.snapshot().receipts.filter(r=>r.kind==="resource")).toHaveLength(1);
        for(const body of bodies) {
            if(compatible) expect(body).not.toHaveProperty("max_tokens");
            else expect(body.max_output_tokens).toBe(384_000);
            const input=compatible?JSON.parse((body.messages as Array<{content:string}>)[1].content):JSON.parse(body.input as string);
            expect(input.budget).toMatchObject({mode:"meter-only",remainingCny:null,ceilingCny:null});
        }
    });
    it("retains explicit search-off even with no spending ceiling",async()=>{
        vi.stubEnv("READWEAVE_BUDGET_MODE","meter-only");
        runtime.current={...runtime.current,baseUrl:"https://api.deepseek.com",providerType:"deepseek-official"};
        const {fetcher}=transport(false,false);
        const result=await generateReadWeaveActiveAnswer({...request,activeExternalSearch:false,autoExternalSearch:false});
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(search).not.toHaveBeenCalled();
        expect(result.externalSearchDecision?.executed).toBe(false);
    });
    it("can explicitly enforce the old policy for future bounded tasks",async()=>{
        vi.stubEnv("READWEAVE_BUDGET_MODE","enforced");
        const {fetcher}=transport();
        await expect(generateReadWeaveActiveAnswer(request,undefined,undefined,{budget:spentBudget()}))
            .rejects.toThrow("完整输入无法纳入剩余预算");
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("also releases the separate selection-rewrite budget without broadening its edit scope",async()=>{
        vi.stubEnv("READWEAVE_BUDGET_MODE","meter-only");
        runtime.current={...runtime.current,baseUrl:"https://gateway.example.org/v1",providerType:"deepseek-compatible",
            rates:{cacheHitInput:1000,cacheMissInput:1000,output:1000}};
        const fetcher=vi.fn(async()=>new Response(JSON.stringify({
            choices:[{message:{content:JSON.stringify({original:"计算过程",replacement:"计算步骤",reason:"更明确",preservedFacts:["计算"]})},finish_reason:"stop"}],
            usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}
        }),{status:200,headers:{"Content-Type":"application/json"}}));
        vi.stubGlobal("fetch",fetcher);
        const result=await generateReadWeaveLocalRewrite({body:"这个计算过程执行任务",selectedText:"计算过程",instruction:"改为计算步骤"});
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({original:"计算过程",replacement:"计算步骤",scope:"selection-only",usage:{budgetEnforced:false,withinBudget:true}});
        expect(result.usage!.costCny).toBeGreaterThan(.1);
    });
});
