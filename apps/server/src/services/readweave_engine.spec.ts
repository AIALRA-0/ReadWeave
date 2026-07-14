import { describe, expect, it } from "vitest";

import { normalizeReadWeaveTitle, selectReadWeaveContext, titleSimilarity } from "./readweave_engine.js";

describe("ReadWeave deterministic engine", () => {
    it("normalizes punctuation and Unicode width", () => {
        expect(normalizeReadWeaveTitle("ＮＰＵ（神经网络处理器）")).toBe("npu神经网络处理器");
    });

    it("ranks exact titles above variants", () => {
        expect(titleSimilarity("RTL 工具保护", "RTL工具保护")).toBe(1);
        expect(titleSimilarity("RTL 工具保护", "FPGA 配置文件")).toBeLessThan(0.4);
    });

    it("always includes the selected paragraph and respects the budget", () => {
        const result = selectReadWeaveContext("矩阵计算是什么", [
            { id: "document", role: "document", text: "无关背景".repeat(1_000) },
            { id: "selected", role: "selected", text: "矩阵计算是本段重点。" },
            { id: "heading", role: "heading", text: "神经网络处理器" }
        ], 800);

        expect(result.decision.fragmentIds).toContain("selected");
        expect(result.decision.characterCount).toBeLessThanOrEqual(800);
    });
});
