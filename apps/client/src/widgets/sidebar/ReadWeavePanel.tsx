import "./ReadWeavePanel.css";

import type { CKTextEditor } from "@triliumnext/ckeditor5";
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
import RightPanelWidget from "./RightPanelWidget.js";

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre";
const RANGE_ANCHOR_SELECTOR = "[data-readweave-range-anchor-id]";
const PARAGRAPH_ANCHOR_SELECTOR = "[data-readweave-anchor-id]";
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
    summary: ReadWeaveAnchorSummary;
    left: number;
    top: number;
}

export default function ReadWeavePanel() {
    const { noteId, noteContext } = useActiveNoteContext();
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
    const [statusTone, setStatusTone] = useState<"normal" | "error">("normal");
    const [generationJobId, setGenerationJobId] = useState<string>();
    const [generationProgress, setGenerationProgress] = useState<ReadWeaveGenerationProgress[]>([]);
    const [busy, setBusy] = useState(false);
    const [editState, setEditState] = useState<EditState>();
    const [hoverPreview, setHoverPreview] = useState<HoverPreview>();
    const hoverOpenTimer = useRef<number>();
    const hoverCloseTimer = useRef<number>();

    const currentTitle = kind === "question"
        ? questionTitle.trim()
        : formatPartialTermIdentity(termIdentity) || selection?.excerpt.trim() || "";
    const saveReady = !!selection && !!currentTitle && !!body.trim();

    async function refreshCurrent(targetNoteId: string, anchorId?: string) {
        const summaryResponse = await server.get<{ anchors: ReadWeaveAnchorSummary[] }>(`readweave/articles/${encodeURIComponent(targetNoteId)}/anchors`);
        setAnchorSummaries(summaryResponse.anchors);
        if (anchorId) await refreshEntries(targetNoteId, anchorId, setEntries);
    }

    async function selectAnchor(nextSelection: AnchorSelection, preferredKind?: ReadWeaveObjectKind) {
        setSelection(nextSelection);
        setStatus(undefined);
        setStatusTone("normal");
        setEditState(undefined);
        const draft = readDraft(noteId!, nextSelection.anchorId);
        const nextKind = preferredKind ?? draft?.kind ?? "question";
        const matchingDraft = draft?.kind === nextKind ? draft : undefined;
        setKind(nextKind);
        setQuestionTitle(matchingDraft?.questionTitle ?? "");
        setOptimizeQuestion(matchingDraft?.optimizeQuestion ?? false);
        setTermIdentity(matchingDraft?.termIdentity ?? initialTermIdentity(nextSelection.excerpt, nextKind));
        setBody(matchingDraft?.body ?? "");
        setCalloutType(matchingDraft?.calloutType ?? defaultCallout(nextKind));
        setReuseObjectId(matchingDraft?.reuseObjectId);
        setContextDecision(matchingDraft?.contextDecision);
        setWorkflow(undefined);
        setGenerationProgress([]);
        setGenerationJobId(matchingDraft?.generationJobId);
        if (matchingDraft?.generationJobId) {
            setBusy(true);
            setStatus(t("readweave.generation_resuming"));
        }
        await refreshEntries(noteId!, nextSelection.anchorId, setEntries);
    }

    useAnchorInteractions({
        noteId,
        noteContext,
        summaries: anchorSummaries,
        onSelect: selectAnchor,
        onStatus: setStatus,
        onHover(summary, rect) {
            window.clearTimeout(hoverCloseTimer.current);
            window.clearTimeout(hoverOpenTimer.current);
            hoverOpenTimer.current = window.setTimeout(() => {
                setHoverPreview({
                    summary,
                    left: Math.max(12, Math.min(rect.right + 8, window.innerWidth - 380)),
                    top: Math.max(12, Math.min(rect.top, window.innerHeight - 420))
                });
            }, 40);
        },
        onHoverLeave: scheduleHoverClose
    });

    function scheduleHoverClose() {
        window.clearTimeout(hoverOpenTimer.current);
        window.clearTimeout(hoverCloseTimer.current);
        hoverCloseTimer.current = window.setTimeout(() => {
            setHoverPreview(undefined);
        }, 120);
    }

    useEffect(() => {
        if (!noteId) return;
        refreshCurrent(noteId).catch(() => setAnchorSummaries([]));
        setSelection(undefined);
        setEntries([]);
        setEditState(undefined);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setGenerationProgress([]);
        setStatusTone("normal");
    }, [noteId]);

    useEffect(() => {
        if (!noteId || !selection) return;
        const draft: Draft = { kind, questionTitle, optimizeQuestion, termIdentity, body, calloutType, reuseObjectId, contextDecision, generationJobId };
        sessionStorage.setItem(draftKey(noteId, selection.anchorId), JSON.stringify(draft));
    }, [noteId, selection, kind, questionTitle, optimizeQuestion, termIdentity, body, calloutType, reuseObjectId, contextDecision, generationJobId]);

    useEffect(() => {
        if (!generationJobId) return;
        let cancelled = false;
        async function poll() {
            while (!cancelled) {
                try {
                    const response = await server.get<{ job: ReadWeaveGenerationJob }>(`readweave/generation-jobs/${encodeURIComponent(generationJobId!)}`);
                    if (cancelled) return;
                    const job = response.job;
                    setGenerationProgress(job.progress);
                    const latest = job.progress.at(-1);
                    if (latest) setStatus(latest.message);
                    if (job.status === "running") {
                        await delay(350);
                        continue;
                    }
                    if (job.status === "failed" || !job.result) {
                        setStatus(job.error || t("readweave.generate_failed_no_fallback"));
                        setStatusTone("error");
                        setGenerationJobId(undefined);
                        setBusy(false);
                        return;
                    }
                    const result = job.result;
                    setBody(result.body);
                    if (result.optimizedTitle) setQuestionTitle(result.optimizedTitle);
                    if (result.termIdentity) setTermIdentity(current => mergeTermIdentity(result.termIdentity!, current));
                    setContextDecision(result.context);
                    setWorkflow(result.workflow);
                    setStatus(t(result.optimizedTitle ? "readweave.draft_ready_optimized" : "readweave.draft_ready"));
                    setStatusTone("normal");
                    setGenerationJobId(undefined);
                    setBusy(false);
                    return;
                } catch (error) {
                    if (cancelled) return;
                    setStatus(readableError(error, t("readweave.generate_failed_no_fallback")));
                    setStatusTone("error");
                    setGenerationJobId(undefined);
                    setBusy(false);
                    return;
                }
            }
        }
        void poll();
        return () => { cancelled = true; };
    }, [generationJobId]);

    useEffect(() => {
        if (!currentTitle) {
            setCandidates([]);
            return;
        }
        const timeout = window.setTimeout(async () => {
            try {
                const response = await server.post<{ candidates: ReadWeaveCandidate[] }>("readweave/candidates", {
                    title: currentTitle,
                    kind,
                    termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined
                });
                setCandidates(response.candidates);
            } catch {
                setCandidates([]);
            }
        }, 350);
        return () => window.clearTimeout(timeout);
    }, [currentTitle, kind, termIdentity]);

    async function generate() {
        if (!noteId || !selection || !currentTitle) return;
        setBusy(true);
        setStatus(t("readweave.generating"));
        setStatusTone("normal");
        setGenerationProgress([]);
        setReuseObjectId(undefined);
        try {
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
            setGenerationProgress(response.job.progress);
            setGenerationJobId(response.job.jobId);
        } catch (error) {
            setStatus(readableError(error, t("readweave.generate_failed_no_fallback")));
            setStatusTone("error");
            setBusy(false);
        }
    }

    async function save() {
        if (!noteId || !selection || !saveReady) return;
        setBusy(true);
        setStatus(t("readweave.saving"));
        setStatusTone("normal");
        try {
            await server.post("readweave/entries", {
                articleId: noteId,
                anchorId: selection.anchorId,
                anchorType: selection.anchorType,
                kind,
                title: currentTitle,
                body,
                sourceExcerpt: selection.excerpt,
                calloutType,
                termIdentity: kind === "term" ? cleanPartialTermIdentity(termIdentity) : undefined,
                reuseObjectId
            });
            sessionStorage.removeItem(draftKey(noteId, selection.anchorId));
            resetEditor(kind);
            await refreshCurrent(noteId, selection.anchorId);
            setStatus(t("readweave.saved"));
        } catch {
            setStatus(t("readweave.save_failed"));
        } finally {
            setBusy(false);
        }
    }

    function resetEditor(currentKind: ReadWeaveObjectKind) {
        setQuestionTitle("");
        setTermIdentity(initialTermIdentity(selection?.excerpt ?? "", currentKind));
        setBody("");
        setReuseObjectId(undefined);
        setCandidates([]);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setGenerationJobId(undefined);
        setGenerationProgress([]);
    }

    async function loadCandidate(candidate: ReadWeaveCandidate) {
        if (candidateDetails[candidate.objectId]) return;
        const response = await server.get<{ object: ReadWeaveObject }>(`readweave/objects/${encodeURIComponent(candidate.objectId)}`);
        setCandidateDetails(current => ({ ...current, [candidate.objectId]: response.object }));
    }

    async function reuse(candidate: ReadWeaveCandidate) {
        let object = candidateDetails[candidate.objectId];
        if (!object) {
            const response = await server.get<{ object: ReadWeaveObject }>(`readweave/objects/${encodeURIComponent(candidate.objectId)}`);
            object = response.object;
            setCandidateDetails(current => ({ ...current, [candidate.objectId]: object }));
        }
        setKind(object.kind);
        if (object.kind === "question") setQuestionTitle(object.title);
        else setTermIdentity(object.termIdentity ?? { chineseName: object.title });
        setBody(object.body);
        setCalloutType(object.calloutType);
        setReuseObjectId(object.objectId);
        setStatus(t("readweave.reuse_selected"));
    }

    function changeKind(nextKind: ReadWeaveObjectKind) {
        if (nextKind === kind) return;
        setKind(nextKind);
        resetEditor(nextKind);
        setCalloutType(defaultCallout(nextKind));
        setStatus(undefined);
        setStatusTone("normal");
    }

    function changeDraft() {
        setBody("");
        setReuseObjectId(undefined);
        setContextDecision(undefined);
        setWorkflow(undefined);
        setCandidates([]);
        setStatus(undefined);
    }

    async function beginEdit(entry: ReadWeaveResolvedEntry) {
        setBusy(true);
        try {
            const response = await server.get<{ impact: ReadWeaveImpact }>(`readweave/objects/${encodeURIComponent(entry.objectId)}/impact`);
            setEditState({
                entry,
                impact: response.impact,
                title: entry.title,
                body: entry.body,
                calloutType: entry.calloutType,
                termIdentity: entry.termIdentity ?? { chineseName: entry.title }
            });
        } finally {
            setBusy(false);
        }
    }

    async function applyEdit() {
        if (!editState?.mode || !noteId || !selection) return;
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
            setEditState(undefined);
            await refreshCurrent(noteId, selection.anchorId);
            setStatus(t("readweave.updated"));
        } catch {
            setStatus(t("readweave.update_failed"));
        } finally {
            setBusy(false);
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
                            <div class="readweave-eyebrow">{selection.anchorType === "range" ? t("readweave.selected_range") : t("readweave.selected_paragraph")}</div>
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
                                    <TermFields value={editState.termIdentity} onChange={value => setEditState({ ...editState, termIdentity: value })} />
                                ) : (
                                    <label>{t("readweave.title_label")}<input value={editState.title} onInput={event => setEditState({ ...editState, title: event.currentTarget.value })} /></label>
                                )}
                                <label>{t("readweave.answer_label")}<textarea rows={7} value={editState.body} onInput={event => setEditState({ ...editState, body: event.currentTarget.value })} /></label>
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
                                <button type="button" class={kind === "question" ? "active" : ""} onClick={() => changeKind("question")}>{t("readweave.question")}</button>
                                <button type="button" class={kind === "term" ? "active" : ""} onClick={() => changeKind("term")}>{t("readweave.term")}</button>
                            </div>
                            {kind === "question" ? (
                                <>
                                    <label>{t("readweave.question_label")}
                                        <textarea rows={3} value={questionTitle} onInput={event => { setQuestionTitle(event.currentTarget.value); changeDraft(); }} data-testid="readweave-question" />
                                    </label>
                                    <label class="readweave-question-optimization">
                                        <input type="checkbox" checked={optimizeQuestion} onChange={event => setOptimizeQuestion(event.currentTarget.checked)} data-testid="readweave-optimize-question" />
                                        <span><strong>{t("readweave.optimize_question")}</strong><small>{t("readweave.optimize_question_hint")}</small></span>
                                    </label>
                                </>
                            ) : (
                                <>
                                    <TermFields value={termIdentity} onChange={value => { setTermIdentity(value); changeDraft(); }} />
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
                                                <button type="button" class="btn btn-sm btn-secondary" onClick={() => reuse(candidate)}>{t("readweave.reuse")}</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <CalloutSelector value={calloutType} onChange={setCalloutType} />
                            <button type="button" class="btn btn-secondary" disabled={busy || !currentTitle} onClick={generate} data-testid="readweave-generate">{t("readweave.generate")}</button>
                            <label>{t("readweave.answer_label")}
                                <textarea rows={9} value={body} onInput={event => setBody(event.currentTarget.value)} data-testid="readweave-answer" />
                            </label>
                            {reuseObjectId && <p class="readweave-status">{t("readweave.reusing_object")}</p>}
                            {contextDecision && <p class="readweave-status">{t("readweave.context_used", { count: contextDecision.characterCount, budget: contextDecision.characterBudget, expansions: contextDecision.expansionLevel })}</p>}
                            {workflow && <p class="readweave-status">{t("readweave.workflow_used", { generations: workflow.generationAttempts, checks: workflow.validationPasses })}</p>}
                            {generationProgress.length > 0 && (
                                <ol class="readweave-generation-progress" aria-label={t("readweave.generation_progress")}>
                                    {generationProgress.slice(-4).map(progress => (
                                        <li class={progress.stage === "complete" ? "complete" : ""} key={`${progress.round}-${progress.stage}`}>
                                            <span>{progress.message}</span>
                                            {progress.issues.length > 0 && <small>{progress.issues.join("；")}</small>}
                                        </li>
                                    ))}
                                </ol>
                            )}
                            <button type="button" class="btn btn-primary" disabled={busy || !saveReady} onClick={save} data-testid="readweave-save">{t("readweave.review_and_save")}</button>
                        </section>
                    </>
                )}
                {status && <p class={`readweave-status ${statusTone === "error" ? "readweave-status-error" : ""}`} role={statusTone === "error" ? "alert" : "status"}>{status}</p>}
                <button type="button" class="btn btn-sm btn-link readweave-export" onClick={exportArticle} disabled={!noteId}>{t("readweave.export_article")}</button>
            </div>

            {hoverPreview && (
                <aside
                    class="readweave-hover-preview"
                    style={{ left: `${hoverPreview.left}px`, top: `${hoverPreview.top}px` }}
                    onMouseEnter={() => { window.clearTimeout(hoverCloseTimer.current); window.clearTimeout(hoverOpenTimer.current); }}
                    onMouseLeave={scheduleHoverClose}
                    aria-label={t("readweave.anchor_preview")}
                >
                    <div class="readweave-hover-terms">
                        <div class="readweave-section-title">{t("readweave.term_definitions")}</div>
                        {hoverPreview.summary.entries.filter(entry => entry.kind === "term").map(entry => (
                            <article class={`readweave-hover-term readweave-callout-${entry.calloutType}`} key={entry.linkId}>
                                <div class="readweave-hover-title"><i class={CALLOUT_ICONS[entry.calloutType]} />{entry.title}</div>
                                <p class="readweave-hover-definition">{entry.body}</p>
                            </article>
                        ))}
                    </div>
                </aside>
            )}
        </RightPanelWidget>
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

