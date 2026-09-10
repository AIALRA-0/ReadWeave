import type {
    ReadWeaveAiSettings,
    ReadWeaveAiSettingsUpdate,
    ReadWeaveModelInfo
} from "@triliumnext/commons";
import { options as optionService, ValidationError } from "@triliumnext/core";

import { type ReadWeaveModelRates,readWeaveModelRates } from "./readweave_budget.js";
import { NonRetryableReadWeaveError } from "./readweave_errors.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_PROVIDER_TYPE = "deepseek-official" as const;
const DEFAULT_SEARCH_MODE = "always";
const DEFAULT_SEARCH_BUDGET_CNY = 0.009;
const MAX_API_KEY_LENGTH = 4_096;
const MAX_RATE_CNY_PER_MILLION = 10_000;
const FREE_SEARCH_PROVIDERS = [
    "Crossref",
    "DBLP",
    "OpenAlex",
    "Semantic Scholar",
    "Europe PMC",
    "arXiv",
    "ORCID",
    "Wikipedia"
] as const;
type ReadWeaveSecretOptionName =
    | "readWeaveVerifierApiKey"
    | "readWeaveSerperApiKey"
    | "readWeaveTavilyApiKey"
    | "readWeaveBraveApiKey"
    | "readWeaveJinaApiKey"
    | "readWeaveExaApiKey"
    | "readWeaveSemanticScholarApiKey"
    | "readWeaveOpenAlexApiKey"
    | "readWeaveUnpaywallEmail";

export interface ReadWeaveSearchRuntimeConfig {
    mode: "off" | "automatic" | "always";
    budgetCny: number;
    serperApiKey?: string;
    tavilyApiKey?: string;
    braveApiKey?: string;
    jinaApiKey?: string;
    exaApiKey?: string;
    semanticScholarApiKey?: string;
    openAlexApiKey?: string;
    unpaywallEmail?: string;
}

export interface ReadWeaveModelRuntimeConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    providerType: ReadWeaveAiSettings["providerType"];
    rates: ReadWeaveModelRates;
    pricingVersion: string;
}

interface ModelsPayload {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
}

function normalizeBaseUrl(
    value: unknown,
    providerType?: ReadWeaveAiSettings["providerType"]
): string {
    if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
        throw new ValidationError("A valid ReadWeave API base URL is required.");
    }
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new ValidationError("The ReadWeave API base URL is invalid.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new ValidationError("The ReadWeave API base URL must use HTTP or HTTPS.");
    }
    if (url.username || url.password) throw new ValidationError("服务地址不能包含账号或密码，请使用独立的 API 密钥字段");
    url.hash = "";
    url.search = "";
    if (providerType === "deepseek-compatible" && url.pathname === "/") url.pathname = "/v1";
    return url.toString().replace(/\/$/, "");
}

function inferProviderType(baseUrl: string): ReadWeaveAiSettings["providerType"] {
    try {
        return /(^|\.)deepseek\.com$/iu.test(new URL(baseUrl).hostname)
            ? "deepseek-official" : "deepseek-compatible";
    } catch {
        return DEFAULT_PROVIDER_TYPE;
    }
}

function configuredProviderType(baseUrl: string): ReadWeaveAiSettings["providerType"] {
    const configured = optionService.getOptionOrNull("readWeaveProviderType")?.trim()
        || process.env.READWEAVE_PROVIDER_TYPE?.trim();
    return configured === "deepseek-official" || configured === "deepseek-compatible"
        ? configured : inferProviderType(baseUrl);
}

function parseRateOption(name: "readWeaveCacheHitInputCnyPerMillion"
    | "readWeaveCacheMissInputCnyPerMillion" | "readWeaveOutputCnyPerMillion"): number | undefined {
    const value = optionService.getOptionOrNull(name)?.trim();
    if (!value) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_RATE_CNY_PER_MILLION
        ? parsed : undefined;
}

