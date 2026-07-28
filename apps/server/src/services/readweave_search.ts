import type { ReadWeaveObjectKind, ReadWeaveSearchTestResult } from "@triliumnext/commons";

import { getReadWeaveSearchRuntimeConfig, type ReadWeaveSearchRuntimeConfig } from "./readweave_settings.js";

const PROVIDER_TIMEOUT_MS = 5_500;
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
    query: string;
    context?: string;
    kind?: ReadWeaveObjectKind;
    force?: boolean;
    localEvidenceSufficient?: boolean;
    allowPaid?: boolean;
}

interface CachedEvidence {
    expiresAt: number;
    value: ReadWeaveSearchEvidence;
}

type FetchLike = typeof fetch;
type SearchAdapter = (query: string, config: ReadWeaveSearchRuntimeConfig, fetcher: FetchLike) => Promise<ReadWeaveSearchSource[]>;

const cache = new Map<string, CachedEvidence>();
const inFlight = new Map<string, Promise<ReadWeaveSearchEvidence>>();

function plainText(value: unknown, maximum = 700): string {
    if (typeof value !== "string") return "";
    return value
        .replace(/<[^>]*>/gu, " ")
        .replace(/&(?:nbsp|#160);/giu, " ")
        .replace(/&amp;/giu, "&")
        .replace(/&lt;/giu, "<")
        .replace(/&gt;/giu, ">")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, maximum);
}

function safeUrl(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") return "";
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
    score = 0
): ReadWeaveSearchSource | undefined {
    const normalizedTitle = plainText(title, 300);
    const normalizedUrl = safeUrl(url);
    if (!normalizedTitle || !normalizedUrl) return undefined;
    return {
        provider,
        title: normalizedTitle,
        url: normalizedUrl,
        snippet: plainText(snippet),
        publishedAt: typeof publishedAt === "string" ? plainText(publishedAt, 80) : undefined,
        score
    };
}

async function fetchJson<T>(
    fetcher: FetchLike,
    url: string,
    init: RequestInit = {},
    timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<T> {
    let lastError = "request failed";
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetcher(url, {
            ...init,
            headers: {
                "Accept": "application/json",
                "User-Agent": "ReadWeave/1.0 (metadata verification)",
                ...init.headers
            },
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (response.ok) return await response.json() as T;
        lastError = `${response.status} ${response.statusText}`.trim();
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
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
                item.authorships?.slice(0, 4).map(authorship => authorship.author?.display_name).filter(Boolean).join(", "),
                item.primary_location?.source?.display_name,
                item.publication_year
            ].filter(Boolean).join("；"),
            item.publication_year?.toString(),
            87 - index
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
    const searchLanguage = /[\p{Script=Han}]/u.test(query) ? "zh" : "en";
    const url = new URL(`https://${searchLanguage}.wikipedia.org/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrlimit", "3");
    url.searchParams.set("prop", "extracts|info");
    url.searchParams.set("exintro", "1");
    url.searchParams.set("explaintext", "1");
    url.searchParams.set("inprop", "url");
    url.searchParams.set("format", "json");
    const payload = await fetchJson<Payload>(fetcher, url.toString());
    return Object.values(payload.query?.pages ?? {}).flatMap((item, index) => {
        const value = source("Wikipedia", item.title, item.fullurl, item.extract, undefined, 62 - index);
        return value ? [ value ] : [];
    });
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
    const expectedName = plainText(
        query.match(/^(.+?)\s+(?:current\s+professor|researcher\s+professor\s+profile)/iu)?.[1],
        160
    );
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
        organization?: { name?: string };
        url?: { value?: string };
        source?: { "source-name"?: { value?: string } };
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
            headers: { "Accept": "application/vnd.orcid+json" }
        });
        orcidIds = (result.result ?? [])
            .map(item => item["orcid-identifier"]?.path?.toLocaleUpperCase())
            .filter((value): value is string => Boolean(value && /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u.test(value)))
            .slice(0, 2);
    }
    if (orcidIds.length === 0) return [];
    const records = await Promise.all(orcidIds.map(async orcidId => ({
        orcidId,
        payload: await fetchJson<Payload>(
            fetcher,
            `https://pub.orcid.org/v3.0/${encodeURIComponent(orcidId)}/employments`,
            { headers: { "Accept": "application/vnd.orcid+json" } }
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
    for (const profileUrl of Array.from(officialProfileUrls).slice(0, 2)) {
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
    });
    const rows = payload.organic ?? [];
    if (payload.knowledgeGraph?.website) {
        rows.unshift({
            title: payload.knowledgeGraph.title,
            link: payload.knowledgeGraph.website,
            snippet: payload.knowledgeGraph.description
        });
    }
    return rows.slice(0, 5).flatMap((item, index) => {
        const value = source("Serper", item.title, item.link, item.snippet, item.date, 75 - index);
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
        const value = source("Brave Search", item.title, item.url, item.description, item.age, 74 - index);
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
            query: `${query} official primary source`,
            search_depth: "basic",
            max_results: 5,
            include_answer: false,
            include_raw_content: false
        })
    }, TAVILY_PROVIDER_TIMEOUT_MS);
    return (payload.results ?? []).flatMap((item, index) => {
        const value = source("Tavily", item.title, item.url, item.content, item.published_date, 74 + (item.score ?? 0) - index);
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
        const value = source("Jina Search", item.title, item.url, item.description || item.content, item.publishedTime, 73 - index);
        return value ? [ value ] : [];
    });
};

function isCurrentQuery(query: string): boolean {
    return /(?:当前|目前|现任|最新|截至|今天|现在|版本|价格|发布|维护|状态|current|latest|today|now|20[2-9]\d)/iu.test(query);
}

function isPersonProfileQuery(query: string): boolean {
    const normalized = plainText(query, 700);
    const hasProfileIntent = /(?:人物|学者|教授|研究员|科学家|工程师|作者|是谁|是何人|现任机构|任职|个人简介|researcher|professor|faculty|biography|profile|current affiliation)/iu.test(normalized);
    const looksLikeLatinPersonName = /\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,5}\b/u.test(normalized);
    const looksLikeChinesePersonQuestion = /[\p{Script=Han}]{2,8}(?:是谁|是何人|现任|任职)/u.test(normalized);
    return hasProfileIntent && (looksLikeLatinPersonName || looksLikeChinesePersonQuestion);
}

