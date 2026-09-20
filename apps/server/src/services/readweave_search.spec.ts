import dns from "node:dns";

import { cls, hidden_subtree as hiddenSubtreeService } from "@triliumnext/core";
import { Agent, fetch as undiciFetch } from "undici";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    buildFocusedGeneralSearchQuery,
    buildReadWeaveSearchVariants,
    clearReadWeaveSearchCacheForTests,
    readReadWeavePageWithJina,
    normalizeReadWeavePageContent,
    type ReadWeaveSearchPolicy,
    searchReadWeaveEvidence,
    searchReadWeaveActiveEvidence,
    searchReadWeaveEvidencePlan,
    testReadWeaveSearch,
    withReadWeaveSearchPolicy
} from "./readweave_search.js";
import * as readWeaveSettings from "./readweave_settings.js";
import sqlInit from "./sql_init.js";

const { updateReadWeaveAiSettings } = readWeaveSettings;

function mockSearchRuntimeConfig(
    overrides: Partial<ReturnType<typeof readWeaveSettings.getReadWeaveSearchRuntimeConfig>>
): void {
    const current = readWeaveSettings.getReadWeaveSearchRuntimeConfig();
    vi.spyOn(readWeaveSettings, "getReadWeaveSearchRuntimeConfig").mockReturnValue({
        ...current,
        tinyFishApiKey: undefined,
        octenApiKey: undefined,
        parallelApiKey: undefined,
        serperApiKey: undefined,
        ...overrides
    });
}

vi.mock("undici", async importOriginal => ({
    ...await importOriginal<typeof import("undici")>(), fetch: vi.fn()
}));

