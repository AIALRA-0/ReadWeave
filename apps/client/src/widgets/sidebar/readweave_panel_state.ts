import type {
    ReadWeaveCalloutType,
    ReadWeaveCandidate,
    ReadWeaveGenerationJob,
    ReadWeaveGenerationProgress,
    ReadWeaveObjectKind,
    ReadWeaveTermIdentity
} from "@triliumnext/commons";

export const READWEAVE_CANDIDATE_MIN_CONFIDENCE = 0.55;
export const READWEAVE_CANDIDATE_LIMIT = 3;

export type ReadWeaveGenerationVisualState = "running" | "unread" | "paused" | "error";

export interface ReadWeaveReviewIssueBaseline {
    body: string;
    termIdentity?: Partial<ReadWeaveTermIdentity>;
}

export interface ReadWeaveGenerationDraftSnapshot {
    body?: string;
    bodyEdited?: boolean;
    questionTitle?: string;
    termIdentity?: Partial<ReadWeaveTermIdentity>;
    termIdentityEdited?: boolean;
}

export interface ReadWeaveRecoveredGenerationFields {
    body: string;
    questionTitle: string;
    termIdentity: Partial<ReadWeaveTermIdentity>;
    termIdentityEdited: boolean;
}

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
    jobStatus?: ReadWeaveGenerationJob["status"];
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

/**
 * The article-level jobs endpoint includes persisted answers and progress logs,
 * so polling it while every job is terminal wastes bandwidth.  Keep polling
 * only while a background job can still change without another user action.
 */
export function hasActiveReadWeaveGenerationJobs(
    jobs: Pick<ReadWeaveGenerationJob, "status">[]
): boolean {
    return jobs.some(job => job.status === "queued" || job.status === "running");
}

/**
 * A deliberately blank question draft must not be replaced by the newest job
 * for the same anchor when the background job snapshot refreshes.
 */
export function isReadWeaveJobAutoRestoreAllowed(input: {
    hasSelection: boolean;
    selectionPending: boolean;
    generationJobId?: string;
    newQuestionDraft: boolean;
}): boolean {
    return input.hasSelection
        && !input.selectionPending
        && !input.generationJobId
        && !input.newQuestionDraft;
}

/**
 * Only a job with a visible status indicator keeps its source range emphasized.
 * A completed, already-viewed draft remains recoverable in the side panel, but
 * its underline goes back to the normal hover/lock interaction.
 */
export function readWeaveGenerationVisualState(job: Pick<ReadWeaveGenerationJob, "status" | "unread"> & { qualityState?: ReadWeaveGenerationJob["qualityState"] }): ReadWeaveGenerationVisualState | undefined {
    if (job.status === "failed") return "error";
    if (job.status === "paused") return "paused";
    if (job.status === "queued" || job.status === "running") return "running";
    if (job.status === "complete" && job.qualityState !== "verified") return "paused";
    if (job.status === "complete" && job.unread) return "unread";
    return undefined;
}

