import { AsyncLocalStorage } from "node:async_hooks";

import type { ReadWeaveObjectKind, ReadWeaveSearchTestResult } from "@triliumnext/commons";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

import { getReadWeaveSearchRuntimeConfig, type ReadWeaveSearchRuntimeConfig } from "./readweave_settings.js";
import { validateHostResolution } from "./safe_fetch.js";

const PROVIDER_TIMEOUT_MS = 5_500;
const SERPER_PROVIDER_TIMEOUT_MS = 10_000;
const TAVILY_PROVIDER_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CURRENT_CACHE_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 300;
const CNY_PER_USD = 7.2;

export interface ReadWeaveSearchSource {
    provider: string;
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
    score: number;
    originalRank?: number;
    sourceCategory?: "first-party-personal" | "official-profile" | "institution" | "conference" | "registry" | "academic-index" | "secondary" | "search-result";
    evidenceFamily?: "SELF" | "EMPLOYER" | "INSTITUTION" | "CONFERENCE" | "REGISTRY" | "ACADEMIC" | "MEDIA" | "SEARCH";
    retrievalMode?: "structured" | "raw-serp" | "semantic" | "page-reader";
    content?: string;
}

export interface ReadWeaveSearchEvidence {
    used: boolean;
    query: string;
    sources: ReadWeaveSearchSource[];
    providers: string[];
    memo: string;
    warnings: string[];
    elapsedMs: number;
    cacheHit: boolean;
    searchCostCny: number;
}

interface SearchInput {
    /** Server-owned remaining allowance shared by the current research task. */
    budgetCny?: number;
    query: string;
    context?: string;
    kind?: ReadWeaveObjectKind;
    /** Advisory resources for this query only; never a budget or permission grant. */
    resourceHints?: readonly string[];
    force?: boolean;
    localEvidenceSufficient?: boolean;
    allowPaid?: boolean;
    /**
     * Run one configured general-web adapter even when specialist indexes
     * returned rows. A result count does not prove that the returned evidence
     * covers the proposition the user actually asked about.
     */
    forcePaidFallback?: boolean;
}

interface CachedEvidence {
    expiresAt: number;
    value: ReadWeaveSearchEvidence;
}

type FetchLike = typeof fetch;
type SearchAdapter = (query: string, config: ReadWeaveSearchRuntimeConfig, fetcher: FetchLike) => Promise<ReadWeaveSearchSource[]>;

const cache = new Map<string, CachedEvidence>();
const inFlight = new Map<string, Promise<ReadWeaveSearchEvidence>>();

/** Pass the trusted TaskContract policy.permissions, plus the request signal.
 * Source scopes currently supported by these adapters: public. */
export interface ReadWeaveSearchPolicy {
    externalSearch: "allowed" | "off" | "required";
    allowedSourceScopes: readonly string[];
    allowedCapabilities?: readonly string[];
    signal?: AbortSignal;
}

const searchPolicy = new AsyncLocalStorage<{
    policies: ReadWeaveSearchPolicy[];
    cache: Map<string, CachedEvidence>;
}>();

export function withReadWeaveSearchPolicy<T>(policy: ReadWeaveSearchPolicy, callback: () => T): T {
    return searchPolicy.run({
        policies: [...(searchPolicy.getStore()?.policies ?? []), policy], cache: new Map()
    }, callback);
}

type SearchCapability = "search" | "page_read";

class SearchPolicyError extends Error {
    constructor() { super("External retrieval is not permitted by the scoped policy."); }
}

function checkCancellation(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    for (const policy of searchPolicy.getStore()?.policies ?? []) policy.signal?.throwIfAborted();
}

function canRetrieve(capability: SearchCapability, signal?: AbortSignal): boolean {
    checkCancellation(signal);
    return (searchPolicy.getStore()?.policies ?? []).every(policy =>
            (policy.externalSearch === "allowed" || policy.externalSearch === "required")
            && policy.allowedSourceScopes.includes("public")
            && (!policy.allowedCapabilities || policy.allowedCapabilities.includes(capability)));
}

function requireRetrieval(capability: SearchCapability, signal?: AbortSignal): void {
    if (!canRetrieve(capability, signal)) throw new SearchPolicyError();
}

function networkCapability(url: URL): SearchCapability {
    const host = url.hostname;
    return new Set([
        "api.crossref.org", "api.openalex.org", "api.semanticscholar.org", "pub.orcid.org",
        "api.unpaywall.org", "google.serper.dev", "api.exa.ai", "api.search.brave.com",
        "api.tavily.com", "s.jina.ai", "export.arxiv.org"
    ]).has(host)
        || host.endsWith(".wikipedia.org") && url.pathname === "/w/api.php"
        || host === "dblp.org" && url.pathname === "/search/publ/api"
        || host === "www.ebi.ac.uk" && url.pathname.startsWith("/europepmc/webservices/")
        ? "search" : "page_read";
}

/** One hop with validated, pinned DNS. Redirects belong to the policy wrapper,
 * so no underlying client can follow a redirect outside the gateway. */
async function fetchPublicHop(url: URL, init: RequestInit, check: () => void): Promise<Response> {
    const addresses = await validateHostResolution(url.hostname.replace(/^\[|\]$/gu, ""));
    if (!addresses.length) throw new Error("Could not resolve a public address.");
    check();
    const dispatcher = new Agent({ connect: { lookup: ((_host, options, callback) => {
        const family = typeof options === "number" ? options : options.family;
        const candidates = family ? addresses.filter(address => address.family === family) : addresses;
        if (!candidates.length) { callback(new Error("No permitted address.")); return; }
        if (typeof options === "object" && options.all) callback(null, candidates);
        else callback(null, candidates[0].address, candidates[0].family);
    }) as never } });
    try {
        const response = await undiciFetch(url, { ...init, dispatcher, redirect: "manual" } as UndiciRequestInit);
        check();
        const empty = [204, 205, 304].includes(response.status) || response.status >= 300 && response.status < 400;
        const body = empty ? null : await response.arrayBuffer();
        if (empty) await response.body?.cancel();
        check();
        return new Response(body, { status: response.status, statusText: response.statusText, headers: [...response.headers] });
    } finally {
        // Cleanup failures must not replace the request's evidence or error.
        try { await dispatcher.destroy(); } catch { /* Preserve the request result. */ }
    }
}

function policyFetcher(baseFetcher?: FetchLike, signal?: AbortSignal): FetchLike {
    return async (resource, init: RequestInit = {}) => {
        let current = resource instanceof Request ? resource.url : String(resource);
        const signals = [signal, init.signal, resource instanceof Request ? resource.signal : undefined,
            ...(searchPolicy.getStore()?.policies ?? []).map(policy => policy.signal)]
            .filter((value): value is AbortSignal => !!value);
        const combined = signals.length ? AbortSignal.any(signals) : AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
        const requestInit = { ...init, signal: combined, redirect: "manual" as const };
        for (let hop = 0; hop <= 5; hop++) {
            const normalized = safeUrl(current);
            if (!normalized) throw new Error("Non-public retrieval URL rejected.");
            const url = new URL(normalized);
            const capability = networkCapability(url);
            const check = () => requireRetrieval(capability, combined);
            check();
            if (url.hostname === "r.jina.ai") {
                const target = safeUrl(url.pathname.slice(1) + url.search);
                if (!target) throw new Error("Non-public page target rejected.");
                if (new URL(target).hostname === "r.jina.ai") throw new Error("Nested reader target rejected.");
                // Injected transports are test seams. Production also checks the
                // reader's embedded destination, not merely the proxy hostname.
                if (!baseFetcher) await validateHostResolution(new URL(target).hostname.replace(/^\[|\]$/gu, ""));
                check();
            }
            const response = baseFetcher
                ? await baseFetcher(url.href, requestInit)
                : await fetchPublicHop(url, requestInit, check);
            try { check(); } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
            if (response.status < 300 || response.status >= 400 || response.status === 304) return response;
            const location = response.headers.get("location");
            await response.body?.cancel().catch(() => {});
            if (!location || hop === 5) throw new Error("Retrieval redirect could not be followed safely.");
            const next = new URL(location, url);
            // API credentials and metered POST bodies must never cross origins
            // or be replayed by a provider redirect.
            if (next.origin !== url.origin || (requestInit.method ?? "GET").toUpperCase() !== "GET")
                throw new Error("Cross-origin or non-GET retrieval redirect rejected.");
            current = next.href;
        }
        throw new Error("Retrieval redirect limit reached.");
    };
}

