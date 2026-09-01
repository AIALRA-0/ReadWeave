import type { ReadWeaveObject } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    extractReadWeaveQuestionSubject,
    findReadWeaveCandidates,
    normalizeReadWeaveTitle,
    questionTitleSimilarity,
    selectReadWeaveContext,
    titleSimilarity
} from "./readweave_engine.js";

describe("ReadWeave deterministic engine", () => {
    it("normalizes punctuation and Unicode width", () => {
        expect(normalizeReadWeaveTitle("ＮＰＵ（神经网络处理器）")).toBe("npu神经网络处理器");
    });

    it("ranks exact titles above variants", () => {
        expect(titleSimilarity("RTL 工具保护", "RTL工具保护")).toBe(1);
        expect(titleSimilarity("RTL 工具保护", "FPGA 配置文件")).toBeLessThan(0.4);
    });

    it("extracts the topic instead of generic question-template wording", () => {
        expect(extractReadWeaveQuestionSubject("“3D-MAPS”是什么？请从零开始给出通用、准确且容易理解的说明"))
            .toBe("3D-MAPS");
        expect(extractReadWeaveQuestionSubject("在当前语境中，NPU 是什么？")).toBe("NPU");
        expect(extractReadWeaveQuestionSubject("为什么会出现“时序违例”？请解释原因、因果链和成立条件"))
            .toBe("时序违例");
    });

    it("does not confuse unrelated topics that use the same generic question template", () => {
        const mapsQuestion = "“3D-MAPS”是什么？请从零开始给出通用、准确且容易理解的说明";
        const retimingQuestion = "“时序再优化”是什么？请从零开始给出通用、准确且容易理解的说明";

        expect(questionTitleSimilarity(mapsQuestion, retimingQuestion)).toBe(0);
        expect(findReadWeaveCandidates(mapsQuestion, "question", [ {
            objectId: "question-retiming",
            kind: "question",
            title: retimingQuestion
        } as ReadWeaveObject ])).toEqual([]);
    });

    it("matches the same topic and intent while distinguishing a different question intent", () => {
        expect(questionTitleSimilarity(
            "“3D-MAPS”是什么？请给出通用、详细说明",
            "3D-MAPS 是什么？请从零开始给出准确且容易理解的说明"
        )).toBe(1);
        expect(questionTitleSimilarity(
            "“3D-MAPS”是什么？请给出通用、详细说明",
            "“3D-MAPS”是如何工作的？请说明整体机制"
        )).toBe(0.7);
        expect(findReadWeaveCandidates("“3D-MAPS”是什么？请给出通用、详细说明", "question", [ {
            objectId: "question-mechanism",
            kind: "question",
            title: "“3D-MAPS”是如何工作的？请说明整体机制"
        } as ReadWeaveObject ])).toEqual([
            expect.objectContaining({
                confidence: 0.7,
                sameTopic: true,
                intentMatch: false,
                reuseRecommended: false
            })
        ]);
    });

    it("returns at most three candidates above the semantic threshold", () => {
        const objects = Array.from({ length: 6 }, (_, index) => ({
            objectId: `question-${index}`,
            kind: "question",
            title: index < 4
                ? `“3D-MAPS”是什么？请给出第 ${index + 1} 种通用说明`
                : `“无关主题 ${index}”是什么？请给出通用说明`
        })) as ReadWeaveObject[];

        const candidates = findReadWeaveCandidates("“3D-MAPS”是什么？请给出通用、详细说明", "question", objects, 8);
        expect(candidates).toHaveLength(3);
        expect(candidates.every(candidate => candidate.confidence >= 0.55)).toBe(true);
        expect(candidates.every(candidate => candidate.title.includes("3D-MAPS"))).toBe(true);
    });

    it("recommends a canonical term when a new selection contains only its abbreviation", () => {
        const object = {
            objectId: "term-tess",
            kind: "term",
            title: "TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）",
            termIdentity: {
                abbreviation: "TESS",
                chineseName: "凌日系外行星巡天卫星",
                englishName: "Transiting Exoplanet Survey Satellite"
            }
        } as ReadWeaveObject;

        expect(findReadWeaveCandidates("TESS", "term", [ object ], 8, { abbreviation: "TESS" })).toEqual([
            expect.objectContaining({ objectId: "term-tess", confidence: 1, reuseRecommended: true })
        ]);
        expect(findReadWeaveCandidates("TESS", "term", [ object ])).toEqual([
            expect.objectContaining({ objectId: "term-tess", confidence: 1, reuseRecommended: true })
        ]);
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

    it("ranks a term's raw subject above fragments matching only a generalized definition prompt", () => {
        const result = selectReadWeaveContext("BS-PDN-Last", [
            {
                id: "selected",
                role: "selected",
                text: "本段选中了一个需要定义的方法名。".repeat(4)
            },
            {
                id: "term-relevant",
                role: "document",
                text: "BS-PDN-Last 是该研究比较的背面供电网络方法。".repeat(14)
            },
            {
                id: "generic-prompt",
                role: "document",
                text: "当前语境是什么以及如何根据当前语境给出一般说明。".repeat(22)
            }
        ], 800, true);

        expect(result.decision.fragmentIds).toContain("term-relevant");
        expect(result.decision.fragmentIds).not.toContain("generic-prompt");
    });
});
