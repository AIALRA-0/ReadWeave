import { KATEX_MACROS, type ReadWeaveAnswerSelection } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

const markdown = new Marked({ breaks: true, gfm: true });

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
    const decoder = document.createElement("textarea");
    const positions: number[] = [];
    let decoded = "";
    for (let offset = 0; offset < body.length; ) {
        const entity = body.slice(offset).match(/^&(?:#x[\da-f]+|#\d+|[a-z]+);/iu)?.[0];
        decoder.innerHTML = entity ?? "";
        const text = entity ? decoder.value : body[offset];
        for (let index = 0; index < text.length; index++) positions.push(offset);
        decoded += text;
        offset += entity?.length ?? 1;
    }
    positions.push(body.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    let start: number | undefined;
    let end: number | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        const index = decoded.indexOf(text, cursor);
        if (index < 0) {
            if (node === range.startContainer || node === range.endContainer) return;
            continue;
        }
        if (node === range.startContainer) start = positions[index + range.startOffset];
        if (node === range.endContainer) end = positions[index + range.endOffset];
        cursor = index + text.length;
    }
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
}: {
    body: string;
    className?: string;
    id?: string;
    labelledBy?: string;
    testId?: string;
    revision?: number;
    followUpLabel?: string;
    onFollowUp?: (selection: ReadWeaveAnswerSelection) => void;
}) {
    const root = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<ReadWeaveAnswerSelection>();
    const html = useMemo(
        () =>
            DOMPurify.sanitize(markdown.parse(body) as string, {
                FORBID_TAGS: ["script", "style", "iframe", "object", "form", "input", "button"],
                FORBID_ATTR: ["style"],
            }),
        [body],
    );
    useEffect(() => setSelected(undefined), [body, revision]);
    useLayoutEffect(() => {
        const container = root.current;
        if (!container) return;
        for (const link of container.querySelectorAll("a")) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        }
        if (!body.includes("$")) return;
        let cancelled = false;
        void import("../../services/math.js").then(({ renderMathInElement }) => {
            if (!cancelled && container.isConnected)
                renderMathInElement(container, {
                    trust: false,
                    throwOnError: false,
                    macros: { ...KATEX_MACROS },
                    delimiters: [
                        { left: "$$", right: "$$", display: true },
                        { left: "$", right: "$", display: false },
                    ],
                });
        });
        return () => {
            cancelled = true;
        };
    }, [html, body]);
    const capture = useCallback(() => {
        const selection = window.getSelection();
        if (!root.current || !selection?.rangeCount) return;
        const value = readWeaveAnswerSelection(
            root.current,
            body,
            selection.getRangeAt(0),
            revision,
        );
        if (value) setSelected(value);
    }, [body, revision]);
    useEffect(() => {
        let frame = 0;
        const changed = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(capture);
        };
        document.addEventListener("selectionchange", changed);
        return () => {
            document.removeEventListener("selectionchange", changed);
            cancelAnimationFrame(frame);
        };
    }, [capture]);
    return (
        <div class="readweave-answer-container">
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
            {selected && onFollowUp && (
                <button
                    type="button"
                    class="btn btn-sm readweave-answer-follow-up"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                        onFollowUp(selected);
                        setSelected(undefined);
                    }}
                >
                    {followUpLabel}
                </button>
            )}
        </div>
    );
}
