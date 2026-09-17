import { describe, expect, it, vi } from "vitest";
import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { ReadWeaveActiveResources } from "./readweave_active_resources.js";
import { repairReadWeaveExistingAcronyms } from "./readweave_format.js";
import { ReadWeaveProtocolError, parseReadWeaveProtocol } from "./readweave_protocol.js";
import { applyActiveFormatPatchBatch, applyActiveFormatPatches, repairReadWeaveSafePunctuation, runReadWeaveActivePipeline, validateActiveOutline, validateActiveRequirements,
    type ActivePipelinePorts, type ActiveStage } from "./readweave_active_pipeline.js";

const request: ReadWeaveGenerateRequest = {
    articleId: "a", anchorId: "x", anchorType: "range", kind: "question", title: "这里的内核是什么？",
    fragments: [{ id: "selection", role: "selected", text: "内核" },
        { id: "context", role: "previous", text: "布局工具在 GPU 上执行线长和密度计算内核" }]
};
const requirements = { normalizedQuestion: request.title, scope: "布局计算", needs: [{ id: "N1", statement: "计算内核的含义" }], exclusions: [] };
const outline = { facts: [{ needId: "N1", statement: "此处内核执行线长和密度计算", basis: "source", sourceIds: ["context"] }],
    nodes: [{ id: "P1", statement: "此处内核执行线长和密度计算", needIds: ["N1"], dependsOn: [] }], terms: [] };
const ready = (result: unknown) => ({ gaps: [], actions: [], readyReason: "资料已经覆盖本阶段需求", result });
const read = { gaps: ["需要原文语境"], actions: [{ tool: "fragment", ids: ["context"] }] };
const search = { gaps: ["核实机制"], actions: [{ tool: "search", query: "GPU computational kernel", direction: "计算机制", provider: "general" }] };
const format = ready({ patches: [], remainingIssues: [] });

function ports(responses: unknown[], enabled = true) {
    const calls: Array<{stage: ActiveStage; system: string; input: Record<string, unknown>}> = [];
    const retrieve = vi.fn<ActivePipelinePorts["retrieve"]>(async (action, resources) => {
        const id = resources.addExternal({ sourceType: "external", title: "Documentation", provider: "fixture",
            url: "https://example.org/docs", excerpt: "A kernel executes a computation", accessedAt: "2026-09-15" });
        resources.open([id]);
        return { sourceIds: [id], action };
    });
    const config: ActivePipelinePorts = {
        searchEnabled: enabled, writingSkill: "COMPLETE-SKILL", progress: vi.fn(), retrieve,
        model: vi.fn(async (stage, system, input) => {
            calls.push({ stage, system, input: input as Record<string, unknown> });
            if (!responses.length) throw new Error("Unexpected model call");
            return responses.shift();
        })
    };
    return { config, calls, retrieve };
}

