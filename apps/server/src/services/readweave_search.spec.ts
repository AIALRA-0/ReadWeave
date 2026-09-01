import { cls, hidden_subtree as hiddenSubtreeService } from "@triliumnext/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    buildFocusedGeneralSearchQuery,
    buildReadWeaveSearchVariants,
    clearReadWeaveSearchCacheForTests,
    searchReadWeaveEvidence
} from "./readweave_search.js";
import { updateReadWeaveAiSettings } from "./readweave_settings.js";
import sqlInit from "./sql_init.js";

describe("ReadWeave free-source search", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    beforeEach(() => {
        clearReadWeaveSearchCacheForTests();
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.009,
                clearSerperApiKey: true,
                clearTavilyApiKey: true,
                clearBraveApiKey: true
            });
        });
    });

    it("focuses a time-sensitive bilingual query on its named entity instead of the Chinese date prefix", () => {
        const query = buildFocusedGeneralSearchQuery("截至 2026 年 7 月，DeepSeek API 当前提供哪些正式模型名称");

        expect(query).toMatch(/^DeepSeek API\b/u);
        expect(query).toContain("official current model names");
        expect(query).toContain("2026");
        expect(query).not.toMatch(/^截至/u);
        expect(query).not.toMatch(/deepseek-v4-(?:flash|pro)/iu);
    });

    it("keeps a Chinese-only current query meaningful while moving the date out of the lead", () => {
        const query = buildFocusedGeneralSearchQuery("截至 2026 年，某研究机构的现任负责人是谁");

        expect(query).toContain("某研究机构的现任负责人是谁");
        expect(query).toContain("official current affiliation");
        expect(query).toContain("2026");
        expect(query).not.toMatch(/^截至/u);
    });

    it("turns a person lookup into a direct biography and affiliation query", () => {
        const query = buildFocusedGeneralSearchQuery("Moongon Jung researcher");

        expect(query).toMatch(/^"Moongon Jung"/u);
        expect(query).toContain("researcher profile current affiliation");
    });

    it("focuses a definition lookup on the official meaning instead of nearby publications", () => {
        const query = buildFocusedGeneralSearchQuery("DBLP 是什么");

        expect(query).toContain("official definition meaning full name");
        expect(query).toContain("DBLP 是什么");
    });

    it("expands person, DOI and acronym searches into independent verification queries", () => {
        expect(buildReadWeaveSearchVariants("Naifeng Jing researcher professor profile"))
            .toEqual(expect.arrayContaining([
                "Naifeng Jing",
                "Naifeng Jing official faculty profile current affiliation",
                "Naifeng Jing ORCID researcher"
            ]));
        expect(buildReadWeaveSearchVariants("10.1109/TEST.2015.7342405 是什么"))
            .toEqual(expect.arrayContaining([
                "10.1109/TEST.2015.7342405",
                "\"10.1109/TEST.2015.7342405\" DOI publication"
            ]));
        expect(buildReadWeaveSearchVariants("NPU definition"))
            .toEqual(expect.arrayContaining([
                "NPU official definition full name",
                "NPU acronym history official"
            ]));
    });

    it("identifies free-source requests with a contactable project URL", async () => {
        const userAgents: string[] = [];
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request, init?: RequestInit) => {
            userAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
            if (input.toString().includes("wikipedia.org")) {
                return Response.json({ query: { pages: {} } });
            }
            throw new Error(`Unexpected URL ${input.toString()}`);
        }) as unknown as typeof fetch;

        await cls.init(() => searchReadWeaveEvidence({
            query: "普通技术概念是什么",
            kind: "question",
            force: true,
            allowPaid: false
        }, { fetcher, bypassCache: true }));

        expect(userAgents).toHaveLength(1);
        expect(userAgents[0]).toBe("ReadWeave/0.104.0 (https://github.com/AIALRA-0/ReadWeave)");
    });

    it("uses the official dblp naming FAQ instead of guessing an expansion", async () => {
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url === "https://dblp.org/faq/1474577.html") {
                return new Response(`
                    <html><body>
                    <p>Initially, dblp started at the database systems and logic programming research group</p>
                    <p>Digital Bibliography &amp; Library Project was a backronym and is no longer used</p>
                    <p>You may now accept dblp computer science bibliography as the proper name; the initial acronym has lost its meaning</p>
                    </body></html>
                `, { status: 200 });
            }
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "dblp definition",
            kind: "term",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(result.providers).toContain("dblp official FAQ");
        expect(result.memo).toContain("no longer used");
        expect(result.memo).toContain("Digital Bibliography & Library Project");
    });

    it("uses ORCID's own definition instead of a selected person's identifier", async () => {
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url === "https://info.orcid.org/what-is-orcid/") {
                return new Response(`
                    <html><body>
                    <p>ORCID stands for Open Researcher and Contributor ID</p>
                    <p>The ORCID iD is a unique, persistent identifier free of charge to researchers</p>
                    </body></html>
                `, { status: 200 });
            }
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "ORCID identifier meaning",
            kind: "term",
            force: true,
            allowPaid: false
        }, { fetcher, bypassCache: true }));

        expect(result.providers).toContain("ORCID official");
        expect(result.memo).toContain("Open Researcher and Contributor ID");
        expect(result.memo).toContain("unique, persistent identifier");
    });

    it("fetches the official Linux kernel DAX definition without a paid search provider", async () => {
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url === "https://docs.kernel.org/filesystems/dax.html") {
                return new Response(`
                    <html><head><title>Direct Access for files — The Linux Kernel documentation</title></head><body>
                    <div class="sidebar"><p>Contents Navigation DAX unrelated sidebar text</p></div>
                    <div class="body" role="main">
                    <p>Direct Access (DAX) permits direct memory access to storage without using the page cache</p>
                    <p>For memory-like block devices, DAX maps storage directly into userspace through mmap</p>
                    </div>
                    </body></html>
                `, { status: 200 });
            }
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "DAX Direct Access Linux page cache persistent memory",
            kind: "term",
            force: true,
            allowPaid: false
        }, { fetcher, bypassCache: true }));

        expect(result.searchCostCny).toBe(0);
        expect(result.providers).toContain("Linux kernel documentation");
        expect(result.memo).toContain("Direct Access (DAX)");
        expect(result.memo).toContain("page cache");
        expect(result.memo).not.toContain("Contents Navigation");
    });

    it("checks the official DeepSeek model documentation without requiring a paid search key", async () => {
        const requested: string[] = [];
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            requested.push(url);
            if (url === "https://api-docs.deepseek.com/api/list-models") {
                return new Response(`
                    <html><body>
                        <h1>Lists Models</h1>
                        <code>deepseek-v4-flash</code>
                        <code>deepseek-v4-pro</code>
                    </body></html>
                `, { status: 200 });
            }
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "截至 2026 年 7 月，DeepSeek API 当前提供哪些正式模型名称",
            kind: "question",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(result.searchCostCny).toBe(0);
        expect(result.providers).toContain("DeepSeek API Docs");
        expect(result.memo).toContain("deepseek-v4-flash");
        expect(result.memo).toContain("deepseek-v4-pro");
        expect(requested).toContain("https://api-docs.deepseek.com/api/list-models");
    });

    it("queries several no-key academic sources in parallel without search cost", async () => {
        const requested: string[] = [];
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            requested.push(url);
            if (url.includes("crossref.org")) {
                return Response.json({ message: { items: [ {
                    title: [ "A verified paper" ],
                    URL: "https://doi.org/10.1000/example",
                    DOI: "10.1000/example",
                    publisher: "Example Publisher"
                } ] } });
            }
            if (url.includes("dblp.org")) {
                return Response.json({ result: { hits: { hit: [ {
                    info: { title: "A verified paper", ee: "https://example.org/paper", venue: "DAC", year: "2026" }
                } ] } } });
            }
            if (url.includes("openalex.org")) {
                return Response.json({ results: [ {
                    title: "A verified OpenAlex record",
                    doi: "https://doi.org/10.1000/openalex",
                    publication_year: 2026
                } ] });
            }
            if (url.includes("semanticscholar.org")) {
                return Response.json({ data: [ {
                    title: "A verified Semantic Scholar record",
                    url: "https://www.semanticscholar.org/paper/example",
                    abstract: "Evidence abstract",
                    year: 2026
                } ] });
            }
            if (url.includes("europepmc")) return Response.json({ resultList: { result: [] } });
            if (url.includes("arxiv.org")) return new Response("<feed></feed>", { status: 200 });
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "A verified paper 的论文出处是什么",
            kind: "question"
        }, { fetcher, bypassCache: true }));

        expect(result.used).toBe(true);
        expect(result.searchCostCny).toBe(0);
        expect(result.providers).toEqual(expect.arrayContaining([ "Crossref", "DBLP", "OpenAlex", "Semantic Scholar" ]));
        expect(result.sources.length).toBeGreaterThanOrEqual(4);
        expect(requested.some(url => url.includes("google.serper.dev"))).toBe(false);
    });

    it("reuses a completed search instead of charging or requesting again", async () => {
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url.includes("wikipedia.org")) {
                return Response.json({ query: { pages: {
                    "1": { title: "ORCID", extract: "Persistent researcher identifier", fullurl: "https://en.wikipedia.org/wiki/ORCID" }
                } } });
            }
            return Response.json({});
        }) as unknown as typeof fetch;

        const input = { query: "ORCID 是什么", kind: "term" as const };
        const first = await cls.init(() => searchReadWeaveEvidence(input, { fetcher }));
        const firstCalls = vi.mocked(fetcher).mock.calls.length;
        const second = await cls.init(() => searchReadWeaveEvidence(input, { fetcher }));

        expect(first.cacheHit).toBe(false);
        expect(second.cacheHit).toBe(true);
        expect(second.searchCostCny).toBe(0);
        expect(vi.mocked(fetcher).mock.calls.length).toBe(firstCalls);
    });

    it("does not search a stable term when its selected local evidence and canonical identity are sufficient", async () => {
        const fetcher = vi.fn(async () => {
            throw new Error("Network search should not run");
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "CPU",
            context: "CPU 执行通用程序指令，并通过控制、算术逻辑与缓存等部件完成计算",
            kind: "term",
            localEvidenceSufficient: true
        }, { fetcher, bypassCache: true }));

        expect(result.used).toBe(false);
        expect(result.searchCostCny).toBe(0);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("treats a person profile as time-sensitive and ranks a free current official faculty page above stale biography text", async () => {
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.009,
                tavilyApiKey: "test-tavily-key"
            });
        });
        const requested: string[] = [];
        const requestBodies: unknown[] = [];
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request, init?: RequestInit) => {
            const url = input.toString();
            requested.push(url);
            if (url.includes("wikipedia.org")) {
                return Response.json({ query: { pages: {
                    "1": {
                        title: "Sung Kyu Lim",
                        extract: "Sung Kyu Lim is a professor at the Georgia Institute of Technology",
                        fullurl: "https://en.wikipedia.org/wiki/Sung_Kyu_Lim"
                    }
                } } });
            }
            if (url.includes("api.openalex.org/authors")) return Response.json({ results: [] });
            if (url.includes("api.tavily.com")) {
                requestBodies.push(JSON.parse(String(init?.body)));
                return Response.json({ results: [
                    {
                        title: "Sung-Kyu Lim - USC Viterbi",
                        url: "https://viterbi.usc.edu/directory/faculty/Lim/Sung-Kyu",
                        content: "Dean's Professor of Electrical and Computer Engineering; joined USC in Fall 2025",
                        published_date: "2026-01-15",
                        score: 0.95
                    }
                ] });
            }
            if (url.includes("pub.orcid.org")) return Response.json({ result: [] });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Sung Kyu Lim researcher professor profile",
            kind: "question",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(requested.some(url => url.includes("api.tavily.com"))).toBe(true);
        expect(requestBodies).toEqual([ expect.objectContaining({
            query: expect.stringMatching(/Sung Kyu Lim.*official primary source/u)
        }) ]);
        expect(result.sources[0]).toMatchObject({
            provider: "Tavily",
            url: "https://viterbi.usc.edu/directory/faculty/Lim/Sung-Kyu"
        });
        expect(result.memo).toMatch(/joined USC in Fall 2025/u);
    });

    it("removes social activity from a public profile before it becomes biography evidence", async () => {
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.009,
                tavilyApiKey: "test-tavily-key"
            });
        });
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            if (url.includes("api.openalex.org/authors")) return Response.json({ results: [] });
            if (url.includes("pub.orcid.org")) return Response.json({ result: [] });
            if (url.includes("api.tavily.com")) return Response.json({ results: [ {
                title: "Example Researcher - Apple | LinkedIn",
                url: "https://www.linkedin.com/in/example-researcher",
                content: "# Example Researcher Apple San Francisco Bay Area, US ## About A research-oriented position ## Experience Apple ## Education Example University ## Activity Example Researcher liked this Other Person received the 2024 Intel Outstanding Researcher Award",
                score: 0.9
            } ] });
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Example Researcher profile current affiliation",
            kind: "question",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(result.sources[0].snippet).toContain("公开职业资料页当前机构：Apple");
        expect(result.sources[0].snippet).toContain("Experience Apple");
        expect(result.sources[0].snippet).not.toMatch(/Activity|Outstanding Researcher Award|research-oriented position/iu);
    });

    it("uses a public ORCID employment interval to distinguish a current institution from a former one at no search cost", async () => {
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url.includes("api.openalex.org/authors")) return Response.json({ results: [] });
            if (url.includes("pub.orcid.org")) {
                return Response.json({
                    "affiliation-group": [
                        {
                            summaries: [ {
                                "employment-summary": {
                                    "put-code": 1,
                                    "last-modified-date": { value: Date.UTC(2026, 0, 15) },
                                    "department-name": "Electrical and Computer Engineering",
                                    "role-title": "Dean’s Professor",
                                    "start-date": { year: { value: "2025" }, month: { value: "08" }, day: { value: "16" } },
                                    "end-date": null,
                                    organization: { name: "University of Southern California" },
                                    source: { "source-name": { value: "Sung Kyu Lim" } }
                                }
                            } ]
                        },
                        {
                            summaries: [ {
                                "employment-summary": {
                                    "put-code": 2,
                                    "department-name": "Electrical and Computer Engineering",
                                    "role-title": "Professor",
                                    "start-date": { year: { value: "2001" } },
                                    "end-date": { year: { value: "2025" }, month: { value: "08" }, day: { value: "15" } },
                                    organization: { name: "Georgia Institute of Technology" },
                                    source: { "source-name": { value: "Sung Kyu Lim" } }
                                }
                            } ]
                        }
                    ]
                });
            }
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            if (url.includes("arxiv.org")) return new Response("<feed></feed>");
            return Response.json({});
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Sung Kyu Lim current professor faculty official profile 2026",
            context: "ORCID 0000-0002-2267-5282",
            kind: "question",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(result.searchCostCny).toBe(0);
        expect(result.sources).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: "ORCID",
                title: "Sung Kyu Lim — University of Southern California（现任）"
            })
        ]));
        expect(result.memo).toMatch(/2025-08-16 至 今/u);
        expect(result.memo).toMatch(/Georgia Institute of Technology（历史任职）/u);
    });
});
