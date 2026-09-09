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
function namingReadingPriority(
    source: Pick<ReadWeaveEvidenceSource, "url">, subject: string
): number {
    if (!source.url || !/^[A-Za-z][A-Za-z0-9-]{2,60}$/u.test(subject)) return 0;
    const host = new URL(source.url).hostname.toLowerCase()
        .replace(/^(?:www|docs|developer)\./u, "");
    return host.split(".").length === 2 && host.split(".")[0] === subject.toLowerCase()
        ? 1 : 0;
}

/** A cited homepage/history page is a navigation lead, not authority by itself.
 * Read at most two such links per question, before stripping Markdown links. */
export function readWeaveNamingReferences(
    text: string, subject: string
): Array<{ title:string;url:string }> {
    const references = new Map<string, { title:string;url:string;priority:number }>();
    for (const match of text.matchAll(/\[([^\]\n]{1,160})\]\((https:\/\/[^\s)]+)\)/gu)) {
        try {
            const url = new URL(match[2]);
            if (url.username || url.password || url.port
                || !namingReadingPriority({ url:url.href }, subject)) continue;
            const title = match[1];
            const naming = /origin|name|etymology|history|得名|命名|来历|名称/u
                .test((title + " " + url.pathname).toLowerCase());
            if (!naming && url.pathname !== "/") continue;
            url.hash = "";
            references.set(url.href, { title,url:url.href,priority:Number(naming) });
        } catch {
            // Malformed or unrelated page links are not navigation targets.
        }
    }
    return [ ...references.values() ].toSorted((a,b)=>b.priority-a.priority).slice(0,2)
        .map(({ title,url })=>({ title,url }));
}

/** Give the writer a fact-focused reading order, not the search engine's rank.
 * The preferred passage is still evidence to attribute, not certified truth. */
export function readWeaveNamingSourceGuidance(
    sources: ReadWeaveEvidenceSource[], question: string, selected?: string
): string {
    const requirements = readWeaveNamingRequirements(question, false);
    if (!requirements.length) return "";
    const subject = readWeaveResearchSubject(question, selected);
    const complete = sources.filter(source => source.sourceType === "external"
        && source.retrievalMode === "page-reader"
        && readWeaveMissingNamingFacts([ source ], subject, requirements).length === 0)
        .toSorted((a, b) => namingReadingPriority(b, subject) - namingReadingPriority(a, subject));
    const first = complete[0];
    if (!first) return "";
    return `本题首读原文：[${first.sourceId}] ${first.title}。它已包含本题所需命名关系，先据此回答并引用；`
        + "不要因为其他来源的搜索排名更高而混写不同版本的年代和故事。其他来源仅补本题尚缺的明确事实；"
        + "若发现矛盾，分别归因，不拼成一个确定叙事。只问得名时，通常用一至两句说明来源和命名理由，"
        + "不要附带无关年份、机构简称、设备简称或履历。此阅读顺序不是独立事实核验结论";
}

/** For a narrow naming question, don't make a complete subject-site passage
 * compete with eight generic snippets. Keep the search catalogue separately. */
export function readWeaveWritingEvidence(
    sources: ReadWeaveEvidenceSource[], question: string, selected?: string
): ReadWeaveEvidenceSource[] {
    const requirements = readWeaveNamingRequirements(question, false);
    if (!requirements.length) return sources;
    const subject = readWeaveResearchSubject(question, selected);
    const requested = question.split(/[，,。；;！？?\n]/u).filter(clause =>
        !/^\s*(?:请)?(?:不要|不必|无需|不用|禁止|不得|不介绍|不展开)/u.test(clause)).join(" ");
    if (requirements.length === 1 && requirements[0] === "expansion"
        && !/原理|机制|运作|历史|用途|区别|比较|应用/u.test(requested)) {
        // One complete passage per distinct expansion, not eight copies of
        // the same full name. Conflicting expansions remain visible; the full
        // source catalogue is retained in the audit, without truncating quotes.
        const seen = new Set<string>();
        const knownNames = [ ...new Set(sources.flatMap(source =>
            readWeaveExplicitExpansions(source.excerpt)
                .filter(pair => pair.abbreviation.toLowerCase() === subject.toLowerCase())
                .map(pair => pair.englishName.toLowerCase().replace(/\s+/gu," ")))) ];
        const chosen = sources.filter(source => source.sourceType === "external")
            .toSorted((a,b) => Number(b.retrievalMode === "page-reader")
                - Number(a.retrievalMode === "page-reader")
                || namingReadingPriority(b,subject) - namingReadingPriority(a,subject))
            .filter(source => {
                const names = readWeaveExplicitExpansions(source.excerpt)
                    .filter(pair => pair.abbreviation.toLowerCase() === subject.toLowerCase())
                    .map(pair => pair.englishName.toLowerCase().replace(/\s+/gu," "));
                // A primary page can spell out the same name without brackets.
                // Do not drop it in favor of a bracket-shaped search snippet.
                const passages = source.excerpt.toLowerCase().split(/[.!?。！？\n]/u)
                    .filter(passage=>passage.includes(subject.toLowerCase()));
                names.push(...knownNames.filter(name=>passages.some(passage=>
                    passage.replace(/\s+/gu," ").includes(name))));
                if (!names.some(name => !seen.has(name))) return false;
                names.forEach(name => seen.add(name));
                return true;
            });
        if (chosen.length) return [
            ...sources.filter(source => source.sourceType === "local"), ...chosen
        ];
    }
    const preferred = sources.filter(source => source.sourceType === "external"
        && source.retrievalMode === "page-reader" && namingReadingPriority(source, subject) > 0
        && !readWeaveMissingNamingFacts([ source ], subject, requirements).length);
    if (!preferred.length) return sources;
    return sources.filter(source => source.sourceType === "local" || preferred.includes(source));
}

