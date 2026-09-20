import { KATEX_MACROS, type ReadWeaveAnswerSelection, type ReadWeaveContentType } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { READWEAVE_SELECTION_ACTIONS } from "./readweave_selection_actions.js";

const markdown = new Marked({ breaks: true, gfm: true });

/**
 * ReadWeave headings are required to carry their outline number. A bare line
 * such as `1. Innovus 是什么` is otherwise parsed by Markdown as an ordered
 * list item, which applies the list's indentation to the visible heading.
 * Only blank-line-separated, top-level numbered labels followed by content
 * are promoted; ordinary and nested list items keep their native structure.
 */
export function normalizeReadWeaveNumberedHeadings(body: string): string {
    const lines = body.split("\n");
    for (let index = 0; index < lines.length - 2; index++) {
        if (!lines[index].trim() || lines[index + 1].trim()) continue;
        if (index > 0 && /^\d+(?:\.\d+)*\.[ \t]+/u.test(lines[index - 1])) continue;
        const match = lines[index].match(/^(\d+(?:\.\d+)*\.)[ \t]+(.+)$/u);
        if (!match) continue;

        const next = lines[index + 2];
        if (!next.trim() || /^(?:[ \t]{2,}[-+*]|[ \t]*\d+[.)])[ \t]+/u.test(next)) continue;
        lines[index] = `## ${match[1]} ${match[2]}`;
    }
    return lines.join("\n");
}

