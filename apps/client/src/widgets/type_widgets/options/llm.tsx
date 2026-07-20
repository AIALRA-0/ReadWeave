import type { ReadWeaveAiSettings, ReadWeaveModelInfo } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { isExperimentalFeatureEnabled } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import AddProviderModal, { type LlmProviderConfig, PROVIDER_TYPES } from "./llm/AddProviderModal";

export default function LlmSettings() {
    if (!isExperimentalFeatureEnabled("llm")) {
        return (
            <>
                <ReadWeaveSettings />
                <OptionsSection title={t("llm.settings_title")}>
                    <p className="form-text">{t("llm.feature_not_enabled")}</p>
                </OptionsSection>
            </>
        );
    }

    return (
        <>
            <ReadWeaveSettings />
            <ProviderSettings />
            <McpSettings />
        </>
    );
}

function ReadWeaveSettings() {
    const [settings, setSettings] = useState<ReadWeaveAiSettings>();
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [models, setModels] = useState<ReadWeaveModelInfo[]>([]);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const selectableModels = useMemo(() => Array.from(new Set([
        model,
        ...models.map(item => item.id),
        "deepseek-chat",
        "deepseek-reasoner"
    ].filter(Boolean))), [model, models]);

    useEffect(() => {
        server.get<ReadWeaveAiSettings>("readweave/settings").then(value => {
            setSettings(value);
            setBaseUrl(value.baseUrl);
            setModel(value.model);
        });
    }, []);

    async function saveSettings(clearApiKey = false) {
        setBusy(true);
        setStatus(t("readweave_settings.saving"));
        try {
            const value = await server.put<ReadWeaveAiSettings>("readweave/settings", {
                baseUrl,
                model,
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                clearApiKey
            });
            setSettings(value);
            setBaseUrl(value.baseUrl);
            setModel(value.model);
            setApiKey("");
            setModels([]);
            setStatus(t("readweave_settings.saved"));
        } catch {
            setStatus(t("readweave_settings.save_failed"));
        } finally {
            setBusy(false);
        }
    }

    async function loadModels() {
        setBusy(true);
        setStatus(t("readweave_settings.testing"));
        try {
            if (apiKey.trim() || baseUrl !== settings?.baseUrl || model !== settings?.model) {
                await saveSettings(false);
            }
            const value = await server.get<{ models: ReadWeaveModelInfo[] }>("readweave/settings/models");
            setModels(value.models);
            if (!value.models.some(item => item.id === model) && value.models[0]) setModel(value.models[0].id);
            setStatus(t("readweave_settings.test_succeeded", { count: value.models.length }));
        } catch {
            setStatus(t("readweave_settings.test_failed"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <OptionsSection title={t("readweave_settings.title")} description={t("readweave_settings.description")}>
            <OptionsRow name="readweave-base-url" label={t("readweave_settings.base_url")} description={t("readweave_settings.base_url_description")} stacked>
                <input
                    type="url"
                    className="form-control"
                    value={baseUrl}
                    onInput={event => setBaseUrl(event.currentTarget.value)}
                    data-testid="readweave-base-url"
                />
            </OptionsRow>
            <OptionsRow name="readweave-api-key" label={t("readweave_settings.api_key")} description={settings?.hasApiKey
                ? t("readweave_settings.key_configured", { masked: settings.maskedApiKey ?? "••••••••" })
                : t("readweave_settings.key_missing")} stacked>
                <input
                    type="password"
                    className="form-control"
                    value={apiKey}
                    autocomplete="new-password"
                    placeholder={settings?.hasApiKey ? t("readweave_settings.key_keep_placeholder") : t("readweave_settings.key_placeholder")}
                    onInput={event => setApiKey(event.currentTarget.value)}
                    data-testid="readweave-api-key"
                />
            </OptionsRow>
            <OptionsRow name="readweave-model" label={t("readweave_settings.model")} description={t("readweave_settings.model_description")} stacked>
                <select
                    className="form-select"
                    value={model}
                    onChange={event => setModel(event.currentTarget.value)}
                    data-testid="readweave-model"
                >
                    {selectableModels.map(modelId => <option value={modelId} key={modelId}>{modelId}</option>)}
                </select>
            </OptionsRow>
            <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={busy || !baseUrl.trim() || !model.trim()} onClick={() => saveSettings(false)} data-testid="readweave-settings-save">
                    {t("common.save")}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy || (!settings?.hasApiKey && !apiKey.trim())} onClick={loadModels} data-testid="readweave-settings-test">
                    {t("readweave_settings.test_and_models")}
                </button>
                <button type="button" className="btn btn-outline-danger" disabled={busy || settings?.credentialSource !== "settings"} onClick={() => saveSettings(true)}>
                    {t("readweave_settings.clear_key")}
                </button>
            </div>
            {status && <p className="form-text mb-0" role="status">{status}</p>}
            <p className="form-text mb-0">{t("readweave_settings.security_note")}</p>
        </OptionsSection>
    );
}

function ProviderSettings() {
    const [providersJson, setProvidersJson] = useTriliumOption("llmProviders");
    const providers = useMemo<LlmProviderConfig[]>(() => {
        try {
            return providersJson ? JSON.parse(providersJson) : [];
        } catch {
            return [];
        }
    }, [providersJson]);
    const setProviders = useCallback((newProviders: LlmProviderConfig[]) => {
        setProvidersJson(JSON.stringify(newProviders));
    }, [setProvidersJson]);
    const [showAddModal, setShowAddModal] = useState(false);

    const handleAddProvider = useCallback((newProvider: LlmProviderConfig) => {
        setProviders([...providers, newProvider]);
    }, [providers, setProviders]);

    const handleDeleteProvider = useCallback(async (providerId: string, providerName: string) => {
        if (!(await dialog.confirm(t("llm.delete_provider_confirmation", { name: providerName })))) {
            return;
        }
        setProviders(providers.filter(p => p.id !== providerId));
    }, [providers, setProviders]);

    return (
        <OptionsSection title={t("llm.settings_title")} helpUrl="GBBMSlVSOIGP">
            <p className="form-text">{t("llm.settings_description")}</p>

            <Button
                size="small"
                icon="bx bx-plus"
                text={t("llm.add_provider")}
                onClick={() => setShowAddModal(true)}
            />

            <hr />

            <h5>{t("llm.configured_providers")}</h5>
            <ProviderList
                providers={providers}
                onDelete={handleDeleteProvider}
            />

            <AddProviderModal
                show={showAddModal}
                onHidden={() => setShowAddModal(false)}
                onSave={handleAddProvider}
            />
        </OptionsSection>
    );
}

function getMcpEndpointUrl() {
    const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    return `${window.location.protocol}//localhost:${port}/mcp`;
}

function McpSettings() {
    const [mcpEnabled, setMcpEnabled] = useTriliumOptionBool("mcpEnabled");
    const endpointUrl = useMemo(() => getMcpEndpointUrl(), []);

    return (
        <OptionsSection title={t("llm.mcp_title")}>
            <OptionsRowWithToggle
                name="mcp-enabled"
                label={t("llm.mcp_enabled")}
                description={t("llm.mcp_enabled_description")}
                currentValue={mcpEnabled}
                onChange={setMcpEnabled}
            />

            {mcpEnabled && (
                <OptionsRow name="mcp-endpoint" label={t("llm.mcp_endpoint_title")} description={t("llm.mcp_endpoint_description")}>
                    <input
                        type="text"
                        className="form-control"
                        value={endpointUrl}
                        readOnly
                    />
                </OptionsRow>
            )}
        </OptionsSection>
    );
}

interface ProviderListProps {
    providers: LlmProviderConfig[];
    onDelete: (providerId: string, providerName: string) => Promise<void>;
}

function ProviderList({ providers, onDelete }: ProviderListProps) {
    if (!providers.length) {
        return <div>{t("llm.no_providers_configured")}</div>;
    }

    return (
        <div style={{ overflow: "auto" }}>
            <table className="table table-stripped">
                <thead>
                    <tr>
                        <th>{t("llm.provider_name")}</th>
                        <th>{t("llm.provider_type")}</th>
                        <th>{t("llm.actions")}</th>
                    </tr>
                </thead>
                <tbody>
                    {providers.map((provider) => {
                        const providerType = PROVIDER_TYPES.find(p => p.id === provider.provider);
                        return (
                            <tr key={provider.id}>
                                <td>{provider.name}</td>
                                <td>{providerType?.name || provider.provider}</td>
                                <td>
                                    <ActionButton
                                        icon="bx bx-trash"
                                        text={t("llm.delete_provider")}
                                        onClick={() => onDelete(provider.id, provider.name)}
                                    />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
