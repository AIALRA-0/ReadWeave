import type { ReadWeaveClaim, ReadWeaveEvidenceSource } from "@triliumnext/commons";

import { mapReadWeaveProse } from "./readweave_format.js";

export interface ReadWeaveSourceSupportCheck {
    claimId: string;
    sourceId: string;
    status: "metadata-supported" | "unsupported" | "not-checked";
    reason: "exact-title-doi" | "metadata-only" | "bibliographic-binding-mismatch" | "source-unavailable" | "semantic-support-not-checked";
}

interface Association {
    title: string;
    doi: string;
    full: string;
    start: number;
    end: number;
    binding: string;
}

const DOI = String.raw`10\.\d{4,9}/[-._;()/:\p{L}\p{N}]+`;
const normalizeTitle = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const normalizeDoi = (text: string) => text.replace(/[.,;。；]+$/u, "").toLowerCase();
const QUALIFIED = /无法|不能|尚未|不属于|并非|不是|不一致|没有|可能|或许|如果|假设|据称|是否|\b(?:not|cannot|unknown|unconfirmed|if|unless|may|might|could|reportedly)\b/iu;

function contextBefore(text: string, start: number): string {
    return text.slice(0, start).split(/[。！？!?；;\r\n]|\.(?=\s|$)|但是|不过|然而|但|\b(?:but|however)\b/iu).at(-1) ?? "";
}

