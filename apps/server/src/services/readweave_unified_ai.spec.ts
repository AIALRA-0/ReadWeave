import type { ReadWeaveGenerateRequest } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn(async () => ({
    used: true,
    query: "direct evidence",
    sources: [ {
        provider: "Official documentation",
        title: "Authoritative source",
        url: "https://example.org/official",
        snippet: "This source directly supports the requested fact",
        publishedAt: "2026-08-01",
        score: 100
    } ],
    providers: [ "Official documentation" ],
    memo: "",
    warnings: [],
    elapsedMs: 1,
    cacheHit: false,
    searchCostCny: 0
})) }));

vi.mock("./readweave_search.js", () => ({ searchReadWeaveEvidence: searchMock }));
vi.mock("./readweave_settings.js", () => ({
    getReadWeaveRuntimeConfig: () => ({
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "placeholder"
    })
}));

import { generateUnifiedReadWeaveAnswer } from "./readweave_unified_ai.js";

function request(title: string, kind: ReadWeaveGenerateRequest["kind"] = "question"): ReadWeaveGenerateRequest {
    return {
        articleId: "article",
        anchorId: "anchor",
        anchorType: "range",
        kind,
        title,
        optimizeQuestion: true,
        fragments: [
            { id: "selected", role: "selected", text: `${title} appeared in the current technical article` },
            { id: "nearby", role: "next", text: "Nearby text exists only for disambiguation" }
        ]
    };
}

function installModel(searchQueries: string[] = [ "authoritative direct evidence" ]) {
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = payload.messages.map(message => message.content).join("\n");
        let result: Record<string, unknown>;
        if (prompt.includes("统一问题分析器")) {
            result = {
                normalizedQuestion: "规范化后的原问题？",
                objective: "直接回答用户明确询问的命题",
                answerRequirements: [ "给出直接结论", "解释必要机制与边界" ],
                exclusions: [ "不复述文章已有句子" ],
                searchQueries,
                requiresCurrentEvidence: true
            };
        } else if (prompt.includes("统一质量审计器")) {
            result = { valid: true, issues: [], unsupportedClaims: [] };
        } else {
            result = {
                body: "这是直接结论。它先说明对象本身，再解释必要机制与边界。",
                optimizedTitle: "规范化后的原问题？",
                termIdentity: { abbreviation: "NPU", chineseName: "神经网络处理单元", englishName: "Neural Processing Unit" },
                claims: [ { claimId: "C1", text: "这是受到公开证据支持的直接结论", sourceIds: [ "S1" ], confidence: "high" } ],
                unresolvedClaims: []
            };
        }
        return Response.json({
            model: "deepseek-v4-flash",
            choices: [ { message: { content: JSON.stringify(result) } } ],
            usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
        });
    }));
}

describe("ReadWeave unified evidence workflow", () => {
    beforeEach(() => {
        searchMock.mockClear();
        installModel();
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([
        [ "人物资料", "Moongon Jung 是谁？", "question" ],
        [ "通用定义", "NPU", "term" ],
        [ "工作机制", "CXL.io 具体以什么形态工作？", "question" ]
    ] as const)("uses the same contract, evidence, writer and verifier for %s", async (_label, title, kind) => {
        const result = await generateUnifiedReadWeaveAnswer(request(title, kind));

        expect(result.audit?.workflowVersion).toBe("unified-evidence-v1");
        expect(result.audit?.questionContract.objective).toBe("直接回答用户明确询问的命题");
        expect(result.body).not.toContain("。");
        expect(result.body).toContain("直接结论");
        expect(result.evidenceSources).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceId: "S1", url: "https://example.org/official" })
        ]));
        expect(result.claims?.[0].sourceIds).toEqual([ "S1" ]);
        expect(result.reviewIssues).toBeUndefined();
        expect(result.usage?.withinBudget).toBe(true);
        expect(searchMock).toHaveBeenCalled();
    });

    it("repairs punctuation and paragraph length deterministically before saving", async () => {
        const result = await generateUnifiedReadWeaveAnswer(request("如何工作？"));

        expect(result.body).not.toMatch(/。|&#x|&#\d/u);
        expect(result.audit?.citationsVerified).toBe(true);
    });

    it("runs all free evidence queries in parallel but permits only one paid fallback", async () => {
        installModel([ "primary authority", "independent corroboration", "current status" ]);

        await generateUnifiedReadWeaveAnswer(request("这个对象目前是什么状态？"));

        const calls = (searchMock.mock.calls as unknown as Array<[ { query: string; allowPaid: boolean } ]>)
            .map(([ options ]) => options);
        expect(calls.filter(call => call.allowPaid === false)).toHaveLength(3);
        expect(calls.filter(call => call.allowPaid === true)).toEqual([
            expect.objectContaining({ query: "primary authority" })
        ]);
    });

    it("keeps raw transport diagnostics out of the user-visible failure", async () => {
        const transportError = new Error("terminated");
        vi.stubGlobal("fetch", vi.fn(async () => { throw transportError; }));

        let failure: Error | undefined;
        try {
            await generateUnifiedReadWeaveAnswer(request("连接为什么中断？"));
        } catch (error) {
            failure = error as Error;
        }

        expect(failure).toBeDefined();
        expect(failure?.message).toContain("模型服务连接中断");
        expect(failure?.message).not.toContain("terminated");
        expect(failure?.cause).toBe(transportError);
    });
});
