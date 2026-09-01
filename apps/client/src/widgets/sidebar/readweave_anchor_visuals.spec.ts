import type { ReadWeaveGenerationJob } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { applyReadWeaveGenerationVisual } from "./readweave_anchor_visuals.js";

function job(overrides: Partial<ReadWeaveGenerationJob> = {}): ReadWeaveGenerationJob {
    return {
        jobId: "job-1",
        draftId: "draft-1",
        stateVersion: 1,
        articleId: "article-1",
        anchorId: "inner",
        anchorType: "range",
        kind: "question",
        title: "问题",
        sourceExcerpt: "3D堆叠ML",
        status: "queued",
        qualityState: "verified",
        harnessVersion: "legacy",
        evidenceState: "not-checked",
        unresolvedIssues: [],
        issues: [],
        unread: false,
        progress: [],
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        ...overrides
    };
}

describe("ReadWeave exact-range generation visuals", () => {
    it("shows an immediate running underline and indicator on only the clicked nested range", () => {
        const root = document.createElement("div");
        root.innerHTML = '<p><span data-readweave-range-anchor-id="outer">灵活</span><span data-readweave-range-anchor-id="outer inner">3D堆叠ML</span><span data-readweave-range-anchor-id="outer">加速器</span></p>';
        const [ before, exact, after ] = Array.from(root.querySelectorAll<HTMLElement>("span"));

        applyReadWeaveGenerationVisual(root, job());

        expect(exact.classList).toContain("readweave-range-anchor");
        expect(exact.classList).toContain("readweave-anchor-draft");
        expect(exact.classList).toContain("readweave-anchor-status-running");
        expect(before.classList).not.toContain("readweave-anchor-draft");
        expect(after.classList).not.toContain("readweave-anchor-draft");
    });

    it("keeps failed and unread jobs visible but returns a viewed result to hover-only styling", () => {
        const root = document.createElement("div");
        root.innerHTML = '<p><span data-readweave-range-anchor-id="inner">3D堆叠ML</span></p>';
        const exact = root.querySelector<HTMLElement>("span")!;

        applyReadWeaveGenerationVisual(root, job({ status: "failed" }));
        expect(exact.classList).toContain("readweave-anchor-draft");
        expect(exact.classList).toContain("readweave-anchor-status-error");

        applyReadWeaveGenerationVisual(root, job({ status: "ready-for-review", unread: true, updatedAt: "2026-07-22T00:00:01.000Z" }));
        expect(exact.classList).toContain("readweave-anchor-draft");
        expect(exact.classList).toContain("readweave-anchor-status-unread");

        applyReadWeaveGenerationVisual(root, job({ status: "ready-for-review", unread: false, updatedAt: "2026-07-22T00:00:02.000Z" }));
        expect(exact.classList).not.toContain("readweave-anchor-draft");
        expect(exact.classList).not.toContain("readweave-anchor-status");
    });

    it("underlines every exact fragment of one job but renders only one status indicator", () => {
        const root = document.createElement("div");
        root.innerHTML = '<p><span data-readweave-range-anchor-id="outer">灵活</span><span data-readweave-range-anchor-id="outer inner">3D堆叠ML</span><span data-readweave-range-anchor-id="outer">加速器</span></p>';
        const fragments = Array.from(root.querySelectorAll<HTMLElement>("span"));

        applyReadWeaveGenerationVisual(root, job({ anchorId: "outer", sourceExcerpt: "灵活3D堆叠ML加速器" }));

        expect(fragments.every(element => element.classList.contains("readweave-anchor-status"))).toBe(true);
        expect(fragments.filter(element => element.classList.contains("readweave-anchor-status-running"))).toEqual([ fragments[0] ]);

        applyReadWeaveGenerationVisual(root, job({
            anchorId: "outer",
            sourceExcerpt: "灵活3D堆叠ML加速器",
            status: "ready-for-review",
            unread: false,
            updatedAt: "2026-07-22T00:00:02.000Z"
        }));

        expect(fragments.some(element => element.classList.contains("readweave-anchor-status"))).toBe(false);
        expect(fragments.some(element => element.classList.contains("readweave-anchor-draft"))).toBe(false);
        expect(fragments.some(element => element.classList.contains("readweave-anchor-status-running"))).toBe(false);
    });

    it("uses the term color for an immediately queued definition", () => {
        const root = document.createElement("div");
        root.innerHTML = '<p><span data-readweave-range-anchor-id="inner">3D堆叠ML</span></p>';
        const exact = root.querySelector<HTMLElement>("span")!;

        applyReadWeaveGenerationVisual(root, job({ kind: "term" }));

        expect(exact.classList).toContain("readweave-anchor-callout-tip");
        expect(exact.classList).toContain("readweave-anchor-status-running");
    });
});
