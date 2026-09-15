import type {
    ReadWeaveEvidenceSource,
    ReadWeaveQuestionContract,
    ReadWeaveResearchAudit,
} from "@triliumnext/commons";

import { READWEAVE_RESEARCH_ACTION_LIMIT, ReadWeaveBudget } from "./readweave_budget.js";
import {
    normalizeReadWeaveEvidenceText,
    READWEAVE_ORIGIN_ASSERTION,
    readWeaveExplicitExpansions,
    readWeaveResearchSubject
} from "./readweave_evidence_quality.js";
import {
    readWeaveNeedQueries,     type ReadWeaveNeedQuery, type ReadWeaveNeedResearch,
    scheduleReadWeaveNeeds} from "./readweave_need_scheduler.js";
import { readReadWeavePageWithJina, searchReadWeaveEvidence } from "./readweave_search.js";

export interface ReadWeaveResearchSource extends ReadWeaveEvidenceSource {
    needIds: string[];
    queries: string[];
    access: "snippet" | "excerpt";
    pageReadStatus: "pending" | "read" | "empty" | "failed";
    requestedFragment?: string;
}

/** Extract user-supplied HTTP(S) URLs without swallowing adjacent Chinese prose.
 * The scan stops at CJK sentence/list punctuation; trailing ASCII prose
 * delimiters are removed after parsing while valid URL-internal punctuation is
 * otherwise preserved. */
export function readWeaveExplicitUrls(text: string): string[] {
    return Array.from(new Set(Array.from(
        text.matchAll(/https?:\/\/[^\s<>"“”‘’，。；、！？（）【】《》]+/giu),
        match => match[0].replace(/[,.!?;:）)\]}]+$/u, "")
    ).filter(raw => {
        try {
            const url = new URL(raw);
            return [ "https:", "http:" ].includes(url.protocol) && !url.username && !url.password;
        } catch { return false; }
    })));
}

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
        .matchAll(/[\p{L}\p{N}][\p{L}\p{N}+._/-]{1,}/gu), match => match[0])
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
                .test((`${title  } ${  url.pathname}`).toLowerCase());
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

const PAGE_FOCUS_STOP_WORDS = new Set([
    "about", "and", "documentation", "for", "from", "official", "page", "source", "that", "the", "this", "what", "when", "which", "with"
]);

function pageFocusTokens(text: string): Set<string> {
    return new Set([
        ...Array.from(text.toLocaleLowerCase().matchAll(/[a-z][a-z0-9+._/-]{2,}/gu), match => match[0])
            .filter(token => !PAGE_FOCUS_STOP_WORDS.has(token)),
        ...Array.from(text.matchAll(/[\p{Script=Han}]{2,12}/gu), match => match[0])
    ]);
}

/** Resolve an explicitly requested Markdown heading to its complete section.
 * The fragment is user-owned scope, so it takes precedence over lexical
 * relevance and does not depend on a model-generated translation or query. */
