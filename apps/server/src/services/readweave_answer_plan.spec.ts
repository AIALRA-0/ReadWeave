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
    it("does not turn a full-name and word-meaning question into a complete definition", () => {
        const plan = buildReadWeaveAnswerPlan(namingContract("XPT 的官方全称是什么？解释这些词分别表示什么，不要猜测名称来历"));
        expect(plan.answerType).toBe("general");
        expect(plan.steps).toEqual([ "给出有来源支持的正式全称", "逐项解释全称中各词的含义，不扩展其他术语或机制" ]);
    });
    it("keeps a full-name-only flow short", () => {
        expect(buildReadWeaveAnswerPlan(namingContract("XPT 的全称是什么？")).steps).toHaveLength(1);
    });
    it("retains broader steps when the user actually requests a mechanism", () => {
        expect(buildReadWeaveAnswerPlan(namingContract("XPT 的全称是什么？它的运作原理是什么？")).answerType).toBe("definition");
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
