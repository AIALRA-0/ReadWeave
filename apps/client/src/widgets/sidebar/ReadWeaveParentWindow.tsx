import { READWEAVE_MAX_FOLLOW_UP_DEPTH, type ReadWeaveAnswerSelection, type ReadWeaveContentType, type ReadWeaveResolvedEntry } from "@triliumnext/commons";
import { createPortal } from "preact/compat";
import { useState } from "preact/hooks";

import { ReadWeaveAnswer, type ReadWeaveAnswerMarker } from "./ReadWeaveAnswer.js";
import { ReadWeaveQuestionText } from "./ReadWeaveQuestionText.js";

/** The parent remains readable while the regular ReadWeave editor handles its child. */
export function ReadWeaveParentWindow({ parent, selection, markers, onOpenMarker, onClose, onAction }: {
    parent: ReadWeaveResolvedEntry;
    selection: ReadWeaveAnswerSelection;
    markers: ReadWeaveAnswerMarker[];
    onOpenMarker: (id: string) => void;
    onClose: () => void;
    onAction: (selection: ReadWeaveAnswerSelection, contentType: ReadWeaveContentType) => void;
}) {
    const [position, setPosition] = useState(() => ({
        x: Math.max(8, (document.querySelector("#right-pane")?.getBoundingClientRect().left ?? window.innerWidth) - 498),
        y: 88
    }));
    return createPortal(
        <section class="readweave-follow-up-window readweave-parent-window" role="dialog" aria-modal="false"
            aria-label="追问的父回答" data-testid="readweave-parent-window"
            style={{ left: position.x, top: position.y }}>
            <header onPointerDown={event => {
                if ((event.target as HTMLElement).closest("button")) return;
                const offsetX = event.clientX - position.x;
                const offsetY = event.clientY - position.y;
                const target = event.currentTarget;
                target.setPointerCapture(event.pointerId);
                target.onpointermove = next => setPosition({
                    x: Math.max(8, Math.min(window.innerWidth - 80, next.clientX - offsetX)),
                    y: Math.max(8, Math.min(window.innerHeight - 70, next.clientY - offsetY))
                });
                target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; };
            }}>
                <strong>原回答 · 第 {parent.depth + 1}/{READWEAVE_MAX_FOLLOW_UP_DEPTH} 层</strong>
                <button type="button" class="btn btn-sm" onClick={onClose} aria-label="关闭原回答浮窗">×</button>
            </header>
            <div class="readweave-follow-up-content">
                <strong><ReadWeaveQuestionText text={parent.title} /></strong>
                <small>已选：{selection.text}</small>
                <ReadWeaveAnswer body={parent.body} revision={parent.revision} markers={markers} onOpenMarker={onOpenMarker}
                    onAction={parent.depth < READWEAVE_MAX_FOLLOW_UP_DEPTH ? onAction : undefined} />
            </div>
        </section>, document.body
    );
}
