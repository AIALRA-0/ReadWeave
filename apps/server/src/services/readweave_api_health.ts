import type {
    ReadWeaveApiAlert,
    ReadWeaveApiAlertCode,
    ReadWeaveApiControlSettings,
    ReadWeaveApiProviderHealth,
    ReadWeaveApiProviderId,
    ReadWeaveApiProviderProfile
} from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";

import {
    getReadWeaveApiControlSettings,
    getReadWeaveApiProviderSecret,
    listReadWeaveApiProviders,
    resolveReadWeaveApiAlerts,
    saveReadWeaveApiAlert,
    saveReadWeaveApiHealth,
    setReadWeaveApiMonitorMeta
} from "./readweave_api_registry.js";

interface ProbeResult {
    ok: boolean;
    statusCode?: number;
    latencyMs: number;
    errorCode?: ReadWeaveApiAlertCode;
    error?: string;
    catalogVerified?: boolean;
    callableVerified?: boolean;
    detectedModels?: string[];
    quota?: ReadWeaveApiProviderHealth["quota"];
}

let monitorStarted = false;
let monitorTimer: NodeJS.Timeout | undefined;
let cycleRunning = false;
let lastFullProbeAt = 0;

function safeErrorMessage(value: unknown): string {
    const message = value instanceof Error ? value.message : String(value);
    return message
        .replace(/([?&](?:api[_-]?key|key|token)=)[^&\s]+/giu, "$1[已隐藏密钥]")
        .replace(/\b(?:sk|octen)-[A-Za-z0-9_-]{8,}\b/gu, "[已隐藏密钥]")
        .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/giu, "$1[已隐藏密钥]")
        .slice(0, 500);
}

function classifyStatus(status: number, body: string): { code: ReadWeaveApiAlertCode; message: string } {
    const detail = body.replace(/\s+/gu, " ").slice(0, 240);
    if (status === 401) return { code: "authentication", message: `API Key 无效或已撤销（HTTP 401）${detail ? `：${detail}` : ""}` };
    if (status === 402) return { code: "quota-exhausted", message: `API 额度已耗尽（HTTP 402）${detail ? `：${detail}` : ""}` };
    if (status === 403 && /balance|quota|credit|额度|余额/iu.test(body)) return { code: "quota-exhausted", message: `API 额度不足或账户受限（HTTP 403）${detail ? `：${detail}` : ""}` };
    if (status === 403) return { code: "authentication", message: `API Key 没有所需权限（HTTP 403）${detail ? `：${detail}` : ""}` };
    if (status === 404) return { code: "endpoint", message: `接口不存在或当前账户未开放（HTTP 404）${detail ? `：${detail}` : ""}` };
    if (status === 408) return { code: "timeout", message: "接口请求超时（HTTP 408）" };
    if (status === 429) return { code: "provider-unstable", message: `接口触发频率或额度限制（HTTP 429）${detail ? `：${detail}` : ""}` };
    return { code: status >= 500 ? "provider-unstable" : "request-failed", message: `接口返回 HTTP ${status}${detail ? `：${detail}` : ""}` };
}

async function request(url: string, init: RequestInit, timeoutMs = 30_000): Promise<{ response: Response; json?: any; text: string; latencyMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const started = Date.now();
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        let json: any;
        try { json = text ? JSON.parse(text) : undefined; } catch { /* Keep the raw body for diagnostics. */ }
        return { response, json, text, latencyMs: Date.now() - started };
    } finally {
        clearTimeout(timer);
    }
}

function keyHeaders(profile: ReadWeaveApiProviderProfile, apiKey: string): Record<string, string> {
    if (profile.authType === "bearer") return { Authorization: `Bearer ${apiKey}` };
    return { "x-api-key": apiKey };
}

