import { parseReadWeaveAnchorIds } from "@triliumnext/ckeditor5";
import type { ReadWeaveSourceLocator } from "@triliumnext/commons";

export const READWEAVE_RANGE_ANCHOR_SELECTOR = "[data-readweave-range-anchor-id]";
export const READWEAVE_PARAGRAPH_ANCHOR_SELECTOR = "[data-readweave-anchor-id]";
export const READWEAVE_RUNTIME_ANCHOR_SELECTOR = "[data-readweave-runtime-only=\"1\"]";
export const READWEAVE_CONTENT_ROOT_SELECTOR = "[data-readweave-content-root]";
const PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT = new WeakMap<HTMLElement, Set<string>>();

export interface ReadWeaveAnchorDescriptor {
    anchorId: string;
    excerpt?: string;
}

export type ReadWeaveSourceLocatorInput = Pick<ReadWeaveSourceLocator, "blockIndex" | "prefix" | "suffix">;

export function readWeaveAnchorIdsOf(element: Element | null | undefined): string[] {
    if (!(element instanceof HTMLElement)) return [];
    return parseReadWeaveAnchorIds(element.dataset.readweaveRangeAnchorId || element.dataset.readweaveAnchorId);
}

export function matchingReadWeaveAnchorElements(root: HTMLElement, anchorId: string): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(`${READWEAVE_RANGE_ANCHOR_SELECTOR},${READWEAVE_PARAGRAPH_ANCHOR_SELECTOR}`))
        .filter(element => readWeaveAnchorIdsOf(element).includes(anchorId));
}

/** Protect a newly created model range until a server job or saved entry owns it. */
export function protectReadWeaveProvisionalAnchor(root: HTMLElement, anchorId: string): void {
    const anchorIds = PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT.get(root) ?? new Set<string>();
    anchorIds.add(anchorId);
    PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT.set(root, anchorIds);
}

export function provisionalReadWeaveAnchorIds(root: HTMLElement): string[] {
    return [ ...(PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT.get(root) ?? []) ];
}

export function releaseReadWeaveProvisionalAnchors(root: HTMLElement, durableAnchorIds: Iterable<string>): void {
    const provisional = PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT.get(root);
    if (!provisional) return;
    for (const anchorId of durableAnchorIds) provisional.delete(anchorId);
    if (!provisional.size) PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT.delete(root);
}

export function forgetReadWeaveProvisionalAnchor(root: HTMLElement, anchorId: string): void {
    releaseReadWeaveProvisionalAnchors(root, [ anchorId ]);
}

export function clearReadWeaveProvisionalAnchors(root: HTMLElement): void {
    PROVISIONAL_READWEAVE_ANCHORS_BY_ROOT.delete(root);
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

/** Locate one unambiguous excerpt when a persisted job outlived its DOM mark. */
export function uniqueReadWeaveExcerptRange(root: HTMLElement, blockSelector: string, excerpt: string): Range | undefined {
    return uniqueReadWeaveExcerptRangeWithLocator(root, blockSelector, excerpt);
}

/**
 * Locate an excerpt using the persisted block context when available. The
 * contextual pass prevents two identical terms in different paragraphs from
 * being treated as interchangeable; the final pass remains compatible with
 * legacy jobs that have no locator.
 */
export function uniqueReadWeaveExcerptRangeWithLocator(
    root: HTMLElement,
    blockSelector: string,
    excerpt: string,
    locator?: ReadWeaveSourceLocatorInput
): Range | undefined {
    const needle = normalizeAnchorText(excerpt);
    if (!needle) return undefined;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(blockSelector))
        .filter(block => !block.querySelector(blockSelector));
    const candidatesIn = (candidateBlocks: Array<{ block: HTMLElement; index: number }>, useContext: boolean): Range[] => {
        const candidates: Range[] = [];
        for (const { block } of candidateBlocks) {
            const normalized = normalizedTextWithRawOffsets(block.textContent ?? "");
            let normalizedStart = normalized.text.indexOf(needle);
            while (normalizedStart >= 0) {
                const normalizedEnd = normalizedStart + needle.length;
                if (useContext && locator && !locatorContextMatches(normalized.text, normalizedStart, normalizedEnd, locator)) {
                    normalizedStart = normalized.text.indexOf(needle, normalizedStart + 1);
                    continue;
                }
                const rawStart = normalized.starts[normalizedStart];
                const rawEnd = normalized.ends[normalizedEnd - 1];
                const candidate = rawStart !== undefined && rawEnd !== undefined
                    ? domRangeForCharacterOffsets(block, rawStart, rawEnd)
                    : undefined;
                if (candidate) candidates.push(candidate);
                normalizedStart = normalized.text.indexOf(needle, normalizedStart + 1);
            }
        }
        return candidates;
    };

    if (locator && Number.isInteger(locator.blockIndex) && locator.blockIndex >= 0) {
        const contextualBlock = blocks[locator.blockIndex];
        if (contextualBlock) {
            const contextual = candidatesIn([ { block: contextualBlock, index: locator.blockIndex } ], true);
            if (contextual.length === 1) return contextual[0];
        }
    }

    const candidates = candidatesIn(blocks.map((block, index) => ({ block, index })), false);
    return candidates.length === 1 ? candidates[0] : undefined;
}

/** Return the normalized text blocks used by source locators and context. */
export function readWeaveLeafBlocks(root: HTMLElement, blockSelector: string): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(blockSelector))
        .filter(block => !block.querySelector(blockSelector));
}

/**
 * Build a content-only locator for a native DOM range. The caller is expected
 * to have already restricted the range to one leaf block.
 */
