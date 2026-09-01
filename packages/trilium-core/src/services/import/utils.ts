import { parse } from "node-html-parser";

import { unescapeHtml } from "../utils/index.js";

function handleH1(content: string, title: string) {
    const root = parse(content);
    const firstH1 = root.querySelector("h1");

    // Reserve the first title-equivalent H1 for the note title. Compare text,
    // not markup, so inline formatting cannot bypass the equality check.
    if (firstH1 && title.trim() === unescapeHtml(firstH1.textContent).trim()) {
        firstH1.remove();
    }

    // Only shift the remaining hierarchy when content still contains an H1.
    // Mutating parsed elements avoids applying regular expressions to imported
    // HTML while preserving attributes and inline children.
    if (root.querySelector("h1")) {
        for (const heading of root.querySelectorAll("h1,h2,h3,h4,h5")) {
            const level = Number.parseInt(heading.rawTagName.slice(1), 10);
            heading.tagName = `h${Math.min(level + 1, 6)}`;
        }
    }

    return root.toString();
}

function extractHtmlTitle(content: string): string | null {
    const title = parse(content).querySelector("title");
    if (!title || title.innerHTML.includes("<")) {
        return null;
    }

    return title.innerHTML.trim();
}

export default {
    handleH1,
    extractHtmlTitle
};