async function probeModel(profile: ReadWeaveApiProviderProfile, apiKey: string, full: boolean): Promise<ProbeResult> {
    const modelsUrl = `${profile.baseUrl.replace(/\/$/u, "")}/models`;
    const catalog = await request(modelsUrl, { headers: keyHeaders(profile, apiKey) });
    if (!catalog.response.ok) {
        const failure = classifyStatus(catalog.response.status, catalog.text);
        return { ok: false, statusCode: catalog.response.status, latencyMs: catalog.latencyMs, errorCode: failure.code, error: failure.message };
    }
    const detectedModels = Array.isArray(catalog.json?.data)
        ? catalog.json.data.map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === "string") : [];
    let quota: ReadWeaveApiProviderHealth["quota"] | undefined;
    if (profile.id === "kuafu") {
        const usage = await request(`${profile.baseUrl.replace(/\/$/u, "")}/usage`, { headers: keyHeaders(profile, apiKey) });
        if (usage.response.ok) {
            const remaining = Number(usage.json?.remaining ?? usage.json?.balance);
            const used = Number(usage.json?.usage?.total?.actual_cost);
            const validRemaining = Number.isFinite(remaining) ? remaining : undefined;
            const validUsed = Number.isFinite(used) ? used : undefined;
            quota = {
                supported: validRemaining !== undefined,
                unit: "USD",
                remaining: validRemaining,
                used: validUsed,
                limit: validRemaining !== undefined && validUsed !== undefined ? validRemaining + validUsed : undefined,
                detail: validRemaining === undefined
                    ? "用量接口可访问，但没有返回可识别的余额"
                    : `钱包剩余 ${validRemaining.toFixed(6)} USD；累计实付 ${(validUsed ?? 0).toFixed(6)} USD`
            };
        }
    }
    if (profile.model && detectedModels.length && !detectedModels.includes(profile.model)) {
        return { ok: false, statusCode: 200, latencyMs: catalog.latencyMs, errorCode: "model-missing", error: `配置的模型 ${profile.model} 不在平台当前模型列表中`, catalogVerified: true, detectedModels };
    }
    if (!full) return { ok: true, statusCode: 200, latencyMs: catalog.latencyMs, catalogVerified: true, callableVerified: profile.health.callableVerified, detectedModels, quota };
    const completion = await request(`${profile.baseUrl.replace(/\/$/u, "")}${profile.endpoint}`, {
        method: "POST", headers: { ...keyHeaders(profile, apiKey), "content-type": "application/json" },
        body: JSON.stringify({ model: profile.model, input: "Reply with exactly OK", max_output_tokens: 8 })
    }, 60_000);
    if (!completion.response.ok) {
        const failure = classifyStatus(completion.response.status, completion.text);
        if (/model/iu.test(completion.text) && completion.response.status === 404) failure.code = "model-unavailable";
        return { ok: false, statusCode: completion.response.status, latencyMs: completion.latencyMs, errorCode: failure.code, error: failure.message, catalogVerified: true, detectedModels };
    }
    const valid = completion.json?.status === "completed" || Array.isArray(completion.json?.output);
    return valid
        ? { ok: true, statusCode: 200, latencyMs: completion.latencyMs, catalogVerified: true, callableVerified: true, detectedModels, quota }
        : { ok: false, statusCode: 200, latencyMs: completion.latencyMs, errorCode: "configuration-drift", error: "响应接口返回了无法识别的成功结构", catalogVerified: true, detectedModels };
}

async function probeTinyFish(profile: ReadWeaveApiProviderProfile, apiKey: string, full: boolean): Promise<ProbeResult> {
    const url = full ? `${profile.baseUrl}?query=ReadWeave%20health%20check` : `${profile.baseUrl}/usage?limit=1`;
    const result = await request(url, { headers: keyHeaders(profile, apiKey) });
    if (!result.response.ok) {
        const failure = classifyStatus(result.response.status, result.text);
        return { ok: false, statusCode: result.response.status, latencyMs: result.latencyMs, errorCode: failure.code, error: failure.message };
    }
    const callable = full ? Array.isArray(result.json?.results) : profile.health.callableVerified;
    return { ok: true, statusCode: 200, latencyMs: result.latencyMs, callableVerified: callable,
        quota: { supported: false, detail: "Search 免费；普通密钥未返回可机读的剩余额度" } };
}

