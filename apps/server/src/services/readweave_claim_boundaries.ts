import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

import { mapReadWeaveProse } from "./readweave_format.js";

export interface ReadWeaveClaimBoundaryTarget {
    original: string;
    reason: string;
}

interface RawClaim {
    text: string;
    sourceIds: string[];
}

interface Boundary extends ReadWeaveClaimBoundaryTarget {
    start: number;
    end: number;
    replacement: string;
}

const TEMPORAL = /目前|当前|现在|现今|现阶段|现任|现为|最新|截至\s*\d{4}|\b(?:currently|current|latest|now|today|as of \d{4})\b/iu;
const QUALIFIED = /无法|不能确认|不能核实|尚未|尚无|暂无|未能|没有|并非|不是|不再|不(?:在|任职|担任|为)|不确定|不详|未知|未(?:经证实|证实|核实)|可能|或许|据称|传闻|假设|如果|是否|尚不清楚|待核实|(?:^|[，,\s])若|\b(?:not|no|never|unknown|uncertain|unverified|unconfirmed|may|might|could|if|unless|reportedly|cannot|can't)\b/iu;
const QUESTION = /[？?]|哪(?:个|位|家|种)?|什么|如何|怎么|\b(?:who|what|which|whether|how)\b/iu;

function claimsFrom(raw: unknown): RawClaim[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(value => {
        if (!value || typeof value !== "object" || typeof value.text !== "string" || !value.text.trim()) return [];
        return [ {
            text: value.text.trim().replace(/[。.!！?？;；]+$/u, ""),
            sourceIds: Array.isArray(value.sourceIds)
                ? value.sourceIds.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim())) : []
        } ];
    }).filter(claim => claim.text.length > 0);
}

