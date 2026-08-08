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

function installModel(
    searchQueries: string[] = [ "authoritative direct evidence" ],
    generatedBody = "这是直接结论。它先说明对象本身，再解释必要机制与边界。"
) {
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
                body: generatedBody,
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

    it("removes a repeated explanatory line before returning the answer", async () => {
        installModel(
            [ "authoritative direct evidence" ],
            "该协议以逻辑协议形态存在，并使用既有互连的物理层完成设备发现、配置和中断处理\n该协议以逻辑协议形态存在，并使用既有互连的物理层完成设备发现、配置和中断处理"
        );

        const result = await generateUnifiedReadWeaveAnswer(request("该协议是什么形态？"));

        expect(result.body).toBe("该协议以逻辑协议形态存在，并使用既有互连的物理层完成设备发现、配置和中断处理");
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

    it("does not release medium-confidence facts as a finished answer", async () => {
        vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
            const prompt = payload.messages.map(message => message.content).join("\n");
            const result = prompt.includes("统一问题分析器")
                ? {
                    normalizedQuestion: "这个对象是什么？",
                    objective: "说明对象的身份",
                    answerRequirements: [ "给出对象身份" ],
                    exclusions: [],
                    searchQueries: [ "official identity" ],
                    requiresCurrentEvidence: true
                }
                : prompt.includes("统一质量审计器")
                    ? { valid: true, issues: [], unsupportedClaims: [] }
                    : {
                        body: "该对象的身份只有间接证据支持",
                        claims: [ { claimId: "C1", text: "身份只有间接证据支持", sourceIds: [ "S1" ], confidence: "medium" } ],
                        unresolvedClaims: []
                    };
            return Response.json({
                model: "deepseek-v4-flash",
                choices: [ { message: { content: JSON.stringify(result) } } ],
                usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
            });
        }));

        await expect(generateUnifiedReadWeaveAnswer(request("这个对象是谁？")))
            .rejects.toThrow("未达到高置信度");
    });

    it("enforces explicit scope exclusions even when the model verifier approves", async () => {
        vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
            const prompt = payload.messages.map(message => message.content).join("\n");
            const result = prompt.includes("统一问题分析器")
                ? {
                    normalizedQuestion: "CXL.io 具体是什么形态？",
                    objective: "说明 CXL.io 的逻辑形态",
                    answerRequirements: [ "直接说明逻辑形态" ],
                    exclusions: [ "不展开内部标识符或相邻组件职责" ],
                    searchQueries: [ "CXL.io official specification" ],
                    requiresCurrentEvidence: false
                }
                : prompt.includes("统一质量审计器")
                    ? { valid: true, issues: [], unsupportedClaims: [] }
                    : {
                        body: "CXL.io 是一种逻辑协议\n\nCXL.io 的协议 ID 为 0xFFFF",
                        claims: [
                            { claimId: "C1", text: "CXL.io 是一种逻辑协议", sourceIds: [ "S1" ], confidence: "high" },
                            { claimId: "C2", text: "CXL.io 的协议 ID 为 0xFFFF", sourceIds: [ "S1" ], confidence: "high" }
                        ],
                        unresolvedClaims: []
                    };
            return Response.json({
                model: "deepseek-v4-flash",
                choices: [ { message: { content: JSON.stringify(result) } } ],
                usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
            });
        }));

        const result = await generateUnifiedReadWeaveAnswer(request("CXL.io 具体是什么形态？"));

        expect(result.body).toContain("具体形态是一组在链路上传输的输入/输出事务报文及其处理规则");
        expect(result.body).toContain("不是独立设备、芯片、插槽、线缆或物理接口");
        expect(result.body).not.toContain("0xFFFF");
        expect(result.claims).toHaveLength(1);
    });

    it.each([
        {
            title: "HTTPS 如何保护通信？",
            generated: "HTTPS 使用 TLS/SSL 和 RSA 协商会话密钥，再用 MAC 算法检查完整性",
            mustContain: [
                "验证证书中的域名、有效期和签发链",
                "ECDHE 临时椭圆曲线迪菲—赫尔曼密钥交换（Ephemeral Elliptic Curve Diffie-Hellman）",
                "AEAD 带关联数据的认证加密（Authenticated Encryption with Associated Data）"
            ],
            mustNotContain: [ "TLS/SSL", "RSA 协商" ]
        },
        {
            title: "SQL 数据库和 NoSQL 数据库的核心区别是什么？",
            generated: "SQL 数据库只能垂直扩展；NoSQL 数据库通常不支持 ACID 事务，遵循 BASE，只能水平扩展",
            mustContain: [
                "核心区别是数据模型",
                "事务范围、一致性强度和扩展方式取决于具体产品与配置",
                "关系型与非关系型数据库也都可能横向或纵向扩展"
            ],
            mustNotContain: [ "通常不支持", "遵循 BASE", "只能垂直扩展", "只能水平扩展" ]
        },
        {
            title: "Sung Kyu Lim 是谁？",
            generated: "Sung Kyu Lim 是某大学教授；他的研究聚焦 2.5D 和 3D 集成电路；他是 IEEE Fellow；他于 1994、1997、2000 年分别获得学士、硕士和博士学位",
            mustContain: [ "南加州大学（University of Southern California）", "研究聚焦 EDA 电子设计自动化（Electronic Design Automation）", "领域级代表性贡献" ],
            mustNotContain: [ "2.5D", "IEEE Fellow", "1994", "1997", "2000", "学士", "硕士", "博士" ]
        }
    ])("uses evidence-reviewed safety answers for $title", async scenario => {
        vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
            const prompt = payload.messages.map(message => message.content).join("\n");
            const result = prompt.includes("统一问题分析器")
                ? {
                    normalizedQuestion: scenario.title,
                    objective: scenario.title,
                    answerRequirements: [ "直接回答" ],
                    exclusions: [],
                    searchQueries: [ scenario.title ],
                    requiresCurrentEvidence: true
                }
                : prompt.includes("统一质量审计器")
                    ? { valid: true, issues: [], unsupportedClaims: [] }
                    : {
                        body: scenario.generated,
                        claims: [ { claimId: "C1", text: scenario.generated, sourceIds: [ "S1" ], confidence: "high" } ],
                        unresolvedClaims: []
                    };
            return Response.json({
                model: "deepseek-v4-flash",
                choices: [ { message: { content: JSON.stringify(result) } } ],
                usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 }
            });
        }));

        const result = await generateUnifiedReadWeaveAnswer(request(scenario.title));
        for (const expected of scenario.mustContain) expect(result.body).toContain(expected);
        for (const forbidden of scenario.mustNotContain) expect(result.body).not.toContain(forbidden);
        if (scenario.title === "Sung Kyu Lim 是谁？") {
            expect(result.body).toContain("院长讲席教授（Dean's Professor）\n\n他的研究聚焦");
            expect(result.body).not.toContain("Professor）他的研究");
        }
        expect(result.body).not.toContain("。");
        expect(result.usage?.withinBudget).toBe(true);
    });

    it("fails closed before writing when every public evidence query is empty", async () => {
        searchMock.mockResolvedValueOnce({
            used: false,
            query: "missing evidence",
            sources: [],
            providers: [],
            memo: "",
            warnings: [],
            elapsedMs: 1,
            cacheHit: false,
            searchCostCny: 0
        });
        searchMock.mockResolvedValueOnce({
            used: false,
            query: "missing evidence",
            sources: [],
            providers: [],
            memo: "",
            warnings: [],
            elapsedMs: 1,
            cacheHit: false,
            searchCostCny: 0
        });

        await expect(generateUnifiedReadWeaveAnswer(request("完全无法核验的对象是什么？")))
            .rejects.toThrow("未取得可核验的公开来源");
    });
});
