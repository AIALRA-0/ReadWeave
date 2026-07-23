import { parseReadWeaveAnchorIds } from "@triliumnext/ckeditor5";

export const READWEAVE_RANGE_ANCHOR_SELECTOR = "[data-readweave-range-anchor-id]";
export const READWEAVE_PARAGRAPH_ANCHOR_SELECTOR = "[data-readweave-anchor-id]";

export interface ReadWeaveAnchorDescriptor {
    anchorId: string;
    excerpt?: string;
}

export function readWeaveAnchorIdsOf(element: Element | null | undefined): string[] {
    if (!(element instanceof HTMLElement)) return [];
    return parseReadWeaveAnchorIds(element.dataset.readweaveRangeAnchorId || element.dataset.readweaveAnchorId);
}

export function matchingReadWeaveAnchorElements(root: HTMLElement, anchorId: string): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(`${READWEAVE_RANGE_ANCHOR_SELECTOR},${READWEAVE_PARAGRAPH_ANCHOR_SELECTOR}`))
        .filter(element => readWeaveAnchorIdsOf(element).includes(anchorId));
}

export function exactReadWeaveAnchorIdForExcerpt(root: HTMLElement, candidateIds: string[], excerpt: string): string | undefined {
    const normalizedExcerpt = normalizeAnchorText(excerpt);
    return candidateIds.find(anchorId => normalizeAnchorText(
        matchingReadWeaveAnchorElements(root, anchorId).map(element => element.textContent ?? "").join("")
    ) === normalizedExcerpt);
}

/** Locates the persisted excerpt in its block so legacy split/oversized ranges can be repaired. */
export function exactReadWeaveExcerptRange(
    elements: HTMLElement[],
    blockSelector: string,
    excerpt: string
): Range | undefined {
    const blocks = Array.from(new Set(elements.map(element => element.closest<HTMLElement>(blockSelector)).filter(Boolean)));
    const block = blocks.length === 1 ? blocks[0] : undefined;
    if (!block) return undefined;
    const normalized = normalizedTextWithRawOffsets(block.textContent ?? "");
    const needle = normalizeAnchorText(excerpt);
    if (!needle) return undefined;

    const candidates: Range[] = [];
    let normalizedStart = normalized.text.indexOf(needle);
    while (normalizedStart >= 0) {
        const normalizedEnd = normalizedStart + needle.length;
        const rawStart = normalized.starts[normalizedStart];
        const rawEnd = normalized.ends[normalizedEnd - 1];
        const candidate = rawStart !== undefined && rawEnd !== undefined
            ? domRangeForCharacterOffsets(block, rawStart, rawEnd)
            : undefined;
        if (candidate && elements.every(element => rangeStrictlyIntersectsElement(candidate, element))) candidates.push(candidate);
        normalizedStart = normalized.text.indexOf(needle, normalizedStart + 1);
    }
    return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * A shared text run may carry both a parent and a nested child ID. Prefer the
 * shortest known excerpt (the innermost range); the newest ID is the fallback
 * while a provisional child has not reached the server yet.
 */
export function mostSpecificReadWeaveAnchorId(
    element: Element | null | undefined,
    descriptors: ReadWeaveAnchorDescriptor[]
): string | undefined {
    const anchorIds = readWeaveAnchorIdsOf(element);
    if (anchorIds.length <= 1) return anchorIds[0];
    const lengths = new Map(descriptors
        .filter(descriptor => anchorIds.includes(descriptor.anchorId) && descriptor.excerpt?.trim())
        .map(descriptor => [ descriptor.anchorId, descriptor.excerpt!.replace(/\s+/g, " ").trim().length ]));
    return anchorIds.toSorted((left, right) => {
        const byLength = (lengths.get(left) ?? Number.POSITIVE_INFINITY) - (lengths.get(right) ?? Number.POSITIVE_INFINITY);
        if (Number.isFinite(byLength) && byLength !== 0) return byLength;
        return anchorIds.indexOf(right) - anchorIds.indexOf(left);
    })[0];
}

export function readWeaveAnchorGroupRange(root: HTMLElement, anchorId: string): Range | undefined {
    const elements = matchingReadWeaveAnchorElements(root, anchorId);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) return undefined;
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    return range;
}

export function rangesAreNestedOrDisjoint(left: Range, right: Range): boolean {
    const intersects = left.compareBoundaryPoints(Range.START_TO_END, right) > 0
        && left.compareBoundaryPoints(Range.END_TO_START, right) < 0;
    if (!intersects) return true;
    return rangeContainsRange(left, right) || rangeContainsRange(right, left);
}

function rangeContainsRange(outer: Range, inner: Range): boolean {
    return outer.compareBoundaryPoints(Range.START_TO_START, inner) <= 0
        && outer.compareBoundaryPoints(Range.END_TO_END, inner) >= 0;
}

function normalizeAnchorText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function normalizedTextWithRawOffsets(value: string): { text: string; starts: number[]; ends: number[] } {
    let text = "";
    const starts: number[] = [];
    const ends: number[] = [];
    let whitespaceStart: number | undefined;
    for (let index = 0; index < value.length; index++) {
        if (/\s/.test(value[index])) {
            if (text && whitespaceStart === undefined) whitespaceStart = index;
            continue;
        }
        if (whitespaceStart !== undefined) {
            text += " ";
            starts.push(whitespaceStart);
            ends.push(index);
            whitespaceStart = undefined;
        }
        text += value[index];
        starts.push(index);
        ends.push(index + 1);
    }
    return { text, starts, ends };
}

function domRangeForCharacterOffsets(element: HTMLElement, start: number, end: number): Range | undefined {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    if (!nodes.length) return undefined;
    let traversed = 0;
    let startPoint: { node: Text; offset: number } | undefined;
    let endPoint: { node: Text; offset: number } | undefined;
    for (const node of nodes) {
        const next = traversed + node.data.length;
        if (!startPoint && start >= traversed && start <= next) startPoint = { node, offset: start - traversed };
        if (!endPoint && end >= traversed && end <= next) endPoint = { node, offset: end - traversed };
        traversed = next;
    }
    if (!startPoint || !endPoint) return undefined;
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
}

function rangeStrictlyIntersectsElement(range: Range, element: Element): boolean {
    const elementRange = document.createRange();
    elementRange.selectNodeContents(element);
    return range.compareBoundaryPoints(Range.START_TO_END, elementRange) > 0
        && range.compareBoundaryPoints(Range.END_TO_START, elementRange) < 0;
}
