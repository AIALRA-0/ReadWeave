import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

export interface ReadWeaveNamingEvidence {
    bodyText: string;
    sourceId: string;
    quote: string;
}

const NAMING_ASSERTION =
    /(?:名称|名字|命名|得名|词源).{0,40}(?:源于|源自|来自|意为|暗示)|(?:缩写|全称).{0,40}(?:是|为|展开|表示)|[A-Za-z][\w-]*.{0,20}(?:是|为).{0,160}(?:缩写|首字母)|(?:stands for|named after|name derives|acronym for)/iu;
const GUESS =
    /可能|大概|或许|似乎|暗示|猜测|推测|未.{0,12}(?:明确|给出|提供|确认)|无法确认|具体展开|perhaps|probably|might|may derive/iu;

/** Exact quotes are a provenance check, not an independent factual verdict. */
export function checkReadWeaveNamingEvidence(
    body: string,
    evidence: unknown,
    sources: ReadWeaveEvidenceSource[],
) {
    const entries = Array.isArray(evidence) ? (evidence as Partial<ReadWeaveNamingEvidence>[]) : [];
    const supported = entries.filter((entry) => {
        if (
            typeof entry.bodyText !== "string" ||
            typeof entry.sourceId !== "string" ||
            typeof entry.quote !== "string"
        )
            return false;
        const source = sources.find((s) => s.sourceId === entry.sourceId);
        const quoteWords = new Set(entry.quote.toLowerCase().match(/[a-z][a-z0-9-]*/gu) ?? []);
        const assertedWords = entry.bodyText.toLowerCase().match(/[a-z][a-z0-9-]*/gu) ?? [];
        // A quote about another named entity or another English expansion
        // cannot support this sentence merely because it is a real quote.
        const sameNamedWords = assertedWords.every(word => quoteWords.has(word));
        return (
            sameNamedWords &&
            entry.quote.length >= 12 &&
            body.includes(entry.bodyText) &&
            !!source?.excerpt.includes(entry.quote) &&
            !GUESS.test(entry.bodyText) &&
            NAMING_ASSERTION.test(entry.quote)
        );
    });
    const issues = body
        .split(/(?<=[。；;！？!?])|\n+/u)
        .map((text) => text.trim())
        .map(text => {
            const start = text.search(/(?:其)?(?:名称|名字|命名|得名|词源|缩写|全称)/u);
            return start > 0 && /[，,]/u.test(text.slice(0, start)) ? text.slice(start) : text;
        })
        .filter(
            (text) =>
                NAMING_ASSERTION.test(text) &&
                (!supported.some(
                    (entry) => entry.bodyText?.includes(text) || text.includes(entry.bodyText!),
                ) ||
                    GUESS.test(text)),
        );
    return { supported, issues };
}

/** Remove only ungrounded naming clauses, never substitute a plausible story. */
export function omitUnsupportedReadWeaveNaming(body: string, clauses: string[]): string {
    let result = body;
    for (const clause of clauses) {
        const start = result.indexOf(clause);
        if (start < 0 || result.indexOf(clause, start + clause.length) >= 0) continue;
        result = result.slice(0, start) + result.slice(start + clause.length);
    }
    return result.replace(/[，,]\s*(?=\n|$)/gu, "").replace(/\n{3,}/gu, "\n\n").trim();
}
