import type { ReadWeaveAnswerPlan, ReadWeaveContentType } from "@triliumnext/commons";
import { normalizeReadWeaveQuestionDraft } from "./readweave_question_normalizer.js";

export function splitPlanLines(value: string): string[] {
    return value.split(/\r?\n/gu).map(line => line.trim()).filter(Boolean);
}

export function createEditableReadWeaveAnswerPlan(question: string, _contentType: ReadWeaveContentType, quoteSelectedText = true): ReadWeaveAnswerPlan {
    const normalized = normalizeReadWeaveQuestionDraft(question, quoteSelectedText);
    const isDefinition = /(?:是什么|什么是|定义|什么意思|含义)/u.test(normalized);
    const steps = isDefinition
        ? [ "先给出对象身份和一句话定义", "说明它主要处理什么", "说明它通过什么方式运作", "说明它最终解决什么问题", "补充最容易误解的边界" ]
        : [ "先直接回答问题", "补足理解答案所必需的背景", "解释原因、机制或步骤", "说明适用范围和限制" ];
    return {
        version: 1,
        reviewStatus: "draft",
        answerType: isDefinition ? "definition" : "general",
        normalizedQuestion: normalized,
        objective: `直接、完整地回答“${normalized}”`,
        answerRequirements: [ "回答问题中的核心对象或动作", "不得遗漏用户明确要求的限定条件" ],
        exclusions: [ "不添加问题没有要求的旁支背景", "不把文章选区或常识猜测伪装成外部事实" ],
        searchQueries: [],
        steps,
        summary: steps.join(" → "),
        autoApplied: false,
        provenance: [
            { kind: "local", note: "根据问题措辞生成的可编辑流程" },
            { kind: "common-sense", note: "允许模型在证据不足的非关键处补齐常识，但必须保持来源层级可追溯" }
        ]
    };
}

export function normalizeEditableReadWeaveAnswerPlan(plan: ReadWeaveAnswerPlan, approve: boolean, autoApplyPlan: boolean): ReadWeaveAnswerPlan | undefined {
    const objective = plan.objective?.trim() ?? "";
    const steps = plan.steps.map(step => step.trim()).filter(Boolean);
    const answerRequirements = (plan.answerRequirements ?? []).map(item => item.trim()).filter(Boolean);
    const exclusions = (plan.exclusions ?? []).map(item => item.trim()).filter(Boolean);
    if (!objective || steps.length === 0 || answerRequirements.length === 0) return undefined;
    return {
        ...plan,
        version: 1,
        reviewStatus: approve ? "approved" : "draft",
        normalizedQuestion: plan.normalizedQuestion?.trim() || undefined,
        objective,
        steps,
        answerRequirements,
        exclusions,
        searchQueries: (plan.searchQueries ?? []).map(item => item.trim()).filter(Boolean),
        summary: steps.join(" → "),
        autoApplied: autoApplyPlan
    };
}
