import "./ReadWeavePanel.css";

import { type CKTextEditor, updateReadWeaveAnchorIdOnRange } from "@triliumnext/ckeditor5";
import {
    KATEX_MACROS,
    type ReadWeaveAnchorSummary,
    type ReadWeaveAnchorType,
    type ReadWeaveCalloutType,
    type ReadWeaveCandidate,
    type ReadWeaveContextFragment,
    type ReadWeaveDeleteResult,
    type ReadWeaveEditMode,
    type ReadWeaveGenerateResponse,
    type ReadWeaveGenerationJob,
    type ReadWeaveGenerationProgress,
    type ReadWeaveHarnessProfile,
    type ReadWeaveImpact,
    type ReadWeaveLocalRewriteResponse,
    type ReadWeaveObject,
    type ReadWeaveObjectKind,
    type ReadWeaveResolvedEntry,
    type ReadWeaveSourceLocator,
    type ReadWeaveTermIdentity
} from "@triliumnext/commons";
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import utils from "../../services/utils.js";
import { useActiveNoteContext, useContentElement } from "../react/hooks.js";
import {
    applyReadWeaveRuntimeRangeAnchor,
    clearReadWeaveProvisionalAnchors,
    exactReadWeaveAnchorIdForExcerpt,
    exactReadWeaveExcerptRange,
    forgetReadWeaveProvisionalAnchor,
    matchingReadWeaveAnchorElements,
    mostSpecificReadWeaveAnchorId,
    protectReadWeaveProvisionalAnchor,
    provisionalReadWeaveAnchorIds,
    rangesAreNestedOrDisjoint,
    READWEAVE_PARAGRAPH_ANCHOR_SELECTOR,
    READWEAVE_RANGE_ANCHOR_SELECTOR,
    readWeaveAnchorGroupRange,
    readWeaveAnchorIdsOf,
    readWeaveRangeForSourceLocator,
    readWeaveSourceLocatorForRange,
    releaseReadWeaveProvisionalAnchors,
    removeReadWeaveRuntimeRangeAnchors,
    uniqueReadWeaveExcerptRangeWithLocator
} from "./readweave_anchor_dom.js";
import {
    applyReadWeaveGenerationVisual,
    READWEAVE_GENERATION_STATUS_CLASSES,
    readWeaveGenerationStatusClass
} from "./readweave_anchor_visuals.js";
import { applyReadWeaveLocalReplacement } from "./readweave_local_rewrite.js";
import {
    calloutAfterKindChange,
    createReadWeaveReviewIssueBaseline,
    defaultReadWeaveCallout,
    hasActiveReadWeaveGenerationJobs,
    isReadWeaveGenerationDisabled,
    isReadWeaveGenerationReviewable,
    isReadWeaveJobAutoRestoreAllowed,
    mergeReadWeaveGenerationJobSnapshot,
    normalizeReadWeaveReadableMath,
    normalizeReadWeaveTermIdentityForReview,
    readWeaveCompactStatusText,
    readWeaveGenerationProgressForDisplay,
    type ReadWeaveReviewIssueBaseline,
    recoverReadWeaveGenerationFields,
    shouldRemoveReadWeaveAnchorAfterDelete,
    upsertReadWeaveGenerationJob,
    visibleReadWeaveCandidates
} from "./readweave_panel_state.js";
import {
    decodeReadWeaveText,
    DEFAULT_READWEAVE_QUESTION_TEMPLATES,
    normalizeReadWeaveQuestionTemplates,
    rankedReadWeaveQuestionTemplates,
    READWEAVE_QUESTION_TEMPLATE_STORAGE_KEY,
    type ReadWeaveQuestionTemplate,
    recordReadWeaveTemplateUse,
    renderReadWeaveQuestionTemplate
} from "./readweave_question_templates.js";
import RightPanelWidget from "./RightPanelWidget.js";

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre";
const READWEAVE_PENDING_JOB_KEY = "readweave:pending-background-job";
const RANGE_ANCHOR_SELECTOR = READWEAVE_RANGE_ANCHOR_SELECTOR;
const PARAGRAPH_ANCHOR_SELECTOR = READWEAVE_PARAGRAPH_ANCHOR_SELECTOR;
const READWEAVE_LOCKED_ANCHOR_BY_ROOT = new WeakMap<HTMLElement, string>();

type ReadWeaveHandledMouseEvent = MouseEvent & {
    __readweaveClickHandled?: true;
};
const CALLOUT_TYPES: ReadWeaveCalloutType[] = [ "note", "tip", "important", "warning", "caution" ];
const CALLOUT_SELECTOR_TYPES: ReadWeaveCalloutType[] = [ "note", "tip" ];
const CALLOUT_ICONS: Record<ReadWeaveCalloutType, string> = {
    note: "bx bx-info-circle",
    tip: "bx bx-bulb",
    important: "bx bx-star",
    warning: "bx bx-error",
    caution: "bx bx-error-alt"
};

interface AnchorSelection {
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    excerpt: string;
    fragments: ReadWeaveContextFragment[];
    sourceLocator?: ReadWeaveSourceLocator;
    readonly?: boolean;
    pending?: boolean;
}

interface Draft {
    kind: ReadWeaveObjectKind;
    questionTitle: string;
    optimizeQuestion: boolean;
    autoApplyPlan: boolean;
    termIdentity: Partial<ReadWeaveTermIdentity>;
    termIdentityEdited?: boolean;
    body: string;
    bodyEdited?: boolean;
    calloutType: ReadWeaveCalloutType;
    reuseObjectId?: string;
    contextDecision?: ReadWeaveGenerateResponse["context"];
    generationJobId?: string;
    reviewIssues?: string[];
    reviewIssueBaseline?: ReadWeaveReviewIssueBaseline;
    parentLinkId?: string;
    newQuestionDraft?: boolean;
}

interface EditState {
    entry: ReadWeaveResolvedEntry;
    impact: ReadWeaveImpact;
    title: string;
    body: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity: Partial<ReadWeaveTermIdentity>;
    mode?: ReadWeaveEditMode;
}

interface DeleteState {
    entry: ReadWeaveResolvedEntry;
    impact: ReadWeaveImpact;
    childStrategy: "cascade" | "promote";
}

interface HoverPreview {
    entries: ReadWeaveResolvedEntry[];
    locked: boolean;
    left: number;
    top: number;
    width: number;
    maxHeight: number;
}

interface SelectionActionTarget {
    revision: number;
    identityRevision: number;
    noteId: string;
    anchorId: string;
    kind: ReadWeaveObjectKind;
    parentLinkId?: string;
}