/** Remove sentence punctuation that adds visual noise to compact status/log rows. */
export function readWeaveCompactStatusText(value: string): string {
    return value.trimEnd().replace(/[。．.]+(?=[\s"'’”」』）)\]】}》〉]*$)/u, "");
}

/**
 * Render simple legacy math as LaTeX without rewriting stored answers. Existing
 * LaTeX, URLs and inline code are opaque so repeated rendering is idempotent.
 */
export function normalizeReadWeaveReadableMath(value: string): string {
    return value.split(/(\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$|https?:\/\/[^\s]+|`[^`\n]*`)/u).map((part, index) => {
        if (index % 2 === 1) return part;
        return part
            .replace(
                /(?<![\p{L}\p{N}$])(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^\s*([+-]?\d+)(?![\p{L}\p{N}])/gu,
                (_match, coefficient: string, exponent: string) => `$${coefficient} \\times 10^{${exponent}}$`
            )
            .replace(
                /(?<![\p{L}\p{N}$])10\s*\^\s*([+-]?\d+)(?![\p{L}\p{N}])/gu,
                (_match, exponent: string) => `$10^{${exponent}}$`
            )
            .replace(
                /(?<![\p{L}\p{N}$])([A-Za-z])\s*(>=|<=|!=)\s*(-?\d+(?:\.\d+)?)(?![\p{L}\p{N}])/gu,
                (_match, variable: string, operator: string, operand: string) => {
                    const latexOperator = operator === ">=" ? "\\geq" : operator === "<=" ? "\\leq" : "\\neq";
                    return `$${variable} ${latexOperator} ${operand}$`;
                }
            );
    }).join("");
}

/**
 * Merge one asynchronously returned job without allowing an older response
 * (for example a delayed "viewed" acknowledgement) to replace a newer local
 * queued/running state.
 */
export function upsertReadWeaveGenerationJob(
    jobs: ReadWeaveGenerationJob[],
    incoming: ReadWeaveGenerationJob
): ReadWeaveGenerationJob[] {
    const existing = jobs.find(job => job.jobId === incoming.jobId);
    const selected = existing && compareReadWeaveJobVersions(existing, incoming) > 0
        ? existing
        : incoming;
    return [
        selected,
        ...jobs.filter(job => job.jobId !== incoming.jobId)
    ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Reconcile a periodic server snapshot while retaining a newer optimistic
 * version of each still-present job until the server catches up.
 */
export function mergeReadWeaveGenerationJobSnapshot(
    current: ReadWeaveGenerationJob[],
    incoming: ReadWeaveGenerationJob[]
): ReadWeaveGenerationJob[] {
    const merged = incoming.map(job => {
        const existing = current.find(candidate => candidate.jobId === job.jobId);
        return existing && compareReadWeaveJobVersions(existing, job) > 0 ? existing : job;
    });
    const incomingIds = new Set(incoming.map(job => job.jobId));
    const locallyNewerOrCrossArticle = current.filter(job => !incomingIds.has(job.jobId));
    return [ ...merged, ...locallyNewerOrCrossArticle ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * A failed job from an older server/database may have no progress rows. Give
 * it one synthetic failed row so the error remains attached to a foldable log
 * item instead of disappearing completely.
 */
export function readWeaveGenerationProgressForDisplay(
    job: Pick<ReadWeaveGenerationJob, "status" | "progress" | "createdAt" | "updatedAt">,
    failedMessage: string
): ReadWeaveGenerationProgress[] {
    if (job.progress.length > 0) return job.progress;
    if (job.status !== "failed") return [];
    return [ {
        sequence: 0,
        timestamp: job.updatedAt,
        elapsedMs: Math.max(0, Date.parse(job.updatedAt) - Date.parse(job.createdAt)),
        stage: "failed",
        round: 0,
        message: failedMessage,
        issues: []
    } ];
}

/**
 * Restore a background result without letting the pre-generation session
 * snapshot hide it.  A deliberately edited answer remains user-owned, while
 * generated term identity fields fill every field the user left blank.
 */
export function recoverReadWeaveGenerationFields(input: {
    draft?: ReadWeaveGenerationDraftSnapshot;
    fallbackBody?: string;
    fallbackQuestionTitle?: string;
    fallbackTermIdentity?: Partial<ReadWeaveTermIdentity>;
    job?: Pick<ReadWeaveGenerationJob, "status" | "title" | "result">;
}): ReadWeaveRecoveredGenerationFields {
    const completedResult = input.job?.status === "complete" ? input.job.result : undefined;
    const draftBody = input.draft?.body ?? "";
    const body = completedResult
        ? input.draft?.bodyEdited && draftBody.trim() ? draftBody : completedResult.body
        : draftBody || input.fallbackBody || "";
    const preferredIdentity = input.draft?.termIdentity ?? input.fallbackTermIdentity ?? {};
    const termIdentityEdited = !!input.draft?.termIdentityEdited;
    const termIdentity = completedResult?.termIdentity
        ? termIdentityEdited
            ? mergeReadWeaveTermIdentity(completedResult.termIdentity, preferredIdentity)
            : normalizeReadWeaveTermIdentityForReview(completedResult.termIdentity)
        : normalizeReadWeaveTermIdentityForReview(preferredIdentity);

    return {
        body,
        questionTitle: completedResult?.optimizedTitle?.trim()
            || input.draft?.questionTitle?.trim()
            || input.fallbackQuestionTitle?.trim()
            || input.job?.title.trim()
            || "",
        termIdentity,
        termIdentityEdited
    };
}

export function mergeReadWeaveTermIdentity(
    generated: Partial<ReadWeaveTermIdentity>,
    preferred: Partial<ReadWeaveTermIdentity>
): Partial<ReadWeaveTermIdentity> {
    const generatedClean = normalizeReadWeaveTermIdentityForReview(generated);
    const preferredClean = normalizeReadWeaveTermIdentityForReview(preferred);
    return {
        abbreviation: preferredClean.abbreviation || generatedClean.abbreviation,
        chineseName: preferredClean.chineseName || generatedClean.chineseName,
        englishName: preferredClean.englishName || generatedClean.englishName
    };
}

export function createReadWeaveReviewIssueBaseline(
    body: string,
    termIdentity?: Partial<ReadWeaveTermIdentity>
): ReadWeaveReviewIssueBaseline {
    return {
        body: normalizeReviewValue(body),
        termIdentity: termIdentity ? normalizeReviewTermIdentity(termIdentity) : undefined
    };
}

export function isReadWeaveReviewSaveAllowed(input: {
    reviewIssues: string[];
    baseline?: ReadWeaveReviewIssueBaseline;
    body: string;
    kind: ReadWeaveObjectKind;
    termIdentity?: Partial<ReadWeaveTermIdentity>;
}): boolean {
    if (input.reviewIssues.length === 0) return true;
    if (!input.baseline || typeof input.baseline.body !== "string") return false;
    if (normalizeReviewValue(input.body) !== normalizeReviewValue(input.baseline.body)) return true;
    if (input.kind !== "term") return false;
    return JSON.stringify(normalizeReviewTermIdentity(input.termIdentity))
        !== JSON.stringify(normalizeReviewTermIdentity(input.baseline.termIdentity));
}

function normalizeReviewTermIdentity(identity: Partial<ReadWeaveTermIdentity> | undefined): Partial<ReadWeaveTermIdentity> {
    return {
        abbreviation: normalizeReviewValue(identity?.abbreviation ?? ""),
        chineseName: normalizeReviewValue(identity?.chineseName ?? ""),
        englishName: normalizeReviewValue(identity?.englishName ?? "")
    };
}

function normalizeReviewValue(value: unknown): string {
    return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
}

function compareReadWeaveJobVersions(left: ReadWeaveGenerationJob, right: ReadWeaveGenerationJob): number {
    const leftTimestamp = Date.parse(left.updatedAt);
    const rightTimestamp = Date.parse(right.updatedAt);
    if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
    }
    return left.updatedAt.localeCompare(right.updatedAt);
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