describe("active resource addressing", () => {
    it("uses document position for repeated selections and includes child sections without crossing peer chapters", () => {
        const r = new ReadWeaveActiveResources([
            {id:"current-block",role:"section",text:"same",documentBlockId:"document-block-3"},
            {id:"document-block-0",role:"heading",text:"第一章",headingLevel:2},
            {id:"document-block-1",role:"document",text:"same"},
            {id:"document-block-2",role:"heading",text:"第二章",headingLevel:2},
            {id:"document-block-3",role:"document",text:"same"},
            {id:"document-block-4",role:"heading",text:"子节",headingLevel:3},
            {id:"document-block-5",role:"document",text:"必要细节"},
            {id:"document-block-6",role:"heading",text:"第三章",headingLevel:2}
        ]);
        expect(r.read({tool:"section",id:"current-block"}).sourceIds).toEqual([
            "document-block-2","document-block-3","document-block-4","document-block-5"]);
        expect(r.read({tool:"neighbors",id:"current-block",radius:1}).sourceIds).toEqual([
            "document-block-2","document-block-3","document-block-4"]);
        expect(r.read({tool:"section",id:"document-block-4"}).sourceIds).toEqual(["document-block-4","document-block-5"]);
    });
    it("never aliases an external source to an article's existing identifier", () => {
        const r = new ReadWeaveActiveResources([{id:"web-1",role:"selected",text:"文章原文"}]);
        const source = {sourceType:"external" as const,provider:"test",title:"外部资料",excerpt:"外部事实",accessedAt:"2026-09-15"};
        const id = r.addExternal(source);
        expect(id).not.toBe("web-1");
        expect(r.get(id).excerpt).toBe("外部事实");
        expect(r.get("web-1").excerpt).toBe("文章原文");
        expect(r.addExternal(source)).toBe(id);
    });
    it("keeps the entire article available and delivers repeated text only once", () => {
        const long = "后文".repeat(20_000);
        const resources = new ReadWeaveActiveResources([...request.fragments,
            { id: "later", role: "document", text: long }, { id: "duplicate", role: "document", text: long }]);
        resources.read({ tool: "article" });
        expect(resources.catalog()).toHaveLength(4);
        expect(resources.contents()).toHaveLength(3);
        expect(resources.contents().find(c => c.sourceIds.includes("later"))?.text).toBe(long);
        expect(resources.open(["later"]).newSourceIds).toEqual([]);
        resources.release(["later", "duplicate"]);
        expect(resources.read({tool: "fragment", ids: ["later"]}).newSourceIds).toEqual(["later"]);
    });
    it("supports exact search, neighbors, chapters and whole article", () => {
        const resources = new ReadWeaveActiveResources([
            { id: "h1", role: "heading", text: "第一节" }, ...request.fragments,
            { id: "h2", role: "heading", text: "第二节" }, { id: "last", role: "document", text: "目标证据" }]);
        expect(resources.read({ tool: "find", text: "目标证据" }).sourceIds).toEqual(["last"]);
        expect(resources.opened.size).toBe(0);
        expect(resources.read({tool:"section", id:"context"}).sourceIds).toEqual(["h1", "selection", "context"]);
        expect(resources.read({tool:"neighbors", id:"last", radius:1}).sourceIds).toEqual(["h2", "last"]);
        expect(resources.read({tool:"article"}).sourceIds).toHaveLength(5);
    });
    it("rejects invalid positions and duplicate IDs", () => {
        expect(() => new ReadWeaveActiveResources([...request.fragments, request.fragments[0]])).toThrow();
        const r = new ReadWeaveActiveResources(request.fragments);
        expect(() => r.read({tool:"fragment", ids:["missing"]})).toThrow();
        expect(() => r.read({tool:"neighbors", id:"context", radius:-1})).toThrow();
    });
    it("indexes a complete web page without loading it all and restores every section", () => {
        const r = new ReadWeaveActiveResources(request.fragments);
        const content = "# 起点\n开头\n\n## 中间\n正文\n\n## 末节\n末尾限定条件";
        const page = r.addDocument({sourceType:"external",provider:"test",url:"https://example.org/full",title:"完整页面",excerpt:content,accessedAt:"2026-09-15"});
        expect(page.sections).toHaveLength(3);
        expect(r.contents()).toEqual([]);
        const matches = r.read({tool:"find",text:"末尾限定条件"});
        expect(matches.sourceIds).toEqual([page.sections[2].id]);
        r.open(matches.sourceIds);
        const restored = new ReadWeaveActiveResources(request.fragments);
        restored.restore(JSON.parse(JSON.stringify(r.snapshot())));
        expect(restored.get(page.sourceId).excerpt).toBe(content);
        expect(restored.contents()).toEqual(r.contents());
    });
});

