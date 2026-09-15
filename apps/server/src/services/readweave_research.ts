import type {
    ReadWeaveEvidenceSource,
    ReadWeaveQuestionContract,
    ReadWeaveResearchAudit,
} from "@triliumnext/commons";

import { ReadWeaveBudget } from "./readweave_budget.js";
import {
    READWEAVE_ORIGIN_ASSERTION,
    normalizeReadWeaveEvidenceText,
    readWeaveExplicitExpansions,
    readWeaveResearchSubject
} from "./readweave_evidence_quality.js";
import { readReadWeavePageWithJina, searchReadWeaveEvidence } from "./readweave_search.js";

export function readWeaveEvidenceWindow(text: string, question: string, _limit = 1800): string {
    const cleaned = text.normalize("NFC")
        .replace(/\[\[\d+\]\]\(https?:\/\/[^\s]*#cite_note[^\s]*\)/gu, "")
        .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s]*(?:\s+"[^"\n]*")?\)/gu, "$1")
        .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/gu, "$1")
        .replace(/(?<!\w)[*_]{1,2}|[*_]{1,2}(?!\w)/gu, "")
        .replace(/[‘’]/gu, "'")
        .replace(/[“”]/gu, '"')
        .replace(/[ \t]+/gu, " ")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
    if (!cleaned) return "";
    const person = requiresPersonIdentity(question);
    const subject = person
        ? question.match(/\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,5}\b/u)?.[0]
            ?? readWeaveResearchSubject(question)
        : readWeaveResearchSubject(question);
    const subjectTokens = Array.from(subject.toLocaleLowerCase()
        .matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’._-]{1,}/gu), match => match[0]);
    const queryTokens = Array.from(new Set(Array.from(question.toLocaleLowerCase()
        .matchAll(/[\p{L}\p{N}][\p{L}\p{N}+._\/-]{1,}/gu), match => match[0])
        .filter(token => !/^(?:what|who|when|where|why|how|is|are|the|and|or|official|profile|current|affiliation|researcher|是谁|什么|如何|为什么|官方|主页|大学|教授|研究方向)$/u.test(token))));
    const units = cleaned.split(/(?<=[.!?。！？；;])\s+|\n+/gu)
        .map(unit => unit.trim()).filter(Boolean);
    const wholeLower = cleaned.toLocaleLowerCase();
    const pageNamesSubject = subjectTokens.length > 0
        && subjectTokens.every(token => wholeLower.includes(token));
    const profileCue = /(?:现任|目前|任职|任教|教授|学者|研究者|科学家|工程师|讲席|主任|创始人|研究方向|工作领域|专注于|主要研究|贡献|数学家|作家|程序员|\bprofessor\b|\bresearcher\b|\bscientist\b|\bengineer\b|\bfaculty\b|\bdirector\b|\bfounder\b|\bresearch interests?\b|\bworks? (?:on|in|at)\b|\bknown for\b)/iu;
    const bibliographyOnly = /(?:^|\s)(?:references?|publications?|selected papers?|citations?)\s*[：:]?$|\bdoi\b|\bvol\.?\s*\d|\bpp\.?\s*\d|发表于|期刊|会议论文集|出版物列表/iu;
    const factCue = /(?:是指|是一个|是一种|用于|负责|通过|工作原理|机制|定义|表示|全称|缩写|得名|命名|stands for|named after|means|defined as|is a|refers to|works by|used for)/iu;
    const selected = units.filter(unit => {
        const lower = unit.toLocaleLowerCase();
        const namesSubject = subjectTokens.length > 0
            && subjectTokens.every(token => lower.includes(token));
        if (person) {
            if (bibliographyOnly.test(unit) && !profileCue.test(unit)) return false;
            return namesSubject || pageNamesSubject && profileCue.test(unit);
        }
        const overlap = queryTokens.some(token => lower.includes(token));
        return namesSubject || overlap && factCue.test(unit)
            || READWEAVE_ORIGIN_ASSERTION.test(unit)
            || /(?:inspiration|inspired|来源|灵感|缘由)/iu.test(unit)
            || /stands for|abbreviation (?:of|for)|acronym (?:of|for)|全称(?:为|是)|(?:简称|缩写)(?:为|是)/iu.test(unit);
    });
    if (selected.length === 0) return normalizeReadWeaveEvidenceText(cleaned);
    const seen = new Set<string>();
    return selected.filter(unit => {
        const fingerprint = normalizeReadWeaveEvidenceText(unit).toLocaleLowerCase();
        if (!fingerprint || seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
    }).join("\n");
}

