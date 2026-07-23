import "./ReadWeavePanel.css";

import { type CKTextEditor, updateReadWeaveAnchorIdOnRange } from "@triliumnext/ckeditor5";
import type {
    ReadWeaveAnchorSummary,
    ReadWeaveAnchorType,
    ReadWeaveCalloutType,
    ReadWeaveCandidate,
    ReadWeaveContextFragment,
    ReadWeaveEditMode,
    ReadWeaveGenerateResponse,
    ReadWeaveGenerationJob,
    ReadWeaveGenerationProgress,
    ReadWeaveImpact,
    ReadWeaveObject,
    ReadWeaveObjectKind,
    ReadWeaveResolvedEntry,
    ReadWeaveTermIdentity
} from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import utils from "../../services/utils.js";
import { useActiveNoteContext } from "../react/hooks.js";
import {
    exactReadWeaveAnchorIdForExcerpt,
    exactReadWeaveExcerptRange,
    matchingReadWeaveAnchorElements,
    mostSpecificReadWeaveAnchorId,
    rangesAreNestedOrDisjoint,
    READWEAVE_PARAGRAPH_ANCHOR_SELECTOR,
    READWEAVE_RANGE_ANCHOR_SELECTOR,
    readWeaveAnchorGroupRange,
    readWeaveAnchorIdsOf
} from "./readweave_anchor_dom.js";
import {
    calloutAfterKindChange,
    defaultReadWeaveCallout,
    isReadWeaveGenerationDisabled,
    normalizeReadWeaveTermIdentityForReview,
    visibleReadWeaveCandidates
} from "./readweave_panel_state.js";
import RightPanelWidget from "./RightPanelWidget.js";

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre";
const RANGE_ANCHOR_SELECTOR = READWEAVE_RANGE_ANCHOR_SELECTOR;
const PARAGRAPH_ANCHOR_SELECTOR = READWEAVE_PARAGRAPH_ANCHOR_SELECTOR;
const CALLOUT_TYPES: ReadWeaveCalloutType[] = [ "note", "tip", "important", "warning", "caution" ];
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
    pending?: boolean;
}