function isFreshnessSensitiveQuery(query: string): boolean {
    return isCurrentQuery(query) || isPersonProfileQuery(query);
}

function isAcademicQuery(query: string): boolean {
    return /(?:论文|作者|期刊|会议|研究|引用|DOI|ORCID|arXiv|学术|文献|发表于|publication|paper|journal|conference|citation|author|\b10\.\d{4,9}\/)/iu.test(query);
}

function automaticSearchWanted(input: SearchInput): boolean {
    const text = `${input.query}\n${input.context ?? ""}`;
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
    const normalized = normalizeQuery(query);
    if (!normalized) return "";

    const years = Array.from(normalized.matchAll(/\b(20[0-3]\d)\b/gu), match => match[1]);
    const withoutTemporalLead = normalized
        .replace(
            /^(?:截至|截止(?:到)?|到)\s*(?:20[0-3]\d)(?:\s*年)?(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*日)?\s*[，,、:：-]?\s*/u,
            ""
        )
        .trim();
    const semanticQuery = withoutTemporalLead || normalized;
    const latinAnchors = Array.from(
        semanticQuery.matchAll(/\b[A-Za-z][A-Za-z0-9+._/-]*(?:\s+[A-Za-z][A-Za-z0-9+._/-]*){0,5}\b/gu),
        match => match[0].trim()
    )
        .filter(value => !/^(?:current|latest|official|primary|source)$/iu.test(value))
        .toSorted((left, right) => right.length - left.length);
    const primaryAnchor = latinAnchors[0];

    let intent = "";
    if (/(?:模型名称|正式模型|可用模型|模型列表)/u.test(semanticQuery)) intent = "official current model names";
    else if (/(?:现任机构|当前任职|现任|任职)/u.test(semanticQuery)) intent = "official current affiliation";
    else if (/(?:最新版本|当前版本|正式版本)/u.test(semanticQuery)) intent = "official latest version";
    else if (/(?:价格|定价|费用)/u.test(semanticQuery)) intent = "official current pricing";
    else if (/(?:发布日期|发布时间|发布)/u.test(semanticQuery)) intent = "official release";

    const parts = [
        primaryAnchor,
        intent,
        years.at(-1),
        semanticQuery,
        "official primary source"
    ].filter((value): value is string => !!value);
    return Array.from(new Set(parts)).join(" ").replace(/\s+/gu, " ").trim();
}

