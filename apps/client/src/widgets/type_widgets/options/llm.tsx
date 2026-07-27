import "./llm.css";

import type { ReadWeaveAiSettings, ReadWeaveModelInfo, ReadWeaveSearchTestResult } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { isStandalone } from "../../../services/utils";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import MaskedIcon from "../../react/MaskedIcon";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import AddProviderModal, { type LlmProviderConfig, PROVIDER_TYPES } from "./llm/AddProviderModal";

export default function LlmSettings() {
    const [aiEnabled, setAiEnabled] = useTriliumOptionBool("aiEnabled");

    if (isStandalone) {
        return (
            <>
                <OptionsPageHeader helpUrl="GBBMSlVSOIGP" />
                <OptionsSection>
                    <NoItems icon="bx bx-bot" text={t("llm.not_available_in_standalone")} />
                </OptionsSection>
            </>
        );
    }

    return (
        <>
            <ReadWeaveSettings />
            <OptionsPageHeader
                helpUrl="GBBMSlVSOIGP"
                actions={
                    <FormToggle
                        switchOnName="" switchOffName=""
                        switchOnTooltip={t("experimental_features.llm_name")}
                        switchOffTooltip={t("experimental_features.llm_name")}
                        currentValue={aiEnabled}
                        onChange={setAiEnabled}
                    />
                }
            />

            {aiEnabled ? (
                <>
                    <ProviderSettings />
                    <McpSettings />
                </>
            ) : (
                <OptionsSection>
                    <NoItems icon="bx bx-bot" text={t("llm.disabled_placeholder")} />
                </OptionsSection>
            )}
        </>
    );
}