export function scopeReadWeavePageFragment(content: string, requestedFragment?: string): string | undefined {
    if (!requestedFragment?.trim()) return undefined;
    const sectionNumber = requestedFragment.match(/(?:section[\s_-]*)?(\d+(?:\.\d+)*)/iu)?.[1];
    const headings = Array.from(content.matchAll(/^(#{1,6})[ \t]+(.+)$/gmu)).map(match => ({
        start: match.index!, level: match[1].length, title: match[2].trim()
    }));
    // Some reader outputs represent a heading as `Title` followed by a bare
    // `#` line. Preserve that structural dialect instead of flattening it or
    // depending on English query terms to rediscover the section.
    const lines = Array.from(content.matchAll(/^([^\n]*)$/gmu));
    for (let index = 0; index + 1 < lines.length; index++) {
        const title = lines[index][1].trim();
        if (!title || title === "#" || lines[index + 1][1].trim() !== "#") continue;
        headings.push({ start: lines[index].index!, level: 6, title });
    }
    // RFCs and many standards readers expose complete plain-text structure
    // without Markdown markers, for example `9.2.2. Idempotent Methods`.
    // Number depth supplies the same parent/child boundary as heading level.
    if (sectionNumber) {
        for (const match of content.matchAll(/^(\d+(?:\.\d+)+)\.?[ \t]+(.+)$/gmu)) {
            headings.push({
                start: match.index!,
                level: match[1].split(".").length,
                title: `${match[1]} ${match[2].trim()}`
            });
        }
    }
    headings.sort((left, right) => left.start - right.start || left.level - right.level);
    if (headings.length === 0) return undefined;
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
        .replace(/^section/u, "");
    const fragmentKey = normalize(requestedFragment);
    if (!fragmentKey) return undefined;
    const ranges: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < headings.length; index++) {
        const heading = headings[index];
        const titleKey = normalize(heading.title);
        const exactSection = sectionNumber
            ? new RegExp(`^(?:section\\s*)?${sectionNumber.replace(/\./gu, "\\s*[._-]?\\s*")}(?!\\d)`, "iu").test(heading.title)
            : false;
        // A short parent heading such as "2" must never match the requested
        // fragment "section-9.2.2" merely because the fragment contains that
        // digit. The heading may contain a descriptive suffix, but it must own
        // the complete fragment key or exact section number.
        if (!exactSection && !titleKey.includes(fragmentKey)) continue;
        let end = content.length;
        for (let next = index + 1; next < headings.length; next++) {
            if (headings[next].level <= heading.level) {
                end = headings[next].start;
                break;
            }
        }
        ranges.push({ start: heading.start, end });
    }
    if (ranges.length === 0) return undefined;
    return ranges.map(range => content.slice(range.start, range.end).trim()).filter(Boolean).join("\n\n");
}

/**
 * Extract every question-bearing passage from a complete page.  Selection is
 * based on all positions and discriminating terms, never source rank or an
 * initial character window.  Adjacent units are retained so conditions and
 * exceptions are not detached from the matching sentence.
 */
