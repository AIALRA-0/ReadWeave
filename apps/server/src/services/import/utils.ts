"use strict";

import { parse } from "node-html-parser";

import { unescapeHtml } from "../utils.js";

function handleH1(content: string, title: string) {
    let isFirstH1Handled = false;
    const root = parse(content);

    for (const heading of root.querySelectorAll("h1")) {
        const text = unescapeHtml(heading.textContent);
        const convertedContent = `<h2>${heading.innerHTML}</h2>`;

        // strip away very first found h1 tag, if it matches the title
        if (!isFirstH1Handled) {
            isFirstH1Handled = true;
            heading.replaceWith(title.trim() === text.trim() ? "" : convertedContent);
        } else {
            heading.replaceWith(convertedContent);
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
