import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./readweave_settings.js", () => ({
    getReadWeaveRuntimeConfig: () => ({
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: "placeholder"
    })
}));

import { performWebCalibration } from "./readweave_ai.js";

describe("ReadWeave web calibration", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("starts a fresh forced-search attempt after two turns without tool results", async () => {
        const responses = [
            {
                model: "deepseek-v4-pro",
                stop_reason: "pause_turn",
                content: [ { type: "text", text: "仍在准备检索。" } ]
            },
            {
                model: "deepseek-v4-pro",
                stop_reason: "end_turn",
                content: [ { type: "text", text: "未执行搜索的草稿不能作为校准结果。" } ]
            },
            {
                model: "deepseek-v4-pro",
                stop_reason: "end_turn",
                content: [
                    {
                        type: "web_search_tool_result",
                        content: [
                            { type: "web_search_result", url: "https://standards.ieee.org/specification" },
                            { type: "web_search_result", url: "https://dl.acm.org/publication" },
                            { type: "web_search_result", url: "https://standards.ieee.org/specification" }
                        ]
                    },
                    { type: "text", text: "规范名称：已由两个公开来源交叉校准。" }
                ]
            }
        ];
        let responseIndex = 0;
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(responses[responseIndex++]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }));
        vi.stubGlobal("fetch", fetchMock);
        const progress: unknown[] = [];

        const result = await performWebCalibration(
            "待校准技术名词",
            "一个只用于公开实体识别的测试选区",
            update => progress.push(update)
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
            messages: unknown[];
            tool_choice?: { type?: string };
        });
        const independentAttemptStarts = requestBodies.filter(body => body.messages.length === 1);
        expect(independentAttemptStarts).toHaveLength(2);
        expect(independentAttemptStarts.map(body => body.tool_choice)).toEqual([
            { type: "any" },
            { type: "any" }
        ]);
        expect(result).toEqual({
            memo: "规范名称：已由两个公开来源交叉校准。",
            model: "deepseek-v4-pro",
            sourceCount: 2
        });
        expect(progress.some(update => JSON.stringify(update).includes("重试"))).toBe(true);
    });

    it("rejects text memos whose tool results have no valid public source URL in both attempts", async () => {
        const invalidToolResults = [
            [
                { type: "web_search_result", url: "" },
                { type: "web_search_result", url: "not a URL" }
            ],
            [
                { type: "web_search_result", url: "ftp://private.example.com/source" },
                { type: "web_search_result" }
            ]
        ];
        let responseIndex = 0;
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
            model: "deepseek-v4-pro",
            stop_reason: "end_turn",
            content: [
                {
                    type: "web_search_tool_result",
                    content: invalidToolResults[responseIndex++ % invalidToolResults.length]
                },
                { type: "text", text: "这份文本备忘录没有可核验的公开来源。" }
            ]
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(performWebCalibration(
            "待校准技术名词",
            "只用于公开实体识别的测试选区"
        )).rejects.toThrow(/没有返回可核验的公开来源 URL.*两次独立联网校准均未成功/);

        expect(fetchMock).toHaveBeenCalledTimes(4);
        const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { messages: unknown[] });
        expect(requestBodies.filter(body => body.messages.length === 1)).toHaveLength(2);
    });

    it("accepts only valid HTTP(S) source URLs and deduplicates them", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            model: "deepseek-v4-pro",
            stop_reason: "end_turn",
            content: [
                {
                    type: "web_search_tool_result",
                    content: [
                        { type: "web_search_result", url: "" },
                        { type: "web_search_result", url: "ftp://private.example.com/source" },
                        { type: "web_search_result", url: "https://standards.ieee.org/specification" },
                        { type: "web_search_result", url: "http://dl.acm.org/publication" },
                        { type: "web_search_result", url: "https://standards.ieee.org/specification" }
                    ]
                },
                { type: "text", text: "已由两个公开来源完成校准。" }
            ]
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(performWebCalibration(
            "待校准技术名词",
            "只用于公开实体识别的测试选区"
        )).resolves.toEqual({
            memo: "已由两个公开来源完成校准。",
            model: "deepseek-v4-pro",
            sourceCount: 2
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes a terminated calibration connection without exposing the runtime message", async () => {
        const transportError = new Error("terminated");
        const fetchMock = vi.fn(async () => {
            const response = Response.json({});
            vi.spyOn(response, "json").mockRejectedValue(transportError);
            return response;
        });
        vi.stubGlobal("fetch", fetchMock);

        let failure: unknown;
        try {
            await performWebCalibration(
                "Mercury 的含义是什么？",
                "Mercury 可能指行星、元素或同名项目，现有文字没有消歧。"
            );
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toMatch(/ReadWeave 无法生成.*联网校准.*连接中断.*上下文与证据/u);
        expect((failure as Error).message).not.toContain("terminated");
        expect((failure as Error).cause).toBe(transportError);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
