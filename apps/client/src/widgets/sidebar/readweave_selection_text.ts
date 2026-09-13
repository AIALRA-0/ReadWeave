/** Read a browser selection without concatenating KaTeX's visual and accessibility trees. */
export function readWeaveSelectionTextForRange(range: Range): string {
    if (range.collapsed) return "";
    const mathSelector = ".katex-display,.katex,.math-tex,.ck-math-tex,math,[data-math],[data-tex],script[type*='math/tex']";
    const common = range.commonAncestorContainer;
    const root = (common instanceof Element ? common : common.parentElement)?.closest(mathSelector) ?? common;
    const pieces: string[] = [];
    const visit = (node: Node): void => {
        if (!range.intersectsNode(node)) return;
        if (node instanceof Element) {
            if (node.matches(mathSelector)) {
                const source = node.getAttribute("data-math") ?? node.getAttribute("data-tex")
                    ?? node.querySelector('annotation[encoding="application/x-tex"]')?.textContent
                    ?? (node.matches(".math-tex,script[type*='math/tex']") ? node.textContent : undefined);
                if (source?.trim()) {
                    const raw = source.trim();
                    const tex = raw.startsWith("$$") && raw.endsWith("$$") ? raw.slice(2, -2)
                        : raw.startsWith("$") && raw.endsWith("$") ? raw.slice(1, -1)
                            : raw.startsWith("\\[") && raw.endsWith("\\]") ? raw.slice(2, -2)
                                : raw.startsWith("\\(") && raw.endsWith("\\)") ? raw.slice(2, -2) : raw;
                    const display = node.classList.contains("katex-display") || raw.startsWith("$$") || raw.startsWith("\\[");
                    pieces.push(display ? `$$${tex}$$` : `$${tex}$`);
                    return;
                }
            }
            if (node.matches("script,style,.katex-mathml,[aria-hidden='true']:not(.katex-html)")) return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const value = node.textContent ?? "";
            const start = node === range.startContainer ? range.startOffset : 0;
            const end = node === range.endContainer ? range.endOffset : value.length;
            if (end > start) pieces.push(value.slice(start, end));
            return;
        }
        for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return pieces.join("").replace(/\s+/gu, " ").trim();
}
