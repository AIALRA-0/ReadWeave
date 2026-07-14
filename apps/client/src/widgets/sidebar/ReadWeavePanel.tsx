import "./ReadWeavePanel.css";

import type { CKTextEditor } from "@triliumnext/ckeditor5";
import type {
    ReadWeaveCandidate,
    ReadWeaveContextFragment,
    ReadWeaveEditMode,
    ReadWeaveGenerateResponse,
    ReadWeaveImpact,
    ReadWeaveObject,
    ReadWeaveObjectKind,
    ReadWeaveResolvedEntry
} from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import utils from "../../services/utils.js";
import { useActiveNoteContext } from "../react/hooks.js";
import RightPanelWidget from "./RightPanelWidget.js";

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre";

interface Selection {
    anchorId: string;
    excerpt: string;
    fragments: ReadWeaveContextFragment[];
}

interface Draft {
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    reuseObjectId?: string;
}

interface EditState {
    entry: ReadWeaveResolvedEntry;
    impact: ReadWeaveImpact;
    title: string;
    body: string;
    mode?: ReadWeaveEditMode;
}

export default function ReadWeavePanel() {
    const { noteId, noteContext } = useActiveNoteContext();
    const [ selection, setSelection ] = useState<Selection>();
    const [ entries, setEntries ] = useState<ReadWeaveResolvedEntry[]>([]);
    const [ kind, setKind ] = useState<ReadWeaveObjectKind>("question");
    const [ title, setTitle ] = useState("");
    const [ body, setBody ] = useState("");
    const [ reuseObjectId, setReuseObjectId ] = useState<string>();
    const [ candidates, setCandidates ] = useState<ReadWeaveCandidate[]>([]);
    const [ candidateDetails, setCandidateDetails ] = useState<Record<string, ReadWeaveObject>>({});
    const [ contextDecision, setContextDecision ] = useState<ReadWeaveGenerateResponse["context"]>();
    const [ status, setStatus ] = useState<string>();
    const [ busy, setBusy ] = useState(false);
    const [ editState, setEditState ] = useState<EditState>();
    const selectedBlockRef = useRef<HTMLElement>();

    useParagraphSelection(noteId, noteContext, async (nextSelection, block) => {
        selectedBlockRef.current?.classList.remove("readweave-paragraph-selected");
        block.classList.add("readweave-paragraph-selected");
        selectedBlockRef.current = block;
        setSelection(nextSelection);
        setStatus(undefined);
        setEditState(undefined);
        const draft = readDraft(noteId!, nextSelection.anchorId);
        setKind(draft?.kind ?? "question");
        setTitle(draft?.title ?? "");
        setBody(draft?.body ?? "");
        setReuseObjectId(draft?.reuseObjectId);
        await refreshEntries(noteId!, nextSelection.anchorId, setEntries);
    }, setStatus);

    useEffect(() => {
        setSelection(undefined);
        setEntries([]);
        setEditState(undefined);
        selectedBlockRef.current?.classList.remove("readweave-paragraph-selected");
        selectedBlockRef.current = undefined;
    }, [ noteId ]);

    useEffect(() => {
        if (!noteId || !selection) return;
        const draft: Draft = { kind, title, body, reuseObjectId };
        sessionStorage.setItem(draftKey(noteId, selection.anchorId), JSON.stringify(draft));
    }, [ noteId, selection, kind, title, body, reuseObjectId ]);

    useEffect(() => {
        if (!title.trim()) {
            setCandidates([]);
            return;
        }
        const timeout = window.setTimeout(async () => {
            try {
                const response = await server.post<{ candidates: ReadWeaveCandidate[] }>("readweave/candidates", { title, kind });
                setCandidates(response.candidates);
            } catch {
                setCandidates([]);
            }
        }, 350);
        return () => window.clearTimeout(timeout);
    }, [ title, kind ]);

    async function generate() {
        if (!noteId || !selection || !title.trim()) return;
        setBusy(true);
        setStatus(t("readweave.generating"));
        setReuseObjectId(undefined);
        try {
            const response = await server.post<ReadWeaveGenerateResponse>("readweave/generate", {
                articleId: noteId,
                anchorId: selection.anchorId,
                kind,
                title,
                fragments: selection.fragments
            });
            setBody(response.body);
            setContextDecision(response.context);
            setStatus(t("readweave.draft_ready"));
        } catch {
            setStatus(t("readweave.generate_failed"));
        } finally {
            setBusy(false);
        }
    }

    async function save() {
        if (!noteId || !selection || !title.trim() || !body.trim()) return;
        setBusy(true);
        setStatus(t("readweave.saving"));
        try {
            await server.post("readweave/entries", {
                articleId: noteId,
                anchorId: selection.anchorId,
                kind,
                title,
                body,
                sourceExcerpt: selection.excerpt,
                reuseObjectId
            });
            sessionStorage.removeItem(draftKey(noteId, selection.anchorId));
            setTitle("");
            setBody("");
            setReuseObjectId(undefined);
            setCandidates([]);
            setContextDecision(undefined);
            await refreshEntries(noteId, selection.anchorId, setEntries);
            setStatus(t("readweave.saved"));
        } catch {
            setStatus(t("readweave.save_failed"));
        } finally {
            setBusy(false);
        }
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
        setTitle(object.title);
        setBody(object.body);
        setKind(object.kind);
        setReuseObjectId(object.objectId);
        setStatus(t("readweave.reuse_selected"));
    }

    async function beginEdit(entry: ReadWeaveResolvedEntry) {
        setBusy(true);
        try {
            const response = await server.get<{ impact: ReadWeaveImpact }>(`readweave/objects/${encodeURIComponent(entry.objectId)}/impact`);
            setEditState({ entry, impact: response.impact, title: entry.title, body: entry.body });
        } finally {
            setBusy(false);
        }
    }

    async function applyEdit() {
        if (!editState?.mode || !noteId || !selection) return;
        setBusy(true);
        try {
            await server.patch(`readweave/links/${encodeURIComponent(editState.entry.linkId)}`, {
                mode: editState.mode,
                title: editState.title,
                body: editState.body
            });
            setEditState(undefined);
            await refreshEntries(noteId, selection.anchorId, setEntries);
            setStatus(t("readweave.updated"));
        } finally {
            setBusy(false);
        }
    }

    async function exportArticle() {
        if (!noteId) return;
        const value = await server.get(`readweave/export?articleId=${encodeURIComponent(noteId)}`);
        const url = URL.createObjectURL(new Blob([ JSON.stringify(value, null, 2) ], { type: "application/json" }));
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
                    <p class="readweave-hint">{t("readweave.select_paragraph")}</p>
                ) : (
                    <>
                        <section class="readweave-selection">
                            <div class="readweave-eyebrow">{t("readweave.selected_paragraph")}</div>
                            <p>{selection.excerpt}</p>
                        </section>

                        <section class="readweave-existing">
                            <div class="readweave-section-title">{t("readweave.saved_items")}</div>
                            {entries.length === 0 && <p class="readweave-hint">{t("readweave.no_saved_items")}</p>}
                            {entries.map(entry => (
                                <article class="readweave-entry" key={entry.linkId} tabindex={0}>
                                    <div class="readweave-entry-title">
                                        <span>{entry.title}</span>
                                        {entry.isDisplayOverride && <span class="readweave-badge">{t("readweave.local_display")}</span>}
                                    </div>
                                    <div class="readweave-entry-detail">
                                        <p>{entry.body}</p>
                                        <button type="button" class="btn btn-sm btn-secondary" onClick={() => beginEdit(entry)} disabled={busy}>
                                            {t("readweave.edit")}
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </section>

                        {editState && (
                            <section class="readweave-editor readweave-impact">
                                <div class="readweave-section-title">{t("readweave.impact_first")}</div>
                                <p>{t("readweave.impact_summary", { links: editState.impact.linkCount, articles: editState.impact.articleCount })}</p>
                                {editState.impact.articles.length > 0 && (
                                    <ul>{editState.impact.articles.map(article => <li key={article.articleId}>{article.title}</li>)}</ul>
                                )}
                                <label>{t("readweave.title_label")}<input value={editState.title} onInput={event => setEditState({ ...editState, title: event.currentTarget.value })} /></label>
                                <label>{t("readweave.answer_label")}<textarea rows={7} value={editState.body} onInput={event => setEditState({ ...editState, body: event.currentTarget.value })} /></label>
                                <div class="readweave-edit-modes">
                                    {([ "global", "article-variant", "display-only" ] as ReadWeaveEditMode[]).map(mode => (
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
                                <button type="button" class={kind === "question" ? "active" : ""} onClick={() => { setKind("question"); setReuseObjectId(undefined); }}>{t("readweave.question")}</button>
                                <button type="button" class={kind === "term" ? "active" : ""} onClick={() => { setKind("term"); setReuseObjectId(undefined); }}>{t("readweave.term")}</button>
                            </div>
                            <label>{kind === "question" ? t("readweave.question_label") : t("readweave.term_label")}
                                <textarea rows={3} value={title} onInput={event => { setTitle(event.currentTarget.value); setReuseObjectId(undefined); }} />
                            </label>

                            {candidates.length > 0 && (
                                <div class="readweave-candidates">
                                    <div class="readweave-section-title">{t("readweave.similar_items")}</div>
                                    {candidates.map(candidate => (
                                        <div
                                            class={`readweave-candidate ${candidate.reuseRecommended ? "recommended" : ""}`}
                                            key={candidate.objectId}
                                            tabindex={0}
                                            onMouseEnter={() => loadCandidate(candidate)}
                                            onFocus={() => loadCandidate(candidate)}
                                        >
                                            <div>
                                                <span>{candidate.title}</span>
                                                {candidate.reuseRecommended && <span class="readweave-badge">{t("readweave.reuse_recommended")}</span>}
                                            </div>
                                            <div class="readweave-candidate-detail">
                                                <p>{candidateDetails[candidate.objectId]?.body || t("readweave.loading")}</p>
                                                <button type="button" class="btn btn-sm btn-secondary" onClick={() => reuse(candidate)}>{t("readweave.reuse")}</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button type="button" class="btn btn-secondary" disabled={busy || !title.trim()} onClick={generate}>{t("readweave.generate")}</button>
                            <label>{t("readweave.answer_label")}
                                <textarea rows={9} value={body} onInput={event => setBody(event.currentTarget.value)} />
                            </label>
                            {reuseObjectId && <p class="readweave-status">{t("readweave.reusing_object")}</p>}
                            {contextDecision && <p class="readweave-status">{t("readweave.context_used", { count: contextDecision.characterCount, budget: contextDecision.characterBudget })}</p>}
                            <button type="button" class="btn btn-primary" disabled={busy || !title.trim() || !body.trim()} onClick={save}>{t("readweave.review_and_save")}</button>
                        </section>
                    </>
                )}
                {status && <p class="readweave-status" role="status">{status}</p>}
                <button type="button" class="btn btn-sm btn-link readweave-export" onClick={exportArticle} disabled={!noteId}>{t("readweave.export_article")}</button>
            </div>
        </RightPanelWidget>
    );
}

function useParagraphSelection(
    noteId: string | null | undefined,
    noteContext: ReturnType<typeof useActiveNoteContext>["noteContext"],
    onSelect: (selection: Selection, block: HTMLElement) => void,
    setStatus: (status: string | undefined) => void
) {
    const onSelectRef = useRef(onSelect);
    const setStatusRef = useRef(setStatus);
    onSelectRef.current = onSelect;
    setStatusRef.current = setStatus;

    useEffect(() => {
        if (!noteId || !noteContext) return;
        let hoverBlock: HTMLElement | null = null;
        const onMouseOver = (event: MouseEvent) => {
            const located = findEditableBlock(event.target);
            const block = located?.block ?? null;
            if (hoverBlock === block) return;
            hoverBlock?.classList.remove("readweave-paragraph-hover");
            hoverBlock = block;
            hoverBlock?.classList.add("readweave-paragraph-hover");
        };
        const onClick = async (event: MouseEvent) => {
            const located = findEditableBlock(event.target);
            if (!located) return;

            const editor: CKTextEditor | null = await noteContext.getTextEditor().catch(() => null);
            const editorRoot = editor?.editing.view.getDomRoot() as HTMLElement | null;
            if (!editor || !editorRoot?.contains(located.block)) return;

            let anchorId = located.block.dataset.readweaveAnchorId;
            if (!anchorId) {
                const viewElement = editor.editing.view.domConverter.mapDomToView(located.block);
                if (viewElement?.is("element")) {
                    const modelElement = editor.editing.mapper.toModelElement(viewElement);
                    if (modelElement && editor.model.schema.checkAttribute(modelElement, "readWeaveAnchorId")) {
                        anchorId = `rw_${utils.randomString(20)}`;
                        editor.model.change(writer => writer.setAttribute("readWeaveAnchorId", anchorId!, modelElement));
                        located.block.dataset.readweaveAnchorId = anchorId;
                    }
                }
            }
            if (!anchorId) {
                setStatusRef.current(t("readweave.anchor_requires_edit"));
                return;
            }
            onSelectRef.current({
                anchorId,
                excerpt: textOf(located.block),
                fragments: collectFragments(located.root, located.block)
            }, located.block);
        };

        document.addEventListener("mouseover", onMouseOver);
        document.addEventListener("click", onClick);
        return () => {
            hoverBlock?.classList.remove("readweave-paragraph-hover");
            document.removeEventListener("mouseover", onMouseOver);
            document.removeEventListener("click", onClick);
        };
    }, [ noteId, noteContext ]);
}

function findEditableBlock(target: EventTarget | null): { root: HTMLElement; block: HTMLElement } | null {
    if (!(target instanceof Element)) return null;
    const root = target.closest<HTMLElement>('[contenteditable="true"][role="textbox"]');
    if (!root) return null;
    const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
    return block && root.contains(block) ? { root, block } : null;
}

function textOf(element: Element | null | undefined): string {
    return (element?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 10_000);
}

function collectFragments(root: HTMLElement, block: HTMLElement): ReadWeaveContextFragment[] {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    const index = blocks.indexOf(block);
    const previousHeading = blocks.slice(0, Math.max(index, 0)).toReversed().find(item => /^H[1-6]$/.test(item.tagName));
    const fragments: ReadWeaveContextFragment[] = [
        { id: "selected", role: "selected", text: textOf(block) },
        { id: "heading", role: "heading", text: textOf(previousHeading) },
        { id: "previous", role: "previous", text: textOf(blocks[index - 1]), distance: 1 },
        { id: "next", role: "next", text: textOf(blocks[index + 1]), distance: 1 },
        { id: "document", role: "document", text: textOf(root).slice(0, 20_000), distance: 20 }
    ];
    return fragments.filter(fragment => fragment.text);
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