function configuredPricing(
    providerType: ReadWeaveAiSettings["providerType"],
    model: string
): ReadWeaveAiSettings["pricing"] & { rates: ReadWeaveModelRates; pricingVersion: string } {
    if (providerType === "deepseek-official") {
        const rates = readWeaveModelRates(model);
        return {
            cacheHitInputCnyPerMillion: rates.cacheHitInput,
            cacheMissInputCnyPerMillion: rates.cacheMissInput,
            outputCnyPerMillion: rates.output,
            source: "official",
            rates,
            pricingVersion: "deepseek-official-cny-2026-09-09"
        };
    }
    const fallback = readWeaveModelRates(model);
    const cacheHitInput = parseRateOption("readWeaveCacheHitInputCnyPerMillion");
    const cacheMissInput = parseRateOption("readWeaveCacheMissInputCnyPerMillion");
    const output = parseRateOption("readWeaveOutputCnyPerMillion");
    const complete = cacheHitInput !== undefined && cacheMissInput !== undefined && output !== undefined;
    const rates = {
        cacheHitInput: cacheHitInput ?? fallback.cacheHitInput,
        cacheMissInput: cacheMissInput ?? fallback.cacheMissInput,
        output: output ?? fallback.output
    };
    return {
        cacheHitInputCnyPerMillion: rates.cacheHitInput,
        cacheMissInputCnyPerMillion: rates.cacheMissInput,
        outputCnyPerMillion: rates.output,
        source: complete ? "custom" : "conservative-default",
        rates,
        pricingVersion: complete ? "third-party-configured-cny-v1" : "third-party-conservative-cny-v1"
    };
}

function normalizeProviderType(value: unknown): ReadWeaveAiSettings["providerType"] {
    if (value === "deepseek-official" || value === "deepseek-compatible") return value;
    throw new ValidationError("The ReadWeave model provider type is invalid.");
}

function normalizeRate(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)
        || value < 0 || value > MAX_RATE_CNY_PER_MILLION) {
        throw new ValidationError(`${label} must be between 0 and ${MAX_RATE_CNY_PER_MILLION} CNY per million tokens.`);
    }
    return value;
}

function normalizeModel(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 256) {
        throw new ValidationError("A ReadWeave model name is required.");
    }
    const model = value.trim();
    if (!/^[A-Za-z0-9._:/-]+$/.test(model)) {
        throw new ValidationError("The ReadWeave model name contains unsupported characters.");
    }
    return model;
}

function configuredApiKey(): { value?: string; source: ReadWeaveAiSettings["credentialSource"] } {
    const stored = optionService.getOptionOrNull("readWeaveApiKey")?.trim();
    if (stored) return { value: stored, source: "settings" };
    const environment = process.env.READWEAVE_API_KEY?.trim()
        || process.env.READWEAVE_DEEPSEEK_API_KEY?.trim();
    if (environment) return { value: environment, source: "environment" };
    return { source: "missing" };
}

function configuredVerifierApiKey(): { value?: string; source: ReadWeaveAiSettings["credentialSource"] } {
    const stored = optionService.getOptionOrNull("readWeaveVerifierApiKey")?.trim();
    if (stored) return { value: stored, source: "settings" };
    const environment = process.env.READWEAVE_VERIFIER_API_KEY?.trim();
    if (environment) return { value: environment, source: "environment" };
    return { source: "missing" };
}

function maskApiKey(value: string): string {
    if (value.length <= 8) return "••••••••";
    return `${value.slice(0, 3)}••••••••${value.slice(-4)}`;
}

function storedOrEnvironment(optionName: ReadWeaveSecretOptionName, environmentName: string): string | undefined {
    return optionService.getOptionOrNull(optionName)?.trim() || process.env[environmentName]?.trim() || undefined;
}

function searchMode(): ReadWeaveSearchRuntimeConfig["mode"] {
    const value = optionService.getOptionOrNull("readWeaveSearchMode")?.trim();
    // Automatic routing is no longer a user-facing mode.  Treat the old
    // persisted value as the new default so existing installations also
    // search by default without a database migration.
    return value === "off" ? "off" : DEFAULT_SEARCH_MODE;
}

function searchBudgetCny(): number {
    const parsed = Number.parseFloat(optionService.getOptionOrNull("readWeaveSearchBudgetCny") ?? "");
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_SEARCH_BUDGET_CNY;
}

function maskEmail(value: string): string {
    const [ local, domain ] = value.split("@");
    if (!domain) return "••••••••";
    return `${local.slice(0, 2)}•••@${domain}`;
}

function normalizeOptionalSecret(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_API_KEY_LENGTH) {
        throw new ValidationError(`${label} is invalid.`);
    }
    return value.trim();
}

function updateOptionalSecret(
    request: ReadWeaveAiSettingsUpdate,
    valueKey: keyof ReadWeaveAiSettingsUpdate,
    clearKey: keyof ReadWeaveAiSettingsUpdate,
    optionName: ReadWeaveSecretOptionName,
    label: string
) {
    if (request[clearKey] === true) {
        optionService.setOption(optionName, "");
    } else if (request[valueKey] !== undefined) {
        optionService.setOption(optionName, normalizeOptionalSecret(request[valueKey], label));
    }
}