function plainText(value: unknown, _maximum = 700): string {
    if (typeof value !== "string") return "";
    let decoded = value.replace(/<[^>]*>/gu, " ");
    for (let pass = 0; pass < 3; pass++) {
        const next = decoded
            .replace(/&#x([0-9a-f]+);?/giu, (_match, hex: string) =>
                safeSearchCodePoint(Number.parseInt(hex, 16)))
            .replace(/&#([0-9]+);?/gu, (_match, decimal: string) =>
                safeSearchCodePoint(Number.parseInt(decimal, 10)))
            .replace(/&(?:nbsp|#160);?/giu, " ")
            .replace(/&(?:amp|#38);?/giu, "&")
            .replace(/&(?:lt|#60);?/giu, "<")
            .replace(/&(?:gt|#62);?/giu, ">")
            .replace(/&(?:quot|#34);?/giu, "\"")
            .replace(/&(?:apos|#39);?/giu, "'");
        if (next === decoded) break;
        decoded = next;
    }
    return decoded
        .replace(/\s+/gu, " ")
        .trim();
}

/** Preserve complete page structure for semantic extraction. Search snippets
 * may be flattened, but a page reader must retain headings and line boundaries
 * so a URL fragment can resolve a section found anywhere in the document. */
export function normalizeReadWeavePageContent(value: unknown, html = false): string {
    if (typeof value !== "string") return "";
    let decoded = html
        ? value
            .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, " ")
            .replace(/<h([1-6])\b[^>]*>/giu, (_match, level: string) => `\n${"#".repeat(Number(level))} `)
            .replace(/<\/(?:h[1-6]|p|li|section|article|div|tr|table)>/giu, "\n")
            .replace(/<br\s*\/?>/giu, "\n")
            .replace(/<[^>]*>/gu, " ")
        : value;
    for (let pass = 0; pass < 3; pass++) {
        const next = decoded
            .replace(/&#x([0-9a-f]+);?/giu, (_match, hex: string) =>
                safeSearchCodePoint(Number.parseInt(hex, 16)))
            .replace(/&#([0-9]+);?/gu, (_match, decimal: string) =>
                safeSearchCodePoint(Number.parseInt(decimal, 10)))
            .replace(/&(?:nbsp|#160);?/giu, " ")
            .replace(/&(?:amp|#38);?/giu, "&")
            .replace(/&(?:lt|#60);?/giu, "<")
            .replace(/&(?:gt|#62);?/giu, ">")
            .replace(/&(?:quot|#34);?/giu, '"')
            .replace(/&(?:apos|#39);?/giu, "'");
        if (next === decoded) break;
        decoded = next;
    }
    return decoded.normalize("NFKC")
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map(line => line.replace(/[ \t]+/gu, " ").trim())
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

function safeSearchCodePoint(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 0x10FFFF
        || value >= 0xD800 && value <= 0xDFFF) return "";
    return String.fromCodePoint(value);
}

function safeUrl(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:" || url.username || url.password) return "";
        const host = url.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
        if (ipaddr.isValid(host)) {
            const address = ipaddr.parse(host);
            if (address.range() !== "unicast") return "";
        } else if (!host.includes(".") || /(?:^|\.)(?:localhost|local|localdomain|internal|invalid|test|lan|home|corp|onion|alt|arpa)$/u.test(host)
            || /(?:^|\.)(?:nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/u.test(host)) return "";
        return url.toString();
    } catch {
        return "";
    }
}

function source(
    provider: string,
    title: unknown,
    url: unknown,
    snippet: unknown,
    publishedAt?: unknown,
    score = 0,
    metadata: Pick<ReadWeaveSearchSource, "originalRank" | "sourceCategory" | "evidenceFamily" | "retrievalMode"> = {}
): ReadWeaveSearchSource | undefined {
    const normalizedTitle = plainText(title, 300);
    const normalizedUrl = safeUrl(url);
    if (!normalizedTitle || !normalizedUrl) return undefined;
    let normalizedSnippet = plainText(snippet);
    if (/^(?:www\.)?linkedin\.com$/iu.test(new URL(normalizedUrl).hostname)) {
        // Public profile search snippets often append the person's activity
        // feed. Posts they liked or replied to describe other people and must
        // never be treated as the profile owner's biography or awards.
        normalizedSnippet = normalizedSnippet
            .split(/(?:##\s*Activity\b|public_profile__reactions|\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,5}\s+(?:liked|replied)\b)/u)[0]
            .split(/(?:\[\.\.\.\]|###\s*N\/A\b)/u)[0]
            .replace(/##\s*About\b[\s\S]*?(?=##\s*(?:Experience|Education)\b)/iu, "")
            .replace(/\b\d+[\s,]+(?:followers|connections)\b/giu, "")
            .trim();

        // Some providers flatten the public profile header to
        // “# Person Company Location ## Experience”. Label the company field
        // so the writer does not confuse a visible current affiliation with a
        // hidden Experience detail section.
        const profileName = normalizedTitle
            .replace(/\s+[-–—]\s*.+?\s*\|\s*LinkedIn$/iu, "")
            .replace(/\s*\|\s*LinkedIn$/iu, "")
            .trim();
        const escapedTitle = profileName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const profileHeader = normalizedSnippet.match(new RegExp(
            `^#?\\s*${escapedTitle}\\s+(.+?)(?=\\s+##\\s*(?:Experience|Education)\\b)`,
            "iu"
        ))?.[1]?.trim();
        const company = profileHeader?.split(
            /\s+(?=(?:San Francisco Bay Area|Greater\s+[A-Z][^,]{0,50}\s+Area|[A-Z][A-Za-z .'-]+,\s*(?:CA|US|USA|United States|Canada|UK|United Kingdom))\b)/u
        )[0]?.replace(/[#,]+$/gu, "").trim();
        if (company && company.length <= 100 && !/^(?:N\/?A|None|-+)$/iu.test(company)) {
            normalizedSnippet = `公开职业资料页当前机构：${company}；${normalizedSnippet}`;
        }
    }
    return {
        provider,
        title: normalizedTitle,
        url: normalizedUrl,
        snippet: normalizedSnippet,
        publishedAt: typeof publishedAt === "string" ? plainText(publishedAt, 80) : undefined,
        score,
        ...metadata
    };
}

function classifySearchSource(
    item: ReadWeaveSearchSource,
    query = ""
): Pick<ReadWeaveSearchSource, "sourceCategory" | "evidenceFamily"> {
    const provider = item.provider.toLocaleLowerCase();
    const text = `${item.title}\n${item.snippet}`.normalize("NFKC");
    let hostname = "";
    let pathname = "";
    try {
        const url = new URL(item.url);
        hostname = url.hostname.toLocaleLowerCase();
        pathname = url.pathname.toLocaleLowerCase();
    } catch {
        return { sourceCategory: "search-result", evidenceFamily: "SEARCH" };
    }
    if (/(?:orcid)/u.test(provider) || /^(?:www\.)?orcid\.org$/u.test(hostname)) {
        return { sourceCategory: "registry", evidenceFamily: "REGISTRY" };
    }
    if (/(?:openalex|crossref|dblp|semantic scholar|europe pmc|arxiv|unpaywall)/u.test(provider)
        || /(?:openalex\.org|crossref\.org|dblp\.org|semanticscholar\.org|arxiv\.org|europepmc\.org)$/u.test(hostname)) {
        return { sourceCategory: "academic-index", evidenceFamily: "ACADEMIC" };
    }
    if (/(?:conference|committee|symposium|technical program|会议|委员会|大会)/iu.test(text)) {
        return { sourceCategory: "conference", evidenceFamily: "CONFERENCE" };
    }
    if (/(?:university|college|institute|school|大学|学院|研究所)/iu.test(hostname + text)
        && /(?:faculty|people|profile|directory|staff|教授|研究员|教师|个人主页)/iu.test(pathname + text)) {
        return { sourceCategory: "institution", evidenceFamily: "INSTITUTION" };
    }
    if (/(?:official profile|官方主页|employer|雇主|company|公司|careers|团队)/iu.test(provider + text)
        && /(?:\.com|\.co\.|\.org|\.net)$/u.test(hostname)) {
        return { sourceCategory: "official-profile", evidenceFamily: "EMPLOYER" };
    }
    const normalizedQuery = query.toLocaleLowerCase();
    const queryNameTokens = Array.from(normalizedQuery.matchAll(/[a-z][a-z'’-]{1,}/giu), match => match[0])
        .filter(token => !/^(?:official|primary|source|profile|researcher|current|affiliation|present|who|is)$/u.test(token));
    const nameMentioned = queryNameTokens.length > 0
        && queryNameTokens.every(token => text.toLocaleLowerCase().includes(token));
    if (nameMentioned && (pathname === "/" || /(?:about|bio|profile|people|person|cv|resume|research)/u.test(pathname))) {
        return { sourceCategory: "first-party-personal", evidenceFamily: "SELF" };
    }
    if (/(?:wikipedia|news|medium|press|媒体|新闻)/u.test(provider + hostname)) {
        return { sourceCategory: "secondary", evidenceFamily: "MEDIA" };
    }
    return { sourceCategory: "search-result", evidenceFamily: "SEARCH" };
}

async function fetchJson<T>(
    fetcher: FetchLike,
    url: string,
    init: RequestInit = {},
    timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<T> {
    let lastError = "request failed";
    const metered = /(?:serper\.dev|exa\.ai|tavily\.com|search\.brave\.com|jina\.ai)/u.test(url);
    for (let attempt = 0; attempt < (metered ? 1 : 2); attempt++) {
        const response = await fetcher(url, {
            ...init,
            headers: {
                "Accept": "application/json",
                // Wikimedia and several scholarly APIs reject anonymous or
                // non-contactable bot identifiers. Keep a stable project URL
                // here so free-source verification remains standards-compliant.
                "User-Agent": "ReadWeave/0.104.0 (https://github.com/AIALRA-0/ReadWeave)",
                ...init.headers
            },
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (response.ok) return await response.json() as T;
        lastError = `${response.status} ${response.statusText}`.trim();
        if (!metered && attempt === 0 && (response.status === 429 || response.status >= 500)) {
            await new Promise(resolve => setTimeout(resolve, 350));
            continue;
        }
        break;
    }
    throw new Error(lastError);
}

const crossrefSearch: SearchAdapter = async (query, _config, fetcher) => {
    interface Payload {
        message?: {
            items?: Array<{
                DOI?: string;
                title?: string[];
                URL?: string;
                abstract?: string;
                publisher?: string;
                published?: { "date-parts"?: number[][] };
            }>;
        };
    }
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", query);
    url.searchParams.set("rows", "3");
    const payload = await fetchJson<Payload>(fetcher, url.toString());
    return (payload.message?.items ?? []).flatMap((item, index) => {
        const value = source(
            "Crossref",
            item.title?.[0],
            item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
            [ item.abstract, item.publisher, item.DOI ? `DOI ${item.DOI}` : "" ].filter(Boolean).join("；"),
            item.published?.["date-parts"]?.[0]?.join("-"),
            90 - index
        );
        return value ? [ value ] : [];
    });
};

const dblpSearch: SearchAdapter = async (query, _config, fetcher) => {
    interface Payload {
        result?: {
            hits?: {
                hit?: Array<{
                    info?: { title?: string; url?: string; ee?: string; venue?: string; year?: string; authors?: { author?: Array<string | { text?: string }> } };
                }>;
            };
        };
    }
    const url = new URL("https://dblp.org/search/publ/api");
    url.searchParams.set("q", query);
    url.searchParams.set("h", "3");
    url.searchParams.set("format", "json");
    const payload = await fetchJson<Payload>(fetcher, url.toString());
    return (payload.result?.hits?.hit ?? []).flatMap((hit, index) => {
        const info = hit.info;
        const authors = info?.authors?.author?.map(author => typeof author === "string" ? author : author.text).filter(Boolean).join(", ");
        const value = source(
            "DBLP",
            info?.title,
            info?.ee || info?.url,
            [ authors, info?.venue, info?.year ].filter(Boolean).join("；"),
            info?.year,
            88 - index
        );
        return value ? [ value ] : [];
    });
};

const openAlexSearch: SearchAdapter = async (query, config, fetcher) => {
    interface Payload {
        results?: Array<{
            title?: string;
            doi?: string;
            id?: string;
            publication_year?: number;
            primary_location?: { source?: { display_name?: string }; landing_page_url?: string };
            authorships?: Array<{ author?: { display_name?: string } }>;
        }>;
    }
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", "3");
    if (config.openAlexApiKey) url.searchParams.set("api_key", config.openAlexApiKey);
    const payload = await fetchJson<Payload>(fetcher, url.toString());
    return (payload.results ?? []).flatMap((item, index) => {
        const value = source(
            "OpenAlex",
            item.title,
            item.doi || item.primary_location?.landing_page_url || item.id,
            [
                item.authorships?.map(authorship => authorship.author?.display_name).filter(Boolean).join(", "),
                item.primary_location?.source?.display_name,
                item.publication_year
            ].filter(Boolean).join("；"),
            item.publication_year?.toString(),
            87 - index
        );
        return value ? [ value ] : [];
    });
};

const openAlexAuthorSearch: SearchAdapter = async (query, config, fetcher) => {
    interface Payload {
        results?: Array<{
            id?: string;
            display_name?: string;
            orcid?: string;
            works_count?: number;
            cited_by_count?: number;
            last_known_institutions?: Array<{ display_name?: string; country_code?: string }>;
            topics?: Array<{ display_name?: string; count?: number }>;
        }>;
    }
    const url = new URL("https://api.openalex.org/authors");
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", "3");
    if (config.openAlexApiKey) url.searchParams.set("api_key", config.openAlexApiKey);
    const payload = await fetchJson<Payload>(fetcher, url.toString());
    return (payload.results ?? []).flatMap((item, index) => {
        const institutions = item.last_known_institutions
            ?.map(institution => [ institution.display_name, institution.country_code ].filter(Boolean).join(" "))
            .filter(Boolean)
            .join("、");
        const topics = item.topics
            ?.toSorted((left, right) => (right.count ?? 0) - (left.count ?? 0))
            .map(topic => topic.display_name)
            .filter(Boolean)
            .join("、");
        const value = source(
            "OpenAlex Authors",
            item.display_name,
            item.orcid || item.id,
            [
                institutions ? `公开记录中的最近机构：${institutions}` : "",
                topics ? `高频研究主题：${topics}` : "",
                typeof item.works_count === "number" ? `收录成果数：${item.works_count}` : "",
                typeof item.cited_by_count === "number" ? `被引次数：${item.cited_by_count}` : ""
            ].filter(Boolean).join("；"),
            undefined,
            82 - index
        );
        return value ? [ value ] : [];
    });
};

const semanticScholarSearch: SearchAdapter = async (query, config, fetcher) => {
    interface Payload {
        data?: Array<{
            title?: string;
            url?: string;
            abstract?: string;
            year?: number;
            venue?: string;
            externalIds?: { DOI?: string; ArXiv?: string };
        }>;
    }
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "3");
    url.searchParams.set("fields", "title,url,abstract,year,venue,externalIds");
    const headers: Record<string, string> = {};
    if (config.semanticScholarApiKey) headers["x-api-key"] = config.semanticScholarApiKey;
    const payload = await fetchJson<Payload>(fetcher, url.toString(), { headers });
    return (payload.data ?? []).flatMap((item, index) => {
        const value = source(
            "Semantic Scholar",
            item.title,
            item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : item.url,
            [ item.abstract, item.venue, item.year ].filter(Boolean).join("；"),
            item.year?.toString(),
            86 - index
        );
        return value ? [ value ] : [];
    });
};

const europePmcSearch: SearchAdapter = async (query, _config, fetcher) => {
    interface Payload {
        resultList?: {
            result?: Array<{
                title?: string;
                doi?: string;
                pmid?: string;
                authorString?: string;
                journalTitle?: string;
                pubYear?: string;
                abstractText?: string;
            }>;
        };
    }
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    url.searchParams.set("query", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageSize", "3");
    url.searchParams.set("resultType", "core");
    const payload = await fetchJson<Payload>(fetcher, url.toString());
    return (payload.resultList?.result ?? []).flatMap((item, index) => {
        const itemUrl = item.doi ? `https://doi.org/${item.doi}` : item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : "";
        const value = source(
            "Europe PMC",
            item.title,
            itemUrl,
            [ item.abstractText, item.authorString, item.journalTitle ].filter(Boolean).join("；"),
            item.pubYear,
            85 - index
        );
        return value ? [ value ] : [];
    });
};

const arxivSearch: SearchAdapter = async (query, _config, fetcher) => {
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", `all:${query}`);
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", "3");
    const response = await fetcher(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const xml = await response.text();
    return Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)).flatMap((match, index) => {
        const entry = match[1];
        const field = (name: string) => plainText(entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "u"))?.[1]);
        const value = source("arXiv", field("title"), field("id"), field("summary"), field("published"), 84 - index);
        return value ? [ value ] : [];
    });
};

const wikipediaSearch: SearchAdapter = async (query, _config, fetcher) => {
    interface Payload {
        query?: {
            pages?: Record<string, { title?: string; extract?: string; fullurl?: string }>;
        };
    }
    const hasHan = /[\p{Script=Han}]/u.test(query);
    const latinAnchor = query.match(/\b[A-Za-z][A-Za-z0-9+._/-]{1,40}\b/u)?.[0];
    const searches = hasHan && latinAnchor
        ? [ { language: "zh", term: query }, { language: "en", term: latinAnchor } ]
        : [ { language: hasHan ? "zh" : "en", term: query } ];
    const payloads = await Promise.all(searches.map(async ({ language, term }) => {
        const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
        url.searchParams.set("action", "query");
        url.searchParams.set("generator", "search");
        url.searchParams.set("gsrsearch", term);
        url.searchParams.set("gsrlimit", "3");
        url.searchParams.set("prop", "extracts|info");
        url.searchParams.set("exintro", "1");
        url.searchParams.set("explaintext", "1");
        url.searchParams.set("inprop", "url");
        url.searchParams.set("format", "json");
        return await fetchJson<Payload>(fetcher, url.toString());
    }));
    return payloads.flatMap(payload => Object.values(payload.query?.pages ?? {})).flatMap((item, index) => {
        const value = source("Wikipedia", item.title, item.fullurl, item.extract, undefined, 64 - index);
        return value ? [ value ] : [];
    });
};

const dblpOfficialSearch: SearchAdapter = async (query, _config, fetcher) => {
    if (!/\bdblp\b/iu.test(query)) return [];
    const url = "https://dblp.org/faq/1474577.html";
    const response = await fetcher(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "ReadWeave/1.0 (official naming verification)"
        },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const html = await response.text();
    // The official page contains a large JSON-LD header. Extract the FAQ
    // paragraphs themselves so the naming statement cannot be truncated by
    // unrelated navigation, styles or structured metadata.
    const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu), match => plainText(match[1], 1_500));
    const text = paragraphs
        .filter(paragraph => /(?:initially|backronym|proper name|lost its meaning|dblp computer science bibliography)/iu.test(paragraph))
        .join(" ");
    if (!/dblp computer science bibliography/iu.test(text) || !/lost its meaning/iu.test(text)) return [];
    const value = source(
        "dblp official FAQ",
        "What is the meaning of the acronym dblp?",
        url,
        text,
        undefined,
        125
    );
    return value ? [ value ] : [];
};

const orcidOfficialDefinitionSearch: SearchAdapter = async (query, _config, fetcher) => {
    if (!/\bORCID\b/iu.test(query)
        || !/(?:是什么|全称|含义|标识符|identifier|stands for|meaning)/iu.test(query)) return [];
    const url = "https://info.orcid.org/what-is-orcid/";
    const response = await fetcher(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "ReadWeave/1.0 (official identifier verification)"
        },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const html = await response.text();
    const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu), match => plainText(match[1], 1_500));
    const text = paragraphs
        .filter(paragraph => /(?:stands for Open Researcher and Contributor ID|unique, persistent identifier|ORCID iD)/iu.test(paragraph))
        .join(" ");
    if (!/Open Researcher and Contributor ID/iu.test(text) || !/persistent identifier/iu.test(text)) return [];
    const value = source("ORCID official", "About ORCID", url, text, undefined, 125);
    return value ? [ value ] : [];
};

const linuxKernelDaxOfficialSearch: SearchAdapter = async (query, _config, fetcher) => {
    if (!/\bDAX\b/iu.test(query)
        || !/(?:Direct Access|直接访问|page cache|页面缓存|persistent memory|持久内存)/iu.test(query)) return [];
    const url = "https://docs.kernel.org/filesystems/dax.html";
    const response = await fetcher(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "ReadWeave/1.0 (official Linux kernel documentation verification)"
        },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const html = await response.text();
    const title = plainText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1], 240);
    const mainStart = html.search(/<div\b[^>]*class=["'][^"']*\bbody\b[^"']*["'][^>]*role=["']main["'][^>]*>/iu);
    const mainHtml = mainStart >= 0 ? html.slice(mainStart) : html;
    const paragraphs = Array.from(mainHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu), match => plainText(match[1], 1_500));
    const text = paragraphs
        .filter(paragraph => /(?:Direct Access|\bDAX\b|page cache|memory-like|mmap)/iu.test(paragraph))
        .join(" ");
    if (!/Direct Access/iu.test(`${title}\n${text}`) || !/\bDAX\b/iu.test(text)) return [];
    const value = source("Linux kernel documentation", title || "Direct Access for files", url, text, undefined, 130);
    return value ? [ value ] : [];
};

function isDeepSeekOfficialModelQuery(query: string): boolean {
    return /\bDeepSeek\b/iu.test(query)
        && /(?:模型名称|正式模型|可用模型|模型列表|current model|available model|model name)/iu.test(query);
}

const deepSeekOfficialModelsSearch: SearchAdapter = async (query, _config, fetcher) => {
    if (!isDeepSeekOfficialModelQuery(query)) return [];
    const url = "https://api-docs.deepseek.com/api/list-models";
    const response = await fetcher(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "ReadWeave/1.0 (official documentation verification)"
        },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const text = plainText(await response.text(), 2_400);
    const modelNames = Array.from(
        new Set(Array.from(text.matchAll(/\bdeepseek-v\d+(?:\.\d+)?-[a-z][a-z0-9-]*\b/giu), match => match[0].toLocaleLowerCase()))
    );
    if (modelNames.length === 0) return [];
    const value = source(
        "DeepSeek API Docs",
        "Lists Models | DeepSeek API Docs",
        url,
        `官方模型列表：${modelNames.join("、")}`,
        undefined,
        118
    );
    return value ? [ value ] : [];
};

const orcidEmploymentSearch: SearchAdapter = async (query, _config, fetcher) => {
    const explicitOrcidId = query.match(/\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/iu)?.[0]?.toLocaleUpperCase();
    const personCandidates = Array.from(query.matchAll(/\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,5}\b/gu), match => match[0])
        .filter(value => !/^(?:Current|Latest|Official|Primary|Researcher|Professor|Faculty|Profile)(?:\s|$)/u.test(value));
    const expectedName = plainText(personCandidates.toSorted((left, right) => right.length - left.length)[0], 160);
    interface OrcidDate {
        year?: { value?: string };
        month?: { value?: string };
        day?: { value?: string };
    }
    interface EmploymentSummary {
        "put-code"?: number;
        "last-modified-date"?: { value?: number };
        "department-name"?: string;
        "role-title"?: string;
        "start-date"?: OrcidDate;
        "end-date"?: OrcidDate | null;
        "organization"?: { name?: string };
        "url"?: { value?: string };
        "source"?: { "source-name"?: { value?: string } };
    }
    interface Payload {
        "affiliation-group"?: Array<{
            summaries?: Array<{ "employment-summary"?: EmploymentSummary }>;
        }>;
    }
    let orcidIds = explicitOrcidId ? [ explicitOrcidId ] : [];
    if (orcidIds.length === 0 && expectedName) {
        interface SearchPayload {
            result?: Array<{ "orcid-identifier"?: { path?: string } }>;
        }
        const url = new URL("https://pub.orcid.org/v3.0/search/");
        url.searchParams.set("q", `given-and-family-names:"${expectedName.replace(/"/gu, "")}"`);
        url.searchParams.set("rows", "3");
        const result = await fetchJson<SearchPayload>(fetcher, url.toString(), {
            headers: { Accept: "application/vnd.orcid+json" }
        });
        orcidIds = (result.result ?? [])
            .map(item => item["orcid-identifier"]?.path?.toLocaleUpperCase())
            .filter((value): value is string => Boolean(value && /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u.test(value)));
    }
    if (orcidIds.length === 0) return [];
    const records = await Promise.all(orcidIds.map(async orcidId => ({
        orcidId,
        payload: await fetchJson<Payload>(
            fetcher,
            `https://pub.orcid.org/v3.0/${encodeURIComponent(orcidId)}/employments`,
            { headers: { Accept: "application/vnd.orcid+json" } }
        )
    })));
    const dateText = (date: OrcidDate | null | undefined) => [
        date?.year?.value,
        date?.month?.value,
        date?.day?.value
    ].filter(Boolean).join("-");
    const normalizedName = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const employmentSources: ReadWeaveSearchSource[] = [];
    const officialProfileUrls = new Set<string>();
    for (const { orcidId, payload } of records) {
        const summaries = (payload["affiliation-group"] ?? []).flatMap(group => group.summaries ?? []);
        const recordName = summaries
            .map(wrapper => plainText(wrapper["employment-summary"]?.source?.["source-name"]?.value, 160))
            .find(Boolean) ?? "";
        if (expectedName && recordName && normalizedName(expectedName) !== normalizedName(recordName)) continue;
        employmentSources.push(...summaries.flatMap((wrapper, index) => {
            const item = wrapper["employment-summary"];
            const organization = plainText(item?.organization?.name, 220);
            if (!item || !organization) return [];
            const end = dateText(item["end-date"]);
            const current = !end;
            const person = plainText(item.source?.["source-name"]?.value, 160) || orcidId;
            const start = dateText(item["start-date"]);
            const detailUrl = `https://orcid.org/${orcidId}#employment-${item["put-code"] ?? index}`;
            const profileUrl = safeUrl(item.url?.value);
            if (current && profileUrl && /\.edu$/iu.test(new URL(profileUrl).hostname)) {
                officialProfileUrls.add(profileUrl);
            }
            const snippet = [
                `${person} 的 ORCID 公开任职记录`,
                organization,
                item["department-name"],
                item["role-title"],
                start ? `任职时间：${start} 至 ${current ? "今" : end}` : current ? "当前任职" : `结束时间：${end}`,
                item.url?.value ? `机构或个人主页：${item.url.value}` : ""
            ].filter(Boolean).join("；");
            const modified = item["last-modified-date"]?.value;
            const publishedAt = typeof modified === "number" && Number.isFinite(modified)
                ? new Date(modified).toISOString().slice(0, 10)
                : undefined;
            const value = source(
                "ORCID",
                `${person} — ${organization}${current ? "（现任）" : "（历史任职）"}`,
                detailUrl,
                snippet,
                publishedAt,
                (current ? 120 : 94) - index
            );
            return value ? [ value ] : [];
        }));
    }
    const officialProfileSources: ReadWeaveSearchSource[] = [];
    for (const profileUrl of officialProfileUrls) {
        try {
            interface WordPressPage {
                link?: string;
                modified?: string;
                title?: { rendered?: string };
                content?: { rendered?: string };
            }
            const base = new URL(profileUrl);
            base.pathname = `${base.pathname.replace(/\/?$/u, "/")}wp-json/wp/v2/pages`;
            base.search = "";
            base.searchParams.set("per_page", "20");
            base.searchParams.set("_fields", "link,title,content,modified");
            const pages = await fetchJson<WordPressPage[]>(fetcher, base.toString());
            officialProfileSources.push(...pages
                .filter(page => /^(?:research|biography|home)$/iu.test(plainText(page.title?.rendered, 80)))
                .flatMap(page => {
                    const title = plainText(page.title?.rendered, 80);
                    const snippet = plainText(page.content?.rendered, 1_100);
                    if (!title || !snippet) return [];
                    const priority = /^research$/iu.test(title) ? 118 : /^home$/iu.test(title) ? 114 : 110;
                    const value = source(
                        "Official profile",
                        `${expectedName || "Researcher"} — ${title}`,
                        page.link || profileUrl,
                        snippet,
                        page.modified,
                        priority
                    );
                    return value ? [ value ] : [];
                }));
        } catch {
            // The ORCID employment record remains useful when the linked
            // personal site is unavailable or does not expose WordPress JSON.
        }
    }
    return [ ...employmentSources, ...officialProfileSources ];
};

const unpaywallSearch: SearchAdapter = async (query, config, fetcher) => {
    if (!config.unpaywallEmail) return [];
    const doi = query.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/iu)?.[0]?.replace(/[.,;:]+$/u, "");
    if (!doi) return [];
    interface Payload {
        title?: string;
        doi_url?: string;
        doi?: string;
        journal_name?: string;
        year?: number;
        best_oa_location?: { landing_page_url?: string; url_for_pdf?: string; host_type?: string; license?: string };
    }
    const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
    url.searchParams.set("email", config.unpaywallEmail);
    const item = await fetchJson<Payload>(fetcher, url.toString());
    const value = source(
        "Unpaywall",
        item.title,
        item.best_oa_location?.landing_page_url || item.doi_url || (item.doi ? `https://doi.org/${item.doi}` : ""),
        [ item.journal_name, item.best_oa_location?.host_type, item.best_oa_location?.license ].filter(Boolean).join("；"),
        item.year?.toString(),
        94
    );
    return value ? [ value ] : [];
};

const serperSearch: SearchAdapter = async (query, config, fetcher) => {
    if (!config.serperApiKey) return [];
    interface Payload {
        organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
        knowledgeGraph?: { title?: string; description?: string; website?: string };
    }
    const payload = await fetchJson<Payload>(fetcher, "https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": config.serperApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 5 })
    }, SERPER_PROVIDER_TIMEOUT_MS);
    const rows = payload.organic ?? [];
    if (payload.knowledgeGraph?.website) {
        rows.unshift({
            title: payload.knowledgeGraph.title,
            link: payload.knowledgeGraph.website,
            snippet: payload.knowledgeGraph.description
        });
    }
    return rows.flatMap((item, index) => {
        const value = source("Serper", item.title, item.link, item.snippet, item.date, 75 - index, {
            originalRank: index + 1,
            retrievalMode: "raw-serp"
        });
        return value ? [ value ] : [];
    });
};

const exaPeopleSearch: SearchAdapter = async (query, config, fetcher) => {
    if (!config.exaApiKey) return [];
    interface Payload {
        results?: Array<{ title?: string; url?: string; text?: string; highlights?: string[]; publishedDate?: string }>;
    }
    const payload = await fetchJson<Payload>(fetcher, "https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": config.exaApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
            query,
            type: "auto",
            category: "people",
            numResults: 5,
            contents: { highlights: true, text: true }
        })
    });
    return (payload.results ?? []).flatMap((item, index) => {
        const value = source(
            "Exa People",
            item.title,
            item.url,
            item.text || item.highlights?.join(" "),
            item.publishedDate,
            79 - index,
            { originalRank: index + 1, retrievalMode: "semantic" }
        );
        return value ? [ value ] : [];
    });
};

const braveSearch: SearchAdapter = async (query, config, fetcher) => {
    if (!config.braveApiKey) return [];
    interface Payload {
        web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
    }
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");
    const payload = await fetchJson<Payload>(fetcher, url.toString(), {
        headers: { "X-Subscription-Token": config.braveApiKey }
    });
    return (payload.web?.results ?? []).flatMap((item, index) => {
        const value = source("Brave Search", item.title, item.url, item.description, item.age, 74 - index, {
            originalRank: index + 1,
            retrievalMode: "raw-serp"
        });
        return value ? [ value ] : [];
    });
};

const tavilySearch: SearchAdapter = async (query, config, fetcher) => {
    if (!config.tavilyApiKey) return [];
    interface Payload {
        results?: Array<{ title?: string; url?: string; content?: string; score?: number; published_date?: string }>;
    }
    const payload = await fetchJson<Payload>(fetcher, "https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: config.tavilyApiKey,
            query,
            search_depth: "basic",
            max_results: 5,
            include_answer: false,
            include_raw_content: false
        })
    }, TAVILY_PROVIDER_TIMEOUT_MS);
    return (payload.results ?? []).flatMap((item, index) => {
        const value = source("Tavily", item.title, item.url, item.content, item.published_date, 74 + (item.score ?? 0) - index, {
            originalRank: index + 1,
            retrievalMode: "semantic"
        });
        return value ? [ value ] : [];
    });
};

const jinaSearch: SearchAdapter = async (query, config, fetcher) => {
    if (!config.jinaApiKey) return [];
    interface Payload {
        data?: Array<{ title?: string; url?: string; description?: string; content?: string; publishedTime?: string }>;
    }
    const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
    const payload = await fetchJson<Payload>(fetcher, url, {
        headers: {
            "Authorization": `Bearer ${config.jinaApiKey}`,
            "X-Respond-With": "no-content",
            "X-Return-Format": "json"
        }
    });
    return (payload.data ?? []).flatMap((item, index) => {
        const value = source("Jina Search", item.title, item.url, item.description || item.content, item.publishedTime, 73 - index, {
            originalRank: index + 1,
            retrievalMode: "semantic"
        });
        return value ? [ value ] : [];
    });
};

/** Jina is a page reader here, not a second answer generator: the writer still
 * receives normalized evidence rather than treating page text as instructions. */
export async function readReadWeavePageWithJina(
    url: string,
    options: { fetcher?: FetchLike; signal?: AbortSignal; anonymous?: boolean } = {}
): Promise<string> {
    if (!canRetrieve("page_read", options.signal)) return "";
    const config = getReadWeaveSearchRuntimeConfig();
    if (!config.jinaApiKey && !options.anonymous) return "";
    const normalizedUrl = safeUrl(url);
    if (!normalizedUrl) return "";
    const fetcher = policyFetcher(options.fetcher, options.signal);
    const signal = options.signal ? AbortSignal.any([ options.signal, AbortSignal.timeout(12_000) ]) : AbortSignal.timeout(12_000);
    let content = "";
    let markdown = false;
    let readerError: unknown;
    try {
        const response = await fetcher(`https://r.jina.ai/${normalizedUrl}`, {
            headers: {
                "Accept": "text/plain",
                ...(!options.anonymous ? { Authorization: `Bearer ${config.jinaApiKey}` } : {}),
                "X-Return-Format": "markdown"
            },
            signal
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
        content = await response.text();
        markdown = true;
    } catch (error) {
        readerError = error;
    }
    // Some standards and documentation sites reject reader proxies. Fall back
    // to a direct, DNS-pinned public GET through the same SSRF policy; never
    // forward the Jina credential or provider headers to the origin.
    if (!content.trim()) {
        try {
            const direct = await fetcher(normalizedUrl, {
                headers: { "Accept": "text/html,text/plain;q=0.9" }, signal
            });
            if (!direct.ok) throw new Error(`${direct.status} ${direct.statusText}`.trim());
            content = await direct.text();
            markdown = false;
        } catch (directError) {
            throw readerError ?? directError;
        }
    }
    requireRetrieval("page_read", options.signal);
    return normalizeReadWeavePageContent(content, !markdown);
}

function isCurrentQuery(query: string): boolean {
    return /(?:当前|目前|现任|最新|截至|今天|现在|版本|价格|发布|维护|状态|current|latest|today|now|20[2-9]\d)/iu.test(query);
}


function isFreshnessSensitiveQuery(query: string): boolean {
    return isCurrentQuery(query);
}

function isAcademicQuery(query: string): boolean {
    return /(?:论文|作者|期刊|会议|研究|引用|DOI|ORCID|arXiv|学术|文献|发表于|publication|paper|journal|conference|citation|author|\b10\.\d{4,9}\/)/iu.test(query);
}

function automaticSearchWanted(input: SearchInput): boolean {
    const text = input.query;
    if (input.localEvidenceSufficient && !isAcademicQuery(text) && !isFreshnessSensitiveQuery(text)) return false;
    return isAcademicQuery(text)
        || isFreshnessSensitiveQuery(text)
        || /(?:是什么|全称|缩写|规范名称|官方|谁|哪个组织|来源|依据|证据|定义|区别|关系|标准|产品|组织|机构|协议|格式)/u.test(text)
        || /\b[A-Z][A-Z0-9+.-]{1,15}\b/u.test(text);
}

function normalizeQuery(query: string): string {
    return plainText(query, 500).replace(/[？?]+$/u, "").trim();
}

export function buildFocusedGeneralSearchQuery(query: string): string {
    // The caller owns the evidence question. Classification cannot substitute
    // a biography, an assumed definition, or another task for that question.
    return normalizeQuery(query);
}

function deduplicateAndRank(sources: ReadWeaveSearchSource[], query: string): ReadWeaveSearchSource[] {
    const seen = new Set<string>();
    const currentYear = new Date().getUTCFullYear();
    const freshnessSensitive = isFreshnessSensitiveQuery(query);
    return sources
        .filter(item => item.title && item.url)
        .map((item, index) => {
            let authority = item.score;
            const evidenceText = `${item.title}\n${item.snippet}\n${item.publishedAt ?? ""}`;
            try {
                const hostname = new URL(item.url).hostname;
                if (/(?:doi\.org|crossref\.org|dblp\.org|openalex\.org|semanticscholar\.org|arxiv\.org|europepmc\.org|nih\.gov|\.edu(?:\.[a-z]{2})?|\.gov(?:\.[a-z]{2})?)$/iu.test(hostname)) authority += 12;
                if (/^(?:orcid\.org|www\.orcid\.org|ieee\.org|www\.ieee\.org|usb\.org|www\.usb\.org|riscv\.org|www\.riscv\.org|nodejs\.org|www\.acm\.org|acm\.org|dblp\.org|www\.dblp\.org|computeexpresslink\.org|www\.computeexpresslink\.org|api-docs\.deepseek\.com)$/iu.test(hostname)) {
                    authority += 24;
                } else if (/\.org$/iu.test(hostname)) {
                    authority += 3;
                }

            } catch {
                // Invalid URLs were already removed.
            }
            if (freshnessSensitive) {
                if (/(?:现任|目前|当前|至今|加入|转任|迁至|current|present|currently|joined|moved|appointed)/iu.test(evidenceText)) {
                    authority += 14;
                }
                const years = Array.from(evidenceText.matchAll(/\b(20[0-3]\d)\b/gu), match => Number(match[1]));
                const latestYear = years.length > 0 ? Math.max(...years) : 0;
                if (latestYear >= currentYear - 1) authority += 12;
                else if (latestYear >= currentYear - 3) authority += 5;
                else if (latestYear > 0 && latestYear <= currentYear - 6) authority -= 10;
            }
            const classification = classifySearchSource(item, query);
            return {
                ...item,
                ...classification,
                originalRank: item.originalRank ?? index + 1,
                score: authority
            };
        })
        .toSorted((left, right) => right.score - left.score)
        .filter(item => {
            const key = item.url.replace(/^https?:\/\/(?:www\.)?/u, "").replace(/\/$/u, "").toLocaleLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function buildEvidenceMemo(query: string, sources: ReadWeaveSearchSource[]): string {
    return [
        `[external-search-query]\n${query}`,
        ...sources.map((item, index) => [
            `[external-source:${index + 1}]`,
            `来源：${item.provider}`,
            `标题：${item.title}`,
            item.publishedAt ? `时间：${item.publishedAt}` : "",
            item.snippet ? `证据片段：${item.snippet}` : "",
            `链接：${item.url}`
        ].filter(Boolean).join("\n"))
    ].join("\n\n");
}

function putCache(key: string, value: ReadWeaveSearchEvidence) {
    const target = searchPolicy.getStore()?.cache ?? cache;
    target.set(key, {
        expiresAt: Date.now() + (isFreshnessSensitiveQuery(value.query) ? CURRENT_CACHE_TTL_MS : CACHE_TTL_MS),
        value
    });
    while (target.size > MAX_CACHE_ENTRIES) {
        const oldest = target.keys().next().value as string | undefined;
        if (!oldest) break;
        target.delete(oldest);
    }
}

async function runAdapter(
    name: string,
    adapter: SearchAdapter,
    query: string,
    config: ReadWeaveSearchRuntimeConfig,
    fetcher: FetchLike
): Promise<{ sources: ReadWeaveSearchSource[]; warning?: string }> {
    try {
        return { sources: await adapter(query, config, fetcher) };
    } catch (error) {
        checkCancellation();
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        const status = error instanceof Error ? error.message.match(/\b[45]\d{2}\b/u)?.[0] : undefined;
        return { sources: [], warning: `${name}: ${error instanceof SearchPolicyError ? "not permitted" : status ? `HTTP ${status}` : "request failed"}` };
    }
}

async function searchUncached(input: SearchInput, fetcher: FetchLike): Promise<ReadWeaveSearchEvidence> {
    const startedAt = Date.now();
    const storedConfig = getReadWeaveSearchRuntimeConfig();
    const allowance = input.budgetCny ?? storedConfig.budgetCny;
    const config = { ...storedConfig, budgetCny: Number.isFinite(allowance) ? Math.max(0, Math.min(allowance, 0.10)) : 0 };
    const query = normalizeQuery(input.query);
    // Per-task permission is authoritative. `force` here is issued only after
    // the TaskContract has allowed retrieval, so an obsolete global `off`
    // option must not silently cancel a current automatic/explicit search.
    // A user's “关闭外部搜索” choice is enforced earlier by SearchPolicy and
    // cannot reach this function as an allowed forced request.
    if (!query || (!input.force && (config.mode === "off" || config.mode === "automatic" && !automaticSearchWanted(input)))) {
        return {
            used: false,
            query,
            sources: [],
            providers: [],
            memo: "",
            warnings: [],
            elapsedMs: Date.now() - startedAt,
            cacheHit: false,
            searchCostCny: 0
        };
    }

    const academic = isAcademicQuery(query);
    const orcidId = query
        .match(/\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/iu)?.[0]?.toLocaleUpperCase();
    const freeAdapters: Array<[string, SearchAdapter]> = [
        ...(isDeepSeekOfficialModelQuery(query)
            ? [ [ "DeepSeek API Docs", deepSeekOfficialModelsSearch ] as [string, SearchAdapter] ]
            : []),
        ...(/\bdblp\b/iu.test(query)
            ? [ [ "dblp official FAQ", dblpOfficialSearch ] as [string, SearchAdapter] ]
            : []),
        ...(/\bORCID\b/iu.test(query)
            ? [ [ "ORCID official", orcidOfficialDefinitionSearch ] as [string, SearchAdapter] ]
            : []),
        ...(/\bDAX\b/iu.test(query)
            ? [ [ "Linux kernel DAX documentation", linuxKernelDaxOfficialSearch ] as [string, SearchAdapter] ]
            : []),
        [ "Wikipedia", wikipediaSearch ],
        ...(input.resourceHints?.includes("person") || orcidId
            ? [
                [ "OpenAlex Authors", openAlexAuthorSearch ] as [string, SearchAdapter],
                [ "ORCID", orcidEmploymentSearch ] as [string, SearchAdapter]
            ]
            : []),
        ...(academic ? [
            [ "Crossref", crossrefSearch ],
            [ "DBLP", dblpSearch ],
            [ "OpenAlex", openAlexSearch ],
            [ "Semantic Scholar", semanticScholarSearch ],
            [ "Europe PMC", europePmcSearch ],
            [ "arXiv", arxivSearch ],
            [ "Unpaywall", unpaywallSearch ]
        ] as Array<[string, SearchAdapter]> : [])
    ];
    const free = await Promise.all(freeAdapters.map(([ name, adapter ]) => runAdapter(
        name,
        adapter,
        name === "ORCID" && orcidId ? `${query} ${orcidId}` : query,
        config,
        fetcher
    )));
    const warnings = free.flatMap(item => item.warning ? [ item.warning ] : []);
    const freeSources = free.flatMap(item => item.sources);
    let sources = deduplicateAndRank(freeSources, query);
    let searchCostCny = 0;

    const needsGeneralSearch = input.allowPaid !== false
        && (input.forcePaidFallback === true || isFreshnessSensitiveQuery(query) || sources.length < 2 || config.mode === "always");
    if (needsGeneralSearch) {
        const focusedQuery = buildFocusedGeneralSearchQuery(query);
        const paidFallbacks: Array<[string, SearchAdapter, number, boolean]> = [
            // Tavily's Researcher plan has a monthly free quota and pay-as-you-go
            // is off by default. Exhaustion therefore fails closed rather than billing.
            [ "Serper", serperSearch, 0.001 * CNY_PER_USD, !!config.serperApiKey ],
            [ "Tavily", tavilySearch, 0, !!config.tavilyApiKey ],
            [ "Brave Search", braveSearch, 0.005 * CNY_PER_USD, !!config.braveApiKey ],
            [ "Jina Search", jinaSearch, 0.001 * CNY_PER_USD, !!config.jinaApiKey ]
        ];
        if (input.resourceHints?.includes("person") && config.exaApiKey)
            paidFallbacks.push(["Exa People", exaPeopleSearch, 0.007 * CNY_PER_USD, true]);
        // One shared fallback chain. An advisory person resource can supply an
        // additional candidate, but never replace general search or raise budget.
        for (const [name, adapter, estimatedCost, configured] of paidFallbacks) {
            if (!configured || searchCostCny + estimatedCost > config.budgetCny) continue;
            requireRetrieval("search");
            const fallback = await runAdapter(name, adapter, focusedQuery, config, fetcher);
            // These are conservative configured-rate estimates, including
            // uncertain failed requests. They are not provider-confirmed bills.
            searchCostCny += estimatedCost;
            if (fallback.warning) warnings.push(fallback.warning);
            if (fallback.sources.length > 0) {
                sources = deduplicateAndRank([...freeSources, ...fallback.sources], query);
                break;
            }
        }
    }

    const providers = Array.from(new Set(sources.map(item => item.provider)));
    return {
        used: sources.length > 0,
        query,
        sources,
        providers,
        memo: buildEvidenceMemo(query, sources),
        warnings,
        elapsedMs: Date.now() - startedAt,
        cacheHit: false,
        searchCostCny
    };
}

export async function searchReadWeaveEvidence(
    input: SearchInput,
    options: { fetcher?: FetchLike; bypassCache?: boolean; signal?: AbortSignal } = {}
): Promise<ReadWeaveSearchEvidence> {
    checkCancellation(options.signal);
    const config = getReadWeaveSearchRuntimeConfig();
    const normalized = normalizeQuery(input.query);
    if (!canRetrieve("search", options.signal)) return {
        used: false, query: normalized, sources: [], providers: [], memo: "",
        warnings: [], elapsedMs: 0, cacheHit: false, searchCostCny: 0
    };
    const scoped = searchPolicy.getStore();
    const cacheKey = JSON.stringify({
        query: normalized.toLocaleLowerCase(),
        context: plainText(input.context, 600).toLocaleLowerCase(),
        resourceHints: input.resourceHints,
        scopedPermissions: scoped?.policies.map(({ externalSearch, allowedSourceScopes, allowedCapabilities }) =>
            ({ externalSearch, allowedSourceScopes, allowedCapabilities })),
        localEvidenceSufficient: !!input.localEvidenceSufficient,
        allowPaid: input.allowPaid !== false,
        forcePaidFallback: input.forcePaidFallback === true,
        budgetCny: input.budgetCny ?? config.budgetCny,
        mode: config.mode,
        providers: [
            !!config.serperApiKey,
            !!config.exaApiKey,
            !!config.tavilyApiKey,
            !!config.braveApiKey,
            !!config.jinaApiKey,
            !!config.semanticScholarApiKey,
            !!config.openAlexApiKey,
            !!config.unpaywallEmail
        ]
    });
    if (!options.bypassCache) {
        const cached = (scoped?.cache ?? cache).get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return { ...cached.value, elapsedMs: 0, cacheHit: true, searchCostCny: 0 };
        }
        const existing = options.signal || scoped ? undefined : inFlight.get(cacheKey);
        if (existing) return { ...(await existing), cacheHit: true, searchCostCny: 0 };
    }
    const fetcher = policyFetcher(options.fetcher, options.signal);
    const operation = searchUncached(input, fetcher);
    if (!options.signal && !scoped) inFlight.set(cacheKey, operation);
    try {
        const result = await operation;
        checkCancellation(options.signal);
        if (result.used) putCache(cacheKey, result);
        return result;
    } finally {
        if (!options.signal && !scoped) inFlight.delete(cacheKey);
    }
}

/** Resource selection comes from the model's explicit information gap, not a question classifier.
 * Preserve provider order and all returned rows; the research model assesses relevance. */
export async function searchReadWeaveActiveEvidence(input: {
    query: string; provider: "general" | "academic" | "people"; budgetCny: number;
}, options: { fetcher?: FetchLike; signal?: AbortSignal } = {}): Promise<ReadWeaveSearchEvidence> {
    checkCancellation(options.signal);
    requireRetrieval("search", options.signal);
    const started = Date.now(), query = plainText(input.query);
    if (!query) throw new Error("Search query is empty.");
    const config = getReadWeaveSearchRuntimeConfig();
    const fetcher = policyFetcher(options.fetcher, options.signal);
    const generalTariff = Math.round(0.001 * CNY_PER_USD * 1e6) / 1e6;
    const peopleTariff = Math.round(0.007 * CNY_PER_USD * 1e6) / 1e6;
    const adapters: Array<[string, SearchAdapter, number]> = [];
    const warnings: string[] = [];
    if (input.provider === "academic") {
        adapters.push(["Crossref", crossrefSearch, 0], ["OpenAlex", openAlexSearch, 0]);
    } else if (input.provider === "people" && config.exaApiKey && input.budgetCny >= peopleTariff) {
        adapters.push(["Exa People", exaPeopleSearch, peopleTariff]);
    } else if (config.serperApiKey && input.budgetCny >= generalTariff) {
        adapters.push(["Serper", serperSearch, generalTariff]);
        if (input.provider === "people") warnings.push("Exa is unavailable or exceeds this retrieval allowance; general web search was explicitly used.");
    } else {
        adapters.push(["Wikipedia", wikipediaSearch, 0]);
        warnings.push("General web provider is unavailable or its tariff exceeds the remaining research allowance; only the free index was queried.");
    }
    const results = await Promise.all(adapters.map(async ([name, adapter, cost]) => ({
        ...await runAdapter(name, adapter, query, config, fetcher), cost
    })));
    checkCancellation(options.signal);
    const seen = new Set<string>();
    const sources = results.flatMap(r => r.sources).filter(s => {
        const key = `${s.url}\n${s.snippet}`;
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });
    return {
        used: sources.length > 0, query, sources, providers: adapters.map(([name]) => name), memo: "",
        warnings: [...warnings, ...results.flatMap(r => r.warning ? [r.warning] : [])],
        elapsedMs: Date.now() - started, cacheHit: false, searchCostCny: results.reduce((sum, r) => sum + r.cost, 0)
    };
}

export function buildReadWeaveSearchVariants(query: string): string[] {
    const normalized = normalizeQuery(query);
    // Evidence-need scheduling supplies alternatives explicitly.
    return normalized ? [normalized] : [];
}

export async function searchReadWeaveEvidencePlan(
    input: SearchInput,
    options: { fetcher?: FetchLike; bypassCache?: boolean; signal?: AbortSignal } = {}
): Promise<ReadWeaveSearchEvidence> {
    return searchReadWeaveEvidence(input, options);
}

export async function testReadWeaveSearch(query: string): Promise<ReadWeaveSearchTestResult> {
    const normalized = normalizeQuery(query);
    if (!normalized) throw new Error("A search test query is required.");
    const evidence = await searchReadWeaveEvidence({ query: normalized, kind: "question", force: true }, { bypassCache: true });
    return {
        query: evidence.query,
        sourceCount: evidence.sources.length,
        providers: evidence.providers,
        elapsedMs: evidence.elapsedMs,
        cacheHit: evidence.cacheHit,
        searchCostCny: evidence.searchCostCny,
        sources: evidence.sources.map(({ provider, title, url, snippet, originalRank, sourceCategory, evidenceFamily, retrievalMode }) => ({
            provider,
            title,
            url,
            snippet,
            originalRank,
            sourceCategory,
            evidenceFamily,
            retrievalMode
        })),
        warnings: evidence.warnings
    };
}

export function clearReadWeaveSearchCacheForTests() {
    cache.clear();
    inFlight.clear();
}
