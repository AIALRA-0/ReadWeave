import { describe, expect, it } from "vitest";

import css from "./ReadWeavePanel.css?inline";

describe("ReadWeave generation monitor disclosure", () => {
    it("keeps each issue list folded in a pinned monitor until that issue is hovered or focused", () => {
        expect(css).toContain(".readweave-issue-group:hover ul");
        expect(css).toContain(".readweave-issue-group:focus ul");
        expect(css).not.toContain(".readweave-generation-monitor.pinned .readweave-issue-group ul");
    });

    it("keeps a job error folded in a pinned monitor until that error is hovered or focused", () => {
        expect(css).toMatch(/\.readweave-monitor-error:hover\s*>\s*p/u);
        expect(css).toMatch(/\.readweave-monitor-error:focus\s*>\s*p/u);
        expect(css).not.toMatch(/\.readweave-generation-monitor\.pinned\s+\.readweave-monitor-error\s*>\s*p/u);
    });

    it("renders finished answers as spaced natural paragraphs instead of a read-only textarea", () => {
        expect(css).toMatch(/\.readweave-readable-body\s+p\s*\+\s*p/u);
        expect(css).toMatch(/line-height:\s*1\.68/u);
        expect(css).toMatch(/\.readweave-readable-body\s*\{[^}]*background:\s*(?:transparent|#0000|0\s+0|none)/su);
        expect(css).not.toContain("textarea.readweave-body-readonly");
    });

    it("keeps saved-entry actions compact and lets narrow titles use their own row", () => {
        expect(css).toMatch(/min-width:\s*26px\s*!important/u);
        expect(css).toMatch(/max-width:\s*26px\s*!important/u);
        expect(css).toMatch(/@container\s*\(\s*width\s*<=\s*360px\s*\)/u);
        expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
    });

    it("keeps displayed formulas readable inside a narrow sidebar", () => {
        expect(css).toContain(".readweave-readable-body .katex-display");
        expect(css).toMatch(/(?:overflow-x:\s*auto|overflow:\s*auto\s+hidden)/u);
    });

    it("keeps every answer heading close to body size without affecting article headings", () => {
        expect(css).toMatch(/\.readweave-readable-body\s+:is\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*font-size:\s*1rem/su);
        expect(css).toMatch(/\.readweave-readable-body\s*\{[^}]*font-size:\s*(?:0?\.96rem)/su);
        expect(css).not.toMatch(/(?:^|\n)\s*:is\(h1, h2, h3, h4, h5, h6\)\s*\{/u);
    });

    it("keeps the external-search checkbox on one left-aligned row", () => {
        expect(css).toMatch(/\.readweave-editor\s+label\.readweave-external-search-options\s*\{[^}]*flex-wrap:\s*nowrap[^}]*justify-content:\s*flex-start/su);
        expect(css).toMatch(/\.readweave-question-optimization\s*\{[^}]*align-items:\s*center\s*!important/su);
    });

    it("keeps the settings button on the left", () => {
        expect(css).toMatch(/\.readweave-panel-toolbar\s*\{[^}]*justify-content:\s*flex-start/su);
    });
});
