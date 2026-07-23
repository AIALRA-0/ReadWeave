import type {
    ReadWeaveAiSettings,
    ReadWeaveAiSettingsUpdate,
    ReadWeaveModelInfo
} from "@triliumnext/commons";
import { options as optionService, ValidationError } from "@triliumnext/core";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-pro";
const MAX_API_KEY_LENGTH = 4_096;

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

function maskApiKey(value: string): string {
    if (value.length <= 8) return "••••••••";
    return `${value.slice(0, 3)}••••••••${value.slice(-4)}`;
}

export function getReadWeaveRuntimeConfig(): { apiKey: string; baseUrl: string; model: string } {
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

export function getReadWeaveAiSettings(): ReadWeaveAiSettings {
    const credential = configuredApiKey();
    return {
        baseUrl: optionService.getOptionOrNull("readWeaveBaseUrl")?.trim()
            || process.env.READWEAVE_API_BASE_URL?.trim()
            || DEFAULT_BASE_URL,
        model: optionService.getOptionOrNull("readWeaveModel")?.trim()
            || process.env.READWEAVE_DEEPSEEK_MODEL?.trim()
            || DEFAULT_MODEL,
        hasApiKey: !!credential.value,
        maskedApiKey: credential.value ? maskApiKey(credential.value) : undefined,
        credentialSource: credential.source
    };
}

export function updateReadWeaveAiSettings(request: ReadWeaveAiSettingsUpdate): ReadWeaveAiSettings {
    const baseUrl = normalizeBaseUrl(request.baseUrl);
    const model = normalizeModel(request.model);
    optionService.setOption("readWeaveBaseUrl", baseUrl);
    optionService.setOption("readWeaveModel", model);

    if (request.clearApiKey) {
        optionService.setOption("readWeaveApiKey", "");
    } else if (request.apiKey !== undefined) {
        if (typeof request.apiKey !== "string" || !request.apiKey.trim() || request.apiKey.length > MAX_API_KEY_LENGTH) {
            throw new ValidationError("The ReadWeave API key is invalid.");
        }
        optionService.setOption("readWeaveApiKey", request.apiKey.trim());
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
