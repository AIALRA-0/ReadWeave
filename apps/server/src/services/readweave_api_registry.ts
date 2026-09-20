import type {
    ReadWeaveApiAlert,
    ReadWeaveApiControlSettings,
    ReadWeaveApiControlUpdate,
    ReadWeaveApiProviderHealth,
    ReadWeaveApiProviderId,
    ReadWeaveApiProviderProfile,
    ReadWeaveApiProviderUpdate
} from "@triliumnext/commons";
import { options as optionService, ValidationError } from "@triliumnext/core";

import sql from "./sql.js";

interface ProviderDefinition {
    id: ReadWeaveApiProviderId;
    name: string;
    kind: "model" | "search";
    baseUrl: string;
    endpoint: string;
    authType: "bearer" | "x-api-key" | "query";
    requestProtocol: "responses" | "rest-search";
    enabled: boolean;
    role: "primary" | "fallback" | "supplemental";
    priority: number;
    model?: string;
    configuredModels: string[];
    modelParameters?: Record<string, number | string | boolean>;
    pricing?: ReadWeaveApiProviderProfile["pricing"];
}

interface ProviderRow {
    providerId: ReadWeaveApiProviderId;
    displayName: string;
    kind: ReadWeaveApiProviderProfile["kind"];
    enabled: number;
    routeRole: ReadWeaveApiProviderProfile["role"];
    priority: number;
    baseUrl: string;
    endpoint: string;
    authType: ReadWeaveApiProviderProfile["authType"];
    requestProtocol: ReadWeaveApiProviderProfile["requestProtocol"];
    apiKey: string | null;
    credentialSource: ReadWeaveApiProviderProfile["credentialSource"];
    model: string | null;
    configuredModelsJson: string;
    modelParametersJson: string;
    pricingJson: string;
    healthJson: string;
    createdAt: string;
    updatedAt: string;
}

interface AlertRow {
    alertId: string;
    providerId: ReadWeaveApiProviderId;
    routeRole: ReadWeaveApiAlert["routeRole"];
    model: string | null;
    code: ReadWeaveApiAlert["code"];
    severity: ReadWeaveApiAlert["severity"];
    message: string;
    active: number;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    lastSuccessAt: string | null;
    fallbackAvailable: number;
    requiresAction: number;
}

const DEFAULT_HEALTH: ReadWeaveApiProviderHealth = {
    state: "unknown",
    consecutiveFailures: 0,
    quota: { supported: false, detail: "平台未向普通 API 密钥开放可读取的余额接口" }
};

