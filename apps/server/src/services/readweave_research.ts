import type {
    ReadWeaveEvidenceSource,
    ReadWeaveQuestionContract,
    ReadWeaveResearchAudit,
} from "@triliumnext/commons";

import { READWEAVE_RESEARCH_ACTION_LIMIT,ReadWeaveBudget } from "./readweave_budget.js";
import { readReadWeavePageWithJina, searchReadWeaveEvidence } from "./readweave_search.js";

export function readWeaveEvidenceWindow(text: string, question: string, limit = 1800): string {
    if (text.length <= limit) return text;
    const terms = question.match(/[A-Za-z][A-Za-z0-9-]{2,}|[\p{Script=Han}]{2,6}/gu) ?? [];
    const cues =
        /stands for|named (?:after|for)|name (?:comes|derives)|abbreviation|acronym|得名|命名|全称|词源/iu;
    const position = text.search(cues);
    const firstTerm =
        terms
            .map((term) => text.toLowerCase().indexOf(term.toLowerCase()))
            .find((index) => index >= 0) ?? 0;
    const start = Math.max(0, (position >= 0 ? position : firstTerm) - 240);
    return text.slice(start, start + limit);
}

export function readWeaveMissingNamingFacts(sources: ReadWeaveEvidenceSource[], subject?: string): string[] {
    // A naming cue for a different object must not terminate this object's
    // research. Keep the subject and the assertion in the same short passage.
    const text = sources.flatMap(s => s.excerpt.split(/(?<=[.!?。！？])\s+|\n/gu))
        .filter(passage => !subject || passage.toLocaleLowerCase().includes(subject.toLocaleLowerCase()))
        .join("\n");
    return [
        ...(/stands for|abbreviation (?:of|for)|acronym (?:of|for)|全称(?:为|是)|(?:简称|缩写)(?:为|是)|不是缩写|not an acronym/iu.test(
            text,
        )
            ? []
            : ["正式展开或专名属性"]),
        ...(/named (?:after|for)|name (?:comes|derives)|得名|命名.{0,30}(?:源于|来自|纪念)|词源/iu.test(
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
) {
    const ledger = new ReadWeaveBudget(searchBudgetCny);
    const sources: ReadWeaveEvidenceSource[] = [];
    const warnings: string[] = [];
    const seenUrls = new Set<string>();
    const readUrls = new Set<string>();
    const seenQueries = new Set<string>();
    const subject =
        contract.normalizedQuestion.match(/[“"]([^”"]+)[”"]/u)?.[1] ??
        contract.normalizedQuestion.replace(/[？?]/gu, "");
    const queries = [...contract.searchQueries];
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
    if (namingRequired)
        queries.push(
            `"${subject}" official documentation name origin`,
            `"${subject}" stands for acronym`,
            `"${subject}" named after etymology`,
            `"${subject}" original paper naming`,
            `"${subject}" 名称 来历 全称`,
        );
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
        audit.missingFacts = namingRequired ? readWeaveMissingNamingFacts(sources, subject) : [];
        if (sources.length && (!namingRequired || audit.missingFacts.length === 0)) {
            audit.stopReason = "sufficient";
            break;
        }
        if (namingRequired && index === contract.searchQueries.length - 1) {
            for (const source of sources.slice(0, 6)) {
                if (!source.url) continue;
                queries.push(
                    `site:${new URL(source.url).hostname} "${subject}" name origin acronym`,
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