async function probeOpenAlex(profile: ReadWeaveApiProviderProfile, apiKey: string, full: boolean): Promise<ProbeResult> {
    const query = new URL(full ? `${profile.baseUrl}/works` : `${profile.baseUrl}/rate-limit`);
    query.searchParams.set("api_key", apiKey);
    if (full) { query.searchParams.set("search", "ReadWeave health check"); query.searchParams.set("per_page", "1"); }
    const result = await request(query.toString(), {});
    if (!result.response.ok) {
        const failure = classifyStatus(result.response.status, result.text);
        return { ok: false, statusCode: result.response.status, latencyMs: result.latencyMs, errorCode: failure.code, error: failure.message };
    }
    const rate = full ? undefined : result.json?.rate_limit;
    const quota = rate ? {
        supported: true, unit: "USD" as const, limit: Number(rate.daily_budget_usd), used: Number(rate.daily_used_usd),
        remaining: Number(rate.daily_remaining_usd), resetsAt: rate.resets_at,
        detail: `今日剩余 ${Number(rate.daily_remaining_usd).toFixed(4)} USD`
    } : profile.health.quota;
    return { ok: true, statusCode: 200, latencyMs: result.latencyMs, callableVerified: full ? Array.isArray(result.json?.results) : profile.health.callableVerified, quota };
}

async function probePaidSearch(profile: ReadWeaveApiProviderProfile, apiKey: string): Promise<ProbeResult> {
    const isOcten = profile.id === "octen";
    const body = isOcten
        ? { query: "ReadWeave health check", count: 1 }
        : { objective: "Find one official source about knowledge management", search_queries: [ "knowledge management official" ], mode: "turbo", advanced_settings: { max_results: 1, excerpt_settings: { max_chars_per_result: 300 } } };
    const result = await request(`${profile.baseUrl}${profile.endpoint}`, {
        method: "POST", headers: { ...keyHeaders(profile, apiKey), "content-type": "application/json" }, body: JSON.stringify(body)
    }, 45_000);
    if (!result.response.ok) {
        const failure = classifyStatus(result.response.status, result.text);
        return { ok: false, statusCode: result.response.status, latencyMs: result.latencyMs, errorCode: failure.code, error: failure.message };
    }
    const rows = isOcten ? result.json?.data?.results : result.json?.results;
    return { ok: Array.isArray(rows), statusCode: 200, latencyMs: result.latencyMs, callableVerified: Array.isArray(rows),
        errorCode: Array.isArray(rows) ? undefined : "configuration-drift",
        error: Array.isArray(rows) ? undefined : "搜索接口返回了无法识别的成功结构",
        quota: { supported: false, detail: isOcten ? "普通密钥无公开余额接口；已记录本次调用用量" : "普通搜索密钥无余额权限；已记录本次调用用量" } };
}

export async function probeReadWeaveApiProvider(providerId: ReadWeaveApiProviderId, full = true): Promise<ReadWeaveApiProviderProfile> {
    const profile = listReadWeaveApiProviders().find(item => item.id === providerId);
    if (!profile) throw new Error(`Unknown ReadWeave API provider: ${providerId}`);
    if (!profile.enabled) return profile;
    const apiKey = getReadWeaveApiProviderSecret(providerId);
    const now = new Date().toISOString();
    let result: ProbeResult;
    if (!apiKey) result = { ok: false, latencyMs: 0, errorCode: "authentication", error: "尚未配置 API Key" };
    else try {
        if (profile.kind === "model") result = await probeModel(profile, apiKey, full);
        else if (profile.id === "tinyfish") result = await probeTinyFish(profile, apiKey, full);
        else if (profile.id === "openalex") result = await probeOpenAlex(profile, apiKey, full);
        else if (!full) return profile;
        else result = await probePaidSearch(profile, apiKey);
    } catch (error) {
        result = { ok: false, latencyMs: 0, errorCode: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "endpoint", error: safeErrorMessage(error) };
    }
    const previous = profile.health;
    const failures = result.ok ? 0 : previous.consecutiveFailures + 1;
    const successRate = Math.round((((previous.successRate ?? (result.ok ? 1 : 0)) * 0.8) + (result.ok ? 0.2 : 0)) * 10_000) / 10_000;
    const health: ReadWeaveApiProviderHealth = {
        state: result.ok ? "healthy" : failures >= 3 ? "unavailable" : "degraded",
        checkedAt: now, lastSuccessAt: result.ok ? now : previous.lastSuccessAt,
        lastFailureAt: result.ok ? previous.lastFailureAt : now,
        latencyMs: result.latencyMs, successRate, consecutiveFailures: failures,
        lastErrorCode: result.ok ? undefined : result.errorCode, lastError: result.ok ? undefined : result.error,
        catalogVerified: result.catalogVerified ?? previous.catalogVerified,
        callableVerified: result.callableVerified ?? previous.callableVerified,
        detectedModels: result.detectedModels ?? previous.detectedModels,
        quota: result.quota ?? previous.quota ?? DEFAULT_QUOTA
    };
    saveReadWeaveApiHealth(providerId, health, result.statusCode);
    if (result.ok) {
        resolveReadWeaveApiAlerts(providerId, now);
        if (health.quota.supported && health.quota.remaining !== undefined && health.quota.limit
            && health.quota.remaining <= Math.max(0.1, health.quota.limit * 0.1)) {
            saveAlert(profile, "quota-low", `可用额度即将耗尽：${health.quota.detail ?? health.quota.remaining}`, health, "warning");
        }
    } else {
        saveAlert(profile, result.errorCode ?? "request-failed", result.error ?? "API 检测失败", health,
            failures >= 3 || result.errorCode === "authentication" || result.errorCode === "quota-exhausted" ? "critical" : "warning");
    }
    return listReadWeaveApiProviders().find(item => item.id === providerId)!;
}

