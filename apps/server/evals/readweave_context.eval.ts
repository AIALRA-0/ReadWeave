import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as settings from "../src/services/readweave_settings.js";
import { READWEAVE_FORMAT_VERSION, readWeaveFormatIssues } from "../src/services/readweave_format.js";
import { generateUnifiedReadWeaveAnswer } from "../src/services/readweave_unified_ai.js";

const cases = [
    { name:"chip-placement", selected:"解析布局", article:"本文研究芯片物理设计的全局布局。解析布局将单元坐标作为连续变量，将线长和密度构造成可微目标，通过优化确定各个单元的位置。", expected:/连续|可微|数学优化/u, forbidden:/Layout Resolution|页面布局|文档版面/u },
    { name:"chip-kernel", selected:"内核", article:"本文研究芯片布局算法。布局器使用深度学习框架，为线长和密度计算定制了关键内核，通过并行计算求取目标函数和梯度。", expected:/线长|密度|并行计算/u, forbidden:/这里的.{0,12}指操作系统|管理进程|系统调用/u },
    { name:"os-kernel", selected:"内核", article:"本文介绍操作系统架构。内核负责进程调度、虚拟内存管理和硬件访问，应用通过系统调用请求服务。", expected:/操作系统|进程|内存/u, forbidden:/线长|密度梯度/u },
    { name:"linear-map-kernel", selected:"核", article:"本文研究线性代数。线性映射的核是所有被映射到零向量的向量组成的子空间，矩阵的零空间给出这一概念的具体形式。", expected:/零向量|零空间|线性映射/u, forbidden:/操作系统|进程调度|芯片布局/u }
];

beforeAll(() => {
    const options = JSON.parse(process.env.READWEAVE_EVAL_CONFIG || "null");
    if (!options?.readWeaveApiKey) throw new Error("Explicit live evaluation requires a private model configuration");
    const configured = settings.getReadWeaveSearchRuntimeConfig();
    vi.spyOn(settings,"getReadWeaveRuntimeConfig").mockReturnValue({
        baseUrl:options.readWeaveBaseUrl, model:options.readWeaveModel, apiKey:options.readWeaveApiKey,
        providerType:options.readWeaveProviderType || undefined
    });
    vi.spyOn(settings,"getReadWeaveSearchRuntimeConfig").mockReturnValue({ ...configured,
        serperApiKey:options.readWeaveSerperApiKey, exaApiKey:options.readWeaveExaApiKey,
        jinaApiKey:options.readWeaveJinaApiKey
    });
});
afterAll(()=>vi.restoreAllMocks());