export function readWeaveNamingRequirements(question: string, fallback = true): Array<"expansion" | "origin"> {
    const requested = question.split(/[，,；;。！？?\n]/u)
        .filter(clause => !/^\s*(?:请)?(?:不要|不用|无需|不必|禁止|不得|请勿|别|不(?:介绍|展开|讨论|解释|涉及|包含|添加))/u
            .test(clause)).join(" ");
    const requirements: Array<"expansion" | "origin"> = [];
    if (/全称|展开|缩写|acronym|abbreviation|full name|stands for/iu.test(requested)) requirements.push("expansion");
    const originIntent = /得名|命名|词源|名称.{0,12}(?:来历|来源)|从何而来|named after|etymology|name origin/iu;
    if (originIntent.test(requested) || /origin of (?:the )?name/iu.test(requested))
        requirements.push("origin");
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
    let followedReferences = 0;
    const subject = readWeaveResearchSubject(contract.normalizedQuestion, selectedSubject);
    const requirements = readWeaveNamingRequirements(contract.normalizedQuestion);
    const originSubject = /\s/u.test(subject) ? `"${subject}"` : subject;
    const targeted = [
        ...(requirements.includes("expansion") ? [`"${subject}" full name official documentation`, `"${subject}" stands for acronym`] : []),
        // Keep the user's fact dimension, not an assumed document type. Adding
        // "official documentation" can exclude the owner's naming/history page.
        ...(requirements.includes("origin")
            ? [ `${originSubject} origin of name official primary source`,
                `"${subject}" named after etymology` ] : [])
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
                audit.queryCount + audit.pageReadCount >= READWEAVE_RESEARCH_ACTION_LIMIT ||
                Date.now() - started > 60_000
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
                    const completeDirect = namingReadingPriority(source, subject) > 0
                        && !readWeaveMissingNamingFacts([ source ], subject, requirements).length;
                    if (namingRequired && !completeDirect && followedReferences < 2) {
                        const link = readWeaveNamingReferences(content, subject)
                            .find(item => !readUrls.has(item.url));
                        if (link) {
                            let reference = sources.find(item => item.url === link.url);
                            if (!reference) {
                                reference = {
                                    sourceId:`S${sources.length+1}`,sourceType:"external",
                                    provider:"页面引文",title:link.title,url:link.url,excerpt:"",
                                    accessedAt:new Date().toISOString(),
                                    sourceCategory:"search-result",
                                    evidenceFamily:"SEARCH"
                                };
                                sources.push(reference);
                                seenUrls.add(link.url);
                            }
                            const queued = candidates.indexOf(reference);
                            if (queued >= 0) candidates.splice(queued,1);
                            candidates.splice(candidates.indexOf(source)+1,0,reference);
                            followedReferences++;
                        }
                    }
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
            const completeReads = sources.filter(source => source.retrievalMode === "page-reader"
                && !readWeaveMissingNamingFacts([ source ], subject, requirements).length);
            if (namingRequired && requirements.includes("origin") && index === 0
                && completeReads.length
                && completeReads.every(source => source.sourceCategory === "secondary")
                && ledger.remainingCny >= 0.0072) {
                // A fallback encyclopedia is useful, but not a reason to stop
                // before one bounded search for the subject's direct account.
                onStatus("已找到二手资料，再补查一次名称的直接来源");
                continue;
            }
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
