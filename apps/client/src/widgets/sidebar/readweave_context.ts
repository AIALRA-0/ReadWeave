import type { ReadWeaveContextFragment } from "@triliumnext/commons";

export const READWEAVE_CONTEXT_BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table,td,th,caption,figure,figcaption,div.mermaid,div.mermaid-diagram";

const structuralTags = new Set([ "P", "DIV", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "CAPTION", "FIGURE", "FIGCAPTION", "SUP", "SUB", "STRONG", "EM" ]);

/** Serialize source, not the duplicate accessibility/visual trees of rendered math. */
export function readWeaveContextText(node: Node | null | undefined): string {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.matches("script:not([type*='math/tex']),style,.readweave-anchor-actions,.readweave-selection-actions,.ck-widget__selection-handle")) return "";
    const tex = node.getAttribute("data-math") ?? node.getAttribute("data-tex")
        ?? (node.matches(".katex,.katex-display,math,.math-tex,.ck-math-tex") ? node.querySelector('annotation[encoding="application/x-tex"]')?.textContent : undefined);
    if (tex !== undefined && tex !== null) return `$${tex}$`;
    if (node.matches("script[type*='math/tex'],.math-tex")) return node.textContent ?? "";
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "IMG") return node.getAttribute("alt") ?? "";
    const content = Array.from(node.childNodes, readWeaveContextText).join("");
    if (!structuralTags.has(node.tagName)) return content;
    const attributes = [ "rowspan", "colspan", "scope", "headers", "id", "start", "value" ]
        .filter(name => node.hasAttribute(name))
        .map(name => ` ${name}="${node.getAttribute(name)!.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`).join("");
    const tag = node.tagName.toLowerCase();
    return `<${tag}${attributes}>${content}</${tag}>`;
}

export function collectReadWeaveFragments(root: HTMLElement, block: HTMLElement, selectedText: string): ReadWeaveContextFragment[] {
    // Keep a table together: a selected cell needs its row, headers and spans.
    const current = block.closest<HTMLElement>("table") ?? block;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(READWEAVE_CONTEXT_BLOCK_SELECTOR));
    const index = blocks.indexOf(block);
    const heading = blocks.slice(0, index + 1).findLast(item => /^H[1-6]$/.test(item.tagName));
    const fragments: ReadWeaveContextFragment[] = [
        { id: "selected", role: "selected", text: selectedText },
        { id: "current-block", role: "section", text: readWeaveContextText(current), distance: 0 }
    ];
    // Repeated text at different positions has different surrounding context.
    // Keep all positions; the server may reference exact duplicates losslessly.
    const add = (fragment: ReadWeaveContextFragment) => {
        if (!fragment.text.trim()) return;
        fragments.push(fragment);
    };
    if (heading) add({ id: "heading", role: "heading", text: readWeaveContextText(heading) });
    // Every root child is retained, including bare text and arbitrary containers.
    // Nested lists, tables and long sections stay intact, with no first-N limit.
    Array.from(root.childNodes).forEach((node, order) => add({
        id: `document-block-${order}`, role: "document", text: readWeaveContextText(node), distance: 20
    }));
    return fragments.filter(fragment => fragment.text.length > 0);
}
