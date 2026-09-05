import type { ReadWeaveAnswerPlan, ReadWeaveQuestionContract } from "@triliumnext/commons";

function answerTypeFor(contract: ReadWeaveQuestionContract): ReadWeaveAnswerPlan["answerType"] {
    const question = contract.normalizedQuestion;
    if (/(?:是什么|是何物|含义|定义)/u.test(question)) return "definition";
    if (/(?:是谁|哪位|身份|人物)/u.test(question)) return "identity";
    if (/(?:为什么|为何|原因)/u.test(question)) return "reason";
    if (/(?:区别|比较|差异|优缺点)/u.test(question)) return "comparison";
    if (/(?:计算|多少|概率|增幅|降幅|相差|公式)/u.test(question)) return "calculation";
    if (/(?:如何|怎么|怎样|步骤|流程)/u.test(question)) return "procedure";
    if (/(?:如何工作|机制|原理|运作)/u.test(question)) return "mechanism";
    if (/(?:能否证明|是否足以|边界|限制)/u.test(question)) return "boundary";
    return "general";
}

const STEPS: Record<ReadWeaveAnswerPlan["answerType"], string[]> = {
    definition: [ "定义对象", "说明主要处理什么", "说明如何运作", "说明最终作用", "补一个边界" ],
    identity: [ "直接说明身份", "说明当前或历史角色", "补一项代表性工作", "限定证据范围" ],
    reason: [ "先给结论", "列出直接原因", "解释原因如何产生结果", "补充适用边界" ],
    mechanism: [ "先说明机制结论", "按输入到输出解释过程", "指出关键条件", "说明限制" ],
    comparison: [ "先给决定性差异", "逐项比较核心维度", "说明条件性取舍", "避免把实现习惯当成类别规则" ],
    procedure: [ "说明目标", "按顺序列出动作", "说明每步的结果", "补充失败或停止条件" ],
    calculation: [ "列出已知量", "明确计算方向", "给出公式或步骤", "核对结果和单位" ],
    boundary: [ "直接回答能否成立", "指出证据支持范围", "说明不能推出的结论", "给出需要什么额外信息" ],
    general: [ "直接回答问题", "解释必要背景", "说明作用或关系", "补充边界" ]
};

export function buildReadWeaveAnswerPlan(
    contract: ReadWeaveQuestionContract,
    autoApplied = true
): ReadWeaveAnswerPlan {
    const answerType = answerTypeFor(contract);
    const steps = STEPS[answerType];
    return {
        answerType,
        steps,
        summary: steps.join(" → "),
        autoApplied
    };
}
