import { describe, expect, it } from "vitest";

import {
    clearReadWeaveProvisionalAnchors,
    exactReadWeaveAnchorIdForExcerpt,
    exactReadWeaveExcerptRange,
    forgetReadWeaveProvisionalAnchor,
    matchingReadWeaveAnchorElements,
    mostSpecificReadWeaveAnchorId,
    protectReadWeaveProvisionalAnchor,
    provisionalReadWeaveAnchorIds,
    rangesAreNestedOrDisjoint,
    readWeaveAnchorGroupRange,
    readWeaveAnchorIdsOf,
    releaseReadWeaveProvisionalAnchors,
    uniqueReadWeaveExcerptRange
} from "./readweave_anchor_dom.js";

describe("ReadWeave nested DOM anchors", () => {
    it("parses and matches every ID carried by an overlapping text run", () => {
        const root = document.createElement("div");
        root.innerHTML = '<span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="outer inner">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span>';
        const shared = root.children[1];

        expect(readWeaveAnchorIdsOf(shared)).toEqual([ "outer", "inner" ]);
        expect(matchingReadWeaveAnchorElements(root, "outer")).toHaveLength(3);
        expect(matchingReadWeaveAnchorElements(root, "inner")).toEqual([ shared ]);
    });

    it("targets the innermost known fragment on hover and click", () => {
        const shared = document.createElement("span");
        shared.dataset.readweaveRangeAnchorId = "outer inner";

        expect(mostSpecificReadWeaveAnchorId(shared, [
            { anchorId: "outer", excerpt: "BS-PDN-Last" },
            { anchorId: "inner", excerpt: "PDN" }
        ])).toBe("inner");
        expect(mostSpecificReadWeaveAnchorId(shared, [])).toBe("inner");
    });

    it("reuses only the anchor at the exact selected range", () => {
        const root = document.createElement("div");
        root.innerHTML = '<span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="outer inner">PDN</span><span data-readweave-range-anchor-id="outer"> -Last</span><span> PDN</span>';

        expect(exactReadWeaveAnchorIdForExcerpt(root, [ "outer", "inner" ], "PDN")).toBe("inner");
        expect(exactReadWeaveAnchorIdForExcerpt(root, [ "outer", "inner" ], "BS-PDN -Last")).toBe("outer");
        expect(exactReadWeaveAnchorIdForExcerpt(root, [], "PDN")).toBeUndefined();
    });

    it("locates the complete parent excerpt around a legacy child overwrite", () => {
        const block = document.createElement("p");
        block.innerHTML = '<span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="inner">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span>';
        document.body.append(block);
        const outerPieces = matchingReadWeaveAnchorElements(block, "outer");

        expect(exactReadWeaveExcerptRange(outerPieces, "p", " BS-PDN-Last ")?.toString()).toBe("BS-PDN-Last");
        block.remove();
    });

    it("does not guess when an oversized legacy anchor contains repeated excerpts", () => {
        const block = document.createElement("p");
        block.innerHTML = '<span data-readweave-range-anchor-id="legacy">PDN and PDN</span>';
        document.body.append(block);

        expect(exactReadWeaveExcerptRange([ block.firstElementChild as HTMLElement ], "p", "PDN")).toBeUndefined();
        block.remove();
    });

    it("allows containment but rejects crossing ranges", () => {
        const root = document.createElement("div");
        root.innerHTML = '<span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="outer inner">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span> tail';
        document.body.append(root);
        const outer = readWeaveAnchorGroupRange(root, "outer")!;
        const inner = readWeaveAnchorGroupRange(root, "inner")!;
        const nested = document.createRange();
        nested.selectNodeContents(root.children[1]);
        const crossing = document.createRange();
        crossing.setStart(root.children[1].firstChild!, 1);
        crossing.setEnd(root.children[2].firstChild!, 2);

        expect(rangesAreNestedOrDisjoint(outer, inner)).toBe(true);
        expect(rangesAreNestedOrDisjoint(inner, nested)).toBe(true);
        expect(rangesAreNestedOrDisjoint(crossing, inner)).toBe(false);
        root.remove();
    });

    it("protects a pending anchor through the save-to-job race and releases it only after durable ownership", () => {
        const root = document.createElement("div");
        protectReadWeaveProvisionalAnchor(root, "pending");

        expect(provisionalReadWeaveAnchorIds(root)).toEqual([ "pending" ]);
        releaseReadWeaveProvisionalAnchors(root, [ "different-anchor" ]);
        expect(provisionalReadWeaveAnchorIds(root)).toEqual([ "pending" ]);

        releaseReadWeaveProvisionalAnchors(root, [ "pending" ]);
        expect(provisionalReadWeaveAnchorIds(root)).toEqual([]);

        protectReadWeaveProvisionalAnchor(root, "discarded");
        forgetReadWeaveProvisionalAnchor(root, "discarded");
        expect(provisionalReadWeaveAnchorIds(root)).toEqual([]);

        protectReadWeaveProvisionalAnchor(root, "abandoned-on-navigation");
        clearReadWeaveProvisionalAnchors(root);
        expect(provisionalReadWeaveAnchorIds(root)).toEqual([]);
    });

    it("finds one exact orphaned-job excerpt for reload recovery but refuses ambiguous text", () => {
        const root = document.createElement("div");
        root.innerHTML = "<p>提升面向灵活3D堆叠ML加速器的布局性能</p><p>另一段只出现一次 BUFFALO</p>";
        document.body.append(root);

        expect(uniqueReadWeaveExcerptRange(root, "p", "3D堆叠ML")?.toString()).toBe("3D堆叠ML");
        expect(uniqueReadWeaveExcerptRange(root, "p", "BUFFALO")?.toString()).toBe("BUFFALO");

        root.insertAdjacentHTML("beforeend", "<p>重复的 BUFFALO 不应被猜测定位</p>");
        expect(uniqueReadWeaveExcerptRange(root, "p", "BUFFALO")).toBeUndefined();
        root.remove();
    });
});