const DEFINITIONS: readonly ProviderDefinition[] = [
    {
        id: "kuafu", name: "夸父社 V4.1 专线", kind: "model",
        baseUrl: "https://api.kuafushe.cc/v1", endpoint: "/responses", authType: "bearer",
        requestProtocol: "responses", enabled: false, role: "primary", priority: 10,
        model: "deepseek-v4.1-flash",
        configuredModels: [ "deepseek-v4.1-flash", "deepseek-v4.1-flash-expires-on-0910" ],
        modelParameters: { temperature: 0.2 },
        pricing: {
            // The key is currently billed at USD 0.0075 / 0.225 / 0.675.
            // Store the 7.2 CNY/USD budget equivalents used by ReadWeave so
            // reservation and provider billing remain comparable.
            currency: "CNY", cacheHitInputPerMillion: 0.054,
            cacheMissInputPerMillion: 1.62, outputPerMillion: 4.86,
            source: "verified-dashboard"
        }
    },
    {
        id: "deepseek-official", name: "DeepSeek 官方", kind: "model",
        baseUrl: "https://api.deepseek.com", endpoint: "/responses", authType: "bearer",
        requestProtocol: "responses", enabled: false, role: "fallback", priority: 20,
        model: "deepseek-flash", configuredModels: [ "deepseek-flash", "deepseek-v4.1-flash" ],
        modelParameters: { temperature: 0.2 },
        pricing: { currency: "CNY", cacheHitInputPerMillion: 0.02, cacheMissInputPerMillion: 1, outputPerMillion: 4, source: "official" }
    },
    {
        id: "tinyfish", name: "TinyFish Search", kind: "search",
        baseUrl: "https://api.search.tinyfish.ai", endpoint: "/", authType: "x-api-key",
        requestProtocol: "rest-search", enabled: false, role: "primary", priority: 10,
        configuredModels: [], modelParameters: { language: "en" },
        pricing: { currency: "USD", searchPerRequest: 0, source: "official" }
    },
    {
        id: "octen", name: "Octen Search", kind: "search",
        baseUrl: "https://api.octen.ai", endpoint: "/search", authType: "x-api-key",
        requestProtocol: "rest-search", enabled: false, role: "fallback", priority: 20,
        configuredModels: [], modelParameters: { count: 8 },
        pricing: { currency: "USD", searchPerRequest: 0.001, source: "official" }
    },
    {
        id: "openalex", name: "OpenAlex", kind: "search",
        baseUrl: "https://api.openalex.org", endpoint: "/works", authType: "query",
        requestProtocol: "rest-search", enabled: false, role: "supplemental", priority: 5,
        configuredModels: [], modelParameters: { perPage: 10 },
        pricing: { currency: "USD", searchPerRequest: 0.001, source: "verified-api" }
    },
    {
        id: "parallel", name: "Parallel Search", kind: "search",
        baseUrl: "https://api.parallel.ai", endpoint: "/v1/search", authType: "x-api-key",
        requestProtocol: "rest-search", enabled: false, role: "fallback", priority: 30,
        configuredModels: [], modelParameters: { mode: "turbo", maxResults: 8 },
        pricing: { currency: "USD", searchPerRequest: 0.001, source: "official" }
    }
] as const;

let storageReady = false;

function parseJson<T>(value: string, fallback: T): T {
    try { return JSON.parse(value) as T; } catch { return fallback; }
}

function maskSecret(value: string): string {
    return value.length <= 8 ? "••••••••" : `${value.slice(0, 3)}••••••••${value.slice(-4)}`;
}

function normalizeUrl(value: string): string {
    if (value.length > 2_048) throw new ValidationError("API 服务地址过长");
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new ValidationError("API 服务地址无效"); }
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password) throw new ValidationError("API 服务地址必须使用 HTTP 或 HTTPS，且不能包含凭据");
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/u, "");
}