export function readWeaveSourceLocatorForRange(
    root: HTMLElement,
    block: HTMLElement,
    range: Range,
    blockSelector: string
): ReadWeaveSourceLocator | undefined {
    const blocks = readWeaveLeafBlocks(root, blockSelector);
    const blockIndex = blocks.indexOf(block);
    if (blockIndex < 0 || range.collapsed || !rangeIsContainedBy(block, range)) return undefined;

    const normalized = normalizedTextWithRawOffsets(block.textContent ?? "");
    const rawStart = rawOffsetBeforeBoundary(block, range.startContainer, range.startOffset);
    const rawEnd = rawOffsetBeforeBoundary(block, range.endContainer, range.endOffset);
    if (rawStart === undefined || rawEnd === undefined || rawEnd <= rawStart) return undefined;

    const startOffset = normalized.starts.findIndex((_value, index) => normalized.ends[index] > rawStart);
    const endOffset = normalized.starts.findIndex((_value, index) => normalized.starts[index] >= rawEnd);
    const resolvedEnd = endOffset < 0 ? normalized.text.length : endOffset;
    if (startOffset < 0 || resolvedEnd <= startOffset) return undefined;

    const excerpt = normalizeAnchorText(range.toString());
    if (!excerpt || normalized.text.slice(startOffset, resolvedEnd) !== excerpt) return undefined;
    return {
        version: 1,
        blockIndex,
        startOffset,
        endOffset: resolvedEnd,
        prefix: normalized.text.slice(Math.max(0, startOffset - 64), startOffset),
        suffix: normalized.text.slice(resolvedEnd, resolvedEnd + 64)
    };
}

/** Restore a range using exact locator offsets and its excerpt guard. */
export function readWeaveRangeForSourceLocator(
    root: HTMLElement,
    blockSelector: string,
    locator: ReadWeaveSourceLocator,
    excerpt: string
): Range | undefined {
    if (locator.version !== 1 || !Number.isInteger(locator.blockIndex) || locator.blockIndex < 0
        || !Number.isInteger(locator.startOffset) || !Number.isInteger(locator.endOffset)
        || locator.startOffset < 0 || locator.endOffset < locator.startOffset
        || typeof locator.prefix !== "string" || typeof locator.suffix !== "string") return undefined;
    const block = readWeaveLeafBlocks(root, blockSelector)[locator.blockIndex];
    if (!block) return undefined;
    const normalized = normalizedTextWithRawOffsets(block.textContent ?? "");
    if (locator.endOffset > normalized.text.length
        || normalizeAnchorText(excerpt) !== normalized.text.slice(locator.startOffset, locator.endOffset)
        || !locatorContextMatches(normalized.text, locator.startOffset, locator.endOffset, locator)) return undefined;
    const rawStart = normalized.starts[locator.startOffset];
    const rawEnd = normalized.ends[locator.endOffset - 1];
    return rawStart === undefined || rawEnd === undefined
        ? undefined
        : domRangeForCharacterOffsets(block, rawStart, rawEnd);
}

/** Wrap a read-only range in a runtime-only marker without changing note HTML. */
export function applyReadWeaveRuntimeRangeAnchor(root: HTMLElement, range: Range, anchorId: string): HTMLElement | undefined {
    if (range.collapsed || !root.contains(range.commonAncestorContainer)) return undefined;
    const marker = document.createElement("span");
    marker.dataset.readweaveRangeAnchorId = anchorId;
    marker.dataset.readweaveRuntimeOnly = "1";
    marker.className = "readweave-runtime-range-anchor";
    const contents = range.extractContents();
    marker.append(contents);
    range.insertNode(marker);
    return marker;
}

/** Remove runtime-only markers while preserving their rendered children. */
export function removeReadWeaveRuntimeRangeAnchors(root: HTMLElement, anchorId?: string): void {
    root.querySelectorAll<HTMLElement>(READWEAVE_RUNTIME_ANCHOR_SELECTOR).forEach(marker => {
        if (anchorId && !readWeaveAnchorIdsOf(marker).includes(anchorId)) return;
        const parent = marker.parentNode;
        if (!parent) return;
        while (marker.firstChild) parent.insertBefore(marker.firstChild, marker);
        marker.remove();
    });
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

function rangeIsContainedBy(block: HTMLElement, range: Range): boolean {
    const blockRange = document.createRange();
    blockRange.selectNodeContents(block);
    return blockRange.compareBoundaryPoints(Range.START_TO_START, range) <= 0
        && blockRange.compareBoundaryPoints(Range.END_TO_END, range) >= 0;
}

function rawOffsetBeforeBoundary(block: HTMLElement, container: Node, offset: number): number | undefined {
    if (!block.contains(container) && container !== block) return undefined;
    try {
        const prefix = document.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(container, offset);
        return prefix.toString().length;
    } catch {
        return undefined;
    }
}

function locatorContextMatches(text: string, start: number, end: number, locator: ReadWeaveSourceLocatorInput): boolean {
    const before = text.slice(0, start);
    const after = text.slice(end);
    // Server-side validation may normalize legacy locators by trimming the
    // whitespace immediately around the selected text. Compare the complete
    // surrounding text so that this normalization does not shift the prefix
    // window and reject an otherwise exact locator.
    const prefix = locator.prefix.replace(/\s+$/u, "");
    const suffix = locator.suffix.replace(/^\s+/u, "");
    const prefixMatches = before.endsWith(locator.prefix)
        || before.trimEnd().endsWith(prefix);
    const suffixMatches = after.startsWith(locator.suffix)
        || after.trimStart().startsWith(suffix);
    return prefixMatches && suffixMatches;
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
