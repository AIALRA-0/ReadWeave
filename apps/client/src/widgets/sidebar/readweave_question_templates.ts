export interface ReadWeaveQuestionTemplate {
    id: string;
    label: string;
    pattern: string;
    uses: number;
    builtin?: boolean;
}

export const READWEAVE_QUESTION_TEMPLATE_STORAGE_KEY = "readweave-question-templates-v1";

export const DEFAULT_READWEAVE_QUESTION_TEMPLATES: ReadWeaveQuestionTemplate[] = [
    { id: "meaning", label: "什么意思", pattern: "“{selection}”是什么意思？", uses: 0, builtin: true },
    { id: "who", label: "是谁", pattern: "“{selection}”是谁？", uses: 0, builtin: true },
    { id: "what", label: "是什么", pattern: "“{selection}”是什么？", uses: 0, builtin: true },
    { id: "why", label: "为什么", pattern: "为什么会出现“{selection}”？", uses: 0, builtin: true },
    { id: "how", label: "如何工作", pattern: "“{selection}”如何工作？", uses: 0, builtin: true },
    { id: "prerequisites", label: "前置知识", pattern: "理解“{selection}”需要哪些前置知识？", uses: 0, builtin: true },
    { id: "example", label: "举例", pattern: "能用一个例子解释“{selection}”吗？", uses: 0, builtin: true },
    { id: "compare", label: "对比", pattern: "“{selection}”与相近概念有什么区别？", uses: 0, builtin: true },
    { id: "tradeoff", label: "权衡", pattern: "“{selection}”有哪些关键权衡？", uses: 0, builtin: true },
    { id: "conditions", label: "成立条件", pattern: "“{selection}”在什么条件下成立？", uses: 0, builtin: true },
    { id: "failure", label: "失效模式", pattern: "“{selection}”会如何失效？", uses: 0, builtin: true },
    { id: "evidence", label: "证据", pattern: "关于“{selection}”有哪些可靠证据？", uses: 0, builtin: true },
    { id: "verify", label: "如何验证", pattern: "如何验证关于“{selection}”的结论？", uses: 0, builtin: true },
    { id: "implication", label: "意味着什么", pattern: "“{selection}”意味着什么？", uses: 0, builtin: true }
];

export function decodeReadWeaveText(value: string): string {
    let decoded = value;
    for (let pass = 0; pass < 3; pass++) {
        const next = decoded
            .replace(/&#x([0-9a-f]+);?/giu, (_match, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
            .replace(/&#([0-9]+);?/gu, (_match, decimal: string) => safeCodePoint(Number.parseInt(decimal, 10)))
            .replace(/&(?:amp|#38);?/giu, "&")
            .replace(/&(?:quot|#34);?/giu, "\"")
            .replace(/&(?:apos|#39);?/giu, "'")
            .replace(/&(?:lt|#60);?/giu, "<")
            .replace(/&(?:gt|#62);?/giu, ">");
        if (next === decoded) break;
        decoded = next;
    }
    return Array.from(decoded)
        .filter(character => {
            const codePoint = character.codePointAt(0) ?? 0;
            const isUnsafeControl = codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13;
            return !isUnsafeControl && codePoint !== 127 && ![0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF].includes(codePoint);
        })
        .join("")
        .replace(/\s+/gu, " ")
        .trim();
}

function safeCodePoint(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) return "";
    return String.fromCodePoint(value);
}

export function renderReadWeaveQuestionTemplate(template: ReadWeaveQuestionTemplate, selection: string): string {
    const subject = decodeReadWeaveText(selection).replace(/^[“"'‘]+|[”"'’]+$/gu, "").trim();
    return template.pattern.replaceAll("{selection}", subject).trim();
}

export function normalizeReadWeaveQuestionTemplates(value: unknown): ReadWeaveQuestionTemplate[] {
    if (!Array.isArray(value)) return DEFAULT_READWEAVE_QUESTION_TEMPLATES.map(template => ({ ...template }));
    const builtinById = new Map(DEFAULT_READWEAVE_QUESTION_TEMPLATES.map(template => [ template.id, template ]));
    const result: ReadWeaveQuestionTemplate[] = [];
    const seen = new Set<string>();
    for (const candidate of value) {
        if (!candidate || typeof candidate !== "object") continue;
        const input = candidate as Partial<ReadWeaveQuestionTemplate>;
        const id = typeof input.id === "string" ? input.id.trim().slice(0, 80) : "";
        const label = typeof input.label === "string" ? decodeReadWeaveText(input.label).slice(0, 30) : "";
        const pattern = typeof input.pattern === "string" ? decodeReadWeaveText(input.pattern).slice(0, 500) : "";
        if (!id || seen.has(id) || !label || !pattern.includes("{selection}")) continue;
        seen.add(id);
        const currentBuiltin = input.builtin === true ? builtinById.get(id) : undefined;
        result.push({
            id,
            label: currentBuiltin?.label ?? label,
            pattern: currentBuiltin?.pattern ?? pattern,
            uses: Number.isFinite(input.uses) ? Math.max(0, Math.floor(Number(input.uses))) : 0,
            builtin: input.builtin === true
        });
    }
    for (const builtin of DEFAULT_READWEAVE_QUESTION_TEMPLATES) {
        if (!seen.has(builtin.id)) result.push({ ...builtin });
    }
    return result.length > 0 ? result.slice(0, 40) : DEFAULT_READWEAVE_QUESTION_TEMPLATES.map(template => ({ ...template }));
}

export function rankedReadWeaveQuestionTemplates(
    templates: ReadWeaveQuestionTemplate[],
    question: string,
    limit = 5
): ReadWeaveQuestionTemplate[] {
    const normalizedQuestion = decodeReadWeaveText(question);
    const intentOrder = [
        [ /为什么|原因|因果/u, "why" ],
        [ /如何|怎么|机制|工作/u, "how" ],
        [ /比较|区别|差异/u, "compare" ],
        [ /验证|判据|测试/u, "verify" ],
        [ /失败|报错|异常/u, "failure" ],
        [ /证据|来源|事实/u, "evidence" ]
    ] as const;
    const intentId = intentOrder.find(([ pattern ]) => pattern.test(normalizedQuestion))?.[1];
    return templates
        .map((template, index) => ({
            template,
            score: template.uses * 10 + (template.id === intentId ? 1000 : 0) - index
        }))
        .toSorted((left, right) => right.score - left.score)
        .slice(0, Math.max(1, Math.min(12, limit)))
        .map(item => item.template);
}

export function recordReadWeaveTemplateUse(
    templates: ReadWeaveQuestionTemplate[],
    templateId: string
): ReadWeaveQuestionTemplate[] {
    return templates.map(template => template.id === templateId
        ? { ...template, uses: template.uses + 1 }
        : template);
}
