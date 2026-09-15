import { KATEX_MACROS } from "@triliumnext/commons";
import { useLayoutEffect, useRef } from "preact/hooks";

export function hasReadWeaveQuestionMath(value: string): boolean {
    return /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/u.test(value);
}

/** Keep the stored question as editable Markdown while showing its formulas as math. */
export function ReadWeaveQuestionText({ text }: { text: string }) {
    const root = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        // Rebuild from the unmodified source before every render: KaTeX replaces
        // text nodes, so a subsequent question must not inherit stale math DOM.
        element.textContent = text;
        element.style.visibility = "";
        if (!hasReadWeaveQuestionMath(text)) return;
        // The raw TeX is editing data, not the reader-facing question.
        element.style.visibility = "hidden";
        let cancelled = false;
        void import("../../services/math.js").then(({ renderMathInElement }) => {
            if (!cancelled && element.isConnected) renderMathInElement(element, {
                trust: false,
                throwOnError: false,
                macros: { ...KATEX_MACROS },
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false },
                ],
            });
        }).catch(() => {
            // A renderer-loading failure must not leave the question invisible.
        }).finally(() => {
            if (!cancelled && element.isConnected) element.style.visibility = "";
        });
        return () => { cancelled = true; };
    }, [text]);
    return <span ref={root} class="readweave-rendered-question-text" />;
}