function requiresPersonIdentity(question: string): boolean {
    return /(?:是谁|是何人|人物|个人简介|现任机构|任职)|\bwho\s+is\b|\bbiograph(?:y|ical)\b|\bcurrent affiliation\b/iu
        .test(question);
}

const PERSON_ROLE_PATTERN = /(?:教授|学者|研究者|科学家|工程师|任职|任教|院士|讲席|主任|创始人|数学家|作家|程序员|\bprofessor\b|\bresearcher\b|\bscientist\b|\bengineer\b|\bfaculty\b|\bdirector\b|\bfounder\b|\bmathematician\b|\bwriter\b)/iu;
const PERSON_EXPERTISE_PATTERN = /(?:专业领域|研究方向|研究领域|主要研究|从事[^。；\n]{0,80}研究|代表性工作|核心工作|贡献|电子设计自动化|集成电路物理设计|机器学习|人工智能|计算机视觉|计算机体系结构|嵌入式系统|微电子|先进封装|分析机|计算程序|\bresearch interests?\b|\bresearch (?:areas?|focus(?:es)?)\b|\bworks? (?:on|in)\b|\bknown for\b|\belectronic design automation\b|\bphysical design\b|\bmachine learning\b|\bartificial intelligence\b|\bcomputer vision\b|\bcomputer architecture\b|\bembedded systems?\b|\bmicroelectronics\b|\badvanced packaging\b|\banalytical engine\b|\bcomput(?:ing|ation|er programming)\b)/iu;