export function getReadWeaveSearchRuntimeConfig(): ReadWeaveSearchRuntimeConfig {
    return {
        mode: searchMode(),
        budgetCny: searchBudgetCny(),
        serperApiKey: storedOrEnvironment("readWeaveSerperApiKey", "SERPER_API_KEY"),
        tavilyApiKey: storedOrEnvironment("readWeaveTavilyApiKey", "TAVILY_API_KEY"),
        braveApiKey: storedOrEnvironment("readWeaveBraveApiKey", "BRAVE_SEARCH_API_KEY"),
        jinaApiKey: storedOrEnvironment("readWeaveJinaApiKey", "JINA_API_KEY"),
        exaApiKey: storedOrEnvironment("readWeaveExaApiKey", "EXA_API_KEY"),
        semanticScholarApiKey: storedOrEnvironment("readWeaveSemanticScholarApiKey", "SEMANTIC_SCHOLAR_API_KEY"),
        openAlexApiKey: storedOrEnvironment("readWeaveOpenAlexApiKey", "OPENALEX_API_KEY"),
        unpaywallEmail: storedOrEnvironment("readWeaveUnpaywallEmail", "UNPAYWALL_EMAIL")
    };
}

export function getReadWeaveRuntimeConfig(): ReadWeaveModelRuntimeConfig {
    const credential = configuredApiKey();
    if (!credential.value) {
        throw new NonRetryableReadWeaveError("ReadWeave API is not configured. Add an API key in Settings → AI / LLM → ReadWeave.");
    }
    const baseUrl = optionService.getOptionOrNull("readWeaveBaseUrl")?.trim()
        || process.env.READWEAVE_API_BASE_URL?.trim()
        || DEFAULT_BASE_URL;
    const model = optionService.getOptionOrNull("readWeaveModel")?.trim()
        || process.env.READWEAVE_MODEL?.trim()
        || process.env.READWEAVE_DEEPSEEK_MODEL?.trim()
        || DEFAULT_MODEL;
    const providerType = configuredProviderType(baseUrl);
    const pricing = configuredPricing(providerType, model);
    return {
        apiKey: credential.value,
        baseUrl: normalizeBaseUrl(baseUrl, providerType),
        model,
        providerType,
        rates: pricing.rates,
        pricingVersion: pricing.pricingVersion
    };
}

export function getReadWeaveVerifierRuntimeConfig(): ReadWeaveModelRuntimeConfig | undefined {
    const credential = configuredVerifierApiKey();
    const baseUrl = optionService.getOptionOrNull("readWeaveVerifierBaseUrl")?.trim()
        || process.env.READWEAVE_VERIFIER_API_BASE_URL?.trim();
    const model = optionService.getOptionOrNull("readWeaveVerifierModel")?.trim()
        || process.env.READWEAVE_VERIFIER_MODEL?.trim();
    if (!credential.value || !baseUrl || !model) return undefined;

    const writer = getReadWeaveRuntimeConfig();
    const writerHost = new URL(writer.baseUrl).hostname.toLowerCase();
    const verifierHost = new URL(baseUrl).hostname.toLowerCase();
    const modelFamily = (value: string) => value.toLowerCase().split(/[/:_-]/u).filter(Boolean)[0] ?? value.toLowerCase();
    if (writerHost === verifierHost || modelFamily(writer.model) === modelFamily(model)) return undefined;
    const providerType = inferProviderType(baseUrl);
    const pricing = configuredPricing(providerType, model);
    return {
        apiKey: credential.value,
        baseUrl,
        model,
        providerType,
        rates: pricing.rates,
        pricingVersion: pricing.pricingVersion
    };
}