describe("ReadWeave free-source search", () => {
    it("uses the configured general engine at the exact micro-CNY tariff, without category heuristics", async () => {
        cls.init(() => updateReadWeaveAiSettings({ baseUrl:"https://api.deepseek.com", model:"deepseek-v4-flash", serperApiKey:"test-only" }));
        const fetcher = vi.fn<typeof fetch>(async () => Response.json({organic:[
            {title:"First",link:"https://example.org/first",snippet:"First result"},
            {title:"Second",link:"https://example.org/second",snippet:"Second result"}
        ]}));
        const result = await cls.init(() => searchReadWeaveActiveEvidence({query:"heterogeneous chips",provider:"general",budgetCny:0.0072}, {fetcher}));
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(String(fetcher.mock.calls[0][0])).toContain("google.serper.dev");
        expect(result.searchCostCny).toBe(0.0072);
        expect(result.sources.map(s => s.title)).toEqual(["First", "Second"]);
    });

    it("uses TinyFish first and preserves every returned result", async () => {
        mockSearchRuntimeConfig({ tinyFishApiKey: "tinyfish-test-key" });
        const rows = Array.from({ length: 9 }, (_, index) => ({
            title: `TinyFish result ${index + 1}`,
            url: `https://example.org/tinyfish/${index + 1}`,
            snippet: `Evidence ${index + 1}`,
            position: index + 1
        }));
        const fetcher = vi.fn<typeof fetch>(async (input, init) => {
            const url = new URL(String(input));
            expect(url.origin).toBe("https://api.search.tinyfish.ai");
            expect(url.searchParams.get("query")).toBe("complete evidence question");
            expect(new Headers(init?.headers).get("X-API-Key")).toBe("tinyfish-test-key");
            return Response.json({ results: rows });
        });

        const result = await cls.init(() => searchReadWeaveActiveEvidence({
            query: "complete evidence question", provider: "general", budgetCny: 0
        }, { fetcher }));

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result.providers).toEqual(["TinyFish Search"]);
        expect(result.searchCostCny).toBe(0);
        expect(result.sources).toHaveLength(9);
        expect(result.sources.map(source => source.originalRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("uses Octen after TinyFish is unavailable and sends the production request shape", async () => {
        mockSearchRuntimeConfig({ octenApiKey: "octen-test-key" });
        const fetcher = vi.fn<typeof fetch>(async (input, init) => {
            expect(String(input)).toBe("https://api.octen.ai/search");
            expect(init?.method).toBe("POST");
            expect(new Headers(init?.headers).get("x-api-key")).toBe("octen-test-key");
            expect(JSON.parse(String(init?.body))).toEqual({ query: "Octen evidence", count: 8 });
            return Response.json({ data: { results: [
                { title: "Octen first", url: "https://example.org/octen/1", highlight: "First highlight" },
                { title: "Octen second", url: "https://example.org/octen/2", highlight: "Second highlight" }
            ] } });
        });

        const result = await cls.init(() => searchReadWeaveActiveEvidence({
            query: "Octen evidence", provider: "general", budgetCny: 0.0072
        }, { fetcher }));

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result.providers).toEqual(["Octen Search"]);
        expect(result.searchCostCny).toBe(0.0072);
        expect(result.sources.map(source => source.snippet)).toEqual(["First highlight", "Second highlight"]);
    });

    it("uses Parallel after earlier providers are unavailable and keeps all excerpts", async () => {
        mockSearchRuntimeConfig({ parallelApiKey: "parallel-test-key" });
        const fetcher = vi.fn<typeof fetch>(async (input, init) => {
            expect(String(input)).toBe("https://api.parallel.ai/v1/search");
            expect(init?.method).toBe("POST");
            expect(new Headers(init?.headers).get("x-api-key")).toBe("parallel-test-key");
            expect(JSON.parse(String(init?.body))).toEqual({
                objective: "Parallel evidence",
                search_queries: ["Parallel evidence"],
                mode: "turbo",
                advanced_settings: {
                    max_results: 8,
                    excerpt_settings: { max_chars_per_result: 2000 }
                }
            });
            return Response.json({ results: [ {
                title: "Parallel result",
                url: "https://example.org/parallel/1",
                excerpts: ["First excerpt", "Second excerpt"]
            } ] });
        });

        const result = await cls.init(() => searchReadWeaveActiveEvidence({
            query: "Parallel evidence", provider: "general", budgetCny: 0.0072
        }, { fetcher }));

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result.providers).toEqual(["Parallel Search"]);
        expect(result.searchCostCny).toBe(0.0072);
        expect(result.sources[0].snippet).toBe("First excerpt Second excerpt");
    });

    it.each([
        ["TinyFish Search", { tinyFishApiKey: "invalid" }, "api.search.tinyfish.ai"],
        ["Octen Search", { octenApiKey: "invalid" }, "api.octen.ai"],
        ["Parallel Search", { parallelApiKey: "invalid" }, "api.parallel.ai"]
    ] as const)("reports %s authentication errors and continues to the free fallback", async (provider, keys, host) => {
        mockSearchRuntimeConfig(keys);
        const fetcher = vi.fn<typeof fetch>(async input => {
            const url = new URL(String(input));
            if (url.hostname === host) return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
            if (url.hostname.endsWith("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        });

        const result = await cls.init(() => searchReadWeaveActiveEvidence({
            query: `${provider} error`, provider: "general", budgetCny: 0.02
        }, { fetcher }));

        expect(result.warnings).toContain(`${provider}: HTTP 401`);
        expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).hostname === host)).toBe(true);
        expect(result.providers.at(-1)).toBe("Wikipedia");
    });

    it.each([
        ["TinyFish Search", "api.search.tinyfish.ai"],
        ["Octen Search", "api.octen.ai"],
        ["Parallel Search", "api.parallel.ai"]
    ] as const)("skips %s when its API key is missing", async (_provider, host) => {
        mockSearchRuntimeConfig({});
        const fetcher = vi.fn<typeof fetch>(async input => {
            const url = new URL(String(input));
            if (url.hostname.endsWith("wikipedia.org")) return Response.json({ query: { pages: {} } });
            throw new Error(`Unexpected URL ${url}`);
        });

        const result = await cls.init(() => searchReadWeaveActiveEvidence({
            query: "missing provider key", provider: "general", budgetCny: 0.02
        }, { fetcher }));

        expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).hostname === host)).toBe(false);
        expect(result.providers).toEqual(["Wikipedia"]);
    });
    afterEach(() => vi.restoreAllMocks());
    it("preserves prepared English full-name queries as well as origin queries", () => {
        for (const query of [ '"XPT" full name official documentation',
            '"Lumen" origin of name', "site:example.com XPT specification" ])
            expect(buildFocusedGeneralSearchQuery(query)).toBe(query);
    });
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    beforeEach(() => {
        clearReadWeaveSearchCacheForTests();
        vi.mocked(undiciFetch).mockReset();
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.009,
                clearSerperApiKey: true,
                clearTavilyApiKey: true,
                clearBraveApiKey: true,
                clearJinaApiKey: true,
                clearExaApiKey: true
            });
        });
    });

    it.each([
        "截至 2026 年 7 月，DeepSeek API 当前提供哪些正式模型名称",
        "截至 2026 年，某研究机构的现任负责人是谁",
        "Moongon Jung researcher",
        "周志华 官方主页 大学 教授 研究方向",
        "Who is Ada Example and how does SRAM work"
    ])("preserves the complete evidence question: %s", query => {
        expect(buildFocusedGeneralSearchQuery(query)).toBe(query);
    });

    it("admits a first-party personal homepage instead of dropping non-edu domains", async () => {
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.009,
                serperApiKey: "serper-test-key"
            });
        });
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            if (url.includes("google.serper.dev")) {
                return Response.json({ organic: [ {
                    title: "Wuxi Li - Homepage",
                    link: "https://wuxili.net/",
                    snippet: "Wuxi Li Principal Software Engineer at AMD/Xilinx"
                } ] });
            }
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            if (url.includes("api.openalex.org/authors")) return Response.json({ results: [] });
            if (url.includes("pub.orcid.org")) return Response.json({});
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Wuxi Li researcher profile current affiliation",
            kind: "question",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(result.sources[0]).toMatchObject({
            url: "https://wuxili.net/",
            sourceCategory: "first-party-personal",
            evidenceFamily: "SELF",
            originalRank: 1,
            retrievalMode: "raw-serp"
        });
    });
    it("gives the primary search a bounded ten-second window without retrying", async () => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl:"https://api.deepseek.com",model:"deepseek-v4-flash",
            searchMode:"automatic",searchBudgetCny:.009,serperApiKey:"serper-test-key"
        }));
        const timeout = vi.spyOn(AbortSignal, "timeout");
        let calls = 0;
        try {
            await cls.init(() => searchReadWeaveEvidence({
                query:'"Lumen" origin of name',force:true,forcePaidFallback:true
            }, { bypassCache:true,fetcher:async (input, init) => {
                if (String(input).includes("google.serper.dev")) {
                    calls++;
                    expect(JSON.parse(String(init?.body)).q).toBe('"Lumen" origin of name');
                    return Response.json({ organic:[ {
                        title:"Lumen",link:"https://lumen.org",snippet:"Lumen is named after light"
                    } ] });
                }
                return Response.json({ query:{ pages:{} } });
            } }));
            expect(calls).toBe(1);
            expect(timeout).toHaveBeenCalledWith(10_000);
        } finally {
            timeout.mockRestore();
        }
    });

    it("uses Exa as an explicitly requested fallback within the same budget", async () => {
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.06,
                serperApiKey: "serper-test-key",
                exaApiKey: "exa-test-key"
            });
        });
        const requested: string[] = [];
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            const url = input.toString();
            requested.push(url);
            if (url.includes("google.serper.dev")) return Response.json({ organic: [] });
            if (url.includes("api.exa.ai/search")) return Response.json({ results: [ {
                title: "Wuxi Li personal site", url: "https://wuxili.net/", text: "Wuxi Li AMD/Xilinx"
            } ] });
            if (url.includes("wikipedia.org")) return Response.json({ query: { pages: {} } });
            if (url.includes("api.openalex.org/authors")) return Response.json({ results: [] });
            if (url.includes("pub.orcid.org")) return Response.json({});
            throw new Error(`Unexpected URL ${url}`);
        }) as unknown as typeof fetch;

        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Wuxi Li researcher profile current affiliation",
            resourceHints: ["person"],
            kind: "question",
            force: true
        }, { fetcher, bypassCache: true }));

        expect(requested.some(url => url.includes("google.serper.dev"))).toBe(true);
        expect(requested.some(url => url.includes("api.exa.ai/search"))).toBe(true);
        expect(result.providers).toContain("Exa People");
        expect(result.searchCostCny).toBeCloseTo(0.0576, 4);
    });

    it("uses Jina as a page reader and preserves page text separately from search ranking", async () => {
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                jinaApiKey: "jina-test-key"
            });
        });
        const fetcher = vi.fn(async (input: string | URL | globalThis.Request) => {
            expect(input.toString()).toBe("https://r.jina.ai/https://wuxili.net/");
            return new Response("# Wuxi Li\nPrincipal Software Engineer at AMD/Xilinx", { status: 200 });
        }) as unknown as typeof fetch;

        await expect(readReadWeavePageWithJina("https://wuxili.net/", { fetcher }))
            .resolves.toContain("Principal Software Engineer at AMD/Xilinx");
    });
    it("preserves complete anonymous pages without provider-side token clipping", async () => {
        const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            expect(headers.get("Authorization")).toBeNull();
            expect(headers.get("X-Token-Budget")).toBeNull();
            expect(headers.get("X-Max-Tokens")).toBeNull();
            const text = `${"Introduction ".repeat(2100)}The author decided to call it Lumen.`;
            return new Response(text, { status: 200 });
        }) as unknown as typeof fetch;
        await expect(readReadWeavePageWithJina(
            "https://example.org/faq", { fetcher, anonymous: true }
        )).resolves.toContain("decided to call it Lumen");
    });

    it("keeps Markdown headings and creates equivalent boundaries for direct HTML fallback", () => {
        const markdown = "# Document\n\n## 9.2.2 Idempotent Methods\n\nComplete section text";
        expect(normalizeReadWeavePageContent(markdown)).toBe(markdown);
        expect(normalizeReadWeavePageContent(
            "<html><h2 id=\"section-9.2.2\">9.2.2 Idempotent Methods</h2><p>Complete section text</p></html>", true
        )).toContain("## 9.2.2 Idempotent Methods\nComplete section text");
    });

    it.each(["DBLP 是什么", "Naifeng Jing researcher professor profile",
        "10.1109/TEST.2015.7342405 是什么", "NPU definition", "NPU Researcher professor profile"])(
        "leaves alternatives to evidence-need scheduling: %s", query => {
            expect(buildFocusedGeneralSearchQuery(query)).toBe(query);
            expect(buildReadWeaveSearchVariants(query)).toEqual([query]);
        }
    );

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
        cls.init(() => {
            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "off",
                searchBudgetCny: 0.009
            });
        });
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
            query: "Sung Kyu Lim researcher professor profile"
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
            query: "Sung Kyu Lim current professor faculty official profile 2026 ORCID 0000-0002-2267-5282",
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

    const allowedPolicy = (): ReadWeaveSearchPolicy => ({
        externalSearch: "allowed", allowedSourceScopes: ["provided", "public"],
        allowedCapabilities: ["search", "page_read"]
    });
    const entrypoints = ["search", "plan", "reader", "anonymous-reader", "settings-test"] as const;
    const invoke = (entry: typeof entrypoints[number], fetcher: typeof fetch) => {
        const input = { query: "DBLP ORCID DAX Direct Access DeepSeek current model names paper",
            force: true, resourceHints: ["person"] };
        if (entry === "search") return searchReadWeaveEvidence(input, { fetcher });
        if (entry === "plan") return searchReadWeaveEvidencePlan(input, { fetcher });
        if (entry === "settings-test") return testReadWeaveSearch(input.query);
        return readReadWeavePageWithJina("https://wuxili.net/", { fetcher, anonymous: entry === "anonymous-reader" });
    };

    it.each(entrypoints)("blocks all HTTP at %s when the scoped policy is off", async entry => {
        const fetcher = vi.fn<typeof fetch>();
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), externalSearch: "off"
        }, () => invoke(entry, fetcher)));
        expect(fetcher).not.toHaveBeenCalled();
        expect(undiciFetch).not.toHaveBeenCalled();
    });

    it.each(entrypoints)("propagates scoped cancellation at %s before HTTP", async entry => {
        const controller = new AbortController();
        controller.abort();
        const fetcher = vi.fn<typeof fetch>();
        await expect(cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), signal: controller.signal
        }, () => invoke(entry, fetcher)))).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
        expect(undiciFetch).not.toHaveBeenCalled();
    });

    it.each(entrypoints)("lets a task-scoped grant override the obsolete global setting at %s", async entry => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", searchMode: "off", jinaApiKey: "test-key"
        }));
        const fetcherMock = vi.fn(async () => new Response("{}", {
            status: 200, headers: { "Content-Type": "application/json" }
        }));
        const fetcher = fetcherMock as unknown as typeof fetch;
        await cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () => invoke(entry, fetcher)));
        expect(fetcherMock.mock.calls.length + vi.mocked(undiciFetch).mock.calls.length).toBeGreaterThan(0);
    });

    it.each(entrypoints)("requires public source scope at %s even when search is required", async entry => {
        const fetcher = vi.fn<typeof fetch>();
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), externalSearch: "required", allowedSourceScopes: ["provided"]
        }, () => invoke(entry, fetcher)));
        expect(fetcher).not.toHaveBeenCalled();
        expect(undiciFetch).not.toHaveBeenCalled();
    });

    it.each(entrypoints)("cannot broaden an outer off policy in a nested scope at %s", async entry => {
        const fetcher = vi.fn<typeof fetch>();
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), externalSearch: "off"
        }, () => withReadWeaveSearchPolicy(allowedPolicy(), () => invoke(entry, fetcher))));
        expect(fetcher).not.toHaveBeenCalled();
        expect(undiciFetch).not.toHaveBeenCalled();
    });

    it("blocks raw official HTML extraction while permitting search APIs", async () => {
        const fetcher = vi.fn<typeof fetch>(async () => Response.json({ query: { pages: {} } }));
        const result = await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), allowedCapabilities: ["search"]
        }, () => searchReadWeaveEvidence({
            query: "DBLP ORCID identifier meaning DAX Direct Access DeepSeek current model names",
            force: true, allowPaid: false
        }, { fetcher })));
        const urls = fetcher.mock.calls.map(call => String(call[0]));
        expect(urls.some(url => url.includes("wikipedia.org"))).toBe(true);
        expect(urls.some(url => /dblp.org\/faq|info.orcid.org|docs.kernel.org|api-docs.deepseek.com/u.test(url))).toBe(false);
        expect(result.warnings.some(warning => warning.includes("not permitted"))).toBe(true);
    });

    it("blocks profile-page extraction discovered through an ORCID API result", async () => {
        const fetcher = vi.fn(async (resource: Parameters<typeof fetch>[0]) => {
            if (String(resource).includes("/employments")) return Response.json({
                "affiliation-group": [{ summaries: [{ "employment-summary": {
                    "put-code": 1, "end-date": null, organization: { name: "Example University" },
                    source: { "source-name": { value: "Ada Example" } }, url: { value: "https://faculty.public.edu/" }
                } }] }]
            });
            return Response.json({});
        });
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), allowedCapabilities: ["search"]
        }, () => searchReadWeaveEvidence({
            query: "Ada Example current affiliation 0000-0002-2267-5282", force: true, allowPaid: false
        }, { fetcher })));
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("/employments"))).toBe(true);
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("wp-json"))).toBe(false);
    });

    it.each([
        "http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/",
        "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/",
        "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://localhost/",
        "http://office.internal/", "http://127.0.0.1.nip.io/", "https://user:secret@example.com/"
    ])("rejects private or credentialed reader targets: %s", async url => {
        const fetcher = vi.fn<typeof fetch>();
        await cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            readReadWeavePageWithJina(url, { fetcher, anonymous: true })));
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("rejects an embedded private target hidden behind another reader URL", async () => {
        const fetcher = vi.fn<typeof fetch>();
        await expect(cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            readReadWeavePageWithJina("https://r.jina.ai/http://127.0.0.1/", { fetcher, anonymous: true })
        ))).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("checks the reader target's DNS before requesting the proxy in production", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "10.0.0.1", family: 4 }] as never);
        await expect(cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            readReadWeavePageWithJina("https://wuxili.net/", { anonymous: true })
        ))).rejects.toThrow(/private|internal/u);
        expect(undiciFetch).not.toHaveBeenCalled();
    });

    it("uses validated DNS, manual redirects and cancellation in the default transport", async () => {
        const lookup = vi.spyOn(dns.promises, "lookup")
            .mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
        vi.mocked(undiciFetch).mockResolvedValue(Response.json({ query: { pages: {} } }) as never);
        const controller = new AbortController();
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), signal: controller.signal
        }, () => testReadWeaveSearch("a neutral query")));
        expect(lookup).toHaveBeenCalled();
        expect(undiciFetch).toHaveBeenCalledTimes(1);
        const init = vi.mocked(undiciFetch).mock.calls[0][1]!;
        expect(init.redirect).toBe("manual");
        expect(init.dispatcher).toBeDefined();
        expect(init.signal?.aborted).toBe(false);
        controller.abort();
        expect(init.signal?.aborted).toBe(true);
    });

    it.each(["throw", "reject"])("preserves retrieved page text when dispatcher cleanup fails: %s", async failure => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
        vi.mocked(undiciFetch).mockResolvedValue(new Response("Retrieved page text") as never);
        const destroy = vi.spyOn(Agent.prototype, "destroy");
        if (failure === "throw") destroy.mockImplementation(() => { throw new Error("cleanup failed"); });
        else destroy.mockRejectedValue(new Error("cleanup failed"));
        await expect(cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            readReadWeavePageWithJina("https://wuxili.net/", { anonymous: true })
        ))).resolves.toBe("Retrieved page text");
        expect(destroy).toHaveBeenCalled();
    });

    it("allows page reads without granting search capability", async () => {
        const fetcher = vi.fn<typeof fetch>(async () => new Response("Page text"));
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), allowedCapabilities: ["page_read"]
        }, async () => {
            expect((await searchReadWeaveEvidence({ query: "neutral", force: true }, { fetcher })).used).toBe(false);
            expect(await readReadWeavePageWithJina("https://wuxili.net/", { fetcher, anonymous: true })).toBe("Page text");
        }));
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("rejects cross-origin redirects without forwarding provider credentials", async () => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", serperApiKey: "test-only"
        }));
        const fetcher = vi.fn(async (resource: Parameters<typeof fetch>[0]) =>
            String(resource).includes("serper")
                ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
                : Response.json({ query: { pages: {} } }));
        const result = await cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            searchReadWeaveEvidence({ query: "neutral", force: true }, { fetcher })));
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("127.0.0.1"))).toBe(false);
        expect(result.searchCostCny).toBeCloseTo(.0072);
    });

    it("rechecks capability on same-origin redirects from an API to a raw page", async () => {
        const fetcher = vi.fn(async (resource: Parameters<typeof fetch>[0]) =>
            String(resource).includes("dblp.org/search/publ/api")
                ? new Response(null, { status: 302, headers: { location: "/faq/1474577.html" } })
                : Response.json({}));
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), allowedCapabilities: ["search"]
        }, () => searchReadWeaveEvidence({ query: "paper", force: true, allowPaid: false }, { fetcher })));
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("/search/publ/api"))).toBe(true);
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("/faq/"))).toBe(false);
    });

    it("rechecks revocation before a same-origin redirect starts", async () => {
        const policy = allowedPolicy();
        const fetcher = vi.fn(async () => {
            policy.externalSearch = "off";
            return new Response(null, { status: 302, headers: { location: "/next" } });
        });
        await cls.init(() => withReadWeaveSearchPolicy(policy, () =>
            searchReadWeaveEvidence({ query: "neutral", force: true, allowPaid: false }, { fetcher })));
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("does not retry HTTP 503 or start a fallback after cancellation", async () => {
        const controller = new AbortController();
        const fetcher = vi.fn(async () => {
            controller.abort();
            return new Response("retry later", { status: 503 });
        });
        await expect(cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), signal: controller.signal
        }, () => searchReadWeaveEvidence({ query: "neutral", force: true }, { fetcher })))).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("propagates cancellation during page extraction through the combined transport signal", async () => {
        const controller = new AbortController();
        const fetcher = vi.fn(async (_resource: Parameters<typeof fetch>[0], init?: RequestInit) => {
            controller.abort();
            expect(init?.signal?.aborted).toBe(true);
            return new Response("late page");
        });
        await expect(cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), signal: controller.signal
        }, () => readReadWeavePageWithJina("https://wuxili.net/", { fetcher, anonymous: true })))).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("reuses cache only within a scope and never returns it after cancellation or denial", async () => {
        const fetcher = vi.fn(async () => Response.json({ query: { pages: {
            1: { title: "Evidence", fullurl: "https://wuxili.net/", extract: "Candidate text" }
        } } }));
        const input = { query: "neutral", force: true, allowPaid: false };
        const controller = new AbortController();
        await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), signal: controller.signal
        }, async () => {
            await searchReadWeaveEvidence(input, { fetcher });
            expect((await searchReadWeaveEvidence(input, { fetcher })).cacheHit).toBe(true);
            controller.abort();
            await expect(searchReadWeaveEvidence(input, { fetcher })).rejects.toThrow();
        }));
        await cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () => searchReadWeaveEvidence(input, { fetcher })));
        const off = await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), externalSearch: "off"
        }, () => searchReadWeaveEvidence(input, { fetcher })));
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(off.used).toBe(false);
        expect(off.cacheHit).toBe(false);
    });

    it("lets an authorized task search override an obsolete global off option", async () => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            searchMode: "off"
        }));
        const fetcher = vi.fn(async () => Response.json({ query: { pages: {
            1: { title: "Evidence", fullurl: "https://example.org/evidence", extract: "Relevant evidence" }
        } } }));

        const result = await cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            searchReadWeaveEvidence({ query: "authorized evidence", force: true, allowPaid: false }, { fetcher })));

        expect(result.query).toBe("authorized evidence");
        expect(fetcher).toHaveBeenCalled();
    });

    it("does not join an allowed request's in-flight operation from an off scope", async () => {
        let release!: (response: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
        const active = cls.init(() => withReadWeaveSearchPolicy(allowedPolicy(), () =>
            searchReadWeaveEvidence({ query: "neutral", force: true, allowPaid: false }, { fetcher })));
        const denied = await cls.init(() => withReadWeaveSearchPolicy({
            ...allowedPolicy(), externalSearch: "off"
        }, () => searchReadWeaveEvidence({ query: "neutral", force: true, allowPaid: false }, { fetcher })));
        expect(denied.used).toBe(false);
        expect(fetcher).toHaveBeenCalledTimes(1);
        release(Response.json({ query: { pages: {} } }));
        await active;
    });

    it("does not select people providers from whole-question text or nearby author context", async () => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash",
            serperApiKey: "test-only", exaApiKey: "test-only", searchBudgetCny: .06
        }));
        const fetcher = vi.fn(async (resource: Parameters<typeof fetch>[0], init?: RequestInit) => {
            if (String(resource).includes("serper")) {
                expect(JSON.parse(String(init?.body)).q).toBe("Who is Ada Example and how does SRAM work");
                return Response.json({ organic: [] });
            }
            return Response.json({ query: { pages: {} } });
        });
        await cls.init(() => searchReadWeaveEvidence({
            query: "Who is Ada Example and how does SRAM work", force: true,
            context: "Professor Ada, researcher, ORCID 0000-0002-2267-5282"
        }, { fetcher }));
        expect(fetcher.mock.calls.some(([url]) => /exa.ai|openalex.org\/authors|pub.orcid.org/u.test(String(url)))).toBe(false);
    });

    it.each([false, true])("keeps a general provider success when person resource hint=%s", async hint => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash",
            serperApiKey: "test-only", exaApiKey: "test-only", searchBudgetCny: .06
        }));
        const fetcher = vi.fn(async (resource: Parameters<typeof fetch>[0]) =>
            String(resource).includes("serper")
                ? Response.json({ organic: [{ title: "Ada Example", link: "https://wuxili.net/", snippet: "Candidate" }] })
                : Response.json({}));
        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Ada Example affiliation", force: true, resourceHints: hint ? ["person"] : []
        }, { fetcher }));
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("exa.ai"))).toBe(false);
        expect(result.searchCostCny).toBeCloseTo(.0072);
    });

    it("never expands the allowance to pay for an advisory Exa request", async () => {
        cls.init(() => updateReadWeaveAiSettings({
            baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", exaApiKey: "test-only"
        }));
        const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
        const result = await cls.init(() => searchReadWeaveEvidence({
            query: "Ada Example affiliation", force: true, resourceHints: ["person"], budgetCny: .009
        }, { fetcher }));
        expect(fetcher.mock.calls.some(([url]) => String(url).includes("exa.ai"))).toBe(false);
        expect(result.searchCostCny).toBe(0);
    });

});