function ensureStorage(): void {
    if (storageReady) return;
    sql.executeScript(/* sql */`
        CREATE TABLE IF NOT EXISTS readweave_api_providers (
            providerId TEXT PRIMARY KEY,
            displayName TEXT NOT NULL,
            kind TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            routeRole TEXT NOT NULL,
            priority INTEGER NOT NULL,
            baseUrl TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            authType TEXT NOT NULL,
            requestProtocol TEXT NOT NULL,
            apiKey TEXT,
            credentialSource TEXT NOT NULL DEFAULT 'missing',
            model TEXT,
            configuredModelsJson TEXT NOT NULL DEFAULT '[]',
            modelParametersJson TEXT NOT NULL DEFAULT '{}',
            pricingJson TEXT NOT NULL DEFAULT '{}',
            healthJson TEXT NOT NULL DEFAULT '{}',
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS readweave_api_health_checks (
            checkId INTEGER PRIMARY KEY AUTOINCREMENT,
            providerId TEXT NOT NULL,
            state TEXT NOT NULL,
            latencyMs INTEGER,
            statusCode INTEGER,
            errorCode TEXT,
            errorMessage TEXT,
            quotaJson TEXT NOT NULL DEFAULT '{}',
            checkedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS readweave_api_health_provider
            ON readweave_api_health_checks(providerId, checkedAt DESC);
        CREATE TABLE IF NOT EXISTS readweave_api_alerts (
            alertId TEXT PRIMARY KEY,
            providerId TEXT NOT NULL,
            routeRole TEXT NOT NULL,
            model TEXT,
            code TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            firstSeenAt TEXT NOT NULL,
            lastSeenAt TEXT NOT NULL,
            resolvedAt TEXT,
            lastSuccessAt TEXT,
            fallbackAvailable INTEGER NOT NULL DEFAULT 0,
            requiresAction INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS readweave_api_alerts_active
            ON readweave_api_alerts(active, lastSeenAt DESC);
        CREATE TABLE IF NOT EXISTS readweave_api_meta (
            name TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
    const now = new Date().toISOString();
    sql.transactional(() => {
        for (const definition of DEFINITIONS) {
            sql.execute(/* sql */`
                INSERT OR IGNORE INTO readweave_api_providers
                    (providerId, displayName, kind, enabled, routeRole, priority, baseUrl, endpoint,
                     authType, requestProtocol, apiKey, credentialSource, model, configuredModelsJson,
                     modelParametersJson, pricingJson, healthJson, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'missing', ?, ?, ?, ?, ?, ?, ?)
            `, [
                definition.id, definition.name, definition.kind, definition.enabled ? 1 : 0,
                definition.role, definition.priority, definition.baseUrl, definition.endpoint,
                definition.authType, definition.requestProtocol, definition.model ?? null,
                JSON.stringify(definition.configuredModels), JSON.stringify(definition.modelParameters ?? {}),
                JSON.stringify(definition.pricing ?? {}), JSON.stringify(DEFAULT_HEALTH), now, now
            ]);
        }
    });
    storageReady = true;
}

function migrateLegacySettings(): void {
    ensureStorage();
    if (sql.getValue<string | null>("SELECT value FROM readweave_api_meta WHERE name = 'legacy-migration-v1'")) return;
    const baseUrl = optionService.getOptionOrNull("readWeaveBaseUrl")?.trim();
    const apiKey = optionService.getOptionOrNull("readWeaveApiKey")?.trim();
    const model = optionService.getOptionOrNull("readWeaveModel")?.trim();
    const legacySearch: Array<[ReadWeaveApiProviderId, string]> = [
        [ "openalex", optionService.getOptionOrNull("readWeaveOpenAlexApiKey")?.trim() ?? "" ]
    ];
    sql.transactional(() => {
        if (baseUrl && apiKey && model && /(deepseek\.com|kuafushe\.cc)/iu.test(baseUrl)) {
            const providerId: ReadWeaveApiProviderId = /deepseek\.com/iu.test(baseUrl) ? "deepseek-official" : "kuafu";
            sql.execute("UPDATE readweave_api_providers SET baseUrl = ?, apiKey = ?, credentialSource = 'legacy', model = ?, enabled = 1, updatedAt = ? WHERE providerId = ?", [
                normalizeUrl(baseUrl), apiKey, model, new Date().toISOString(), providerId
            ]);
        }
        for (const [ providerId, key ] of legacySearch) {
            if (key) sql.execute("UPDATE readweave_api_providers SET apiKey = ?, credentialSource = 'legacy', enabled = 1, updatedAt = ? WHERE providerId = ?", [ key, new Date().toISOString(), providerId ]);
        }
        sql.execute("INSERT OR REPLACE INTO readweave_api_meta (name, value) VALUES ('legacy-migration-v1', ?)", [ new Date().toISOString() ]);
    });
}

function rowToProfile(row: ProviderRow): ReadWeaveApiProviderProfile {
    const storedHealth = parseJson<Partial<ReadWeaveApiProviderHealth>>(row.healthJson, {});
    const health: ReadWeaveApiProviderHealth = {
        ...DEFAULT_HEALTH,
        ...storedHealth,
        quota: { ...DEFAULT_HEALTH.quota, ...storedHealth.quota }
    };
    return {
        id: row.providerId, name: row.displayName, kind: row.kind, enabled: !!row.enabled,
        role: row.routeRole, priority: row.priority, baseUrl: row.baseUrl, endpoint: row.endpoint,
        authType: row.authType, requestProtocol: row.requestProtocol, model: row.model ?? undefined,
        configuredModels: parseJson<string[]>(row.configuredModelsJson, []),
        hasApiKey: !!row.apiKey, maskedApiKey: row.apiKey ? maskSecret(row.apiKey) : undefined,
        credentialSource: row.apiKey ? row.credentialSource : "missing",
        modelParameters: parseJson(row.modelParametersJson, {}),
        pricing: parseJson(row.pricingJson, undefined),
        health: row.enabled ? health : { ...health, state: "disabled" }
    };
}

function rowToAlert(row: AlertRow): ReadWeaveApiAlert {
    return {
        id: row.alertId, providerId: row.providerId, routeRole: row.routeRole,
        model: row.model ?? undefined, code: row.code, severity: row.severity, message: row.message,
        active: !!row.active, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt,
        resolvedAt: row.resolvedAt ?? undefined, lastSuccessAt: row.lastSuccessAt ?? undefined,
        fallbackAvailable: !!row.fallbackAvailable, requiresAction: !!row.requiresAction
    };
}

export function initializeReadWeaveApiRegistry(migrateLegacy = false): void {
    ensureStorage();
    if (migrateLegacy) migrateLegacySettings();
}

export function listReadWeaveApiProviderRows(): ProviderRow[] {
    ensureStorage();
    return sql.getRows<ProviderRow>("SELECT * FROM readweave_api_providers ORDER BY kind, priority, displayName");
}

export function listReadWeaveApiProviders(): ReadWeaveApiProviderProfile[] {
    return listReadWeaveApiProviderRows().map(rowToProfile);
}

export function listReadWeaveApiAlerts(): ReadWeaveApiAlert[] {
    ensureStorage();
    return sql.getRows<AlertRow>("SELECT * FROM readweave_api_alerts ORDER BY active DESC, lastSeenAt DESC").map(rowToAlert);
}

export function getReadWeaveApiControlSettings(): ReadWeaveApiControlSettings {
    ensureStorage();
    const interval = Number(sql.getValue<string | null>("SELECT value FROM readweave_api_meta WHERE name = 'health-interval-minutes'") ?? 15);
    const fullInterval = Number(sql.getValue<string | null>("SELECT value FROM readweave_api_meta WHERE name = 'full-probe-interval-minutes'") ?? 360);
    const lastCycleAt = sql.getValue<string | null>("SELECT value FROM readweave_api_meta WHERE name = 'last-health-cycle-at'") ?? undefined;
    const nextCycleAt = sql.getValue<string | null>("SELECT value FROM readweave_api_meta WHERE name = 'next-health-cycle-at'") ?? undefined;
    return {
        version: 1,
        healthCheckIntervalMinutes: Number.isFinite(interval) ? interval : 15,
        fullProbeIntervalMinutes: Number.isFinite(fullInterval) ? fullInterval : 360,
        providers: listReadWeaveApiProviders(), alerts: listReadWeaveApiAlerts(),
        monitor: { running: true, lastCycleAt, nextCycleAt }
    };
}

function applyProviderUpdate(update: ReadWeaveApiProviderUpdate): void {
    const row = sql.getRow<ProviderRow>("SELECT * FROM readweave_api_providers WHERE providerId = ?", [ update.id ]);
    if (!row) throw new ValidationError(`未知的 API 平台：${update.id}`);
    const enabled = update.enabled ?? !!row.enabled;
    const role = update.role ?? row.routeRole;
    const priority = update.priority ?? row.priority;
    if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) throw new ValidationError("线路优先级必须是 0 至 10000 的整数");
    const baseUrl = update.baseUrl === undefined ? row.baseUrl : normalizeUrl(update.baseUrl);
    const model = update.model === undefined ? row.model : update.model.trim();
    if (row.kind === "model" && enabled && !model) throw new ValidationError(`${row.displayName} 缺少模型名称`);
    let apiKey = row.apiKey;
    let credentialSource = row.credentialSource;
    if (update.clearApiKey) { apiKey = null; credentialSource = "missing"; }
    if (update.apiKey !== undefined) {
        const value = update.apiKey.trim();
        if (!value || value.length > 4_096) throw new ValidationError(`${row.displayName} 的 API Key 无效`);
        apiKey = value;
        credentialSource = "api-control";
    }
    const parameters = update.modelParameters === undefined
        ? row.modelParametersJson : JSON.stringify(validateModelParameters(update.modelParameters));
    sql.execute(/* sql */`
        UPDATE readweave_api_providers
        SET enabled = ?, routeRole = ?, priority = ?, baseUrl = ?, apiKey = ?, credentialSource = ?,
            model = ?, modelParametersJson = ?, updatedAt = ?
        WHERE providerId = ?
    `, [ enabled ? 1 : 0, role, priority, baseUrl, apiKey, credentialSource, model, parameters, new Date().toISOString(), update.id ]);
}

function validateModelParameters(value: Record<string, number | string | boolean>): Record<string, number | string | boolean> {
    if (!value || Array.isArray(value) || typeof value !== "object") throw new ValidationError("调用参数必须是 JSON 对象");
    const entries = Object.entries(value);
    if (entries.length > 50) throw new ValidationError("调用参数数量过多");
    for (const [ key, item ] of entries) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)
            || ![ "string", "number", "boolean" ].includes(typeof item)
            || typeof item === "number" && !Number.isFinite(item)) {
            throw new ValidationError(`调用参数 ${key || "（空名称）"} 无效`);
        }
    }
    return value;
}

export function updateReadWeaveApiControlSettings(update: ReadWeaveApiControlUpdate): ReadWeaveApiControlSettings {
    ensureStorage();
    const validateInterval = (value: number | undefined, label: string, min: number, max: number) => {
        if (value === undefined) return;
        if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${label}必须是 ${min} 至 ${max} 分钟`);
    };
    validateInterval(update.healthCheckIntervalMinutes, "轻量检测周期", 5, 1_440);
    validateInterval(update.fullProbeIntervalMinutes, "完整检测周期", 30, 10_080);
    sql.transactional(() => {
        for (const provider of update.providers ?? []) applyProviderUpdate(provider);
        if (update.healthCheckIntervalMinutes !== undefined) sql.execute("INSERT OR REPLACE INTO readweave_api_meta (name, value) VALUES ('health-interval-minutes', ?)", [ String(update.healthCheckIntervalMinutes) ]);
        if (update.fullProbeIntervalMinutes !== undefined) sql.execute("INSERT OR REPLACE INTO readweave_api_meta (name, value) VALUES ('full-probe-interval-minutes', ?)", [ String(update.fullProbeIntervalMinutes) ]);
    });
    return getReadWeaveApiControlSettings();
}

