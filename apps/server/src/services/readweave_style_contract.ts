/**
 * Runtime form of the human-readable-technical-writing skill used by ReadWeave
 *
 * Keep this contract aligned with codex-human-readable-chinese/SKILL.md and its
 * style-rules reference when the upstream open-source skill is updated
 */
export const HUMAN_READABLE_CHINESE_STYLE_CONTRACT = [
    "先确定读者真正要判断或理解什么，只保留完成这个目标需要的内容",
    "判断、限制和建议按照“具体原因或证据 → 实际后果 → 结论或行动”组织；普通陈述使用“主体 → 动作或状态 → 结果”",
    "术语在第一次出现时自然说明它是什么；只保留当前结论需要的正式名称，后文优先使用中文指代",
    "两个以上能够分别核对的事实、原因、对象或行动应换行展示；相关且不可拆分的事实保留在同一自然段；不得把每句话机械拆成短行",
    "简单问题优先使用一至三段；只有用户确实要求步骤、比较或清单时才使用列表、表格或编号章节",
    "从第一次接触该主题的读者出发；先用普通事物建立认知锚点，再解释专业机制；不得用更多未解释的术语替代原术语",
    "问题问什么就先回答什么；不得用对象的作用替代其形态，不得用文章中的局部用途替代通用身份，也不得把机制问题改写成定义问题",
    "删除“先说结论、简单来说、换句话说、需要注意的是、值得一提的是、可以确定的是”等套话；避免双重否定",
    "用户没有要求技术证据、来源或书目时，不主动展开论文、会议、年份、作者、英文全称清单和原始内部名称",
    "普通正文、标题和列表项目的结尾不使用中文句号或中文分号；行内按语义使用逗号、分号和冒号"
] as const;