describe("active generation workflow", () => {
    it.each(["problem", "definition", "annotation", "key-point"] as const)("preserves the explicit user action through every stage: %s", async contentType => {
        const p = ports([read,ready(requirements),ready(outline),ready({body:"按用户选择的操作生成"}),format], false);
        await runReadWeaveActivePipeline({...request,contentType}, p.config);
        expect(p.calls.every(call => call.input.contentType === contentType)).toBe(true);
    });
    it("researches a real editable plan and resumes without repeating paid research", async () => {
        const first = ports([read,ready(requirements),search,ready(outline)]);
        const preview = await runReadWeaveActivePipeline({...request,autoApplyPlan:false},first.config);
        expect(preview.body).toBe("");
        expect(preview.plan.reviewStatus).toBe("draft");
        expect(first.calls.some(c => c.stage === "writing")).toBe(false);
        const next = ports([ready({body:"计算内核"}),format]);
        next.config.checkpoint = JSON.parse(JSON.stringify(preview.checkpoint));
        const final = await runReadWeaveActivePipeline({...request,autoApplyPlan:false,
            answerPlan:{...preview.plan,reviewStatus:"approved"}},next.config);
        expect(final.body).toBe("计算内核");
        expect(next.retrieve).not.toHaveBeenCalled();
        expect(next.calls.map(c => c.stage)).toEqual(["writing","format"]);
        expect(next.calls[0].input.contents).toContainEqual({sourceIds:["context"],text:request.fragments[1].text});
    });
    it.each(["short","long"])("preserves all 250 %s LLM fact needs without a semantic fallback", async size => {
        const needs = Array.from({length:250},(_,i) => ({id:`N${i}`,statement:size === "short" ? `事实 ${i}` : `用户需要理解访问路径第 ${i} 个独立步骤及其成立条件`}));
        const req = {...requirements,needs};
        const flow = {terms:[],facts:needs.map(n => ({needId:n.id,statement:n.statement,basis:"established-knowledge",sourceIds:[]})),
            nodes:needs.map((n,i) => ({id:`P${i}`,statement:n.statement,needIds:[n.id],dependsOn:[]}))};
        const p = ports([read,ready(req),ready(flow),ready({body:"完整回答"}),format],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.requirements.needs).toEqual(needs);
        expect(result.plan.steps).toEqual(needs.map(n => n.statement));
        expect(p.calls.find(c => c.stage === "writing")?.input.requirements).toEqual(req);
        expect(p.calls.filter(c => c.stage === "writing")).toHaveLength(1);
    });
    it("reads context before requirements and researches before the final declarative plan", async () => {
        const p = ports([read, ready(requirements), search, ready(outline), ready({body:"此处内核执行计算"}), format]);
        const result = await runReadWeaveActivePipeline(request, p.config);
        expect(p.calls.map(c => c.stage)).toEqual(["requirements", "requirements", "outline", "outline", "writing", "format"]);
        expect(p.calls[0].input.contents).toEqual([{sourceIds:["selection"], text:"内核"}]);
        expect(p.calls[1].input.contents).toContainEqual({sourceIds:["context"], text:request.fragments[1].text});
        expect(result.plan.steps).toEqual([outline.nodes[0].statement]);
        expect(result.body).toBe("此处内核执行计算");
        expect(p.calls.find(c => c.stage === "writing")?.system).toContain("COMPLETE-SKILL");
        expect(p.calls.find(c => c.stage === "format")?.system).toContain("COMPLETE-SKILL");
        expect(p.retrieve).toHaveBeenCalledTimes(1);
    });
    it("allows new research immediately before writing, not only at task start", async () => {
        const later = {gaps:["遗漏技术标准"], actions:[{tool:"search", query:"kernel execution standard", direction:"标准依据", provider:"general"}]};
        const p = ports([read, ready(requirements), search, ready(outline), later, ready(outline), ready({body:"计算内核"}), format]);
        await runReadWeaveActivePipeline(request, p.config);
        expect(p.retrieve).toHaveBeenCalledTimes(2);
        expect(p.calls.filter(c => c.stage === "writing")).toHaveLength(2);
        expect(p.calls.findLast(c => c.stage === "writing")?.input.lastToolResults).toEqual(expect.arrayContaining([expect.objectContaining({key:expect.stringContaining("execution standard")})]));
    });
    it("does not dispatch duplicate searches, but tells the model which result exists", async () => {
        const p = ports([read, ready(requirements), search, search, ready(outline), ready({body:"计算内核"}), format]);
        const result = await runReadWeaveActivePipeline(request, p.config);
        expect(p.retrieve).toHaveBeenCalledTimes(1);
        expect(result.trace.some(t => t.error?.includes("重复获取"))).toBe(true);
    });
    it("makes no external calls when search is disabled, including a model requesting it", async () => {
        const p = ports([read, ready(requirements), search, ready(outline), ready({body:"计算内核"}), format], false);
        const result = await runReadWeaveActivePipeline({...request, autoExternalSearch:false}, p.config);
        expect(p.retrieve).not.toHaveBeenCalled();
        expect(result.trace.some(t => t.error?.includes("关闭外部搜索"))).toBe(true);
    });
    it("does not accept readiness without having read article context", async () => {
        const p = ports([ready(requirements), read, ready(requirements), ready(outline), ready({body:"计算内核"}), format], false);
        const result = await runReadWeaveActivePipeline(request, p.config);
        expect(result.trace[0].error).toContain("先主动读取");
    });
    it("does not treat URLs in article data as completed searches", async () => {
        const p = ports([read, ready(requirements), ready(outline), ready(outline), ready({body:"计算内核"}), format]);
        const result = await runReadWeaveActivePipeline(request, p.config);
        expect(result.trace.some(t => t.actions.some(action => (action as {tool?:string}).tool === "search"))).toBe(true);
        expect(p.retrieve).toHaveBeenCalledTimes(1);
        expect(p.calls.filter(call => call.stage === "outline")).toHaveLength(2);
    });
    it("does not turn provider errors into a different answer, route or schema retry", async () => {
        const p = ports([]);
        p.config.model = vi.fn(async () => { throw new Error("provider unavailable"); });
        await expect(runReadWeaveActivePipeline(request, p.config)).rejects.toThrow("provider unavailable");
        expect(p.config.model).toHaveBeenCalledTimes(1);
    });
    it("does not reissue a paid request on a resource transport failure", async () => {
        const p = ports([read, ready(requirements), search]);
        p.retrieve.mockRejectedValueOnce(new Error("network timeout"));
        await expect(runReadWeaveActivePipeline(request, p.config)).rejects.toThrow("network timeout");
        expect(p.retrieve).toHaveBeenCalledTimes(1);
    });
    it("cancels before any model or retrieval call", async () => {
        const p = ports([]), controller = new AbortController();
        controller.abort(new Error("cancelled")); p.config.signal = controller.signal;
        await expect(runReadWeaveActivePipeline(request, p.config)).rejects.toThrow("cancelled");
        expect(p.config.model).not.toHaveBeenCalled();
    });
    it("does not discard or substitute a completed draft if format review cannot run", async () => {
        const p = ports([read, ready(requirements), ready(outline), ready({body:"计算内核执行计算"})], false);
        const result = await runReadWeaveActivePipeline(request, p.config);
        expect(result.body).toBe("计算内核执行计算");
        expect(result.formatIssues).toEqual([]);
        expect(result.trace.some(entry => entry.stage === "format" && entry.error?.includes("格式复核调用未完成"))).toBe(true);
        expect(result.repairRounds).toBe(0);
    });
    it("does not turn optional recorded gaps into a content rejection gate", async () => {
        const p = ports([read, {...ready(requirements),gaps:["本文未列每代硬件架构，但本题只需通用概念"]},ready(outline),ready({body:"计算内核执行计算"}),format],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.trace.some(t => t.error)).toBe(false);
        expect(result.requirements).toEqual(requirements);
    });
    it.each(["异构是什么", "Jiawei Hu 是谁", "IEEE 754 的精度", "内核是什么"])("uses the same workflow without code category branches: %s", async title => {
        const p = ports([read, ready({...requirements, normalizedQuestion:title}), ready(outline), ready({body:"由本题模型事实生成的答案"}), format], false);
        const result = await runReadWeaveActivePipeline({...request, title}, p.config);
        expect(p.calls.every(c => c.input.originalQuestion === title)).toBe(true);
        expect(result.requirements.normalizedQuestion).toBe(title);
        expect(result).not.toHaveProperty("domainProfile");
    });
});