function ReadWeaveSettings() {
    const [settings, setSettings] = useState<ReadWeaveAiSettings>();
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [searchMode, setSearchMode] = useState<ReadWeaveAiSettings["searchMode"]>("automatic");
    const [searchBudgetCny, setSearchBudgetCny] = useState("0.009");
    const [searchKeys, setSearchKeys] = useState({
        serperApiKey: "",
        tavilyApiKey: "",
        braveApiKey: "",
        jinaApiKey: "",
        semanticScholarApiKey: "",
        openAlexApiKey: "",
        unpaywallEmail: ""
    });
    const [searchQuery, setSearchQuery] = useState("ORCID 的正式名称和用途");
    const [searchResult, setSearchResult] = useState<ReadWeaveSearchTestResult>();
    const [models, setModels] = useState<ReadWeaveModelInfo[]>([]);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const selectableModels = useMemo(() => Array.from(new Set([
        model,
        ...models.map(item => item.id),
        "deepseek-v4-pro",
        "deepseek-v4-flash",
        "deepseek-chat",
        "deepseek-reasoner"
    ].filter(Boolean))), [model, models]);

    useEffect(() => {
        void server.get<ReadWeaveAiSettings>("readweave/settings").then(value => {
            setSettings(value);
            setBaseUrl(value.baseUrl);
            setModel(value.model);
            setSearchMode(value.searchMode);
            setSearchBudgetCny(value.searchBudgetCny.toString());
        }).catch(() => setStatus(t("readweave_settings.load_failed")));
    }, []);

    async function saveSettings(clearApiKey = false, clearSearchKeys = false) {
        setBusy(true);
        setStatus(t("readweave_settings.saving"));
        try {
            const parsedSearchBudget = Number.parseFloat(searchBudgetCny);
            const value = await server.put<ReadWeaveAiSettings>("readweave/settings", {
                baseUrl,
                model,
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                clearApiKey,
                searchMode,
                searchBudgetCny: Number.isFinite(parsedSearchBudget) ? parsedSearchBudget : 0.009,
                ...Object.fromEntries(Object.entries(searchKeys).filter(([, key]) => key.trim())),
                ...(clearSearchKeys ? {
                    clearSerperApiKey: true,
                    clearTavilyApiKey: true,
                    clearBraveApiKey: true,
                    clearJinaApiKey: true,
                    clearSemanticScholarApiKey: true,
                    clearOpenAlexApiKey: true,
                    clearUnpaywallEmail: true
                } : {})
            });
            setSettings(value);
            setBaseUrl(value.baseUrl);
            setModel(value.model);
            setSearchMode(value.searchMode);
            setSearchBudgetCny(value.searchBudgetCny.toString());
            setApiKey("");
            setSearchKeys({
                serperApiKey: "",
                tavilyApiKey: "",
                braveApiKey: "",
                jinaApiKey: "",
                semanticScholarApiKey: "",
                openAlexApiKey: "",
                unpaywallEmail: ""
            });
            setModels([]);
            setStatus(t("readweave_settings.saved"));
        } catch {
            setStatus(t("readweave_settings.save_failed"));
        } finally {
            setBusy(false);
        }
    }

    async function testSearch() {
        setBusy(true);
        setStatus(t("readweave_settings.search_testing"));
        setSearchResult(undefined);
        try {
            if (Object.values(searchKeys).some(value => value.trim())
                || searchMode !== settings?.searchMode
                || Number.parseFloat(searchBudgetCny) !== settings?.searchBudgetCny) {
                await saveSettings(false);
            }
            const value = await server.post<ReadWeaveSearchTestResult>("readweave/settings/search-test", { query: searchQuery });
            setSearchResult(value);
            setStatus(t("readweave_settings.search_test_succeeded", {
                count: value.sourceCount,
                providers: value.providers.join("、") || t("readweave_settings.none")
            }));
        } catch {
            setStatus(t("readweave_settings.search_test_failed"));
        } finally {
            setBusy(false);
        }
    }

    const updateSearchKey = (name: keyof typeof searchKeys, value: string) => {
        setSearchKeys(current => ({ ...current, [name]: value }));
    };

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
            <hr />
            <h5>{t("readweave_settings.search_title")}</h5>
            <p className="form-text">{t("readweave_settings.search_description", {
                providers: settings?.search.freeProviders.join("、") ?? "Crossref、DBLP、OpenAlex、Semantic Scholar"
            })}</p>
            <OptionsRow name="readweave-search-mode" label={t("readweave_settings.search_mode")} description={t("readweave_settings.search_mode_description")} stacked>
                <select
                    className="form-select"
                    value={searchMode}
                    onChange={event => setSearchMode(event.currentTarget.value as ReadWeaveAiSettings["searchMode"])}
                    data-testid="readweave-search-mode"
                >
                    <option value="automatic">{t("readweave_settings.search_mode_automatic")}</option>
                    <option value="always">{t("readweave_settings.search_mode_always")}</option>
                    <option value="off">{t("readweave_settings.search_mode_off")}</option>
                </select>
            </OptionsRow>
            <OptionsRow name="readweave-search-budget" label={t("readweave_settings.search_budget")} description={t("readweave_settings.search_budget_description")} stacked>
                <input
                    type="number"
                    className="form-control"
                    min="0"
                    max="1"
                    step="0.001"
                    value={searchBudgetCny}
                    onInput={event => setSearchBudgetCny(event.currentTarget.value)}
                    data-testid="readweave-search-budget"
                />
            </OptionsRow>
            <details>
                <summary className="mb-3">{t("readweave_settings.search_keys_title")}</summary>
                <p className="form-text">{t("readweave_settings.search_keys_description")}</p>
                {([
                    [ "serperApiKey", "Serper", settings?.search.hasSerperApiKey, settings?.search.maskedSerperApiKey, "readweave-serper-api-key" ],
                    [ "tavilyApiKey", "Tavily", settings?.search.hasTavilyApiKey, settings?.search.maskedTavilyApiKey, "readweave-tavily-api-key" ],
                    [ "braveApiKey", "Brave Search", settings?.search.hasBraveApiKey, settings?.search.maskedBraveApiKey, "readweave-brave-api-key" ],
                    [ "jinaApiKey", "Jina", settings?.search.hasJinaApiKey, settings?.search.maskedJinaApiKey, "readweave-jina-api-key" ],
                    [ "semanticScholarApiKey", "Semantic Scholar", settings?.search.hasSemanticScholarApiKey, settings?.search.maskedSemanticScholarApiKey, "readweave-semantic-scholar-api-key" ],
                    [ "openAlexApiKey", "OpenAlex", settings?.search.hasOpenAlexApiKey, settings?.search.maskedOpenAlexApiKey, "readweave-openalex-api-key" ],
                    [ "unpaywallEmail", "Unpaywall Email", settings?.search.hasUnpaywallEmail, settings?.search.maskedUnpaywallEmail, "readweave-unpaywall-email" ]
                ] as const).map(([ name, label, configured, masked, testId ]) => (
                    <OptionsRow
                        name={`readweave-${name}`}
                        label={label}
                        description={configured
                            ? t("readweave_settings.search_key_configured", { masked: masked ?? "••••••••" })
                            : t("readweave_settings.search_key_optional")}
                        stacked
                    >
                        <input
                            type={name === "unpaywallEmail" ? "email" : "password"}
                            className="form-control"
                            value={searchKeys[name]}
                            autocomplete="new-password"
                            placeholder={configured ? t("readweave_settings.key_keep_placeholder") : t("readweave_settings.search_key_placeholder")}
                            onInput={event => updateSearchKey(name, event.currentTarget.value)}
                            data-testid={testId}
                        />
                    </OptionsRow>
                ))}
                <button
                    type="button"
                    className="btn btn-outline-danger mb-3"
                    disabled={busy || !settings || !Object.entries(settings.search).some(([ key, value ]) => key.startsWith("has") && value)}
                    onClick={() => saveSettings(false, true)}
                >
                    {t("readweave_settings.clear_search_keys")}
                </button>
            </details>
            <OptionsRow name="readweave-search-test-query" label={t("readweave_settings.search_test_query")} stacked>
                <input
                    type="text"
                    className="form-control"
                    value={searchQuery}
                    onInput={event => setSearchQuery(event.currentTarget.value)}
                    data-testid="readweave-search-test-query"
                />
            </OptionsRow>
            <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={busy || !searchQuery.trim()} onClick={testSearch} data-testid="readweave-search-test">
                    {t("readweave_settings.search_test")}
                </button>
            </div>
            {searchResult && (
                <div className="mt-3" data-testid="readweave-search-test-result">
                    <p className="mb-2">{t("readweave_settings.search_result_summary", {
                        count: searchResult.sourceCount,
                        elapsed: searchResult.elapsedMs,
                        cost: searchResult.searchCostCny.toFixed(4)
                    })}</p>
                    <ul className="mb-0">
                        {searchResult.sources.slice(0, 5).map(item => (
                            <li key={`${item.provider}:${item.url}`}>
                                <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> <small>（{item.provider}）</small>
                            </li>
                        ))}
                    </ul>
                    {searchResult.warnings.length > 0 && (
                        <details className="mt-2">
                            <summary>{t("readweave_settings.search_warnings", { count: searchResult.warnings.length })}</summary>
                            <ul className="mb-0">
                                {searchResult.warnings.map(warning => <li key={warning}>{warning}</li>)}
                            </ul>
                        </details>
                    )}
                </div>
            )}
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
        <OptionsSection title={t("llm.configured_providers")}>
            <ProviderList
                providers={providers}
                onDelete={handleDeleteProvider}
            />

            <OptionsRow name="add-llm-provider" centered>
                <Button
                    name="add-llm-provider-button"
                    size="micro" icon="bx bx-plus"
                    text={t("llm.add_provider")}
                    onClick={() => setShowAddModal(true)}
                />
            </OptionsRow>

            <AddProviderModal
                show={showAddModal}
                onHidden={() => setShowAddModal(false)}
                onSave={handleAddProvider}
            />
        </OptionsSection>
    );
}

function getMcpEndpointUrl() {
    // On desktop the renderer lives on `trilium-app://app/`, so window.location
    // does not point at a reachable HTTP origin. The server injects an absolute
    // httpBaseUrl in that case; in the browser we derive it from the page.
    if (window.glob.httpBaseUrl) {
        return `${window.glob.httpBaseUrl}/mcp`;
    }
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
                    <FormTextBox
                        className="selectable-text"
                        currentValue={endpointUrl}
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
        return <NoItems icon="bx bx-bot" text={t("llm.no_providers_configured")} />;
    }

    return <>
        {providers.map((provider) => {
            const providerType = PROVIDER_TYPES.find(p => p.id === provider.provider);
            return (
                <OptionsRow
                    key={provider.id}
                    name="llm-provider"
                    label={
                        <span className="llm-provider-name">
                            {providerType?.iconUrl && <MaskedIcon url={providerType.iconUrl} />}
                            {provider.name}
                        </span>
                    }
                    description={providerType?.name || provider.provider}
                >
                    <ActionButton
                        icon="bx bx-trash"
                        text={t("llm.delete_provider")}
                        onClick={() => onDelete(provider.id, provider.name)}
                    />
                </OptionsRow>
            );
        })}
    </>;
}
