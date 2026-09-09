import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

export interface ReadWeaveNamingEvidence {
    bodyText: string;
    sourceId: string;
    quote: string;
}

export const READWEAVE_ORIGIN_ASSERTION = new RegExp([
    "named (?:after|for)|name (?:comes|derives)|(?:decided|chose) to (?:call|name)",
    "(?:chose|chosen).{0,60}(?:name|title)|name.{0,60}(?:chosen|inspired|taken)",
    "(?:名称|名字|词源).{0,40}(?:源于|源自|来自|来源|意为|暗示)|(?<!可)以.{0,60}(?:命名|为名)",
    "(?:命名|得名)(?:于|自)|命名.{0,30}(?:源于|来自|纪念)",
    "名称.{0,20}(?:与.{0,40}无关|不是|并非)"
].join("|"), "iu");
const NAMING_ASSERTION = new RegExp([
    READWEAVE_ORIGIN_ASSERTION.source,
    "(?:缩写|全称).{0,40}(?:是|为|展开|表示)",
    "[A-Za-z][\\w-]*.{0,20}(?:是|为).{0,160}(?:缩写|首字母)|stands for|acronym for"
].join("|"), "iu");
const GUESS =
    /可能|大概|或许|似乎|暗示|猜测|推测|未.{0,12}(?:明确|给出|提供|确认)|无法确认|具体展开|perhaps|probably|might|may derive/iu;

/** Explicit parenthesized names, not title initials or an inferred etymology. */
export function readWeaveExplicitExpansions(text: string): Array<{ abbreviation: string; englishName: string }> {
    const clean = text.replace(/[*_]/gu, "");
    const entries: Array<{ abbreviation: string; englishName: string }> = [];
    const name = "([A-Z][A-Za-z]*(?:[ -]+(?:[A-Z][A-Za-z]*|of|and|for|the)){1,11})";
    for (const match of clean.matchAll(new RegExp(`${name}\\s*\\(([A-Z][A-Z0-9-]{1,15})\\)`, "gu"))) {
        entries.push({ abbreviation: match[2], englishName: match[1].replace(/^The /u, "") });
    }
    for (const match of clean.matchAll(new RegExp(`\\b([A-Z][A-Z0-9-]{1,15})\\s*\\(${name}\\)`, "gu"))) {
        entries.push({ abbreviation: match[1], englishName: match[2] });
    }
    return entries;
}

export function readWeaveResearchSubject(question: string, selected?: string): string {
    const quoted = question.match(/[“"]([^”"\n]{1,120})[”"]/u)?.[1];
    if (quoted) return quoted.trim();
    const selection = selected?.trim();
    if (selection && selection.length <= 100 && !/[。！？；\n]/u.test(selection)
        && question.toLowerCase().includes(selection.toLowerCase())) return selection;
    return question.split(/[？?，,；;。\n]/u)[0]
        .replace(/^(?:请问|请介绍|请解释|请说明|什么是|什么叫)\s*/u, "")
        .replace(/(?:的)?(?:官方|正式|完整|中文|英文)*(?:全称|缩写|名称|名字|命名|词源|得名|是什么意思|是什么|是谁|从何而来|从何得名)[\s\S]*$/u, "")
        .trim() || question.trim();
}

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
        const quotedNumbers = new Set(entry.quote.match(/\d+(?:\.\d+)?/gu) ?? []);
        const sameNumbers = (entry.bodyText.match(/\d+(?:\.\d+)?/gu) ?? [])
            .every(number => quotedNumbers.has(number));
        return (
            sameNamedWords && sameNumbers &&
            entry.quote.length >= 12 &&
            body.includes(entry.bodyText) &&
            !!source?.excerpt.includes(entry.quote) &&
            !GUESS.test(entry.bodyText) &&
            (NAMING_ASSERTION.test(entry.quote) || readWeaveExplicitExpansions(entry.quote).length > 0)
        );
    });
    // A writer can omit namingEvidence even when a source explicitly gives
    // the same name pair. Recover that direct provenance, never a guessed name.
    const pairs = sources.flatMap(source => readWeaveExplicitExpansions(source.excerpt).map(pair => ({ ...pair, source })));
    for (const clause of body.split(/(?<=[。；;！？!?])|\n+/u).map(text => text.trim())) {
        if (GUESS.test(clause) || !/(?:全称|缩写|stands for)/iu.test(clause)) continue;
        for (const pair of pairs) {
            const normalized = clause.toLowerCase().replace(/\s+/gu, " ");
            const conflicting = pairs.some(other => other.abbreviation === pair.abbreviation && other.englishName.toLowerCase() !== pair.englishName.toLowerCase());
            if (!conflicting && new RegExp(`\\b${pair.abbreviation}\\b`, "u").test(clause)
                && normalized.includes(pair.englishName.toLowerCase())) {
                supported.push({ bodyText: clause, sourceId: pair.source.sourceId, quote: pair.source.excerpt });
                break;
            }
        }
    }
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
