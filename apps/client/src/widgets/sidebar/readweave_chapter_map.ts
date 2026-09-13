import type { ReadWeaveAnchorSummary, ReadWeaveResolvedEntry } from "@triliumnext/commons";

import { READWEAVE_CONTEXT_BLOCK_SELECTOR } from "./readweave_context.js";

export interface ReadWeaveMapNode {
    id: string;
    topic: string;
    children: ReadWeaveMapNode[];
    root?: boolean;
}

export function buildReadWeaveChapterMap(root: HTMLElement, title: string, summaries: ReadWeaveAnchorSummary[]): ReadWeaveMapNode {
    const map: ReadWeaveMapNode = { id: "readweave-article", topic: title, root: true, children: [] };
    const headings = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
    const headingNodes = new Map<HTMLElement, ReadWeaveMapNode>();
    const stack: Array<{ level: number; node: ReadWeaveMapNode }> = [ { level: 0, node: map } ];
    for (const [index, heading] of headings.entries()) {
        const level = Number(heading.tagName.slice(1));
        while (stack.length > 1 && stack.at(-1)!.level >= level) stack.pop();
        const node = { id: `chapter:${index}`, topic: heading.textContent?.trim() || `未命名章节 ${index + 1}`, children: [] };
        stack.at(-1)!.node.children.push(node);
        stack.push({ level, node });
        headingNodes.set(heading, node);
    }
    const unsectioned: ReadWeaveMapNode = { id: "chapter:unsectioned", topic: "未分节内容", children: [] };
    const unlocated: ReadWeaveMapNode = { id: "chapter:unlocated", topic: "待重新绑定的内容", children: [] };
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(READWEAVE_CONTEXT_BLOCK_SELECTOR));
    const byLinkId = new Map<string, ReadWeaveMapNode>();
    const entryParents = new Map<string, ReadWeaveMapNode>();
    for (const summary of summaries) {
        const anchored = Array.from(root.querySelectorAll<HTMLElement>("[data-readweave-range-anchor-id],[data-readweave-anchor-id]"))
            .find(element => [ element.dataset.readweaveRangeAnchorId, element.dataset.readweaveAnchorId ]
                .some(ids => ids?.split(/\s+/u).includes(summary.anchorId)));
        const block = summary.sourceLocator && blocks[summary.sourceLocator.blockIndex]
            || anchored?.closest<HTMLElement>(READWEAVE_CONTEXT_BLOCK_SELECTOR);
        const heading = block && headings.findLast(candidate => candidate === block
            || !!(candidate.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
        const section = heading ? headingNodes.get(heading)! : block ? unsectioned : unlocated;
        for (const entry of summary.entries) {
            if (byLinkId.has(entry.linkId)) continue;
            const node: ReadWeaveMapNode = {
                id: `entry:${entry.linkId}`,
                topic: `${contentLabel(entry)} · ${entry.title}`,
                children: []
            };
            byLinkId.set(entry.linkId, node);
            entryParents.set(entry.linkId, section);
        }
    }
    const attached = new Set<string>();
    for (const summary of summaries) for (const entry of summary.entries) {
        if (attached.has(entry.linkId)) continue;
        attached.add(entry.linkId);
        const node = byLinkId.get(entry.linkId);
        if (!node) continue;
        const parent = entry.parentLinkId ? byLinkId.get(entry.parentLinkId) : undefined;
        (parent ?? entryParents.get(entry.linkId) ?? unlocated).children.push(node);
    }
    if (unsectioned.children.length) map.children.push(unsectioned);
    if (unlocated.children.length) map.children.push(unlocated);
    return map;
}

function contentLabel(entry: ReadWeaveResolvedEntry): string {
    switch (entry.contentType ?? (entry.kind === "term" ? "definition" : "problem")) {
        case "definition": return "定义";
        case "annotation": return "注解";
        case "key-point": return "总结";
        case "note": return "笔记";
        default: return "问题";
    }
}
