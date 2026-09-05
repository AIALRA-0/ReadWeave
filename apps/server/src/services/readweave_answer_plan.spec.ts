import { describe, expect, it } from "vitest";

import { buildReadWeaveAnswerPlan } from "./readweave_answer_plan.js";

describe("ReadWeave answer plan", () => {
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
