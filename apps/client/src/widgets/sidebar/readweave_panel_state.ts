import type { ReadWeaveCalloutType, ReadWeaveCandidate, ReadWeaveObjectKind, ReadWeaveTermIdentity } from "@triliumnext/commons";

export const READWEAVE_CANDIDATE_MIN_CONFIDENCE = 0.55;
export const READWEAVE_CANDIDATE_LIMIT = 3;

const USER_SELECTED_CALLOUTS = new Set<ReadWeaveCalloutType>([ "important", "warning", "caution" ]);

export function defaultReadWeaveCallout(kind: ReadWeaveObjectKind): ReadWeaveCalloutType {
    return kind === "term" ? "tip" : "note";
}

export function calloutAfterKindChange(current: ReadWeaveCalloutType, nextKind: ReadWeaveObjectKind): ReadWeaveCalloutType {
    return USER_SELECTED_CALLOUTS.has(current) ? current : defaultReadWeaveCallout(nextKind);
}

export function visibleReadWeaveCandidates(candidates: ReadWeaveCandidate[]): ReadWeaveCandidate[] {
    return candidates
        .filter(candidate => candidate.confidence > READWEAVE_CANDIDATE_MIN_CONFIDENCE)
        .toSorted((left, right) => right.confidence - left.confidence || left.title.localeCompare(right.title))
        .slice(0, READWEAVE_CANDIDATE_LIMIT);
}

export function isReadWeaveGenerationDisabled(input: {
    busy: boolean;
    definitionExists: boolean;
    hasSelection: boolean;
    hasTitle: boolean;
    jobStatus?: "queued" | "running" | "complete" | "failed";
    selectionPending: boolean;
}): boolean {
    return input.busy
        || !input.hasSelection
        || input.selectionPending
        || input.definitionExists
        || !input.hasTitle
        || input.jobStatus === "queued"
        || input.jobStatus === "running";
}

export function normalizeReadWeaveTermIdentityForReview(identity: Partial<ReadWeaveTermIdentity> | undefined): Partial<ReadWeaveTermIdentity> {
    const abbreviation = identity?.abbreviation?.trim() || undefined;
    const englishName = identity?.englishName?.trim() || undefined;
    let chineseName = identity?.chineseName?.trim() || undefined;
    if (abbreviation && chineseName) {
        const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const stripped = chineseName
            .replace(new RegExp(`^\\s*${escaped}(?:\\s+|[：:—–-]+\\s*)`, "iu"), "")
            .replace(new RegExp(`(?:\\s+|[：:—–-]+\\s*)${escaped}\\s*$`, "iu"), "")
            .trim();
        if (stripped) chineseName = stripped;
    }
    const comparable = (value: string | undefined) => value?.normalize("NFKC").replace(/[\p{P}\p{S}\s]+/gu, "").toLocaleLowerCase() ?? "";
    if (abbreviation && englishName && comparable(abbreviation) === comparable(englishName)) {
        return { abbreviation: undefined, chineseName, englishName };
    }
    return { abbreviation, chineseName, englishName };
}
