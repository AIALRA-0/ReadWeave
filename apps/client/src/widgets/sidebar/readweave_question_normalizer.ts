export function normalizeReadWeaveQuestionDraft(question: string, quoteSelectedText = true): string {
    const value = question.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!value) return "回答用户的问题";
    const whatIs = value.match(/^(?:啥事|是啥|啥是|什么叫|何为|怎么理解|如何理解)\s*[“‘"']?(.+?)[”’"']?[？?]?$/u)
        ?? value.match(/^[“‘"']?(.+?)[”’"']?\s*是啥[？?]?$/u);
    if (whatIs?.[1]) {
        const subject = whatIs[1].trim();
        const quoted = quoteSelectedText || /[“‘"']/u.test(value);
        return `${quoted ? `“${subject}”` : subject}是什么？`;
    }
    return value.replace(/[?]+$/u, "？");
}
