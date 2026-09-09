import type {
    ReadWeaveEvidenceSource,
    ReadWeaveQuestionContract,
    ReadWeaveResearchAudit,
} from "@triliumnext/commons";

import { READWEAVE_RESEARCH_ACTION_LIMIT,ReadWeaveBudget } from "./readweave_budget.js";
import {
    READWEAVE_ORIGIN_ASSERTION,
    normalizeReadWeaveEvidenceText,
    readWeaveExplicitExpansions,
    readWeaveResearchSubject
} from "./readweave_evidence_quality.js";
import { readReadWeavePageWithJina, searchReadWeaveEvidence } from "./readweave_search.js";

export function readWeaveEvidenceWindow(text: string, question: string, limit = 1800): string {
    text = normalizeReadWeaveEvidenceText(text);
    if (text.length <= limit) return text;
    const terms = question.match(/[A-Za-z][A-Za-z0-9-]{2,}|[\p{Script=Han}]{2,6}/gu) ?? [];
    const cues = readWeaveNamingRequirements(question, false).includes("origin")
        ? READWEAVE_ORIGIN_ASSERTION
        : /stands for|abbreviation|acronym|全称/iu;
    const position = text.search(cues);
    const firstTerm =
        terms
            .map((term) => text.toLowerCase().indexOf(term.toLowerCase()))
            .find((index) => index >= 0) ?? 0;
    // A naming decision may refer back to the inspiration in the preceding
    // sentence. Keep that provenance, while preserving the same output cap.
    const start = Math.max(0, (position >= 0 ? position : firstTerm) - 800);
    return text.slice(start, start + limit);
}

/** A subject-owned-looking domain is a reading priority, not proof of ownership
 * or truth. Never award authority from a URL substring or a search snippet. */
function namingReadingPriority(source: ReadWeaveEvidenceSource, subject: string): number {
    if (!source.url || !/^[A-Za-z][A-Za-z0-9-]{2,60}$/u.test(subject)) return 0;
    const host = new URL(source.url).hostname.toLowerCase()
        .replace(/^(?:www|docs|developer)\./u, "");
    return host.split(".").length === 2 && host.split(".")[0] === subject.toLowerCase()
        ? 1 : 0;
}

export function readWeaveNamingRequirements(question: string, fallback = true): Array<"expansion" | "origin"> {
    const requested = question.split(/[，,；;。！？?\n]/u)
        .filter(clause => !/^\s*(?:请)?(?:不要|不用|无需|不必|禁止|不得|请勿|别|不(?:介绍|展开|讨论|解释|涉及|包含|添加))/u
            .test(clause)).join(" ");
    const requirements: Array<"expansion" | "origin"> = [];
    if (/全称|展开|缩写|acronym|abbreviation|full name|stands for/iu.test(requested)) requirements.push("expansion");
    if (/得名|命名|词源|名称.{0,12}(?:来历|来源)|从何而来|named after|etymology|name origin/iu.test(requested)) requirements.push("origin");
    return requirements.length || !fallback ? requirements : ["expansion", "origin"];
}

export function readWeaveMissingNamingFacts(sources: ReadWeaveEvidenceSource[], subject?: string, requirements: Array<"expansion" | "origin"> = ["expansion", "origin"]): string[] {
    // A naming cue for a different object must not terminate this object's
    // research. Keep the subject and the assertion in the same short passage.
    const text = sources.flatMap(s => s.excerpt.split(/(?<=[.!?。！？])\s+|\n/gu))
        .filter(passage => !subject || passage.toLocaleLowerCase().includes(subject.toLocaleLowerCase()))
        .join("\n");
    return [
        ...(!requirements.includes("expansion") || readWeaveExplicitExpansions(text).some(pair => !subject || pair.abbreviation.toLowerCase() === subject.toLowerCase()) || /stands for|abbreviation (?:of|for)|acronym (?:of|for)|全称(?:为|是)|(?:简称|缩写)(?:为|是)|不是缩写|not an acronym/iu.test(
            text,
        )
            ? []
            : ["正式展开或专名属性"]),
        ...(!requirements.includes("origin") || READWEAVE_ORIGIN_ASSERTION.test(
            text,
        )
            ? []
            : ["命名来历"]),
    ];
}

