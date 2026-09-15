import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

import { checkReadWeaveNamingEvidence } from "./readweave_evidence_quality.js";
import { mapReadWeaveProse } from "./readweave_format.js";

export interface ReadWeaveLocalScopePatch {
    original: string;
    replacement: string;
}

const NAMING_DATE = /(?:于|在)[ \t]*\d{4}[ \t]*年(?:[ \t]*\d{1,2}[ \t]*月(?:[ \t]*\d{1,2}[ \t]*日)?)?[ \t]*(?=(?:得名|命名)(?:于|自))/gu;
const QUALIFIED = /可能|或许|大概|尚未|无法|不能|没有|不是|并非|不确定|是否|如果|假设|据称|推测|\b(?:not|never|cannot|unknown|uncertain|if|unless|may|might|could)\b/iu;

function contextBefore(text: string, offset: number): string {
    return text.slice(0, offset).split(/[。；;！？!?\r\n]|\.(?=\s|$)|但是|不过|然而|但|\b(?:but|however)\b/iu).at(-1) ?? "";
}

/** Remove only an unquoted date attached to the naming predicate. Recheck the
 * surviving statement against the writer's actual quote and admitted source.
 * This inherits the naming check's provenance limits; it is not entailment. */
export function repairReadWeaveNamingDates(body: string, evidence: unknown, sources: ReadWeaveEvidenceSource[]) {
    const entries: unknown[] = Array.isArray(evidence) ? [...evidence] : [];
    const replacements: ReadWeaveLocalScopePatch[] = [];
    let repaired = body;
    for (const entry of [...entries]) {
        if (!entry || typeof entry !== "object" || !("bodyText" in entry)
            || typeof entry.bodyText !== "string") continue;
        const original = entry.bodyText;
        if (!original || QUALIFIED.test(original)) continue;
        if (!("quote" in entry) || typeof entry.quote !== "string"
            || QUALIFIED.test(entry.quote) || /\b(?:not|never|isn't|wasn't|unknown)\b/iu.test(entry.quote)) continue;
        const before = checkReadWeaveNamingEvidence(original, [entry], sources);
        if (!before.diagnostics.length || before.diagnostics.some(reason =>
            reason.slice(reason.indexOf("：") + 1) !== "引用没有覆盖正文的数字，不得把推算的年代写成原文事实")) continue;
        const replacement = original.replace(NAMING_DATE, "");
        if (replacement === original) continue;
        const corrected = { ...entry, bodyText: replacement };
        const after = checkReadWeaveNamingEvidence(replacement, [corrected], sources);
        if (after.issues.length || !after.supported.length) continue;
        let applied = false;
        repaired = mapReadWeaveProse(repaired, prose => prose.replaceAll(original, (_match, offset: number) => {
            if (offset > 0 && /[\p{L}\p{N}_]/u.test(prose[offset - 1])) return original;
            const prefix = contextBefore(prose, offset);
            if (QUALIFIED.test(prefix)) return original;
            applied = true;
            return replacement;
        }));
        if (applied) {
            replacements.push({ original, replacement });
            entries.push(corrected);
        }
    }
    return { body: repaired, check: checkReadWeaveNamingEvidence(repaired, entries, sources),
        rounds: replacements.length ? 1 : 0, warnings: [] as string[], removed: [] as string[], replacements };
}

/** Bound only an explicit origin assertion, including its attached date.
 * Stable definitions, corrections, uncertainty and opaque data are untouched. */
