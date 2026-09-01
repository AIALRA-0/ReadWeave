import type { ReadWeaveGenerationJob } from "@triliumnext/commons";

import { matchingReadWeaveAnchorElements, READWEAVE_RANGE_ANCHOR_SELECTOR } from "./readweave_anchor_dom.js";
import { readWeaveGenerationVisualState } from "./readweave_panel_state.js";

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre";

export const READWEAVE_GENERATION_STATUS_CLASSES = [
    "readweave-anchor-status-running",
    "readweave-anchor-status-unread",
    "readweave-anchor-status-paused",
    "readweave-anchor-status-error"
] as const;

export function readWeaveGenerationStatusClass(job: Pick<ReadWeaveGenerationJob, "status" | "unread" | "qualityState">): string | undefined {
    const state = readWeaveGenerationVisualState(job);
    return state ? `readweave-anchor-status-${state}` : undefined;
}

/**
 * Paint a just-started job synchronously, before anchor persistence and the job
 * creation request finish. This keeps the feedback attached to the exact range
 * the user clicked, including nested ranges, instead of decorating its block.
 */
export function applyReadWeaveGenerationVisual(root: HTMLElement, job: Pick<ReadWeaveGenerationJob, "anchorId" | "kind" | "status" | "unread" | "qualityState" | "updatedAt">): void {
    const elements = matchingReadWeaveAnchorElements(root, job.anchorId);
    if (!elements.length) return;

    const statusClass = readWeaveGenerationStatusClass(job);
    for (const element of elements) {
        element.classList.add(element.matches(READWEAVE_RANGE_ANCHOR_SELECTOR) ? "readweave-range-anchor" : "readweave-paragraph-anchor");
        element.classList.add(`readweave-anchor-callout-${job.kind === "term" ? "tip" : "note"}`);
        element.classList.toggle("readweave-anchor-draft", !!statusClass);
        element.classList.toggle("readweave-anchor-status", !!statusClass);
        element.dataset.readweaveJobUpdatedAt = job.updatedAt;
    }

    const groups = new Map<HTMLElement, HTMLElement[]>();
    for (const element of elements) {
        const block = element.closest<HTMLElement>(BLOCK_SELECTOR) ?? element;
        groups.set(block, [ ...(groups.get(block) ?? []), element ]);
    }
    for (const group of groups.values()) {
        for (const element of group) {
            element.classList.remove(...READWEAVE_GENERATION_STATUS_CLASSES);
        }
        const head = group.find(element => !!element.textContent?.trim()) ?? group[0];
        if (!head) continue;
        if (statusClass) head.classList.add(statusClass);
    }
}
