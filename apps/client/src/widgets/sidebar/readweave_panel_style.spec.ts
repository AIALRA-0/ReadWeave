import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "ReadWeavePanel.css"), "utf8");

describe("ReadWeave generation monitor disclosure", () => {
    it("keeps each issue list folded in a pinned monitor until that issue is hovered or focused", () => {
        expect(css).toContain(".readweave-issue-group:hover ul");
        expect(css).toContain(".readweave-issue-group:focus ul");
        expect(css).not.toContain(".readweave-generation-monitor.pinned .readweave-issue-group ul");
    });

    it("keeps a job error folded in a pinned monitor until that error is hovered or focused", () => {
        expect(css).toContain(".readweave-monitor-error:hover > p");
        expect(css).toContain(".readweave-monitor-error:focus > p");
        expect(css).not.toContain(".readweave-generation-monitor.pinned .readweave-monitor-error > p");
    });

    it("renders finished answers as spaced natural paragraphs instead of a read-only textarea", () => {
        expect(css).toContain(".readweave-readable-body p + p");
        expect(css).toContain("line-height: 1.68");
        expect(css).toContain("background: transparent");
        expect(css).not.toContain("textarea.readweave-body-readonly");
    });
});
