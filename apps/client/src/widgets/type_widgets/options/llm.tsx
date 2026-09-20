import "./llm.css";

import type {
    ReadWeaveAiSettings,
    ReadWeaveHarnessModules,
    ReadWeaveHarnessProfile,
    ReadWeaveHarnessTrialJob,
    ReadWeaveHarnessTrialResult,
    ReadWeaveModelInfo,
    ReadWeaveSearchTestResult
} from "@triliumnext/commons";
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
            <ReadWeaveHarnessSettings />
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
    const [providerType, setProviderType] = useState<ReadWeaveAiSettings["providerType"]>("deepseek-official");
    const [pricing, setPricing] = useState(["", "", ""]);
    const [customPricing, setCustomPricing] = useState(false);
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [verifierBaseUrl, setVerifierBaseUrl] = useState("");
    const [verifierModel, setVerifierModel] = useState("");
    const [verifierApiKey, setVerifierApiKey] = useState("");
    const [searchMode, setSearchMode] = useState<ReadWeaveAiSettings["searchMode"]>("always");
    const [searchBudgetCny, setSearchBudgetCny] = useState("0.009");
    const [mathShortcut, setMathShortcut] = useState("Alt+=");
    const [searchKeys, setSearchKeys] = useState({
        serperApiKey: "",
        tavilyApiKey: "",
        braveApiKey: "",
        jinaApiKey: "",
        exaApiKey: "",
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
        "deepseek-flash",
        "deepseek-v4-pro",
        "deepseek-v4-flash",
        "deepseek-v4.1-flash",
        "deepseek-chat",
        "deepseek-reasoner"
    ].filter(Boolean))), [model, models]);

    useEffect(() => {
        void server.get<ReadWeaveAiSettings>("readweave/settings").then(value => {
            setSettings(value);
            setProviderType(value.providerType);
            setPricing([value.pricing.cacheHitInputCnyPerMillion, value.pricing.cacheMissInputCnyPerMillion, value.pricing.outputCnyPerMillion].map(String));
            setCustomPricing(value.pricing.source === "custom");
            setBaseUrl(value.baseUrl);
            setModel(value.model);
            setSearchMode(value.searchMode === "off" ? "off" : "always");
            setSearchBudgetCny(value.searchBudgetCny.toString());
            setMathShortcut(value.mathShortcut);
            setVerifierBaseUrl(value.verifier.baseUrl);
            setVerifierModel(value.verifier.model);
        }).catch(() => setStatus(t("readweave_settings.load_failed")));
    }, []);

    async function saveSettings(clearApiKey = false, clearSearchKeys = false) {
        setBusy(true);
        setStatus(t("readweave_settings.saving"));
        try {
            const parsedSearchBudget = Number.parseFloat(searchBudgetCny);
            if (customPricing && pricing.some(value => !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0)) {
                throw new Error(t("readweave_settings.invalid_pricing"));
            }
            const value = await server.put<ReadWeaveAiSettings>("readweave/settings", {
                providerType,
                baseUrl,
                model,
                ...(providerType === "deepseek-compatible" && customPricing ? {
                    cacheHitInputCnyPerMillion: Number(pricing[0]),
                    cacheMissInputCnyPerMillion: Number(pricing[1]),
                    outputCnyPerMillion: Number(pricing[2])
                } : {}),
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                clearApiKey,
                searchMode,
                searchBudgetCny: Number.isFinite(parsedSearchBudget) ? parsedSearchBudget : 0.009,
                mathShortcut,
                verifierBaseUrl,
                verifierModel,
                ...(verifierApiKey.trim() ? { verifierApiKey: verifierApiKey.trim() } : {}),
                ...Object.fromEntries(Object.entries(searchKeys).filter(([, key]) => key.trim())),
                ...(clearSearchKeys ? {
                    clearSerperApiKey: true,
                    clearTavilyApiKey: true,
                    clearBraveApiKey: true,
                    clearJinaApiKey: true,
                    clearExaApiKey: true,
                    clearSemanticScholarApiKey: true,
                    clearOpenAlexApiKey: true,
                    clearUnpaywallEmail: true
                } : {})
            });
            setSettings(value);
            setProviderType(value.providerType);
            setPricing([value.pricing.cacheHitInputCnyPerMillion, value.pricing.cacheMissInputCnyPerMillion, value.pricing.outputCnyPerMillion].map(String));
            setCustomPricing(value.pricing.source === "custom");
            setBaseUrl(value.baseUrl);
            setModel(value.model);
            setSearchMode(value.searchMode === "off" ? "off" : "always");
            setSearchBudgetCny(value.searchBudgetCny.toString());
            setMathShortcut(value.mathShortcut);
            setVerifierBaseUrl(value.verifier.baseUrl);
            setVerifierModel(value.verifier.model);
            setVerifierApiKey("");
            setApiKey("");
            setSearchKeys({
                serperApiKey: "",
                tavilyApiKey: "",
                braveApiKey: "",
                jinaApiKey: "",
                exaApiKey: "",
                semanticScholarApiKey: "",
                openAlexApiKey: "",
                unpaywallEmail: ""
            });
            setModels([]);
            setStatus(t("readweave_settings.saved"));
            return true;
        } catch (error) {
            setStatus(`${t("readweave_settings.save_failed")} ${settingsError(error)}`);
            return false;
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
                || searchMode !== (settings?.searchMode === "off" ? "off" : "always")
                || Number.parseFloat(searchBudgetCny) !== settings?.searchBudgetCny) {
                if (!await saveSettings(false)) return;
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
            if (!await saveSettings(false)) return;
            const value = await server.get<{ models: ReadWeaveModelInfo[] }>("readweave/settings/models");
            setModels(value.models);
            if (!model.trim() && value.models[0]) setModel(value.models[0].id);
            setStatus(t("readweave_settings.test_succeeded", { count: value.models.length }));
        } catch (error) {
            setStatus(`${t("readweave_settings.test_failed")} ${settingsError(error)}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <OptionsSection title={t("readweave_settings.title")} description={t("readweave_settings.description")}>
            <section className="readweave-settings-group" aria-labelledby="readweave-main-model-heading">
                <h4 id="readweave-main-model-heading">{t("readweave_settings.group_main_model")}</h4>
                <p className="form-text">{t("readweave_settings.group_main_model_description")}</p>
            <OptionsRow name="readweave-provider-type" label={t("readweave_settings.provider_type")} stacked>
                <select className="form-select" value={providerType} data-testid="readweave-provider-type"
                    onChange={event => setProviderType(event.currentTarget.value as ReadWeaveAiSettings["providerType"])}>
                    <option value="deepseek-official">{t("readweave_settings.provider_official")}</option>
                    <option value="deepseek-compatible">{t("readweave_settings.provider_compatible")}</option>
                </select>
            </OptionsRow>
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
                <>
                    <input
                        className="form-control"
                        value={model}
                        list="readweave-model-options"
                        onInput={event => setModel(event.currentTarget.value)}
                        data-testid="readweave-model"
                    />
                    <datalist id="readweave-model-options">
                        {selectableModels.map(modelId => <option value={modelId} key={modelId} />)}
                    </datalist>
                </>
            </OptionsRow>
            </section>
            <section className="readweave-settings-group" aria-labelledby="readweave-cost-heading">
                <h4 id="readweave-cost-heading">{t("readweave_settings.group_cost")}</h4>
                <p className="form-text">{t("readweave_settings.group_cost_description")}</p>
            {providerType === "deepseek-compatible" && <details className="readweave-settings-details" data-testid="readweave-pricing">
                <summary>{t("readweave_settings.pricing_title")}</summary>
                <p className="form-text">{t("readweave_settings.pricing_description")}</p>
                {(["price_cache_hit", "price_input", "price_output"] as const).map((name, index) => (
                    <OptionsRow key={name} name={`readweave-${name}`} label={t(`readweave_settings.${name}`)} stacked>
                        <input type="number" className="form-control" min="0" max="10000" step="0.001"
                            value={pricing[index]} data-testid={`readweave-${name}`}
                            onInput={event => {
                                const value = event.currentTarget.value;
                                setPricing(current => current.map((item, i) => i === index ? value : item));
                                setCustomPricing(true);
                            }} />
                    </OptionsRow>
                ))}
            </details>}
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
            </section>
            <section className="readweave-settings-group" aria-labelledby="readweave-actions-heading">
                <h4 id="readweave-actions-heading">{t("readweave_settings.group_actions")}</h4>
                <p className="form-text">{t("readweave_settings.group_actions_description")}</p>
            <div className="d-flex flex-wrap gap-2 readweave-settings-actions">
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
            </section>
            <section className="readweave-settings-group" aria-labelledby="readweave-advanced-heading">
                <h4 id="readweave-advanced-heading">{t("readweave_settings.group_advanced")}</h4>
                <p className="form-text">{t("readweave_settings.group_advanced_description")}</p>
                <details className="readweave-settings-details">
                    <summary>{t("readweave_settings.verifier_title")}</summary>
                    <p className="form-text">{t("readweave_settings.verifier_description")}</p>
            <OptionsRow name="readweave-verifier-base-url" label={t("readweave_settings.verifier_base_url")} description={t("readweave_settings.verifier_base_url_description")} stacked>
                <input
                    type="url"
                    className="form-control"
                    value={verifierBaseUrl}
                    placeholder={t("readweave_settings.verifier_base_url_placeholder")}
                    onInput={event => setVerifierBaseUrl(event.currentTarget.value)}
                    data-testid="readweave-verifier-base-url"
                />
            </OptionsRow>
            <OptionsRow name="readweave-verifier-model" label={t("readweave_settings.verifier_model")} description={t("readweave_settings.verifier_model_description")} stacked>
                <input
                    type="text"
                    className="form-control"
                    value={verifierModel}
                    placeholder={t("readweave_settings.verifier_model_placeholder")}
                    onInput={event => setVerifierModel(event.currentTarget.value)}
                    data-testid="readweave-verifier-model"
                />
            </OptionsRow>
            <OptionsRow name="readweave-verifier-api-key" label={t("readweave_settings.verifier_api_key")} description={settings?.verifier.hasApiKey
                ? t("readweave_settings.key_configured", { masked: settings.verifier.maskedApiKey ?? "••••••••" })
                : t("readweave_settings.key_missing")} stacked>
                <input
                    type="password"
                    className="form-control"
                    value={verifierApiKey}
                    autocomplete="new-password"
                    placeholder={settings?.verifier.hasApiKey ? t("readweave_settings.key_keep_placeholder") : t("readweave_settings.verifier_api_key_placeholder")}
                    onInput={event => setVerifierApiKey(event.currentTarget.value)}
                    data-testid="readweave-verifier-api-key"
                />
            </OptionsRow>
            <p className={`form-text mb-0 ${settings?.verifier.independent ? "text-success" : "text-warning"}`}>
                {settings?.verifier.independent ? t("readweave_settings.verifier_enabled") : t("readweave_settings.verifier_disabled")}
            </p>
                </details>
            </section>
            <section className="readweave-settings-group" aria-labelledby="readweave-search-heading">
                <h4 id="readweave-search-heading">{t("readweave_settings.group_search")}</h4>
                <p className="form-text">{t("readweave_settings.search_description")}</p>
            <OptionsRow name="readweave-search-mode" label={t("readweave_settings.search_mode")} description={t("readweave_settings.search_mode_description")} stacked>
                <select className="form-select" value={searchMode} data-testid="readweave-search-mode" onChange={event => setSearchMode(event.currentTarget.value as ReadWeaveAiSettings["searchMode"])}>
                    <option value="always">{t("readweave_settings.search_mode_always")}</option>
                    <option value="off">{t("readweave_settings.search_mode_off")}</option>
                </select>
            </OptionsRow>
            <div className="d-flex align-items-center justify-content-between gap-2 mb-2 readweave-search-services-header">
                <div>
                    <h5 className="mb-0">{t("readweave_settings.search_services_title")}</h5>
                    <small className="text-muted">{t("readweave_settings.search_services_description")}</small>
                </div>
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => saveSettings(false)}
                    data-testid="readweave-search-settings-save"
                >
                    {t("readweave_settings.save_search_settings")}
                </button>
            </div>
            <details className="readweave-settings-details">
                <summary className="mb-3">{t("readweave_settings.search_keys_title")}</summary>
                <p className="form-text">{t("readweave_settings.search_keys_description")}</p>
                {([
                    [ "serperApiKey", "Serper", settings?.search.hasSerperApiKey, settings?.search.maskedSerperApiKey, "readweave-serper-api-key" ],
                    [ "tavilyApiKey", "Tavily", settings?.search.hasTavilyApiKey, settings?.search.maskedTavilyApiKey, "readweave-tavily-api-key" ],
                    [ "braveApiKey", "Brave Search", settings?.search.hasBraveApiKey, settings?.search.maskedBraveApiKey, "readweave-brave-api-key" ],
                    [ "jinaApiKey", "Jina", settings?.search.hasJinaApiKey, settings?.search.maskedJinaApiKey, "readweave-jina-api-key" ],
                    [ "exaApiKey", "Exa", settings?.search.hasExaApiKey, settings?.search.maskedExaApiKey, "readweave-exa-api-key" ],
                    [ "semanticScholarApiKey", "Semantic Scholar", settings?.search.hasSemanticScholarApiKey, settings?.search.maskedSemanticScholarApiKey, "readweave-semantic-scholar-api-key" ],
                    [ "openAlexApiKey", "OpenAlex", settings?.search.hasOpenAlexApiKey, settings?.search.maskedOpenAlexApiKey, "readweave-openalex-api-key" ],
                    [ "unpaywallEmail", "Unpaywall Email", settings?.search.hasUnpaywallEmail, settings?.search.maskedUnpaywallEmail, "readweave-unpaywall-email" ]
                ] as const).map(([ name, label, configured, masked, testId ]) => (
                    <OptionsRow
                        key={name}
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
            <OptionsRow name="readweave-search-test-query" label={t("readweave_settings.search_test_query")} description={t("readweave_settings.search_test_query_description")} stacked>
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
            </section>
            <section className="readweave-settings-group" aria-labelledby="readweave-shortcuts-heading">
                <h4 id="readweave-shortcuts-heading">{t("readweave_settings.group_shortcuts")}</h4>
                <p className="form-text">{t("readweave_settings.group_shortcuts_description")}</p>
                <OptionsRow name="readweave-math-shortcut" label={t("readweave_settings.math_shortcut")} description={t("readweave_settings.math_shortcut_description")} stacked>
                    <input
                        type="text"
                        className="form-control"
                        value={mathShortcut}
                        onInput={event => setMathShortcut(event.currentTarget.value)}
                        data-testid="readweave-math-shortcut"
                    />
                </OptionsRow>
            </section>
        </OptionsSection>
    );
}

function settingsError(error: unknown): string {
    if (typeof error === "string") {
        try { return settingsError(JSON.parse(error)); } catch { return error.replace(/<[^>]*>/gu, "").slice(0, 400); }
    }
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message.slice(0, 400);
    return "";
}

const HARNESS_MODULE_LABELS: Array<[ keyof ReadWeaveHarnessModules, string ]> = [
    [ "questionNormalization", "问题归一化" ],
    [ "evidencePolicy", "证据规则" ],
    [ "answerWriting", "回答提示词" ],
    [ "semanticRubric", "语义评分规则" ],
    [ "formatRules", "格式规则" ]
];

function ReadWeaveHarnessSettings() {
    const [profiles, setProfiles] = useState<ReadWeaveHarnessProfile[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [draft, setDraft] = useState<ReadWeaveHarnessProfile>();
    const [casesJson, setCasesJson] = useState("[]");
    const [trial, setTrial] = useState<ReadWeaveHarnessTrialResult>();
    const [trialJob, setTrialJob] = useState<ReadWeaveHarnessTrialJob>();
    const [caseQuestion, setCaseQuestion] = useState("");
    const [caseBadAnswer, setCaseBadAnswer] = useState("");
    const [caseReferenceAnswer, setCaseReferenceAnswer] = useState("");
    const [caseExpectedFacts, setCaseExpectedFacts] = useState("");
    const [caseForbiddenClaims, setCaseForbiddenClaims] = useState("");
    const [caseIntent, setCaseIntent] = useState<ReadWeaveHarnessProfile["cases"][number]["expectedIntent"]>("definition");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");

    const loadProfiles = useCallback(async (preferredId?: string) => {
        const response = await server.get<{ profiles: ReadWeaveHarnessProfile[] }>("readweave/harness");
        setProfiles(response.profiles);
        const nextId = preferredId || selectedId || response.profiles.find(item => item.status === "published")?.versionId || response.profiles[0]?.versionId || "";
        setSelectedId(nextId);
        const selected = response.profiles.find(item => item.versionId === nextId);
        setDraft(selected ? structuredClone(selected) : undefined);
        setCasesJson(JSON.stringify(selected?.cases ?? [], null, 2));
        setTrial(selected?.lastTrial);
        if (nextId) {
            const latest = await server.get<{ trialJob: ReadWeaveHarnessTrialJob | null }>(`readweave/harness/${encodeURIComponent(nextId)}/trial`);
            setTrialJob(latest.trialJob?.contentDigest === selected?.contentDigest ? latest.trialJob ?? undefined : undefined);
        } else {
            setTrialJob(undefined);
        }
    }, [selectedId]);

    useEffect(() => {
        void loadProfiles().catch(() => setStatus("质量控制中心加载失败"));
    }, []);

    function chooseProfile(versionId: string) {
        setSelectedId(versionId);
        const selected = profiles.find(item => item.versionId === versionId);
        setDraft(selected ? structuredClone(selected) : undefined);
        setCasesJson(JSON.stringify(selected?.cases ?? [], null, 2));
        setTrial(selected?.lastTrial);
        setTrialJob(undefined);
        if (versionId) void server.get<{ trialJob: ReadWeaveHarnessTrialJob | null }>(`readweave/harness/${encodeURIComponent(versionId)}/trial`)
            .then(response => setTrialJob(response.trialJob?.contentDigest === selected?.contentDigest ? response.trialJob ?? undefined : undefined))
            .catch(() => undefined);
    }

    async function createDraft() {
        setBusy(true);
        try {
            const response = await server.post<{ profile: ReadWeaveHarnessProfile }>("readweave/harness", { sourceVersionId: selectedId || undefined });
            await loadProfiles(response.profile.versionId);
            setStatus("已创建可编辑草稿");
        } catch {
            setStatus("创建草稿失败");
        } finally {
            setBusy(false);
        }
    }

    async function saveDraft(): Promise<boolean> {
        if (!draft || (draft.status !== "draft" && draft.status !== "trial")) return false;
        setBusy(true);
        try {
            const cases = JSON.parse(casesJson) as ReadWeaveHarnessProfile["cases"];
            const response = await server.put<{ profile: ReadWeaveHarnessProfile }>(`readweave/harness/${encodeURIComponent(draft.versionId)}`, {
                name: draft.name,
                modules: draft.modules,
                cases
            });
            setDraft(response.profile);
            setCasesJson(JSON.stringify(response.profile.cases, null, 2));
            setTrial(undefined);
            setTrialJob(undefined);
            setStatus("草稿已保存，发布前必须重新试跑");
            await loadProfiles(response.profile.versionId);
            return true;
        } catch {
            setStatus("保存失败，请检查案例 JSON 和模块内容");
            return false;
        } finally {
            setBusy(false);
        }
    }

    async function runTrial() {
        if (!draft) return;
        setBusy(true);
        setStatus("正在用当前草稿运行真实回归案例");
        try {
            if (!await saveDraft()) return;
            const response = await server.post<{ trialJob: ReadWeaveHarnessTrialJob }>(`readweave/harness/${encodeURIComponent(draft.versionId)}/trial`, {});
            setTrialJob(response.trialJob);
            setTrial(undefined);
            setStatus(`后台试跑已开始，进度 0 / ${response.trialJob.totalCases}，离开页面不会停止`);
        } catch {
            setStatus("试跑未完成，当前版本不能发布");
        } finally {
            setBusy(false);
        }
    }

    async function publishDraft() {
        if (!draft || draft.status !== "trial" || !trial?.passed || trialJob?.status !== "passed") return;
        setBusy(true);
        try {
            await server.post(`readweave/harness/${encodeURIComponent(draft.versionId)}/publish`, {
                trialJobId: trialJob.trialJobId,
                revisionId: draft.currentRevisionId,
                contentDigest: draft.contentDigest
            });
            await loadProfiles(draft.versionId);
            setStatus("Harness 已发布，新任务将记录该版本");
        } catch {
            setStatus("发布失败，必须先通过全部关键案例");
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        if (!trialJob || (trialJob.status !== "queued" && trialJob.status !== "running")) return;
        let cancelled = false;
        const timer = window.setInterval(() => {
            void server.get<{ trialJob: ReadWeaveHarnessTrialJob }>(`readweave/harness/trials/${encodeURIComponent(trialJob.trialJobId)}`).then(response => {
                if (cancelled) return;
                setTrialJob(response.trialJob);
                setStatus(response.trialJob.status === "queued" || response.trialJob.status === "running"
                    ? `后台试跑进行中，进度 ${response.trialJob.completedCases} / ${response.trialJob.totalCases}`
                    : response.trialJob.status === "passed"
                        ? "全部案例通过，可以发布"
                        : response.trialJob.result
                            ? `${response.trialJob.result.totalCases - response.trialJob.result.passedCases} 个案例未通过，禁止发布`
                            : "试跑任务失败，当前版本不能发布");
                if (response.trialJob.result) setTrial(response.trialJob.result);
                if (response.trialJob.status === "passed" || response.trialJob.status === "failed") {
                    void loadProfiles(response.trialJob.versionId);
                }
            }).catch(() => undefined);
        }, 1_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [trialJob?.trialJobId, trialJob?.status]);

    async function addCase() {
        if (!draft || !caseQuestion.trim()) return;
        setBusy(true);
        try {
            if (!await saveDraft()) return;
            const response = await server.post<{ profile: ReadWeaveHarnessProfile }>(`readweave/harness/${encodeURIComponent(draft.versionId)}/cases`, {
                question: caseQuestion.trim(),
                category: "用户反馈",
                expectedIntent: caseIntent,
                badAnswer: caseBadAnswer.trim() || undefined,
                referenceAnswer: caseReferenceAnswer.trim() || undefined,
                expectedFacts: caseExpectedFacts.split(/\r?\n/u).map(item => item.trim()).filter(Boolean),
                forbiddenClaims: caseForbiddenClaims.split(/\r?\n/u).map(item => item.trim()).filter(Boolean),
                critical: true
            });
            setDraft(response.profile);
            setCasesJson(JSON.stringify(response.profile.cases, null, 2));
            setTrial(undefined);
            setCaseQuestion("");
            setCaseBadAnswer("");
            setCaseReferenceAnswer("");
            setCaseExpectedFacts("");
            setCaseForbiddenClaims("");
            await loadProfiles(response.profile.versionId);
            setStatus("案例已加入回归集，发布前需要重新试跑");
        } catch {
            setStatus("案例加入失败，请检查问题与验收内容");
        } finally {
            setBusy(false);
        }
    }

    async function rollbackProfile() {
        if (!draft || draft.status !== "archived") return;
        setBusy(true);
        try {
            await server.post(`readweave/harness/${encodeURIComponent(draft.versionId)}/rollback`, {});
            await loadProfiles(draft.versionId);
            setStatus("已回滚到所选版本");
        } catch {
            setStatus("回滚失败");
        } finally {
            setBusy(false);
        }
    }

    async function archiveProfile() {
        if (!draft || draft.status === "published" || draft.status === "legacy-published") return;
        setBusy(true);
        try {
            await server.post(`readweave/harness/${encodeURIComponent(draft.versionId)}/archive`, {});
            await loadProfiles();
            setStatus("版本已归档");
        } catch {
            setStatus("归档失败");
        } finally {
            setBusy(false);
        }
    }

    const editable = draft?.status === "draft" || draft?.status === "trial";
    const parentProfile = draft?.parentVersionId ? profiles.find(profile => profile.versionId === draft.parentVersionId) : undefined;
    const changedModules = draft && parentProfile
        ? HARNESS_MODULE_LABELS.filter(([ key ]) => draft.modules[key] !== parentProfile.modules[key]).map(([, label ]) => label)
        : [];
    return (
        <OptionsSection title="ReadWeave 质量控制中心" description="查看并修改实际生效的提示词、证据规则、评分规则和回归案例；未通过试跑的草稿不能发布">
            <OptionsRow name="readweave-harness-version" label="Harness 版本" stacked>
                <select className="form-select" value={selectedId} onChange={event => chooseProfile(event.currentTarget.value)}>
                    {profiles.map(profile => <option value={profile.versionId} key={profile.versionId}>{profile.name} · {profile.status}</option>)}
                </select>
            </OptionsRow>
            {draft && <>
                <OptionsRow name="readweave-harness-name" label="版本名称" stacked>
                    <input className="form-control" value={draft.name} disabled={!editable} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })} />
                </OptionsRow>
                {HARNESS_MODULE_LABELS.map(([ key, label ]) => (
                    <OptionsRow key={key} name={`readweave-harness-${key}`} label={label} stacked>
                        <textarea
                            className="form-control"
                            rows={6}
                            value={draft.modules[key]}
                            disabled={!editable}
                            onInput={event => setDraft({ ...draft, modules: { ...draft.modules, [key]: event.currentTarget.value } })}
                        />
                    </OptionsRow>
                ))}
                <OptionsRow name="readweave-harness-cases" label={`真实测试案例（${draft.cases.length}）`} description="JSON 可直接人工审核；案例不会写入生成提示词" stacked>
                    <textarea className="form-control font-monospace" rows={14} value={casesJson} disabled={!editable} onInput={event => setCasesJson(event.currentTarget.value)} />
                </OptionsRow>
                {editable && <details className="mb-3">
                    <summary>把当前错误加入回归集</summary>
                    <div className="d-grid gap-2 mt-2">
                        <input className="form-control" value={caseQuestion} onInput={event => setCaseQuestion(event.currentTarget.value)} placeholder="用户问题" />
                        <select className="form-select" value={caseIntent} onChange={event => setCaseIntent(event.currentTarget.value as typeof caseIntent)}>
                            <option value="identity">人物身份</option>
                            <option value="definition">定义</option>
                            <option value="form">形态</option>
                            <option value="mechanism">机制</option>
                            <option value="reason">原因</option>
                            <option value="comparison">比较</option>
                            <option value="calculation">计算</option>
                            <option value="boundary">边界</option>
                        </select>
                        <textarea className="form-control" rows={4} value={caseBadAnswer} onInput={event => setCaseBadAnswer(event.currentTarget.value)} placeholder="错误答案" />
                        <textarea className="form-control" rows={4} value={caseReferenceAnswer} onInput={event => setCaseReferenceAnswer(event.currentTarget.value)} placeholder="人工修正版" />
                        <textarea className="form-control" rows={3} value={caseExpectedFacts} onInput={event => setCaseExpectedFacts(event.currentTarget.value)} placeholder="必须包含的事实，每行一项；可用 || 表示同义选项" />
                        <textarea className="form-control" rows={3} value={caseForbiddenClaims} onInput={event => setCaseForbiddenClaims(event.currentTarget.value)} placeholder="禁止出现的断言，每行一项" />
                        <button type="button" className="btn btn-outline-primary" disabled={busy || !caseQuestion.trim()} onClick={addCase}>加入回归集</button>
                    </div>
                </details>}
                {parentProfile && <details className="mb-3">
                    <summary>与上级版本的差异</summary>
                    <p className="form-text mb-1">变更模块：{changedModules.length ? changedModules.join("、") : "无"}</p>
                    <p className="form-text mb-0">案例数量：{parentProfile.cases.length} → {draft.cases.length}</p>
                    {HARNESS_MODULE_LABELS.filter(([ key ]) => draft.modules[key] !== parentProfile.modules[key]).map(([ key, label ]) => <details className="mt-2" key={key}>
                        <summary>{label}</summary>
                        <div className="row g-2 mt-1">
                            <div className="col-md-6"><strong>上级版本</strong><pre className="small text-wrap mt-1">{parentProfile.modules[key]}</pre></div>
                            <div className="col-md-6"><strong>当前版本</strong><pre className="small text-wrap mt-1">{draft.modules[key]}</pre></div>
                        </div>
                    </details>)}
                </details>}
                <div className="d-flex flex-wrap gap-2">
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={createDraft}>复制为草稿</button>
                    <button type="button" className="btn btn-primary" disabled={busy || !editable} onClick={saveDraft}>保存草稿</button>
                    <button type="button" className="btn btn-warning" disabled={busy || !editable} onClick={runTrial}>真实试跑</button>
                    <button type="button" className="btn btn-success" disabled={busy || draft.status !== "trial" || !trial?.passed || trialJob?.status !== "passed"} onClick={publishDraft}>发布</button>
                    <button type="button" className="btn btn-outline-warning" disabled={busy || draft.status !== "archived"} onClick={rollbackProfile}>回滚到此版本</button>
                    <button type="button" className="btn btn-outline-danger" disabled={busy || draft.status === "published" || draft.status === "legacy-published"} onClick={archiveProfile}>归档</button>
                </div>
                {status && <p className="form-text mt-2" role="status">{status}</p>}
                {trial && !trial.passed && <details className="mt-2">
                    <summary>{trial.totalCases - trial.passedCases} 个失败案例</summary>
                    <ul>{trial.failedCases.map(item => <li key={item.caseId}><strong>{item.caseId}</strong>：{item.issues.join("；")}</li>)}</ul>
                    {trial.hiddenFailedCases > 0 && <p>隐藏保留集有 {trial.hiddenFailedCases} 个案例未通过；题目和判据不会显示在客户端</p>}
                </details>}
            </>}
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
