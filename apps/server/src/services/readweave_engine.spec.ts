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

    it("does not fill spare context budget with unrelated document paragraphs", () => {
        const selectedText = "样品甲的读数高于样品乙，但记录没有说明差异原因。";
        const result = selectReadWeaveContext("两种样品的读数差异是什么，能判断原因吗", [
            { id: "selected", role: "selected", text: selectedText },
            ...Array.from({ length: 40 }, (_, index) => ({
                id: `noise-${index}`,
                role: "document" as const,
                text: `第${index + 1}节介绍海洋环流与季风形成过程。`
            }))
        ], 6_000);

        expect(result.decision.fragmentIds).toEqual(["selected"]);
        expect(result.decision.characterCount).toBe(selectedText.length);
    });

    it("keeps a document paragraph when its content is relevant to the question", () => {
        const result = selectReadWeaveContext("矩阵乘法为什么适合并行计算", [
            { id: "selected", role: "selected", text: "本段介绍神经网络计算。" },
            { id: "related", role: "document", text: "矩阵乘法中的多个输出元素可以并行计算。" },
            { id: "unrelated", role: "document", text: "海洋环流会影响沿岸气候。" }
        ], 6_000);

        expect(result.decision.fragmentIds).toEqual(["selected", "related"]);
    });
});