function TermFields({ value, onChange }: { value: Partial<ReadWeaveTermIdentity>; onChange: (value: Partial<ReadWeaveTermIdentity>) => void }) {
    return (
        <div class="readweave-term-fields">
            <label>{t("readweave.term_abbreviation")}<input value={value.abbreviation ?? ""} onInput={event => onChange({ ...value, abbreviation: event.currentTarget.value })} /></label>
            <label>{t("readweave.term_chinese_name")}<input value={value.chineseName ?? ""} onInput={event => onChange({ ...value, chineseName: event.currentTarget.value })} /></label>
            <label>{t("readweave.term_english_name")}<input value={value.englishName ?? ""} onInput={event => onChange({ ...value, englishName: event.currentTarget.value })} /></label>
        </div>
    );
}

interface AnchorInteractionOptions {
    noteId: string | null | undefined;
    noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"];
    summaries: ReadWeaveAnchorSummary[];
    onSelect: (selection: AnchorSelection, preferredKind?: ReadWeaveObjectKind) => void;
    onStatus: (status: string | undefined) => void;
    onHover: (summary: ReadWeaveAnchorSummary, rect: DOMRect) => void;
    onHoverLeave: () => void;
}

function useAnchorInteractions(options: AnchorInteractionOptions) {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const activeAnchorRef = useRef<string>();

    useEffect(() => {
        const { noteId, noteContext } = optionsRef.current;
        if (!noteId || !noteContext) return;
        const activeNoteContext = noteContext;
        let actionBubble: HTMLDivElement | undefined;
        let bubbleCloseTimer: number | undefined;
        let selectionRect: DOMRect | undefined;
        let observer: MutationObserver | undefined;
        let editorRoot: HTMLElement | null = null;
        let editorAttachTimer: number | undefined;
        let disposed = false;

        function removeBubble() {
            window.clearTimeout(bubbleCloseTimer);
            actionBubble?.remove();
            actionBubble = undefined;
            selectionRect = undefined;
        }

        function scheduleBubbleClose() {
            window.clearTimeout(bubbleCloseTimer);
            bubbleCloseTimer = window.setTimeout(removeBubble, 160);
        }

        function onPointerMove(event: MouseEvent) {
            if (!actionBubble || !selectionRect) return;
            const bubbleRect = actionBubble.getBoundingClientRect();
            const padding = 6;
            const within = (rect: DOMRect) => event.clientX >= rect.left - padding && event.clientX <= rect.right + padding
                && event.clientY >= rect.top - padding && event.clientY <= rect.bottom + padding;
            if (within(bubbleRect) || within(selectionRect)) window.clearTimeout(bubbleCloseTimer);
            else scheduleBubbleClose();
        }

        function onSelectionChange() {
            if (window.getSelection()?.isCollapsed) scheduleBubbleClose();
        }

        function setActiveAnchor(root: HTMLElement, anchorId: string) {
            root.querySelectorAll(".readweave-anchor-active,.readweave-paragraph-selected").forEach(element => {
                element.classList.remove("readweave-anchor-active", "readweave-paragraph-selected");
            });
            matchingAnchorElements(root, anchorId).forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-anchor-active" : "readweave-paragraph-selected"));
            activeAnchorRef.current = anchorId;
        }

        function setHoveredAnchor(root: HTMLElement, anchorId: string, hovered: boolean) {
            matchingAnchorElements(root, anchorId).forEach(element => {
                element.classList.toggle("readweave-anchor-hover", hovered);
            });
        }

        function onAnchorMouseOver(event: MouseEvent) {
            const root = editorRoot;
            if (!root || !(event.target instanceof Element) || !root.contains(event.target)) return;
            const element = event.target.closest<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`);
            const anchorId = anchorIdOf(element);
            if (!element || !anchorId) return;
            const relatedAnchorId = event.relatedTarget instanceof Element
                ? anchorIdOf(event.relatedTarget.closest(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`))
                : undefined;
            if (relatedAnchorId === anchorId) return;

            root.querySelectorAll(".readweave-anchor-hover").forEach(anchor => anchor.classList.remove("readweave-anchor-hover"));
            setHoveredAnchor(root, anchorId, true);
            const summary = optionsRef.current.summaries.find(item => item.anchorId === anchorId);
            if (summary?.entries.some(entry => entry.kind === "term")) {
                optionsRef.current.onHover(summary, element.getBoundingClientRect());
            } else {
                optionsRef.current.onHoverLeave();
            }
        }

        function onAnchorMouseOut(event: MouseEvent) {
            const root = editorRoot;
            if (!root || !(event.target instanceof Element) || !root.contains(event.target)) return;
            const element = event.target.closest<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`);
            const anchorId = anchorIdOf(element);
            if (!anchorId) return;
            const relatedAnchorId = event.relatedTarget instanceof Element
                ? anchorIdOf(event.relatedTarget.closest(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`))
                : undefined;
            if (relatedAnchorId === anchorId) return;
            setHoveredAnchor(root, anchorId, false);
            optionsRef.current.onHoverLeave();
        }

        function decorateAnchors(root: HTMLElement) {
            const grouped = new Map<string, HTMLElement[]>();
            root.querySelectorAll<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`).forEach(element => {
                const anchorId = anchorIdOf(element);
                if (!anchorId) return;
                grouped.set(anchorId, [ ...(grouped.get(anchorId) ?? []), element ]);
            });
            for (const [anchorId, elements] of grouped) {
                elements.forEach(element => {
                    element.classList.remove("readweave-range-anchor", "readweave-paragraph-anchor");
                    element.classList.remove("readweave-anchor-end");
                    for (const type of CALLOUT_TYPES) element.classList.remove(`readweave-anchor-callout-${type}`);
                    delete element.dataset.readweaveQuestionCount;
                });
                const last = elements.at(-1)!;
                const summary = optionsRef.current.summaries.find(item => item.anchorId === anchorId);
                if (!summary?.entries.length) {
                    if (activeAnchorRef.current === anchorId) elements.forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-anchor-active" : "readweave-paragraph-selected"));
                    continue;
                }
                const anchorType = anchorCalloutType(summary);
                elements.forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-range-anchor" : "readweave-paragraph-anchor"));
                elements.forEach(element => element.classList.add(`readweave-anchor-callout-${anchorType}`));
                last.classList.add("readweave-anchor-end");
                if (summary?.questionCount) last.dataset.readweaveQuestionCount = String(summary.questionCount);
                if (activeAnchorRef.current === anchorId) elements.forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-anchor-active" : "readweave-paragraph-selected"));
            }
        }

        async function editorAndRoot() {
            const editor: CKTextEditor | null = await activeNoteContext.getTextEditor().catch(() => null);
            const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
            return { editor, root };
        }

        async function selectExisting(root: HTMLElement, anchorId: string, block: HTMLElement, anchorType: ReadWeaveAnchorType, preferredKind?: ReadWeaveObjectKind) {
            setActiveAnchor(root, anchorId);
            const elements = matchingAnchorElements(root, anchorId);
            const summaryExcerpt = optionsRef.current.summaries.find(item => item.anchorId === anchorId)?.excerpt;
            const excerpt = summaryExcerpt || (anchorType === "range" ? elements.map(textOf).join("") : textOf(block)) || "";
            await optionsRef.current.onSelect({
                anchorId,
                anchorType,
                excerpt,
                fragments: collectFragments(root, block, excerpt)
            }, preferredKind);
        }

        async function onMouseUp(event: MouseEvent) {
            if (!(event.target instanceof Element) || event.target.closest(".readweave-selection-actions,.readweave-panel,.readweave-hover-preview")) return;
            const nativeSelection = window.getSelection();
            if (!nativeSelection || nativeSelection.isCollapsed || !nativeSelection.rangeCount) return;
            const nativeRange = nativeSelection.getRangeAt(0);
            const common = nativeRange.commonAncestorContainer instanceof Element ? nativeRange.commonAncestorContainer : nativeRange.commonAncestorContainer.parentElement;
            const root = common?.closest<HTMLElement>('[contenteditable="true"][role="textbox"]');
            if (!root) return;
            const { editor, root: actualRoot } = await editorAndRoot();
            if (!editor || !actualRoot || actualRoot !== root) return;
            const modelRange = editor.model.document.selection.getFirstRange();
            const excerpt = nativeSelection.toString().replace(/\s+/g, " ").trim().slice(0, 10_000);
            const block = common?.closest<HTMLElement>(BLOCK_SELECTOR);
            if (!modelRange || !excerpt || !block || !root.contains(block)) return;
            const interactionEditor = editor;
            const interactionRoot = root;
            const interactionBlock = block;
            const interactionModelRange = modelRange;

            const intersecting = Array.from(root.querySelectorAll<HTMLElement>(RANGE_ANCHOR_SELECTOR)).filter(element => {
                try { return nativeRange.intersectsNode(element); } catch { return false; }
            });
            const intersectingIds = Array.from(new Set(intersecting.map(anchorIdOf).filter(Boolean)));
            const containingAnchor = common?.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            if (intersectingIds.length > 1 || (intersectingIds.length === 1 && !containingAnchor)) {
                optionsRef.current.onStatus(t("readweave.overlapping_anchor"));
                return;
            }

            removeBubble();
            actionBubble = document.createElement("div");
            actionBubble.className = "readweave-selection-actions";
            actionBubble.setAttribute("role", "toolbar");
            actionBubble.addEventListener("mouseenter", () => window.clearTimeout(bubbleCloseTimer));
            actionBubble.addEventListener("mouseleave", scheduleBubbleClose);
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
                    buttonEvent.preventDefault();
                    buttonEvent.stopPropagation();
                    let anchorId = containingAnchor && rangeCoversElementContents(nativeRange, containingAnchor)
                        ? anchorIdOf(containingAnchor)
                        : undefined;
                    if (!anchorId) {
                        anchorId = `rwr_${utils.randomString(20)}`;
                        interactionEditor.model.change(writer => writer.setAttribute("readWeaveAnchorId", anchorId!, interactionModelRange));
                    }
                    removeBubble();
                    window.getSelection()?.removeAllRanges();
                    window.requestAnimationFrame(async () => {
                        decorateAnchors(interactionRoot);
                        setActiveAnchor(interactionRoot, anchorId!);
                        await optionsRef.current.onSelect({
                            anchorId: anchorId!,
                            anchorType: "range",
                            excerpt,
                            fragments: collectFragments(interactionRoot, interactionBlock, excerpt)
                        }, preferredKind);
                    });
                }
                button.addEventListener("mousedown", activate);
                button.addEventListener("click", activate);
                actionBubble.append(button);
            }
            document.body.append(actionBubble);
            const rect = nativeRange.getBoundingClientRect();
            selectionRect = rect;
            actionBubble.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - actionBubble.offsetWidth - 8))}px`;
            actionBubble.style.top = `${Math.max(8, rect.top - actionBubble.offsetHeight - 8)}px`;
        }

        async function onClick(event: MouseEvent) {
            if (!(event.target instanceof Element) || event.target.closest(".readweave-selection-actions,.readweave-panel,.readweave-hover-preview")) return;
            const nativeSelection = window.getSelection();
            if (nativeSelection && !nativeSelection.isCollapsed && actionBubble) return;
            removeBubble();
            const located = findEditableBlock(event.target);
            if (!located) return;
            const { editor, root } = await editorAndRoot();
            if (!editor || !root || root !== located.root) return;

            const rangeAnchor = event.target.closest<HTMLElement>(RANGE_ANCHOR_SELECTOR);
            const rangeAnchorId = anchorIdOf(rangeAnchor);
            if (rangeAnchorId) {
                await selectExisting(root, rangeAnchorId, located.block, "range");
                return;
            }

            let anchorId = located.block.dataset.readweaveAnchorId;
            if (!anchorId) {
                const viewElement = editor.editing.view.domConverter.mapDomToView(located.block);
                if (viewElement?.is("element")) {
                    const modelElement = editor.editing.mapper.toModelElement(viewElement);
                    if (modelElement && editor.model.schema.checkAttribute(modelElement, "readWeaveParagraphAnchorId")) {
                        anchorId = `rwp_${utils.randomString(20)}`;
                        editor.model.change(writer => writer.setAttribute("readWeaveParagraphAnchorId", anchorId!, modelElement));
                        located.block.dataset.readweaveAnchorId = anchorId;
                    }
                }
            }
            if (!anchorId) {
                optionsRef.current.onStatus(t("readweave.anchor_requires_edit"));
                return;
            }
            decorateAnchors(root);
            await selectExisting(root, anchorId, located.block, "paragraph");
        }

        async function attachEditorWhenReady(attempt = 0) {
            const { root } = await editorAndRoot();
            if (disposed) return;
            if (!root) {
                if (attempt < 100) editorAttachTimer = window.setTimeout(() => attachEditorWhenReady(attempt + 1), 80);
                return;
            }
            editorRoot = root;
            root.addEventListener("mouseover", onAnchorMouseOver);
            root.addEventListener("mouseout", onAnchorMouseOut);
            decorateAnchors(root);
            observer = new MutationObserver(() => decorateAnchors(root));
            observer.observe(root, { childList: true, subtree: true });
        }
        void attachEditorWhenReady();
        document.addEventListener("mouseup", onMouseUp, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("mousemove", onPointerMove);
        document.addEventListener("selectionchange", onSelectionChange);
        document.addEventListener("scroll", removeBubble, true);
        return () => {
            disposed = true;
            window.clearTimeout(editorAttachTimer);
            removeBubble();
            observer?.disconnect();
            editorRoot?.removeEventListener("mouseover", onAnchorMouseOver);
            editorRoot?.removeEventListener("mouseout", onAnchorMouseOut);
            editorRoot?.querySelectorAll(".readweave-anchor-active,.readweave-paragraph-selected,.readweave-anchor-hover").forEach(element => element.classList.remove("readweave-anchor-active", "readweave-paragraph-selected", "readweave-anchor-hover"));
            document.removeEventListener("mouseup", onMouseUp, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("mousemove", onPointerMove);
            document.removeEventListener("selectionchange", onSelectionChange);
            document.removeEventListener("scroll", removeBubble, true);
        };
    }, [options.noteId, options.noteContext]);

    useEffect(() => {
        let cancelled = false;
        if (!options.noteContext) return;
        options.noteContext.getTextEditor().then(editor => {
            if (cancelled) return;
            const root = editor?.editing.view.getDomRoot() as HTMLElement | null;
            if (root) applyAnchorSummaryDecorations(root, options.summaries);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [options.noteId, options.noteContext, options.summaries]);
}

function applyAnchorSummaryDecorations(root: HTMLElement, summaries: ReadWeaveAnchorSummary[]) {
    const grouped = new Map<string, HTMLElement[]>();
    root.querySelectorAll<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`).forEach(element => {
        const anchorId = anchorIdOf(element);
        if (anchorId) grouped.set(anchorId, [ ...(grouped.get(anchorId) ?? []), element ]);
    });
    for (const [anchorId, elements] of grouped) {
        elements.forEach(element => {
            element.classList.remove("readweave-anchor-end", "readweave-range-anchor", "readweave-paragraph-anchor");
            for (const type of CALLOUT_TYPES) element.classList.remove(`readweave-anchor-callout-${type}`);
            delete element.dataset.readweaveQuestionCount;
        });
        const summary = summaries.find(item => item.anchorId === anchorId);
        if (!summary?.entries.length) continue;
        const anchorType = anchorCalloutType(summary);
        elements.forEach(element => element.classList.add(element.matches(RANGE_ANCHOR_SELECTOR) ? "readweave-range-anchor" : "readweave-paragraph-anchor"));
        elements.forEach(element => element.classList.add(`readweave-anchor-callout-${anchorType}`));
        const last = elements.at(-1)!;
        last.classList.add("readweave-anchor-end");
        if (summary.questionCount > 0) last.dataset.readweaveQuestionCount = String(summary.questionCount);
    }
}

function anchorCalloutType(summary: ReadWeaveAnchorSummary | undefined): ReadWeaveCalloutType {
    return summary?.entries.find(entry => entry.kind === "term")?.calloutType
        ?? summary?.entries[0]?.calloutType
        ?? "note";
}

function findEditableBlock(target: EventTarget | null): { root: HTMLElement; block: HTMLElement } | null {
    if (!(target instanceof Element)) return null;
    const root = target.closest<HTMLElement>('[contenteditable="true"][role="textbox"]');
    if (!root) return null;
    const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
    return block && root.contains(block) ? { root, block } : null;
}

function anchorIdOf(element: Element | null | undefined): string | undefined {
    if (!(element instanceof HTMLElement)) return undefined;
    return element.dataset.readweaveRangeAnchorId || element.dataset.readweaveAnchorId;
}

function matchingAnchorElements(root: HTMLElement, anchorId: string): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(`${RANGE_ANCHOR_SELECTOR},${PARAGRAPH_ANCHOR_SELECTOR}`)).filter(element => anchorIdOf(element) === anchorId);
}

function rangeCoversElementContents(range: Range, element: Element): boolean {
    const elementRange = document.createRange();
    elementRange.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.START_TO_START, elementRange) <= 0
        && range.compareBoundaryPoints(Range.END_TO_END, elementRange) >= 0;
}

function textOf(element: Element | null | undefined, maxLength = 10_000): string {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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

function defaultCallout(kind: ReadWeaveObjectKind): ReadWeaveCalloutType {
    return kind === "term" ? "tip" : "note";
}

function initialTermIdentity(_excerpt: string, _kind: ReadWeaveObjectKind): Partial<ReadWeaveTermIdentity> {
    return {};
}

function cleanPartialTermIdentity(value: Partial<ReadWeaveTermIdentity>): Partial<ReadWeaveTermIdentity> {
    return {
        abbreviation: value.abbreviation?.trim() || undefined,
        chineseName: value.chineseName?.trim() || undefined,
        englishName: value.englishName?.trim() || undefined
    } as Partial<ReadWeaveTermIdentity>;
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

async function refreshEntries(noteId: string, anchorId: string, setEntries: (entries: ReadWeaveResolvedEntry[]) => void) {
    const response = await server.get<{ entries: ReadWeaveResolvedEntry[] }>(`readweave/articles/${encodeURIComponent(noteId)}/anchors/${encodeURIComponent(anchorId)}`);
    setEntries(response.entries);
}

function delay(milliseconds: number) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
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