export function boundReadWeaveUnsupportedNaming(body: string, issues: string[]) {
    const replacements: ReadWeaveLocalScopePatch[] = [];
    const proseMask = mapReadWeaveProse(body, prose => "\0".repeat(prose.length));
    const bounded = body.replace(/[^，,。；;！？!?\r\n]+/gu, (clause, offset: number) => {
        if (/[^\0]/u.test(proseMask.slice(offset, offset + clause.length))) return clause;
        const literal = clause.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        if (!literal || !issues.some(issue => new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`, "u").test(issue))
            || QUALIFIED.test(clause) || /^\s*[？?]/u.test(body.slice(offset + clause.length))) return clause;
        const prefix = contextBefore(body, offset);
        if (QUALIFIED.test(prefix)) return clause;
        const relation = /(?:名称|名字|词源)(?:源于|源自|来自|来源于)|(?:得名|命名)(?:于|自)/u.exec(clause);
        if (!relation) return clause;
        const date = /(?:于|在)[ \t]*\d{4}[ \t]*年(?:[ \t]*\d{1,2}[ \t]*月(?:[ \t]*\d{1,2}[ \t]*日)?)?[ \t]*$/u.exec(clause.slice(0, relation.index));
        const start = date?.index ?? relation.index;
        const tail = clause.slice(start);
        const sibling = /并且|同时|而且|以及|且/u.exec(tail);
        const original = tail.slice(0, sibling?.index ?? tail.length).trimEnd();
        const replacement = "名称来源尚无法核实；可查阅原始命名记录或作者说明";
        replacements.push({ original, replacement });
        return clause.slice(0, start) + replacement + tail.slice(original.length);
    });
    return { body: bounded, replacements };
}

/** Literal directive grammar, not topic/category routing. Callers supply only
 * the original user question and explicitly approved exclusions, never context
 * instructions or unreviewed semantic proposals. Unrecognized scope is advisory. */
export function applyReadWeaveExplicitExclusions(body: string, instructions: string[]) {
    const targets: Array<{ subject: string; responsibility: boolean }> = [];
    for (const instruction of instructions) {
        const mask = mapReadWeaveProse(instruction, prose => "\0".repeat(prose.length));
        for (const occurrence of instruction.matchAll(/[^，,。；;！？!?\r\n]+[，,。；;！？!?]?/gu)) {
            const raw = occurrence[0];
            if (/[^\0]/u.test(mask.slice(occurrence.index, occurrence.index + raw.length))
                || /[？?]$/u.test(raw) || QUALIFIED.test(contextBefore(instruction, occurrence.index))) continue;
            const clause = raw.replace(/[，,。；;！？!?]$/u, "");
            const match = clause.trim().match(/^(?:也|并且|并|请)?(?:不要|不|请勿|别)(?:列出|介绍|展开|复述|提及|包含|输出|展示|说明|解释|讨论)[ \t]*(.{2,80})$/u);
            if (!match) continue;
            // A bare 和/或 can belong to a name (e.g. 共和组织), not a list.
            for (const object of match[1].split(/以及|、/u)) {
                const target = object.trim();
                const responsibility = target.endsWith("职责");
                const subject = responsibility ? target.replace(/的?职责$/u, "") : target;
                if (subject.length >= 2) targets.push({ subject, responsibility });
            }
        }
    }
    const replacements: ReadWeaveLocalScopePatch[] = [];
    // Inspect complete clauses at original offsets, then require every byte to
    // be prose. An inline code/quote boundary cannot turn half a clause into a
    // deletion target and leave an orphaned value or sibling behind.
    const proseMask = mapReadWeaveProse(body, prose => "\0".repeat(prose.length));
    const repaired = body.replace(/[^，,。；;！？!?\r\n]+[，,。；;！？!?]?/gu, (raw, offset: number) => {
        if (/[^\0]/u.test(proseMask.slice(offset, offset + raw.length))) return raw;
        const clause = raw.trim().replace(/^[ \t]*(?:[-*+] |\d+[.)] )/u, "");
        if (QUALIFIED.test(clause) || QUALIFIED.test(contextBefore(body, offset))
            || /[？?]$/u.test(clause) || /(?:时|的情况下)[，,。；;！？!?]?$/u.test(clause)) return raw;
        const matched = targets.some(({ subject, responsibility }) => {
            if (!clause.startsWith(subject)) return false;
            const predicate = clause.slice(subject.length);
            return responsibility
                ? /^(?:的)?(?:职责(?:是|为)|负责|承担)\S/u.test(predicate)
                : /^[ \t]*(?:是|为|：|:|负责|承担)[ \t]*[^，,。；;！？!?\s]/u.test(predicate);
        });
        if (!matched) return raw;
        // A conjunction may introduce a requested sibling within this clause.
        // Keep the whole clause when we cannot isolate the excluded assertion.
        if (/并且|同时|而且|以及|但|且/u.test(clause)) return raw;
        replacements.push({ original: raw, replacement: "" });
        return "";
    });
    return { body: replacements.length && !repaired.trim()
        ? "已省略你明确排除的内容；请补充希望保留的具体问题。" : repaired, replacements };
}