export function extractReadWeavePageEvidence(
    content: string,
    focus: string,
    fallback: string,
    requestedFragment?: string
): string {
    const explicitSection = scopeReadWeavePageFragment(content, requestedFragment);
    if (explicitSection) return explicitSection;
    const units = content
        .normalize("NFKC")
        .split(/\n+|(?<=[。！？；])|(?<=[.!?;])\s+/u)
        .map(unit => unit.replace(/\s+/gu, " ").trim())
        .filter(Boolean);
    const focusTokens = pageFocusTokens(focus);
    if (units.length === 0 || focusTokens.size === 0) return fallback.trim();
    const frequencies = new Map<string, number>();
    const unitTokens = units.map(unit => pageFocusTokens(unit));
    for (const tokens of unitTokens) {
        for (const token of focusTokens) {
            if (tokens.has(token)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
        }
    }
    const commonThreshold = Math.max(3, Math.ceil(units.length * 0.15));
    const discriminating = new Set(Array.from(focusTokens).filter(token => {
        const frequency = frequencies.get(token) ?? 0;
        return frequency > 0 && frequency <= commonThreshold;
    }));
    const activeTokens = discriminating.size > 0 ? discriminating : focusTokens;
    const matched = unitTokens.map(tokens => Array.from(activeTokens).filter(token => tokens.has(token)).length);
    let indexes = matched.flatMap((score, index) => score > 0 ? [ index ] : []);
    if (indexes.length === 0) {
        const best = Math.max(...unitTokens.map(tokens => Array.from(focusTokens).filter(token => tokens.has(token)).length));
        if (best > 0) indexes = matched.flatMap((_score, index) =>
            Array.from(focusTokens).filter(token => unitTokens[index].has(token)).length === best ? [ index ] : []);
    }
    if (indexes.length === 0) return fallback.trim();
    const retained = new Set<number>();
    for (const index of indexes) {
        if (index > 0) retained.add(index - 1);
        retained.add(index);
        if (index + 1 < units.length) retained.add(index + 1);
    }
    return Array.from(retained).toSorted((left, right) => left - right).map(index => units[index]).join("\n");
}

export async function researchReadWeaveEvidence(
    contract: ReadWeaveQuestionContract,
    context: string,
    searchBudgetCny: number,
    _namingRequired: boolean,
    onStatus: (text: string) => void,
    signal?: AbortSignal,
    _selectedSubject?: string,
) {
    signal?.throwIfAborted();
    const budgetCny = Number.isFinite(searchBudgetCny) ? Math.max(0, searchBudgetCny) : 0;
    const ledger = new ReadWeaveBudget(budgetCny);
    const sources: ReadWeaveResearchSource[] = [];
    const warnings: string[] = [];
    const needs = scheduleReadWeaveNeeds(contract);
    const audit: ReadWeaveResearchAudit & { needs: ReadWeaveNeedResearch[]; unsettledCostCny: number } = {
        budgetCny, searchCostCny: 0, unsettledCostCny: 0, queryCount: 0, pageReadCount: 0,
        cacheHits: 0, stopReason: "exhausted", queries: [], missingFacts: [], needs
    };
    const taskContract = contract.taskContract;
    const policy = taskContract?.policy;
    const disabled = () => contract.externalSearchDecision?.mode === "disabled"
        || taskContract?.request.options.externalSearch === "off"
        || policy?.permissions.externalSearch === "off";
    const deadline = Math.min(Date.now() + 60_000,
        policy ? Date.parse(policy.budget.deadlineAt) : Infinity);
    const countLimit = (value: number | undefined) =>
        value === undefined ? Infinity : Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const searchLimit = countLimit(policy?.budget.maxSearchRequests);
    const pageLimit = countLimit(policy?.budget.maxPageFetches);
    const actionLimit = Math.min(READWEAVE_RESEARCH_ACTION_LIMIT, countLimit(policy?.budget.maxToolCalls));
    const queryResults = new Map<string, ReadWeaveNeedQuery>();
    const byUrl = new Map<string, ReadWeaveResearchSource>();
    const explicitlySuppliedSourceIds = new Set<string>();
    // A URL explicitly supplied by the user is evidence scope, not merely a
    // search hint. Seed it into the same read-and-audit path so the primary
    // page is fetched even when a search engine ranks another page first.
    for (const raw of readWeaveExplicitUrls(`${contract.normalizedQuestion}\n${context}`)) {
        try {
            const url = new URL(raw);
            if (![ "https:", "http:" ].includes(url.protocol) || url.username || url.password) continue;
            const requestedFragment = (() => {
                try { return decodeURIComponent(url.hash.slice(1)).replace(/[-_]+/gu, " ").trim(); }
                catch { return url.hash.slice(1).replace(/[-_]+/gu, " ").trim(); }
            })();
            url.hash = "";
            if (byUrl.has(url.href)) continue;
            const source: ReadWeaveResearchSource = {
                sourceId: `S${sources.length + 1}`,
                sourceType: "external",
                provider: "User-specified source",
                title: `${url.hostname}${url.pathname}`,
                url: url.href,
                excerpt: `用户明确指定的一手页面：${url.href}`,
                accessedAt: new Date().toISOString(),
                sourceCategory: "search-result",
                evidenceFamily: "SEARCH",
                retrievalMode: "raw-serp",
                needIds: needs.map(need => need.id),
                queries: [],
                access: "snippet",
                pageReadStatus: "pending",
                requestedFragment: requestedFragment || undefined
            };
            sources.push(source);
            byUrl.set(url.href, source);
            explicitlySuppliedSourceIds.add(source.sourceId);
            for (const need of needs) if (!need.sourceIds.includes(source.sourceId)) need.sourceIds.push(source.sourceId);
        } catch {
            // Invalid URLs remain ordinary untrusted context and are never fetched.
        }
    }
    let searchAttempts = 0;
    let globalStop: ReadWeaveResearchAudit["stopReason"] | undefined;
    const canAct = () => {
        signal?.throwIfAborted();
        if (disabled()) globalStop = "disabled";
        else if (!Number.isFinite(deadline) || Date.now() >= deadline
            || searchAttempts + audit.pageReadCount >= actionLimit) globalStop = "limit";
        return !globalStop;
    };
    const associate = (need: ReadWeaveNeedResearch, query: ReadWeaveNeedQuery) => {
        for (const sourceId of query.sourceIds) {
            if (!need.sourceIds.includes(sourceId)) need.sourceIds.push(sourceId);
            const source = sources.find(item => item.sourceId === sourceId)!;
            if (!source.needIds.includes(need.id)) source.needIds.push(need.id);
            if (!source.queries.includes(query.query)) source.queries.push(query.query);
        }
    };

    const proposal = taskContract?.interpretation.proposal;
    const resourceHintsFor = (need: ReadWeaveNeedResearch): string[] =>
        proposal?.subjects?.some(subject => subject.kindHints.includes("person")
            && need.subjectIds.includes(subject.id)
            && proposal.tasks.some(task => need.taskIds.includes(task.id)
                && task.subjectIds?.includes(subject.id))) ? ["person"] : [];

    // Unknown task edges are serialized. Shared tasks and transitive dependencies
    // cannot be treated as independent just because need IDs differ.
    const taskClosure = (need: ReadWeaveNeedResearch): Set<string> | undefined => {
        if (!need.taskIds.length) return undefined;
        const ids = new Set<string>();
        const pending = [...need.taskIds];
        while (pending.length) {
            const id = pending.pop()!;
            if (ids.has(id)) continue;
            const task = proposal?.tasks.find(item => item.id === id);
            if (!task || !Array.isArray(task.dependsOnTaskIds)) return undefined;
            ids.add(id);
            pending.push(...task.dependsOnTaskIds);
        }
        return ids;
    };
    const independent = (left: ReadWeaveNeedResearch, right: ReadWeaveNeedResearch) => {
        if (left.id === right.id) return false;
        const a = taskClosure(left), b = taskClosure(right);
        return !!a && !!b && [...a].every(id => !b.has(id));
    };
    // A URL supplied in the question/context is already the requested search
    // scope. Read that page first and do not also buy a broad SERP for the same
    // needs. The direct page remains external retrieval and goes through the
    // same gateway, extraction and evidence audit.
    const allNeedsHaveExplicitSource = needs.length > 0 && needs.every(need =>
        need.sourceIds.some(sourceId => explicitlySuppliedSourceIds.has(sourceId))
    );
    const scheduled = allNeedsHaveExplicitSource ? [] : [...readWeaveNeedQueries(needs)];
    let cursor = 0;
    while (cursor < scheduled.length) {
        const batch: Array<{
            need: ReadWeaveNeedResearch; query: ReadWeaveNeedQuery;
            resourceHints: string[]; allowance: number; receipt: number; started: boolean;
        }> = [];
        while (cursor < scheduled.length && batch.length < 2) {
            if (!canAct()) break;
            const { need, query } = scheduled[cursor];
            const resourceHints = resourceHintsFor(need);
            const key = JSON.stringify([query.query.toLocaleLowerCase(), resourceHints]);
            const previous = queryResults.get(key);
            if (previous) {
                if (previous.status === "pending") break;
                Object.assign(query, previous, { query: query.query, sourceIds: [...previous.sourceIds], reused: true });
                associate(need, query);
                cursor++;
                continue;
            }
            if (batch.some(item => !independent(item.need, need))) break;
            if (searchAttempts + batch.length >= searchLimit
                || searchAttempts + audit.pageReadCount + batch.length >= actionLimit) {
                audit.stopReason = "limit";
                break;
            }
            const allowance = Math.min(ledger.remainingCny, 0.009);
            // In-flight reservations may settle below their upper bounds. Wait
            // before declaring budget exhaustion; never reuse pending money.
            if (allowance < 0.0072 && searchAttempts + batch.length > 0) {
                if (!batch.length) audit.stopReason = "budget";
                break;
            }
            const receipt = ledger.reserveResourceRequest(allowance);
            if (receipt === undefined) { audit.stopReason = "budget"; break; }
            queryResults.set(key, query);
            batch.push({ need, query, resourceHints, allowance, receipt, started: false });
            cursor++;
        }
        if (!batch.length) break;
        // Reserve every allowance atomically before starting any adapter. Drain
        // every launched call even on cancellation, leaving no detached requests.
        const outcomes = await Promise.allSettled(batch.map(async item => {
            const { need, query, resourceHints, allowance, receipt } = item;
            if (!canAct()) {
                ledger.reportUsage(receipt, 0, "configured-rate-estimate"); // Nothing was sent.
                return { started: false as const };
            }
            onStatus(`正在检索证据需求 ${  need.id  }，第 ${  searchAttempts + 1  } 个查询`);
            if (!canAct()) {
                ledger.reportUsage(receipt, 0, "configured-rate-estimate");
                return { started: false as const };
            }
            item.started = true;
            searchAttempts++;
            audit.queries.push(query.query);
            const result = await searchReadWeaveEvidence({
                query: query.query, context, force: true, forcePaidFallback: true,
                resourceHints, allowPaid: allowance >= 0.0072, budgetCny: allowance
            }, { signal });
            return { started: true as const, result };
        }));
        signal?.throwIfAborted();
        for (const [index, outcome] of outcomes.entries()) {
            const { need, query, allowance, receipt } = batch[index];
            if (outcome.status === "rejected") {
                if (!batch[index].started) throw outcome.reason;
                // Keep the reserved receipt pending. This is not a known charge.
                audit.unsettledCostCny += allowance;
                audit.queryCount++;
                query.status = "failed";
                warnings.push("Search failed; its allowance remains unsettled.");
                continue;
            }
            if (!outcome.value.started) continue;
            const result = outcome.value.result;
            if (result?.cacheHit) audit.cacheHits++;
            else audit.queryCount++;
            query.cacheHit = result?.cacheHit ?? false;
            const validCost = result && Number.isFinite(result.searchCostCny)
                && result.searchCostCny >= 0 && result.searchCostCny <= allowance;
            // Legacy adapters catch provider failures and return warnings, sometimes
            // with zero cost or a rate estimate for the failed call. Neither proves
            // settlement. Cached evidence does not incur that earlier request again.
            const adapterPending = (result as { unsettledCostCny?: number } | undefined)?.unsettledCostCny;
            const uncertainCost = !result?.cacheHit && (!!result?.warnings?.length
                || adapterPending !== undefined && adapterPending !== 0);
            if (validCost && !uncertainCost && ledger.reportUsage(receipt, result.searchCostCny, "configured-rate-estimate")) {
                // Accepted adapter cost, still a configured-rate estimate rather
                // than a provider-confirmed actual bill.
                audit.searchCostCny += result.searchCostCny;
            } else {
                audit.unsettledCostCny += allowance;
                globalStop = "budget";
                warnings.push(uncertainCost
                    ? "Search reported provider uncertainty; its allowance remains unsettled."
                    : "Search returned an invalid or over-allowance cost; its allowance remains unsettled.");
            }
            warnings.push(...(result?.warnings ?? []));
            for (const hit of result?.sources ?? []) {
                let url: URL;
                try { url = new URL(hit.url); } catch { continue; }
                if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
                url.hash = "";
                let source = byUrl.get(url.href);
                if (!source) {
                    source = {
                        sourceId: `S${sources.length + 1}`, sourceType: "external",
                        provider: hit.provider, title: hit.title, url: url.href, excerpt: hit.snippet,
                        publishedAt: hit.publishedAt, accessedAt: new Date().toISOString(),
                        sourceCategory: hit.sourceCategory, evidenceFamily: hit.evidenceFamily,
                        // A search hit is a snippet even if its adapter labels it a page.
                        retrievalMode: hit.retrievalMode === "page-reader" ? "raw-serp" : hit.retrievalMode ?? "raw-serp",
                        originalRank: hit.originalRank, rerankScore: hit.score,
                        needIds: [], queries: [], access: "snippet", pageReadStatus: "pending"
                    };
                    sources.push(source);
                    byUrl.set(url.href, source);
                } else if (hit.snippet && !source.excerpt.includes(hit.snippet)) {
                    source.excerpt += `\n${hit.snippet}`;
                }
                if (!query.sourceIds.includes(source.sourceId)) query.sourceIds.push(source.sourceId);
            }
            query.status = query.sourceIds.length ? "retrieved" : result ? "empty" : "failed";
            associate(need, query);
        }
        if (globalStop) break;
    }

    // Anonymous Reader sends no API key and consumes no paid Jina tokens.
    // It remains external network access under the generator's scoped gateway.
    // Read at most two pages concurrently, in the same fair order as the needs.
    const readIds = new Set<string>();
    const pageOrder: string[] = [];
    for (let round = 0; needs.some(need => round < need.sourceIds.length); round++) {
        for (const need of needs) {
            const id = need.sourceIds[round];
            if (id && !pageOrder.includes(id)) pageOrder.push(id);
        }
    }
    for (let index = 0; index < pageOrder.length; index += 2) {
        const outcomes = await Promise.allSettled(pageOrder.slice(index, index + 2).map(async sourceId => {
            if (!canAct()) return;
            if (audit.pageReadCount >= pageLimit) { audit.stopReason = "limit"; return; }
            const source = sources.find(item => item.sourceId === sourceId)!;
            readIds.add(sourceId);
            audit.pageReadCount++;
            try {
                const content = await readReadWeavePageWithJina(source.url!, { signal, anonymous: true });
                signal?.throwIfAborted();
                source.pageReadStatus = content?.trim() ? "read" : "empty";
                if (content?.trim()) {
                    const fallback = source.excerpt;
                    const focus = [
                        contract.normalizedQuestion,
                        source.requestedFragment ?? "",
                        ...source.needIds.flatMap(id => {
                            const need = needs.find(item => item.id === id);
                            return need ? [ need.questionToResolve, ...need.queries.map(query => query.query) ] : [];
                        })
                    ].join("\n");
                    source.excerpt = extractReadWeavePageEvidence(content, focus, fallback, source.requestedFragment);
                    source.retrievalMode = "page-reader";
                    source.access = "excerpt";
                }
            } catch (error) {
                signal?.throwIfAborted();
                source.pageReadStatus = "failed";
                const status = error instanceof Error ? error.message.match(/\b[45]\d{2}\b/u)?.[0] : undefined;
                warnings.push(`Page extraction failed${  status ? ` (HTTP ${  status  })` : ""  }.`);
            }
        }));
        signal?.throwIfAborted();
        const rejected = outcomes.find(outcome => outcome.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
        if (globalStop || audit.pageReadCount >= pageLimit) break;
    }
    if (globalStop) audit.stopReason = globalStop;
    if (audit.stopReason === "exhausted" && (sources.some(source => source.pageReadStatus === "failed")
        || needs.some(need => need.queries.some(query => query.status === "failed"))))
        audit.stopReason = "unavailable";
    for (const need of needs) {
        need.pageSourceIds = need.sourceIds.filter(id => sources.some(source =>
            source.sourceId === id && source.retrievalMode === "page-reader"));
        need.retrievalStatus = need.sourceIds.length ? "retrieved"
            : need.queries.some(query => query.status === "failed") ? "unavailable"
                : need.queries.some(query => query.status !== "pending") ? "no-results" : "unsearched";
        need.stopReason = need.queries.some(query => query.status === "pending")
            || need.sourceIds.some(id => !readIds.has(id)) ? audit.stopReason
            : need.queries.some(query => query.status === "failed")
                || sources.some(source => source.needIds.includes(need.id) && source.pageReadStatus === "failed")
                ? "unavailable" : "exhausted";
    }
    // Retrieval alone does not resolve a neutral question, verify a claim, or
    // establish currentness. The caller must assess these per-need candidates.
    audit.missingFacts = needs.map(need => need.questionToResolve);
    audit.searchCostCny = Number(audit.searchCostCny.toFixed(6));
    audit.unsettledCostCny = Number(audit.unsettledCostCny.toFixed(6));
    return {
        sources, queries: audit.queries,
        providers: [...new Set(sources.map(source => source.provider))],
        cacheHit: audit.queryCount === 0 && audit.cacheHits > 0,
        searchCostCny: audit.searchCostCny, unsettledCostCny: audit.unsettledCostCny,
        warnings: [...new Set(warnings)], audit
    };
}