interface Draft {
    kind: ReadWeaveObjectKind;
    questionTitle: string;
    optimizeQuestion: boolean;
    termIdentity: Partial<ReadWeaveTermIdentity>;
    body: string;
    calloutType: ReadWeaveCalloutType;
    reuseObjectId?: string;
    contextDecision?: ReadWeaveGenerateResponse["context"];
    generationJobId?: string;
    reviewIssues?: string[];
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

interface HoverPreview {
    entries: ReadWeaveResolvedEntry[];
    locked: boolean;
    left: number;
    top: number;
    width: number;
}

interface SelectionActionTarget {
    revision: number;
    identityRevision: number;
    noteId: string;
    anchorId: string;
    kind: ReadWeaveObjectKind;
}

export default function ReadWeavePanel() {
    const { note, noteId, noteContext } = useActiveNoteContext();
    const articleNoteId = note?.type === "text" && note.isContentAvailable() ? noteId : undefined;
    const [selection, setSelection] = useState<AnchorSelection>();
    const [entries, setEntries] = useState<ReadWeaveResolvedEntry[]>([]);
    const [anchorSummaries, setAnchorSummaries] = useState<ReadWeaveAnchorSummary[]>([]);
    const [kind, setKind] = useState<ReadWeaveObjectKind>("question");
    const [questionTitle, setQuestionTitle] = useState("");
    const [optimizeQuestion, setOptimizeQuestion] = useState(false);
    const [termIdentity, setTermIdentity] = useState<Partial<ReadWeaveTermIdentity>>({});
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
    const [generationJobId, setGenerationJobId] = useState<string>();
    const [generationJobs, setGenerationJobs] = useState<ReadWeaveGenerationJob[]>([]);
    const [loadedArticleNoteId, setLoadedArticleNoteId] = useState<string>();
    const [generationProgress, setGenerationProgress] = useState<ReadWeaveGenerationProgress[]>([]);
    const [generationPollRevision, setGenerationPollRevision] = useState(0);
    const [monitorPinned, setMonitorPinned] = useState(false);
    const [regenerationOpen, setRegenerationOpen] = useState(false);
    const [regenerationFeedback, setRegenerationFeedback] = useState("");
    const [busy, setBusy] = useState(false);
    const [bodyEditing, setBodyEditing] = useState(true);
    const [editState, setEditState] = useState<EditState>();
    const [hoverPreview, setHoverPreview] = useState<HoverPreview>();
    const hoverOpenTimer = useRef<number>();
    const hoverCloseTimer = useRef<number>();
    const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const entriesRequestRevision = useRef(0);
    const entriesTarget = useRef<{ noteId: string; anchorId: string }>();
    const activeArticleNoteId = useRef(articleNoteId);
    const currentRefreshRevision = useRef(0);
    const generationJobsRequestRevision = useRef(0);
    const selectionActionRevision = useRef(0);
    const selectionIdentityRevision = useRef(0);
    const activeKind = useRef(kind);
    const activeGenerationJobId = useRef(generationJobId);
    activeArticleNoteId.current = articleNoteId;
    activeKind.current = kind;
    activeGenerationJobId.current = generationJobId;

    const definitionExists = kind === "term" && entries.some(entry => entry.kind === "term");
    const currentJob = generationJobs.find(job => job.jobId === generationJobId);
    const currentTitle = kind === "question"
        ? questionTitle.trim()
        : formatPartialTermIdentity(termIdentity) || selection?.excerpt.trim() || "";
    const currentSourceExcerpt = selection
        ? resolveSourceExcerpt(selection, currentJob)
        : "";
    const saveReady = !!selection && !selection.pending && !definitionExists && !!currentTitle && !!body.trim() && !!currentSourceExcerpt;
    const generationBusy = currentJob?.status === "queued" || currentJob?.status === "running";
    const editorLocked = busy || generationBusy;
    const generationDisabled = isReadWeaveGenerationDisabled({
        busy,
        definitionExists,
        hasSelection: !!selection,
        hasTitle: !!currentTitle,
        jobStatus: currentJob?.status,
        selectionPending: !!selection?.pending
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
            kind
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
            && (!jobId || activeGenerationJobId.current === jobId);
    }

    function upsertGenerationJob(job: ReadWeaveGenerationJob) {
        generationJobsRequestRevision.current += 1;
        setGenerationJobs(current => [ job, ...current.filter(item => item.jobId !== job.jobId) ]
            .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    }

    function hydrateGenerationJob(job: ReadWeaveGenerationJob) {
        setGenerationJobId(job.jobId);
        setGenerationProgress(job.progress);
        setBusy(job.status === "queued" || job.status === "running");
        setRegenerationFeedback(job.feedback ?? "");
        if (!job.result) return;
        setBody(job.result.body);
        setBodyEditing(false);
        if (job.result.optimizedTitle) setQuestionTitle(job.result.optimizedTitle);
        if (job.result.termIdentity) setTermIdentity(current => mergeTermIdentity(job.result!.termIdentity!, current));
        setContextDecision(job.result.context);
        setWorkflow(job.result.workflow);
        setReviewIssues(job.result.reviewIssues ?? []);
    }

    async function refreshGenerationJobs(targetNoteId: string) {
        const revision = ++generationJobsRequestRevision.current;
        const response = await server.get<{ jobs: ReadWeaveGenerationJob[] }>(`readweave/articles/${encodeURIComponent(targetNoteId)}/generation-jobs`);
        if (revision !== generationJobsRequestRevision.current || activeArticleNoteId.current !== targetNoteId) return response.jobs;
        applyGenerationJobStatusDecorations(document.body, response.jobs);
        setGenerationJobs(response.jobs);
        window.requestAnimationFrame(() => applyGenerationJobStatusDecorations(document.body, response.jobs));
        return response.jobs;
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
        setSelection(nextSelection);
        setStatus(undefined);
        setStatusTone("normal");
        setEditState(undefined);
        const draft = readDraft(noteId!, nextSelection.anchorId);
        const nextKind = preferredKind ?? draft?.kind ?? "question";
        const matchingDraft = draft?.kind === nextKind ? draft : undefined;
        const matchingJob = generationJobs.find(job => job.anchorId === nextSelection.anchorId && job.kind === nextKind);
        const confirmingPendingSelection = selection?.pending
            && normalizedAnchorText(selection.excerpt) === normalizedAnchorText(nextSelection.excerpt);
        setKind(nextKind);
        setQuestionTitle(matchingDraft?.questionTitle
            ?? (nextKind === "question"
                ? confirmingPendingSelection && questionTitle.trim() ? questionTitle : matchingJob?.title || defaultQuestionForExcerpt(nextSelection.excerpt)
                : ""));
        setOptimizeQuestion(matchingDraft?.optimizeQuestion ?? (confirmingPendingSelection ? optimizeQuestion : false));
        setTermIdentity(matchingDraft?.termIdentity
            ? cleanPartialTermIdentity(matchingDraft.termIdentity)
            : confirmingPendingSelection ? cleanPartialTermIdentity(termIdentity) : initialTermIdentity(nextSelection.excerpt, nextKind));
        setBody(matchingDraft?.body ?? (confirmingPendingSelection ? body : matchingJob?.result?.body ?? ""));
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
        setReviewIssues(matchingDraft?.reviewIssues ?? matchingJob?.result?.reviewIssues ?? []);
        setRegenerationFeedback(matchingJob?.feedback ?? "");
        setRegenerationOpen(false);
        setMonitorPinned(false);
        setBodyEditing(!(matchingJob?.result?.body || matchingDraft?.generationJobId));
        setBusy(matchingJob?.status === "queued" || matchingJob?.status === "running");
        if (matchingJob?.status === "complete" && matchingJob.unread) void markJobViewed(matchingJob);
        await refreshEntriesForAnchor(noteId!, nextSelection.anchorId);
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
        setEditState(undefined);
        setKind("question");
        setQuestionTitle("");
        setOptimizeQuestion(false);
        setTermIdentity({});
        setBody("");
        setBodyEditing(true);
        setCalloutType(defaultReadWeaveCallout("question"));
        setReuseObjectId(undefined);
        setCandidates([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setGenerationProgress([]);
        setReviewIssues([]);
        setStatus(undefined);
        setStatusTone("normal");
        setBusy(false);
    }

    const confirmPendingSelection = useAnchorInteractions({
        noteId: articleNoteId,
        noteContext,
        summaries: anchorSummaries,
        generationJobs,
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
                const estimatedHeight = Math.min(420, window.innerHeight - 24);
                const fitsBelow = exclusion.bottom + 10 + estimatedHeight <= window.innerHeight - 12;
                const top = fitsRight || fitsLeft
                    ? Math.max(12, Math.min(rect.top, window.innerHeight - estimatedHeight - 12))
                    : fitsBelow
                        ? exclusion.bottom + 10
                        : Math.max(12, exclusion.top - estimatedHeight - 10);
                setHoverPreview({
                    entries,
                    locked,
                    left,
                    top,
                    width
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
        setEntries([]);
        setEditState(undefined);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setGenerationJobs([]);
        setGenerationProgress([]);
        setReviewIssues([]);
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
        if (!articleNoteId) return;
        const interval = window.setInterval(() => {
            refreshGenerationJobs(articleNoteId).catch(() => undefined);
        }, 2_000);
        return () => window.clearInterval(interval);
    }, [articleNoteId]);

    useEffect(() => {
        if (!selection || selection.pending || generationJobId) return;
        const restored = generationJobs.find(job => job.anchorId === selection.anchorId && job.kind === kind);
        if (!restored) return;
        hydrateGenerationJob(restored);
        if (restored.status === "complete" && restored.unread) void markJobViewed(restored);
    }, [generationJobs, selection?.anchorId, selection?.pending, kind, generationJobId]);

    useEffect(() => {
        if (!noteId || !selection) return;
        const draft: Draft = { kind, questionTitle, optimizeQuestion, termIdentity, body, calloutType, reuseObjectId, contextDecision, generationJobId, reviewIssues };
        sessionStorage.setItem(draftKey(noteId, selection.anchorId), JSON.stringify(draft));
    }, [noteId, selection, kind, questionTitle, optimizeQuestion, termIdentity, body, calloutType, reuseObjectId, contextDecision, generationJobId, reviewIssues]);

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
                if (!isSelectionIdentityCurrent(target, polledJobId)) return;
                try {
                    const response = await server.getWithSilentNotFound<{ job: ReadWeaveGenerationJob | null; events: ReadWeaveGenerationProgress[]; nextSequence: number }>(`readweave/generation-jobs/${encodeURIComponent(polledJobId)}/events?after=${cursor}`);
                    if (cancelled || !isSelectionIdentityCurrent(target, polledJobId)) return;
                    const job = response.job;
                    if (!job) return;
                    cursor = response.nextSequence;
                    accumulated = [ ...accumulated, ...response.events ].filter((event, index, all) =>
                        all.findIndex(candidate => candidate.sequence === event.sequence) === index
                    ).slice(-200);
                    setGenerationProgress(accumulated);
                    upsertGenerationJob({ ...job, progress: accumulated });
                    if (job.status === "running" || job.status === "queued") {
                        await delay(600);
                        continue;
                    }
                    if (job.status === "failed" || !job.result) {
                        setBusy(false);
                        return;
                    }
                    hydrateGenerationJob({ ...job, progress: accumulated });
                    if (job.unread) await markJobViewed(job);
                    if (isSelectionIdentityCurrent(target, polledJobId)) setBusy(false);
                    return;
                } catch (error) {
                    if (cancelled || !isSelectionIdentityCurrent(target, polledJobId)) return;
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
        if (currentJob) {
            await regenerateDraft();
            return;
        }
        const target = captureSelectionAction(true, true);
        if (!target) return;
        setBusy(true);
        setStatus(undefined);
        setStatusTone("normal");
        setGenerationProgress([]);
        setReuseObjectId(undefined);
        setReviewIssues([]);
        try {
            await persistReadWeaveAnchor(noteContext);
            const response = await server.post<{ job: ReadWeaveGenerationJob }>("readweave/generation-jobs", {
                articleId: noteId,
                anchorId: selection.anchorId,
                anchorType: selection.anchorType,
                kind,
                title: currentTitle,
                optimizeQuestion: kind === "question" ? optimizeQuestion : undefined,
                termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined,
                fragments: selection.fragments
            });
            if (activeArticleNoteId.current === target.noteId) upsertGenerationJob(response.job);
            if (!isSelectionActionCurrent(target)) return;
            setGenerationProgress(response.job.progress);
            setGenerationJobId(response.job.jobId);
            setGenerationPollRevision(current => current + 1);
            setMonitorPinned(false);
            setRegenerationOpen(false);
        } catch (error) {
            if (!isSelectionActionCurrent(target)) return;
            setStatus(readableError(error, t("readweave.generate_failed_no_fallback")));
            setStatusTone("error");
            setBusy(false);
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
            await persistReadWeaveAnchor(noteContext);
            await server.post("readweave/entries", {
                articleId: noteId,
                anchorId: selection.anchorId,
                anchorType: selection.anchorType,
                kind,
                title: currentTitle,
                body,
                sourceExcerpt: currentSourceExcerpt,
                calloutType,
                termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined,
                reuseObjectId
            });
            if (completedJobId) {
                if (isSelectionActionCurrent(target)) setGenerationJobId(undefined);
                await delay(0);
                await server.remove(`readweave/generation-jobs/${encodeURIComponent(completedJobId)}`).catch(() => undefined);
                generationJobsRequestRevision.current += 1;
                if (activeArticleNoteId.current === target.noteId) {
                    setGenerationJobs(current => current.filter(job => job.jobId !== completedJobId));
                }
            }
            sessionStorage.removeItem(draftKey(target.noteId, target.anchorId));
            if (isSelectionActionCurrent(target)) resetEditor(target.kind);
            if (activeArticleNoteId.current === target.noteId) await refreshCurrent(target.noteId, target.anchorId);
            if (isSelectionActionCurrent(target)) setStatus(t("readweave.saved"));
        } catch (error) {
            if (isSelectionActionCurrent(target)) setStatus(readableError(error, t("readweave.save_failed")));
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
            if (removeAnchor) await removeProvisionalAnchor(noteContext, selection.anchorId);
            sessionStorage.removeItem(draftKey(target.noteId, target.anchorId));
            generationJobsRequestRevision.current += 1;
            if (activeArticleNoteId.current === target.noteId) {
                setGenerationJobs(current => current.filter(job => job.jobId !== discardedJobId));
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
        const regeneratedJobId = generationJobId;
        const target = captureSelectionAction(true, true);
        if (!target) return;
        setBusy(true);
        setStatus(undefined);
        setStatusTone("normal");
        setGenerationProgress([]);
        try {
            const response = await server.post<{ job: ReadWeaveGenerationJob }>(`readweave/generation-jobs/${encodeURIComponent(regeneratedJobId)}/regenerate`, {
                feedback: regenerationFeedback.trim() || undefined
            });
            if (activeArticleNoteId.current === target.noteId) upsertGenerationJob(response.job);
            if (!isSelectionActionCurrent(target, regeneratedJobId)) return;
            hydrateGenerationJob(response.job);
            setGenerationPollRevision(current => current + 1);
            setRegenerationOpen(false);
            setMonitorPinned(true);
        } catch (error) {
            if (!isSelectionActionCurrent(target, regeneratedJobId)) return;
            setStatus(readableError(error, t("readweave.regenerate_failed")));
            setStatusTone("error");
            setBusy(false);
        }
    }

    function resetEditor(currentKind: ReadWeaveObjectKind) {
        setQuestionTitle(currentKind === "question" && selection && !selection.pending
            ? defaultQuestionForExcerpt(selection.excerpt)
            : "");
        setTermIdentity(initialTermIdentity(selection?.excerpt ?? "", currentKind));
        setBody("");
        setBodyEditing(true);
        setReuseObjectId(undefined);
        setCandidates([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setGenerationProgress([]);
        setReviewIssues([]);
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
        setKind(object.kind);
        if (object.kind === "question") setQuestionTitle(object.title);
        else setTermIdentity(object.termIdentity ?? { chineseName: object.title });
        setBody(object.body);
        setBodyEditing(false);
        setCalloutType(object.calloutType);
        setReuseObjectId(object.objectId);
        setReviewIssues([]);
        setStatus(t("readweave.reuse_selected"));
        setStatusTone("normal");
    }

    function changeKind(nextKind: ReadWeaveObjectKind) {
        if (nextKind === kind) return;
        selectionActionRevision.current += 1;
        selectionIdentityRevision.current += 1;
        const nextCallout = calloutAfterKindChange(calloutType, nextKind);
        setKind(nextKind);
        resetEditor(nextKind);
        setCalloutType(nextCallout);
        setStatus(undefined);
        setStatusTone("normal");
        const matchingJob = selection && generationJobs.find(job => job.anchorId === selection.anchorId && job.kind === nextKind);
        if (matchingJob) hydrateGenerationJob(matchingJob);
    }

    function chooseKind(nextKind: ReadWeaveObjectKind) {
        if (selection?.pending && confirmPendingSelection(nextKind)) return;
        changeKind(nextKind);
    }

    function changeDraft() {
        selectionActionRevision.current += 1;
        setBody("");
        setBodyEditing(true);
        setReuseObjectId(undefined);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setCandidates([]);
        setReviewIssues([]);
        setStatus(undefined);
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
            setEditState({
                entry,
                impact: response.impact,
                title: entry.title,
                body: entry.body,
                calloutType: entry.calloutType,
                termIdentity: entry.termIdentity ?? { chineseName: entry.title }
            });
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
            const editTitle = editState.entry.kind === "term"
                ? formatPartialTermIdentity(editState.termIdentity) || editState.entry.canonicalTitle
                : editState.title;
            await server.patch(`readweave/links/${encodeURIComponent(editState.entry.linkId)}`, {
                mode: editState.mode,
                title: editTitle,
                body: editState.body,
                calloutType: editState.calloutType,
                termIdentity: editState.entry.kind === "term" ? cleanPartialTermIdentity(editState.termIdentity) : undefined
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
                            {entries.map(entry => <SavedEntry entry={entry} busy={busy} onEdit={() => beginEdit(entry)} key={entry.linkId} />)}
                        </section>

                        {editState && (
                            <section class="readweave-editor readweave-impact">
                                <div class="readweave-section-title">{t("readweave.impact_first")}</div>
                                <p>{t("readweave.impact_summary", { links: editState.impact.linkCount, articles: editState.impact.articleCount })}</p>
                                {editState.impact.articles.length > 0 && <ul>{editState.impact.articles.map(article => <li key={article.articleId}>{article.title}</li>)}</ul>}
                                {editState.entry.kind === "term" ? (
                                    <TermFields value={editState.termIdentity} disabled={busy} onChange={value => setEditState({ ...editState, termIdentity: value })} />
                                ) : (
                                    <label>{t("readweave.title_label")}<input value={editState.title} onInput={event => setEditState({ ...editState, title: event.currentTarget.value })} /></label>
                                )}
                                <label>{t(editState.entry.kind === "question" ? "readweave.answer_label" : "readweave.definition_label")}<textarea rows={7} value={editState.body} onInput={event => setEditState({ ...editState, body: event.currentTarget.value })} /></label>
                                <CalloutSelector value={editState.calloutType} onChange={value => setEditState({ ...editState, calloutType: value })} />
                                <div class="readweave-edit-modes">
                                    {(["global", "article-variant", "display-only"] as ReadWeaveEditMode[]).map(mode => (
                                        <label key={mode}>
                                            <input type="radio" name="readweave-edit-mode" checked={editState.mode === mode} onChange={() => setEditState({ ...editState, mode })} />
                                            {t(`readweave.mode_${mode.replaceAll("-", "_")}`)}
                                        </label>
                                    ))}
                                </div>
                                <div class="readweave-actions">
                                    <button type="button" class="btn btn-primary" disabled={!editState.mode || busy} onClick={applyEdit}>{t("readweave.apply")}</button>
                                    <button type="button" class="btn btn-secondary" onClick={() => setEditState(undefined)}>{t("common.cancel")}</button>
                                </div>
                            </section>
                        )}

                        <section class="readweave-editor">
                            <div class="readweave-kind" role="group" aria-label={t("readweave.kind_label")}>
                                <button type="button" class={kind === "question" ? "active" : ""} disabled={editorLocked} onClick={() => chooseKind("question")}>{t("readweave.question")}</button>
                                <button type="button" class={kind === "term" ? "active" : ""} disabled={editorLocked} onClick={() => chooseKind("term")}>{t("readweave.term")}</button>
                            </div>
                            {selection.pending && <p class="readweave-hint">{t("readweave.selection_pending_hint")}</p>}
                            {kind === "question" ? (
                                <>
                                    <label>{t("readweave.question_label")}
                                        <textarea
                                            rows={3}
                                            value={questionTitle}
                                            disabled={editorLocked}
                                            onFocus={() => { if (selection.pending) confirmPendingSelection("question"); }}
                                            onInput={event => { setQuestionTitle(event.currentTarget.value); changeDraft(); }}
                                            data-testid="readweave-question"
                                        />
                                    </label>
                                    <label class="readweave-question-optimization">
                                        <input type="checkbox" checked={optimizeQuestion} disabled={editorLocked} onChange={event => setOptimizeQuestion(event.currentTarget.checked)} data-testid="readweave-optimize-question" />
                                        <span><strong>{t("readweave.optimize_question")}</strong><small>{t("readweave.optimize_question_hint")}</small></span>
                                    </label>
                                </>
                            ) : (
                                <>
                                    <TermFields value={termIdentity} disabled={editorLocked} onChange={value => { setTermIdentity(value); changeDraft(); }} />
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
                                                <span class="readweave-candidate-similarity">{t("readweave.title_similarity", { percent: Math.round(candidate.confidence * 100) })}</span>
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
                            <CalloutSelector value={calloutType} onChange={setCalloutType} />
                            <button
                                type="button"
                                class="btn btn-secondary"
                                disabled={generationDisabled}
                                aria-busy={generationBusy}
                                onClick={generate}
                                data-testid="readweave-generate"
                            >
                                {generationBusy && <i class="bx bx-loader-alt bx-spin" aria-hidden="true" />}
                                {generationBusy ? t("readweave.generating") : t(kind === "question" ? "readweave.generate_answer" : "readweave.generate_definition")}
                            </button>
                            <div class="readweave-body-heading">
                                <label for="readweave-draft-body">{t(kind === "question" ? "readweave.answer_label" : "readweave.definition_label")}</label>
                                {!!body.trim() && (
                                    <button
                                        type="button"
                                        class="btn btn-sm btn-link readweave-body-edit"
                                        aria-pressed={bodyEditing}
                                        onClick={toggleBodyEditing}
                                        data-testid="readweave-edit-body"
                                    >
                                        <i class={bodyEditing ? "bx bx-check" : "bx bx-edit-alt"} aria-hidden="true" />
                                        {t(bodyEditing ? "readweave.finish_editing" : kind === "question" ? "readweave.edit_answer" : "readweave.edit_definition")}
                                    </button>
                                )}
                            </div>
                            <textarea
                                id="readweave-draft-body"
                                ref={bodyTextareaRef}
                                rows={9}
                                value={body}
                                disabled={editorLocked}
                                readOnly={!bodyEditing}
                                class={bodyEditing ? "readweave-body-editing" : "readweave-body-readonly"}
                                onInput={event => setBody(event.currentTarget.value)}
                                data-testid="readweave-answer"
                            />
                            {reuseObjectId && <p class="readweave-status">{t("readweave.reusing_object")}</p>}
                            {contextDecision && <p class="readweave-status">{t("readweave.context_used", { count: contextDecision.characterCount, budget: contextDecision.characterBudget, expansions: contextDecision.expansionLevel })}</p>}
                            {workflow && <p class="readweave-status">{t("readweave.workflow_used", { generations: workflow.generationAttempts, checks: workflow.validationPasses })}</p>}
                            {currentJob && (
                                <GenerationMonitor
                                    job={{ ...currentJob, progress: generationProgress }}
                                    pinned={monitorPinned}
                                    onTogglePinned={() => setMonitorPinned(current => !current)}
                                />
                            )}
                            <button type="button" class="btn btn-primary" disabled={busy || !saveReady} onClick={save} data-testid="readweave-save">{t("readweave.review_and_save")}</button>
                            {currentJob && (
                                <div class="readweave-review-actions">
                                    <button type="button" class="btn btn-secondary" disabled={busy && !generationBusy} onClick={discardDraft}>{t("readweave.discard_draft")}</button>
                                    <button type="button" class="btn btn-secondary" disabled={editorLocked} aria-expanded={regenerationOpen} onClick={() => setRegenerationOpen(current => !current)}>{t("readweave.regenerate")}</button>
                                </div>
                            )}
                            <div class={`readweave-regeneration ${regenerationOpen ? "open" : ""}`} aria-hidden={!regenerationOpen}>
                                <label>{t("readweave.regeneration_feedback")}
                                    <textarea rows={4} value={regenerationFeedback} onInput={event => setRegenerationFeedback(event.currentTarget.value)} placeholder={t("readweave.regeneration_feedback_hint")} />
                                </label>
                                <button type="button" class="btn btn-secondary" disabled={editorLocked} onClick={regenerateDraft}>{t("readweave.regenerate_with_feedback")}</button>
                            </div>
                        </section>
                    </>
                )}
                {status && <p class={`readweave-status ${statusTone === "error" ? "readweave-status-error" : statusTone === "warning" ? "readweave-status-warning" : ""}`} role={statusTone === "error" ? "alert" : "status"}>{status}</p>}
                <button type="button" class="btn btn-sm btn-link readweave-export" onClick={exportArticle} disabled={!noteId}>{t("readweave.export_article")}</button>
            </div>

            {hoverPreview && (
                <aside
                    class="readweave-hover-preview"
                    style={{ left: `${hoverPreview.left}px`, top: `${hoverPreview.top}px`, width: `${hoverPreview.width}px` }}
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
    const latest = job.progress.at(-1);
    const state = job.status === "complete" ? "complete" : job.status === "failed" ? "failed" : "running";
    const elapsed = latest?.elapsedMs ?? Math.max(0, Date.now() - Date.parse(job.createdAt));
    const errorProgress = job.progress.findLast(progress => progress.stage === "failed") ?? latest;
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
                <span>{latest?.message ?? t("readweave.generation_queued")}</span>
                <time>{formatElapsed(elapsed)}</time>
                <i class="bx bx-chevron-down" aria-hidden="true" />
            </button>
            <div class="readweave-generation-detail">
                <ol class="readweave-generation-log" aria-label={t("readweave.generation_progress")}>
                    {job.progress.map(progress => {
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
                                    <span>{progress.message}</span>
                                    {Array.from(groupedIssues).map(([ category, eventIssues ]) => (
                                        <section class="readweave-issue-group" key={category}>
                                            <strong>{categoryLabels[category] ?? categoryLabels.other}</strong>
                                            <ul>{eventIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
                                        </section>
                                    ))}
                                    {showJobError && <p class="readweave-monitor-error" role="alert">{job.error}</p>}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </div>
        </section>
    );
}

function HoverEntry({ entry }: { entry: ReadWeaveResolvedEntry }) {
    return (
        <article class={`${entry.kind === "question" ? "readweave-hover-question" : "readweave-hover-term"} readweave-callout-${entry.calloutType}`} tabindex={0}>
            <div class="readweave-hover-title"><i class={CALLOUT_ICONS[entry.calloutType]} /><span>{entry.title}</span>{entry.kind === "question" && <i class="bx bx-chevron-down readweave-hover-chevron" />}</div>
            <p class={entry.kind === "question" ? "readweave-hover-answer" : "readweave-hover-definition"}>{entry.body}</p>
        </article>
    );
}

function SavedEntry({ entry, busy, onEdit }: { entry: ReadWeaveResolvedEntry; busy: boolean; onEdit: () => void }) {
    return (
        <article class={`readweave-entry readweave-callout-${entry.calloutType}`} tabindex={0}>
            <div class="readweave-entry-title">
                <span><i class={CALLOUT_ICONS[entry.calloutType]} />{entry.title}</span>
                {entry.isDisplayOverride && <span class="readweave-badge">{t("readweave.local_display")}</span>}
            </div>
            <div class="readweave-entry-detail">
                <p>{entry.body}</p>
                <button type="button" class="btn btn-sm btn-secondary" onClick={onEdit} disabled={busy}>{t("readweave.edit")}</button>
            </div>
        </article>
    );
}

function CalloutSelector({ value, onChange }: { value: ReadWeaveCalloutType; onChange: (value: ReadWeaveCalloutType) => void }) {
    return (
        <div class="readweave-callout-selector" role="group" aria-label={t("readweave.visual_type")}>
            {CALLOUT_TYPES.map(type => (
                <button type="button" class={`readweave-callout-choice readweave-callout-${type} ${value === type ? "active" : ""}`} title={t(`readweave.callout_${type}`)} aria-label={t(`readweave.callout_${type}`)} aria-pressed={value === type} onClick={() => onChange(type)} key={type}>
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
    const lockedAnchorRef = useRef<string>();
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
            root.querySelectorAll(".readweave-anchor-locked").forEach(element => element.classList.remove("readweave-anchor-locked"));
            lockedAnchorRef.current = undefined;
        }

        function setLockedAnchor(root: HTMLElement, anchorId: string) {
            clearLockedAnchor(root);
            matchingAnchorElements(root, anchorId).forEach(element => element.classList.add("readweave-anchor-locked"));
            lockedAnchorRef.current = anchorId;
        }

        function onAnchorMouseOver(event: MouseEvent) {
            const root = editorRoot;
            if (!root || !(event.target instanceof Element) || !root.contains(event.target)) return;
            const exactAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            if (!exactAnchor || !root.contains(exactAnchor)) return;
            const block = exactAnchor.closest<HTMLElement>(BLOCK_SELECTOR);
            if (!block || !root.contains(block) || !block.dataset.readweaveParagraphAnchorIds) return;
            const exactAnchorId = preferredAnchorIdOf(exactAnchor, optionsRef.current.summaries, optionsRef.current.generationJobs);
            if (!exactAnchorId || suppressedAnchorRef.current === exactAnchorId || lockedAnchorRef.current) return;
            const relatedAnchorId = event.relatedTarget instanceof Element
                ? preferredAnchorIdOf(event.relatedTarget.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR), optionsRef.current.summaries, optionsRef.current.generationJobs)
                : undefined;
            const exactSummary = exactAnchorId ? summaryForElement(optionsRef.current.summaries, exactAnchorId, exactAnchor) : undefined;
            const exactTerms = exactSummary?.entries.filter(entry => entry.kind === "term") ?? [];
            const exactQuestions = exactSummary?.entries.filter(entry => entry.kind === "question") ?? [];
            if (exactAnchorId === relatedAnchorId) return;

            clearHoveredAnchors(root);
            if (!exactTerms.length && !exactQuestions.length) {
                optionsRef.current.onHoverLeave();
                return;
            }

            block.classList.add("readweave-paragraph-anchor-hover");
            setHoveredAnchor(root, exactAnchorId, true);
            optionsRef.current.onHover(exactSummary!.entries, exactAnchor.getBoundingClientRect(), false, block.getBoundingClientRect());
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
            if (lockedAnchorRef.current === exactAnchorId) return;
            clearHoveredAnchors(root);
            optionsRef.current.onHoverLeave();
        }

        function decorateAnchors(root: HTMLElement) {
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
            if (lockedAnchorRef.current) {
                matchingAnchorElements(root, lockedAnchorRef.current).forEach(element => {
                    element.classList.add("readweave-anchor-locked");
                    element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                });
            }
        }

        async function editorAndRoot() {
            const currentContext = optionsRef.current.noteContext;
            const editor: CKTextEditor | null = currentContext
                ? await currentContext.getTextEditor().catch(() => null)
                : null;
            const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
            return { editor, root };
        }

        async function selectExisting(root: HTMLElement, domAnchorId: string, block: HTMLElement, anchorType: ReadWeaveAnchorType, preferredKind?: ReadWeaveObjectKind) {
            setActiveAnchor(root, domAnchorId);
            const elements = matchingAnchorElements(root, domAnchorId);
            const summary = elements.map(element => summaryForElement(optionsRef.current.summaries, domAnchorId, element)).find(Boolean);
            const anchorId = summary?.anchorId ?? domAnchorId;
            const summaryExcerpt = summary?.excerpt;
            const jobExcerpt = optionsRef.current.generationJobs.find(job => job.anchorId === anchorId)?.sourceExcerpt;
            const renderedExcerpt = anchorType === "range" ? textOfAnchorElements(elements) : textOf(block);
            const excerpt = summaryExcerpt || jobExcerpt || renderedExcerpt || "";
            await optionsRef.current.onSelect({
                anchorId,
                anchorType,
                excerpt,
                fragments: collectFragments(root, block, excerpt)
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
            const root = common?.closest<HTMLElement>('[contenteditable="true"][role="textbox"]');
            if (!root || !excerpt) {
                removeBubble();
                return;
            }
            if (actionBubble && actionRange && rangesEqual(actionRange, nativeRange)) {
                positionBubble();
                return;
            }
            const { editor, root: actualRoot } = await editorAndRoot();
            if (disposed || revision !== selectionRevision || !editor || !actualRoot || actualRoot !== root) return;
            const viewRange = editor.editing.view.domConverter.domRangeToView(nativeRange);
            if (!viewRange) {
                removeBubble();
                optionsRef.current.onStatus(t("readweave.selection_sync_failed"));
                return;
            }
            const modelRange = editor.editing.mapper.toModelRange(viewRange);
            const block = common?.closest<HTMLElement>(BLOCK_SELECTOR);
            if (!modelRange || modelRange.isCollapsed || !excerpt || !block || !root.contains(block)) return;
            const interactionEditor = editor;
            const interactionRoot = root;
            const interactionBlock = block;
            const interactionModelRange = modelRange;
            const fragments = collectFragments(interactionRoot, interactionBlock, excerpt);
            pendingSelectionActionsRef.current = {};

            optionsRef.current.onSelectionPreview({
                anchorId: "rw_selection_preview",
                anchorType: "range",
                excerpt,
                fragments,
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
                        interactionEditor.model.change(writer => updateReadWeaveAnchorIdOnRange(writer, interactionModelRange, anchorId!, "add"));
                    }
                    removeBubble();
                    window.getSelection()?.removeAllRanges();
                    const finalizedSelection: AnchorSelection = {
                        anchorId: anchorId!,
                        anchorType: "range",
                        excerpt,
                        fragments
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
            const nativeSelection = window.getSelection();
            if (nativeSelection && !nativeSelection.isCollapsed && nativeSelection.rangeCount) {
                const common = nativeSelection.getRangeAt(0).commonAncestorContainer;
                const commonElement = common instanceof Element ? common : common.parentElement;
                const selectionRoot = commonElement?.closest('[contenteditable="true"][role="textbox"]');
                const clickRoot = event.target.closest('[contenteditable="true"][role="textbox"]');
                // A selection may survive navigation and restoration. Clicking a
                // precise ReadWeave fragment must still open/lock that fragment;
                // only plain editor clicks should remain reserved for selection.
                if (selectionRoot && selectionRoot === clickRoot && !event.target.closest(RANGE_ANCHOR_SELECTOR)) return;
            }
            removeBubble();
            const located = findEditableBlock(event.target);
            if (!located) return;
            const { editor, root } = await editorAndRoot();
            if (!editor || !root || root !== located.root) return;

            const rangeAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            const rangeAnchorId = preferredAnchorIdOf(rangeAnchor, optionsRef.current.summaries, optionsRef.current.generationJobs);
            if (rangeAnchorId && rangeAnchor) {
                if (lockedAnchorRef.current === rangeAnchorId) {
                    clearLockedAnchor(root);
                    clearHoveredAnchors(root);
                    suppressedAnchorRef.current = rangeAnchorId;
                    optionsRef.current.onHoverClear();
                    return;
                }
                const summary = summaryForElement(optionsRef.current.summaries, rangeAnchorId, rangeAnchor);
                if (summary?.entries.length) {
                    suppressedAnchorRef.current = undefined;
                    clearHoveredAnchors(root);
                    located.block.classList.add("readweave-paragraph-anchor-hover");
                    setHoveredAnchor(root, rangeAnchorId, true);
                    setLockedAnchor(root, rangeAnchorId);
                    optionsRef.current.onHover(summary.entries, rangeAnchor.getBoundingClientRect(), true, located.block.getBoundingClientRect());
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
            const { editor, root } = await editorAndRoot();
            if (disposed) return;
            if (!editor || !root) {
                if (attempt < 100) editorAttachTimer = window.setTimeout(() => attachEditorWhenReady(attempt + 1), 80);
                return;
            }
            editorRoot = root;
            root.addEventListener("mouseover", onAnchorMouseOver);
            root.addEventListener("mouseout", onAnchorMouseOut);
            normalizeRangeAnchorWhitespace(editor, root);
            reconcileOrphanedRangeAnchors(
                editor,
                root,
                optionsRef.current.summaries,
                optionsRef.current.generationJobs,
                optionsRef.current.activeAnchorId,
                optionsRef.current.dataReady
            );
            decorateAnchors(root);
            observer = new MutationObserver(() => {
                normalizeRangeAnchorWhitespace(editor, root);
                decorateAnchors(root);
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
            editorRoot?.querySelectorAll(".readweave-anchor-active,.readweave-paragraph-selected,.readweave-anchor-hover,.readweave-anchor-locked,.readweave-paragraph-anchor-hover").forEach(element => element.classList.remove("readweave-anchor-active", "readweave-paragraph-selected", "readweave-anchor-hover", "readweave-anchor-locked", "readweave-paragraph-anchor-hover"));
            lockedAnchorRef.current = undefined;
            hoveredAnchorRef.current = undefined;
            suppressedAnchorRef.current = undefined;
            document.removeEventListener("mouseup", onMouseUp, true);
            document.removeEventListener("selectionchange", onSelectionChange, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("scroll", positionBubble, true);
            window.removeEventListener("resize", positionBubble);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [options.noteId, options.noteContext]);

    useEffect(() => {
        let cancelled = false;
        if (!options.noteContext) return;
        options.noteContext.getTextEditor().then(editor => {
            if (cancelled) return;
            const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
            if (root && editor) {
                const latest = optionsRef.current;
                reconcileOrphanedRangeAnchors(
                    editor,
                    root,
                    latest.summaries,
                    latest.generationJobs,
                    latest.activeAnchorId,
                    latest.dataReady
                );
                applyAnchorSummaryDecorations(root, latest.summaries, latest.generationJobs);
                if (hoveredAnchorRef.current) {
                    matchingAnchorElements(root, hoveredAnchorRef.current).forEach(element => {
                        element.classList.add("readweave-anchor-hover");
                        element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                    });
                }
                if (lockedAnchorRef.current) {
                    matchingAnchorElements(root, lockedAnchorRef.current).forEach(element => {
                        element.classList.add("readweave-anchor-locked");
                        element.closest<HTMLElement>(BLOCK_SELECTOR)?.classList.add("readweave-paragraph-anchor-hover");
                    });
                }
            }
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [options.noteId, options.noteContext, options.summaries, options.generationJobs, options.dataReady, options.activeAnchorId]);

    return (preferredKind: ReadWeaveObjectKind): boolean => {
        const action = pendingSelectionActionsRef.current[preferredKind];
        if (!action) return false;
        action();
        return true;
    };
}

function normalizedAnchorText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function defaultQuestionForExcerpt(excerpt: string): string {
    const normalized = normalizedAnchorText(excerpt);
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

function summaryForAnchorGroup(summaries: ReadWeaveAnchorSummary[], anchorId: string, elements: HTMLElement[]): ReadWeaveAnchorSummary | undefined {
    const anchorType: ReadWeaveAnchorType = elements.some(element => element.matches(RANGE_ANCHOR_SELECTOR)) ? "range" : "paragraph";
    return summaryForRenderedText(summaries, anchorId, elements.map(element => element.textContent ?? "").join(""), anchorType);
}

function generationStatusClass(job: ReadWeaveGenerationJob): string | undefined {
    if (job.status === "failed") return "readweave-anchor-status-error";
    if (job.status === "queued" || job.status === "running") return "readweave-anchor-status-running";
    if (job.status === "complete" && job.unread) return "readweave-anchor-status-unread";
    return undefined;
}

const GENERATION_STATUS_CLASSES = [
    "readweave-anchor-status-running",
    "readweave-anchor-status-unread",
    "readweave-anchor-status-error"
];

function applyGenerationJobStatus(element: HTMLElement, job: ReadWeaveGenerationJob) {
    const renderedVersion = element.dataset.readweaveJobUpdatedAt;
    if (renderedVersion && renderedVersion > job.updatedAt) return;
    element.classList.remove("readweave-anchor-status", ...GENERATION_STATUS_CLASSES);
    const statusClass = generationStatusClass(job);
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
            element.classList.remove("readweave-anchor-status", ...GENERATION_STATUS_CLASSES);
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
        if (job) elements.forEach(element => element.classList.add("readweave-anchor-draft"));
        if ((summary?.questionCount ?? 0) > 0) elements.forEach(element => element.classList.add("readweave-anchor-has-question"));
        if ((summary?.termCount ?? 0) > 0) {
            elements.forEach(element => element.classList.add("readweave-anchor-has-term"));
            if (termType) elements.forEach(element => element.classList.add("readweave-term-anchor", `readweave-term-callout-${termType}`));
        }
        if (job) {
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

function calloutTypeForKind(summary: ReadWeaveAnchorSummary | undefined, kind: ReadWeaveObjectKind): ReadWeaveCalloutType | undefined {
    return summary?.entries.find(entry => entry.kind === kind)?.calloutType;
}

function findEditableBlock(target: EventTarget | null): { root: HTMLElement; block: HTMLElement } | null {
    if (!(target instanceof Element)) return null;
    const root = target.closest<HTMLElement>('[contenteditable="true"][role="textbox"]');
    if (!root) return null;
    const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
    return block && root.contains(block) ? { root, block } : null;
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

function reconcileOrphanedRangeAnchors(
    editor: CKTextEditor,
    root: HTMLElement,
    summaries: ReadWeaveAnchorSummary[],
    generationJobs: ReadWeaveGenerationJob[],
    activeAnchorId: string | undefined,
    dataReady: boolean
) {
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
        const exact = exactReadWeaveExcerptRange(elements, BLOCK_SELECTOR, saved);
        if (full && exact) repairs.push({ full, exact, orphanAnchorId: anchorId, summary });
    }
    if (!repairs.length && !staleRanges.length) return;
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
    if (!modelRepairs.length && !staleModelRanges.length) return;
    editor.model.change(writer => {
        for (const stale of staleModelRanges) {
            updateReadWeaveAnchorIdOnRange(writer, stale.fullModelRange, stale.anchorId, "remove");
        }
        for (const repair of modelRepairs) {
            updateReadWeaveAnchorIdOnRange(writer, repair.fullModelRange, repair.orphanAnchorId, "remove");
            updateReadWeaveAnchorIdOnRange(writer, repair.exactModelRange, repair.anchorId, "add");
        }
    });
}

function rangeStrictlyIntersectsElement(range: Range, element: Element): boolean {
    const elementRange = document.createRange();
    elementRange.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.START_TO_END, elementRange) > 0
        && range.compareBoundaryPoints(Range.END_TO_START, elementRange) < 0;
}

function textOf(element: Element | null | undefined, maxLength = 10_000): string {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function textOfAnchorElements(elements: HTMLElement[], maxLength = 10_000): string {
    return elements.map(element => element.textContent ?? "").join("").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function resolveSourceExcerpt(selection: AnchorSelection, job: ReadWeaveGenerationJob | undefined): string {
    return selection.excerpt.trim()
        || job?.sourceExcerpt.trim()
        || selection.fragments.find(fragment => fragment.role === "selected")?.text.trim()
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

function mergeTermIdentity(generated: Partial<ReadWeaveTermIdentity>, preferred: Partial<ReadWeaveTermIdentity>): Partial<ReadWeaveTermIdentity> {
    const generatedClean = cleanPartialTermIdentity(generated);
    const preferredClean = cleanPartialTermIdentity(preferred);
    return {
        abbreviation: preferredClean.abbreviation || generatedClean.abbreviation,
        chineseName: preferredClean.chineseName || generatedClean.chineseName,
        englishName: preferredClean.englishName || generatedClean.englishName
    };
}

function formatPartialTermIdentity(value: Partial<ReadWeaveTermIdentity>): string {
    const clean = cleanPartialTermIdentity(value);
    const name = clean.englishName && clean.chineseName ? `${clean.chineseName}（${clean.englishName}）` : clean.chineseName || "";
    return [clean.abbreviation, name].filter(Boolean).join(" ");
}

function draftKey(noteId: string, anchorId: string) {
    return `readweave:draft:${noteId}:${anchorId}`;
}

function readDraft(noteId: string, anchorId: string): Draft | undefined {
    const value = sessionStorage.getItem(draftKey(noteId, anchorId));
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

async function persistReadWeaveAnchor(noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"]) {
    const editor = await noteContext?.getTextEditor().catch(() => null);
    const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
    if (!root) return;
    await glob.getComponentByEl(root)?.triggerCommand("saveNoteDetailNow");
}

async function removeProvisionalAnchor(noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"], anchorId: string) {
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
    if (!ranges.length) return;
    editor.model.change(writer => ranges.forEach(range => updateReadWeaveAnchorIdOnRange(writer, range, anchorId, "remove")));
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