describe("declarative protocol and format-only transactions", () => {
    it("recovers one complete framed JSON value, but refuses ambiguous or partial outputs", () => {
        expect(parseReadWeaveProtocol<{result:number}>("```json\n{\"result\":1}\n```" )).toEqual({result:1});
        expect(parseReadWeaveProtocol<{result:number}>("Here is JSON: {\"result\":1}" )).toEqual({result:1});
        expect(() => parseReadWeaveProtocol("{\"result\":1} {\"result\":2}")).toThrow(ReadWeaveProtocolError);
        expect(() => parseReadWeaveProtocol("{\"result\":1")).toThrow(ReadWeaveProtocolError);
    });
    it("repairs malformed stage output in that stage without restarting completed research", async () => {
        const p = ports([read,ready(requirements),search,ready(outline),ready({body:"计算内核"}),format]);
        const original = p.config.model;
        let broken = false;
        p.config.model = vi.fn(async (stage,system,input) => {
            if (stage === "writing" && !broken) { broken = true; throw new ReadWeaveProtocolError('{"body":"broken"} trailing',"包含多余内容"); }
            return original(stage,system,input);
        });
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe("计算内核");
        expect(p.retrieve).toHaveBeenCalledTimes(1);
        expect(p.calls.filter(c => c.stage === "requirements")).toHaveLength(2);
        expect(p.calls.filter(c => c.stage === "outline")).toHaveLength(2);
        expect(p.calls.find(c => c.stage === "writing")?.input.malformedStageOutput).toContain("trailing");
    });
    it("resumes from a saved draft after interruption without repeating writing", async () => {
        const first = ports([read,ready(requirements),search,ready(outline),ready({body:"计算内核执行计算"})]);
        let checkpoint: NonNullable<ActivePipelinePorts["checkpoint"]> | undefined;
        first.config.saveCheckpoint = value => { checkpoint = structuredClone(value); };
        await runReadWeaveActivePipeline(request,first.config);
        expect(checkpoint?.body).toBe("计算内核执行计算");
        const second = ports([format]);
        second.config.checkpoint = checkpoint;
        const result = await runReadWeaveActivePipeline(request,second.config);
        expect(result.body).toBe("计算内核执行计算");
        expect(second.calls.map(c => c.stage)).toEqual(["format"]);
        expect(second.retrieve).not.toHaveBeenCalled();
    });
    it("resumes at the unfinished format pass without repeating a completed paid pass", async () => {
        const first = ports([read,ready(requirements),ready(outline),ready({body:"甲"}),
            ready({patches:[],tasks:[],remainingIssues:[{code:"FMT-044",original:"甲",reason:"待复核的格式项"}]})],false);
        let checkpoint: NonNullable<ActivePipelinePorts["checkpoint"]> | undefined;
        first.config.saveCheckpoint = value => { checkpoint = structuredClone(value); };
        await runReadWeaveActivePipeline(request,first.config);
        expect(checkpoint?.formatPass).toBe(1);
        const second = ports([format],false);
        second.config.checkpoint = checkpoint;
        const result = await runReadWeaveActivePipeline(request,second.config);
        expect(second.calls.map(call => call.stage)).toEqual(["format"]);
        expect(result.formatIssues).toEqual([]);
    });
    it("keeps valid independent format edits when another edit is invalid", () => {
        const original = "**计算过程**\n\n金额为 10";
        const result = applyActiveFormatPatchBatch(original,[
            {original:"**计算过程**",replacement:"## 计算过程"},
            {original:"金额为 10",replacement:"金额为 100"}
        ],[]);
        expect(result.body).toBe("## 计算过程\n\n金额为 10");
        expect(result.accepted).toBe(1);
        expect(result.rejected).toHaveLength(1);
    });
    it("accepts the complete verified bilingual term when only its display case changes", () => {
        const original = "最差电压下降（worst-case voltage drop）";
        const replacement = "最差电压下降（Worst-Case Voltage Drop）";
        const terms = [{original:"最差电压下降",canonical:original,sourceIds:["web-5"]}];
        expect(applyActiveFormatPatches(original,[{original,replacement}],terms)).toBe(replacement);
        expect(applyActiveFormatPatchBatch(original,[{original,replacement}],terms).accepted).toBe(1);
    });
    it("passes the exact casing target to format review and applies its full-span repair", async () => {
        const original = "最差电压下降（worst-case voltage drop）";
        const replacement = "最差电压下降（Worst-Case Voltage Drop）";
        const withTerm = {...outline,terms:[{original:"最差电压下降",canonical:original,sourceIds:["context"]}]};
        const p = ports([read,ready(requirements),ready(withTerm),ready({body:original}),
            ready({patches:[{original,replacement}],remainingIssues:[]})],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe(replacement);
        expect(result.trace.findLast(stage => stage.stage === "format")?.result).toEqual(expect.objectContaining({accepted:1,rejectionReasons:[]}));
        expect(p.calls.find(call => call.stage === "format")?.input.nameCaseTargets)
            .toEqual(expect.arrayContaining([expect.objectContaining({englishName:"worst-case voltage drop"})]));
    });
    it("accepts a local wording repair but rejects clear fact reversal or an unrelated replacement", () => {
        expect(applyActiveFormatPatches("它能够稳定运行",[{original:"它能够稳定运行",replacement:"它可以稳定运行"}],[]))
            .toBe("它可以稳定运行");
        expect(() => applyActiveFormatPatches("模型没有运行",[{original:"模型没有运行",replacement:"模型已经运行"}],[]))
            .toThrow("反转");
        expect(() => applyActiveFormatPatches("供电压降增加",[{original:"供电压降增加",replacement:"供电压降下降"}],[]))
            .toThrow("反转");
        expect(() => applyActiveFormatPatches("至少需要 5 次",[{original:"至少需要 5 次",replacement:"至多需要 5 次"}],[]))
            .toThrow("反转");
        expect(() => applyActiveFormatPatches("芯片布局需要优化",[{original:"芯片布局需要优化",replacement:"天气预报已经发布"}],[]))
            .toThrow("没有共同对象");
        expect(applyActiveFormatPatches("模型可以运行",[{original:"模型可以运行",replacement:"模型可以运行，但不能替代人工判断"}],[]))
            .toBe("模型可以运行，但不能替代人工判断");
        expect(applyActiveFormatPatches("模型没有运行",[{original:"模型没有运行",replacement:"模型的运行尚未开始"}],[]))
            .toBe("模型的运行尚未开始");
        expect(applyActiveFormatPatches("机体温度上升",[{original:"机体温度上升",replacement:"设备变热"}],[]))
            .toBe("设备变热");
        expect(() => applyActiveFormatPatches("先取 10 再取 20",[{original:"先取 10 再取 20",replacement:"先取 20 再取 10"}],[]))
            .toThrow("数字");
        expect(() => applyActiveFormatPatches("解析布局（Analytical Placement）与错误定义",[
            {original:"错误定义",replacement:"错误定义（Analytical Placement）"}],[]))
            .toThrow("未核实英文名称");
        expect(applyActiveFormatPatches("采用最差电压下降",[
            {original:"采用最差电压下降",replacement:"采用最差电压下降（Worst-Case Voltage Drop）"}],
            [{original:"最差电压下降",canonical:"最差电压下降（Worst-Case Voltage Drop）",sourceIds:["web-5"]}]))
            .toBe("采用最差电压下降（Worst-Case Voltage Drop）");
        expect(() => applyActiveFormatPatches("解析布局（Analytical Placement）",[
            {original:"解析布局（Analytical Placement）",replacement:"芯片封装（Analytical Placement）"}],[]))
            .toThrow("未核实英文名称");
    });
    it("disambiguates a repeated format target with exact adjacent text", () => {
        const original = "术语（old name）";
        const body = `第一处 ${original}；第二处 ${original}`;
        expect(applyActiveFormatPatches(body,[{original,replacement:"术语（Old Name）",before:"第二处 "}],[]))
            .toBe(`第一处 ${original}；第二处 术语（Old Name）`);
        expect(() => applyActiveFormatPatches(body,[{original,replacement:"术语（Old Name）"}],[]))
            .toThrow("出现多次");
    });
    it("records an irrelevant rejected suggestion without another paid pass or a false answer warning", async () => {
        const body = "芯片布局需要优化";
        const p = ports([read,ready(requirements),ready(outline),ready({body}),
            ready({patches:[{original:body,replacement:"天气预报已经发布"}],remainingIssues:[]})],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe(body);
        expect(result.formatIssues).toEqual([]);
        expect(p.calls.filter(call => call.stage === "format")).toHaveLength(1);
        expect(result.trace.findLast(stage => stage.stage === "format")?.result)
            .toEqual(expect.objectContaining({accepted:0,rejected:1,
                rejectionReasons:[expect.stringContaining("没有共同对象")]}));
    });
    it("repairs a still-visible defect after rejecting one harmful patch", async () => {
        const body = "中文English";
        const p = ports([read,ready(requirements),ready(outline),ready({body}),
            ready({patches:[{original:body,replacement:"中文 English 7"}],
                remainingIssues:[{code:"FMT-047",original:body,reason:"中文与英文之间缺少空格"}]}),
            ready({patches:[{original:body,replacement:"中文 English"}],remainingIssues:[]})],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe("中文 English");
        expect(result.formatIssues).toEqual([]);
        expect(p.calls.filter(call => call.stage === "format")).toHaveLength(2);
        expect(p.calls.filter(call => call.stage === "format")[1].input.priorFailures)
            .toEqual(expect.arrayContaining([expect.stringContaining(`原文：${body}`)]));
    });
    it("allows a researched explanation to smooth the original sentence without verbatim copying", () => {
        const original = "间距决定可容纳的供电线数量";
        const facts = [{needId:"N1",statement:"间距越小，相同宽度内可容纳更多供电线",basis:"source" as const,sourceIds:["context"]}];
        const result = applyActiveFormatPatchBatch(original,[{original,
            replacement:"供电线间距决定相同宽度内可容纳的线数；间距越小，能放入的线越多",operation:"supplement"}],[],[{original,facts}]);
        expect(result.accepted).toBe(1);
        expect(result.rejected).toEqual([]);
    });
    it("applies compatible edits inside an already edited paragraph without calling them overlap", () => {
        const body = "异构布局（heterogeneous placement）有意义。";
        const result = applyActiveFormatPatchBatch(body,[
            {original:"异构布局（heterogeneous placement）有意义",replacement:"异构布局（Heterogeneous Placement）有意义"},
            {original:"有意义。",replacement:"有意义"}
        ],[]);
        expect(result.body).toBe("异构布局（Heterogeneous Placement）有意义");
        expect(result.accepted).toBe(2);
        expect(result.rejected).toEqual([]);
    });
    it("keeps formulas and literal code while removing ordinary Chinese sentence stops", () => {
        expect(repairReadWeaveSafePunctuation("解释。下一句。\n\n`原样。`\n\n$u_i = w_i/p_i$。"))
            .toBe("解释\n下一句\n\n`原样。`\n\n$u_i = w_i/p_i$");
    });
    it("accepts a fact-backed adjacent explanation but rejects invented numbers", () => {
        const original = "间距决定可容纳的供电线数量";
        const tasks = [{original,facts:[{needId:"N1",statement:"间距越小，相同宽度内可容纳更多供电线",basis:"source" as const,sourceIds:["context"]}]}];
        const valid = applyActiveFormatPatchBatch(original,[{original,replacement:`${original}；间距越小，相同宽度内可容纳更多供电线`,operation:"supplement"}],[],tasks);
        expect(valid.accepted).toBe(1);
        const invalid = applyActiveFormatPatchBatch(original,[{original,replacement:`${original}；可增加 20%`,operation:"supplement"}],[],tasks);
        expect(invalid.accepted).toBe(0);
        expect(invalid.rejected[0]).toContain("未核实数值");
    });
    it("does not present a model's nonexistent comma in a verified name as a format fault", async () => {
        const body = "LPAE 大物理地址扩展（Large Physical Address Extension）";
        const p = ports([read,ready(requirements),ready(outline),ready({body}),
            ready({patches:[],tasks:[],remainingIssues:[{code:"FMT-053",original:body,
                reason:"英文括号内混入逗号与缩写"}]})],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.formatIssues).toEqual([]);
    });
    it("accepts layout edits around an already expanded, confirmed name", () => {
        const canonical = "CPU 中央处理器（Central Processing Unit）";
        expect(applyActiveFormatPatches(canonical,[{original:canonical,replacement:`**${canonical}**`}],
            [{original:"CPU",canonical,sourceIds:[]}])).toBe(`**${canonical}**`);
    });
    it("invalidates an interrupted draft when the approved outline has changed", async () => {
        const first = ports([read,ready(requirements),search,ready(outline),ready({body:"旧草稿"})]);
        let checkpoint: NonNullable<ActivePipelinePorts["checkpoint"]> | undefined;
        first.config.saveCheckpoint = value => { checkpoint = structuredClone(value); };
        const draft = await runReadWeaveActivePipeline(request,first.config);
        const editedOutline = {...outline,nodes:[{...outline.nodes[0],statement:"先说明计算对象及其作用"}]};
        const second = ports([ready(editedOutline),ready({body:"重新按审核后的构造流写作"}),format]);
        second.config.checkpoint = checkpoint;
        const result = await runReadWeaveActivePipeline({...request,
            answerPlan:{...draft.plan,reviewStatus:"approved",steps:[editedOutline.nodes[0].statement]}},second.config);
        expect(result.body).toBe("重新按审核后的构造流写作");
        expect(second.calls.map(c => c.stage)).toEqual(["outline","writing","format"]);
    });
    it("uses a compact local executor task and accepts independent valid edits in one pass", async () => {
        const draft = "**计算过程**\n\n**结果说明**";
        const p = ports([read,ready(requirements),ready(outline),ready({body:draft}),
            ready({patches:[{original:"**计算过程**",replacement:"## 计算过程"}],
                tasks:[{original:"**结果说明**",instruction:"改为二级标题",sourceIds:[]}],remainingIssues:[]}),
            ready({patches:[{original:"**结果说明**",replacement:"## 结果说明"}]})],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe("## 计算过程\n\n## 结果说明");
        expect(result.trace.findLast(t => t.stage === "format")?.result).toEqual(expect.objectContaining({executorCalls:1,accepted:2}));
        const task = p.calls.findLast(c => c.stage === "format")?.input;
        expect(task).not.toHaveProperty("body");
        expect(task?.tasks).toEqual([expect.objectContaining({original:"**结果说明**"})]);
    });
    it("batches all local edits and does not mistake patch descriptions for retrieval calls", async () => {
        const p = ports([read,ready(requirements),ready(outline),ready({body:"**甲**\n\n**乙**"}),
            {...ready({patches:[],tasks:[
                {original:"**甲**",instruction:"改为标题",sourceIds:[]},
                {original:"**乙**",instruction:"改为标题",sourceIds:[]}
            ],remainingIssues:[]}),actions:[{type:"task",target:"标题"}]},
            {...ready({patches:[{original:"**甲**",replacement:"## 甲"},{original:"**乙**",replacement:"## 乙"}]}),
                actions:[{type:"patch",target:"标题"}]}],false);
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe("## 甲\n\n## 乙");
        expect(result.formatIssues).toEqual([]);
        expect(p.calls.filter(c => c.stage === "format")).toHaveLength(2);
        expect(p.calls.at(-1)?.input.tasks).toHaveLength(2);
    });
    it("does not move abbreviations across project names or numeric quantities", () => {
        expect(repairReadWeaveExistingAcronyms("DREAMPlace 采用加权平均（Weighted Average，WA）线长模型").body)
            .toBe("DREAMPlace 采用 WA 加权平均（Weighted Average）线长模型");
        expect(repairReadWeaveExistingAcronyms("2N 点快速傅里叶变换（Fast Fourier Transform，FFT）").body)
            .toBe("2N 点快速傅里叶变换（Fast Fourier Transform，FFT）");
    });
    it("reissues a malformed format envelope once without losing the completed answer", async () => {
        const p = ports([read,ready(requirements),ready(outline),ready({body:"计算内核执行计算"}),format],false);
        const original = p.config.model;
        let broken = false;
        p.config.model = vi.fn(async (stage,system,input) => {
            if (stage === "format" && !broken) { broken = true; throw new ReadWeaveProtocolError("{truncated", "结构尚未闭合"); }
            return original(stage,system,input);
        });
        const result = await runReadWeaveActivePipeline(request,p.config);
        expect(result.body).toBe("计算内核执行计算");
        expect(result.trace.filter(t => t.stage === "format")).toHaveLength(2);
    });
    it("reorders supplied abbreviations without requiring a semantic registry or touching formulas", () => {
        const result = repairReadWeaveExistingAcronyms("图形处理器（Graphics Processing Unit，GPU）处理数据\n\n$GPU+x$\n\n`GPU`\n\n未知缩写 ABC");
        expect(result.body).toBe("GPU 图形处理器（Graphics Processing Unit）处理数据\n\n$GPU+x$\n\n`GPU`\n\n未知缩写 ABC");
        expect(result.count).toBe(1);
        expect(repairReadWeaveExistingAcronyms(result.body).count).toBe(0);
    });
    it("rejects questions and missing requirements rather than generating defaults", () => {
        expect(() => validateActiveRequirements({...requirements, needs:[{id:"N1", statement:"这是什么？"}]})).toThrow("陈述句");
        expect(() => validateActiveRequirements({...requirements, needs:[]})).toThrow();
        const resources = new ReadWeaveActiveResources(request.fragments);
        expect(() => validateActiveOutline(outline, requirements.needs, resources)).toThrow("尚未读取");
        resources.read({tool:"article"});
        expect(() => validateActiveOutline({...outline, nodes:[]}, requirements.needs, resources)).toThrow("未在资料");
        expect(() => validateActiveOutline({...outline, nodes:[{...outline.nodes[0], dependsOn:["P1"]}]}, requirements.needs, resources)).toThrow("循环");
    });
    it("repairs line breaks without rewriting the facts", () => {
        const body = "有两类开销：同步通信随线程增长；内存竞争降低吞吐";
        const replacement = "有两类开销：\n\n- 同步通信随线程增长\n- 内存竞争降低吞吐";
        expect(applyActiveFormatPatches(body, [{original:body,replacement}], [])).toBe(replacement);
    });
    it("accepts only researched canonical name expansions", () => {
        expect(applyActiveFormatPatches("IP 用于此处", [{original:"IP",replacement:"IP 知识产权（Intellectual Property）"}],
            [{original:"IP", canonical:"IP 知识产权（Intellectual Property）", sourceIds:[]}])).toContain("知识产权");
        expect(() => applyActiveFormatPatches("IP 用于此处", [{original:"IP", replacement:"Internet Protocol"}], [])).toThrow();
    });
    it("rejects ambiguous, overlapping, semantic and math edits atomically", () => {
        expect(() => applyActiveFormatPatches("重复 重复", [{original:"重复",replacement:"重复内容"}], [])).toThrow("出现多次");
        expect(() => applyActiveFormatPatches("金额为 10", [{original:"10",replacement:"100"}], [])).toThrow();
        expect(() => applyActiveFormatPatches("公式 $x+y$", [{original:"$x+y$",replacement:"$x-y$"}], [])).toThrow("受保护");
        expect(() => applyActiveFormatPatches("abc", [{original:"ab",replacement:"a b"},{original:"bc",replacement:"b c"}], [])).toThrow("重叠");
    });
});