export async function researchReadWeaveEvidence(
    contract: ReadWeaveQuestionContract,
    context: string,
    searchBudgetCny: number,
    namingRequired: boolean,
    onStatus: (text: string) => void,
    signal?: AbortSignal,
    selectedSubject?: string,
) {
    const ledger = new ReadWeaveBudget(searchBudgetCny);
    const sources: ReadWeaveEvidenceSource[] = [];
    const warnings: string[] = [];
    const seenUrls = new Set<string>();
    const readUrls = new Set<string>();
    const seenQueries = new Set<string>();
    const subject = readWeaveResearchSubject(contract.normalizedQuestion, selectedSubject);
    const requirements = readWeaveNamingRequirements(contract.normalizedQuestion);
    const targeted = [
        ...(requirements.includes("expansion") ? [`"${subject}" full name official documentation`, `"${subject}" stands for acronym`] : []),
        ...(requirements.includes("origin") ? [`"${subject}" name origin official documentation`, `"${subject}" named after etymology`] : [])
    ];
    const queries = namingRequired ? [...targeted] : [...contract.searchQueries];
    const audit: ReadWeaveResearchAudit = {
        budgetCny: searchBudgetCny,
        searchCostCny: 0,
        queryCount: 0,
        pageReadCount: 0,
        cacheHits: 0,
        stopReason: "exhausted",
        queries: [],
        missingFacts: [],
    };
    if (namingRequired) queries.push(`"${subject}" ${requirements.includes("origin") ? "名称 来历" : "官方全称"}`);
    const started = Date.now();
    for (let index = 0; index < queries.length; index++) {
        signal?.throwIfAborted();
        if (
            audit.queryCount + audit.pageReadCount >= READWEAVE_RESEARCH_ACTION_LIMIT ||
            Date.now() - started > 60_000
        ) {
            audit.stopReason = "limit";
            break;
        }
        const query = queries[index].trim();
        if (!query || seenQueries.has(query.toLowerCase())) continue;
        seenQueries.add(query.toLowerCase());
        // Each adapter must fit this request allowance; the shared ledger is
        // debited before the next request. No paid calls run concurrently here.
        const allowance = Math.min(ledger.remainingCny, 0.009);
        if (allowance < 0.0072 && index > 0) {
            audit.stopReason = "budget";
            break;
        }
        onStatus(
            `正在查证第 ${audit.queryCount + 1} 个查询${index >= contract.searchQueries.length ? "，补充未确认事实" : ""}`,
        );
        let result: Awaited<ReturnType<typeof searchReadWeaveEvidence>>;
        try {
            result = await searchReadWeaveEvidence(
                {
                    query,
                    context: context.slice(0, 800),
                    force: true,
                    forcePaidFallback: true,
                    allowPaid: allowance >= 0.0072,
                    budgetCny: allowance,
                },
                { signal },
            );
        } catch (error) {
            signal?.throwIfAborted();
            // An uncertain request may be billable. Retain its reservation and
            // all earlier evidence; never reset the ledger after an exception.
            ledger.reserve(allowance);
            audit.searchCostCny += allowance;
            audit.queryCount++;
            audit.queries.push(query);
            warnings.push(error instanceof Error ? error.message : "搜索暂不可用");
            audit.stopReason = "unavailable";
            break;
        }
        ledger.reserve(result.searchCostCny);
        audit.searchCostCny += result.searchCostCny;
        audit.queries.push(query);
        if (result.cacheHit) audit.cacheHits++;
        else audit.queryCount++;
        warnings.push(...result.warnings);
        for (const source of result.sources) {
            if (seenUrls.has(source.url)) continue;
            seenUrls.add(source.url);
            sources.push({
                sourceId: `S${sources.length + 1}`,
                sourceType: "external",
                provider: source.provider,
                title: source.title,
                url: source.url,
                excerpt: source.snippet,
                publishedAt: source.publishedAt,
                accessedAt: new Date().toISOString(),
                sourceCategory: source.sourceCategory,
                evidenceFamily: source.evidenceFamily,
                retrievalMode: source.retrievalMode,
                originalRank: source.originalRank,
                rerankScore: source.score,
            });
        }
        // Read relevant public pages, not only biography pages. Anonymous Jina
        // basic Reader does not consume the user's paid tokens (20 RPM limit).
        const candidates = sources
            .filter((s) => s.url && !readUrls.has(s.url))
            .toSorted((a, b) => namingRequired
                ? namingReadingPriority(b, subject) - namingReadingPriority(a, subject)
                : 0)
            .slice(0, namingRequired ? 2 : 1);
        for (const source of candidates) {
            if (
                audit.pageReadCount >= 6 ||
                audit.queryCount + audit.pageReadCount >= READWEAVE_RESEARCH_ACTION_LIMIT
            )
                break;
            readUrls.add(source.url!);
            signal?.throwIfAborted();
            audit.pageReadCount++;
            try {
                const content = await readReadWeavePageWithJina(source.url!, {
                    signal,
                    anonymous: true,
                });
                if (content) {
                    source.excerpt = readWeaveEvidenceWindow(content, query);
                    source.retrievalMode = "page-reader";
                }
            } catch (error) {
                signal?.throwIfAborted();
                warnings.push(
                    `页面提取失败：${error instanceof Error ? error.message : "未知错误"}`,
                );
            }
        }
        audit.missingFacts = namingRequired ? readWeaveMissingNamingFacts(sources, subject, requirements) : [];
        if (sources.length && (!namingRequired || audit.missingFacts.length === 0)) {
            audit.stopReason = "sufficient";
            break;
        }
        if (namingRequired && index === targeted.length - 1) {
            for (const source of sources.slice(0, 6)) {
                if (!source.url) continue;
                queries.push(
                    `site:${new URL(source.url).hostname} "${subject}" ${requirements.includes("origin") ? "name origin" : "full name"}`,
                );
            }
        }
    }
    if (!sources.length && warnings.length && audit.stopReason === "exhausted")
        audit.stopReason = "unavailable";
    audit.searchCostCny = Number(audit.searchCostCny.toFixed(6));
    // Relevance windows containing the requested fact must survive the source
    // cap; a long first page must not consume the complete evidence budget.
    const selected = sources
        .toSorted(
            (a, b) =>
                Number(b.retrievalMode === "page-reader")
                    - Number(a.retrievalMode === "page-reader") ||
                (namingRequired
                    ? namingReadingPriority(b, subject) - namingReadingPriority(a, subject) : 0) ||
                Number(/stands for|named after|得名|全称/iu.test(b.excerpt)) -
                    Number(/stands for|named after|得名|全称/iu.test(a.excerpt)) ||
                (b.rerankScore ?? 0) - (a.rerankScore ?? 0),
        )
        .slice(0, 8);
    return {
        sources: selected,
        queries: audit.queries,
        providers: [...new Set(selected.map((s) => s.provider))],
        cacheHit: audit.queryCount === 0 && audit.cacheHits > 0,
        searchCostCny: audit.searchCostCny,
        warnings: [...new Set(warnings)],
        audit,
    };
}