function assertion(text: string): { label: string; replacement: string } | undefined {
    const factualText = text.replace(/(?:当前|目前)(?:的)?(?:问题|任务|讨论|回答|语境)|\bcurrent (?:question|task|discussion|answer|context)\b/giu, "");
    if (!TEMPORAL.test(factualText) || QUALIFIED.test(text) || QUESTION.test(text)) return undefined;
    const dimensions = [
        { pattern: /任职于|就职于|供职于|任教于|担任|现任|现为|在[^，,。；;]+?(?:任职|工作|任教)|(?:是|为)[^，,。；;]+?(?:教授|院长|董事|经理|主任|负责人|工程师|研究员|总裁)|\b(?:works? (?:at|for)|serves? as|is (?:the )?(?:CEO|CTO|president|professor|director|head))\b/iu,
            label: "当前任职信息", english: "current role", next: "查阅近期官方人员页面或任职公告", nextEnglish: "check a recent official profile or appointment notice", numeric: false },
        { pattern: /版本|稳定版|发行版|最新版|\b(?:version|release)\b/iu,
            label: "当前版本", english: "current version", next: "查看官方发布记录并核对发布日期", nextEnglish: "check the official release history and publication date", numeric: true },
        { pattern: /价格|售价|报价|单价|市价|\b(?:price|costs?|priced at)\b/iu,
            label: "当前价格", english: "current price", next: "查看官方报价并核对币种与计价时间", nextEnglish: "check the official quote, currency and pricing date", numeric: true },
        { pattern: /用户数(?:量)?|月活(?:用户数)?|日活(?:用户数)?|市场份额|占比|销量|人口|营收|收入|统计数据|数量|总数|比例|增长率|利率|汇率|\b(?:users?|market share|population|revenue|sales|statistics|count|rate)\b/iu,
            label: "当前统计数值", english: "current statistic", next: "查阅注明统计时间与口径的原始数据", nextEnglish: "check the original data, measurement date and methodology", numeric: true }
    ];
    for (const dimension of dimensions) {
        const match = dimension.pattern.exec(text);
        if (!match) continue;
        const after = text.slice(match.index + match[0].length);
        if (dimension.numeric && !/^\s*(?:(?:目前|当前|最新|现在|的|为|是|已达|达到|约为|约|有|达)|\b(?:is|are|of|at|about|approximately)\b|[:：=])?\s*(?:[vV¥￥$€£]|USD\s*|CNY\s*)?\d/iu.test(after)) continue;
        if (!dimension.numeric && !after.trim() && !/^(?:是|为|在)|\bis\b/iu.test(match[0])) continue;
        const subject = text.slice(0, match.index)
            .replace(/目前|当前|现在|现今|现阶段|最新|\b(?:currently|current|latest|now|today)\b/giu, "")
            .replace(/截至\s*\d{4}(?:[-年/]\d{1,2})?(?:[-月/]\d{1,2}日?)?/gu, "")
            .replace(/^\s*(?:[-*#]\s*|\d+[.)、]\s+)?|[\s*的]+$/gu, "").trim();
        // Do not reuse the predicate or its fabricated value in the bounded statement.
        const english = !/\p{Script=Han}/u.test(text);
        const label = dimension.label === "当前统计数值" && /\p{Script=Han}/u.test(match[0])
            ? `当前${match[0]}` : dimension.label;
        return {
            label,
            replacement: english
                ? `The ${dimension.english}${subject ? ` of ${subject}` : ""} could not be verified; ${dimension.nextEnglish}`
                : `尚无法核实${subject || "该对象"}的${label}；可${dimension.next}`
        };
    }
    return undefined;
}

function inlineIds(text: string): string[] {
    return [ ...text.matchAll(/\[([A-Za-z][\w-]*)\]/gu) ].map(match => match[1]);
}

function contextBefore(prose: string, start: number): string {
    // Qualifications carry through a comma, but not into an independent contrasting assertion.
    return prose.slice(0, start).split(/[。！？!?；;\r\n]|\.(?=\s|$)|(?:但是|不过|然而|但)|\b(?:but|however)\b/iu).at(-1) ?? "";
}

/** Recognize explicit qualification of the same words, not general semantic entailment. */
function explicitlyNegativeExcerpt(original: string, excerpt: string): boolean {
    const compact = (value: string) => value
        .replace(new RegExp(TEMPORAL.source, "giu"), "")
        .replace(/\[[A-Za-z][\w-]*\]|[\s，,。.!！?？;；“”"（）()]/gu, "").toLowerCase();
    const positive = compact(original);
    const negative = /没有证据(?:证明|表明|支持|确认)?|尚无证据(?:证明|表明|支持|确认)?|无法(?:核实|确认)|尚未(?:证实|核实)|并未|并不|不再|不|未|\b(?:not|unverified|unconfirmed)\b/giu;
    for (const sentence of excerpt.split(/[。！？!?；;\r\n]|\.(?=\s|$)/u)) {
        const normalized = compact(sentence);
        const position = normalized.indexOf(positive);
        if (position >= 0) {
            // A negative statement about another fact later in the sentence does not invalidate this one.
            if (QUALIFIED.test(normalized.slice(0, position))) return true;
            continue;
        }
        for (const marker of sentence.matchAll(negative)) {
            const withoutMarker = sentence.slice(0, marker.index) + sentence.slice(marker.index + marker[0].length);
            if (compact(withoutMarker).includes(positive)) return true;
        }
    }
    return false;
}

function historicalMatch(original: string, context: string, sources: readonly ReadWeaveEvidenceSource[]): boolean {
    if (!/(?:文章|文中|原文|报道|\barticle\b)/iu.test(context)
        || !/(?:\d{4}年|当时|当年|\bat the time\b|\bin \d{4}\b)/iu.test(context)) return false;
    const compact = (value: string) => value.replace(/[\s，,。.!！?？;；]/gu, "");
    return sources.some(source => source.sourceType === "local" && compact(source.excerpt).includes(compact(original))
        && !explicitlyNegativeExcerpt(original, source.excerpt));
}

function boundariesInProse(prose: string, claims: RawClaim[], sources: readonly ReadWeaveEvidenceSource[]): Boundary[] {
    const boundaries: Boundary[] = [];
    // Keep punctuation, line endings and surrounding answer bytes outside the replacement span.
    for (const clause of prose.matchAll(/(?:[^，,。！？!?；;\r\n.]|(?<=\d),(?=\d)|\.(?!\s|$))+/gu)) {
        const spans: Array<{ original: string; start: number; ids: string[] }> = [];
        for (const claim of claims) {
            // Names and other harmless substrings neither cover an assertion nor lend it citations.
            if (!assertion(claim.text)) continue;
            let offset = clause[0].indexOf(claim.text);
            while (offset >= 0) {
                const head = clause[0].slice(0, offset);
                const tail = clause[0].slice(offset + claim.text.length);
                const startsAssertion = /^[\s*#-]*$/u.test(head)
                    || /(?:[:：]|且|并且|同时|以及|而|但|\b(?:and|but)\b)\s*$/iu.test(head);
                // A truncated value (e.g. version "3" inside "3.2") is not the full assertion.
                if (startsAssertion && /^\s*(?:$|\[[A-Za-z][\w-]*\]|[（(]|且|并且|同时|以及|而|\b(?:and|but)\b)/iu.test(tail)) {
                    spans.push({ original: claim.text, start: clause.index + offset, ids: claim.sourceIds });
                }
                offset = clause[0].indexOf(claim.text, offset + claim.text.length);
            }
        }
        // Prefer a specific raw claim to a larger overlapping claim record.
        const exactSpans = spans.filter(span => !spans.some(other => other.original.length < span.original.length
            && other.start >= span.start && other.start + other.original.length <= span.start + span.original.length))
            .sort((left, right) => left.start - right.start);
        const candidates = [ ...exactSpans ];
        const scanResidual = (start: number, end: number) => {
            const residual = prose.slice(start, end);
            const original = residual.replace(/^[\s*#-]*(?:(?:且|并且|同时|以及|而|\b(?:and|but)\b)\s*)?/iu, "")
                .replace(/(?:\s*\[[A-Za-z][\w-]*\])*[\s*.]*$/u, "");
            if (original) candidates.push({ original, start: start + residual.indexOf(original), ids: [] });
        };
        let coveredUntil = clause.index;
        for (const span of exactSpans) {
            if (span.start > coveredUntil) scanResidual(coveredUntil, span.start);
            coveredUntil = Math.max(coveredUntil, span.start + span.original.length);
        }
        scanResidual(coveredUntil, clause.index + clause[0].length);
        for (const span of candidates) {
            const fact = assertion(span.original);
            if (!fact) continue;
            const prefix = contextBefore(prose, span.start);
            const end = span.start + span.original.length;
            const after = prose.slice(end);
            if (QUALIFIED.test(prefix) || /^\s*[？?]/u.test(after)
                || /^\s*[（(【]\s*(?:待核实|未核实|尚未证实|未证实|不确定|假设|unverified|unconfirmed|uncertain|hypothetical)/iu.test(after)
                || /^\s*[，,]\s*(?:如果|前提是|if\b|unless\b)/iu.test(after)) continue;
            if (historicalMatch(span.original, prefix, sources)) continue;
            const suffix = prose.slice(end).match(/^(?:\s*\[[A-Za-z][\w-]*\])+/u)?.[0] ?? "";
            const trailingCitation = span.original.match(/(?:\s*\[[A-Za-z][\w-]*\])+\s*$/u)?.[0] ?? "";
            const ids = [ ...span.ids, ...inlineIds(trailingCitation), ...inlineIds(suffix) ];
            // A duplicate claim record with a real citation is still a citation for this exact span.
            const otherIds = spans.filter(other => other.start === span.start && other.original === span.original)
                .flatMap(other => other.ids);
            const cited = sources.filter(source => [ ...ids, ...otherIds ].includes(source.sourceId));
            if (cited.some(source => !explicitlyNegativeExcerpt(span.original, source.excerpt))) continue;
            if (boundaries.some(boundary => span.start < boundary.end && end > boundary.start)) continue;
            boundaries.push({
                original: span.original, start: span.start, end,
                reason: `${fact.label}的肯定断言${cited.length ? "引用的来源明确否定或未证实该断言"
                    : ids.length ? "引用的来源 ID 未被接纳" : "缺少已接纳来源的引用"}`,
                replacement: fact.replacement
            });
        }
    }
    return boundaries.sort((left, right) => left.start - right.start);
}

/**
 * Conservative citation-availability check for explicit, time-sensitive positive assertions.
 * It is entity-agnostic, does not require citations for stable general knowledge, and is not
 * an entailment verifier: a valid ID cannot certify the citation's contents or freshness.
 * An excerpt explicitly negating/qualifying the same assertion is not positive evidence.
 * Only admitted sources belong here. Raw model claims are intentionally accepted as unknown.
 */
export function readWeaveClaimBoundaryTargets(
    body: string, rawClaims: unknown, sources: readonly ReadWeaveEvidenceSource[]
): ReadWeaveClaimBoundaryTarget[] {
    const claims = claimsFrom(rawClaims);
    const targets = new Map<string, ReadWeaveClaimBoundaryTarget>();
    mapReadWeaveProse(body, prose => {
        for (const { original, reason } of boundariesInProse(prose, claims, sources)) {
            targets.set(original, { original, reason });
        }
        return prose;
    });
    return [ ...targets.values() ];
}

function patchClaimBoundaries(
    body: string, rawClaims: unknown, sources: readonly ReadWeaveEvidenceSource[],
    replacementFor: (boundary: Boundary) => string
): string {
    const claims = claimsFrom(rawClaims);
    return mapReadWeaveProse(body, prose => {
        let result = "";
        let cursor = 0;
        for (const boundary of boundariesInProse(prose, claims, sources)) {
            result += prose.slice(cursor, boundary.start) + replacementFor(boundary);
            cursor = boundary.end;
        }
        return result + prose.slice(cursor);
    });
}

/**
 * Replace only exact, still-unresolved prose occurrences detected in the current body.
 * Never search/replace the whole body: identical code, quotations and other opaque
 * content are not repair targets. Replacement text is literal and is not rescanned
 * during this call. Pass the current raw claims and admitted sources to preserve
 * cited occurrences; when sources are omitted, no citation IDs are treated as admitted.
 * Recompute on each call rather than carrying offsets across earlier repairs.
 */
export function applyReadWeaveClaimPatch(
    body: string, original: string, replacement: string,
    rawClaims: unknown = [ { text: original } ], sources: readonly ReadWeaveEvidenceSource[] = []
): string {
    if (!original) return body;
    return patchClaimBoundaries(body, rawClaims, sources,
        boundary => boundary.original === original ? replacement : boundary.original);
}

/** Recheck the repaired body and its claims/sources; never apply stale targets or a global refusal. */
export function applyReadWeaveClaimBoundaries(
    body: string, rawClaims: unknown, sources: readonly ReadWeaveEvidenceSource[]
): string {
    return patchClaimBoundaries(body, rawClaims, sources, boundary => boundary.replacement);
}
