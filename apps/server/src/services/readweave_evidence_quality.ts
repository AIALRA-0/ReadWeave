import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

export interface ReadWeaveNamingEvidence {
    bodyText: string;
    sourceId: string;
    quote: string;
}

export const READWEAVE_ORIGIN_ASSERTION = new RegExp([
    "named (?:after|for)|name (?:comes|derives)|(?:decided|chose) to (?:call|name)",
    "(?:chose|chosen).{0,60}(?:name|title)|name.{0,60}(?:chosen|inspired|taken)",
    "name.{0,50}dates back|(?:suggested|proposed).{0,100}(?:code name|name)|earned.{0,50}nickname",
    "(?:名称|名字|词源).{0,40}(?:源于|源自|来自|来源|意为|暗示)|(?<!可)以.{0,60}(?:命名|为名)",
    "(?:命名|得名)(?:于|自)|命名.{0,30}(?:源于|来自|纪念)",
    "名称.{0,20}(?:与.{0,40}无关|不是|并非)"
].join("|"), "iu");
const NAMING_ASSERTION = new RegExp([
    READWEAVE_ORIGIN_ASSERTION.source,
    "(?:缩写|全称).{0,40}(?:是|为|展开|表示)",
    "not an acronym|not an abbreviation|doesn't stand for|(?:不是|并非)缩写",
    "[A-Za-z][\\w-]*.{0,20}(?:是|为).{0,160}(?:缩写|首字母)|stands for|acronym for"
].join("|"), "iu");
const GUESS =
    /可能|大概|或许|似乎|暗示|猜测|推测|未.{0,12}(?:明确|给出|提供|确认)|无法确认|具体展开|perhaps|probably|might|may derive/iu;

/** Compare visible quotations, not Markdown link destinations or typography.
 * Words, accents, numbers and word order remain significant. */