const DEFAULT_QUOTA: ReadWeaveApiProviderHealth["quota"] = { supported: false, detail: "平台未提供可机读额度" };

function saveAlert(profile: ReadWeaveApiProviderProfile, code: ReadWeaveApiAlertCode, message: string, health: ReadWeaveApiProviderHealth, severity: ReadWeaveApiAlert["severity"]): void {
    const now = new Date().toISOString();
    const existing = getReadWeaveApiControlSettings().alerts.find(alert => alert.id === `${profile.id}:${code}`);
    const fallbackAvailable = listReadWeaveApiProviders().some(item => item.id !== profile.id && item.kind === profile.kind && item.enabled && item.health.state === "healthy");
    saveReadWeaveApiAlert({
        id: `${profile.id}:${code}`, providerId: profile.id, routeRole: profile.role, model: profile.model,
        code, severity, message, active: true, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now,
        lastSuccessAt: health.lastSuccessAt, fallbackAvailable,
        requiresAction: code === "authentication" || code === "quota-exhausted" || code === "endpoint" || code === "model-missing"
    });
}

export async function runReadWeaveApiHealthChecks(full = false): Promise<ReadWeaveApiControlSettings> {
    if (cycleRunning) return getReadWeaveApiControlSettings();
    cycleRunning = true;
    try {
        const enabled = listReadWeaveApiProviders().filter(provider => provider.enabled);
        for (const provider of enabled) await probeReadWeaveApiProvider(provider.id, full);
        const now = new Date();
        const interval = getReadWeaveApiControlSettings().healthCheckIntervalMinutes;
        setReadWeaveApiMonitorMeta("last-health-cycle-at", now.toISOString());
        setReadWeaveApiMonitorMeta("next-health-cycle-at", new Date(now.getTime() + interval * 60_000).toISOString());
        if (full) lastFullProbeAt = now.getTime();
        return getReadWeaveApiControlSettings();
    } finally {
        cycleRunning = false;
    }
}

export function initializeReadWeaveApiHealthMonitor(): void {
    if (monitorStarted) return;
    monitorStarted = true;
    const tick = async () => {
        try {
            const settings = getReadWeaveApiControlSettings();
            const last = settings.monitor.lastCycleAt ? Date.parse(settings.monitor.lastCycleAt) : 0;
            if (Date.now() - last < settings.healthCheckIntervalMinutes * 60_000) return;
            const full = Date.now() - lastFullProbeAt >= settings.fullProbeIntervalMinutes * 60_000;
            await runReadWeaveApiHealthChecks(full);
        } catch (error) {
            getLog().error(`ReadWeave API health monitor failed: ${safeErrorMessage(error)}`);
        }
    };
    const first = setTimeout(() => void tick(), 5_000);
    first.unref?.();
    monitorTimer = setInterval(() => void tick(), 5 * 60_000);
    monitorTimer.unref?.();
}

export function stopReadWeaveApiHealthMonitorForTests(): void {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = undefined;
    monitorStarted = false;
    cycleRunning = false;
    lastFullProbeAt = 0;
}
