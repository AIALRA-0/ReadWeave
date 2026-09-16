import type { ReadWeaveAnswerPlan } from "@triliumnext/commons";

export function splitPlanLines(value: string): string[] {
    return value.split(/\r?\n/gu).map(line => line.trim()).filter(Boolean);
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
