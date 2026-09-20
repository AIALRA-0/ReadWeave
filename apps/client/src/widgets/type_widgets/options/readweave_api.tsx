import "./readweave_api.css";

import type {
    ReadWeaveApiAlert,
    ReadWeaveApiControlSettings,
    ReadWeaveApiControlUpdate,
    ReadWeaveApiProviderProfile,
    ReadWeaveApiProviderUpdate
} from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import Button from "../../react/Button";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsSection from "./components/OptionsSection";

type ProviderDraft = Omit<ReadWeaveApiProviderUpdate, "modelParameters"> & {
    apiKey: string;
    modelParametersText: string;
};

const EMPTY_VALUE = "—";

function toDraft(provider: ReadWeaveApiProviderProfile): ProviderDraft {
    return {
        id: provider.id,
        enabled: provider.enabled,
        role: provider.role,
        priority: provider.priority,
        baseUrl: provider.baseUrl,
        model: provider.model ?? "",
        apiKey: "",
        modelParametersText: JSON.stringify(provider.modelParameters ?? {}, null, 2)
    };
}

function formatDateTime(value?: string): string {
    if (!value) return EMPTY_VALUE;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatPercentage(value?: number): string {
    return value === undefined ? EMPTY_VALUE : `${(value * 100).toFixed(1)}%`;
}

function formatQuota(provider: ReadWeaveApiProviderProfile): string {
    const quota = provider.health.quota;
    if (!quota.supported) return quota.detail || t("readweave_api.quota_unsupported");

    const values = [
        quota.remaining === undefined ? undefined : t("readweave_api.quota_remaining", { value: quota.remaining, unit: quota.unit ?? "" }),
        quota.limit === undefined ? undefined : t("readweave_api.quota_limit", { value: quota.limit, unit: quota.unit ?? "" }),
        quota.resetsAt ? t("readweave_api.quota_resets", { value: formatDateTime(quota.resetsAt) }) : undefined,
        quota.detail
    ].filter(Boolean);
    return values.join(" · ") || t("readweave_api.quota_available");
}

function formatPricing(provider: ReadWeaveApiProviderProfile): string {
    const pricing = provider.pricing;
    if (!pricing) return EMPTY_VALUE;
    const source = t("readweave_api.pricing_source", { source: pricing.source });
    if (pricing.searchPerRequest !== undefined) {
        return `${t("readweave_api.pricing_search", { value: pricing.searchPerRequest, currency: pricing.currency })} · ${source}`;
    }
    if (pricing.cacheHitInputPerMillion !== undefined
        && pricing.cacheMissInputPerMillion !== undefined
        && pricing.outputPerMillion !== undefined) {
        return `${t("readweave_api.pricing_model", {
            currency: pricing.currency,
            cacheHit: pricing.cacheHitInputPerMillion,
            cacheMiss: pricing.cacheMissInputPerMillion,
            output: pricing.outputPerMillion
        })} · ${source}`;
    }
    return source;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return t("readweave_api.unknown_error");
}

function statusLabel(state: ReadWeaveApiProviderProfile["health"]["state"]): string {
    return t(`readweave_api.health_${state}`);
}

function roleLabel(role: ReadWeaveApiProviderProfile["role"]): string {
    return t(`readweave_api.role_${role}`);
}

function authLabel(authType: ReadWeaveApiProviderProfile["authType"]): string {
    return t(`readweave_api.auth_${authType}`);
}

function protocolLabel(protocol: ReadWeaveApiProviderProfile["requestProtocol"]): string {
    return t(`readweave_api.protocol_${protocol}`);
}

export default function ReadWeaveApiSettings() {
    const [settings, setSettings] = useState<ReadWeaveApiControlSettings>();
    const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
    const [healthInterval, setHealthInterval] = useState("15");
    const [fullProbeInterval, setFullProbeInterval] = useState("360");
    const [busyAction, setBusyAction] = useState<string>();
    const [message, setMessage] = useState("");

    const applySettings = useCallback((value: ReadWeaveApiControlSettings) => {
        setSettings(value);
        setDrafts(Object.fromEntries(value.providers.map(provider => [ provider.id, toDraft(provider) ])));
        setHealthInterval(String(value.healthCheckIntervalMinutes));
        setFullProbeInterval(String(value.fullProbeIntervalMinutes));
    }, []);

    const load = useCallback(async () => {
        setBusyAction("load");
        setMessage(t("readweave_api.loading"));
        try {
            applySettings(await server.get<ReadWeaveApiControlSettings>("readweave/api-control"));
            setMessage("");
        } catch (error) {
            setMessage(`${t("readweave_api.load_failed")} ${errorMessage(error)}`);
        } finally {
            setBusyAction(undefined);
        }
    }, [applySettings]);

    useEffect(() => {
        void load();
    }, [load]);

    const updateDraft = useCallback(<K extends keyof ProviderDraft>(providerId: string, key: K, value: ProviderDraft[K]) => {
        setDrafts(current => ({
            ...current,
            [providerId]: { ...current[providerId], [key]: value }
        }));
    }, []);

    const save = useCallback(async () => {
        if (!settings) return;
        setBusyAction("save");
        setMessage(t("readweave_api.saving"));
        try {
            const update: ReadWeaveApiControlUpdate = {
                healthCheckIntervalMinutes: Number(healthInterval),
                fullProbeIntervalMinutes: Number(fullProbeInterval),
                providers: settings.providers.map(provider => {
                    const draft = drafts[provider.id];
                    return {
                        id: provider.id,
                        enabled: draft.enabled,
                        role: draft.role,
                        priority: Number(draft.priority),
                        baseUrl: draft.baseUrl?.trim(),
                        model: draft.model?.trim(),
                        modelParameters: JSON.parse(draft.modelParametersText || "{}") as Record<string, number | string | boolean>,
                        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
                    };
                })
            };
            applySettings(await server.put<ReadWeaveApiControlSettings>("readweave/api-control", update));
            setMessage(t("readweave_api.saved"));
        } catch (error) {
            setMessage(`${t("readweave_api.save_failed")} ${errorMessage(error)}`);
        } finally {
            setBusyAction(undefined);
        }
    }, [applySettings, drafts, fullProbeInterval, healthInterval, settings]);

    const probeProvider = useCallback(async (providerId: string) => {
        setBusyAction(`probe:${providerId}`);
        setMessage(t("readweave_api.probing_provider"));
        try {
            await server.post(`readweave/api-control/providers/${providerId}/probe`, { full: true });
            applySettings(await server.get<ReadWeaveApiControlSettings>("readweave/api-control"));
            setMessage(t("readweave_api.probe_completed"));
        } catch (error) {
            setMessage(`${t("readweave_api.probe_failed")} ${errorMessage(error)}`);
        } finally {
            setBusyAction(undefined);
        }
    }, [applySettings]);

    const probeAll = useCallback(async () => {
        setBusyAction("probe-all");
        setMessage(t("readweave_api.probing_all"));
        try {
            applySettings(await server.post<ReadWeaveApiControlSettings>("readweave/api-control/probe-all", { full: true }));
            setMessage(t("readweave_api.probe_all_completed"));
        } catch (error) {
            setMessage(`${t("readweave_api.probe_failed")} ${errorMessage(error)}`);
        } finally {
            setBusyAction(undefined);
        }
    }, [applySettings]);

    const activeAlerts = useMemo(() => settings?.alerts.filter(alert => alert.active) ?? [], [settings]);
    const busy = busyAction !== undefined;

    return (
        <>
            <OptionsPageHeader
                actions={
                    <div className="readweave-api-header-actions">
                        <Button text={t("readweave_api.save")} icon="bx-save" kind="primary" disabled={busy || !settings} onClick={() => void save()} />
                        <Button text={t("readweave_api.probe_all")} icon="bx-pulse" disabled={busy || !settings} onClick={() => void probeAll()} />
                    </div>
                }
            />

            <OptionsSection
                title={t("readweave_api.overview_title")}
                description={t("readweave_api.overview_description")}
                className="readweave-api-overview"
            >
                <div className="readweave-api-monitor-grid">
                    <label>
                        <span>{t("readweave_api.health_interval")}</span>
                        <input className="form-control" type="number" min="5" max="1440" value={healthInterval}
                            onInput={event => setHealthInterval(event.currentTarget.value)} disabled={busy} />
                    </label>
                    <label>
                        <span>{t("readweave_api.full_probe_interval")}</span>
                        <input className="form-control" type="number" min="30" max="10080" value={fullProbeInterval}
                            onInput={event => setFullProbeInterval(event.currentTarget.value)} disabled={busy} />
                    </label>
                    <StatusValue label={t("readweave_api.monitor_state")} value={settings?.monitor.running ? t("readweave_api.monitor_running") : t("readweave_api.monitor_stopped")} />
                    <StatusValue label={t("readweave_api.last_cycle")} value={formatDateTime(settings?.monitor.lastCycleAt)} />
                    <StatusValue label={t("readweave_api.next_cycle")} value={formatDateTime(settings?.monitor.nextCycleAt)} />
                </div>
                {message && <p className="readweave-api-message" role="status">{message}</p>}
            </OptionsSection>

            <OptionsSection title={t("readweave_api.providers_title")} description={t("readweave_api.providers_description")}>
                {settings ? (
                    <div className="readweave-api-provider-list">
                        {settings.providers.map(provider => (
                            <ProviderCard
                                key={provider.id}
                                provider={provider}
                                draft={drafts[provider.id] ?? toDraft(provider)}
                                alerts={activeAlerts.filter(alert => alert.providerId === provider.id)}
                                busy={busy}
                                probing={busyAction === `probe:${provider.id}`}
                                onChange={updateDraft}
                                onProbe={probeProvider}
                            />
                        ))}
                    </div>
                ) : <p>{t("readweave_api.loading")}</p>}
            </OptionsSection>

            <OptionsSection title={t("readweave_api.alerts_title")} description={t("readweave_api.alerts_description")}>
                {activeAlerts.length ? (
                    <div className="readweave-api-alert-list">
                        {activeAlerts.map(alert => <AlertCard key={alert.id} alert={alert} />)}
                    </div>
                ) : <p className="readweave-api-empty">{t("readweave_api.no_active_alerts")}</p>}
            </OptionsSection>
        </>
    );
}

function ProviderCard({ provider, draft, alerts, busy, probing, onChange, onProbe }: {
    provider: ReadWeaveApiProviderProfile;
    draft: ProviderDraft;
    alerts: ReadWeaveApiAlert[];
    busy: boolean;
    probing: boolean;
    onChange: <K extends keyof ProviderDraft>(providerId: string, key: K, value: ProviderDraft[K]) => void;
    onProbe: (providerId: string) => Promise<void>;
}) {
    return (
        <article className={`readweave-api-provider readweave-api-state-${provider.health.state}`} data-testid={`readweave-api-provider-${provider.id}`}>
            <header className="readweave-api-provider-header">
                <div>
                    <h5>{provider.name}</h5>
                    <div className="readweave-api-badges">
                        <span>{provider.kind === "model" ? t("readweave_api.kind_model") : t("readweave_api.kind_search")}</span>
                        <span>{roleLabel(draft.role ?? provider.role)}</span>
                        <span className={`readweave-api-health readweave-api-health-${provider.health.state}`}>{statusLabel(provider.health.state)}</span>
                    </div>
                </div>
                <Button
                    text={probing ? t("readweave_api.probing") : t("readweave_api.probe_provider")}
                    icon="bx-pulse"
                    size="small"
                    disabled={busy}
                    onClick={() => void onProbe(provider.id)}
                />
            </header>

            <div className="readweave-api-fields">
                <label className="readweave-api-checkbox-field">
                    <input type="checkbox" checked={draft.enabled === true} disabled={busy}
                        onInput={event => onChange(provider.id, "enabled", event.currentTarget.checked)} />
                    <span>{t("readweave_api.enabled")}</span>
                </label>
                <label>
                    <span>{t("readweave_api.role")}</span>
                    <select className="form-select" value={draft.role} disabled={busy}
                        onChange={event => onChange(provider.id, "role", event.currentTarget.value as ProviderDraft["role"])}>
                        <option value="primary">{t("readweave_api.role_primary")}</option>
                        <option value="fallback">{t("readweave_api.role_fallback")}</option>
                        <option value="supplemental">{t("readweave_api.role_supplemental")}</option>
                    </select>
                </label>
                <label>
                    <span>{t("readweave_api.priority")}</span>
                    <input className="form-control" type="number" min="0" max="10000" value={draft.priority}
                        disabled={busy} onInput={event => onChange(provider.id, "priority", Number(event.currentTarget.value))} />
                </label>
                <label className="readweave-api-wide-field">
                    <span>{t("readweave_api.base_url")}</span>
                    <input className="form-control" type="url" value={draft.baseUrl} disabled={busy}
                        onInput={event => onChange(provider.id, "baseUrl", event.currentTarget.value)} />
                </label>
                <ReadOnlyField label={t("readweave_api.endpoint")} value={provider.endpoint} />
                <label>
                    <span>{t("readweave_api.model")}</span>
                    <input className="form-control" type="text" value={draft.model} disabled={busy || provider.kind !== "model"}
                        placeholder={provider.kind === "model" ? t("readweave_api.model_placeholder") : t("readweave_api.not_applicable")}
                        onInput={event => onChange(provider.id, "model", event.currentTarget.value)} />
                </label>
                <label className="readweave-api-wide-field">
                    <span>{t("readweave_api.api_key")}</span>
                    <input className="form-control" type="password" value={draft.apiKey} disabled={busy}
                        autocomplete="new-password" placeholder={provider.maskedApiKey || t("readweave_api.api_key_placeholder")}
                        onInput={event => onChange(provider.id, "apiKey", event.currentTarget.value)} />
                    <small>{provider.hasApiKey
                        ? t("readweave_api.api_key_configured", { source: provider.credentialSource })
                        : t("readweave_api.api_key_missing")}</small>
                </label>
                <ReadOnlyField label={t("readweave_api.authentication")} value={authLabel(provider.authType)} />
                <ReadOnlyField label={t("readweave_api.request_protocol")} value={protocolLabel(provider.requestProtocol)} />
                <label className="readweave-api-wide-field">
                    <span>{t("readweave_api.model_parameters")}</span>
                    <textarea className="form-control" rows={3} value={draft.modelParametersText} disabled={busy}
                        placeholder={t("readweave_api.model_parameters_placeholder")}
                        onInput={event => onChange(provider.id, "modelParametersText", event.currentTarget.value)} />
                </label>
            </div>

            <div className="readweave-api-status-grid">
                <StatusValue label={t("readweave_api.detection_state")} value={statusLabel(provider.health.state)} />
                <StatusValue label={t("readweave_api.latency")} value={provider.health.latencyMs === undefined ? EMPTY_VALUE : `${provider.health.latencyMs} ms`} />
                <StatusValue label={t("readweave_api.success_rate")} value={formatPercentage(provider.health.successRate)} />
                <StatusValue label={t("readweave_api.consecutive_failures")} value={String(provider.health.consecutiveFailures)} />
                <StatusValue label={t("readweave_api.last_success")} value={formatDateTime(provider.health.lastSuccessAt)} />
                <StatusValue label={t("readweave_api.last_failure")} value={formatDateTime(provider.health.lastFailureAt)} />
                <StatusValue label={t("readweave_api.quota_state")} value={formatQuota(provider)} wide />
                <StatusValue label={t("readweave_api.pricing_state")} value={formatPricing(provider)} wide />
                <StatusValue label={t("readweave_api.available_models")}
                    value={(provider.health.detectedModels?.length ? provider.health.detectedModels : provider.configuredModels).join(", ") || EMPTY_VALUE} wide />
                <StatusValue label={t("readweave_api.last_error")} value={provider.health.lastError || EMPTY_VALUE} wide />
            </div>

            {alerts.length > 0 && (
                <div className="readweave-api-provider-alerts">
                    <strong>{t("readweave_api.active_alerts", { count: alerts.length })}</strong>
                    {alerts.map(alert => <AlertCard key={alert.id} alert={alert} compact />)}
                </div>
            )}
        </article>
    );
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
    return (
        <label>
            <span>{label}</span>
            <output className="readweave-api-readonly">{value || EMPTY_VALUE}</output>
        </label>
    );
}

function StatusValue({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={`readweave-api-status-value ${wide ? "readweave-api-status-wide" : ""}`}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function AlertCard({ alert, compact }: { alert: ReadWeaveApiAlert; compact?: boolean }) {
    return (
        <div className={`readweave-api-alert readweave-api-alert-${alert.severity} ${compact ? "readweave-api-alert-compact" : ""}`}>
            <div>
                <strong>{alert.message}</strong>
                <small>{t("readweave_api.alert_details", {
                    provider: alert.providerId,
                    code: alert.code,
                    time: formatDateTime(alert.lastSeenAt)
                })}</small>
            </div>
            <div className="readweave-api-alert-flags">
                <span>{alert.fallbackAvailable ? t("readweave_api.fallback_available") : t("readweave_api.fallback_unavailable")}</span>
                {alert.requiresAction && <span>{t("readweave_api.action_required")}</span>}
            </div>
        </div>
    );
}

export { formatDateTime, formatPercentage, formatQuota, toDraft };
