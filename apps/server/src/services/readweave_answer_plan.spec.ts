import { describe, expect, it } from "vitest";

import { buildReadWeaveAnswerPlan } from "./readweave_answer_plan.js";

describe("ReadWeave answer plan", () => {
    const namingContract = (normalizedQuestion: string) => ({
        normalizedQuestion,
        objective: "回答用户指定维度",
        answerRequirements: [],
        exclusions: [],
        searchQueries: [],
        requiresCurrentEvidence: true
    });
    it("keeps summary output in a factual list instead of adding background", () => {
        const plan = buildReadWeaveAnswerPlan(
            namingContract("总结选区，保留数值和否定"),true,"key-point");
        expect(plan.answerRequirements).toEqual(plan.steps);
        expect(plan.steps.join(" ")).toContain("输出列表");
        expect(plan.steps.join(" ")).not.toContain("解释必要背景");
    });
    it("does not turn a full-name and word-meaning question into a complete definition", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("XPT 的官方全称是什么？解释这些词分别表示什么，不要猜测名称来历"));
        expect(plan.answerType).toBe("general");
        expect(plan.steps).toEqual([ "给出有来源支持的正式全称", "逐项解释全称中各词的含义，不扩展其他术语或机制" ]);
    });
    it("keeps a full-name-only flow short", () => {
        expect(buildReadWeaveAnswerPlan(namingContract("XPT 的全称是什么？")).steps).toHaveLength(1);
    });
    it("keeps origin answers narrow and honors negative scope", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("Lumen 的名称来源是什么？只解释得名原因，不介绍语法和用途"));
        expect(plan.answerType).toBe("general");
        expect(plan.steps).toHaveLength(1);
        expect(plan.answerRequirements).toEqual(plan.steps);
        expect(plan.exclusions).toContain("不介绍语法和用途");
    });
    it("does not erase explicitly requested history from a broader naming question", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract(
            "Lumen 的名称来源是什么？它的发展历史和用途是什么？"
        ));
        expect(plan.steps.length).toBeGreaterThan(1);
    });
    it("answers both the full name and origin when both are explicitly requested", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("Lumen 的全称和名称来源是什么？"));
        expect(plan.steps).toHaveLength(2);
        expect(plan.steps[0]).toContain("正式全称");
        expect(plan.steps[1]).toContain("名称从何而来");
    });
    it("retains broader steps when the user actually requests a mechanism", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("XPT 的全称是什么？它的运作原理是什么？"));
        expect(plan.answerType).toBe("definition");
    });
    it("builds a compact definition flow from an unrelated software question", () => {
        const plan = buildReadWeaveAnswerPlan({
            normalizedQuestion: "容器编排是什么？",
            objective: "解释容器编排的基本含义",
            answerRequirements: [ "给出定义" ],
            exclusions: [ "不展开产品历史" ],
            searchQueries: [ "容器编排 定义" ],
            requiresCurrentEvidence: false
        });

        expect(plan.answerType).toBe("definition");
        expect(plan.summary).toBe("定义对象 → 说明主要处理什么 → 说明如何运作 → 说明最终作用 → 补一个边界");
        expect(plan.autoApplied).toBe(true);
    });

    it("keeps a calculation question separate from a definition flow", () => {
        const plan = buildReadWeaveAnswerPlan({
            normalizedQuestion: "收益率曲线倒挂的差值如何计算？",
            objective: "说明计算方式",
            answerRequirements: [ "给出公式" ],
            exclusions: [],
            searchQueries: [],
            requiresCurrentEvidence: false
        }, false);

        expect(plan.answerType).toBe("calculation");
        expect(plan.autoApplied).toBe(false);
        expect(plan.steps).toEqual([ "列出已知量", "明确计算方向", "给出公式或步骤", "核对结果和单位" ]);
    });
});