function deduplicateAndRank(sources: ReadWeaveSearchSource[], query: string): ReadWeaveSearchSource[] {
    const seen = new Set<string>();
    const currentYear = new Date().getUTCFullYear();
    const freshnessSensitive = isFreshnessSensitiveQuery(query);
    const personProfile = isPersonProfileQuery(query);
    return sources
        .filter(item => item.title && item.url)
        .map(item => {
            let authority = item.score;
            const evidenceText = `${item.title}\n${item.snippet}\n${item.publishedAt ?? ""}`;
            try {
                const hostname = new URL(item.url).hostname;
                if (/(?:doi\.org|crossref\.org|dblp\.org|openalex\.org|semanticscholar\.org|arxiv\.org|europepmc\.org|nih\.gov|\.edu|\.gov)$/iu.test(hostname)) authority += 12;
                if (/^(?:orcid\.org|www\.orcid\.org|ieee\.org|www\.ieee\.org|usb\.org|www\.usb\.org|riscv\.org|www\.riscv\.org|nodejs\.org|www\.acm\.org|acm\.org|api-docs\.deepseek\.com)$/iu.test(hostname)) {
                    authority += 24;
                } else if (/\.org$/iu.test(hostname)) {
                    authority += 3;
                }
                if (personProfile) {
                    if (/\.edu$/iu.test(hostname) && /(?:faculty|people|person|profile|directory|professor|homepage)/iu.test(item.url)) authority += 18;
                    if (/^(?:orcid\.org|www\.orcid\.org)$/iu.test(hostname)) authority += 16;
                    if (/(?:crossref|dblp|openalex|semanticscholar|arxiv|europepmc)/iu.test(item.provider)) authority -= 28;
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
            return { ...item, score: authority };
        })
        .toSorted((left, right) => right.score - left.score)
        .filter(item => {
            const key = item.url.replace(/^https?:\/\/(?:www\.)?/u, "").replace(/\/$/u, "").toLocaleLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 8);
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
    ].join("\n\n").slice(0, 7_000);
}

function putCache(key: string, value: ReadWeaveSearchEvidence) {
    cache.set(key, {
        expiresAt: Date.now() + (isFreshnessSensitiveQuery(value.query) ? CURRENT_CACHE_TTL_MS : CACHE_TTL_MS),
        value
    });
    while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cache.delete(oldest);
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
        return { sources: [], warning: `${name}：${error instanceof Error ? error.message : "请求失败"}` };
    }
}

async function searchUncached(input: SearchInput, fetcher: FetchLike): Promise<ReadWeaveSearchEvidence> {
    const startedAt = Date.now();
    const config = getReadWeaveSearchRuntimeConfig();
    const query = normalizeQuery(input.query);
    if (!query || config.mode === "off" || (!input.force && config.mode === "automatic" && !automaticSearchWanted(input))) {
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

    const academic = isAcademicQuery(`${query}\n${input.context ?? ""}`);
    const orcidId = `${query}\n${input.context ?? ""}`
        .match(/\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/iu)?.[0]?.toLocaleUpperCase();
    const freeAdapters: Array<[string, SearchAdapter]> = [
        ...(isDeepSeekOfficialModelQuery(query)
            ? [ [ "DeepSeek API Docs", deepSeekOfficialModelsSearch ] as [string, SearchAdapter] ]
            : []),
        [ "Wikipedia", wikipediaSearch ],
        ...(isPersonProfileQuery(query)
            ? [ [ "ORCID", orcidEmploymentSearch ] as [string, SearchAdapter] ]
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
    let sources = deduplicateAndRank(free.flatMap(item => item.sources), query);
    let searchCostCny = 0;

    const needsGeneralSearch = input.allowPaid !== false
        && (isFreshnessSensitiveQuery(query) || sources.length < 2 || config.mode === "always");
    if (needsGeneralSearch) {
        const focusedQuery = buildFocusedGeneralSearchQuery(query);
        const paidFallbacks: Array<[string, SearchAdapter, number, boolean]> = [
            // Tavily's Researcher plan has a monthly free quota and pay-as-you-go
            // is off by default. Exhaustion therefore fails closed rather than billing.
            [ "Tavily", tavilySearch, 0, !!config.tavilyApiKey ],
            [ "Serper", serperSearch, 0.001 * CNY_PER_USD, !!config.serperApiKey ],
            [ "Brave Search", braveSearch, 0.005 * CNY_PER_USD, !!config.braveApiKey ],
            [ "Jina Search", jinaSearch, 0.001 * CNY_PER_USD, !!config.jinaApiKey ]
        ];
        for (const [ name, adapter, estimatedCost, configured ] of paidFallbacks) {
            if (!configured || searchCostCny + estimatedCost > config.budgetCny) continue;
            const fallback = await runAdapter(name, adapter, focusedQuery, config, fetcher);
            if (fallback.warning) warnings.push(fallback.warning);
            if (fallback.sources.length > 0) {
                searchCostCny += estimatedCost;
                sources = deduplicateAndRank([ ...sources, ...fallback.sources ], query);
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
    options: { fetcher?: FetchLike; bypassCache?: boolean } = {}
): Promise<ReadWeaveSearchEvidence> {
    const config = getReadWeaveSearchRuntimeConfig();
    const normalized = normalizeQuery(input.query);
    const cacheKey = JSON.stringify({
        query: normalized.toLocaleLowerCase(),
        context: plainText(input.context, 600).toLocaleLowerCase(),
        kind: input.kind,
        localEvidenceSufficient: !!input.localEvidenceSufficient,
        allowPaid: input.allowPaid !== false,
        mode: config.mode,
        providers: [
            !!config.serperApiKey,
            !!config.tavilyApiKey,
            !!config.braveApiKey,
            !!config.jinaApiKey,
            !!config.semanticScholarApiKey,
            !!config.openAlexApiKey,
            !!config.unpaywallEmail
        ]
    });
    if (!options.bypassCache) {
        const cached = cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return { ...cached.value, elapsedMs: 0, cacheHit: true, searchCostCny: 0 };
        }
        const existing = inFlight.get(cacheKey);
        if (existing) return { ...(await existing), cacheHit: true, searchCostCny: 0 };
    }
    const operation = searchUncached(input, options.fetcher ?? fetch);
    inFlight.set(cacheKey, operation);
    try {
        const result = await operation;
        if (result.used) putCache(cacheKey, result);
        return result;
    } finally {
        inFlight.delete(cacheKey);
    }
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
        sources: evidence.sources.map(({ provider, title, url, snippet }) => ({ provider, title, url, snippet })),
        warnings: evidence.warnings
    };
}

export function clearReadWeaveSearchCacheForTests() {
    cache.clear();
    inFlight.clear();
}
