import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { READWEAVE_OPEN_DOMAIN_CASES } from "./readweave_open_domain_cases.js";
import { captureReadWeaveTask, readWeaveTaskContractIssues } from "./readweave_task_contract.js";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("./readweave_search.js", () => ({
    searchReadWeaveEvidence: search,
    readReadWeavePageWithJina: vi.fn(),
    withReadWeaveSearchPolicy: (_policy: unknown, run: () => unknown) => run()
}));
vi.mock("./readweave_settings.js", () => ({
    getReadWeaveRuntimeConfig: () => ({ baseUrl: "https://model.example/v1", model: "fixture-model", apiKey: "example",
        providerType: "openai-compatible", rates: { cacheHitInput: 0, cacheMissInput: 0, output: 0 } }),
    getReadWeaveSearchRuntimeConfig: () => ({ mode: "always", budgetCny: 0.009 }),
    getReadWeaveVerifierRuntimeConfig: () => undefined
}));
import { generateUnifiedReadWeaveAnswer } from "./readweave_unified_ai.js";

afterEach(() => { vi.unstubAllGlobals(); search.mockClear(); });

function inputFor(question: string, context: string, id: string): ReadWeaveGenerateRequest {
    return { articleId: `article-${id}`, anchorId: `anchor-${id}`, anchorType: "range", kind: "question",
        title: question, autoExternalSearch: false, activeExternalSearch: false,
        fragments: [{ id: "selected", role: "selected", text: question }, { id: "document", role: "document", text: context }] };
}

describe("open-domain corpus integrity (not semantic model scoring)", () => {
    it("contains independent obligations and family-separated development and holdout sets", () => {
        expect(READWEAVE_OPEN_DOMAIN_CASES).toHaveLength(100);
        expect(new Set(READWEAVE_OPEN_DOMAIN_CASES.map(item => item.id)).size).toBe(100);
        const familySplits = new Map<string, string>();
        for (const item of READWEAVE_OPEN_DOMAIN_CASES) {
            expect(item.requiredConcepts.length).toBeGreaterThan(0);
            expect(item.expectedTasks.length).toBeGreaterThan(0);
            expect(item.forbiddenConcepts.length).toBeGreaterThan(0);
            if (familySplits.has(item.family)) expect(familySplits.get(item.family)).toBe(item.split);
            familySplits.set(item.family, item.split);
        }
        expect(READWEAVE_OPEN_DOMAIN_CASES.filter(item => item.split === "holdout")).toHaveLength(40);
    });

    it.each(READWEAVE_OPEN_DOMAIN_CASES)("captures all inputs and original obligations: $id", item => {
        const input = inputFor(item.question, item.context, item.id);
        const task = captureReadWeaveTask(input, true);
        expect(readWeaveTaskContractIssues(task)).toEqual([]);
        expect(task.request.questionText).toBe(item.question);
        expect(task.request.blocks.some(block => block.text === item.context)).toBe(true);
        expect(task.policy.permissions.externalSearch).toBe("off");
        expect(task.policy.writerRoute).toBe("unified");
    });
});

describe("open-domain model transport integration (mock, no semantic quality claim)", () => {
    it.each(READWEAVE_OPEN_DOMAIN_CASES)("writer receives root and complete article: $id", async item => {
        const calls: Array<{ system: string; user: string }> = [];
        vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body));
            const system = payload.messages?.[0]?.content ?? payload.instructions;
            const user = payload.messages?.[1]?.content ?? payload.input;
            calls.push({ system, user });
            const value = system.includes("统一问题分析器")
                ? { normalizedQuestion: item.question, objective: "对照原问题逐项回答", answerRequirements: [], exclusions: [], searchQueries: [] }
                : { body: "这是统一写作路径返回的测试文本，仅用于验证传输和状态，不作为答案质量评分", claims: [], unresolvedClaims: [] };
            return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }],
                usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } });
        }));
        const input = inputFor(item.question, item.context, item.id);
        const before = structuredClone(input);
        const result = await generateUnifiedReadWeaveAnswer(input);
        const writer = calls.filter(call => call.system.includes("统一证据写作者"));
        expect(writer).toHaveLength(1);
        expect(writer[0].user).toContain(item.context);
        expect(writer[0].user).toContain(item.question);
        expect(writer[0].system).not.toContain("人物“是谁”类回答写成");
        expect(search).not.toHaveBeenCalled();
        expect(input).toEqual(before);
        expect(result.audit?.questionContract.taskContract?.rootRequirement.instruction).toBe(item.question);
        expect(result.workflow.generationAttempts).toBeGreaterThanOrEqual(1);
        expect(result.usage?.withinBudget).toBe(true);
    });

    it.each(["throw", "invalid-control", "invalid-cycle", "checker-throw"])("retains a unified writer when %s occurs", async failure => {
        let writerCalls = 0;
        vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body));
            const system = payload.messages?.[0]?.content ?? payload.instructions;
            if (system.includes("统一问题分析器") && failure === "throw") throw new Error("planner unavailable");
            const value = system.includes("统一问题分析器")
                ? { objective: "解释原问题", semanticProposal: failure === "invalid-control" ? { tasks: [], policy: { refuse: true } }
                    : failure === "invalid-cycle" ? { tasks: [{ id: "t", instruction: "解释", intentHints: [], subjectIds: [], requirementIds: ["root"],
                        originRefs: [{ blockId: "question", locator: { kind: "whole" } }], dependsOnTaskIds: ["t"], expectedDeliverable: "解释", acceptanceCriteria: [], scope: "root" }] }
                        : { tasks: [] } }
                : (++writerCalls, { body: "这里的异构表示不同工艺或功能的芯片层共同组成系统", claims: [], unresolvedClaims: [] });
            return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 20, completion_tokens: 20 } });
        }));
        const result = await generateUnifiedReadWeaveAnswer(inputFor("异构是什么？", "文章介绍不同工艺的芯片层，作者是一名教授", failure), undefined,
            failure === "checker-throw" ? () => { throw new Error("checker unavailable"); } : undefined);
        expect(writerCalls).toBeGreaterThanOrEqual(1);
        expect(result.body).toContain("不同工艺");
        expect(result.body).not.toMatch(/身份|机构或职位|公开资料不足/u);
        expect(search).not.toHaveBeenCalled();
        expect(result.audit?.questionContract.taskContract?.rootRequirement.instruction).toBe("异构是什么？");
    });
});
