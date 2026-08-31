import type {
    ReadWeaveAiSettings,
    ReadWeaveAiSettingsUpdate,
    ReadWeaveModelInfo
} from "@triliumnext/commons";
import { options as optionService, ValidationError } from "@triliumnext/core";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_SEARCH_MODE = "automatic";
const DEFAULT_SEARCH_BUDGET_CNY = 0.009;
const MAX_API_KEY_LENGTH = 4_096;
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
    semanticScholarApiKey?: string;
    openAlexApiKey?: string;
    unpaywallEmail?: string;
}

export interface ReadWeaveModelRuntimeConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

interface ModelsPayload {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
}

function normalizeBaseUrl(value: unknown): string {
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
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
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
    const environment = process.env.READWEAVE_DEEPSEEK_API_KEY?.trim();
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
    return value === "off" || value === "always" || value === "automatic" ? value : DEFAULT_SEARCH_MODE;
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
        semanticScholarApiKey: storedOrEnvironment("readWeaveSemanticScholarApiKey", "SEMANTIC_SCHOLAR_API_KEY"),
        openAlexApiKey: storedOrEnvironment("readWeaveOpenAlexApiKey", "OPENALEX_API_KEY"),
        unpaywallEmail: storedOrEnvironment("readWeaveUnpaywallEmail", "UNPAYWALL_EMAIL")
    };
}

export function getReadWeaveRuntimeConfig(): ReadWeaveModelRuntimeConfig {
    const credential = configuredApiKey();
    if (!credential.value) throw new ValidationError("ReadWeave API is not configured. Add an API key in Settings → AI / LLM → ReadWeave.");
    return {
        apiKey: credential.value,
        baseUrl: optionService.getOptionOrNull("readWeaveBaseUrl")?.trim()
            || process.env.READWEAVE_API_BASE_URL?.trim()
            || DEFAULT_BASE_URL,
        model: optionService.getOptionOrNull("readWeaveModel")?.trim()
            || process.env.READWEAVE_DEEPSEEK_MODEL?.trim()
            || DEFAULT_MODEL
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
    if (writerHost === verifierHost) return undefined;
    return { apiKey: credential.value, baseUrl, model };
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
    const independent = !!verifierCredential.value && !!verifierBaseUrl && !!verifierModel
        && new URL(verifierBaseUrl).hostname.toLowerCase() !== new URL(writerBaseUrl).hostname.toLowerCase();
    return {
        baseUrl: writerBaseUrl,
        model: optionService.getOptionOrNull("readWeaveModel")?.trim()
            || process.env.READWEAVE_DEEPSEEK_MODEL?.trim()
            || DEFAULT_MODEL,
        hasApiKey: !!credential.value,
        maskedApiKey: credential.value ? maskApiKey(credential.value) : undefined,
        credentialSource: credential.source,
        searchMode: search.mode,
        searchBudgetCny: search.budgetCny,
        mathShortcut: optionService.getOptionOrNull("readWeaveMathShortcut")?.trim() || "Alt+=",
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
    const baseUrl = normalizeBaseUrl(request.baseUrl);
    const model = normalizeModel(request.model);
    optionService.setOption("readWeaveBaseUrl", baseUrl);
    optionService.setOption("readWeaveModel", model);

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
        optionService.setOption("readWeaveSearchMode", request.searchMode);
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
    const payload = await response.json() as ModelsPayload;
    if (!response.ok) {
        throw new ValidationError(`The configured model service rejected the connection (${response.status}): ${payload.error?.message || "unknown error"}`);
    }
    const models = (payload.data ?? [])
        .flatMap(item => typeof item.id === "string" && item.id.trim() ? [ { id: item.id.trim() } ] : [])
        .toSorted((left, right) => left.id.localeCompare(right.id));
    if (models.length === 0) throw new ValidationError("The configured model service returned no selectable models.");
    return models;
}
