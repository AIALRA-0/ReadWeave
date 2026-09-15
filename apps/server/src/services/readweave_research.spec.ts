import type { ReadWeaveQuestionContract, ReadWeaveSemanticProposal, ReadWeaveTaskContract as TaskContract } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadWeaveBudget } from "./readweave_budget.js";
import { captureReadWeaveTask } from "./readweave_task_contract.js";
const { search, read } = vi.hoisted(() => ({ search: vi.fn(), read: vi.fn() }));
vi.mock("./readweave_search.js", () => ({
    searchReadWeaveEvidence: search,
    readReadWeavePageWithJina: read,
}));
import {
    extractReadWeavePageEvidence,
    scopeReadWeavePageFragment,
    readWeaveExplicitUrls,
    readWeaveEvidenceWindow,
    readWeaveMissingNamingFacts,
    readWeaveNamingReferences,
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
    it("stops explicit URLs before adjacent Chinese prose and punctuation", () => {
        expect(readWeaveExplicitUrls(
            "请查 https://www.sqlite.org/wal.html。这里没有摘录；另见 https://nodejs.org/api/stream.html#event-drain）后续"
        )).toEqual([
            "https://www.sqlite.org/wal.html",
            "https://nodejs.org/api/stream.html#event-drain"
        ]);
    });

    it("extracts every matching page region instead of retaining a leading window", () => {
        const content = [
            ...Array.from({ length: 30 }, (_, index) => `Python documentation section ${index} covers another feature.`),
            "Updating an existing dict key does not affect insertion order.",
            "The next paragraph explains the exception.",
            ...Array.from({ length: 20 }, (_, index) => `Appendix ${index} contains unrelated material.`),
            "Deleting and reinserting a dict key appends it after the remaining keys.",
            "This final condition completes the rule."
        ].join("\n");
        const extracted = extractReadWeavePageEvidence(
            content,
            "Python dict insertion order update existing key delete reinsert",
            "fallback"
        );

        expect(extracted).toContain("Updating an existing dict key");
        expect(extracted).toContain("Deleting and reinserting a dict key");
        expect(extracted).toContain("final condition");
        expect(extracted).not.toContain("section 0 covers");
    });

    it("uses an explicit section fragment before language-dependent lexical extraction", () => {
        const content = [
            "# RFC 9110",
            "## 2",
            "A very large parent section that must not match section 9.2.2 by one digit",
            ...Array.from({ length: 90 }, (_, index) => `#### [8.${index}.](https://example.test/#section-8.${index})[Other Rules]\nUnrelated HTTP material ${index}`),
            "#### [9.2.2.](https://example.test/#section-9.2.2)[Idempotent Methods]",
            "Repeated identical requests have the same intended effect as one request.",
            "A PUT request can be retried after a connection failure before its response is read.",
            "#### [9.2.3.](https://example.test/#section-9.2.3)[Other Methods]",
            "Unrelated following material"
        ].join("\n");

        const scoped = scopeReadWeavePageFragment(content, "section 9.2.2");
        expect(scoped).toContain("same intended effect");
        expect(scoped).toContain("PUT request can be retried");
        expect(scoped).not.toContain("Unrelated HTTP material");
        expect(scoped).not.toContain("very large parent section");
        expect(scoped).not.toContain("9.2.3");
        expect(extractReadWeavePageEvidence(content, "请解释幂等", "fallback", "section 9.2.2"))
            .toBe(scoped);
    });

    it("resolves reader headings represented by a title followed by a bare marker", () => {
        const content = [
            "Table of contents",
            "Event: 'drain'",
            "Other table entry",
            "Class: stream.Writable",
            "#",
            "General writable text",
            "Event: 'drain'",
            "#",
            "After write() returns false, resume on drain; otherwise buffering can exhaust memory.",
            "Event: 'finish'",
            "#",
            "Unrelated following event"
        ].join("\n");
        const scoped = scopeReadWeavePageFragment(content, "event drain");
        expect(scoped).toContain("resume on drain");
        expect(scoped).not.toContain("Table of contents");
        expect(scoped).not.toContain("Unrelated following event");
    });

    it("scopes a plain-text numbered standards section without retaining the whole document", () => {
        const content = [
            "9.2.1. Safe Methods",
            "Unrelated safety text",
            "9.2.2. Idempotent Methods",
            "Repeated identical requests have the same intended effect as one request.",
            "A PUT request can be retried after a connection failure before reading the response.",
            "9.2.3. Other Methods",
            "Unrelated following section",
            ...Array.from({ length: 200 }, (_, index) => `${10 + index}.1. Other Section\nUnrelated ${index}`)
        ].join("\n");

        const scoped = scopeReadWeavePageFragment(content, "section 9.2.2");
        expect(scoped).toContain("same intended effect");
        expect(scoped).toContain("PUT request can be retried");
        expect(scoped).not.toContain("Unrelated safety text");
        expect(scoped).not.toContain("Unrelated following section");
        expect(scoped!.length).toBeLessThan(500);
    });

    it("deduplicates complete full-name passages but preserves conflicting expansions", () => {
        const base = { sourceType:"external",title:"Reference",provider:"Serper",
            url:"https://example.org/reference",excerpt:"Example Packet Transfer (XPT)." };
        const sources = [
            { ...base,sourceId:"S1" },
            { ...base,sourceId:"S2",retrievalMode:"page-reader",
                excerpt:"XPT is an Example Packet Transfer." },
            { ...base,sourceId:"S3",excerpt:"Example Packet Transport (XPT)." }
        ];
        const question = "XPT 的全称是什么？解释这些词的含义，不介绍机制";
        const chosen = readWeaveWritingEvidence(sources as never,question,"XPT");
        expect(chosen.map(source=>source.sourceId)).toEqual([ "S2","S3" ]);
        expect(chosen[0].excerpt).toBe(sources[1].excerpt);
        expect(sources).toHaveLength(3);
        expect(readWeaveWritingEvidence(sources as never,"XPT 的全称和工作机制？","XPT"))
            .toEqual(sources);
    });
    it("does not turn an exclusion into an expensive origin requirement", () => {
        expect(readWeaveNamingRequirements("XPT 的全称是什么？不介绍名称来历"))
            .toEqual([ "expansion" ]);
        expect(readWeaveNamingRequirements("XPT 的英文全称是什么？请解释这些词，不要猜测名称来历")).toEqual(["expansion"]);
        expect(readWeaveNamingRequirements("Lumen 从何得名？")).toEqual(["origin"]);
        expect(readWeaveNamingRequirements('"Lumen" origin of name', false)).toEqual([ "origin" ]);
    });
    beforeEach(() => {
        vi.resetAllMocks();
        search.mockResolvedValue(result("Lumen is a software library"));
        read.mockResolvedValue("");
    });
    it("never follows unrelated, credentialed or lookalike naming links", () => {
        const links = [
            "https://example.com.attacker.test/name", "https://example.com@example.com/name",
            "https://user:placeholder@example.com/name", "https://example.com:8443/name",
            "https://other.org/name", "https://example.com/products", "http://example.com/name"
        ].map(url=>`[Navigation](${url})`).join(" ");
        expect(readWeaveNamingReferences(links,"Example")).toEqual([]);
        const title = "Origin of the name", url = "https://example.com/name";
        expect(readWeaveNamingReferences(`[Home](https://example.com/) [${title}](${url})`+
            ` [${title}](${url}#part)`,"Example")).toEqual([
            { title,url },{ title:"Home",url:"https://example.com/" }
        ]);
    });
    it("keeps the relevant fact beyond the first page window", () => {
        const text = `${"Preface ".repeat(1000)  }Lumen was named after a light unit`;
        expect(readWeaveEvidenceWindow(text, "Lumen origin")).toContain("named after a light unit");
    });
    it("keeps every relevant profile fact while removing unrelated page furniture", () => {
        const text = [
            "Navigation Home News Contact",
            "Wuxi Li is a principal engineer at AMD",
            "His research interests include physical design automation",
            "Cookie policy and newsletter archive",
            "Wuxi Li previously studied electronic engineering"
        ].join("\n");
        const window = readWeaveEvidenceWindow(text, "Wuxi Li researcher profile current affiliation");
        expect(window).toContain("principal engineer at AMD");
        expect(window).toContain("physical design automation");
        expect(window).toContain("previously studied electronic engineering");
        expect(window).not.toContain("Cookie policy");
        expect(window).not.toContain("Navigation Home");
    });
    it("does not treat a heading or a different object's naming decision as evidence", () => {
        const sources = [ {
            excerpt: "Why is it called Lumen? The author decided to call the tool Other."
        } ];
        expect(readWeaveMissingNamingFacts(sources as never, "Lumen", [ "origin" ]))
            .toEqual([ "命名来历" ]);
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
});

type EvidenceNeed = NonNullable<ReadWeaveSemanticProposal["evidenceNeeds"]>[number];

function need(id: string, queryCandidates: string[] = []): EvidenceNeed {
    return {
        id, taskIds: [`${id  }-task`], subjectIds: [`${id  }-subject`],
        questionToResolve: `What evidence answers ${  id  }?`,
        candidateClaim: "An unverified assertion that must not become the query",
        originRefs: [{ blockId: "question", locator: { kind: "whole" } }],
        whyNeeded: "Answer the requested part", sourcePreferences: ["primary"],
        queryCandidates, freshness: {
            timeIntent: "current", asOf: "2026-09-15", maxAgeSecondsHint: 86400, versionHint: null
        },
        necessity: "needed_for_specific_claim", alternativeIfMissing: "Qualify this part only"
    };
}

function withNeeds(evidenceNeeds: EvidenceNeed[]): ReadWeaveQuestionContract {
    // Clone the complete captured contract so policy-boundary tests can mutate it.
    const taskContract = structuredClone(captureReadWeaveTask({
        articleId: "article", anchorId: "anchor", anchorType: "range", kind: "question",
        title: "Explain the technology and check the author's current affiliation",
        fragments: [], autoExternalSearch: true
    }, true));
    taskContract.interpretation.proposal = {
        evidenceNeeds,
        tasks: evidenceNeeds.map(item => ({
            id: item.taskIds[0], instruction: item.questionToResolve, intentHints: [],
            subjectIds: item.subjectIds, requirementIds: ["root"], originRefs: item.originRefs,
            dependsOnTaskIds: [], expectedDeliverable: item.whyNeeded,
            acceptanceCriteria: ["Address the evidence need"], scope: "original-request"
        })),
        subjects: evidenceNeeds.map(item => ({
            id: item.subjectIds[0], surface: item.subjectIds[0], mentions: item.originRefs,
            kindHints: ["person"], interpretation: "Advisory subject", aliases: [],
            role: "target", introducedByTaskId: null
        }))
    };
    return { ...contract, taskContract };
}

const runResearch = (input: ReadWeaveQuestionContract, budget = 0.1, signal?: AbortSignal) =>
    researchReadWeaveEvidence(input, "Article context with Professor Ada's biography", budget, false, () => {}, signal);

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

describe("research driven by explicit evidence needs", () => {
    afterEach(() => vi.restoreAllMocks());
    beforeEach(() => {
        vi.resetAllMocks();
        search.mockResolvedValue(result("Candidate evidence"));
        read.mockResolvedValue("");
    });

    it("reads a user-specified page without buying a redundant broad search", async () => {
        const input = withNeeds([need("direct")]);
        input.normalizedQuestion = "请依据 https://docs.example.org/reference 回答";
        read.mockResolvedValue("Direct primary evidence answers the question.");
        const output = await researchReadWeaveEvidence(
            input,
            "用户指定 https://docs.example.org/reference 作为依据",
            0.009,
            false,
            () => {}
        );
        expect(search).not.toHaveBeenCalled();
        expect(read).toHaveBeenCalledWith("https://docs.example.org/reference", expect.objectContaining({ anonymous: true }));
        expect(output.searchCostCny).toBe(0);
        expect(output.sources).toEqual(expect.arrayContaining([
            expect.objectContaining({ retrievalMode: "page-reader", excerpt: expect.stringContaining("Direct primary evidence") })
        ]));
    });

    it("retrieves every mixed need without a global person identity or naming gate", async () => {
        const technical = { ...need("technical"), questionToResolve: "How does SRAM work?" };
        const person = { ...need("affiliation"), questionToResolve: "Who is Ada Example?" };
        search.mockImplementation(async ({ query }) => ({
            ...result("A technical result without a person's name"),
            sources: [{ ...result("SRAM stores bits using bistable circuits").sources[0],
                url: query.includes("SRAM") ? "https://example.org/sram" : "https://example.org/affiliation" }]
        }));
        read.mockResolvedValue("Technical explanation and a separate affiliation statement");
        const input = withNeeds([technical, person]);
        const r = await researchReadWeaveEvidence(input, "", .1, true, () => {}, undefined, "Wrong Person");
        expect(search.mock.calls.map(([call]) => call.query)).toEqual([
            technical.questionToResolve, person.questionToResolve
        ]);
        expect(read).toHaveBeenCalledTimes(2);
        expect(r.audit.needs.map(item => item.sourceIds)).toEqual([["S1"], ["S2"]]);
        expect(r.audit.needs.every(item => item.assessment === "unassessed")).toBe(true);
        expect(r.audit.stopReason).toBe("exhausted");
    });

    it("starts from neutral questions, then rotates candidates and retains all metadata", async () => {
        const items = [need("first", ["first alternative"]), need("second", ["second alternative"])];
        const input = withNeeds(items);
        const snapshot = structuredClone(input);
        const r = await runResearch(input);
        expect(r.queries).toEqual([
            items[0].questionToResolve, items[1].questionToResolve, "first alternative", "second alternative"
        ]);
        for (const [index, item] of items.entries()) {
            expect(r.audit.needs[index]).toMatchObject(item);
            expect(r.sources[0].needIds).toContain(item.id);
        }
        expect(r.queries.join(" ")).not.toContain(items[0].candidateClaim);
        expect(search.mock.calls.every(([call]) => call.kind === undefined)).toBe(true);
        expect(input).toEqual(snapshot);
    });

    it("falls back to the original question rather than legacy profile queries", async () => {
        const input = withNeeds([]);
        const r = await runResearch(input);
        expect(r.queries).toEqual([input.taskContract!.request.questionText]);
        expect(r.audit.needs[0]).toMatchObject({
            id: "root", questionToResolve: input.taskContract!.request.questionText, candidateClaim: null
        });
        expect(r.audit.needs[0].originRefs).toEqual([input.taskContract!.request.questionRef]);
        const legacy = await runResearch(contract);
        expect(legacy.queries).toEqual([contract.normalizedQuestion]);
    });

    it("keeps all needs and candidates when the budget leaves later work pending", async () => {
        const items = Array.from({ length: 35 }, (_, i) => need(`need-${  i}`, [`follow-up-${  i}`]));
        const r = await runResearch(withNeeds(items), .015);
        expect(search).toHaveBeenCalledTimes(2);
        expect(r.searchCostCny).toBe(.0144);
        expect(r.audit.stopReason).toBe("budget");
        expect(r.audit.needs).toHaveLength(35);
        expect(r.audit.needs[34]).toMatchObject({ retrievalStatus: "unsearched", stopReason: "budget" });
        expect(r.audit.needs[34].queries).toHaveLength(2);
        expect(r.audit.needs[34].queries.every(query => query.status === "pending")).toBe(true);
        expect(r.audit.missingFacts).toHaveLength(35);
    });

    it("does not clip a large source catalogue when page actions run out", async () => {
        search.mockResolvedValue({
            ...result("unused"),
            sources: Array.from({ length: 30 }, (_, i) => ({
                ...result(`Candidate ${  i}`).sources[0], url: `https://example.org/${  i}`, score: i
            }))
        });
        const r = await runResearch(withNeeds([need("many")]));
        expect(r.sources).toHaveLength(30);
        expect(r.audit.needs[0].sourceIds).toHaveLength(30);
        expect(read).toHaveBeenCalledTimes(19);
        expect(r.sources[29].pageReadStatus).toBe("pending");
        expect(r.audit.stopReason).toBe("limit");
    });

    it("counts cached requests toward the action limit while retaining later needs", async () => {
        search.mockResolvedValue({ ...result("cache", 0), cacheHit: true });
        const r = await runResearch(withNeeds(Array.from({ length: 24 }, (_, i) => need(String(i)))));
        expect(search).toHaveBeenCalledTimes(20);
        expect(read).not.toHaveBeenCalled();
        expect(r.audit).toMatchObject({ queryCount: 0, cacheHits: 20, stopReason: "limit" });
        expect(r.audit.needs).toHaveLength(24);
        expect(r.audit.needs[23].retrievalStatus).toBe("unsearched");
    });

    it("reuses identical queries and sources across needs without losing attribution", async () => {
        const first = need("first");
        const second = { ...need("second"), questionToResolve: first.questionToResolve };
        const r = await runResearch(withNeeds([first, second]));
        expect(search).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(1);
        expect(r.sources[0].needIds).toEqual(["first", "second"]);
        expect(r.audit.needs.map(item => item.sourceIds)).toEqual([["S1"], ["S1"]]);
        expect(r.audit.needs[1].queries[0]).toMatchObject({ reused: true, sourceIds: ["S1"] });
    });

    it("retains different snippets from the same URL and links each query", async () => {
        search.mockResolvedValueOnce(result("First statement")).mockResolvedValueOnce(result("Second statement"));
        const r = await runResearch(withNeeds([need("one"), need("two")]));
        expect(r.sources).toHaveLength(1);
        expect(r.sources[0].excerpt).toBe("First statement\nSecond statement");
        expect(r.sources[0].queries).toEqual(r.queries);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("preserves every need-matching region when multiple needs share a complete page", async () => {
        const content = `SRAM technical definition\n${  "Unrelated middle\n".repeat(2000)  }Ada's current affiliation`;
        read.mockResolvedValue(content);
        const r = await runResearch(withNeeds([need("technical"), need("affiliation")]));
        expect(r.sources[0].excerpt).toContain("SRAM technical definition");
        expect(r.sources[0].excerpt).toContain("Ada's current affiliation");
        expect(r.sources[0].excerpt.length).toBeLessThan(content.length);
        expect(r.sources[0]).toMatchObject({ retrievalMode: "page-reader", access: "excerpt", pageReadStatus: "read" });
        expect(r.audit.needs.map(item => item.pageSourceIds)).toEqual([["S1"], ["S1"]]);
        expect(r.audit.needs.every(item => item.assessment === "unassessed")).toBe(true);
    });

    it.each(["person", "technical_term", "institution", "unknown-random"])(
        "does not let kindHints=%s affect queries, budgets or tool permissions", async hint => {
            const input = withNeeds([need("target")]);
            input.taskContract!.interpretation.proposal.subjects![0].kindHints = [hint];
            const r = await runResearch(input, .015);
            expect(search.mock.calls[0][0]).toMatchObject({
                query: input.taskContract!.interpretation.proposal.evidenceNeeds![0].questionToResolve,
                budgetCny: .009, allowPaid: true
            });
            expect(search).toHaveBeenCalledTimes(1);
            expect(search.mock.calls[0][0].resourceHints).toEqual(hint === "person" ? ["person"] : []);
            expect(read).toHaveBeenCalledTimes(1);
            expect(r.searchCostCny).toBe(.0072);
        }
    );

    it.each(["legacy", "request", "policy"])("honors external search off at the %s boundary", async boundary => {
        const input = withNeeds([need("one"), need("two")]);
        if (boundary === "legacy") input.externalSearchDecision = {
            mode: "disabled", required: false, reason: "disabled", queries: [], executed: false, sourceCount: 0
        };
        if (boundary === "request") input.taskContract!.request.options.externalSearch = "off";
        if (boundary === "policy") input.taskContract!.policy = {
            permissions: { externalSearch: "off" }, budget: { deadlineAt: "2099-01-01" }
        } as TaskContract["policy"];
        const r = await runResearch(input);
        expect(search).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(r.audit.stopReason).toBe("disabled");
        expect(r.audit.needs.every(item => item.retrievalStatus === "unsearched")).toBe(true);
    });

    it("rechecks search-off before page extraction after an in-flight search", async () => {
        const input = withNeeds([need("one")]);
        search.mockImplementation(async () => {
            input.taskContract!.request.options.externalSearch = "off";
            return result("Existing snippet");
        });
        const r = await runResearch(input);
        expect(read).not.toHaveBeenCalled();
        expect(r.audit.stopReason).toBe("disabled");
        expect(r.sources[0].access).toBe("snippet");
    });

    it("enforces trusted search and page limits without hiding pending work", async () => {
        const input = withNeeds([need("one"), need("two")]);
        input.taskContract!.policy = {
            permissions: { externalSearch: "allowed" },
            budget: { deadlineAt: "2099-01-01", maxSearchRequests: 1, maxPageFetches: 0 }
        } as TaskContract["policy"];
        const r = await runResearch(input);
        expect(search).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(r.audit.stopReason).toBe("limit");
        expect(r.audit.needs[1].retrievalStatus).toBe("unsearched");
    });

    it("starts no actions beyond the deadline", async () => {
        const input = withNeeds([need("one")]);
        input.taskContract!.policy = {
            permissions: { externalSearch: "allowed" }, budget: { deadlineAt: "2000-01-01" }
        } as TaskContract["policy"];
        const r = await runResearch(input);
        expect(search).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(r.audit.stopReason).toBe("limit");
    });

    it("retains uncertain search charges and continues other needs after a search error", async () => {
        search.mockRejectedValueOnce(new Error("https://provider.test?key=DO_NOT_EXPOSE"))
            .mockResolvedValueOnce(result("Other need's evidence"));
        const r = await runResearch(withNeeds([need("failed"), need("other")]), .02);
        expect(search).toHaveBeenCalledTimes(2);
        expect(r.searchCostCny).toBe(.0072);
        expect(r.unsettledCostCny).toBe(.009);
        expect(r.audit.unsettledCostCny).toBe(.009);
        expect(r.audit.needs[0]).toMatchObject({ retrievalStatus: "unavailable", stopReason: "unavailable" });
        expect(r.audit.needs[1]).toMatchObject({ retrievalStatus: "retrieved", sourceIds: ["S1"] });
        expect(r.warnings.join(" ")).not.toContain("DO_NOT_EXPOSE");
    });

    it("retains earlier evidence when a later query throws", async () => {
        search.mockResolvedValueOnce(result("Keep this evidence")).mockRejectedValueOnce(new Error("offline"));
        const r = await runResearch(withNeeds([need("first"), need("second")]), .02);
        expect(r.sources[0].excerpt).toBe("Keep this evidence");
        expect(r.audit.needs[0].sourceIds).toEqual(["S1"]);
        expect(r.audit.needs[1].queries[0].status).toBe("failed");
        expect(r.searchCostCny).toBe(.0072);
        expect(r.unsettledCostCny).toBe(.009);
    });

    it("keeps snippets and associates page failures without exposing provider secrets", async () => {
        read.mockRejectedValue(new Error("HTTP 429 https://provider.test?key=DO_NOT_EXPOSE"));
        const r = await runResearch(withNeeds([need("one")]));
        expect(r.sources[0]).toMatchObject({ excerpt: "Candidate evidence", access: "snippet", pageReadStatus: "failed" });
        expect(r.warnings).toEqual(["Page extraction failed (HTTP 429)."]);
        expect(r.audit.needs[0].stopReason).toBe("unavailable");
    });

    it("does not infer verification, page access or authority from search hits", async () => {
        search.mockResolvedValue({
            ...result("Definitely verified and current"),
            sources: [{ ...result("Definitely verified and current").sources[0], retrievalMode: "page-reader" }]
        });
        const r = await runResearch(withNeeds([need("one")]));
        expect(r.sources[0]).toMatchObject({ access: "snippet", retrievalMode: "raw-serp", pageReadStatus: "empty" });
        expect(r.sources[0].authority).toBeUndefined();
        expect(r.audit.needs[0].assessment).toBe("unassessed");
        expect(r.audit.missingFacts).toEqual([need("one").questionToResolve]);
        expect(r.audit.stopReason).not.toBe("sufficient");
    });

    it("tracks empty results per need while still searching later needs", async () => {
        search.mockResolvedValueOnce({ ...result("unused"), sources: [] }).mockResolvedValueOnce(result("Evidence"));
        const r = await runResearch(withNeeds([need("empty"), need("found")]));
        expect(r.audit.needs.map(item => item.retrievalStatus)).toEqual(["no-results", "retrieved"]);
    });

    it.each([NaN, Infinity, -1, .5])("keeps the allowance unsettled for an invalid or excessive provider charge (%s)", async cost => {
        search.mockResolvedValue(result("Keep the returned evidence", cost));
        const r = await runResearch(withNeeds([need("one", ["later query"])]), .02);
        expect(search).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(r.audit.stopReason).toBe("budget");
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(.009);
        expect(r.audit.unsettledCostCny).toBe(.009);
        expect(r.sources[0].excerpt).toBe("Keep the returned evidence");
    });

    it.each([0, .0072])("retains the allowance when an adapter catches a provider failure and reports %s", async cost => {
        search.mockResolvedValue({ ...result("A remaining free-provider snippet", cost), warnings: ["Serper: HTTP 500"] });
        const r = await runResearch(withNeeds([need("first", ["later query"])]));
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(.009);
        expect(r.audit.unsettledCostCny).toBe(.009);
        expect(r.audit.needs[0].queries[1].status).toBe("pending");
        expect(r.sources).toHaveLength(1);
        expect(search).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
    });

    it.each([.0072, NaN, -1])("retains explicitly unsettled adapter cost without requiring warnings (%s)", async unsettledCostCny => {
        search.mockResolvedValue({ ...result("Candidate snippet", 0), unsettledCostCny });
        const r = await runResearch(withNeeds([need("first")]));
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(.009);
    });

    it("does not reserve an earlier failed request again for a zero-cost cache hit", async () => {
        search.mockResolvedValue({ ...result("Cached snippet", 0), cacheHit: true,
            warnings: ["Serper: request failed"], unsettledCostCny: .0072 });
        const r = await runResearch(withNeeds([need("first")]));
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(0);
        expect(r.audit.cacheHits).toBe(1);
    });

    it("preserves the initial zero-budget free/cache-capable attempt", async () => {
        search.mockResolvedValue(result("Cached evidence", 0));
        const r = await runResearch(withNeeds([need("one"), need("two")]), 0);
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0][0]).toMatchObject({ allowPaid: false, budgetCny: 0 });
        expect(r.searchCostCny).toBe(0);
        expect(r.audit.needs[1].retrievalStatus).toBe("unsearched");
    });

    it.each(["before", "search", "page"])("propagates cancellation %s and starts no further work", async phase => {
        const controller = new AbortController();
        if (phase === "before") controller.abort();
        if (phase === "search") search.mockImplementation(async () => {
            controller.abort();
            return result("Hit");
        });
        if (phase === "page") read.mockImplementation(async () => {
            controller.abort();
            throw new Error("cancelled");
        });
        await expect(runResearch(withNeeds([need("one"), need("two")]), .1, controller.signal)).rejects.toThrow();
        expect(search).toHaveBeenCalledTimes(phase === "before" ? 0 : phase === "search" ? 1 : 2);
        expect(read).toHaveBeenCalledTimes(phase === "page" ? 1 : 0);
    });

    it("reads candidates round-robin across needs without a score or name gate", async () => {
        search.mockResolvedValueOnce({
            ...result("unused"),
            sources: [0, 1, 2].map(i => ({
                ...result("No profile names here").sources[0], url: `https://example.org/first-${  i}`, score: 100 - i * 50
            }))
        }).mockResolvedValueOnce({
            ...result("unused"),
            sources: [{ ...result("Another need").sources[0], url: "https://example.org/second" }]
        });
        await runResearch(withNeeds([need("first"), need("second")]));
        expect(read.mock.calls.map(([url]) => url)).toEqual([
            "https://example.org/first-0", "https://example.org/second",
            "https://example.org/first-1", "https://example.org/first-2"
        ]);
        expect(read.mock.calls.every(([, options]) => options.anonymous === true)).toBe(true);
    });

    it("passes person resources only for the need linked to that subject and task", async () => {
        const input = withNeeds([need("technical"), need("affiliation")]);
        input.taskContract!.interpretation.proposal.subjects![0].kindHints = ["technical_term"];
        await runResearch(input);
        expect(search.mock.calls.map(([call]) => call.resourceHints)).toEqual([[], ["person"]]);
        expect(search.mock.calls.map(([call]) => call.query)).toEqual([
            need("technical").questionToResolve, need("affiliation").questionToResolve
        ]);
    });

    it.each(["missing-subject", "missing-task", "task-subject-mismatch"])(
        "does not use background person hints with a broken need anchor: %s", async broken => {
            const input = withNeeds([need("target")]);
            const proposal = input.taskContract!.interpretation.proposal;
            if (broken === "missing-subject") proposal.evidenceNeeds![0].subjectIds = ["missing"];
            if (broken === "missing-task") proposal.evidenceNeeds![0].taskIds = ["missing"];
            if (broken === "task-subject-mismatch") proposal.tasks[0].subjectIds = [];
            await runResearch(input);
            expect(search.mock.calls[0][0].resourceHints).toEqual([]);
        }
    );

    it("does not reuse a general query as a person-resource query for another need", async () => {
        const first = need("technical"), second = { ...need("person"), questionToResolve: first.questionToResolve };
        const input = withNeeds([first, second]);
        input.taskContract!.interpretation.proposal.subjects![0].kindHints = ["technical_term"];
        const r = await runResearch(input);
        expect(search).toHaveBeenCalledTimes(2);
        expect(search.mock.calls.map(([call]) => call.resourceHints)).toEqual([[], ["person"]]);
        expect(r.audit.needs.every(item => !item.queries[0].reused)).toBe(true);
        expect(r.sources[0].needIds).toEqual(["technical", "person"]);
    });

    it("reserves concurrent searches before launch and keeps the total bounded until settlement", async () => {
        const reserve = vi.spyOn(ReadWeaveBudget.prototype, "reserveResourceRequest");
        const gates = Array.from({ length: 5 }, () => deferred<ReturnType<typeof result>>());
        let active = 0, maximum = 0, started = 0;
        search.mockImplementation(async () => {
            expect(reserve.mock.calls.length).toBeGreaterThan(started);
            const ledger = reserve.mock.contexts[0] as ReadWeaveBudget;
            expect(ledger.upperBoundCny).toBeLessThanOrEqual(.05);
            active++;
            maximum = Math.max(maximum, active);
            const response = await gates[started++].promise;
            active--;
            return response;
        });
        const running = runResearch(withNeeds(Array.from({ length: 5 }, (_, index) => need(String(index)))), .05);
        expect(search).toHaveBeenCalledTimes(2);
        expect(reserve).toHaveBeenCalledTimes(2);
        expect((reserve.mock.contexts[0] as ReadWeaveBudget).remainingCny).toBe(.032);
        gates[1].resolve(result("Second finishes first"));
        await Promise.resolve();
        expect(search).toHaveBeenCalledTimes(2);
        gates[0].resolve(result("First"));
        await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(4));
        gates[2].resolve(result("Third"));
        gates[3].resolve(result("Fourth"));
        await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(5));
        gates[4].resolve(result("Fifth"));
        const r = await running;
        expect(maximum).toBe(2);
        expect(r.searchCostCny).toBe(.036);
        expect(r.unsettledCostCny).toBe(0);
        expect(r.audit.unsettledCostCny).toBe(0);
        expect(r.audit.needs.every(item => item.retrievalStatus === "retrieved")).toBe(true);
        expect(r.queries).toEqual(Array.from({ length: 5 }, (_, index) => need(String(index)).questionToResolve));
    });

    it("waits for a tight reservation to settle before using the released remainder", async () => {
        const gates = [deferred<ReturnType<typeof result>>(), deferred<ReturnType<typeof result>>()];
        let index = 0;
        search.mockImplementation(() => gates[index++].promise);
        const running = runResearch(withNeeds([need("one"), need("two"), need("three")]), .015);
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0][0].budgetCny).toBe(.009);
        gates[0].resolve(result("First"));
        await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
        expect(search.mock.calls[1][0].budgetCny).toBe(.0078);
        gates[1].resolve(result("Second"));
        const r = await running;
        expect(r.searchCostCny + r.unsettledCostCny).toBe(.0144);
        expect(r.audit.needs[2]).toMatchObject({ retrievalStatus: "unsearched", stopReason: "budget" });
    });

    it("keeps both failed concurrent reservations pending without spending them again", async () => {
        const reserve = vi.spyOn(ReadWeaveBudget.prototype, "reserveResourceRequest");
        search.mockRejectedValue(new Error("unavailable"));
        const r = await runResearch(withNeeds([need("one"), need("two"), need("three")]), .02);
        expect(search).toHaveBeenCalledTimes(2);
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(.018);
        expect(r.audit.unsettledCostCny).toBe(.018);
        expect(r.audit.needs[2].queries[0].status).toBe("pending");
        const receipts = (reserve.mock.contexts[0] as ReadWeaveBudget).snapshot().receipts;
        expect(receipts).toHaveLength(2);
        expect(receipts.every(receipt => receipt.settledMicros === undefined)).toBe(true);
    });

    it("settles valid concurrent work but retains the other allowance when its cost is invalid", async () => {
        search.mockResolvedValueOnce(result("Invalid cost, real hit", NaN)).mockResolvedValueOnce(result("Valid cost"));
        const r = await runResearch(withNeeds([need("one"), need("two"), need("three")]), .03);
        expect(search).toHaveBeenCalledTimes(2);
        expect(r.searchCostCny).toBe(.0072);
        expect(r.unsettledCostCny).toBe(.009);
        expect(r.audit.needs[2].queries[0].status).toBe("pending");
        expect(read).not.toHaveBeenCalled();
        expect(r.sources[0].excerpt).toContain("Invalid cost, real hit");
        expect(r.sources[0].excerpt).toContain("Valid cost");
    });

    it("treats a missing search response as unsettled rather than a free request", async () => {
        search.mockResolvedValue(undefined);
        const r = await runResearch(withNeeds([need("one")]));
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(.009);
        expect(r.audit.needs[0].queries[0].status).toBe("failed");
    });

    it.each(["shared", "direct", "transitive"])("serializes searches linked by a %s task dependency", async relation => {
        const input = withNeeds([need("one"), need("two")]);
        const proposal = input.taskContract!.interpretation.proposal;
        if (relation === "shared") proposal.evidenceNeeds![1].taskIds = [proposal.tasks[0].id];
        if (relation === "direct") proposal.tasks[1].dependsOnTaskIds = [proposal.tasks[0].id];
        if (relation === "transitive") {
            proposal.tasks.push({ ...proposal.tasks[0], id: "middle", dependsOnTaskIds: [proposal.tasks[0].id] });
            proposal.tasks[1].dependsOnTaskIds = ["middle"];
        }
        const first = deferred<ReturnType<typeof result>>();
        search.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(result("Second"));
        const running = runResearch(input);
        expect(search).toHaveBeenCalledTimes(1);
        first.resolve(result("First"));
        const r = await running;
        expect(search).toHaveBeenCalledTimes(2);
        expect(r.unsettledCostCny).toBe(0);
    });

    it("reads at most two anonymous pages concurrently and preserves all page records", async () => {
        search.mockResolvedValue({ ...result("unused"), sources: Array.from({ length: 5 }, (_, index) => ({
            ...result("Snippet").sources[0], url: `https://example.org/${index}`
        })) });
        const gates = Array.from({ length: 5 }, () => deferred<string>());
        let active = 0, maximum = 0, index = 0;
        read.mockImplementation(async (_url, options) => {
            expect(options.anonymous).toBe(true);
            active++;
            maximum = Math.max(maximum, active);
            const text = await gates[index++].promise;
            active--;
            return text;
        });
        const running = runResearch(withNeeds([need("one")]));
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        gates[0].resolve("Page 0");
        gates[1].resolve("Page 1");
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
        gates[2].resolve("Page 2");
        gates[3].resolve("Page 3");
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5));
        gates[4].resolve("Page 4");
        const r = await running;
        expect(maximum).toBe(2);
        expect(r.audit.needs[0].pageSourceIds).toHaveLength(5);
        expect(r.searchCostCny).toBe(.0072);
        expect(r.unsettledCostCny).toBe(0);
    });

    it("drains already launched concurrent calls on cancellation without starting another need", async () => {
        const controller = new AbortController();
        const gates = [deferred<ReturnType<typeof result>>(), deferred<ReturnType<typeof result>>()];
        let index = 0, ended = false;
        search.mockImplementation(() => gates[index++].promise);
        const running = runResearch(withNeeds([need("one"), need("two"), need("three")]), .03, controller.signal);
        const rejected = expect(running).rejects.toThrow();
        void running.then(() => { ended = true; }, () => { ended = true; });
        expect(search).toHaveBeenCalledTimes(2);
        controller.abort();
        gates[0].resolve(result("Late first"));
        await Promise.resolve();
        expect(ended).toBe(false);
        gates[1].resolve(result("Late second"));
        await rejected;
        expect(search).toHaveBeenCalledTimes(2);
        expect(read).not.toHaveBeenCalled();
    });

    it("releases reservations for work disabled before launch and leaves its queries pending", async () => {
        const input = withNeeds([need("one"), need("two")]);
        const r = await researchReadWeaveEvidence(input, "", .03, false, () => {
            input.taskContract!.request.options.externalSearch = "off";
        });
        expect(search).not.toHaveBeenCalled();
        expect(r.searchCostCny).toBe(0);
        expect(r.unsettledCostCny).toBe(0);
        expect(r.audit.needs.every(item => item.queries[0].status === "pending")).toBe(true);
        expect(r.audit.stopReason).toBe("disabled");
    });
});