export default function ReadWeavePanel() {
    const { note, noteId, noteContext } = useActiveNoteContext();
    const contentElement = useContentElement(noteContext);
    const activeContentRootRef = useRef<HTMLElement | null>(null);
    const articleNoteId = note?.type === "text" && note.isContentAvailable() ? noteId : undefined;
    const [selection, setSelection] = useState<AnchorSelection>();
    const [entries, setEntries] = useState<ReadWeaveResolvedEntry[]>([]);
    const [entriesLoadedAnchorId, setEntriesLoadedAnchorId] = useState<string>();
    const [anchorSummaries, setAnchorSummaries] = useState<ReadWeaveAnchorSummary[]>([]);
    const [kind, setKind] = useState<ReadWeaveObjectKind>("question");
    const [parentLinkId, setParentLinkId] = useState<string>();
    const [questionTitle, setQuestionTitle] = useState("");
    const [optimizeQuestion, setOptimizeQuestion] = useState(true);
    const [autoApplyPlan, setAutoApplyPlan] = useState(true);
    const [termIdentity, setTermIdentity] = useState<Partial<ReadWeaveTermIdentity>>({});
    const [termIdentityEdited, setTermIdentityEdited] = useState(false);
    const [body, setBody] = useState("");
    const [calloutType, setCalloutType] = useState<ReadWeaveCalloutType>("note");
    const [reuseObjectId, setReuseObjectId] = useState<string>();
    const [candidates, setCandidates] = useState<ReadWeaveCandidate[]>([]);
    const [candidateDetails, setCandidateDetails] = useState<Record<string, ReadWeaveObject>>({});
    const [contextDecision, setContextDecision] = useState<ReadWeaveGenerateResponse["context"]>();
    const [workflow, setWorkflow] = useState<ReadWeaveGenerateResponse["workflow"]>();
    const [status, setStatus] = useState<string>();
    const [statusTone, setStatusTone] = useState<"normal" | "warning" | "error">("normal");
    const [reviewIssues, setReviewIssues] = useState<string[]>([]);
    const [reviewIssueBaseline, setReviewIssueBaseline] = useState<ReadWeaveReviewIssueBaseline>();
    const [generationJobId, setGenerationJobId] = useState<string>();
    const [localDraftId, setLocalDraftId] = useState(() => `readweave-draft-${utils.randomString(20)}`);
    const [newQuestionDraft, setNewQuestionDraft] = useState(false);
    const [generationJobs, setGenerationJobs] = useState<ReadWeaveGenerationJob[]>([]);
    const [transientGenerationJob, setTransientGenerationJob] = useState<ReadWeaveGenerationJob>();
    const [loadedArticleNoteId, setLoadedArticleNoteId] = useState<string>();
    const [generationProgress, setGenerationProgress] = useState<ReadWeaveGenerationProgress[]>([]);
    const [generationPollRevision, setGenerationPollRevision] = useState(0);
    const [monitorPinned, setMonitorPinned] = useState(false);
    const [regenerationOpen, setRegenerationOpen] = useState(false);
    const [regenerationFeedback, setRegenerationFeedback] = useState("");
    const [busy, setBusy] = useState(false);
    const [bodyEditing, setBodyEditing] = useState(true);
    const [bodyEdited, setBodyEdited] = useState(false);
    const [localRewriteOpen, setLocalRewriteOpen] = useState(false);
    const [localRewriteInstruction, setLocalRewriteInstruction] = useState("");
    const [localRewriteBusy, setLocalRewriteBusy] = useState(false);
    const [localRewriteResult, setLocalRewriteResult] = useState<ReadWeaveLocalRewriteResponse>();
    const [editState, setEditState] = useState<EditState>();
    const [deleteState, setDeleteState] = useState<DeleteState>();
    const [hoverPreview, setHoverPreview] = useState<HoverPreview>();
    const [questionTemplates, setQuestionTemplates] = useState<ReadWeaveQuestionTemplate[]>(() => {
        try {
            return normalizeReadWeaveQuestionTemplates(JSON.parse(localStorage.getItem(READWEAVE_QUESTION_TEMPLATE_STORAGE_KEY) ?? "null"));
        } catch {
            return DEFAULT_READWEAVE_QUESTION_TEMPLATES.map(template => ({ ...template }));
        }
    });
    const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
    const [activeTemplateId, setActiveTemplateId] = useState<string>();
    const [customTemplateLabel, setCustomTemplateLabel] = useState("");
    const [customTemplatePattern, setCustomTemplatePattern] = useState("关于“{selection}”，");
    const hoverOpenTimer = useRef<number>();
    const hoverCloseTimer = useRef<number>();
    const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const questionTextareaRef = useRef<HTMLTextAreaElement>(null);
    const editBodyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const editTitleInputRef = useRef<HTMLInputElement>(null);
    const entriesRequestRevision = useRef(0);
    const entriesTarget = useRef<{ noteId: string; anchorId: string }>();
    const activeArticleNoteId = useRef(articleNoteId);
    const currentRefreshRevision = useRef(0);
    const generationJobsRequestRevision = useRef(0);
    const generationJobsCursor = useRef(0);
    const generationJobsRef = useRef<ReadWeaveGenerationJob[]>([]);
    const transientGenerationJobRef = useRef<ReadWeaveGenerationJob>();
    const generateAfterSelectionConfirmation = useRef<{
        noteId: string;
        excerpt: string;
        kind: ReadWeaveObjectKind;
    }>();
    const selectionActionRevision = useRef(0);
    const selectionIdentityRevision = useRef(0);
    const activeKind = useRef(kind);
    const activeParentLinkId = useRef(parentLinkId);
    const activeGenerationJobId = useRef(generationJobId);
    activeArticleNoteId.current = articleNoteId;
    activeKind.current = kind;
    activeParentLinkId.current = parentLinkId;
    activeGenerationJobId.current = generationJobId;
    generationJobsRef.current = generationJobs;
    const decorationGenerationJobs = transientGenerationJob
        ? [ transientGenerationJob, ...generationJobs ]
        : generationJobs;

    const definitionExists = kind === "term" && entries.some(entry => entry.kind === "term");
    const currentJob = generationJobs.find(job => job.jobId === generationJobId);
    const currentTransientJob = transientGenerationJob
        && transientGenerationJob.articleId === noteId
        && transientGenerationJob.anchorId === selection?.anchorId
        && transientGenerationJob.kind === kind
        && transientGenerationJob.parentLinkId === parentLinkId
        ? transientGenerationJob
        : undefined;
    const displayedJob = currentJob ?? currentTransientJob;
    const anchorJobs = selection
        ? generationJobs.filter(job =>
            job.articleId === noteId
            && job.anchorId === selection.anchorId
            && job.kind === kind
            && job.parentLinkId === parentLinkId)
        : [];
    const backgroundJobs = generationJobs.filter(job =>
        job.status === "queued"
        || job.status === "running"
        || job.status === "paused"
        || job.status === "failed"
        || (job.status === "ready-for-review" && job.unread));
    const currentTitle = kind === "question"
        ? decodeReadWeaveText(questionTitle)
        : formatPartialTermIdentity(termIdentity) || selection?.excerpt.trim() || "";
    const nestedParent = parentLinkId ? entries.find(entry => entry.linkId === parentLinkId) : undefined;
    const suggestedTemplates = rankedReadWeaveQuestionTemplates(questionTemplates, questionTitle, 5);
    const currentSourceExcerpt = selection
        ? resolveSourceExcerpt(selection, currentJob)
        : "";
    // Review findings are retained in the trace, but evidence/style advice
    // must not block a non-empty draft from being saved. Hard failures stop
    // before a job reaches this editor state.
    const reviewSaveAllowed = true;
    const saveReady = !!selection && !selection.pending && !definitionExists && !!currentTitle && !!body.trim() && !!currentSourceExcerpt && reviewSaveAllowed;
    const generationBusy = displayedJob?.status === "queued" || displayedJob?.status === "running" || displayedJob?.status === "saving";
    const hasActiveGenerationJobs = hasActiveReadWeaveGenerationJobs(generationJobs);
    const editorLocked = busy || generationBusy;
    const generationDisabled = selection?.pending
        ? busy || !noteId || !selection.excerpt.trim()
        : isReadWeaveGenerationDisabled({
            busy,
            definitionExists,
            hasSelection: !!selection,
            hasTitle: !!currentTitle,
            jobStatus: currentJob?.status,
            selectionPending: false
        });

    function captureSelectionAction(invalidateCurrent = false, invalidateIdentity = false): SelectionActionTarget | undefined {
        if (!noteId || !selection || selection.pending) return undefined;
        if (invalidateCurrent) selectionActionRevision.current += 1;
        if (invalidateIdentity) selectionIdentityRevision.current += 1;
        return {
            revision: selectionActionRevision.current,
            identityRevision: selectionIdentityRevision.current,
            noteId,
            anchorId: selection.anchorId,
            kind,
            parentLinkId
        };
    }

    function isSelectionActionCurrent(target: SelectionActionTarget, jobId?: string): boolean {
        return target.revision === selectionActionRevision.current
            && isSelectionIdentityCurrent(target, jobId);
    }

    function isSelectionIdentityCurrent(target: SelectionActionTarget, jobId?: string): boolean {
        return target.identityRevision === selectionIdentityRevision.current
            && activeArticleNoteId.current === target.noteId
            && entriesTarget.current?.noteId === target.noteId
            && entriesTarget.current.anchorId === target.anchorId
            && activeKind.current === target.kind
            && activeParentLinkId.current === target.parentLinkId
            && (!jobId || activeGenerationJobId.current === jobId);
    }

    function upsertGenerationJob(job: ReadWeaveGenerationJob) {
        generationJobsRequestRevision.current += 1;
        setGenerationJobs(current => {
            const next = upsertReadWeaveGenerationJob(current, job);
            generationJobsRef.current = next;
            return next;
        });
    }

    function hydrateGenerationJob(job: ReadWeaveGenerationJob) {
        const savedDraft = readDraft(job.articleId, job.anchorId, job.parentLinkId, job.draftId);
        setLocalDraftId(job.draftId);
        setNewQuestionDraft(false);
        setParentLinkId(job.parentLinkId);
        setGenerationJobId(job.jobId);
        setGenerationProgress(job.progress);
        setBusy(job.status === "queued" || job.status === "running");
        setRegenerationFeedback(job.feedback ?? "");
        if (!job.result) return;
        const resultReviewIssues = job.result.reviewIssues ?? [];
        const reviewedTermIdentity = job.result.termIdentity;
        const restored = recoverReadWeaveGenerationFields({ draft: savedDraft, job });
        setBody(restored.body);
        setBodyEditing(false);
        setBodyEdited(!!savedDraft?.bodyEdited);
        if (job.kind === "question") setQuestionTitle(restored.questionTitle);
        if (reviewedTermIdentity) {
            setTermIdentity(restored.termIdentity);
            setTermIdentityEdited(restored.termIdentityEdited);
        }
        setContextDecision(job.result.context);
        setWorkflow(job.result.workflow);
        setReviewIssues(resultReviewIssues);
        setReviewIssueBaseline(resultReviewIssues.length > 0
            ? createReadWeaveReviewIssueBaseline(job.result.body, job.kind === "term" ? reviewedTermIdentity : undefined)
            : undefined);
    }

    async function refreshGenerationJobs(targetNoteId: string) {
        const revision = ++generationJobsRequestRevision.current;
        const response = await server.get<{ jobs: ReadWeaveGenerationJob[]; removedJobIds: string[]; nextCursor: number }>(`readweave/generation-jobs?after=${generationJobsCursor.current}`);
        if (revision !== generationJobsRequestRevision.current || activeArticleNoteId.current !== targetNoteId) return response.jobs;
        generationJobsCursor.current = Math.max(generationJobsCursor.current, response.nextCursor);
        const mergedJobs = mergeReadWeaveGenerationJobSnapshot(generationJobsRef.current, response.jobs, response.removedJobIds);
        generationJobsRef.current = mergedJobs;
        const unchanged = mergedJobs.length === generationJobs.length
            && mergedJobs.every((job, index) => {
                const previous = generationJobs[index];
                return previous?.jobId === job.jobId
                    && previous.stateVersion === job.stateVersion
                    && previous.updatedAt === job.updatedAt;
            });
        if (!unchanged) setGenerationJobs(mergedJobs);
        const articleJobs = mergedJobs.filter(job => job.articleId === targetNoteId);
        const jobsForDecoration = transientGenerationJobRef.current
            ? [ transientGenerationJobRef.current, ...articleJobs ]
            : articleJobs;
        const root = activeContentRootRef.current;
        if (root) {
            applyGenerationJobStatusDecorations(root, jobsForDecoration);
            window.requestAnimationFrame(() => applyGenerationJobStatusDecorations(root, jobsForDecoration));
        }
        return mergedJobs;
    }

    async function markJobViewed(job: ReadWeaveGenerationJob) {
        if (!job.unread) return;
        try {
            const response = await server.patch<{ job: ReadWeaveGenerationJob | null }>(`readweave/generation-jobs/${encodeURIComponent(job.jobId)}/viewed`, {});
            if (response.job && activeArticleNoteId.current === job.articleId) upsertGenerationJob(response.job);
        } catch {
            // Viewing acknowledgement is best-effort; the persisted result remains safe.
        }
    }

    function selectionForJob(job: ReadWeaveGenerationJob): AnchorSelection {
        return {
            anchorId: job.anchorId,
            anchorType: job.anchorType,
            excerpt: job.sourceExcerpt,
            fragments: [ { id: "selected", role: "selected", text: job.sourceExcerpt } ],
            sourceLocator: job.sourceLocator
        };
    }

    async function openBackgroundJob(job: ReadWeaveGenerationJob) {
        if (job.articleId !== noteId) {
            sessionStorage.setItem(READWEAVE_PENDING_JOB_KEY, job.jobId);
            await appContext.tabManager.openTabWithNoteWithHoisting(job.articleId, { activate: true });
            return;
        }
        await selectAnchor(selectionForJob(job), job.kind);
        hydrateGenerationJob(job);
        if (job.unread) await markJobViewed(job);
    }

    async function cancelGenerationJob(job: ReadWeaveGenerationJob) {
        const response = await server.patch<{ job: ReadWeaveGenerationJob }>(`readweave/generation-jobs/${encodeURIComponent(job.jobId)}/cancel`, {});
        setGenerationJobs(current => {
            const next = upsertReadWeaveGenerationJob(current, response.job);
            generationJobsRef.current = next;
            return next;
        });
        if (generationJobId === job.jobId) hydrateGenerationJob(response.job);
    }

    async function retryBackgroundJob(job: ReadWeaveGenerationJob) {
        const response = await server.post<{ job: ReadWeaveGenerationJob }>(
            `readweave/generation-jobs/${encodeURIComponent(job.jobId)}/regenerate`, {}
        );
        upsertGenerationJob(response.job);
        if (generationJobId === job.jobId) {
            hydrateGenerationJob(response.job);
            setGenerationPollRevision(current => current + 1);
        }
    }

    async function removeBackgroundJob(job: ReadWeaveGenerationJob) {
        await server.remove(`readweave/generation-jobs/${encodeURIComponent(job.jobId)}`);
        generationJobsRequestRevision.current += 1;
        setGenerationJobs(current => {
            const next = current.filter(candidate => candidate.jobId !== job.jobId);
            generationJobsRef.current = next;
            return next;
        });
        if (generationJobId === job.jobId) {
            setGenerationJobId(undefined);
            setBusy(false);
        }
    }

    async function refreshCurrent(targetNoteId: string, anchorId?: string) {
        const revision = ++currentRefreshRevision.current;
        const [ summaryResponse ] = await Promise.all([
            server.get<{ anchors: ReadWeaveAnchorSummary[] }>(`readweave/articles/${encodeURIComponent(targetNoteId)}/anchors`),
            refreshGenerationJobs(targetNoteId)
        ]);
        if (revision !== currentRefreshRevision.current || activeArticleNoteId.current !== targetNoteId) return;
        setAnchorSummaries(summaryResponse.anchors);
        setLoadedArticleNoteId(targetNoteId);
        if (anchorId) await refreshEntriesForAnchor(targetNoteId, anchorId);
    }

    async function refreshEntriesForAnchor(targetNoteId: string, anchorId: string) {
        if (entriesTarget.current?.noteId !== targetNoteId || entriesTarget.current.anchorId !== anchorId) return;
        const revision = ++entriesRequestRevision.current;
        const response = await loadReadWeaveEntries(targetNoteId, anchorId);
        if (revision !== entriesRequestRevision.current) return;
        if (entriesTarget.current?.noteId !== targetNoteId || entriesTarget.current.anchorId !== anchorId) return;
        setEntries(response);
    }

    async function selectAnchor(nextSelection: AnchorSelection, preferredKind?: ReadWeaveObjectKind) {
        entriesRequestRevision.current += 1;
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        entriesTarget.current = { noteId: noteId!, anchorId: nextSelection.anchorId };
        setEntries([]);
        setEntriesLoadedAnchorId(undefined);
        setSelection(nextSelection);
        setStatus(undefined);
        setStatusTone("normal");
        setEditState(undefined);
        setDeleteState(undefined);
        setParentLinkId(undefined);
        const draft = readDraft(noteId!, nextSelection.anchorId);
        const nextKind = preferredKind ?? draft?.kind ?? "question";
        const matchingDraft = draft?.kind === nextKind ? draft : undefined;
        const matchingJob = matchingDraft?.newQuestionDraft
            ? undefined
            : generationJobs.find(job =>
                job.anchorId === nextSelection.anchorId
                && job.kind === nextKind
                && !job.parentLinkId);
        const confirmingPendingSelection = selection?.pending
            && normalizedAnchorText(selection.excerpt) === normalizedAnchorText(nextSelection.excerpt);
        setKind(nextKind);
        setNewQuestionDraft(!!matchingDraft?.newQuestionDraft && nextKind === "question");
        setQuestionTitle(matchingDraft?.questionTitle
            ?? (nextKind === "question"
                ? confirmingPendingSelection && questionTitle.trim() ? questionTitle : matchingJob?.title || defaultQuestionForExcerpt(decodeReadWeaveText(nextSelection.excerpt))
                : ""));
        setOptimizeQuestion(matchingDraft?.optimizeQuestion ?? (confirmingPendingSelection ? optimizeQuestion : true));
        setAutoApplyPlan(matchingDraft?.autoApplyPlan ?? true);
        const restoredFields = recoverReadWeaveGenerationFields({
            draft: matchingDraft,
            fallbackBody: confirmingPendingSelection ? body : "",
            fallbackQuestionTitle: nextKind === "question"
                ? confirmingPendingSelection && questionTitle.trim() ? questionTitle : matchingJob?.title || defaultQuestionForExcerpt(decodeReadWeaveText(nextSelection.excerpt))
                : "",
            fallbackTermIdentity: confirmingPendingSelection ? cleanPartialTermIdentity(termIdentity) : initialTermIdentity(nextSelection.excerpt, nextKind),
            job: matchingJob
        });
        const nextTermIdentity = restoredFields.termIdentity;
        const nextBody = restoredFields.body;
        if (nextKind === "question") setQuestionTitle(restoredFields.questionTitle);
        const nextReviewIssues = matchingDraft?.reviewIssues ?? matchingJob?.result?.reviewIssues ?? [];
        setTermIdentity(nextTermIdentity);
        setTermIdentityEdited(restoredFields.termIdentityEdited);
        setBody(nextBody);
        setBodyEdited(!!matchingDraft?.bodyEdited && !!matchingDraft.body.trim());
        const pendingCallout = confirmingPendingSelection && nextKind !== kind
            ? calloutAfterKindChange(calloutType, nextKind)
            : calloutType;
        setCalloutType(matchingDraft
            ? calloutAfterKindChange(matchingDraft.calloutType, nextKind)
            : confirmingPendingSelection ? pendingCallout : defaultReadWeaveCallout(nextKind));
        setReuseObjectId(matchingDraft?.reuseObjectId);
        setContextDecision(matchingDraft?.contextDecision ?? matchingJob?.result?.context);
        setWorkflow(matchingJob?.result?.workflow);
        setGenerationProgress(matchingJob?.progress ?? []);
        setGenerationJobId(matchingDraft?.generationJobId ?? matchingJob?.jobId);
        setLocalDraftId(matchingJob?.draftId ?? `readweave-draft-${utils.randomString(20)}`);
        setReviewIssues(nextReviewIssues);
        setReviewIssueBaseline(matchingDraft?.reviewIssueBaseline
            ?? (nextReviewIssues.length > 0
                ? createReadWeaveReviewIssueBaseline(
                    matchingJob?.result?.body ?? nextBody,
                    nextKind === "term" ? matchingJob?.result?.termIdentity ?? nextTermIdentity : undefined
                )
                : undefined));
        setRegenerationFeedback(matchingJob?.feedback ?? "");
        setRegenerationOpen(false);
        setMonitorPinned(false);
        setBodyEditing(!(matchingJob?.result?.body || matchingDraft?.generationJobId));
        setBusy(matchingJob?.status === "queued" || matchingJob?.status === "running");
        if (isReadWeaveGenerationReviewable(matchingJob?.status) && matchingJob?.unread) void markJobViewed(matchingJob);
        try {
            await refreshEntriesForAnchor(noteId!, nextSelection.anchorId);
        } catch {
            // Loading saved entries is advisory for questions and the server
            // remains the final authority for term uniqueness. A transient
            // read failure must not strand a confirmed selection in a state
            // where its direct Generate action can never continue.
            if (entriesTarget.current?.noteId === noteId && entriesTarget.current.anchorId === nextSelection.anchorId) {
                setEntries([]);
            }
        } finally {
            if (entriesTarget.current?.noteId === noteId && entriesTarget.current.anchorId === nextSelection.anchorId) {
                setEntriesLoadedAnchorId(nextSelection.anchorId);
            }
        }
    }

    function previewSelection(nextSelection: AnchorSelection) {
        entriesRequestRevision.current += 1;
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        entriesTarget.current = undefined;
        window.clearTimeout(hoverOpenTimer.current);
        window.clearTimeout(hoverCloseTimer.current);
        setHoverPreview(undefined);
        setSelection(current => current?.pending && current.excerpt === nextSelection.excerpt ? current : nextSelection);
        setEntries([]);
        setEntriesLoadedAnchorId(undefined);
        setEditState(undefined);
        setDeleteState(undefined);
        setKind("question");
        setNewQuestionDraft(false);
        setParentLinkId(undefined);
        setQuestionTitle("");
        setOptimizeQuestion(true);
        setAutoApplyPlan(true);
        setTermIdentity({});
        setTermIdentityEdited(false);
        setBody("");
        setBodyEditing(true);
        setCalloutType(defaultReadWeaveCallout("question"));
        setReuseObjectId(undefined);
        setCandidates([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setLocalDraftId(`readweave-draft-${utils.randomString(20)}`);
        setNewQuestionDraft(false);
        setGenerationProgress([]);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
        setStatus(undefined);
        setStatusTone("normal");
        setBusy(false);
    }

    const confirmPendingSelection = useAnchorInteractions({
        noteId: articleNoteId,
        noteContext,
        contentElement,
        onContentRoot(root) {
            activeContentRootRef.current = root;
        },
        summaries: anchorSummaries,
        generationJobs: decorationGenerationJobs,
        dataReady: loadedArticleNoteId === articleNoteId,
        activeAnchorId: selection?.pending ? undefined : selection?.anchorId,
        onSelect: selectAnchor,
        onSelectionPreview: previewSelection,
        onStatus: setStatus,
        onHover(entries, rect, locked, avoidRect) {
            window.clearTimeout(hoverCloseTimer.current);
            window.clearTimeout(hoverOpenTimer.current);
            hoverOpenTimer.current = window.setTimeout(() => {
                const paneRect = document.querySelector("#right-pane")?.getBoundingClientRect();
                const editorRight = paneRect ? paneRect.left - 10 : window.innerWidth - 12;
                const availableWidth = Math.max(200, editorRight - 24);
                const width = Math.min(360, availableWidth);
                const exclusion = avoidRect ?? rect;
                const rightOfFragment = exclusion.right + 10;
                const leftOfFragment = exclusion.left - width - 10;
                const fitsRight = rightOfFragment + width <= editorRight;
                const fitsLeft = leftOfFragment >= 12;
                const preferredLeft = fitsRight ? rightOfFragment : fitsLeft ? leftOfFragment : rect.left;
                const left = Math.max(12, Math.min(preferredLeft, editorRight - width));
                const maxPreviewHeight = Math.min(400, window.innerHeight - 24);
                let maxHeight = maxPreviewHeight;
                let top: number;
                if (fitsRight || fitsLeft) {
                    top = Math.max(12, Math.min(rect.top, window.innerHeight - maxPreviewHeight - 12));
                } else {
                    // On narrow layouts the preview has to share the editor's
                    // horizontal lane. Put it wholly above or below the source
                    // block and cap its height to that lane; otherwise even a
                    // few pixels of overlap make the locked fragment impossible
                    // to click again.
                    const spaceAbove = Math.max(0, exclusion.top - 22);
                    const spaceBelow = Math.max(0, window.innerHeight - exclusion.bottom - 22);
                    const placeBelow = spaceBelow >= spaceAbove;
                    maxHeight = Math.max(24, Math.min(maxPreviewHeight, placeBelow ? spaceBelow : spaceAbove));
                    top = placeBelow
                        ? exclusion.bottom + 10
                        : Math.max(12, exclusion.top - maxHeight - 10);
                }
                setHoverPreview({
                    entries,
                    locked,
                    left,
                    top,
                    width,
                    maxHeight
                });
            }, 40);
        },
        onHoverLeave: scheduleHoverClose,
        onHoverClear() {
            window.clearTimeout(hoverOpenTimer.current);
            window.clearTimeout(hoverCloseTimer.current);
            setHoverPreview(undefined);
        }
    });

    function scheduleHoverClose() {
        window.clearTimeout(hoverOpenTimer.current);
        window.clearTimeout(hoverCloseTimer.current);
        hoverCloseTimer.current = window.setTimeout(() => {
            setHoverPreview(undefined);
        }, 120);
    }

    useEffect(() => {
        entriesRequestRevision.current += 1;
        entriesTarget.current = undefined;
        currentRefreshRevision.current += 1;
        generationJobsRequestRevision.current += 1;
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        setLoadedArticleNoteId(undefined);
        setSelection(undefined);
        setParentLinkId(undefined);
        setEntries([]);
        setEntriesLoadedAnchorId(undefined);
        setEditState(undefined);
        setDeleteState(undefined);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setNewQuestionDraft(false);
        transientGenerationJobRef.current = undefined;
        setTransientGenerationJob(undefined);
        setGenerationProgress([]);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
        setStatus(undefined);
        setStatusTone("normal");
        setBusy(false);
        if (!articleNoteId) {
            setAnchorSummaries([]);
            return;
        }
        refreshCurrent(articleNoteId).catch(() => {
            if (activeArticleNoteId.current === articleNoteId) setAnchorSummaries([]);
        });
    }, [noteId, articleNoteId]);

    useEffect(() => {
        if (!articleNoteId || !hasActiveGenerationJobs) return;
        const interval = window.setInterval(() => {
            refreshGenerationJobs(articleNoteId).catch(() => undefined);
        }, 2_000);
        return () => window.clearInterval(interval);
    }, [articleNoteId, hasActiveGenerationJobs]);

    useEffect(() => {
        const pendingJobId = sessionStorage.getItem(READWEAVE_PENDING_JOB_KEY);
        if (!pendingJobId || !noteId) return;
        const pendingJob = generationJobs.find(job => job.jobId === pendingJobId && job.articleId === noteId);
        if (!pendingJob) return;
        sessionStorage.removeItem(READWEAVE_PENDING_JOB_KEY);
        void selectAnchor(selectionForJob(pendingJob), pendingJob.kind).then(() => {
            hydrateGenerationJob(pendingJob);
            if (pendingJob.unread) void markJobViewed(pendingJob);
        });
    }, [noteId, generationJobs]);

    useEffect(() => {
        if (!selection) return;
        if (!isReadWeaveJobAutoRestoreAllowed({
            hasSelection: true,
            selectionPending: !!selection.pending,
            generationJobId,
            newQuestionDraft
        })) return;
        const restored = generationJobs.find(job =>
            job.articleId === noteId
            && job.anchorId === selection.anchorId
            && job.kind === kind
            && job.parentLinkId === parentLinkId);
        if (!restored) return;
        hydrateGenerationJob(restored);
        if (isReadWeaveGenerationReviewable(restored.status) && restored.unread) void markJobViewed(restored);
    }, [generationJobs, selection?.anchorId, selection?.pending, kind, parentLinkId, generationJobId, newQuestionDraft]);

    useEffect(() => {
        const requested = generateAfterSelectionConfirmation.current;
        if (!requested || !noteId || !selection || selection.pending) return;
        if (requested.noteId !== noteId
            || requested.kind !== kind
            || normalizedAnchorText(requested.excerpt) !== normalizedAnchorText(selection.excerpt)) {
            generateAfterSelectionConfirmation.current = undefined;
            return;
        }
        // Multiple questions may share one exact fragment, so their direct
        // Generate action must not wait for the saved-entry lookup. Terms wait
        // for that lookup to preserve the one-definition-per-fragment rule.
        if (kind === "term" && entriesLoadedAnchorId !== selection.anchorId) return;
        if (generationDisabled) {
            // Once the confirmed selection has reached a stable disabled state
            // (existing definition, active job, etc.), do not leave a latent
            // request that could fire later without another user click.
            generateAfterSelectionConfirmation.current = undefined;
            return;
        }
        generateAfterSelectionConfirmation.current = undefined;
        void generate();
    }, [noteId, selection?.anchorId, selection?.pending, selection?.excerpt, entriesLoadedAnchorId, kind, generationDisabled]);

    useEffect(() => {
        if (!noteId || !selection) return;
        const draft: Draft = { kind, questionTitle, optimizeQuestion, autoApplyPlan, termIdentity, termIdentityEdited, body, bodyEdited, calloutType, reuseObjectId, contextDecision, generationJobId, reviewIssues, reviewIssueBaseline, parentLinkId, newQuestionDraft };
        const isolatedDraftId = currentJob?.draftId ?? generationJobId ?? localDraftId;
        sessionStorage.setItem(draftKey(noteId, selection.anchorId, parentLinkId, isolatedDraftId), JSON.stringify(draft));
        sessionStorage.setItem(draftKey(noteId, selection.anchorId, parentLinkId), JSON.stringify(draft));
    }, [noteId, selection, kind, parentLinkId, questionTitle, optimizeQuestion, autoApplyPlan, termIdentity, termIdentityEdited, body, bodyEdited, calloutType, reuseObjectId, contextDecision, generationJobId, currentJob?.draftId, localDraftId, reviewIssues, reviewIssueBaseline, newQuestionDraft]);

    useEffect(() => {
        localStorage.setItem(READWEAVE_QUESTION_TEMPLATE_STORAGE_KEY, JSON.stringify(questionTemplates));
    }, [questionTemplates]);

    useEffect(() => {
        if (!generationJobId) return;
        const capturedTarget = captureSelectionAction();
        if (!capturedTarget) return;
        const target: SelectionActionTarget = capturedTarget;
        const polledJobId = generationJobId;
        let cancelled = false;
        let accumulated = generationProgress;
        let cursor = accumulated.at(-1)?.sequence ?? 0;
        async function poll() {
            while (!cancelled) {
                if (!isSelectionActionCurrent(target, polledJobId)) return;
                try {
                    const response = await server.getWithSilentNotFound<{ job: ReadWeaveGenerationJob | null; events: ReadWeaveGenerationProgress[]; nextSequence: number }>(`readweave/generation-jobs/${encodeURIComponent(polledJobId)}/events?after=${cursor}`);
                    if (cancelled || !isSelectionActionCurrent(target, polledJobId)) return;
                    const job = response.job;
                    if (!job) {
                        generationJobsRequestRevision.current += 1;
                        setGenerationJobs(current => {
                            const next = current.filter(candidate => candidate.jobId !== polledJobId);
                            generationJobsRef.current = next;
                            return next;
                        });
                        setGenerationJobId(undefined);
                        setBusy(false);
                        return;
                    }
                    cursor = response.nextSequence;
                    accumulated = [ ...accumulated, ...response.events ].filter((event, index, all) =>
                        all.findIndex(candidate => candidate.sequence === event.sequence) === index
                    ).slice(-200);
                    setGenerationProgress(accumulated);
                    upsertGenerationJob({ ...job, progress: accumulated });
                    if (job.status === "running" || job.status === "queued" || job.status === "saving") {
                        await delay(600);
                        continue;
                    }
                    if (!isReadWeaveGenerationReviewable(job.status) || !job.result) {
                        setBusy(false);
                        return;
                    }
                    hydrateGenerationJob({ ...job, progress: accumulated });
                    await refreshCurrent(target.noteId, target.anchorId);
                    if (job.savedLinkId
                        && isSelectionActionCurrent(target, polledJobId)
                        && entriesTarget.current?.noteId === target.noteId
                        && entriesTarget.current.anchorId === target.anchorId) {
                        // The generation result and its saved link become
                        // visible in the same polling turn. A concurrent
                        // decoration refresh can otherwise overwrite the
                        // freshly loaded entry list with its earlier empty
                        // snapshot until the user reselects the fragment.
                        const savedEntries = await loadReadWeaveEntries(target.noteId, target.anchorId);
                        if (isSelectionActionCurrent(target, polledJobId)
                            && entriesTarget.current?.noteId === target.noteId
                            && entriesTarget.current.anchorId === target.anchorId) {
                            setEntries(savedEntries);
                        }
                    }
                    // Finishing a job is a notification event, not a user-view
                    // event. Keep the persisted unread state (and its green
                    // exact-range indicator) until the user deliberately
                    // selects the fragment. This is especially important when
                    // a saved term and a newly generated question share one
                    // anchor: the visible result must not silently consume its
                    // own completion notification.
                    if (isSelectionActionCurrent(target, polledJobId)) setBusy(false);
                    return;
                } catch (error) {
                    if (cancelled || !isSelectionActionCurrent(target, polledJobId)) return;
                    setStatus(readableError(error, t("readweave.generate_failed_no_fallback")));
                    setStatusTone("error");
                    setBusy(false);
                    return;
                }
            }
        }
        void poll();
        return () => { cancelled = true; };
    }, [generationJobId, generationPollRevision]);

    function applyCurrentGenerationVisual(job: ReadWeaveGenerationJob) {
        const root = activeContentRootRef.current;
        if (root) applyReadWeaveGenerationVisual(root, job);
    }

    useEffect(() => {
        if (!currentTitle) {
            setCandidates([]);
            return;
        }
        let cancelled = false;
        const timeout = window.setTimeout(async () => {
            try {
                const response = await server.post<{ candidates: ReadWeaveCandidate[] }>("readweave/candidates", {
                    title: currentTitle,
                    kind,
                    termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined
                });
                if (!cancelled) setCandidates(visibleReadWeaveCandidates(response.candidates));
            } catch {
                if (!cancelled) setCandidates([]);
            }
        }, 350);
        return () => {
            cancelled = true;
            window.clearTimeout(timeout);
        };
    }, [currentTitle, kind, termIdentity]);

    async function generate() {
        if (!noteId || !selection || generationDisabled) return;
        if (currentJob && normalizedAnchorText(currentJob.title) === normalizedAnchorText(currentTitle)) {
            await regenerateDraft();
            return;
        }
        const target = captureSelectionAction(true, true);
        if (!target) return;
        const transientJob = createTransientGenerationJob({
            articleId: noteId,
            anchorId: selection.anchorId,
            anchorType: selection.anchorType,
            kind,
            parentLinkId,
            title: currentTitle,
            sourceExcerpt: selection.excerpt,
            sourceLocator: selection.sourceLocator
        });
        transientGenerationJobRef.current = transientJob;
        setTransientGenerationJob(transientJob);
        applyCurrentGenerationVisual(transientJob);
        setBusy(true);
        setStatus(undefined);
        setStatusTone("normal");
        setGenerationProgress(transientJob.progress);
        setBodyEdited(false);
        setReuseObjectId(undefined);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
        try {
            await persistReadWeaveAnchor(noteContext, selection);
            if (!await readWeaveAnchorIsPresent(noteContext, selection.anchorId, selection.readonly)) {
                throw new Error(t("readweave.anchor_lost_before_generation"));
            }
            const response = await server.post<{ job: ReadWeaveGenerationJob }>("readweave/generation-jobs", {
                articleId: noteId,
                anchorId: selection.anchorId,
                anchorType: selection.anchorType,
                kind,
                calloutType,
                parentLinkId,
                rootSourceExcerpt: selection.excerpt,
                sourceLocator: selection.sourceLocator,
                title: currentTitle,
                optimizeQuestion: kind === "question" ? optimizeQuestion : undefined,
                autoApplyPlan,
                termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined,
                fragments: nestedParent
                    ? nestedQuestionFragments(entries, nestedParent, selection.fragments)
                    : selection.fragments
            });
            if (transientGenerationJobRef.current?.jobId === transientJob.jobId) {
                transientGenerationJobRef.current = undefined;
                setTransientGenerationJob(undefined);
            }
            if (activeArticleNoteId.current === target.noteId) upsertGenerationJob(response.job);
            applyCurrentGenerationVisual(response.job);
            if (!isSelectionActionCurrent(target)) return;
            setGenerationProgress(response.job.progress);
            setGenerationJobId(response.job.jobId);
            setNewQuestionDraft(false);
            setGenerationPollRevision(current => current + 1);
            setMonitorPinned(false);
            setRegenerationOpen(false);
        } catch (error) {
            const message = readableError(error, t("readweave.generate_failed_no_fallback"));
            if (transientGenerationJobRef.current?.jobId === transientJob.jobId) {
                const failedJob: ReadWeaveGenerationJob = {
                    ...transientJob,
                    status: "failed",
                    error: message,
                    updatedAt: new Date().toISOString(),
                    progress: [
                        ...transientJob.progress,
                        {
                            sequence: 2,
                            timestamp: new Date().toISOString(),
                            elapsedMs: Math.max(0, Date.now() - Date.parse(transientJob.createdAt)),
                            stage: "failed",
                            round: 0,
                            message,
                            issues: []
                        }
                    ]
                };
                transientGenerationJobRef.current = failedJob;
                setTransientGenerationJob(failedJob);
                applyCurrentGenerationVisual(failedJob);
                if (isSelectionActionCurrent(target)) setGenerationProgress(failedJob.progress);
            }
            if (!isSelectionActionCurrent(target)) return;
            setStatus(message);
            setStatusTone("error");
            setBusy(false);
        }
    }

    function generateFromCurrentSelection() {
        if (!noteId || !selection || generationDisabled) return;
        if (selection.pending) {
            generateAfterSelectionConfirmation.current = {
                noteId,
                excerpt: selection.excerpt,
                kind
            };
            if (!confirmPendingSelection(kind)) {
                generateAfterSelectionConfirmation.current = undefined;
            }
            return;
        }
        void generate();
    }

    async function applyLocalRewrite() {
        const textarea = bodyTextareaRef.current;
        if (!textarea || !localRewriteInstruction.trim()) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        if (start === end) {
            setStatus("请先在回答中选中需要修改的文字");
            setStatusTone("warning");
            return;
        }
        const selectedText = body.slice(start, end);
        setLocalRewriteBusy(true);
        setStatus("正在只修改选中文字");
        setStatusTone("normal");
        try {
            const result = await server.post<ReadWeaveLocalRewriteResponse>("readweave/rewrite-local", {
                body,
                selectedText,
                contextBefore: body.slice(Math.max(0, start - 500), start),
                contextAfter: body.slice(end, Math.min(body.length, end + 500)),
                instruction: localRewriteInstruction
            });
            if (result.scope !== "selection-only" || result.original !== selectedText) {
                throw new Error("局部改写范围校验失败，原回答未修改");
            }
            const nextBody = applyReadWeaveLocalReplacement({ body, selectedText, replacement: result.replacement, start, end });
            setBody(nextBody);
            setBodyEdited(true);
            setLocalRewriteResult(result);
            setLocalRewriteOpen(false);
            setLocalRewriteInstruction("");
            setStatus("已完成局部修改，选区之外的内容未改变");
            setStatusTone("normal");
            window.requestAnimationFrame(() => {
                const nextTextarea = bodyTextareaRef.current;
                if (!nextTextarea) return;
                nextTextarea.focus();
                nextTextarea.setSelectionRange(start, start + result.replacement.length);
            });
        } catch (error) {
            setStatus(readableError(error, "局部修改未应用，原回答保持不变"));
            setStatusTone("error");
        } finally {
            setLocalRewriteBusy(false);
        }
    }

    async function save() {
        if (!noteId || !selection || !saveReady) return;
        const target = captureSelectionAction(true, true);
        if (!target) return;
        const completedJobId = generationJobId;
        setBusy(true);
        setStatus(t("readweave.saving"));
        setStatusTone("normal");
        try {
            const reviewedBody = bodyTextareaRef.current?.value ?? body;
            const reviewedTitle = kind === "question"
                ? decodeReadWeaveText(questionTextareaRef.current?.value ?? questionTitle)
                : currentTitle;
            let committedJob: ReadWeaveGenerationJob | undefined;
            if (completedJobId && currentJob) {
                // Generation force-snapshotted the editable anchor before
                // creating the job. Only repair a missing DOM anchor here; a
                // second unconditional force snapshot would issue an
                // identical PUT.
                if (!await readWeaveAnchorIsPresent(noteContext, selection.anchorId, selection.readonly)) {
                    await persistReadWeaveAnchor(noteContext, selection);
                }
                const response = await server.post<{ job: ReadWeaveGenerationJob }>(`readweave/generation-jobs/${encodeURIComponent(completedJobId)}/commit`, {
                    expectedStateVersion: currentJob.stateVersion,
                    title: reviewedTitle,
                    body: reviewedBody,
                    calloutType,
                    termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined
                });
                committedJob = response.job;
                upsertGenerationJob(response.job);
                if (isSelectionActionCurrent(target, completedJobId)) hydrateGenerationJob(response.job);
            } else {
                // A direct save/reuse path may not have gone through
                // generation, so its editable model anchor still needs the
                // normal force snapshot even when it is already present.
                await persistReadWeaveAnchor(noteContext, selection);
                await server.post("readweave/entries", {
                    articleId: noteId,
                    anchorId: selection.anchorId,
                    anchorType: selection.anchorType,
                    kind,
                    parentLinkId,
                    title: reviewedTitle,
                    body: reviewedBody,
                    sourceExcerpt: currentSourceExcerpt,
                    sourceLocator: selection.sourceLocator,
                    calloutType,
                    termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined,
                    reuseObjectId
                });
            }
            sessionStorage.removeItem(draftKey(target.noteId, target.anchorId, target.parentLinkId, currentJob?.draftId ?? completedJobId ?? localDraftId));
            sessionStorage.removeItem(draftKey(target.noteId, target.anchorId, target.parentLinkId));
            if (activeArticleNoteId.current === target.noteId) await refreshCurrent(target.noteId, target.anchorId);
            if (isSelectionActionCurrent(target)) {
                setStatus(t("readweave.saved"));
                if (!committedJob) resetEditor(target.kind);
            }
        } catch (error) {
            if (isSelectionActionCurrent(target)) {
                setStatus(readableError(error, t("readweave.save_failed")));
                setStatusTone("error");
            }
        } finally {
            if (isSelectionActionCurrent(target)) setBusy(false);
        }
    }

    async function discardDraft() {
        if (!noteId || !selection || !generationJobId) return;
        const target = captureSelectionAction(true, true);
        if (!target) return;
        const discardedJobId = generationJobId;
        setBusy(true);
        setGenerationJobId(undefined);
        try {
            await delay(0);
            await server.remove(`readweave/generation-jobs/${encodeURIComponent(discardedJobId)}`);
            const hasOtherDraft = generationJobs.some(job => job.jobId !== discardedJobId && job.anchorId === selection.anchorId);
            const removeAnchor = entries.length === 0 && !hasOtherDraft;
            if (removeAnchor) await removeProvisionalAnchor(noteContext, selection.anchorId, selection.readonly);
            sessionStorage.removeItem(draftKey(target.noteId, target.anchorId, target.parentLinkId, currentJob?.draftId ?? discardedJobId));
            sessionStorage.removeItem(draftKey(target.noteId, target.anchorId, target.parentLinkId));
            generationJobsRequestRevision.current += 1;
            if (activeArticleNoteId.current === target.noteId) {
                setGenerationJobs(current => {
                    const next = current.filter(job => job.jobId !== discardedJobId);
                    generationJobsRef.current = next;
                    return next;
                });
            }
            if (isSelectionActionCurrent(target)) {
                resetEditor(target.kind);
                setStatus(t("readweave.draft_discarded"));
                setStatusTone("normal");
                setBusy(false);
                if (removeAnchor) {
                    entriesRequestRevision.current += 1;
                    selectionActionRevision.current += 1;
                    selectionIdentityRevision.current += 1;
                    entriesTarget.current = undefined;
                    setSelection(undefined);
                    setEntries([]);
                }
            }
        } catch (error) {
            if (!isSelectionActionCurrent(target)) return;
            setGenerationJobId(discardedJobId);
            setStatus(readableError(error, t("readweave.discard_failed")));
            setStatusTone("error");
        } finally {
            if (isSelectionActionCurrent(target)) setBusy(false);
        }
    }

    async function regenerateDraft() {
        if (!generationJobId) return;
        if (bodyEdited && !window.confirm(t("readweave.regenerate_overwrite_confirm"))) return;
        const regeneratedJobId = generationJobId;
        const target = captureSelectionAction(true, true);
        if (!target) return;
        const optimisticJob = createOptimisticRegenerationJob({
            jobId: regeneratedJobId,
            previous: currentJob,
            articleId: target.noteId,
            anchorId: target.anchorId,
            anchorType: selection!.anchorType,
            kind: target.kind,
            parentLinkId: target.parentLinkId,
            title: currentTitle,
            sourceExcerpt: currentSourceExcerpt || selection!.excerpt,
            sourceLocator: selection!.sourceLocator,
            feedback: regenerationFeedback.trim() || undefined
        });
        upsertGenerationJob(optimisticJob);
        applyCurrentGenerationVisual(optimisticJob);
        setBusy(true);
        setStatus(undefined);
        setStatusTone("normal");
        setGenerationProgress(optimisticJob.progress);
        setBodyEdited(false);
        try {
            const response = await server.post<{ job: ReadWeaveGenerationJob }>(`readweave/generation-jobs/${encodeURIComponent(regeneratedJobId)}/regenerate`, {
                feedback: regenerationFeedback.trim() || undefined,
                title: currentTitle,
                optimizeQuestion: kind === "question" ? optimizeQuestion : undefined,
                autoApplyPlan,
                calloutType,
                termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined,
                fragments: nestedParent
                    ? nestedQuestionFragments(entries, nestedParent, selection!.fragments)
                    : selection!.fragments
            });
            if (activeArticleNoteId.current === target.noteId) upsertGenerationJob(response.job);
            applyCurrentGenerationVisual(response.job);
            if (!isSelectionActionCurrent(target, regeneratedJobId)) return;
            hydrateGenerationJob(response.job);
            setGenerationPollRevision(current => current + 1);
            setRegenerationOpen(false);
            setMonitorPinned(true);
        } catch (error) {
            const message = readableError(error, t("readweave.regenerate_failed"));
            const failedAt = nextReadWeaveJobTimestamp(optimisticJob.updatedAt);
            const failedJob: ReadWeaveGenerationJob = {
                ...optimisticJob,
                status: "failed",
                error: message,
                updatedAt: failedAt,
                progress: [
                    ...optimisticJob.progress,
                    {
                        sequence: (optimisticJob.progress.at(-1)?.sequence ?? 0) + 1,
                        timestamp: failedAt,
                        elapsedMs: Math.max(0, Date.parse(failedAt) - Date.parse(optimisticJob.createdAt)),
                        stage: "failed",
                        round: 0,
                        message: t("readweave.generate_failed"),
                        issues: []
                    }
                ]
            };
            if (activeArticleNoteId.current === target.noteId) upsertGenerationJob(failedJob);
            applyCurrentGenerationVisual(failedJob);
            if (!isSelectionActionCurrent(target, regeneratedJobId)) return;
            setGenerationProgress(failedJob.progress);
            setStatus(message);
            setStatusTone("error");
            setBusy(false);
        }
    }

    async function addCurrentAnswerToRegression() {
        if (!currentJob?.result?.body || !currentTitle.trim()) return;
        setBusy(true);
        try {
            const listed = await server.get<{ profiles: ReadWeaveHarnessProfile[] }>("readweave/harness");
            let editable = listed.profiles.find(profile => profile.status === "draft" || profile.status === "trial");
            if (!editable) {
                const published = listed.profiles.find(profile => profile.status === "published");
                editable = (await server.post<{ profile: ReadWeaveHarnessProfile }>("readweave/harness", {
                    sourceVersionId: published?.versionId,
                    name: "用户反馈回归草稿"
                })).profile;
            }
            await server.post(`readweave/harness/${encodeURIComponent(editable.versionId)}/cases`, {
                category: "用户反馈",
                question: currentTitle.trim(),
                badAnswer: currentJob.result.body,
                referenceAnswer: body.trim() && body.trim() !== currentJob.result.body.trim() ? body.trim() : undefined,
                expectedFacts: [],
                forbiddenClaims: [],
                critical: true
            });
            setStatus("已加入质量控制中心的回归草稿");
            setStatusTone("normal");
        } catch (error) {
            setStatus(readableError(error, "加入回归集失败"));
            setStatusTone("error");
        } finally {
            setBusy(false);
        }
    }

    function resetEditor(currentKind: ReadWeaveObjectKind) {
        setLocalRewriteOpen(false);
        setLocalRewriteInstruction("");
        setLocalRewriteResult(undefined);
        setNewQuestionDraft(false);
        setQuestionTitle(currentKind === "question" && selection && !selection.pending
            ? defaultQuestionForExcerpt(selection.excerpt)
            : "");
        setTermIdentity(initialTermIdentity(selection?.excerpt ?? "", currentKind));
        setTermIdentityEdited(false);
        setBody("");
        setBodyEdited(false);
        setBodyEditing(true);
        setReuseObjectId(undefined);
        setCandidates([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setLocalDraftId(`readweave-draft-${utils.randomString(20)}`);
        setGenerationProgress([]);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
    }

    async function loadCandidate(candidate: ReadWeaveCandidate) {
        if (candidateDetails[candidate.objectId]) return;
        const response = await server.get<{ object: ReadWeaveObject }>(`readweave/objects/${encodeURIComponent(candidate.objectId)}`);
        setCandidateDetails(current => ({ ...current, [candidate.objectId]: response.object }));
    }

    async function reuse(candidate: ReadWeaveCandidate) {
        const target = captureSelectionAction(true, true);
        if (!target) return;
        let object = candidateDetails[candidate.objectId];
        if (!object) {
            const response = await server.get<{ object: ReadWeaveObject }>(`readweave/objects/${encodeURIComponent(candidate.objectId)}`);
            object = response.object;
            setCandidateDetails(current => ({ ...current, [candidate.objectId]: object }));
        }
        if (!isSelectionActionCurrent(target)) return;
        setLocalRewriteOpen(false);
        setLocalRewriteInstruction("");
        setLocalRewriteResult(undefined);
        setKind(object.kind);
        if (object.kind === "question") setQuestionTitle(object.title);
        else {
            setTermIdentity(object.termIdentity ?? { chineseName: object.title });
            setTermIdentityEdited(false);
        }
        setBody(object.body);
        setBodyEdited(false);
        setBodyEditing(false);
        setCalloutType(object.calloutType);
        setReuseObjectId(object.objectId);
        setGenerationJobId(undefined);
        setLocalDraftId(`readweave-draft-${utils.randomString(20)}`);
        setGenerationProgress([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
        setStatus(t("readweave.reuse_selected"));
        setStatusTone("normal");
    }

    function changeKind(nextKind: ReadWeaveObjectKind) {
        if (nextKind === kind) return;
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        const nextCallout = calloutAfterKindChange(calloutType, nextKind);
        const nextParentLinkId = nextKind === "question" ? parentLinkId : undefined;
        setKind(nextKind);
        setNewQuestionDraft(false);
        setParentLinkId(nextParentLinkId);
        resetEditor(nextKind);
        setCalloutType(nextCallout);
        setStatus(undefined);
        setStatusTone("normal");
        const matchingJob = selection && generationJobs.find(job =>
            job.anchorId === selection.anchorId
            && job.kind === nextKind
            && job.parentLinkId === nextParentLinkId);
        if (matchingJob) hydrateGenerationJob(matchingJob);
    }

    function chooseKind(nextKind: ReadWeaveObjectKind) {
        if (selection?.pending && confirmPendingSelection(nextKind)) return;
        changeKind(nextKind);
    }

    function changeDraft() {
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        setGenerationJobId(undefined);
        setLocalRewriteOpen(false);
        setLocalRewriteInstruction("");
        setLocalRewriteResult(undefined);
        setGenerationProgress([]);
        setNewQuestionDraft(kind === "question");
        setBusy(false);
        setBody("");
        setBodyEdited(false);
        setBodyEditing(true);
        setReuseObjectId(undefined);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setCandidates([]);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
        setStatus(undefined);
    }

    function beginNewQuestionDraft() {
        if (!selection || selection.pending) return;
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        activeGenerationJobId.current = undefined;
        setLocalRewriteOpen(false);
        setLocalRewriteInstruction("");
        setLocalRewriteResult(undefined);
        setKind("question");
        setNewQuestionDraft(true);
        setGenerationJobId(undefined);
        setLocalDraftId(`readweave-draft-${utils.randomString(20)}`);
        transientGenerationJobRef.current = undefined;
        setTransientGenerationJob(undefined);
        setGenerationProgress([]);
        setBusy(false);
        setQuestionTitle(defaultQuestionForExcerpt(decodeReadWeaveText(selection.excerpt)));
        setOptimizeQuestion(true);
        setTermIdentity({});
        setTermIdentityEdited(false);
        setBody("");
        setBodyEdited(false);
        setBodyEditing(true);
        setCalloutType(defaultReadWeaveCallout("question"));
        setReuseObjectId(undefined);
        setCandidates([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setReviewIssues([]);
        setReviewIssueBaseline(undefined);
        setRegenerationFeedback("");
        setRegenerationOpen(false);
        setMonitorPinned(false);
        setStatus(undefined);
        setStatusTone("normal");
        window.requestAnimationFrame(() => {
            const textarea = questionTextareaRef.current;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(0, textarea.value.length);
        });
    }

    function changeTermIdentity(value: Partial<ReadWeaveTermIdentity>) {
        selectionActionRevision.current += 1;
        setTermIdentity(value);
        setTermIdentityEdited(true);
        setReuseObjectId(undefined);
        setCandidates([]);
        setStatus(undefined);
        setStatusTone("normal");
    }

    function changeGeneratedBody(value: string) {
        selectionActionRevision.current += 1;
        setBody(value);
        setBodyEdited(true);
    }

    function applyQuestionTemplate(template: ReadWeaveQuestionTemplate) {
        if (!selection) return;
        setQuestionTitle(renderReadWeaveQuestionTemplate(template, selection.excerpt));
        setQuestionTemplates(current => recordReadWeaveTemplateUse(current, template.id));
        setActiveTemplateId(template.id);
        changeDraft();
        window.requestAnimationFrame(() => questionTextareaRef.current?.focus());
    }

    function cycleQuestionTemplate(direction: -1 | 1) {
        if (!suggestedTemplates.length) return;
        const currentIndex = suggestedTemplates.findIndex(template => template.id === activeTemplateId);
        const nextIndex = (currentIndex + direction + suggestedTemplates.length) % suggestedTemplates.length;
        applyQuestionTemplate(suggestedTemplates[nextIndex]);
    }

    function handleQuestionKeyDown(event: KeyboardEvent) {
        const shouldCycle = event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")
            || !questionTitle.trim() && (event.key === "ArrowUp" || event.key === "ArrowDown");
        if (!shouldCycle) return;
        event.preventDefault();
        cycleQuestionTemplate(event.key === "ArrowUp" ? -1 : 1);
    }

    function addCustomQuestionTemplate() {
        const label = decodeReadWeaveText(customTemplateLabel).slice(0, 30);
        const pattern = decodeReadWeaveText(customTemplatePattern).slice(0, 500);
        if (!label || !pattern.includes("{selection}")) {
            setStatus(t("readweave.template_placeholder_required"));
            setStatusTone("warning");
            return;
        }
        setQuestionTemplates(current => [
            ...current,
            {
                id: `custom-${Date.now().toString(36)}`,
                label,
                pattern,
                uses: 0
            }
        ]);
        setCustomTemplateLabel("");
        setCustomTemplatePattern("关于“{selection}”，");
        setStatus(undefined);
    }

    function updateQuestionTemplate(templateId: string, patch: Partial<ReadWeaveQuestionTemplate>) {
        setQuestionTemplates(current => current.map(template => template.id === templateId
            ? { ...template, ...patch }
            : template));
    }

    function removeQuestionTemplate(templateId: string) {
        setQuestionTemplates(current => {
            const remaining = current.filter(template => template.id !== templateId);
            return remaining.length > 0
                ? remaining
                : DEFAULT_READWEAVE_QUESTION_TEMPLATES.map(template => ({ ...template }));
        });
    }

    function beginFollowUp(entry: ReadWeaveResolvedEntry) {
        if (entry.kind !== "question") return;
        if (entry.depth >= 5) {
            setStatus(t("readweave.follow_up_depth_limit"));
            setStatusTone("warning");
            return;
        }
        const restoredDraft = noteId && selection
            ? readDraft(noteId, selection.anchorId, entry.linkId)
            : undefined;
        const restoredJob = restoredDraft?.newQuestionDraft
            ? undefined
            : generationJobs.find(job =>
                job.anchorId === selection?.anchorId
                && job.kind === "question"
                && job.parentLinkId === entry.linkId);
        const restoredFields = recoverReadWeaveGenerationFields({
            draft: restoredDraft,
            fallbackQuestionTitle: renderReadWeaveQuestionTemplate(
                DEFAULT_READWEAVE_QUESTION_TEMPLATES.find(template => template.id === "implication")
                    ?? DEFAULT_READWEAVE_QUESTION_TEMPLATES[0],
                selection?.excerpt ?? entry.title
            ),
            job: restoredJob
        });
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        setParentLinkId(entry.linkId);
        setKind("question");
        setNewQuestionDraft(!!restoredDraft?.newQuestionDraft);
        setQuestionTitle(restoredFields.questionTitle);
        setOptimizeQuestion(restoredDraft?.optimizeQuestion ?? true);
        setAutoApplyPlan(restoredDraft?.autoApplyPlan ?? true);
        setTermIdentity({});
        setTermIdentityEdited(false);
        setBody(restoredFields.body);
        setBodyEdited(!!restoredDraft?.bodyEdited && !!restoredDraft.body.trim());
        setBodyEditing(!(restoredJob?.result?.body || restoredDraft?.generationJobId));
        setCalloutType(restoredDraft?.calloutType ?? defaultReadWeaveCallout("question"));
        setReuseObjectId(restoredDraft?.reuseObjectId);
        setContextDecision(restoredDraft?.contextDecision ?? restoredJob?.result?.context);
        setWorkflow(restoredJob?.result?.workflow);
        setGenerationJobId(restoredDraft?.generationJobId ?? restoredJob?.jobId);
        setLocalDraftId(restoredJob?.draftId ?? `readweave-draft-${utils.randomString(20)}`);
        setGenerationProgress(restoredJob?.progress ?? []);
        const restoredIssues = restoredDraft?.reviewIssues ?? restoredJob?.result?.reviewIssues ?? [];
        setReviewIssues(restoredIssues);
        setReviewIssueBaseline(restoredDraft?.reviewIssueBaseline
            ?? (restoredIssues.length > 0 && restoredJob?.result
                ? createReadWeaveReviewIssueBaseline(restoredJob.result.body)
                : undefined));
        setRegenerationFeedback(restoredJob?.feedback ?? "");
        setRegenerationOpen(false);
        setStatus(undefined);
        setStatusTone("normal");
        setBusy(restoredJob?.status === "queued" || restoredJob?.status === "running");
        if (isReadWeaveGenerationReviewable(restoredJob?.status) && restoredJob?.unread) void markJobViewed(restoredJob);
        window.requestAnimationFrame(() => questionTextareaRef.current?.focus());
    }

    function toggleBodyEditing() {
        if (bodyEditing) {
            setBodyEditing(false);
            return;
        }
        setBodyEditing(true);
        window.requestAnimationFrame(() => {
            const textarea = bodyTextareaRef.current;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        });
    }

    async function beginEdit(entry: ReadWeaveResolvedEntry) {
        const target = captureSelectionAction(true);
        if (!target) return;
        setBusy(true);
        try {
            const response = await server.get<{ impact: ReadWeaveImpact }>(`readweave/objects/${encodeURIComponent(entry.objectId)}/impact`);
            if (!isSelectionActionCurrent(target)) return;
            setDeleteState(undefined);
            setEditState({
                entry,
                impact: response.impact,
                title: entry.title,
                body: entry.body,
                calloutType: entry.calloutType,
                termIdentity: entry.termIdentity ?? { chineseName: entry.title },
                mode: response.impact.linkCount > 1 ? "display-only" : "global"
            });
            window.requestAnimationFrame(() => editBodyTextareaRef.current?.focus());
        } finally {
            if (isSelectionActionCurrent(target)) setBusy(false);
        }
    }

    async function beginDelete(entry: ReadWeaveResolvedEntry) {
        const target = captureSelectionAction(true);
        if (!target) return;
        setBusy(true);
        try {
            const response = await server.get<{ impact: ReadWeaveImpact }>(`readweave/objects/${encodeURIComponent(entry.objectId)}/impact`);
            if (!isSelectionActionCurrent(target)) return;
            setEditState(undefined);
            setDeleteState({ entry, impact: response.impact, childStrategy: "cascade" });
        } finally {
            if (isSelectionActionCurrent(target)) setBusy(false);
        }
    }

    async function applyDelete() {
        if (!deleteState || !noteId || !selection) return;
        const target = captureSelectionAction(true, true);
        if (!target) return;
        setBusy(true);
        try {
            const result = await server.remove<ReadWeaveDeleteResult>(
                `readweave/links/${encodeURIComponent(deleteState.entry.linkId)}?children=${deleteState.childStrategy}`
            );
            const deletedIds = new Set(result.deletedLinkIds ?? [ result.linkId ]);
            const removeAnchor = shouldRemoveReadWeaveAnchorAfterDelete({
                anchorId: target.anchorId,
                deletedLinkIds: deletedIds,
                entryLinkIds: entries.map(entry => entry.linkId),
                generationJobs
            });
            if (removeAnchor) {
                await removeProvisionalAnchor(noteContext, target.anchorId, selection.readonly);
                await persistReadWeaveAnchor(noteContext, selection);
            }
            if (isSelectionActionCurrent(target)) setDeleteState(undefined);
            if (activeArticleNoteId.current === target.noteId) await refreshCurrent(target.noteId, removeAnchor ? undefined : target.anchorId);
            if (!isSelectionActionCurrent(target)) return;
            setStatus(t("readweave.deleted"));
            setStatusTone("normal");
            if (removeAnchor) {
                setBusy(false);
                entriesRequestRevision.current += 1;
                selectionActionRevision.current += 1;
                selectionIdentityRevision.current += 1;
                entriesTarget.current = undefined;
                setSelection(undefined);
                setEntries([]);
                setEntriesLoadedAnchorId(undefined);
                setHoverPreview(undefined);
            }
        } catch (error) {
            if (!isSelectionActionCurrent(target)) return;
            setStatus(readableError(error, t("readweave.delete_failed")));
            setStatusTone("error");
        } finally {
            if (isSelectionActionCurrent(target)) setBusy(false);
        }
    }

    async function applyEdit() {
        if (!editState?.mode || !noteId || !selection) return;
        const target = captureSelectionAction(true);
        if (!target) return;
        setBusy(true);
        try {
            const currentEditBody = editBodyTextareaRef.current?.value ?? editState.body;
            const currentEditQuestionTitle = decodeReadWeaveText(editTitleInputRef.current?.value ?? editState.title);
            const editTitle = editState.entry.kind === "term"
                ? formatPartialTermIdentity(editState.termIdentity) || editState.entry.canonicalTitle
                : currentEditQuestionTitle;
            await server.patch(`readweave/links/${encodeURIComponent(editState.entry.linkId)}`, {
                mode: editState.mode,
                title: editTitle,
                body: currentEditBody,
                calloutType: editState.calloutType,
                termIdentity: editState.entry.kind === "term" ? cleanPartialTermIdentity(editState.termIdentity) : undefined,
                verifiedNonExpandableArtifact: editState.entry.verifiedNonExpandableArtifact
            });
            if (isSelectionActionCurrent(target)) setEditState(undefined);
            if (activeArticleNoteId.current === target.noteId) await refreshCurrent(target.noteId, target.anchorId);
            if (isSelectionActionCurrent(target)) setStatus(t("readweave.updated"));
        } catch {
            if (isSelectionActionCurrent(target)) setStatus(t("readweave.update_failed"));
        } finally {
            if (isSelectionActionCurrent(target)) setBusy(false);
        }
    }

    async function exportArticle() {
        if (!noteId) return;
        const value = await server.get(`readweave/export?articleId=${encodeURIComponent(noteId)}`);
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "readweave-index.json";
        anchor.click();
        URL.revokeObjectURL(url);
    }

    return (
        <RightPanelWidget id="readweave-panel" title="ReadWeave">
            <div class="readweave-panel">
                {backgroundJobs.length > 0 && (
                    <details class="readweave-background-job-list" open={backgroundJobs.some(job => job.status === "queued" || job.status === "running")}>
                        <summary>后台任务 · {backgroundJobs.length}</summary>
                        <div>
                            {backgroundJobs.map(job => (
                                <div class="readweave-background-job" key={job.jobId}>
                                    <button type="button" onClick={() => void openBackgroundJob(job)} title={job.title}>
                                        <span class={`readweave-generation-state ${generationJobStateClass(job)}`} />
                                        <span>{job.title}</span>
                                        <small>{generationJobStatusLabel(job)}</small>
                                    </button>
                                    {(job.status === "queued" || job.status === "running") && (
                                        <button type="button" class="readweave-background-cancel" onClick={() => void cancelGenerationJob(job)}>取消</button>
                                    )}
                                    {job.status === "paused" && (
                                        <>
                                            <button type="button" class="readweave-background-cancel" onClick={() => void retryBackgroundJob(job)}>重试</button>
                                            <button type="button" class="readweave-background-cancel" onClick={() => void removeBackgroundJob(job)}>移除</button>
                                        </>
                                    )}
                                    {job.status === "failed" && (
                                        <button type="button" class="readweave-background-cancel" onClick={() => void removeBackgroundJob(job)}>移除</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </details>
                )}
                {!selection ? (
                    <p class="readweave-hint">{t("readweave.select_range")}</p>
                ) : (
                    <>
                        <section class="readweave-selection">
                            <div class="readweave-eyebrow">{selection.pending
                                ? t("readweave.selection_pending")
                                : selection.anchorType === "range" ? t("readweave.selected_range") : t("readweave.selected_paragraph")}</div>
                            <p>{selection.excerpt}</p>
                        </section>

                        <section class="readweave-existing">
                            <div class="readweave-section-title">{t("readweave.saved_items")}</div>
                            {entries.length === 0 && <p class="readweave-hint">{t("readweave.no_saved_items")}</p>}
                            <SavedEntryTree
                                entries={entries}
                                busy={editorLocked}
                                onEdit={beginEdit}
                                onDelete={beginDelete}
                                onFollowUp={beginFollowUp}
                            />
                        </section>

                        {deleteState && (
                            <section class="readweave-editor readweave-delete-confirmation" role="alertdialog" aria-labelledby="readweave-delete-title">
                                <div id="readweave-delete-title" class="readweave-section-title">{t("readweave.delete_confirm_title")}</div>
                                <strong>{deleteState.entry.title}</strong>
                                <p>{t("readweave.delete_confirm_current_anchor")}</p>
                                {deleteState.impact.linkCount > 1 && (
                                    <p class="readweave-hint">
                                        {t("readweave.delete_shared_hint", {
                                            remaining: deleteState.impact.linkCount - 1,
                                            articles: Math.max(0, deleteState.impact.articleCount - 1)
                                        })}
                                    </p>
                                )}
                                {(deleteState.impact.descendantCount ?? 0) > 0 && (
                                    <div class="readweave-delete-tree-options">
                                        <strong>{t("readweave.delete_follow_ups_title")}</strong>
                                        <label>
                                            <input
                                                type="radio"
                                                name="readweave-delete-tree"
                                                checked={deleteState.childStrategy === "cascade"}
                                                onChange={() => setDeleteState({ ...deleteState, childStrategy: "cascade" })}
                                            />
                                            <span>{t("readweave.delete_follow_ups_cascade", { count: deleteState.impact.descendantCount })}</span>
                                        </label>
                                        <label>
                                            <input
                                                type="radio"
                                                name="readweave-delete-tree"
                                                checked={deleteState.childStrategy === "promote"}
                                                onChange={() => setDeleteState({ ...deleteState, childStrategy: "promote" })}
                                            />
                                            <span>{t("readweave.delete_follow_ups_promote")}</span>
                                        </label>
                                    </div>
                                )}
                                <div class="readweave-actions">
                                    <button type="button" class="btn btn-danger" disabled={editorLocked} onClick={applyDelete}>{t("readweave.confirm_delete")}</button>
                                    <button type="button" class="btn btn-secondary" disabled={editorLocked} onClick={() => setDeleteState(undefined)}>{t("common.cancel")}</button>
                                </div>
                            </section>
                        )}

                        {editState && (
                            <section class="readweave-editor readweave-impact">
                                <div class="readweave-section-title">{t("readweave.impact_first")}</div>
                                <p>{t("readweave.impact_summary", { links: editState.impact.linkCount, articles: editState.impact.articleCount })}</p>
                                {editState.impact.articles.length > 0 && <ul>{editState.impact.articles.map(article => <li key={article.articleId}>{article.title}</li>)}</ul>}
                                {editState.entry.kind === "term" ? (
                                    <TermFields value={editState.termIdentity} disabled={editorLocked} onChange={value => setEditState({ ...editState, termIdentity: value })} />
                                ) : (
                                    <label>{t("readweave.title_label")}<input ref={editTitleInputRef} value={editState.title} disabled={editorLocked} onInput={event => setEditState({ ...editState, title: event.currentTarget.value })} /></label>
                                )}
                                <label>{t(editState.entry.kind === "question" ? "readweave.answer_label" : "readweave.definition_label")}<textarea ref={editBodyTextareaRef} rows={7} value={editState.body} disabled={editorLocked} onInput={event => setEditState({ ...editState, body: event.currentTarget.value })} /></label>
                                <CalloutSelector value={editState.calloutType} disabled={editorLocked} onChange={value => setEditState({ ...editState, calloutType: value })} />
                                <div class="readweave-edit-modes">
                                    {(["global", "article-variant", "display-only"] as ReadWeaveEditMode[]).map(mode => (
                                        <label key={mode}>
                                            <input type="radio" name="readweave-edit-mode" checked={editState.mode === mode} disabled={editorLocked} onChange={() => setEditState({ ...editState, mode })} />
                                            {t(`readweave.mode_${mode.replaceAll("-", "_")}`)}
                                        </label>
                                    ))}
                                </div>
                                <div class="readweave-actions">
                                    <button type="button" class="btn btn-primary" disabled={!editState.mode || editorLocked} onClick={applyEdit}>{t("readweave.apply")}</button>
                                    <button type="button" class="btn btn-secondary" onClick={() => setEditState(undefined)}>{t("common.cancel")}</button>
                                </div>
                            </section>
                        )}

                        <section class="readweave-editor">
                            {nestedParent && (
                                <div class="readweave-follow-up-context">
                                    <span>{t("readweave.follow_up_level", { level: nestedParent.depth + 1 })}</span>
                                    <strong>{nestedParent.title}</strong>
                                    <button type="button" class="btn btn-sm btn-link" onClick={() => setParentLinkId(undefined)}>{t("readweave.exit_follow_up")}</button>
                                </div>
                            )}
                            <div class="readweave-kind" role="group" aria-label={t("readweave.kind_label")}>
                                <button type="button" class={kind === "question" ? "active" : ""} disabled={editorLocked} onClick={() => chooseKind("question")}>{t("readweave.question")}</button>
                                <button type="button" class={kind === "term" ? "active" : ""} disabled={editorLocked} onClick={() => chooseKind("term")}>{t("readweave.term")}</button>
                                <button type="button" disabled title="注解自动生成暂未启用">注解</button>
                            </div>
                            {selection.pending && <p class="readweave-hint">{t("readweave.selection_pending_hint")}</p>}
                            {kind === "question" ? (
                                <>
                                    <div class="readweave-question-template-bar" aria-label={t("readweave.question_templates")}>
                                        {suggestedTemplates.map(template => (
                                            <button
                                                type="button"
                                                class={activeTemplateId === template.id ? "active" : ""}
                                                onClick={() => applyQuestionTemplate(template)}
                                                disabled={editorLocked}
                                                title={template.pattern}
                                                key={template.id}
                                            >{template.label}</button>
                                        ))}
                                        <button
                                            type="button"
                                            class="readweave-template-manage"
                                            aria-expanded={templateManagerOpen}
                                            onClick={() => setTemplateManagerOpen(current => !current)}
                                            disabled={editorLocked}
                                        >
                                            <i class="bx bx-slider-alt" aria-hidden="true" />
                                            {t("readweave.manage_templates")}
                                        </button>
                                    </div>
                                    <div class={`readweave-template-manager ${templateManagerOpen ? "open" : ""}`} aria-hidden={!templateManagerOpen}>
                                        <p class="readweave-hint">{t("readweave.template_keyboard_hint")}</p>
                                        <div class="readweave-template-list">
                                            {questionTemplates.map(template => (
                                                <div class="readweave-template-row" key={template.id}>
                                                    <input
                                                        aria-label={t("readweave.template_name")}
                                                        value={template.label}
                                                        onInput={event => updateQuestionTemplate(template.id, { label: event.currentTarget.value.slice(0, 30) })}
                                                    />
                                                    <textarea
                                                        rows={2}
                                                        aria-label={t("readweave.template_pattern")}
                                                        value={template.pattern}
                                                        onInput={event => updateQuestionTemplate(template.id, { pattern: event.currentTarget.value.slice(0, 500) })}
                                                    />
                                                    <button type="button" class="btn btn-sm btn-link" aria-label={t("readweave.delete")} onClick={() => removeQuestionTemplate(template.id)}>
                                                        <i class="bx bx-trash" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <div class="readweave-template-add">
                                            <input value={customTemplateLabel} placeholder={t("readweave.template_name")} onInput={event => setCustomTemplateLabel(event.currentTarget.value)} />
                                            <textarea rows={2} value={customTemplatePattern} placeholder={t("readweave.template_pattern")} onInput={event => setCustomTemplatePattern(event.currentTarget.value)} />
                                            <button type="button" class="btn btn-secondary" onClick={addCustomQuestionTemplate}>{t("readweave.add_template")}</button>
                                        </div>
                                    </div>
                                    <label>{t("readweave.question_label")}
                                        <textarea
                                            ref={questionTextareaRef}
                                            rows={3}
                                            value={questionTitle}
                                            disabled={editorLocked}
                                            onFocus={() => { if (selection.pending) confirmPendingSelection("question"); }}
                                            onInput={event => { setQuestionTitle(event.currentTarget.value); changeDraft(); }}
                                            onKeyDown={handleQuestionKeyDown}
                                            data-testid="readweave-question"
                                        />
                                    </label>
                                    <label class="readweave-question-optimization">
                                        <input type="checkbox" checked={optimizeQuestion} disabled={editorLocked} onChange={event => setOptimizeQuestion(event.currentTarget.checked)} data-testid="readweave-optimize-question" />
                                        <span><strong>{t("readweave.optimize_question")}</strong><small>{t("readweave.optimize_question_hint")}</small></span>
                                    </label>
                                    <label class="readweave-question-optimization">
                                        <input type="checkbox" checked={autoApplyPlan} disabled={editorLocked} onChange={event => setAutoApplyPlan(event.currentTarget.checked)} data-testid="readweave-auto-apply-plan" />
                                        <span><strong>自动采用问题和回答结构</strong><small>关闭后仍会生成，但保留你的原问题文字</small></span>
                                    </label>
                                </>
                            ) : (
                                <>
                                    <TermFields value={termIdentity} disabled={editorLocked} onChange={changeTermIdentity} />
                                    {currentTitle && <p class="readweave-term-preview">{currentTitle}</p>}
                                </>
                            )}

                            {candidates.length > 0 && (
                                <div class="readweave-candidates">
                                    <div class="readweave-section-title">{t("readweave.similar_items")}</div>
                                    {candidates.map(candidate => (
                                        <div class={`readweave-candidate ${candidate.reuseRecommended ? "recommended" : ""}`} key={candidate.objectId} tabindex={0} onMouseEnter={() => loadCandidate(candidate)} onFocus={() => loadCandidate(candidate)}>
                                            <div>
                                                <span class="readweave-candidate-title">{candidate.title}</span>
                                                <span class="readweave-candidate-similarity">
                                                    {kind === "question"
                                                        ? `${t(candidate.sameTopic ? "readweave.same_question_subject" : "readweave.related_question_subject")} · ${t(candidate.intentMatch ? "readweave.same_question_intent" : "readweave.different_question_intent")}`
                                                        : t("readweave.term_similarity", { percent: Math.round(candidate.confidence * 100) })}
                                                </span>
                                            </div>
                                            {candidate.reuseRecommended && <span class="readweave-candidate-recommendation">{t("readweave.reuse_recommended")}</span>}
                                            <div class="readweave-candidate-detail">
                                                <p>{candidateDetails[candidate.objectId]?.body || t("readweave.loading")}</p>
                                                <button type="button" class="btn btn-sm btn-secondary" disabled={editorLocked} onClick={() => reuse(candidate)}>{t("readweave.reuse")}</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {definitionExists && <p class="readweave-hint">{t("readweave.definition_exists")}</p>}
                            {anchorJobs.length > 0 && (
                                <section class="readweave-anchor-job-list" aria-label="当前片段的问题与任务">
                                    <div class="readweave-anchor-job-heading">
                                        <div class="readweave-section-title">当前片段 · {anchorJobs.length}</div>
                                        {kind === "question" && !selection.pending && (
                                            <button
                                                type="button"
                                                class="btn btn-sm btn-link readweave-new-question"
                                                onClick={beginNewQuestionDraft}
                                                data-testid="readweave-new-question"
                                            >继续提问</button>
                                        )}
                                    </div>
                                    <div>
                                        {anchorJobs.map(job => (
                                            <button
                                                type="button"
                                                class={job.jobId === generationJobId ? "active" : ""}
                                                onClick={() => { hydrateGenerationJob(job); void markJobViewed(job); }}
                                                key={job.jobId}
                                                title={job.title}
                                            >
                                                <span class={`readweave-generation-state ${generationJobStateClass(job)}`} />
                                                <span>{job.title}</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}
                            <CalloutSelector value={calloutType} disabled={editorLocked} onChange={setCalloutType} />
                            <button
                                type="button"
                                class={`btn btn-secondary readweave-generate-${kind}`}
                                disabled={generationDisabled}
                                aria-busy={generationBusy}
                                onClick={generateFromCurrentSelection}
                                data-testid="readweave-generate"
                            >
                                {generationBusy && <i class="bx bx-loader-alt bx-spin" aria-hidden="true" />}
                                {generationBusy ? t("readweave.generating") : t(kind === "question" ? "readweave.generate_answer" : "readweave.generate_definition")}
                            </button>
                            <div class="readweave-body-heading">
                                <span id="readweave-draft-body-label">{t(kind === "question" ? "readweave.answer_label" : "readweave.definition_label")}</span>
                                {!!body.trim() && !currentJob?.savedLinkId && (
                                    <button
                                        type="button"
                                        class="btn btn-sm btn-link readweave-body-edit"
                                        aria-pressed={bodyEditing}
                                        disabled={editorLocked}
                                        onClick={toggleBodyEditing}
                                        data-testid="readweave-edit-body"
                                    >
                                        <i class={bodyEditing ? "bx bx-check" : "bx bx-edit-alt"} aria-hidden="true" />
                                        {t(bodyEditing ? "readweave.finish_editing" : kind === "question" ? "readweave.edit_answer" : "readweave.edit_definition")}
                                    </button>
                                )}
                            </div>
                            {bodyEditing || !body.trim() ? (
                                <textarea
                                    id="readweave-draft-body"
                                    ref={bodyTextareaRef}
                                    rows={9}
                                    value={body}
                                    disabled={editorLocked}
                                    class="readweave-body-editing"
                                    aria-labelledby="readweave-draft-body-label"
                                    onInput={event => changeGeneratedBody(event.currentTarget.value)}
                                    data-testid="readweave-answer"
                                />
                            ) : (
                                <ReadableBody
                                    id="readweave-draft-body"
                                    body={body}
                                    className="readweave-body-readonly"
                                    labelledBy="readweave-draft-body-label"
                                    testId="readweave-answer"
                                />
                            )}
                            {body.trim() && (
                                <section class="readweave-local-rewrite" data-testid="readweave-local-rewrite">
                                    <button
                                        type="button"
                                        class="btn btn-sm btn-link"
                                        disabled={editorLocked || !bodyEditing}
                                        aria-expanded={localRewriteOpen}
                                        onClick={() => setLocalRewriteOpen(current => !current)}
                                    >只修改选中文字</button>
                                    {localRewriteOpen && (
                                        <div class="readweave-local-rewrite-form">
                                            <p class="readweave-hint">先在回答框中选中一小段文字，再说明希望怎么改，系统不会重写整段</p>
                                            <textarea
                                                rows={3}
                                                value={localRewriteInstruction}
                                                disabled={localRewriteBusy || editorLocked}
                                                onInput={event => setLocalRewriteInstruction(event.currentTarget.value)}
                                                placeholder="例如：改得更自然，但不要改变事实"
                                                data-testid="readweave-local-rewrite-instruction"
                                            />
                                            <button type="button" class="btn btn-secondary" disabled={localRewriteBusy || editorLocked || !localRewriteInstruction.trim()} onClick={() => void applyLocalRewrite()}>
                                                {localRewriteBusy && <i class="bx bx-loader-alt bx-spin" aria-hidden="true" />} 应用局部修改
                                            </button>
                                        </div>
                                    )}
                                </section>
                            )}
                            {localRewriteResult && (
                                <details class="readweave-local-rewrite-result">
                                    <summary>本次局部修改</summary>
                                    <p>{localRewriteResult.reason}</p>
                                </details>
                            )}
                            <EvidenceSources sources={displayedJob?.result?.evidenceSources} claims={displayedJob?.result?.claims} />
                            {reuseObjectId && <p class="readweave-status">{t("readweave.reusing_object")}</p>}
                            {contextDecision && <p class="readweave-status">{readWeaveCompactStatusText(t("readweave.context_used", { count: contextDecision.characterCount, budget: contextDecision.characterBudget, expansions: contextDecision.expansionLevel }))}</p>}
                            {workflow && <p class="readweave-status">{readWeaveCompactStatusText(t("readweave.workflow_used", { generations: workflow.generationAttempts, checks: workflow.validationPasses }))}</p>}
                            {displayedJob?.result?.answerPlan && <p class="readweave-status" data-testid="readweave-answer-plan">结构：{displayedJob.result.answerPlan.summary}</p>}
                            {displayedJob?.result?.usage && (
                                <p class="readweave-status" data-testid="readweave-usage-cost">
                                    {t("readweave.usage_cost", {
                                        cost: displayedJob.result.usage.costCny.toFixed(4),
                                        budget: displayedJob.result.usage.budgetCny.toFixed(2),
                                        calls: displayedJob.result.usage.modelCalls,
                                        tokens: displayedJob.result.usage.totalTokens.toLocaleString()
                                    })}
                                </p>
                            )}
                            {displayedJob && (
                                <GenerationMonitor
                                    job={{
                                        ...displayedJob,
                                        progress: displayedJob.jobId === generationJobId
                                            ? generationProgress
                                            : displayedJob.progress
                                    }}
                                    pinned={monitorPinned}
                                    onTogglePinned={() => setMonitorPinned(current => !current)}
                                />
                            )}
                            {reviewIssues.length > 0 && (
                                <details id="readweave-review-gate" class="readweave-review-gate advisory" data-testid="readweave-review-gate">
                                    <summary>查看生成记录</summary>
                                    <p>这些是内部质量记录，不会阻止当前正文保存</p>
                                    <ul>{reviewIssues.map(issue => <li key={issue}>{readWeaveCompactStatusText(issue)}</li>)}</ul>
                                </details>
                            )}
                            {!currentJob?.savedLinkId && (
                                <button
                                    type="button"
                                    class="btn btn-primary"
                                    disabled={editorLocked || !saveReady}
                                    onClick={save}
                                    data-testid="readweave-save"
                                >{t("readweave.review_and_save")}</button>
                            )}
                            {currentJob?.savedLinkId && <p class="readweave-status">{t("readweave.saved")}</p>}
                            {currentJob && (
                                <div class="readweave-review-actions">
                                    {!currentJob.savedLinkId && (
                                        <button type="button" class="btn btn-secondary" disabled={busy && !generationBusy} onClick={discardDraft}>{t("readweave.discard_draft")}</button>
                                    )}
                                    <button type="button" class="btn btn-secondary" disabled={editorLocked} aria-expanded={regenerationOpen} onClick={() => setRegenerationOpen(current => !current)}>{t("readweave.regenerate")}</button>
                                    <button type="button" class="btn btn-outline-secondary" disabled={editorLocked || !currentJob.result?.body} onClick={addCurrentAnswerToRegression}>加入回归集</button>
                                </div>
                            )}
                            <div class={`readweave-regeneration ${regenerationOpen ? "open" : ""}`} aria-hidden={!regenerationOpen}>
                                <label>{t("readweave.regeneration_feedback")}
                                    <textarea rows={4} value={regenerationFeedback} disabled={editorLocked} onInput={event => setRegenerationFeedback(event.currentTarget.value)} placeholder={t("readweave.regeneration_feedback_hint")} />
                                </label>
                                <button type="button" class="btn btn-secondary" disabled={editorLocked} onClick={regenerateDraft}>{t("readweave.regenerate_with_feedback")}</button>
                            </div>
                        </section>
                    </>
                )}
                {status && <p class={`readweave-status ${statusTone === "error" ? "readweave-status-error" : statusTone === "warning" ? "readweave-status-warning" : ""}`} role={statusTone === "error" ? "alert" : "status"}>{readWeaveCompactStatusText(status)}</p>}
                <button type="button" class="btn btn-sm btn-link readweave-export" onClick={exportArticle} disabled={!noteId}>{t("readweave.export_article")}</button>
            </div>

            {hoverPreview && (
                <aside
                    class="readweave-hover-preview"
                    style={{ left: `${hoverPreview.left}px`, top: `${hoverPreview.top}px`, width: `${hoverPreview.width}px`, maxHeight: `${hoverPreview.maxHeight}px` }}
                    onMouseEnter={() => { window.clearTimeout(hoverCloseTimer.current); window.clearTimeout(hoverOpenTimer.current); }}
                    onMouseLeave={() => { if (!hoverPreview.locked) scheduleHoverClose(); }}
                    aria-label={t("readweave.anchor_preview")}
                >
                    {hoverPreview.entries.some(entry => entry.kind === "question") && (
                        <div class="readweave-hover-questions">
                            <div class="readweave-section-title">{t("readweave.question")}</div>
                            {hoverPreview.entries.filter(entry => entry.kind === "question").map(entry => <HoverEntry entry={entry} key={entry.linkId} />)}
                        </div>
                    )}
                    {hoverPreview.entries.some(entry => entry.kind === "term") && (
                        <div class="readweave-hover-terms">
                            <div class="readweave-section-title">{t("readweave.term_definitions")}</div>
                            {hoverPreview.entries.filter(entry => entry.kind === "term").map(entry => <HoverEntry entry={entry} key={entry.linkId} />)}
                        </div>
                    )}
                </aside>
            )}
        </RightPanelWidget>
    );
}

function GenerationMonitor({ job, pinned, onTogglePinned }: { job: ReadWeaveGenerationJob; pinned: boolean; onTogglePinned: () => void }) {
    const displayedProgress = readWeaveGenerationProgressForDisplay(job, t("readweave.generate_failed"));
    const latest = displayedProgress.at(-1);
    const state = generationJobStateClass(job);
    const elapsed = latest?.elapsedMs ?? Math.max(0, Date.now() - Date.parse(job.createdAt));
    const errorProgress = displayedProgress.findLast(progress => progress.stage === "failed") ?? latest;
    const categoryLabels: Record<string, string> = {
        format: t("readweave.issue_format"),
        entity: t("readweave.issue_entity"),
        evidence: t("readweave.issue_evidence"),
        integrity: t("readweave.issue_integrity"),
        other: t("readweave.issue_other")
    };
    return (
        <section class={`readweave-generation-monitor ${pinned ? "pinned" : ""} ${state}`} data-testid="readweave-generation-monitor">
            <button type="button" class="readweave-generation-summary" onClick={onTogglePinned} aria-expanded={pinned}>
                <span class={`readweave-generation-state ${state}`} aria-hidden="true" />
                <span>{readWeaveCompactStatusText(latest?.message ?? t("readweave.generation_queued"))}</span>
                <time>{formatElapsed(elapsed)}</time>
                <i class="bx bx-chevron-down" aria-hidden="true" />
            </button>
            <div class="readweave-generation-detail">
                <ol class="readweave-generation-log" aria-label={t("readweave.generation_progress")}>
                    {displayedProgress.map(progress => {
                        const groupedIssues = new Map<string, string[]>();
                        const issues = progress.issueGroups?.length
                            ? progress.issueGroups.map(issue => ({ category: issue.category, message: issue.message }))
                            : progress.issues.map(message => ({ category: "other", message }));
                        for (const issue of issues) {
                            groupedIssues.set(issue.category, Array.from(new Set([ ...(groupedIssues.get(issue.category) ?? []), issue.message ])));
                        }
                        const errorAlreadyLogged = issues.some(issue => issue.message === job.error);
                        const showJobError = !!job.error && progress === errorProgress && !errorAlreadyLogged;
                        return (
                            <li class={progress.stage} key={progress.sequence ?? `${progress.round}-${progress.stage}`}>
                                <time>{formatLogTime(progress.timestamp)}</time>
                                <div class="readweave-generation-event">
                                    <span>{readWeaveCompactStatusText(progress.message)}</span>
                                    {Array.from(groupedIssues).map(([ category, eventIssues ]) => (
                                        <section class="readweave-issue-group" key={category} tabindex={0}>
                                            <strong><span>{categoryLabels[category] ?? categoryLabels.other}</span><small>{eventIssues.length}</small></strong>
                                            <ul>{eventIssues.map(issue => <li key={issue}>{readWeaveCompactStatusText(issue)}</li>)}</ul>
                                        </section>
                                    ))}
                                    {showJobError && (
                                        <section class="readweave-monitor-error" role="alert" tabindex={0}>
                                            <strong>{t("readweave.error_detail")}</strong>
                                            <p>{readWeaveCompactStatusText(job.error!)}</p>
                                        </section>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </div>
        </section>
    );
}

function ReadableBody({
    body,
    className,
    id,
    labelledBy,
    testId
}: {
    body: string;
    className: string;
    id?: string;
    labelledBy?: string;
    testId?: string;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const displayBody = normalizeReadWeaveReadableMath(body);
    const paragraphs = displayBody.split(/\n{2,}/u).map(paragraph => paragraph.trim()).filter(Boolean);

    useLayoutEffect(() => {
        const container = contentRef.current;
        if (!container || !/(?:\$\$[\s\S]+?\$\$|\$(?!\$)[^$\n]+?\$)/u.test(displayBody)) return;

        let cancelled = false;
        void import("../../services/math.js").then(({ renderMathInElement }) => {
            if (cancelled || !container.isConnected) return;
            renderMathInElement(container, {
                trust: false,
                throwOnError: false,
                macros: { ...KATEX_MACROS },
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false }
                ]
            });
        });
        return () => {
            cancelled = true;
        };
    }, [ displayBody ]);

    return (
        <div
            key={displayBody}
            ref={contentRef}
            id={id}
            class={`readweave-readable-body ${className}`}
            role={labelledBy ? "region" : undefined}
            aria-labelledby={labelledBy}
            data-testid={testId}
        >
            {paragraphs.map((paragraph, index) => <p key={`${index}:${paragraph.slice(0, 24)}`}>{paragraph}</p>)}
        </div>
    );
}

function HoverEntry({ entry }: { entry: ReadWeaveResolvedEntry }) {
    return (
        <article class={`${entry.kind === "question" ? "readweave-hover-question" : "readweave-hover-term"} readweave-callout-${entry.calloutType}`} tabindex={0}>
            <div class="readweave-hover-title"><i class={CALLOUT_ICONS[entry.calloutType]} /><span>{entry.title}</span>{entry.kind === "question" && <i class="bx bx-chevron-down readweave-hover-chevron" />}</div>
            <ReadableBody body={entry.body} className={entry.kind === "question" ? "readweave-hover-answer" : "readweave-hover-definition"} />
        </article>
    );
}

function EvidenceSources({
    sources,
    claims
}: {
    sources: ReadWeaveResolvedEntry["evidenceSources"];
    claims?: ReadWeaveResolvedEntry["claims"];
}) {
    if (!sources?.length) return null;
    return (
        <details class="readweave-evidence-sources">
            <summary>{t("readweave.sources", { count: sources.length })}</summary>
            {!!claims?.length && (
                <ul class="readweave-evidence-claims">
                    {claims.map(claim => (
                        <li key={claim.claimId}>
                            <span>{claim.text}</span>
                            <small>{claim.sourceIds.join(" · ")}</small>
                        </li>
                    ))}
                </ul>
            )}
            <ol>
                {sources.map(source => (
                    <li key={source.sourceId}>
                        {source.url
                            ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                            : <span>{source.title}</span>}
                        <small>{source.provider}{source.publishedAt ? ` · ${source.publishedAt}` : ""}</small>
                        <p>{source.excerpt}</p>
                    </li>
                ))}
            </ol>
        </details>
    );
}

function SavedEntryTree({
    entries,
    busy,
    onEdit,
    onDelete,
    onFollowUp
}: {
    entries: ReadWeaveResolvedEntry[];
    busy: boolean;
    onEdit: (entry: ReadWeaveResolvedEntry) => void;
    onDelete: (entry: ReadWeaveResolvedEntry) => void;
    onFollowUp: (entry: ReadWeaveResolvedEntry) => void;
}) {
    const ids = new Set(entries.map(entry => entry.linkId));
    const roots = entries.filter(entry => !entry.parentLinkId || !ids.has(entry.parentLinkId));
    const renderEntry = (entry: ReadWeaveResolvedEntry): JSX.Element => {
        const children = entries.filter(candidate => candidate.parentLinkId === entry.linkId);
        return (
            <div class="readweave-entry-tree-node" data-depth={entry.depth} key={entry.linkId}>
                <SavedEntry
                    entry={entry}
                    busy={busy}
                    onEdit={() => onEdit(entry)}
                    onDelete={() => onDelete(entry)}
                    onFollowUp={() => onFollowUp(entry)}
                />
                {children.length > 0 && (
                    <div class="readweave-entry-tree-children">
                        {children.map(renderEntry)}
                    </div>
                )}
            </div>
        );
    };
    return <div class="readweave-entry-tree">{roots.map(renderEntry)}</div>;
}

function SavedEntry({
    entry,
    busy,
    onEdit,
    onDelete,
    onFollowUp
}: {
    entry: ReadWeaveResolvedEntry;
    busy: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onFollowUp: () => void;
}) {
    return (
        <article class={`readweave-entry readweave-callout-${entry.calloutType}`} tabindex={0}>
            <div class="readweave-entry-title">
                <span><i class={CALLOUT_ICONS[entry.calloutType]} />{entry.title}</span>
                <span class="readweave-entry-heading-actions">
                    {entry.isDisplayOverride && <span class="readweave-badge">{t("readweave.local_display")}</span>}
                    {entry.parentStale && <span class="readweave-badge readweave-stale-badge">{t("readweave.parent_changed")}</span>}
                    {entry.kind === "question" && entry.depth < 5 && (
                        <button type="button" class="btn btn-sm btn-link" aria-label={t("readweave.follow_up_item", { title: entry.title })} title={t("readweave.follow_up")} onClick={onFollowUp} disabled={busy}>
                            <i class="bx bx-subdirectory-right" aria-hidden="true" />
                        </button>
                    )}
                    <button type="button" class="btn btn-sm btn-link" aria-label={t("readweave.edit_item", { title: entry.title })} title={t("readweave.edit")} onClick={onEdit} disabled={busy}>
                        <i class="bx bx-edit-alt" aria-hidden="true" />
                    </button>
                    <button type="button" class="btn btn-sm btn-link readweave-delete-action" aria-label={t("readweave.delete_item", { title: entry.title })} title={t("readweave.delete")} onClick={onDelete} disabled={busy}>
                        <i class="bx bx-trash" aria-hidden="true" />
                    </button>
                </span>
            </div>
            <div class="readweave-entry-detail">
                <ReadableBody body={entry.body} className="readweave-entry-body" />
                <EvidenceSources sources={entry.evidenceSources} claims={entry.claims} />
            </div>
        </article>
    );
}

function CalloutSelector({ value, disabled = false, onChange }: { value: ReadWeaveCalloutType; disabled?: boolean; onChange: (value: ReadWeaveCalloutType) => void }) {
    return (
        <div class="readweave-callout-selector" role="group" aria-label={t("readweave.visual_type")}>
            {CALLOUT_SELECTOR_TYPES.map(type => (
                <button type="button" class={`readweave-callout-choice readweave-callout-${type} ${value === type ? "active" : ""}`} title={t(`readweave.callout_${type}`)} aria-label={t(`readweave.callout_${type}`)} aria-pressed={value === type} disabled={disabled} onClick={() => onChange(type)} key={type}>
                    <i class={CALLOUT_ICONS[type]} /><span>{t(`readweave.callout_${type}`)}</span>
                </button>
            ))}
        </div>
    );
}

function TermFields({ value, disabled = false, onChange }: { value: Partial<ReadWeaveTermIdentity>; disabled?: boolean; onChange: (value: Partial<ReadWeaveTermIdentity>) => void }) {
    return (
        <div class="readweave-term-fields">
            <label>{t("readweave.term_abbreviation")}<input value={value.abbreviation ?? ""} disabled={disabled} onInput={event => onChange({ ...value, abbreviation: event.currentTarget.value })} /></label>
            <label>{t("readweave.term_chinese_name")}<input value={value.chineseName ?? ""} disabled={disabled} onInput={event => onChange({ ...value, chineseName: event.currentTarget.value })} /></label>
            <label>{t("readweave.term_english_name")}<input value={value.englishName ?? ""} disabled={disabled} onInput={event => onChange({ ...value, englishName: event.currentTarget.value })} /></label>
        </div>
    );
}

interface AnchorInteractionOptions {
    noteId: string | null | undefined;
    noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"];
    contentElement: HTMLElement | null;
    onContentRoot?: (root: HTMLElement | null) => void;
    summaries: ReadWeaveAnchorSummary[];
    generationJobs: ReadWeaveGenerationJob[];
    dataReady: boolean;
    activeAnchorId?: string;
    onSelect: (selection: AnchorSelection, preferredKind?: ReadWeaveObjectKind) => void;
    onSelectionPreview: (selection: AnchorSelection) => void;
    onStatus: (status: string | undefined) => void;
    onHover: (entries: ReadWeaveResolvedEntry[], rect: DOMRect, locked: boolean, avoidRect?: DOMRect) => void;
    onHoverLeave: () => void;
    onHoverClear: () => void;
}

function useAnchorInteractions(options: AnchorInteractionOptions) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const activeAnchorRef = useRef<string>();
    const hoveredAnchorRef = useRef<string>();
    const suppressedAnchorRef = useRef<string>();
    const pendingSelectionActionsRef = useRef<Partial<Record<ReadWeaveObjectKind, () => void>>>({});

    useEffect(() => {
        const { noteId, noteContext } = optionsRef.current;
        if (!noteId || !noteContext) return;
        let actionBubble: HTMLDivElement | undefined;
        let actionRange: Range | undefined;
        let observer: MutationObserver | undefined;
        let editorRoot: HTMLElement | null = null;
        let editorAttachTimer: number | undefined;
        let selectionFrame: number | undefined;
        let selectionRevision = 0;
        let disposed = false;

        function removeBubble() {
            actionBubble?.remove();
            actionBubble = undefined;
            actionRange = undefined;
        }

        function positionBubble() {
            if (!actionBubble || !actionRange) return;
            const rect = actionRange.getBoundingClientRect();
            const bubbleWidth = actionBubble.offsetWidth;
            const bubbleHeight = actionBubble.offsetHeight;
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - bubbleWidth - 8));
            const preferredTop = rect.top - bubbleHeight - 8;
            const top = preferredTop >= 8
                ? preferredTop
                : Math.min(window.innerHeight - bubbleHeight - 8, rect.bottom + 8);
            actionBubble.style.left = `${left}px`;
            actionBubble.style.top = `${Math.max(8, top)}px`;
        }

        function clearActiveAnchor(root: HTMLElement) {
            root.querySelectorAll(".readweave-anchor-active,.readweave-paragraph-selected").forEach(element => {
                element.classList.remove("readweave-anchor-active", "readweave-paragraph-selected");
            });
            activeAnchorRef.current = undefined;
        }

        function setActiveAnchor(root: HTMLElement, anchorId: string) {
            clearActiveAnchor(root);
            matchingAnchorElements(root, anchorId).forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-anchor-active" : "readweave-paragraph-selected"));
            activeAnchorRef.current = anchorId;
        }

        function setHoveredAnchor(root: HTMLElement, anchorId: string, hovered: boolean) {
            matchingAnchorElements(root, anchorId).forEach(element => {
                element.classList.toggle("readweave-anchor-hover", hovered);
            });
            hoveredAnchorRef.current = hovered ? anchorId : undefined;
        }

        function clearHoveredAnchors(root: HTMLElement) {
            root.querySelectorAll(".readweave-anchor-hover,.readweave-paragraph-anchor-hover").forEach(element => {
                element.classList.remove("readweave-anchor-hover", "readweave-paragraph-anchor-hover");
            });
            hoveredAnchorRef.current = undefined;
        }

        function clearLockedAnchor(root: HTMLElement) {
            root.querySelectorAll<HTMLElement>(".readweave-anchor-locked,[data-readweave-locked-anchor-id]").forEach(element => {
                element.classList.remove("readweave-anchor-locked");
                delete element.dataset.readweaveLockedAnchorId;
            });
            READWEAVE_LOCKED_ANCHOR_BY_ROOT.delete(root);
        }

        function setLockedAnchor(root: HTMLElement, anchorId: string) {
            clearLockedAnchor(root);
            matchingAnchorElements(root, anchorId).forEach(element => {
                element.classList.add("readweave-anchor-locked");
                element.dataset.readweaveLockedAnchorId = anchorId;
            });
            READWEAVE_LOCKED_ANCHOR_BY_ROOT.set(root, anchorId);
        }

        function onAnchorMouseOver(event: MouseEvent) {
            const root = editorRoot;
            if (!root || !(event.target instanceof Element) || !root.contains(event.target)) return;
            const exactAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            if (!exactAnchor || !root.contains(exactAnchor)) return;
            const block = exactAnchor.closest<HTMLElement>(BLOCK_SELECTOR);
            if (!block || !root.contains(block)) return;
            const exactAnchorId = preferredAnchorIdOf(exactAnchor, optionsRef.current.summaries, optionsRef.current.generationJobs);
            if (!exactAnchorId || suppressedAnchorRef.current === exactAnchorId || READWEAVE_LOCKED_ANCHOR_BY_ROOT.has(root)) return;
            const relatedAnchorId = event.relatedTarget instanceof Element
                ? preferredAnchorIdOf(event.relatedTarget.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR), optionsRef.current.summaries, optionsRef.current.generationJobs)
                : undefined;
            const previewEntries = previewEntriesForElement(
                optionsRef.current.summaries,
                optionsRef.current.generationJobs,
                exactAnchorId,
                exactAnchor
            );
            const exactTerms = previewEntries.filter(entry => entry.kind === "term");
            const exactQuestions = previewEntries.filter(entry => entry.kind === "question");
            if (exactAnchorId === relatedAnchorId) return;

            clearHoveredAnchors(root);
            if (!exactTerms.length && !exactQuestions.length) {
                optionsRef.current.onHoverLeave();
                return;
            }

            block.classList.add("readweave-paragraph-anchor-hover");
            setHoveredAnchor(root, exactAnchorId, true);
            optionsRef.current.onHover(previewEntries, exactAnchor.getBoundingClientRect(), false, block.getBoundingClientRect());
        }

        function onAnchorMouseOut(event: MouseEvent) {
            const root = editorRoot;
            if (!root || !(event.target instanceof Element) || !root.contains(event.target)) return;
            const exactAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            if (!exactAnchor || !root.contains(exactAnchor)) return;
            const relatedAnchor = event.relatedTarget instanceof Element
                ? event.relatedTarget.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR)
                : null;
            const exactAnchorId = preferredAnchorIdOf(exactAnchor, optionsRef.current.summaries, optionsRef.current.generationJobs);
            if (preferredAnchorIdOf(relatedAnchor, optionsRef.current.summaries, optionsRef.current.generationJobs) === exactAnchorId) return;
            if (suppressedAnchorRef.current === exactAnchorId) suppressedAnchorRef.current = undefined;
            if (READWEAVE_LOCKED_ANCHOR_BY_ROOT.get(root) === exactAnchorId) return;
            clearHoveredAnchors(root);
            optionsRef.current.onHoverLeave();
        }

        function decorateAnchors(root: HTMLElement) {
            releaseReadWeaveProvisionalAnchors(root, [
                ...optionsRef.current.summaries.map(summary => summary.anchorId),
                ...optionsRef.current.generationJobs
                    .filter(job => !job.jobId.startsWith("readweave-local-"))
                    .map(job => job.anchorId)
            ]);
            applyAnchorSummaryDecorations(root, optionsRef.current.summaries, optionsRef.current.generationJobs);
            if (activeAnchorRef.current) {
                matchingAnchorElements(root, activeAnchorRef.current).forEach(element => {
                    element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-anchor-active" : "readweave-paragraph-selected");
                });
            }
            if (hoveredAnchorRef.current) {
                matchingAnchorElements(root, hoveredAnchorRef.current).forEach(element => {
                    element.classList.add("readweave-anchor-hover");
                    element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                });
            }
            const lockedAnchorId = READWEAVE_LOCKED_ANCHOR_BY_ROOT.get(root);
            if (lockedAnchorId) {
                matchingAnchorElements(root, lockedAnchorId).forEach(element => {
                    element.classList.add("readweave-anchor-locked");
                    element.dataset.readweaveLockedAnchorId = lockedAnchorId;
                    element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                });
            }
        }

        async function editorAndRoot() {
            const currentContext = optionsRef.current.noteContext;
            const editor: CKTextEditor | null = currentContext
                ? await currentContext.getTextEditor().catch(() => null)
                : null;
            const editorRoot = editor?.editing.view.getDomRoot() as HTMLElement | null;
            if (editorRoot) return { editor, root: editorRoot, mode: "editable" as const };
            const contentRoot = optionsRef.current.contentElement
                ?? (await currentContext?.getContentElement().catch(() => null))?.[0]
                ?? null;
            return { editor: null, root: contentRoot, mode: "readonly" as const };
        }

        async function selectExisting(root: HTMLElement, domAnchorId: string, block: HTMLElement, anchorType: ReadWeaveAnchorType, preferredKind?: ReadWeaveObjectKind) {
            setActiveAnchor(root, domAnchorId);
            const elements = matchingAnchorElements(root, domAnchorId);
            const summary = elements.map(element => summaryForElement(optionsRef.current.summaries, domAnchorId, element)).find(Boolean);
            const anchorId = summary?.anchorId ?? domAnchorId;
            const summaryExcerpt = summary?.excerpt;
            const job = optionsRef.current.generationJobs.find(job => job.anchorId === anchorId);
            const jobExcerpt = job?.sourceExcerpt;
            const renderedExcerpt = anchorType === "range" ? textOfAnchorElements(elements) : textOf(block);
            const excerpt = summaryExcerpt || jobExcerpt || renderedExcerpt || "";
            await optionsRef.current.onSelect({
                anchorId,
                anchorType,
                excerpt,
                fragments: collectFragments(root, block, excerpt),
                sourceLocator: summary?.sourceLocator ?? job?.sourceLocator,
                readonly: root.dataset.readweaveContentRoot === "readonly"
            }, preferredKind);
        }

        async function showActionsForCurrentSelection(revision: number) {
            const nativeSelection = window.getSelection();
            if (!nativeSelection || nativeSelection.isCollapsed || !nativeSelection.rangeCount) {
                removeBubble();
                return;
            }
            const nativeRange = trimRangeWhitespace(nativeSelection.getRangeAt(0));
            const excerpt = nativeRange.toString().replace(/\s+/g, " ").trim().slice(0, 10_000);
            const common = nativeRange.commonAncestorContainer instanceof Element ? nativeRange.commonAncestorContainer : nativeRange.commonAncestorContainer.parentElement;
            const root = common?.closest<HTMLElement>(`[data-readweave-content-root], [contenteditable="true"][role="textbox"]`);
            if (!root || !excerpt) {
                removeBubble();
                return;
            }
            if (actionBubble && actionRange && rangesEqual(actionRange, nativeRange)) {
                positionBubble();
                return;
            }
            const { editor, root: actualRoot, mode } = await editorAndRoot();
            if (disposed || revision !== selectionRevision || !actualRoot || actualRoot !== root) return;
            const block = common?.closest<HTMLElement>(BLOCK_SELECTOR);
            if (!block || !root.contains(block) || (mode === "readonly" && !rangeIsContainedByBlock(block, nativeRange))) {
                removeBubble();
                if (mode === "readonly") optionsRef.current.onStatus("只读正文中的选区必须位于同一段落");
                return;
            }
            let modelRange: ReturnType<CKTextEditor["editing"]["mapper"]["toModelRange"]> | undefined;
            if (mode === "editable") {
                if (!editor) return;
                const viewRange = editor.editing.view.domConverter.domRangeToView(nativeRange);
                if (!viewRange) {
                    removeBubble();
                    optionsRef.current.onStatus(t("readweave.selection_sync_failed"));
                    return;
                }
                modelRange = editor.editing.mapper.toModelRange(viewRange);
                if (!modelRange || modelRange.isCollapsed) return;
            }
            const interactionEditor = editor;
            const interactionRoot = root;
            const interactionBlock = block;
            const interactionModelRange = modelRange;
            const fragments = collectFragments(interactionRoot, interactionBlock, excerpt);
            const sourceLocator = readWeaveSourceLocatorForRange(interactionRoot, interactionBlock, nativeRange, BLOCK_SELECTOR);
            pendingSelectionActionsRef.current = {};

            optionsRef.current.onSelectionPreview({
                anchorId: "rw_selection_preview",
                anchorType: "range",
                excerpt,
                fragments,
                sourceLocator,
                readonly: mode === "readonly",
                pending: true
            });

            const intersecting = Array.from(root.querySelectorAll<HTMLElement>(RANGE_ANCHOR_SELECTOR)).filter(element => {
                try { return rangeStrictlyIntersectsElement(nativeRange, element); } catch { return false; }
            });
            const intersectingIds = Array.from(new Set(intersecting.flatMap(readWeaveAnchorIdsOf)));
            const crossesExistingAnchor = intersectingIds.some(anchorId => {
                const existingRange = readWeaveAnchorGroupRange(root, anchorId);
                return existingRange ? !rangesAreNestedOrDisjoint(nativeRange, existingRange) : false;
            });
            if (crossesExistingAnchor) {
                removeBubble();
                optionsRef.current.onStatus(t("readweave.overlapping_anchor"));
                return;
            }
            const exactExistingAnchorId = exactReadWeaveAnchorIdForExcerpt(root, intersectingIds, excerpt);

            removeBubble();
            clearActiveAnchor(root);
            actionBubble = document.createElement("div");
            actionRange = nativeRange.cloneRange();
            actionBubble.className = "readweave-selection-actions";
            actionBubble.setAttribute("role", "toolbar");
            for (const preferredKind of ["question", "term"] as ReadWeaveObjectKind[]) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = preferredKind === "question" ? "bx bx-message-square-add" : "bx bx-book-open";
                const label = preferredKind === "question" ? t("readweave.ask_action") : t("readweave.define_action");
                button.textContent = label;
                button.setAttribute("aria-label", label);
                let activated = false;
                async function activate(buttonEvent: Event) {
                    if (activated) return;
                    activated = true;
                    pendingSelectionActionsRef.current = {};
                    buttonEvent.preventDefault();
                    buttonEvent.stopPropagation();
                    let anchorId = exactExistingAnchorId;
                    if (!anchorId) {
                        anchorId = `rwr_${utils.randomString(20)}`;
                        protectReadWeaveProvisionalAnchor(interactionRoot, anchorId);
                        if (mode === "readonly") {
                            applyReadWeaveRuntimeRangeAnchor(interactionRoot, nativeRange, anchorId);
                        } else if (interactionEditor && interactionModelRange) {
                            interactionEditor.model.change(writer => updateReadWeaveAnchorIdOnRange(writer, interactionModelRange, anchorId!, "add"));
                        }
                    }
                    removeBubble();
                    window.getSelection()?.removeAllRanges();
                    const finalizedSelection: AnchorSelection = {
                        anchorId: anchorId!,
                        anchorType: "range",
                        excerpt,
                        fragments,
                        sourceLocator,
                        readonly: mode === "readonly"
                    };
                    // Finalize the editor state in the same event turn. Deferring the
                    // whole transition left the pending preview interactive for one
                    // frame, so fast typing could be overwritten when onSelect ran.
                    void optionsRef.current.onSelect(finalizedSelection, preferredKind);
                    window.requestAnimationFrame(() => {
                        decorateAnchors(interactionRoot);
                        setActiveAnchor(interactionRoot, anchorId!);
                    });
                }
                button.addEventListener("mousedown", activate);
                button.addEventListener("click", activate);
                pendingSelectionActionsRef.current[preferredKind] = () => {
                    void activate(new Event("readweave-confirm-selection", { cancelable: true }));
                };
                actionBubble.append(button);
            }
            document.body.append(actionBubble);
            positionBubble();
        }

        function scheduleSelectionActions() {
            selectionRevision += 1;
            const revision = selectionRevision;
            if (selectionFrame !== undefined) window.cancelAnimationFrame(selectionFrame);
            selectionFrame = window.requestAnimationFrame(() => {
                selectionFrame = undefined;
                void showActionsForCurrentSelection(revision);
            });
        }

        function onMouseUp(event: MouseEvent) {
            if (!(event.target instanceof Element) || event.target.closest(".readweave-selection-actions,.readweave-panel,.readweave-hover-preview")) return;
            scheduleSelectionActions();
        }

        function onSelectionChange() {
            scheduleSelectionActions();
        }

        async function onClick(event: MouseEvent) {
            if (!(event.target instanceof Element) || event.target.closest(".readweave-selection-actions,.readweave-panel,.readweave-hover-preview")) return;
            const clickedRangeAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            // Capture the rendered lock before awaiting the editor. Multiple
            // listeners or a polling refresh may otherwise change refs/classes
            // between the physical click and the toggle decision.
            const renderedLockAtClick = clickedRangeAnchor?.classList.contains("readweave-anchor-locked") ?? false;
            const nativeSelection = window.getSelection();
            if (nativeSelection && !nativeSelection.isCollapsed && nativeSelection.rangeCount) {
                const common = nativeSelection.getRangeAt(0).commonAncestorContainer;
                const commonElement = common instanceof Element ? common : common.parentElement;
                const selectionRoot = commonElement?.closest('[data-readweave-content-root], [contenteditable="true"][role="textbox"]');
                const clickRoot = event.target.closest('[data-readweave-content-root], [contenteditable="true"][role="textbox"]');
                // A selection may survive navigation and restoration. Clicking a
                // precise ReadWeave fragment must still open/lock that fragment;
                // only plain editor clicks should remain reserved for selection.
                if (selectionRoot && selectionRoot === clickRoot && !event.target.closest(RANGE_ANCHOR_SELECTOR)) return;
            }
            removeBubble();
            const located = findEditableBlock(event.target);
            if (!located) return;
            const { editor, root, mode } = await editorAndRoot();
            if (!root || root !== located.root || (mode === "editable" && !editor)) return;
            // The desktop layout can keep more than one ReadWeave panel hook
            // attached to the same editor (for example while panes transition).
            // All of those hooks receive the same document-level click. Let the
            // first matching editor instance own it so a second listener cannot
            // immediately undo a lock/unlock toggle performed by the first.
            const handledEvent = event as ReadWeaveHandledMouseEvent;
            if (handledEvent.__readweaveClickHandled) return;
            handledEvent.__readweaveClickHandled = true;

            const rangeAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            const rangeAnchorId = preferredAnchorIdOf(rangeAnchor, optionsRef.current.summaries, optionsRef.current.generationJobs);
            if (rangeAnchorId && rangeAnchor) {
                const lockedAnchorId = READWEAVE_LOCKED_ANCHOR_BY_ROOT.get(root);
                const clickedAnchorIsRenderedLocked = matchingAnchorElements(root, rangeAnchorId)
                    .some(element => element.classList.contains("readweave-anchor-locked"));
                const referencedLockIsStillRendered = !!lockedAnchorId && matchingAnchorElements(root, lockedAnchorId)
                    .some(element => element.classList.contains("readweave-anchor-locked"));
                // Decoration/polling refreshes and an editor re-attachment can
                // briefly leave the rendered lock marker one frame ahead of
                // the hook ref. Treat that visible marker as the source of
                // truth only when no other referenced lock is still rendered;
                // this recovers the second-click toggle without preventing a
                // nested range from replacing a genuinely different lock.
                // The preferred internal ID may change when summaries or jobs
                // refresh, but a visibly locked exact fragment is still the
                // same user-facing target. Its second click must always unlock.
                const clickedThisRenderedLock = renderedLockAtClick;
                if (lockedAnchorId === rangeAnchorId || clickedThisRenderedLock || (clickedAnchorIsRenderedLocked && !referencedLockIsStillRendered)) {
                    clearLockedAnchor(root);
                    clearHoveredAnchors(root);
                    suppressedAnchorRef.current = rangeAnchorId;
                    optionsRef.current.onHoverClear();
                    return;
                }
                const previewEntries = previewEntriesForElement(
                    optionsRef.current.summaries,
                    optionsRef.current.generationJobs,
                    rangeAnchorId,
                    rangeAnchor
                );
                if (previewEntries.length) {
                    suppressedAnchorRef.current = undefined;
                    clearHoveredAnchors(root);
                    located.block.classList.add("readweave-paragraph-anchor-hover");
                    setHoveredAnchor(root, rangeAnchorId, true);
                    setLockedAnchor(root, rangeAnchorId);
                    optionsRef.current.onHover(previewEntries, rangeAnchor.getBoundingClientRect(), true, located.block.getBoundingClientRect());
                } else {
                    // Selecting another fragment must never leave a locked card
                    // from the previously selected fragment on screen. This is
                    // especially visible when the new fragment only has a
                    // failed/in-progress job and therefore no preview entry.
                    clearLockedAnchor(root);
                    clearHoveredAnchors(root);
                    suppressedAnchorRef.current = undefined;
                    optionsRef.current.onHoverClear();
                }
                await selectExisting(root, rangeAnchorId, located.block, "range");
                return;
            }

            const paragraphAnchorId = located.block.dataset.readweaveAnchorId;
            if (paragraphAnchorId) await selectExisting(root, paragraphAnchorId, located.block, "paragraph");
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") removeBubble();
        }

        async function attachEditorWhenReady(attempt = 0) {
            const { editor, root, mode } = await editorAndRoot();
            if (disposed) return;
            if (!editor || !root) {
                if (mode === "readonly" && root) {
                    // A static note root does not expose CKEditor; it is still
                    // a complete ReadWeave interaction surface.
                } else if (attempt < 100) {
                    editorAttachTimer = window.setTimeout(() => attachEditorWhenReady(attempt + 1), 80);
                }
                if (!root) return;
            }
            editorRoot = root;
            root.dataset.readweaveContentRoot = mode;
            optionsRef.current.onContentRoot?.(root);
            root.addEventListener("mouseover", onAnchorMouseOver);
            root.addEventListener("mouseout", onAnchorMouseOut);
            if (mode === "editable" && editor) {
                normalizeRangeAnchorWhitespace(editor, root);
                if (reconcileOrphanedRangeAnchors(
                    editor,
                    root,
                    optionsRef.current.summaries,
                    optionsRef.current.generationJobs,
                    optionsRef.current.activeAnchorId,
                    optionsRef.current.dataReady
                )) {
                    persistReconciledReadWeaveAnchor(root, mode);
                }
            } else {
                restoreReadOnlyRangeAnchors(root, optionsRef.current.summaries, optionsRef.current.generationJobs);
            }
            decorateAnchors(root);
            observer = new MutationObserver(() => {
                if (mode === "editable" && editor) {
                    normalizeRangeAnchorWhitespace(editor, root);
                    decorateAnchors(root);
                } else {
                    restoreReadOnlyRangeAnchors(root, optionsRef.current.summaries, optionsRef.current.generationJobs);
                    decorateAnchors(root);
                }
            });
            observer.observe(root, { childList: true, subtree: true });
        }
        void attachEditorWhenReady();
        document.addEventListener("mouseup", onMouseUp, true);
        document.addEventListener("selectionchange", onSelectionChange, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("scroll", positionBubble, true);
        window.addEventListener("resize", positionBubble);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            disposed = true;
            pendingSelectionActionsRef.current = {};
            window.clearTimeout(editorAttachTimer);
            if (selectionFrame !== undefined) window.cancelAnimationFrame(selectionFrame);
            removeBubble();
            observer?.disconnect();
            editorRoot?.removeEventListener("mouseover", onAnchorMouseOver);
            editorRoot?.removeEventListener("mouseout", onAnchorMouseOut);
            editorRoot?.querySelectorAll<HTMLElement>(".readweave-anchor-active,.readweave-paragraph-selected,.readweave-anchor-hover,.readweave-anchor-locked,.readweave-paragraph-anchor-hover,[data-readweave-locked-anchor-id]").forEach(element => {
                element.classList.remove("readweave-anchor-active", "readweave-paragraph-selected", "readweave-anchor-hover", "readweave-anchor-locked", "readweave-paragraph-anchor-hover");
                delete element.dataset.readweaveLockedAnchorId;
            });
            if (editorRoot) {
                removeReadWeaveRuntimeRangeAnchors(editorRoot);
                clearReadWeaveProvisionalAnchors(editorRoot);
                if (editorRoot.dataset.readweaveContentRoot === "editable") delete editorRoot.dataset.readweaveContentRoot;
            }
            optionsRef.current.onContentRoot?.(null);
            hoveredAnchorRef.current = undefined;
            suppressedAnchorRef.current = undefined;
            document.removeEventListener("mouseup", onMouseUp, true);
            document.removeEventListener("selectionchange", onSelectionChange, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("scroll", positionBubble, true);
            window.removeEventListener("resize", positionBubble);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [options.noteId, options.noteContext, options.contentElement]);

    useEffect(() => {
        let cancelled = false;
        if (!options.noteContext) return;
        options.noteContext.getTextEditor().then(editor => {
            if (cancelled) return;
            const root = editor?.editing.view.getDomRoot() as HTMLElement | null
                ?? optionsRef.current.contentElement;
            if (root) {
                const latest = optionsRef.current;
                releaseReadWeaveProvisionalAnchors(root, [
                    ...latest.summaries.map(summary => summary.anchorId),
                    ...latest.generationJobs
                        .filter(job => !job.jobId.startsWith("readweave-local-"))
                        .map(job => job.anchorId)
                ]);
                if (editor && !root.dataset.readweaveContentRoot) {
                    if (reconcileOrphanedRangeAnchors(
                        editor,
                        root,
                        latest.summaries,
                        latest.generationJobs,
                        latest.activeAnchorId,
                        latest.dataReady
                    )) {
                        persistReconciledReadWeaveAnchor(root, "editable");
                    }
                } else {
                    restoreReadOnlyRangeAnchors(root, latest.summaries, latest.generationJobs);
                }
                applyAnchorSummaryDecorations(root, latest.summaries, latest.generationJobs);
                if (hoveredAnchorRef.current) {
                    matchingAnchorElements(root, hoveredAnchorRef.current).forEach(element => {
                        element.classList.add("readweave-anchor-hover");
                        element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                    });
                }
                const lockedAnchorId = READWEAVE_LOCKED_ANCHOR_BY_ROOT.get(root);
                if (lockedAnchorId) {
                    matchingAnchorElements(root, lockedAnchorId).forEach(element => {
                        element.classList.add("readweave-anchor-locked");
                        element.dataset.readweaveLockedAnchorId = lockedAnchorId;
                        element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                    });
                }
            }
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [options.noteId, options.noteContext, options.contentElement, options.summaries, options.generationJobs, options.dataReady, options.activeAnchorId]);

    return (preferredKind: ReadWeaveObjectKind): boolean => {
        const action = pendingSelectionActionsRef.current[preferredKind];
        if (!action) return false;
        action();
        return true;
    };
}

function normalizedAnchorText(value: string): string {
    return decodeReadWeaveText(value);
}

function persistReconciledReadWeaveAnchor(root: HTMLElement, mode: "editable" | "readonly" = "editable") {
    if (mode === "readonly" || !root.isConnected) return;
    void Promise.resolve(glob.getComponentByEl(root)?.triggerCommand("saveNoteDetailNow", { forceSnapshot: true }))
        .catch(() => undefined);
}

function defaultQuestionForExcerpt(excerpt: string): string {
    const normalized = decodeReadWeaveText(excerpt)
        .replace(/[：:，,；;。.!！?？]+$/u, "")
        .trim();
    if (!normalized) return "";
    return normalized.length <= 80
        ? t("readweave.default_question_short", { excerpt: normalized })
        : t("readweave.default_question_long");
}

function summaryMatchesRenderedText(summary: ReadWeaveAnchorSummary, renderedText: string, anchorType: ReadWeaveAnchorType): boolean {
    if (summary.anchorType !== anchorType) return false;
    const saved = normalizedAnchorText(summary.excerpt);
    const rendered = normalizedAnchorText(renderedText);
    if (!saved || !rendered) return false;
    if (saved === rendered) return true;
    if (anchorType !== "range") return false;
    return (rendered.startsWith(saved) && rendered.length - saved.length <= 2)
        || (saved.startsWith(rendered) && saved.length - rendered.length <= 2);
}

function summaryForRenderedText(summaries: ReadWeaveAnchorSummary[], anchorId: string, renderedText: string, anchorType: ReadWeaveAnchorType): ReadWeaveAnchorSummary | undefined {
    const exact = summaries.find(summary => summary.anchorId === anchorId);
    if (exact) return exact;
    const matches = summaries.filter(summary => summaryMatchesRenderedText(summary, renderedText, anchorType));
    return matches.length === 1 ? matches[0] : undefined;
}

function summaryForElement(summaries: ReadWeaveAnchorSummary[], anchorId: string, element: HTMLElement): ReadWeaveAnchorSummary | undefined {
    return summaryForRenderedText(
        summaries,
        anchorId,
        element.textContent ?? "",
        element.matches(RANGE_ANCHOR_SELECTOR) ? "range" : "paragraph"
    );
}

function previewEntriesForElement(
    summaries: ReadWeaveAnchorSummary[],
    generationJobs: ReadWeaveGenerationJob[],
    anchorId: string,
    element: HTMLElement
): ReadWeaveResolvedEntry[] {
    const saved = summaryForElement(summaries, anchorId, element)?.entries ?? [];
    const completedJobs = generationJobs
        .filter(job => job.anchorId === anchorId && isReadWeaveGenerationReviewable(job.status) && !!job.result?.body.trim())
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const latestByKind = new Map<ReadWeaveObjectKind, ReadWeaveGenerationJob>();
    for (const job of completedJobs) {
        if (!latestByKind.has(job.kind)) latestByKind.set(job.kind, job);
    }
    const pendingReviewEntries = Array.from(latestByKind.values()).flatMap(job => {
        const result = job.result!;
        const title = job.kind === "term"
            ? formatPartialTermIdentity(result.termIdentity ?? {}) || job.title
            : result.optimizedTitle?.trim() || job.title;
        const duplicatesSaved = saved.some(entry =>
            entry.kind === job.kind
            && normalizedAnchorText(entry.title) === normalizedAnchorText(title)
            && normalizedAnchorText(entry.body) === normalizedAnchorText(result.body));
        if (duplicatesSaved || (job.kind === "term" && saved.some(entry => entry.kind === "term"))) return [];
        const calloutType = defaultReadWeaveCallout(job.kind);
        return [ {
            linkId: `readweave-generation:${job.jobId}`,
            articleId: job.articleId,
            anchorId: job.anchorId,
            anchorType: job.anchorType,
            objectId: `readweave-generation:${job.jobId}`,
            sourceLocator: job.sourceLocator,
            parentLinkId: job.parentLinkId,
            rootLinkId: job.parentLinkId,
            depth: job.parentLinkId ? 1 : 0,
            kind: job.kind,
            title,
            body: result.body,
            calloutType,
            termIdentity: result.termIdentity,
            verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact,
            canonicalTitle: title,
            canonicalBody: result.body,
            canonicalCalloutType: calloutType,
            qualityState: result.qualityState ?? "legacy-unverified",
            revision: 0,
            isDisplayOverride: false
        } satisfies ReadWeaveResolvedEntry ];
    });
    return [ ...saved, ...pendingReviewEntries ];
}

function summaryForAnchorGroup(summaries: ReadWeaveAnchorSummary[], anchorId: string, elements: HTMLElement[]): ReadWeaveAnchorSummary | undefined {
    const anchorType: ReadWeaveAnchorType = elements.some(element => element.matches(RANGE_ANCHOR_SELECTOR)) ? "range" : "paragraph";
    return summaryForRenderedText(summaries, anchorId, elements.map(element => element.textContent ?? "").join(""), anchorType);
}

function applyGenerationJobStatus(element: HTMLElement, job: ReadWeaveGenerationJob) {
    const renderedVersion = element.dataset.readweaveJobUpdatedAt;
    if (renderedVersion && renderedVersion > job.updatedAt) return;
    element.classList.remove("readweave-anchor-status", ...READWEAVE_GENERATION_STATUS_CLASSES);
    const statusClass = readWeaveGenerationStatusClass(job);
    if (statusClass) element.classList.add("readweave-anchor-status", statusClass);
    element.dataset.readweaveJobUpdatedAt = job.updatedAt;
}

function applyGenerationJobStatusDecorations(root: HTMLElement, generationJobs: ReadWeaveGenerationJob[]) {
    if (!generationJobs.length) return;
    const jobsByAnchor = new Map(generationJobs.map(job => [ job.anchorId, job ]));
    const elements = Array.from(root.querySelectorAll<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`))
        .filter(element => readWeaveAnchorIdsOf(element).some(anchorId => jobsByAnchor.has(anchorId)));

    for (const job of generationJobs) {
        const matching = elements.filter(element => readWeaveAnchorIdsOf(element).includes(job.anchorId));
        const groups = new Map<HTMLElement, HTMLElement[]>();
        for (const element of matching) {
            const block = element.closest<HTMLElement>(BLOCK_SELECTOR) ?? element;
            groups.set(block, [ ...(groups.get(block) ?? []), element ]);
        }
        for (const group of groups.values()) {
            const statusClass = readWeaveGenerationStatusClass(job);
            for (const element of group) {
                const renderedVersion = element.dataset.readweaveJobUpdatedAt;
                if (renderedVersion && renderedVersion > job.updatedAt) continue;
                element.classList.toggle("readweave-anchor-status", !!statusClass);
                element.dataset.readweaveJobUpdatedAt = job.updatedAt;
            }
            const head = group.find(element => !!element.textContent?.trim()) ?? group[0];
            if (!head) continue;
            applyGenerationJobStatus(head, job);
        }
    }
}

function applyAnchorSummaryDecorations(root: HTMLElement, summaries: ReadWeaveAnchorSummary[], generationJobs: ReadWeaveGenerationJob[]) {
    const allAnchorClasses = [
        "readweave-anchor-end",
        "readweave-range-anchor",
        "readweave-paragraph-anchor",
        "readweave-term-anchor",
        "readweave-anchor-has-question",
        "readweave-anchor-has-term",
        "readweave-anchor-draft"
    ];
    const grouped = new Map<string, HTMLElement[]>();
    const allAnchorElements = Array.from(root.querySelectorAll<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`));
    allAnchorElements.forEach(element => {
        element.classList.remove(...allAnchorClasses);
        for (const type of CALLOUT_TYPES) {
            element.classList.remove(`readweave-anchor-callout-${type}`, `readweave-term-callout-${type}`);
        }
        delete element.dataset.readweaveQuestionCount;
        delete element.dataset.readweaveTermCount;
        const anchorIds = readWeaveAnchorIdsOf(element);
        if (!anchorIds.some(anchorId => generationJobs.some(job => job.anchorId === anchorId))) {
            element.classList.remove("readweave-anchor-status", ...READWEAVE_GENERATION_STATUS_CLASSES);
            delete element.dataset.readweaveJobUpdatedAt;
        }
        for (const anchorId of anchorIds) {
            grouped.set(anchorId, [ ...(grouped.get(anchorId) ?? []), element ]);
        }
    });
    for (const [ anchorId, elements ] of grouped) {
        const summary = summaryForAnchorGroup(summaries, anchorId, elements);
        const job = generationJobs.find(candidate => candidate.anchorId === anchorId);
        if (!summary?.entries.length && !job) continue;
        const anchorType = summary?.entries.length ? anchorCalloutType(summary) : (job?.kind === "term" ? "tip" : "note");
        const termType = calloutTypeForKind(summary, "term");
        elements.forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-range-anchor" : "readweave-paragraph-anchor"));
        elements.forEach(element => element.classList.add(`readweave-anchor-callout-${anchorType}`));
        const jobStatusClass = job ? readWeaveGenerationStatusClass(job) : undefined;
        if (jobStatusClass) elements.forEach(element => element.classList.add("readweave-anchor-draft"));
        if ((summary?.questionCount ?? 0) > 0) elements.forEach(element => element.classList.add("readweave-anchor-has-question"));
        if ((summary?.termCount ?? 0) > 0) {
            elements.forEach(element => element.classList.add("readweave-anchor-has-term"));
            if (termType) elements.forEach(element => element.classList.add("readweave-term-anchor", `readweave-term-callout-${termType}`));
        }
        if (job) {
            elements.forEach(element => {
                const renderedVersion = element.dataset.readweaveJobUpdatedAt;
                if (renderedVersion && renderedVersion > job.updatedAt) return;
                element.classList.toggle("readweave-anchor-status", !!jobStatusClass);
                element.dataset.readweaveJobUpdatedAt = job.updatedAt;
            });
            const statusHead = elements.find(element => !!element.textContent?.trim()) ?? elements[0];
            if (statusHead) applyGenerationJobStatus(statusHead, job);
        }
        const badgeTail = elements.findLast(element => !!element.textContent?.trim()) ?? elements.at(-1);
        if (badgeTail) {
            badgeTail.classList.add("readweave-anchor-end");
            if ((summary?.questionCount ?? 0) > 0) badgeTail.dataset.readweaveQuestionCount = String(summary!.questionCount);
            if ((summary?.termCount ?? 0) > 0) badgeTail.dataset.readweaveTermCount = String(summary!.termCount);
        }
    }

    for (const block of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
        block.classList.remove("readweave-paragraph-has-questions", "readweave-paragraph-has-terms", "readweave-paragraph-anchor-hover");
        for (const type of CALLOUT_TYPES) {
            block.classList.remove(`readweave-paragraph-question-callout-${type}`, `readweave-paragraph-term-callout-${type}`);
        }
        delete block.dataset.readweaveParagraphAnchorIds;
        delete block.dataset.readweaveParagraphQuestionCount;
        delete block.dataset.readweaveParagraphTermCount;

        const anchorElements = [
            ...(block.matches(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`) ? [block] : []),
            ...Array.from(block.querySelectorAll<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`))
        ];
        const anchorIds = Array.from(new Set(anchorElements.flatMap(readWeaveAnchorIdsOf)));
        const blockSummaries = Array.from(new Map(anchorIds.flatMap(anchorId => {
            const summary = summaryForAnchorGroup(summaries, anchorId, grouped.get(anchorId) ?? []);
            return summary ? [ [ summary.anchorId, summary ] as const ] : [];
        })).values());
        const blockJobs = anchorIds.flatMap(anchorId => generationJobs.find(job => job.anchorId === anchorId) ?? []);
        if (!blockSummaries.length && !blockJobs.length) continue;

        const questionCount = blockSummaries.reduce((count, summary) => count + summary.questionCount, 0);
        const termCount = blockSummaries.reduce((count, summary) => count + summary.termCount, 0);
        const questionType = blockSummaries.map(summary => calloutTypeForKind(summary, "question")).find((type): type is ReadWeaveCalloutType => !!type);
        const termType = blockSummaries.map(summary => calloutTypeForKind(summary, "term")).find((type): type is ReadWeaveCalloutType => !!type);

        block.dataset.readweaveParagraphAnchorIds = anchorIds.join(" ");
        if (questionCount > 0) {
            block.classList.add("readweave-paragraph-has-questions", `readweave-paragraph-question-callout-${questionType ?? "note"}`);
            block.dataset.readweaveParagraphQuestionCount = String(questionCount);
        }
        if (termCount > 0) {
            block.classList.add("readweave-paragraph-has-terms", `readweave-paragraph-term-callout-${termType ?? "tip"}`);
            block.dataset.readweaveParagraphTermCount = String(termCount);
        }
    }
}

function anchorCalloutType(summary: ReadWeaveAnchorSummary | undefined): ReadWeaveCalloutType {
    return calloutTypeForKind(summary, "question")
        ?? calloutTypeForKind(summary, "term")
        ?? "note";
}

function generationJobStateClass(job: Pick<ReadWeaveGenerationJob, "status" | "qualityState">): string {
    if (job.status === "failed") return "error";
    if (job.status === "paused") return "paused";
    if (job.status === "queued" || job.status === "running" || job.status === "saving") return "running";
    if (job.status === "ready-for-review") return "complete";
    if (job.status === "saved") return "complete";
    return "paused";
}

function generationJobStatusLabel(job: Pick<ReadWeaveGenerationJob, "status" | "qualityState">): string {
    if (job.status === "queued" || job.status === "running" || job.status === "saving") return "生成中";
    if (job.status === "ready-for-review") return "已生成";
    if (job.status === "paused") return "已暂停";
    if (job.status === "failed") return "失败";
    if (job.status === "saved") return "已入库";
    return "已取消";
}

function calloutTypeForKind(summary: ReadWeaveAnchorSummary | undefined, kind: ReadWeaveObjectKind): ReadWeaveCalloutType | undefined {
    return summary?.entries.find(entry => entry.kind === kind)?.calloutType;
}

function findEditableBlock(target: EventTarget | null): { root: HTMLElement; block: HTMLElement } | null {
    if (!(target instanceof Element)) return null;
    const root = target.closest<HTMLElement>('[data-readweave-content-root], [contenteditable="true"][role="textbox"]');
    if (!root) return null;
    const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
    return block && root.contains(block) ? { root, block } : null;
}

function rangeIsContainedByBlock(block: HTMLElement, range: Range): boolean {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    return blockRange.compareBoundaryPoints(Range.START_TO_START, range) <= 0
        && blockRange.compareBoundaryPoints(Range.END_TO_END, range) >= 0;
}

function preferredAnchorIdOf(
    element: Element | null | undefined,
    summaries: ReadWeaveAnchorSummary[],
    generationJobs: ReadWeaveGenerationJob[]
): string | undefined {
    return mostSpecificReadWeaveAnchorId(element, [
        ...summaries,
        ...generationJobs.map(job => ({ anchorId: job.anchorId, excerpt: job.sourceExcerpt }))
    ]);
}

function matchingAnchorElements(root: HTMLElement, anchorId: string): HTMLElement[] {
    return matchingReadWeaveAnchorElements(root, anchorId);
}

function rangesEqual(left: Range, right: Range): boolean {
    return left.startContainer === right.startContainer
        && left.startOffset === right.startOffset
        && left.endContainer === right.endContainer
        && left.endOffset === right.endOffset;
}

function trimRangeWhitespace(input: Range): Range {
    const range = input.cloneRange();
    const selectedText = range.toString();
    const leadingCount = selectedText.length - selectedText.trimStart().length;
    const trailingCount = selectedText.length - selectedText.trimEnd().length;
    if (!leadingCount && !trailingCount) return range;

    const traversalRoot = range.commonAncestorContainer instanceof Text
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
    if (!traversalRoot) return range;
    const walker = document.createTreeWalker(traversalRoot, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    if (traversalRoot instanceof Text) nodes.push(traversalRoot);
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        try {
            if (range.intersectsNode(node)) nodes.push(node);
        } catch {
            // Ignore detached text nodes while CKEditor is reconciling its view.
        }
    }
    const slices = nodes.map(node => ({
        node,
        start: node === range.startContainer ? range.startOffset : 0,
        end: node === range.endContainer ? range.endOffset : node.data.length
    })).filter(slice => slice.end > slice.start);

    let leading = leadingCount;
    for (const slice of slices) {
        const length = slice.end - slice.start;
        if (leading <= length) {
            range.setStart(slice.node, slice.start + leading);
            break;
        }
        leading -= length;
    }

    let trailing = trailingCount;
    for (const slice of slices.toReversed()) {
        const length = slice.end - slice.start;
        if (trailing <= length) {
            range.setEnd(slice.node, slice.end - trailing);
            break;
        }
        trailing -= length;
    }
    return range;
}

function normalizeRangeAnchorWhitespace(editor: CKTextEditor, root: HTMLElement) {
    const grouped = new Map<string, HTMLElement[]>();
    root.querySelectorAll<HTMLElement>(RANGE_ANCHOR_SELECTOR).forEach(element => {
        for (const anchorId of readWeaveAnchorIdsOf(element)) {
            grouped.set(anchorId, [ ...(grouped.get(anchorId) ?? []), element ]);
        }
    });
    const domRanges: Array<{ anchorId: string; range: Range }> = [];
    for (const [ anchorId, elements ] of grouped) {
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) continue;
        if (!first.textContent?.trim()) {
            const whitespace = document.createRange();
            whitespace.selectNodeContents(first);
            domRanges.push({ anchorId, range: whitespace });
        } else {
            const full = document.createRange();
            full.selectNodeContents(first);
            const trimmed = trimRangeWhitespace(full);
            if (full.startContainer !== trimmed.startContainer || full.startOffset !== trimmed.startOffset) {
                full.setEnd(trimmed.startContainer, trimmed.startOffset);
                domRanges.push({ anchorId, range: full });
            }
        }
        if (last !== first && !last.textContent?.trim()) {
            const whitespace = document.createRange();
            whitespace.selectNodeContents(last);
            domRanges.push({ anchorId, range: whitespace });
        } else if (last.textContent?.trim()) {
            const full = document.createRange();
            full.selectNodeContents(last);
            const trimmed = trimRangeWhitespace(full);
            if (full.endContainer !== trimmed.endContainer || full.endOffset !== trimmed.endOffset) {
                full.setStart(trimmed.endContainer, trimmed.endOffset);
                domRanges.push({ anchorId, range: full });
            }
        }
    }
    const modelRanges = domRanges.flatMap(({ anchorId, range }) => {
        try {
            const viewRange = editor.editing.view.domConverter.domRangeToView(range);
            const modelRange = viewRange ? editor.editing.mapper.toModelRange(viewRange) : null;
            return modelRange && !modelRange.isCollapsed ? [ { anchorId, range: modelRange } ] : [];
        } catch {
            return [];
        }
    });
    if (!modelRanges.length) return;
    editor.model.change(writer => modelRanges.forEach(item => updateReadWeaveAnchorIdOnRange(writer, item.range, item.anchorId, "remove")));
}

function restoreReadOnlyRangeAnchors(
    root: HTMLElement,
    summaries: ReadWeaveAnchorSummary[],
    generationJobs: ReadWeaveGenerationJob[]
): void {
    const candidates = new Map<string, { excerpt: string; sourceLocator?: ReadWeaveSourceLocator }>();
    for (const summary of summaries) {
        if (summary.anchorType === "range" && summary.excerpt.trim()) {
            candidates.set(summary.anchorId, { excerpt: summary.excerpt, sourceLocator: summary.sourceLocator });
        }
    }
    for (const job of generationJobs) {
        if (job.anchorType === "range" && job.sourceExcerpt.trim() && !candidates.has(job.anchorId)) {
            candidates.set(job.anchorId, { excerpt: job.sourceExcerpt, sourceLocator: job.sourceLocator });
        }
    }
    for (const [anchorId, candidate] of candidates) {
        if (matchingReadWeaveAnchorElements(root, anchorId).length > 0) continue;
        const exact = candidate.sourceLocator
            ? readWeaveRangeForSourceLocator(root, BLOCK_SELECTOR, candidate.sourceLocator, candidate.excerpt)
            : undefined;
        const range = exact
            ?? uniqueReadWeaveExcerptRangeWithLocator(root, BLOCK_SELECTOR, candidate.excerpt, candidate.sourceLocator);
        if (range) applyReadWeaveRuntimeRangeAnchor(root, range, anchorId);
    }
}

function reconcileOrphanedRangeAnchors(
    editor: CKTextEditor,
    root: HTMLElement,
    summaries: ReadWeaveAnchorSummary[],
    generationJobs: ReadWeaveGenerationJob[],
    activeAnchorId: string | undefined,
    dataReady: boolean
): boolean {
    const grouped = new Map<string, HTMLElement[]>();
    root.querySelectorAll<HTMLElement>(RANGE_ANCHOR_SELECTOR).forEach(element => {
        for (const anchorId of readWeaveAnchorIdsOf(element)) {
            grouped.set(anchorId, [ ...(grouped.get(anchorId) ?? []), element ]);
        }
    });
    const repairs: Array<{ full: Range; exact: Range; orphanAnchorId: string; summary: ReadWeaveAnchorSummary }> = [];
    const staleRanges: Array<{ full: Range; anchorId: string }> = [];
    const persistedAnchorIds = new Set([
        ...summaries.map(summary => summary.anchorId),
        ...generationJobs.map(job => job.anchorId),
        ...provisionalReadWeaveAnchorIds(root),
        ...(activeAnchorId ? [ activeAnchorId ] : [])
    ]);
    for (const [ anchorId, elements ] of grouped) {
        const exactSummary = summaries.find(summary => summary.anchorId === anchorId);
        const summary = exactSummary ?? summaryForAnchorGroup(summaries, anchorId, elements);
        if (!summary || summary.anchorType !== "range") {
            // A range becomes durable only after it has a saved entry or a
            // server-side generation job. Local form state alone must not
            // leave a permanent underline after a reload.
            const full = dataReady && !persistedAnchorIds.has(anchorId)
                ? readWeaveAnchorGroupRange(root, anchorId)
                : null;
            if (full) staleRanges.push({ full, anchorId });
            continue;
        }
        const rendered = elements.map(element => element.textContent ?? "").join("");
        const saved = summary.excerpt;
        if (exactSummary && normalizedAnchorText(rendered) === normalizedAnchorText(saved)) continue;
        const full = readWeaveAnchorGroupRange(root, anchorId);
        const exact = (exactSummary?.sourceLocator
            ? readWeaveRangeForSourceLocator(root, BLOCK_SELECTOR, exactSummary.sourceLocator, saved)
            : undefined)
            ?? exactReadWeaveExcerptRange(elements, BLOCK_SELECTOR, saved);
        if (full && exact) repairs.push({ full, exact, orphanAnchorId: anchorId, summary });
    }
    const missingPersistedRanges = Array.from(new Map([
        ...summaries
            .filter(summary => summary.anchorType === "range")
            .map(summary => [ summary.anchorId, { anchorId: summary.anchorId, excerpt: summary.excerpt, sourceLocator: summary.sourceLocator } ] as const),
        ...generationJobs
            .filter(job => job.anchorType === "range" && !job.jobId.startsWith("readweave-local-"))
            .map(job => [ job.anchorId, { anchorId: job.anchorId, excerpt: job.sourceExcerpt, sourceLocator: job.sourceLocator } ] as const)
    ]).values()).flatMap(candidate => {
        if (grouped.has(candidate.anchorId)) return [];
        const exact = (candidate.sourceLocator
            ? readWeaveRangeForSourceLocator(root, BLOCK_SELECTOR, candidate.sourceLocator, candidate.excerpt)
            : undefined)
            ?? uniqueReadWeaveExcerptRangeWithLocator(root, BLOCK_SELECTOR, candidate.excerpt, candidate.sourceLocator);
        return exact ? [ { exact, anchorId: candidate.anchorId } ] : [];
    });
    if (!repairs.length && !staleRanges.length && !missingPersistedRanges.length) return false;
    const staleModelRanges = staleRanges.flatMap(stale => {
        try {
            const fullViewRange = editor.editing.view.domConverter.domRangeToView(stale.full);
            const fullModelRange = fullViewRange ? editor.editing.mapper.toModelRange(fullViewRange) : null;
            return fullModelRange && !fullModelRange.isCollapsed
                ? [ { fullModelRange, anchorId: stale.anchorId } ]
                : [];
        } catch {
            return [];
        }
    });
    const modelRepairs = repairs.flatMap(repair => {
        try {
            const fullViewRange = editor.editing.view.domConverter.domRangeToView(repair.full);
            const exactViewRange = editor.editing.view.domConverter.domRangeToView(repair.exact);
            const fullModelRange = fullViewRange ? editor.editing.mapper.toModelRange(fullViewRange) : null;
            const exactModelRange = exactViewRange ? editor.editing.mapper.toModelRange(exactViewRange) : null;
            return fullModelRange && exactModelRange && !exactModelRange.isCollapsed
                ? [ { fullModelRange, exactModelRange, orphanAnchorId: repair.orphanAnchorId, anchorId: repair.summary.anchorId } ]
                : [];
        } catch {
            return [];
        }
    });
    const missingPersistedModelRanges = missingPersistedRanges.flatMap(repair => {
        try {
            const exactViewRange = editor.editing.view.domConverter.domRangeToView(repair.exact);
            const exactModelRange = exactViewRange ? editor.editing.mapper.toModelRange(exactViewRange) : null;
            return exactModelRange && !exactModelRange.isCollapsed
                ? [ { exactModelRange, anchorId: repair.anchorId } ]
                : [];
        } catch {
            return [];
        }
    });
    if (!modelRepairs.length && !staleModelRanges.length && !missingPersistedModelRanges.length) return false;
    editor.model.change(writer => {
        for (const stale of staleModelRanges) {
            updateReadWeaveAnchorIdOnRange(writer, stale.fullModelRange, stale.anchorId, "remove");
        }
        for (const repair of modelRepairs) {
            updateReadWeaveAnchorIdOnRange(writer, repair.fullModelRange, repair.orphanAnchorId, "remove");
            updateReadWeaveAnchorIdOnRange(writer, repair.exactModelRange, repair.anchorId, "add");
        }
        for (const repair of missingPersistedModelRanges) {
            updateReadWeaveAnchorIdOnRange(writer, repair.exactModelRange, repair.anchorId, "add");
        }
    });
    return true;
}

function rangeStrictlyIntersectsElement(range: Range, element: Element): boolean {
    const elementRange = document.createRange();
    elementRange.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.START_TO_END, elementRange) > 0
        && range.compareBoundaryPoints(Range.END_TO_START, elementRange) < 0;
}

function textOf(element: Element | null | undefined, maxLength = 10_000): string {
    return decodeReadWeaveText(element?.textContent ?? "").slice(0, maxLength);
}

function textOfAnchorElements(elements: HTMLElement[], maxLength = 10_000): string {
    return decodeReadWeaveText(elements.map(element => element.textContent ?? "").join("")).slice(0, maxLength);
}

function resolveSourceExcerpt(selection: AnchorSelection, job: ReadWeaveGenerationJob | undefined): string {
    return decodeReadWeaveText(selection.excerpt)
        || decodeReadWeaveText(job?.sourceExcerpt ?? "")
        || decodeReadWeaveText(selection.fragments.find(fragment => fragment.role === "selected")?.text ?? "")
        || "";
}

function collectFragments(root: HTMLElement, block: HTMLElement, selectedText: string): ReadWeaveContextFragment[] {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    const index = blocks.indexOf(block);
    const previousHeadingIndex = blocks.slice(0, Math.max(index + 1, 0)).findLastIndex(item => /^H[1-6]$/.test(item.tagName));
    const nextHeadingRelative = blocks.slice(index + 1).findIndex(item => /^H[1-6]$/.test(item.tagName));
    const sectionEnd = nextHeadingRelative < 0 ? blocks.length : index + 1 + nextHeadingRelative;
    const sectionStart = Math.max(previousHeadingIndex, 0);
    const fragments: ReadWeaveContextFragment[] = [
        { id: "selected", role: "selected", text: selectedText },
        { id: "heading", role: "heading", text: textOf(blocks[previousHeadingIndex]) },
        ...[1, 2, 3].map(distance => ({ id: `previous-${distance}`, role: "previous" as const, text: textOf(blocks[index - distance]), distance })),
        ...[1, 2, 3].map(distance => ({ id: `next-${distance}`, role: "next" as const, text: textOf(blocks[index + distance]), distance })),
        { id: "section", role: "section", text: blocks.slice(sectionStart, sectionEnd).map(item => textOf(item)).join("\n").slice(0, 30_000), distance: 5 },
        { id: "document", role: "document", text: textOf(root, 80_000), distance: 20 }
    ];
    return fragments.filter(fragment => fragment.text);
}

function nestedQuestionFragments(
    entries: ReadWeaveResolvedEntry[],
    parent: ReadWeaveResolvedEntry,
    articleFragments: ReadWeaveContextFragment[]
): ReadWeaveContextFragment[] {
    const chain: ReadWeaveResolvedEntry[] = [];
    let current: ReadWeaveResolvedEntry | undefined = parent;
    const seen = new Set<string>();
    while (current && !seen.has(current.linkId) && chain.length < 5) {
        seen.add(current.linkId);
        chain.unshift(current);
        current = current.parentLinkId
            ? entries.find(entry => entry.linkId === current!.parentLinkId)
            : undefined;
    }
    const immediate = chain.at(-1)!;
    return [
        {
            id: `follow-up-answer-${immediate.linkId}`,
            role: "selected",
            text: `问题：${decodeReadWeaveText(immediate.title)}\n回答：${decodeReadWeaveText(immediate.body)}`
        },
        ...chain.slice(0, -1).map((entry, index) => ({
            id: `follow-up-ancestor-${index + 1}-${entry.linkId}`,
            role: "previous" as const,
            distance: chain.length - index,
            text: `上级问题：${decodeReadWeaveText(entry.title)}\n上级回答：${decodeReadWeaveText(entry.body)}`
        })),
        ...articleFragments.map(fragment => ({
            ...fragment,
            id: `article-${fragment.id}`,
            role: fragment.role === "selected" ? "section" as const : fragment.role,
            distance: (fragment.distance ?? 0) + 10
        }))
    ];
}

function initialTermIdentity(_excerpt: string, _kind: ReadWeaveObjectKind): Partial<ReadWeaveTermIdentity> {
    return {};
}

function cleanPartialTermIdentity(value: Partial<ReadWeaveTermIdentity>): Partial<ReadWeaveTermIdentity> {
    return normalizeReadWeaveTermIdentityForReview({
        abbreviation: value.abbreviation?.trim() || undefined,
        chineseName: value.chineseName?.trim() || undefined,
        englishName: value.englishName?.trim() || undefined
    });
}

function formatPartialTermIdentity(value: Partial<ReadWeaveTermIdentity>): string {
    const clean = cleanPartialTermIdentity(value);
    const name = clean.englishName && clean.chineseName ? `${clean.chineseName}（${clean.englishName}）` : clean.chineseName || "";
    return [clean.abbreviation, name].filter(Boolean).join(" ");
}

function draftKey(noteId: string, anchorId: string, parentLinkId?: string, draftId?: string) {
    return `readweave:draft:${noteId}:${anchorId}:${parentLinkId ?? "root"}:${draftId ?? "latest"}`;
}

function readDraft(noteId: string, anchorId: string, parentLinkId?: string, draftId?: string): Draft | undefined {
    const value = sessionStorage.getItem(draftKey(noteId, anchorId, parentLinkId, draftId));
    if (!value) return undefined;
    try {
        return JSON.parse(value) as Draft;
    } catch {
        return undefined;
    }
}

async function loadReadWeaveEntries(noteId: string, anchorId: string): Promise<ReadWeaveResolvedEntry[]> {
    const response = await server.get<{ entries: ReadWeaveResolvedEntry[] }>(`readweave/articles/${encodeURIComponent(noteId)}/anchors/${encodeURIComponent(anchorId)}`);
    return response.entries;
}

async function persistReadWeaveAnchor(
    noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"],
    selection?: Pick<AnchorSelection, "readonly">
) {
    // Read-only articles own their original HTML. Their anchors live only in
    // the sidecar job/link data and in runtime DOM markers.
    if (selection?.readonly) return;
    const editor = await noteContext?.getTextEditor().catch(() => null);
    const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
    if (!root) return;
    await glob.getComponentByEl(root)?.triggerCommand("saveNoteDetailNow", { forceSnapshot: true });
}

async function readWeaveAnchorIsPresent(
    noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"],
    anchorId: string,
    readonly = false
): Promise<boolean> {
    if (readonly) {
        const content = await noteContext?.getContentElement().catch(() => null);
        return !!content?.[0] && matchingReadWeaveAnchorElements(content[0], anchorId).length > 0;
    }
    const editor = await noteContext?.getTextEditor().catch(() => null);
    const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
    return !!root && matchingReadWeaveAnchorElements(root, anchorId).length > 0;
}

async function removeProvisionalAnchor(
    noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"],
    anchorId: string,
    readonly = false
) {
    if (readonly) {
        const content = await noteContext?.getContentElement().catch(() => null);
        if (content?.[0]) removeReadWeaveRuntimeRangeAnchors(content[0], anchorId);
        return;
    }
    const editor = await noteContext?.getTextEditor().catch(() => null);
    const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
    if (!editor || !root) return;
    const ranges = matchingAnchorElements(root, anchorId).flatMap(element => {
        try {
            const domRange = document.createRange();
            domRange.selectNodeContents(element);
            const viewRange = editor.editing.view.domConverter.domRangeToView(domRange);
            const modelRange = viewRange ? editor.editing.mapper.toModelRange(viewRange) : null;
            return modelRange && !modelRange.isCollapsed ? [ modelRange ] : [];
        } catch {
            return [];
        }
    });
    if (ranges.length) editor.model.change(writer => ranges.forEach(range => updateReadWeaveAnchorIdOnRange(writer, range, anchorId, "remove")));
    forgetReadWeaveProvisionalAnchor(root, anchorId);
}

function createTransientGenerationJob(input: {
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    parentLinkId?: string;
    title: string;
    sourceExcerpt: string;
    sourceLocator?: ReadWeaveSourceLocator;
}): ReadWeaveGenerationJob {
    const now = new Date().toISOString();
    return {
        jobId: `readweave-local-${utils.randomString(20)}`,
        draftId: `readweave-draft-${utils.randomString(20)}`,
        ...input,
        stateVersion: 0,
        status: "queued",
        qualityState: "legacy-unverified",
        harnessVersion: "pending",
        evidenceState: "not-checked",
        unresolvedIssues: [],
        issues: [],
        unread: false,
        progress: [ {
            sequence: 1,
            timestamp: now,
            elapsedMs: 0,
            stage: "queued",
            round: 0,
            message: t("readweave.generation_queued"),
            issues: []
        } ],
        createdAt: now,
        updatedAt: now
    };
}

function createOptimisticRegenerationJob(input: {
    jobId: string;
    previous?: ReadWeaveGenerationJob;
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    parentLinkId?: string;
    title: string;
    sourceExcerpt: string;
    sourceLocator?: ReadWeaveSourceLocator;
    feedback?: string;
}): ReadWeaveGenerationJob {
    const queued = createTransientGenerationJob({
        articleId: input.articleId,
        anchorId: input.anchorId,
        anchorType: input.anchorType,
        kind: input.kind,
        parentLinkId: input.parentLinkId,
        title: input.title,
        sourceExcerpt: input.sourceExcerpt,
        sourceLocator: input.sourceLocator
    });
    const updatedAt = nextReadWeaveJobTimestamp(input.previous?.updatedAt);
    return {
        ...queued,
        ...input.previous,
        articleId: input.articleId,
        anchorId: input.anchorId,
        anchorType: input.anchorType,
        kind: input.kind,
        parentLinkId: input.parentLinkId,
        title: input.title,
        sourceExcerpt: input.sourceExcerpt,
        sourceLocator: input.sourceLocator,
        jobId: input.jobId,
        stateVersion: (input.previous?.stateVersion ?? 0) + 1,
        status: "queued",
        unread: false,
        feedback: input.feedback,
        error: undefined,
        progress: queued.progress.map(progress => ({ ...progress, timestamp: updatedAt })),
        createdAt: updatedAt,
        updatedAt
    };
}

function nextReadWeaveJobTimestamp(previous?: string): string {
    const previousTimestamp = previous ? Date.parse(previous) : Number.NaN;
    return new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
}

function delay(milliseconds: number) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function formatElapsed(milliseconds: number): string {
    const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatLogTime(value: string | undefined): string {
    if (!value) return "--:--:--";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour12: false });
}

function readableError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object") {
        const candidate = error as { message?: unknown; responseJSON?: { message?: unknown }; responseText?: unknown };
        if (typeof candidate.responseJSON?.message === "string") return candidate.responseJSON.message;
        if (typeof candidate.message === "string") return candidate.message;
        if (typeof candidate.responseText === "string") {
            try {
                const parsed = JSON.parse(candidate.responseText) as { message?: unknown };
                if (typeof parsed.message === "string") return parsed.message;
            } catch {
                if (candidate.responseText.trim()) return candidate.responseText;
            }
        }
    }
    return fallback;
}