describe("live pinned writing skill", () => {
    it("retains formula section ownership and explains a reproducible calculation", async () => {
        const article = "加权平均为 $m=(w_1x_1+w_2x_2)/(w_1+w_2)$。教学示例：x_1=2、x_2=4、w_1=1、w_2=3，结果为 3.5。权重非负且总权重大于零。";
        const result = await generateUnifiedReadWeaveAnswer({
            articleId:"writing-skill-evaluation", anchorId:"formula", anchorType:"range", kind:"question",
            title:"解释加权平均公式，用二级标题区分用途和边界，用用途下面的三级标题分别解释符号与示例，展示中间运算",
            autoApplyPlan:true, activeExternalSearch:false, autoExternalSearch:false,
            fragments:[{id:"selected",role:"selected",text:"加权平均"},{id:"document",role:"document",text:article}]
        });
        console.info(JSON.stringify({case:"writing-formula",body:result.body,usage:result.usage,
            formatVersion:result.audit?.formatVersion,issues:readWeaveFormatIssues(result.body)}));
        expect(result.body).toMatch(/^## [^#]/mu);
        expect(result.body).toMatch(/^### [^#]/mu);
        expect(result.body).toContain("3.5");
        expect(result.body).toMatch(/示例|教学/u);
        expect(result.body).toMatch(/权重/u);
        expect(result.audit?.formatVersion).toBe(READWEAVE_FORMAT_VERSION);
        expect(result.usage?.costCny).toBeLessThanOrEqual(.1);
    });
    it("keeps a confirmed name separate from abbreviations and explanatory aliases", async () => {
        const article = "本文讨论芯片设计中的 IP，即知识产权（Intellectual Property），指可复用的电路设计模块，不是网络协议。";
        const result = await generateUnifiedReadWeaveAnswer({
            articleId:"writing-skill-evaluation",anchorId:"name",anchorType:"range",kind:"question",
            title:"这里的 IP 全称是什么？只解释名称和当前含义",autoApplyPlan:true,
            activeExternalSearch:false,autoExternalSearch:false,
            fragments:[{id:"selected",role:"selected",text:"IP"},{id:"document",role:"document",text:article}]
        });
        console.info(JSON.stringify({case:"writing-name",body:result.body,usage:result.usage,
            formatVersion:result.audit?.formatVersion,issues:readWeaveFormatIssues(result.body)}));
        expect(result.body).toContain("IP 知识产权（Intellectual Property）");
        expect(result.body).not.toMatch(/（[^）]*[,，;；][^）]*）/u);
        expect(result.body).not.toContain("Internet Protocol");
        expect(result.audit?.formatVersion).toBe(READWEAVE_FORMAT_VERSION);
        expect(result.usage?.costCny).toBeLessThanOrEqual(.1);
    });
});

describe("live article-grounded meanings", () => {
    it.each(["解析布局","内核"])("actual article: %s", async subject => {
        const stored = JSON.parse(process.env.READWEAVE_EVAL_CONFIG || "null");
        const fragments = stored?.articleFragments as import("@triliumnext/commons").ReadWeaveContextFragment[];
        if (!fragments?.length) throw new Error("Supply private articleFragments for actual-article validation");
        const result = await generateUnifiedReadWeaveAnswer({
            articleId:"actual-article-evaluation",anchorId:"actual-context",anchorType:"range",kind:"question",
            title:`${subject}是什么？`,autoApplyPlan:true,autoExternalSearch:true,
            fragments:fragments.map(fragment=>fragment.role === "selected" ? {...fragment,text:subject} : fragment)
        });
        console.info(JSON.stringify({case:`actual-${subject}`,body:result.body,usage:result.usage,context:result.context,
            contract:result.audit?.questionContract,
            search:result.audit?.questionContract.externalSearchDecision,issues:result.audit?.validationIssues}));
        expect(result.body).toMatch(subject === "解析布局" ? /连续|数学优化|可微/u : /线长|密度|计算内核|并行/u);
        expect(result.body).not.toMatch(/Layout Resolution|页面版面|内核.{0,12}指操作系统/u);
        expect(result.usage?.costCny).toBeLessThanOrEqual(.1);
        expect(result.context.fragmentIds).toEqual(fragments.map(fragment=>fragment.id));
    });
    it.each(cases)("$name", async testCase => {
        const article = `前文\n${testCase.article}\n${"此章讨论实验条件和结果的解释边界，不引入其他学科的含义。\n".repeat(90)}文末：${testCase.article}`;
        const result = await generateUnifiedReadWeaveAnswer({
            articleId:"context-evaluation",anchorId:testCase.name,anchorType:"range",kind:"question",
            title:`${testCase.selected}是什么？`,optimizeQuestion:true,autoApplyPlan:true,
            autoExternalSearch:true,activeExternalSearch:false,
            fragments:[{id:"selected",role:"selected",text:testCase.selected},
                {id:"current-block",role:"section",text:testCase.article},
                {id:"document",role:"document",text:article}]
        });
        console.info(JSON.stringify({case:testCase.name,body:result.body,usage:result.usage,
            context:result.context,search:result.audit?.questionContract.externalSearchDecision,
            issues:result.audit?.validationIssues}));
        expect(result.body).toMatch(testCase.expected);
        expect(result.body).not.toMatch(testCase.forbidden);
        expect(result.body).not.toMatch(/（[^）]*[A-Za-z][^）]*也称[^）]*）/u);
        expect(result.context.fragmentIds).toContain("document");
        expect(result.usage?.modelCalls).toBeGreaterThanOrEqual(2);
        expect(result.usage?.costCny).toBeLessThanOrEqual(.1);
    });
});