export function getReadWeaveApiProviderSecret(id: ReadWeaveApiProviderId): string | undefined {
    ensureStorage();
    return sql.getValue<string | null>("SELECT apiKey FROM readweave_api_providers WHERE providerId = ?", [ id ]) ?? undefined;
}

export function getReadWeavePrimaryModelRoute(): (ReadWeaveApiProviderProfile & { apiKey: string }) | undefined {
    return getReadWeaveModelRoutes()[0];
}

export function getReadWeaveModelRoutes(): Array<ReadWeaveApiProviderProfile & { apiKey: string }> {
    const roleRank = { primary: 0, fallback: 1, supplemental: 2 } as const;
    // A migrated legacy credential remains a compatibility copy until the
    // user explicitly saves it in the independent API control plane. This
    // prevents the new registry from silently changing an existing route.
    return listReadWeaveApiProviderRows()
        .filter(row => row.kind === "model" && !!row.enabled && !!row.apiKey && row.credentialSource === "api-control")
        .map(row => ({ ...rowToProfile(row), apiKey: row.apiKey! }))
        .sort((a, b) => Number(a.health.state === "unavailable") - Number(b.health.state === "unavailable")
            || roleRank[a.role] - roleRank[b.role] || a.priority - b.priority);
}

export function getReadWeaveSearchProviderSecrets(): Partial<Record<ReadWeaveApiProviderId, string>> {
    return Object.fromEntries(listReadWeaveApiProviderRows()
        .filter(row => row.kind === "search" && !!row.enabled && !!row.apiKey)
        .map(row => [ row.providerId, row.apiKey! ]));
}

