import type { ReadWeaveQuestionContract } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { search, read } = vi.hoisted(() => ({ search: vi.fn(), read: vi.fn() }));
vi.mock("./readweave_search.js", () => ({
    searchReadWeaveEvidence: search,
    readReadWeavePageWithJina: read,
}));
import {
    readWeaveEvidenceWindow,
    readWeaveMissingNamingFacts,
    researchReadWeaveEvidence,
} from "./readweave_research.js";
const contract = {
    normalizedQuestion: "“Lumen”是什么？",
    searchQueries: ["Lumen official", "Lumen origin"],
} as ReadWeaveQuestionContract;
const result = (snippet: string, cost = 0.0072) => ({
    sources: [
        {
            url: "https://example.org/lumen",
            title: "Lumen",
            snippet,
            provider: "Serper",
            score: 100,
        },
    ],
    warnings: [],
    cacheHit: false,
    searchCostCny: cost,
});
describe("bounded targeted research", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        search.mockResolvedValue(result("Lumen is a software library"));
        read.mockResolvedValue("");
    });
    it("keeps the relevant fact beyond the first page window", () => {
        const text = `${"Preface ".repeat(1000)  }Lumen was named after a light unit`;
        expect(readWeaveEvidenceWindow(text, "Lumen origin")).toContain("named after a light unit");
    });
    it("does not infer an acronym from a publication title", () => {
        expect(
            readWeaveMissingNamingFacts([
                { excerpt: "Lumen: A Low-latency Universal Memory ENgine" },
            ] as never),
        ).toHaveLength(2);
    });
    it("stops within the available budget, not after twenty arbitrary calls", async () => {
        const r = await researchReadWeaveEvidence(contract, "context", 0.015, true, () => {});
        expect(search).toHaveBeenCalledTimes(2);
        expect(r.audit.stopReason).toBe("budget");
        expect(r.searchCostCny).toBe(0.0144);
        expect(r.sources).toHaveLength(1);
    });
    it("uses anonymous page extraction without consuming paid Jina tokens", async () => {
        await researchReadWeaveEvidence(contract, "", 0.02, false, () => {});
        expect(read).toHaveBeenCalledWith("https://example.org/lumen", {
            signal: undefined,
            anonymous: true,
        });
        expect(search).toHaveBeenCalledTimes(1);
    });
    it("counts cache hits separately from effective queries", async () => {
        search.mockResolvedValue({
            ...result("Lumen is not an acronym. Lumen is named after a light unit", 0),
            cacheHit: true,
        });
        const r = await researchReadWeaveEvidence(contract, "", 0.05, true, () => {});
        expect(r.audit.queryCount).toBe(0);
        expect(r.audit.cacheHits).toBe(1);
        expect(r.audit.stopReason).toBe("sufficient");
    });
    it("does not spend after cancellation", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            researchReadWeaveEvidence(contract, "", 0.07, true, () => {}, controller.signal),
        ).rejects.toThrow();
        expect(search).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
    });
    it("keeps snippets when page reading fails", async () => {
        read.mockRejectedValue(new Error("HTTP 429"));
        const r = await researchReadWeaveEvidence(contract, "", 0.02, false, () => {});
        expect(r.sources[0].excerpt).toBe("Lumen is a software library");
        expect(r.warnings[0]).toContain("429");
    });
    it("never exceeds twenty effective research actions", async () => {
        const r = await researchReadWeaveEvidence(
            { ...contract, searchQueries: Array.from({ length: 30 }, (_, i) => `query ${i}`) },
            "",
            0.1,
            true,
            () => {},
        );
        expect(r.audit.queryCount + r.audit.pageReadCount).toBeLessThanOrEqual(20);
        expect(r.searchCostCny).toBeLessThanOrEqual(0.1);
    });
});
