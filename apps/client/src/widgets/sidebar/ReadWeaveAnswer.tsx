import { KATEX_MACROS, type ReadWeaveAnswerSelection } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

const markdown = new Marked({ breaks: true, gfm: true });

interface ReadWeaveRenderedUnit {
    node: Node;
    start: number;
    end: number;
    positions?: number[];
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
            const candidates = [ `$$${formula}$$`, `$${formula}$` ]
                .map(source => ({ source, index: body.indexOf(source, sourceCursor) }))
                .filter(candidate => candidate.index >= 0)
                .sort((left, right) => left.index - right.index);
            const candidate = candidates[0];
            if (candidate) {
                units.push({
                    node,
                    start: candidate.index,
                    end: candidate.index + candidate.source.length,
                });
                sourceCursor = candidate.index + candidate.source.length;
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
