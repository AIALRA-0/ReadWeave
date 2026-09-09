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
    readWeaveNamingRequirements,
    readWeaveNamingSourceGuidance,
    readWeaveWritingEvidence,
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
    it("does not turn an exclusion into an expensive origin requirement", () => {
        expect(readWeaveNamingRequirements("XPT 的全称是什么？不介绍名称来历"))
            .toEqual([ "expansion" ]);
        expect(readWeaveNamingRequirements("XPT 的英文全称是什么？请解释这些词，不要猜测名称来历")).toEqual(["expansion"]);
        expect(readWeaveNamingRequirements("Lumen 从何得名？")).toEqual(["origin"]);
    });
    it("searches the short subject and stops after a direct full-name source", async () => {
        search.mockResolvedValue(result("Example Packet Transfer (XPT) is the formal name."));
        const r = await researchReadWeaveEvidence({ ...contract, normalizedQuestion:"XPT 的官方英文全称是什么？请解释这些词，不要猜测名称来历" }, "XPT", .02, true, ()=>{}, undefined, "XPT");
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0][0].query).toBe('"XPT" full name official documentation');
        expect(r.audit.stopReason).toBe("sufficient");
        expect(r.audit.missingFacts).toEqual([]);
        expect(r.searchCostCny).toBe(.0072);
    });
    beforeEach(() => {
        vi.clearAllMocks();
        search.mockResolvedValue(result("Lumen is a software library"));
        read.mockResolvedValue("");
    });
    it("keeps the relevant fact beyond the first page window", () => {
        const text = `${"Preface ".repeat(1000)  }Lumen was named after a light unit`;
        expect(readWeaveEvidenceWindow(text, "Lumen origin")).toContain("named after a light unit");
    });
    it("reads past a contents list and stops at an explicit naming decision", async () => {
        const text = `Why is it called Lumen? ${"Introduction ".repeat(2000)}`
            + `The inspiration was a light unit. ${"Context ".repeat(50)}`
            + "The author decided to call the tool Lumen after the light unit.";
        read.mockResolvedValue(text);
        const r = await researchReadWeaveEvidence(
            { ...contract, normalizedQuestion: "Lumen 的名称来源是什么？" },
            "Lumen", .07, true, () => {}, undefined, "Lumen"
        );
        expect(r.sources[0].excerpt).toContain("decided to call the tool Lumen");
        expect(r.sources[0].excerpt).toContain("The inspiration was a light unit");
        expect(r.audit.missingFacts).toEqual([]);
        expect(r.audit.stopReason).toBe("sufficient");
        expect(search).toHaveBeenCalledTimes(1);
        expect(r.searchCostCny).toBe(.0072);
    });
    it("does not treat a heading or a different object's naming decision as evidence", () => {
        const sources = [ {
            excerpt: "Why is it called Lumen? The author decided to call the tool Other."
        } ];
        expect(readWeaveMissingNamingFacts(sources as never, "Lumen", [ "origin" ]))
            .toEqual([ "命名来历" ]);
    });
    it("prioritizes reading subject domains but does not trust URL substrings", async () => {
        search.mockResolvedValue({ ...result("unused"), sources: [
            { url:"https://lumen.com.attacker.example/origin",title:"Lumen",
                snippet:"Lumen was named after a light unit",provider:"Serper",score:120 },
            { url:"https://reference.example/lumen",title:"Lumen",
                snippet:"Lumen was named after a light unit",provider:"Serper",score:100 },
            { url:"https://lumen.org/about/name",title:"Lumen",
                snippet:"The story of the name",provider:"Serper",score:90 }
        ] });
        read.mockResolvedValue("The author proposed Lumen as a name inspired by a light unit.");
        const r = await researchReadWeaveEvidence(
            { ...contract, normalizedQuestion:"Lumen 从何得名？" },
            "", .07, true, ()=>{}, undefined, "Lumen"
        );
        expect(read.mock.calls[0][0]).toBe("https://lumen.org/about/name");
        expect(r.sources[0].url).toBe("https://lumen.org/about/name");
        expect(r.sources[0].authority).toBeUndefined();
        expect(r.audit).toMatchObject({ queryCount:1,pageReadCount:2,stopReason:"sufficient" });
    });
    it("does not infer an acronym from a publication title", () => {
        expect(
            readWeaveMissingNamingFacts([
                { excerpt: "Lumen: A Low-latency Universal Memory ENgine" },
            ] as never),
        ).toHaveLength(2);
    });
    it("directs naming writing to the relevant first-hand-looking page, not rank one", () => {
        const source = { sourceType:"external",retrievalMode:"page-reader",title:"Name history",
            excerpt:"Lumen is named after a light unit" };
        const sources = [
            { ...source,sourceId:"S1",url:"https://reference.example/lumen",originalRank:1 },
            { ...source,sourceId:"S2",url:"https://lumen.org/about",originalRank:3 }
        ];
        const guide = readWeaveNamingSourceGuidance(sources as never, "Lumen 从何得名？");
        expect(readWeaveWritingEvidence(sources as never, "Lumen 从何得名？"))
            .toEqual([ sources[1] ]);
        expect(readWeaveWritingEvidence(sources as never, "怎样使用 Lumen？"))
            .toEqual(sources);
        expect(readWeaveWritingEvidence([ sources[0] ] as never, "Lumen 从何得名？"))
            .toEqual([ sources[0] ]);
        expect(guide).toContain("首读原文：[S2]");
        expect(guide).toContain("若发现矛盾，分别归因");
        expect(readWeaveNamingSourceGuidance(sources as never, "怎样使用 Lumen？")).toBe("");
        expect(readWeaveNamingSourceGuidance([
            { ...sources[1],retrievalMode:"search-snippet" }
        ] as never, "Lumen 从何得名？")).toBe("");
        expect(readWeaveNamingSourceGuidance([
            { ...sources[1],excerpt:"Other is named after Lumen" }
        ] as never, "Unknown 从何得名？")).toBe("");
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