function associations(text: string): Association[] {
    const pattern = new RegExp(
        String.raw`(?:论文|文章|paper\s+)?(?:《([^》\n]+)》|“([^”\n]+)”|"([^"\n]+)")(\s*(?:的\s*)?(?:DOI|数字对象标识符)\s*(?:是|为|is|[:：=])?\s*(${DOI}))`, "giu"
    );
    return Array.from(text.matchAll(pattern)).flatMap(match => {
        const before = contextBefore(text, match.index);
        const after = text.slice(match.index + match[0].length).replace(/^(?:\s*\[[A-Za-z][\w-]*\])+/u, "");
        if (QUALIFIED.test(before) || /^\s*[？?]/u.test(after)
            || /^\s*[（(【]\s*(?:待核实|未核实|未证实|尚未证实|不确定|假设|unverified|unconfirmed|uncertain)/iu.test(after)
            || /^\s*(?:的)?(?:说法|表述|关联|对应关系)(?:是)?(?:错误|不成立|不正确|尚未证实|未经核实)/u.test(after)
            || /^\s*[，,]\s*(?:如果|前提是|if\b|unless\b)/iu.test(after)) return [];
        const doi = normalizeDoi(match[5]);
        const binding = match[4].slice(0, match[4].length - (match[5].length - doi.length));
        const start = match.index + match[0].length - match[4].length;
        return [{ title: match[1] || match[2] || match[3], doi,
            full: match[0], binding, start, end: start + binding.length }];
    });
}

/** Recognize a metadata record structurally, never by snippet length or topic words.
 * Any unrecognized prose makes the record unclassified, not invalid evidence. */
function metadataRecord(source: ReadWeaveEvidenceSource): { title: string; dois: string[] } | undefined {
    const dois = [...new Set(Array.from(`${source.url ?? ""}\n${source.excerpt}`.matchAll(new RegExp(DOI, "giu")), match => normalizeDoi(match[0])))];
    if (!source.title.trim() || dois.length === 0) return undefined;
    const fields = source.excerpt.split(/[;；\r\n]+/u).map(field => field.trim()).filter(Boolean);
    const title = normalizeTitle(source.title);
    const onlyMetadata = fields.every(field => {
        if (normalizeTitle(field) === title) return true;
        const withoutDoi = field.replace(new RegExp(String.raw`(?:https?://(?:dx\.)?doi\.org/)?${DOI}`, "giu"), "")
            .replace(/^[\s:：.,，。()（）]+|[\s:：.,，。()（）]+$/gu, "");
        return /^(?:DOI|数字对象标识符|publisher metadata|publication metadata|出版元数据|出版信息)?$/iu.test(withoutDoi)
            || /^(?:publisher|authors?|published|publication date|year|volume|issue|pages|出版者|出版社|作者|出版日期|年份|卷|期|页码)\s*[:：]\s*[^\r\n]+$/iu.test(field);
    });
    return onlyMetadata ? { title, dois } : undefined;
}

function inspectLink(claim: ReadWeaveClaim, source: ReadWeaveEvidenceSource | undefined): Pick<ReadWeaveSourceSupportCheck, "status" | "reason"> {
    if (!source) return { status: "unsupported", reason: "source-unavailable" };
    const record = metadataRecord(source);
    if (!record) return { status: "not-checked", reason: "semantic-support-not-checked" };
    if (record.dois.length !== 1) return { status: "not-checked", reason: "semantic-support-not-checked" };
    const bindings = associations(claim.text);
    if (bindings.some(binding => record.dois.length === 1
        && (record.title !== normalizeTitle(binding.title) || record.dois[0] !== binding.doi))) {
        return { status: "unsupported", reason: "bibliographic-binding-mismatch" };
    }
    const rest = bindings.reduce((text, binding) => text.replace(binding.full, ""), claim.text)
        .replace(/\[[A-Za-z][\w-]*\]|[\s。.!！?？;；,，]/gu, "");
    if (bindings.length > 0 && !rest && bindings.every(binding => record.title === normalizeTitle(binding.title)
        && record.dois.includes(binding.doi))) {
        return { status: "metadata-supported", reason: "exact-title-doi" };
    }
    if (bindings.length > 0 && rest) return { status: "unsupported", reason: "metadata-only" };
    // Other bibliographic fields/aliases need a contextual check; do not pretend
    // this narrow title/DOI matcher verifies authorship, dates or translations.
    if (/(?:题名|标题|作者|发表|出版|\b(?:author|title|published|publication|DOI)\b)/iu.test(claim.text)) {
        return { status: "not-checked", reason: "semantic-support-not-checked" };
    }
    return { status: "unsupported", reason: "metadata-only" };
}

/** Link-level evidence assessment, not a general entailment or truth verifier.
 * Only admitted sources belong here. Unknown/substantive evidence is never
 * rejected by word overlap, and an existing ID never becomes proof of support. */
export function inspectReadWeaveSourceSupport(
    claims: readonly ReadWeaveClaim[], sources: readonly ReadWeaveEvidenceSource[]
): ReadWeaveSourceSupportCheck[] {
    const byId = new Map(sources.map(source => [source.sourceId, source]));
    return claims.flatMap(claim => [...new Set(claim.sourceIds)].map(sourceId => ({
        claimId: claim.claimId, sourceId, ...inspectLink(claim, byId.get(sourceId))
    })));
}

function bindingMatchesSource(binding: Association, source: ReadWeaveEvidenceSource | undefined): boolean | undefined {
    if (!source) return false;
    const record = metadataRecord(source);
    if (!record || record.dois.length !== 1) return undefined;
    return record.title === normalizeTitle(binding.title) && record.dois[0] === binding.doi;
}

function boundAssociation(text: string, targets: readonly Association[], sources: readonly ReadWeaveEvidenceSource[], preserved: readonly Association[] = []): string {
    // The mask retains UTF-16 positions while marking only editable prose.
    // Quoted titles stay intact; only their positive DOI-binding predicate is patched.
    const proseMask = mapReadWeaveProse(text, prose => "\0".repeat(prose.length));
    const matches = (left: Association, right: Association) => normalizeTitle(left.title) === normalizeTitle(right.title) && left.doi === right.doi;
    const patches = associations(text).flatMap(binding => {
        if (!targets.some(target => matches(target, binding)) || !/^\0+$/u.test(proseMask.slice(binding.start, binding.end))) return [];
        const citations = text.slice(binding.end).match(/^(?:\s*\[[A-Za-z][\w-]*\])+/u)?.[0] ?? "";
        const ids = Array.from(citations.matchAll(/\[([A-Za-z][\w-]*)\]/gu), match => match[1]);
        if (ids.some(id => bindingMatchesSource(binding, sources.find(source => source.sourceId === id)) !== false)) return [];
        if (!ids.length && preserved.some(other => matches(other, binding))) return [];
        const removableCitations = /^\0*$/u.test(proseMask.slice(binding.end, binding.end + citations.length));
        return [{ ...binding, end: binding.end + (removableCitations ? citations.length : 0) }];
    });
    let result = text;
    for (const patch of patches.reverse()) {
        const replacement = /\p{Script=Han}/u.test(patch.full)
            ? "的 DOI 尚无法确认；现有来源未确认该题名与此标识符的对应关系"
            : " DOI could not be confirmed; the cited record does not establish this title–identifier association";
        result = result.slice(0, patch.start) + replacement + result.slice(patch.end);
    }
    return result;
}

function stripRejectedCitations(body: string, claims: readonly ReadWeaveClaim[], checks: readonly ReadWeaveSourceSupportCheck[]): string {
    let prose = body;
    for (const claim of claims) {
        const rejected = new Set(checks.filter(check => check.claimId === claim.claimId && check.status === "unsupported")
            .map(check => check.sourceId));
        if (!rejected.size || !claim.text) continue;
        const bare = claim.text.replace(/(?:\s*\[[A-Za-z][\w-]*\])+\s*$/u, "");
        if (!bare) continue;
        const pattern = new RegExp(`${bare.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}((?:\\s*\\[[A-Za-z][\\w-]*\\])+)`, "gu");
        const mask = mapReadWeaveProse(prose, text => "\0".repeat(text.length));
        prose = prose.replace(pattern, (full, citations: string, offset: number) => {
            const head = prose.slice(0, offset).split(/[，,。！？!?；;\r\n]|\.(?=\s|$)/u).at(-1) ?? "";
            if (!/^[\s*#-]*$/u.test(head) || QUALIFIED.test(contextBefore(prose, offset))
                || /[^\0]/u.test(mask.slice(offset, offset + full.length))) return full;
            return bare + citations.replace(
                /\s*\[([A-Za-z][\w-]*)\]/gu, (marker, id: string) => rejected.has(id) ? "" : marker
            );
        });
    }
    return prose;
}

/** Local fallback after a bounded retrieval/repair attempt (or when it is unavailable).
 * Preserve technical prose, but remove demonstrably inadequate citation links and
 * mark those claims unverified. Only an unsupported positive title/DOI association
 * is bounded in the body; sibling answers, quotes and code are preserved. */
export function applyReadWeaveSourceSupport(
    body: string, claims: readonly ReadWeaveClaim[], sources: readonly ReadWeaveEvidenceSource[]
): { body: string; claims: ReadWeaveClaim[]; checks: ReadWeaveSourceSupportCheck[] } {
    const checks = inspectReadWeaveSourceSupport(claims, sources);
    const targets: Association[] = [];
    const preserved: Association[] = [];
    for (const claim of claims) for (const binding of associations(claim.text)) {
        if (claim.sourceIds.some(id => bindingMatchesSource(binding, sources.find(source => source.sourceId === id)) !== false)) preserved.push(binding);
    }
    const updated = claims.map(claim => {
        const links = checks.filter(check => check.claimId === claim.claimId);
        const unsupported = links.filter(link => link.status === "unsupported");
        if (!unsupported.length) return { ...claim, sourceIds: [...claim.sourceIds] };
        const claimBindings = associations(claim.text);
        const rejectedIds = new Set(unsupported.filter(link => !claimBindings.some(binding =>
            bindingMatchesSource(binding, sources.find(source => source.sourceId === link.sourceId)) === true)).map(link => link.sourceId));
        // A second, substantive source may establish the association; leave it
        // for semantic review rather than overriding it with this local matcher.
        const bindings = unsupported.some(link => link.reason === "bibliographic-binding-mismatch")
            ? claimBindings.filter(binding => claim.sourceIds.every(id => bindingMatchesSource(binding, sources.find(source => source.sourceId === id)) === false)) : [];
        targets.push(...bindings);
        return { ...claim, text: boundAssociation(stripRejectedCitations(claim.text, [claim], links.filter(link => rejectedIds.has(link.sourceId))), bindings, sources),
            sourceIds: claim.sourceIds.filter(id => !rejectedIds.has(id)),
            ...(links.some(link => link.status === "metadata-supported") ? {} : { unresolved: true, status: "not-checked" as const }) };
    });
    const removedLinks = checks.filter(check => !updated.find(claim => claim.claimId === check.claimId)?.sourceIds.includes(check.sourceId));
    // Keep inline IDs available during binding decisions so two identical
    // sentences can retain their different, occurrence-specific provenance.
    return { body: stripRejectedCitations(boundAssociation(body, targets, sources, preserved), claims, removedLinks), claims: updated, checks };
}