export function renderAnswerMarkdown(body: string): string {
    body = normalizeReadWeaveNumberedHeadings(body);
    const protectedRanges = Array.from(body.matchAll(/(?:^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*(?:```|~~~)[ \t]*(?=\n|$)|(`+)[^`\n]*?\1/gu),
        match => ({ start:match.index, end:match.index + match[0].length }));
    const formulas: Array<{slot:string; source:string}> = [];
    let prefix = "RWFORMULASLOT";
    while (body.includes(prefix)) prefix += "X";
    const protectedBody = body.replace(/\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$/gu, (source, offset:number) => {
        if (protectedRanges.some(range => offset < range.end && offset + source.length > range.start)) return source;
        const slot = `${prefix}${formulas.length}END`;
        formulas.push({slot,source});
        return slot;
    });
    let html = markdown.parse(protectedBody) as string;
    for (const {slot,source} of formulas) {
        const escaped = source.replace(/&/gu,"&amp;").replace(/</gu,"&lt;").replace(/>/gu,"&gt;");
        // A replacement string interprets "$$" as a special token. A callback
        // returns the literal formula delimiters needed by the math renderer.
        html = html.replace(slot, () => `<span class="readweave-math-source${source.startsWith("$$") ? " readweave-math-display" : ""}">${escaped}</span>`);
    }
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: ["script", "style", "iframe", "object", "form", "input", "button"],
        FORBID_ATTR: ["style"],
    });
}

interface ReadWeaveRenderedUnit {
    node: Node;
    start: number;
    end: number;
    positions?: number[];
}

export interface ReadWeaveAnswerMarker {
    id: string;
    parentRevision: number;
    startOffset: number;
    endOffset: number;
    status: "running" | "ready" | "paused" | "failed" | "saved";
    title: string;
}

interface ReadWeaveMarkerRect {
    id: string;
    status: ReadWeaveAnswerMarker["status"];
    title: string;
    left: number;
    top: number;
    width: number;
    first: boolean;
}

function decodedSource(body: string) {
    const decoder = document.createElement("textarea");
    const positions: number[] = [];
    let decoded = "";
    for (let offset = 0; offset < body.length; ) {
        const entity = body.slice(offset).match(/^&(?:#x[\da-f]+|#\d+|[a-z]+);/iu)?.[0];
        decoder.innerHTML = entity ?? "";
        const value = entity ? decoder.value : body[offset];
        for (let index = 0; index < value.length; index++) positions.push(offset);
        decoded += value;
        offset += entity?.length ?? 1;
    }
    positions.push(body.length);
    return { decoded, positions };
}

function renderedUnits(root: HTMLElement, body: string): ReadWeaveRenderedUnit[] {
    const { decoded, positions } = decodedSource(body);
    const formulaSources = Array.from(body.matchAll(/\$\$([\s\S]*?)\$\$|\$([^$\n]*?)\$/gu));
    const units: ReadWeaveRenderedUnit[] = [];
    let decodedCursor = 0;
    let sourceCursor = 0;
    const decodedOffset = (sourceOffset: number) => {
        const found = positions.findIndex(position => position >= sourceOffset);
        return found < 0 ? decoded.length : found;
    };
    const visit = (node: Node) => {
        if (node instanceof Element && node.classList.contains("katex")) {
            const formula = node.querySelector("annotation[encoding='application/x-tex']")
                ?.textContent ?? "";
            const candidate = formulaSources
                .find(match => match.index >= sourceCursor
                    && (match[1] ?? match[2]).trim() === formula.trim());
            if (candidate) {
                units.push({
                    node,
                    start: candidate.index,
                    end: candidate.index + candidate[0].length,
                });
                sourceCursor = candidate.index + candidate[0].length;
                decodedCursor = decodedOffset(sourceCursor);
            }
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            if ((node.parentElement?.closest("[aria-hidden='true']"))) return;
            const renderedText = node.textContent ?? "";
            if (!renderedText) return;
            let text = renderedText;
            let index = decoded.indexOf(text, decodedCursor);
            while (index < 0 && text.endsWith("\n")) {
                text = text.slice(0, -1);
                index = decoded.indexOf(text, decodedCursor);
            }
            if (index < 0) return;
            units.push({
                node,
                start: positions[index],
                end: positions[index + text.length],
                positions: positions.slice(index, index + text.length + 1),
            });
            decodedCursor = index + text.length;
            sourceCursor = positions[decodedCursor];
            return;
        }
        for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return units;
}

/** Map rendered text nodes back to the exact Markdown source, in order. */
export function readWeaveAnswerSelection(
    root: HTMLElement,
    body: string,
    range: Range,
    parentRevision: number,
): ReadWeaveAnswerSelection | undefined {
    if (
        range.collapsed ||
        !root.contains(range.startContainer) ||
        !root.contains(range.endContainer)
    )
        return;
    const selected = renderedUnits(root, body).filter(unit => {
        try {
            return range.intersectsNode(unit.node);
        } catch {
            return false;
        }
    });
    if (!selected.length) return;
    const first = selected[0];
    const last = selected.at(-1)!;
    const start = first.node === range.startContainer && first.positions
        ? first.positions[Math.min(range.startOffset, first.positions.length - 1)]
        : first.start;
    const end = last.node === range.endContainer && last.positions
        ? last.positions[Math.min(range.endOffset, last.positions.length - 1)]
        : last.end;
    if (start === undefined || end === undefined || start >= end) return;
    return { parentRevision, startOffset: start, endOffset: end, text: body.slice(start, end) };
}

export function ReadWeaveAnswer({
    body,
    className = "",
    id,
    labelledBy,
    testId,
    revision = 0,
    followUpLabel = "追问",
    onFollowUp,
    onAction,
    markers = [],
    onOpenMarker,
}: {
    body: string;
    className?: string;
    id?: string;
    labelledBy?: string;
    testId?: string;
    revision?: number;
    followUpLabel?: string;
    onFollowUp?: (selection: ReadWeaveAnswerSelection) => void;
    onAction?: (selection: ReadWeaveAnswerSelection, contentType: ReadWeaveContentType) => void;
    markers?: ReadWeaveAnswerMarker[];
    onOpenMarker?: (id: string) => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const root = useRef<HTMLDivElement>(null);
    const toolbar = useRef<HTMLDivElement>(null);
    const selectionRect = useRef<DOMRect>();
    const [selected, setSelected] = useState<ReadWeaveAnswerSelection>();
    const [actionPosition, setActionPosition] = useState({ left: 8, top: 8 });
    const [markerRects, setMarkerRects] = useState<ReadWeaveMarkerRect[]>([]);
    const [mathRevision, setMathRevision] = useState(0);
    const markerKey = JSON.stringify(markers);
    const html = useMemo(() => renderAnswerMarkdown(body), [body]);
    useEffect(() => setSelected(undefined), [body, revision]);
    useLayoutEffect(() => {
        if (!selected || !toolbar.current || !selectionRect.current) return;
        const rect = selectionRect.current;
        const width = toolbar.current.offsetWidth || Math.min(360, window.innerWidth - 16);
        const height = toolbar.current.offsetHeight || 48;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const above = rect.top - height - 8;
        const top = above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + 8);
        setActionPosition({ left, top: Math.max(8, top) });
    }, [selected]);
    useLayoutEffect(() => {
        const container = root.current;
        if (!container) return;
        for (const link of container.querySelectorAll("a")) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        }
        if (!body.includes("$")) return;
        let cancelled = false;
        void import("../../services/math.js").then(({ default: katex }) => {
            if (!cancelled && container.isConnected) {
                for (const span of container.querySelectorAll<HTMLElement>(".readweave-math-source")) {
                    const source = span.textContent ?? "";
                    const displayMode = span.classList.contains("readweave-math-display");
                    const formula = source.slice(displayMode ? 2 : 1, displayMode ? -2 : -1).trim();
                    try {
                        katex.render(formula, span, {trust:false,throwOnError:true,displayMode,
                            macros:{...KATEX_MACROS}});
                    } catch (error) {
                        // KaTeX may clear the target before throwing. Never leave
                        // a blank formula when its source is still available.
                        span.textContent = source;
                        span.classList.add("readweave-math-invalid");
                        span.title = `公式无法渲染：${error instanceof Error ? error.message : String(error)}`;
                        span.setAttribute("role","status");
                    }
                }
                setMathRevision(current => current + 1);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [html, body]);
    useLayoutEffect(() => {
        const answerRoot = root.current;
        const answerContainer = container.current;
        if (!answerRoot || !answerContainer || !markers.length) {
            setMarkerRects([]);
            return;
        }
        const update = () => {
            const units = renderedUnits(answerRoot, body);
            const origin = answerContainer.getBoundingClientRect();
            const next: ReadWeaveMarkerRect[] = [];
            for (const marker of markers) {
                if (marker.parentRevision !== revision || marker.startOffset < 0 || marker.endOffset > body.length
                    || marker.startOffset >= marker.endOffset) continue;
                let first = true;
                for (const unit of units) {
                    if (unit.end <= marker.startOffset || unit.start >= marker.endOffset) continue;
                    const range = document.createRange();
                    if (unit.positions) {
                        const start = unit.positions.findIndex(position => position >= marker.startOffset);
                        const end = unit.positions.findIndex(position => position >= marker.endOffset);
                        const length = unit.node.textContent?.length ?? 0;
                        const from = start < 0 ? length : Math.max(0, start);
                        const to = end < 0 ? length : Math.max(0, end);
                        if (from >= to) continue;
                        range.setStart(unit.node, from);
                        range.setEnd(unit.node, to);
                    } else range.selectNode(unit.node);
                    for (const rect of Array.from(range.getClientRects())) {
                        if (rect.width <= 0) continue;
                        next.push({ id: marker.id, status: marker.status, title: marker.title,
                            left: rect.left - origin.left, top: rect.bottom - origin.top, width: rect.width, first });
                        first = false;
                    }
                }
            }
            setMarkerRects(next);
        };
        update();
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
        observer?.observe(answerRoot);
        window.addEventListener("resize", update);
        return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
    }, [body, html, revision, markerKey, mathRevision]);
    const capture = useCallback(() => {
        const selection = window.getSelection();
        if (!root.current || !selection?.rangeCount) {
            setSelected(undefined);
            return;
        }
        const range = selection.getRangeAt(0);
        const value = readWeaveAnswerSelection(
            root.current,
            body,
            range,
            revision,
        );
        if (value) {
            const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : new DOMRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                setSelected(undefined);
                return;
            }
            selectionRect.current = rect;
        }
        setSelected(value);
    }, [body, revision]);
    useEffect(() => {
        let frame = 0;
        const changed = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(capture);
        };
        document.addEventListener("selectionchange", changed);
        document.addEventListener("scroll", changed, true);
        window.addEventListener("resize", changed);
        return () => {
            document.removeEventListener("selectionchange", changed);
            document.removeEventListener("scroll", changed, true);
            window.removeEventListener("resize", changed);
            cancelAnimationFrame(frame);
        };
    }, [capture]);
    return (
        <div ref={container} class="readweave-answer-container">
            <div
                ref={root}
                id={id}
                class={`readweave-readable-body selectable-text ${className}`}
                aria-labelledby={labelledBy}
                role={labelledBy ? "region" : undefined}
                data-testid={testId}
                onPointerUp={capture}
                onKeyUp={capture}
                // HTML is produced only by the DOMPurify allowlist above.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {markerRects.map((rect, index) => <span key={`${rect.id}:${index}`} class={`readweave-answer-marker-line readweave-answer-marker-${rect.status}`}
                aria-hidden="true" style={{ left: rect.left, top: rect.top, width: rect.width }} />)}
            {markerRects.filter(rect => rect.first).map(rect => <button key={rect.id} type="button"
                class={`readweave-answer-marker-dot readweave-answer-marker-${rect.status}`}
                style={{ left: rect.left, top: rect.top }} title={rect.title} aria-label={`打开追问：${rect.title}`}
                onClick={() => onOpenMarker?.(rect.id)}>{rect.status === "saved" ? "↳" : ""}</button>)}
            {selected && (onAction || onFollowUp) && createPortal(
                <div ref={toolbar} class="readweave-answer-selection-actions readweave-selection-actions"
                    role="toolbar" aria-label="回答选区操作" style={actionPosition}>
                    {(onAction ? READWEAVE_SELECTION_ACTIONS : READWEAVE_SELECTION_ACTIONS.slice(0, 1)).map(action => (
                        <button type="button" key={action.contentType}
                            class="readweave-answer-follow-up"
                            aria-label={action.label}
                            onPointerDown={event => event.preventDefault()}
                            onClick={() => {
                                if (onAction) onAction(selected, action.contentType);
                                else onFollowUp?.(selected);
                                setSelected(undefined);
                            }}>
                            <i class={action.icon} aria-hidden="true" />
                            <span>{onAction ? action.label : followUpLabel}</span>
                        </button>
                    ))}
                </div>, document.body
            )}
        </div>
    );
}