export function getReadWeaveAiSettings(): ReadWeaveAiSettings {
    const credential = configuredApiKey();
    const verifierCredential = configuredVerifierApiKey();
    const search = getReadWeaveSearchRuntimeConfig();
    const verifierBaseUrl = optionService.getOptionOrNull("readWeaveVerifierBaseUrl")?.trim()
        || process.env.READWEAVE_VERIFIER_API_BASE_URL?.trim()
        || "";
    const verifierModel = optionService.getOptionOrNull("readWeaveVerifierModel")?.trim()
        || process.env.READWEAVE_VERIFIER_MODEL?.trim()
        || "";
    const writerBaseUrl = optionService.getOptionOrNull("readWeaveBaseUrl")?.trim()
        || process.env.READWEAVE_API_BASE_URL?.trim()
        || DEFAULT_BASE_URL;
    const modelFamily = (value: string) => value.toLowerCase().split(/[/:_-]/u).filter(Boolean)[0] ?? value.toLowerCase();
    const writerModel = optionService.getOptionOrNull("readWeaveModel")?.trim()
        || process.env.READWEAVE_MODEL?.trim()
        || process.env.READWEAVE_DEEPSEEK_MODEL?.trim()
        || DEFAULT_MODEL;
    const providerType = configuredProviderType(writerBaseUrl);
    const pricing = configuredPricing(providerType, writerModel);
    const independent = !!verifierCredential.value && !!verifierBaseUrl && !!verifierModel
        && new URL(verifierBaseUrl).hostname.toLowerCase() !== new URL(writerBaseUrl).hostname.toLowerCase()
        && modelFamily(verifierModel) !== modelFamily(writerModel);
    return {
        providerType,
        baseUrl: writerBaseUrl,
        model: writerModel,
        hasApiKey: !!credential.value,
        maskedApiKey: credential.value ? maskApiKey(credential.value) : undefined,
        credentialSource: credential.source,
        searchMode: search.mode,
        searchBudgetCny: search.budgetCny,
        mathShortcut: optionService.getOptionOrNull("readWeaveMathShortcut")?.trim() || "Alt+=",
        pricing: {
            cacheHitInputCnyPerMillion: pricing.cacheHitInputCnyPerMillion,
            cacheMissInputCnyPerMillion: pricing.cacheMissInputCnyPerMillion,
            outputCnyPerMillion: pricing.outputCnyPerMillion,
            source: pricing.source
        },
        verifier: {
            baseUrl: verifierBaseUrl,
            model: verifierModel,
            hasApiKey: !!verifierCredential.value,
            maskedApiKey: verifierCredential.value ? maskApiKey(verifierCredential.value) : undefined,
            credentialSource: verifierCredential.source,
            independent
        },
        search: {
            freeProviders: [ ...FREE_SEARCH_PROVIDERS ],
            hasSerperApiKey: !!search.serperApiKey,
            maskedSerperApiKey: search.serperApiKey ? maskApiKey(search.serperApiKey) : undefined,
            hasTavilyApiKey: !!search.tavilyApiKey,
            maskedTavilyApiKey: search.tavilyApiKey ? maskApiKey(search.tavilyApiKey) : undefined,
            hasBraveApiKey: !!search.braveApiKey,
            maskedBraveApiKey: search.braveApiKey ? maskApiKey(search.braveApiKey) : undefined,
            hasJinaApiKey: !!search.jinaApiKey,
            maskedJinaApiKey: search.jinaApiKey ? maskApiKey(search.jinaApiKey) : undefined,
            hasExaApiKey: !!search.exaApiKey,
            maskedExaApiKey: search.exaApiKey ? maskApiKey(search.exaApiKey) : undefined,
            hasSemanticScholarApiKey: !!search.semanticScholarApiKey,
            maskedSemanticScholarApiKey: search.semanticScholarApiKey ? maskApiKey(search.semanticScholarApiKey) : undefined,
            hasOpenAlexApiKey: !!search.openAlexApiKey,
            maskedOpenAlexApiKey: search.openAlexApiKey ? maskApiKey(search.openAlexApiKey) : undefined,
            hasUnpaywallEmail: !!search.unpaywallEmail,
            maskedUnpaywallEmail: search.unpaywallEmail ? maskEmail(search.unpaywallEmail) : undefined
        }
    };
}

