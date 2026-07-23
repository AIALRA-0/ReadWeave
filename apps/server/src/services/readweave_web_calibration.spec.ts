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
                            { type: "web_search_result", url: "https://standards.example.test/specification" },
                            { type: "web_search_result", url: "https://papers.example.test/publication" },
                            { type: "web_search_result", url: "https://standards.example.test/specification" }
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
});