export function normalizeReadWeaveEvidenceText(text: string): string {
    return text.normalize("NFC")
        .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s]*(?:\s+"[^"\n]*")?\)/gu, "$1")
        .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/gu, "$1")
        .replace(/(?<!\w)[*_]{1,2}|[*_]{1,2}(?!\w)/gu, "")
        .replace(/[‘’]/gu, "'")
        .replace(/[“”]/gu, '"')
        .replace(/\s+/gu, " ").trim();
}

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
    const rawEntries: Partial<ReadWeaveNamingEvidence>[] = Array.isArray(evidence) ? evidence : [];
    const entries = rawEntries
        .map(entry => {
            if (typeof entry?.quote !== "string") return entry;
            const quote = normalizeReadWeaveEvidenceText(entry.quote);
            if (NAMING_ASSERTION.test(quote)) return entry;
            const excerpt = normalizeReadWeaveEvidenceText(
                sources.find(source => source.sourceId === entry.sourceId)?.excerpt ?? ""
            );
            const start = excerpt.indexOf(quote);
            if (quote.length < 12 || start < 0 || start !== excerpt.lastIndexOf(quote))
                return entry;
            // Writers sometimes quote the inspiration but omit the immediately
            // following naming decision. Complete that one contiguous sentence
            // from the actual source, never search another section for a cue.
            const next = excerpt.slice(start + quote.length)
                .match(/^(?:[.!?](?=\s|$))?\s*([^#\n]{1,240}?(?:[.!?](?=\s|$)|$))/u)?.[0];
            return next && NAMING_ASSERTION.test(next)
                ? { ...entry, quote: quote + next } : entry;
        });
    const diagnostics: string[] = [];
    const supported = entries.filter((entry) => {
        if (
            typeof entry?.bodyText !== "string" ||
            typeof entry.sourceId !== "string" ||
            typeof entry.quote !== "string"
        )
            return false;
        const source = sources.find((s) => s.sourceId === entry.sourceId);
        const quote = normalizeReadWeaveEvidenceText(entry.quote);
        const assertion = normalizeReadWeaveEvidenceText(entry.bodyText);
        const namedWords = /[\p{Script=Latin}][\p{Script=Latin}\p{M}0-9-]*/gu;
        const quoteWords = new Set(quote.toLowerCase().match(namedWords) ?? []);
        const assertedWords = assertion.toLowerCase().match(namedWords) ?? [];
        // A quote about another named entity or another English expansion
        // cannot support this sentence merely because it is a real quote.
        const sameNamedWords = assertedWords.every(word => quoteWords.has(word));
        const quotedNumbers = new Set(quote.match(/\d+(?:\.\d+)?/gu) ?? []);
        const sameNumbers = (assertion.match(/\d+(?:\.\d+)?/gu) ?? [])
            .every(number => quotedNumbers.has(number));
        const reasons = [
            ...(!sameNamedWords ? [ `引用缺少英文名称：${assertedWords.filter(word =>
                !quoteWords.has(word)).join("、")}` ] : []),
            ...(!sameNumbers ? [ "引用没有覆盖正文的数字，不得把推算的年代写成原文事实" ] : []),
            ...(quote.length < 12 ? [ "引用过短" ] : []),
            ...(!normalizeReadWeaveEvidenceText(body).includes(assertion)
                ? [ "bodyText 与正文不匹配" ] : []),
            ...(!source || !normalizeReadWeaveEvidenceText(source.excerpt).includes(quote)
                ? [ "quote 并非该来源的连续原文" ] : []),
            ...(GUESS.test(assertion) || GUESS.test(quote) ? [ "正文或引用含猜测" ] : []),
            ...(!NAMING_ASSERTION.test(quote) && !readWeaveExplicitExpansions(quote).length
                ? [ "引用未包含明确命名或全称关系" ] : [])
        ];
        if (reasons.length) diagnostics.push(`${entry.sourceId}：${reasons.join("；")}`);
        return reasons.length === 0;
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
            // A new subject immediately after a comma can be an independent
            // naming clause. Never cut at a noun inside "提出了这一名称".
            const boundary = text.match(/[，,]\s*(?=(?:其)?(?:名称|名字|词源|缩写|全称))/u);
            return boundary?.index !== undefined
                && !NAMING_ASSERTION.test(text.slice(0, boundary.index))
                ? text.slice(boundary.index + boundary[0].length) : text;
        })
        .filter(
            (text) =>
                NAMING_ASSERTION.test(text) &&
                (!supported.some(
                    (entry) => {
                        const assertion = normalizeReadWeaveEvidenceText(entry.bodyText ?? "")
                            .replace(/[。；;！？!?]+$/u, "");
                        const clause = normalizeReadWeaveEvidenceText(text)
                            .replace(/[。；;！？!?]+$/u, "");
                        return assertion && (assertion === clause || assertion.includes(clause));
                    }
                ) ||
                    GUESS.test(text)),
        );
    return { supported, issues, diagnostics };
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

/** One bounded batch of exact sentence patches, never a second whole writer. */
export async function repairReadWeaveNamingEvidence(
    original: string,
    evidence: unknown,
    sources: ReadWeaveEvidenceSource[],
    repair: (fragments: string[], diagnostics: string[]) => Promise<unknown>,
    signal?: AbortSignal
) {
    const entries = Array.isArray(evidence) ? [ ...evidence ] : [];
    const initial = checkReadWeaveNamingEvidence(original, entries, sources);
    const fragments = initial.issues.filter(text => text.length <= 600
        && original.indexOf(text) === original.lastIndexOf(text)).slice(0, 2);
    let body = original;
    let rounds = 0;
    const warnings: string[] = [];
    if (fragments.length) {
        signal?.throwIfAborted();
        rounds++;
        try {
            const patches = await repair(fragments, initial.diagnostics);
            signal?.throwIfAborted();
            if (!Array.isArray(patches) || patches.length > fragments.length)
                throw new Error("局部证据修复的补丁数量无效");
            const seen = new Set<string>();
            // Validate the complete batch before applying any patch.
            const accepted: Array<{
                original: string; replacement: string; evidence: unknown[]
            }> = [];
            for (const patch of patches) {
                if (!patch || typeof patch.original !== "string"
                    || !fragments.includes(patch.original) || seen.has(patch.original)
                    || typeof patch.replacement !== "string" || !patch.replacement.trim()
                    || patch.replacement.length > Math.max(patch.original.length * 2, 400))
                    throw new Error("局部证据修复超出原句范围");
                const checked = checkReadWeaveNamingEvidence(
                    patch.replacement, patch.namingEvidence, sources
                );
                const full = normalizeReadWeaveEvidenceText(patch.replacement)
                    .replace(/[。；;！？!?]+$/u, "");
                if (checked.issues.length || !checked.supported.some(entry =>
                    normalizeReadWeaveEvidenceText(entry.bodyText ?? "")
                        .replace(/[。；;！？!?]+$/u, "") === full))
                    throw new Error(`局部证据修复未通过：${checked.diagnostics.join("；")
                        || "未绑定完整原句和直接依据"}`);
                seen.add(patch.original);
                accepted.push({ ...patch, evidence: checked.supported });
            }
            // Original offsets prevent a replacement from changing the target
            // of a later patch; non-patched bytes remain exactly unchanged.
            for (const patch of accepted.toSorted((a, b) =>
                original.indexOf(b.original) - original.indexOf(a.original))) {
                const start = original.indexOf(patch.original);
                body = body.slice(0, start) + patch.replacement
                    + body.slice(start + patch.original.length);
                entries.push(...patch.evidence);
            }
        } catch (error) {
            signal?.throwIfAborted();
            warnings.push(error instanceof Error ? error.message : "局部证据修复未应用");
        }
    }
    return { body, check: checkReadWeaveNamingEvidence(body, entries, sources), rounds, warnings,
        removed: initial.issues.filter(text => !body.includes(text)) };
}