export function updateReadWeaveAiSettings(request: ReadWeaveAiSettingsUpdate): ReadWeaveAiSettings {
    const providerType = request.providerType === undefined
        ? inferProviderType(String(request.baseUrl ?? ""))
        : normalizeProviderType(request.providerType);
    const baseUrl = normalizeBaseUrl(request.baseUrl, providerType);
    if (providerType === "deepseek-official" && inferProviderType(baseUrl) !== "deepseek-official") {
        throw new ValidationError("该地址属于第三方，请选择第三方模型来源并核对其价格");
    }
    const model = normalizeModel(request.model);
    // Validate the complete settings form before changing the selected provider.
    // A bad optional value must not leave a new endpoint paired with the old key.
    if (request.apiKey !== undefined) normalizeOptionalSecret(request.apiKey, "ReadWeave API key");
    if (request.verifierBaseUrl !== undefined && request.verifierBaseUrl.trim()) normalizeBaseUrl(request.verifierBaseUrl);
    if (request.verifierModel !== undefined && request.verifierModel.trim()) normalizeModel(request.verifierModel);
    for (const name of [ "verifierApiKey", "serperApiKey", "tavilyApiKey", "braveApiKey", "jinaApiKey",
        "exaApiKey", "semanticScholarApiKey", "openAlexApiKey", "unpaywallEmail" ] as const) {
        if (request[name] !== undefined) normalizeOptionalSecret(request[name], name);
    }
    if (request.unpaywallEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(request.unpaywallEmail.trim())) {
        throw new ValidationError("The Unpaywall email is invalid.");
    }
    if (request.searchMode !== undefined && ![ "off", "automatic", "always" ].includes(request.searchMode)) {
        throw new ValidationError("The ReadWeave search mode is invalid.");
    }
    if (request.searchBudgetCny !== undefined && (typeof request.searchBudgetCny !== "number"
        || !Number.isFinite(request.searchBudgetCny) || request.searchBudgetCny < 0 || request.searchBudgetCny > 1)) {
        throw new ValidationError("The ReadWeave search budget must be between 0 and 1 CNY.");
    }
    if (request.mathShortcut !== undefined && (typeof request.mathShortcut !== "string"
        || !/^(?:Alt|Ctrl|Meta|Shift)(?:\+(?:Alt|Ctrl|Meta|Shift))*\+[^+\s]+$/u.test(request.mathShortcut.trim())
        || request.mathShortcut.trim().length > 64)) throw new ValidationError("The ReadWeave math shortcut is invalid.");
    const prices = [
        [ "readWeaveCacheHitInputCnyPerMillion", request.cacheHitInputCnyPerMillion ],
        [ "readWeaveCacheMissInputCnyPerMillion", request.cacheMissInputCnyPerMillion ],
        [ "readWeaveOutputCnyPerMillion", request.outputCnyPerMillion ]
    ] as const;
    for (const [ , price ] of prices) if (price !== undefined) normalizeRate(price, "Model price");
    const previous = getReadWeaveAiSettings();
    if (previous.hasApiKey && new URL(previous.baseUrl).origin !== new URL(baseUrl).origin
        && !request.apiKey?.trim() && !request.clearApiKey) {
        throw new ValidationError("切换模型来源时请填写新来源的 API 密钥，原来源密钥不会自动发送给其他服务");
    }
    optionService.setOption("readWeaveProviderType", providerType);
    optionService.setOption("readWeaveBaseUrl", baseUrl);
    optionService.setOption("readWeaveModel", model);
    if (previous.baseUrl !== baseUrl || previous.model !== model) {
        for (const [ name, value ] of prices) if (value === undefined) optionService.setOption(name, "");
    }
    if (request.cacheHitInputCnyPerMillion !== undefined) {
        optionService.setOption("readWeaveCacheHitInputCnyPerMillion",
            normalizeRate(request.cacheHitInputCnyPerMillion, "Cache-hit input price").toString());
    }
    if (request.cacheMissInputCnyPerMillion !== undefined) {
        optionService.setOption("readWeaveCacheMissInputCnyPerMillion",
            normalizeRate(request.cacheMissInputCnyPerMillion, "Input price").toString());
    }
    if (request.outputCnyPerMillion !== undefined) {
        optionService.setOption("readWeaveOutputCnyPerMillion",
            normalizeRate(request.outputCnyPerMillion, "Output price").toString());
    }

    if (request.verifierBaseUrl !== undefined) {
        optionService.setOption("readWeaveVerifierBaseUrl", request.verifierBaseUrl.trim() ? normalizeBaseUrl(request.verifierBaseUrl) : "");
    }
    if (request.verifierModel !== undefined) {
        optionService.setOption("readWeaveVerifierModel", request.verifierModel.trim() ? normalizeModel(request.verifierModel) : "");
    }
    updateOptionalSecret(request, "verifierApiKey", "clearVerifierApiKey", "readWeaveVerifierApiKey", "ReadWeave verifier API key");

    if (request.clearApiKey) {
        optionService.setOption("readWeaveApiKey", "");
    } else if (request.apiKey !== undefined) {
        if (typeof request.apiKey !== "string" || !request.apiKey.trim() || request.apiKey.length > MAX_API_KEY_LENGTH) {
            throw new ValidationError("The ReadWeave API key is invalid.");
        }
        optionService.setOption("readWeaveApiKey", request.apiKey.trim());
    }
    if (request.searchMode !== undefined) {
        if (request.searchMode !== "off" && request.searchMode !== "automatic" && request.searchMode !== "always") {
            throw new ValidationError("The ReadWeave search mode is invalid.");
        }
        optionService.setOption("readWeaveSearchMode", request.searchMode === "off" ? "off" : "always");
    }
    if (request.searchBudgetCny !== undefined) {
        if (typeof request.searchBudgetCny !== "number" || !Number.isFinite(request.searchBudgetCny)
            || request.searchBudgetCny < 0 || request.searchBudgetCny > 1) {
            throw new ValidationError("The ReadWeave search budget must be between 0 and 1 CNY.");
        }
        optionService.setOption("readWeaveSearchBudgetCny", request.searchBudgetCny.toFixed(4));
    }
    if (request.mathShortcut !== undefined) {
        if (typeof request.mathShortcut !== "string" || !/^(?:Alt|Ctrl|Meta|Shift)(?:\+(?:Alt|Ctrl|Meta|Shift))*\+[^+\s]+$/u.test(request.mathShortcut.trim())
            || request.mathShortcut.trim().length > 64) {
            throw new ValidationError("The ReadWeave math shortcut is invalid.");
        }
        optionService.setOption("readWeaveMathShortcut", request.mathShortcut.trim());
    }
    updateOptionalSecret(request, "serperApiKey", "clearSerperApiKey", "readWeaveSerperApiKey", "Serper API key");
    updateOptionalSecret(request, "tavilyApiKey", "clearTavilyApiKey", "readWeaveTavilyApiKey", "Tavily API key");
    updateOptionalSecret(request, "braveApiKey", "clearBraveApiKey", "readWeaveBraveApiKey", "Brave Search API key");
    updateOptionalSecret(request, "jinaApiKey", "clearJinaApiKey", "readWeaveJinaApiKey", "Jina API key");
    updateOptionalSecret(request, "exaApiKey", "clearExaApiKey", "readWeaveExaApiKey", "Exa API key");
    updateOptionalSecret(request, "semanticScholarApiKey", "clearSemanticScholarApiKey", "readWeaveSemanticScholarApiKey", "Semantic Scholar API key");
    updateOptionalSecret(request, "openAlexApiKey", "clearOpenAlexApiKey", "readWeaveOpenAlexApiKey", "OpenAlex API key");
    if (request.clearUnpaywallEmail) {
        optionService.setOption("readWeaveUnpaywallEmail", "");
    } else if (request.unpaywallEmail !== undefined) {
        const email = normalizeOptionalSecret(request.unpaywallEmail, "Unpaywall email");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new ValidationError("The Unpaywall email is invalid.");
        optionService.setOption("readWeaveUnpaywallEmail", email);
    }
    return getReadWeaveAiSettings();
}