export function getReadWeaveSearchProviderRoutes(): Partial<Record<ReadWeaveApiProviderId, {
    apiKey: string;
    baseUrl: string;
    endpoint: string;
    modelParameters: Record<string, number | string | boolean>;
}>> {
    return Object.fromEntries(listReadWeaveApiProviderRows()
        .filter(row => row.kind === "search" && !!row.enabled && !!row.apiKey)
        .map(row => [ row.providerId, {
            apiKey: row.apiKey!, baseUrl: row.baseUrl, endpoint: row.endpoint,
            modelParameters: parseJson(row.modelParametersJson, {})
        } ]));
}

export function saveReadWeaveApiHealth(providerId: ReadWeaveApiProviderId, health: ReadWeaveApiProviderHealth, statusCode?: number): void {
    ensureStorage();
    sql.transactional(() => {
        sql.execute("UPDATE readweave_api_providers SET healthJson = ?, updatedAt = ? WHERE providerId = ?", [ JSON.stringify(health), new Date().toISOString(), providerId ]);
        sql.execute(/* sql */`
            INSERT INTO readweave_api_health_checks
                (providerId, state, latencyMs, statusCode, errorCode, errorMessage, quotaJson, checkedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [ providerId, health.state, health.latencyMs ?? null, statusCode ?? null, health.lastErrorCode ?? null, health.lastError ?? null, JSON.stringify(health.quota), health.checkedAt ?? new Date().toISOString() ]);
    });
}

export function saveReadWeaveApiAlert(alert: ReadWeaveApiAlert): void {
    ensureStorage();
    sql.execute(/* sql */`
        INSERT OR REPLACE INTO readweave_api_alerts
            (alertId, providerId, routeRole, model, code, severity, message, active, firstSeenAt,
             lastSeenAt, resolvedAt, lastSuccessAt, fallbackAvailable, requiresAction)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [ alert.id, alert.providerId, alert.routeRole, alert.model ?? null, alert.code, alert.severity,
        alert.message, alert.active ? 1 : 0, alert.firstSeenAt, alert.lastSeenAt, alert.resolvedAt ?? null,
        alert.lastSuccessAt ?? null, alert.fallbackAvailable ? 1 : 0, alert.requiresAction ? 1 : 0 ]);
}

export function resolveReadWeaveApiAlerts(providerId: ReadWeaveApiProviderId, lastSuccessAt: string): void {
    ensureStorage();
    sql.execute("UPDATE readweave_api_alerts SET active = 0, resolvedAt = ?, lastSuccessAt = ? WHERE providerId = ? AND active = 1", [ lastSuccessAt, lastSuccessAt, providerId ]);
}

export function setReadWeaveApiMonitorMeta(name: "last-health-cycle-at" | "next-health-cycle-at", value: string): void {
    ensureStorage();
    sql.execute("INSERT OR REPLACE INTO readweave_api_meta (name, value) VALUES (?, ?)", [ name, value ]);
}

export function resetReadWeaveApiRegistryForTests(): void {
    storageReady = false;
}