function personLatinAliasFromTitle(title: string): { fingerprint: string } | undefined {
    const leading = title.normalize("NFKC").split(/\s+(?:[|–—]|-\s)\s*|['’]s\b/iu)[0].trim();
    const display = leading.match(/^([A-Z][A-Za-z'’-]{1,}(?:[-\s]+[A-Z][A-Za-z'’-]{1,}){1,5})\b/u)?.[1];
    if (!display || /^(?:University|Institute|School|College|Department|Professor)\b/iu.test(display)) return undefined;
    const fingerprint = display.toLocaleLowerCase().replace(/[^a-z]+/gu, "");
    return fingerprint.length >= 5 ? { fingerprint } : undefined;
}

function personLatinAliasConsensus(sources: ReadWeaveEvidenceSource[], subject: string): Set<string> {
    if (!/^\p{Script=Han}{2,8}$/u.test(subject.trim())) return new Set<string>();
    const aliases = new Map<string, Set<string>>();
    for (const source of sources) {
        const alias = personLatinAliasFromTitle(source.title);
        if (!alias || !PERSON_ROLE_PATTERN.test(`${source.title}\n${source.excerpt}`)) continue;
        const sourceIds = aliases.get(alias.fingerprint) ?? new Set<string>();
        sourceIds.add(source.sourceId);
        aliases.set(alias.fingerprint, sourceIds);
    }
    return new Set([ ...aliases ].filter(([, sourceIds ]) => sourceIds.size >= 2)
        .map(([ fingerprint ]) => fingerprint));
}

function sourceNamesSubject(
    source: ReadWeaveEvidenceSource, subject: string, sources: ReadWeaveEvidenceSource[] = [ source ]
): boolean {
    const normalizedSubject = subject.normalize("NFKC").toLocaleLowerCase().trim();
    const latinTokens = Array.from(normalizedSubject.matchAll(/[a-z][a-z0-9'’._-]{1,}/gu), match => match[0]);
    const text = `${source.title}\n${source.excerpt}`.normalize("NFKC").toLocaleLowerCase();
    if (latinTokens.length > 0) return latinTokens.every(token => text.includes(token));
    const normalizedTitle = source.title.normalize("NFKC").toLocaleLowerCase();
    const leadingExcerpt = source.excerpt.normalize("NFKC").toLocaleLowerCase().slice(0, 600);
    const titleNamesAnotherPerson = Boolean(personLatinAliasFromTitle(source.title))
        || /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,5}\s*[（(]/u.test(source.title.normalize("NFKC"));
    return normalizedTitle.includes(normalizedSubject)
        || !titleNamesAnotherPerson
            && leadingExcerpt.indexOf(normalizedSubject) >= 0
            && leadingExcerpt.indexOf(normalizedSubject) <= 160
            && PERSON_ROLE_PATTERN.test(leadingExcerpt)
        || Boolean(personLatinAliasFromTitle(source.title)?.fingerprint
            && personLatinAliasConsensus(sources, subject).has(personLatinAliasFromTitle(source.title)?.fingerprint ?? ""));
}

function sourceSupportsPersonIdentity(
    source: ReadWeaveEvidenceSource, subject: string, sources: ReadWeaveEvidenceSource[] = [ source ]
): boolean {
    const text = `${source.title}\n${source.excerpt}`.normalize("NFKC").toLocaleLowerCase();
    return sourceNamesSubject(source, subject, sources) && PERSON_ROLE_PATTERN.test(text);
}

function sourceSupportsPersonExpertise(
    source: ReadWeaveEvidenceSource, subject: string, sources: ReadWeaveEvidenceSource[] = [ source ]
): boolean {
    const text = `${source.title}\n${source.excerpt}`.normalize("NFKC").toLocaleLowerCase();
    return sourceNamesSubject(source, subject, sources) && PERSON_EXPERTISE_PATTERN.test(text);
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
 * Keep every distinct safe subject-owned reference; semantic completion and
 * the request budget decide when research stops. */
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
    return [ ...references.values() ].toSorted((a,b)=>b.priority-a.priority)
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
    const subject = readWeaveResearchSubject(contract.normalizedQuestion, selectedSubject);
    const personIdentityRequired = requiresPersonIdentity(contract.normalizedQuestion);
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
        if (Date.now() - started > 60_000) {
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
                    context,
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
        const unread = sources.filter((source) => source.url && !readUrls.has(source.url));
        const bestScore = unread.reduce((best, source) => Math.max(best, source.rerankScore ?? 0), 0);
        const candidates = unread
            .filter(source => personIdentityRequired
                ? sourceNamesSubject(source, subject, sources)
                : namingRequired
                    ? true
                    : (source.rerankScore ?? 0) >= bestScore - 12)
            .toSorted((a, b) => personIdentityRequired
                ? Number(sourceSupportsPersonIdentity(b, subject, sources)) - Number(sourceSupportsPersonIdentity(a, subject, sources))
                    || Number(sourceSupportsPersonExpertise(b, subject, sources)) - Number(sourceSupportsPersonExpertise(a, subject, sources))
                    || (b.rerankScore ?? 0) - (a.rerankScore ?? 0)
                : namingRequired
                    ? namingReadingPriority(b, subject) - namingReadingPriority(a, subject)
                    : (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
        for (const source of candidates) {
            if (Date.now() - started > 60_000) break;
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
                    if (namingRequired && !completeDirect) {
                        for (const link of readWeaveNamingReferences(content, subject)
                            .filter(item => !readUrls.has(item.url))) {
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
                        }
                    }
                }
            } catch (error) {
                signal?.throwIfAborted();
                warnings.push(
                    `页面提取失败：${error instanceof Error ? error.message : "未知错误"}`,
                );
            }
            // One plausible profile is not enough to end page reading. Continue
            // through every relevant candidate that fits the shared time budget
            // so a stale university page cannot hide a newer first-party role.
        }
        audit.missingFacts = namingRequired ? readWeaveMissingNamingFacts(sources, subject, requirements) : [];
        const personIdentitySatisfied = !personIdentityRequired
            || sources.some(source => sourceSupportsPersonIdentity(source, subject, sources));
        const personExpertiseSatisfied = !personIdentityRequired
            || sources.some(source => sourceSupportsPersonExpertise(source, subject, sources));
        if (sources.length && personIdentitySatisfied && personExpertiseSatisfied
            && (!namingRequired || audit.missingFacts.length === 0)) {
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
            for (const source of sources) {
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
        );
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