function endpoint(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export async function listReadWeaveModels(): Promise<ReadWeaveModelInfo[]> {
    const config = getReadWeaveRuntimeConfig();
    const response = await fetch(endpoint(config.baseUrl, "models"), {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000)
    });
    let payload: ModelsPayload;
    try {
        payload = JSON.parse(await response.text()) as ModelsPayload;
    } catch {
        throw new ValidationError(`连接失败（HTTP ${response.status}）：服务返回网页或非 JSON 内容，第三方服务地址通常应以 /v1 结尾`);
    }
    if (!response.ok) {
        const reason = response.status === 401 ? "API 密钥无效，网页账号密码不能代替密钥"
            : response.status === 403 ? "密钥没有访问权限"
                : response.status === 402 ? "供应商返回账户额度不足，请核对该来源账户"
                    : response.status === 404 ? "模型列表路径不存在，请检查服务地址的 /v1 路径"
                        : response.status === 429 ? "供应商正在限流，请稍后再试"
                            : "供应商暂时不可用，请稍后再试";
        throw new ValidationError(`连接失败（${new URL(config.baseUrl).hostname}；HTTP ${response.status}）：${reason}`);
    }
    const models = (Array.isArray(payload?.data) ? payload.data : [])
        .flatMap(item => item && typeof item.id === "string" && item.id.trim() ? [ { id: item.id.trim() } ] : [])
        .toSorted((left, right) => left.id.localeCompare(right.id));
    if (models.length === 0) throw new ValidationError("连接成功，但供应商未返回模型列表；可手动填写供应商提供的模型名称");
    return models;
}
