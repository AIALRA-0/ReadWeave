import "./llm.css";

import type {
    ReadWeaveAiSettings,
    ReadWeaveHarnessModules,
    ReadWeaveHarnessProfile,
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
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [verifierBaseUrl, setVerifierBaseUrl] = useState("");
    const [verifierModel, setVerifierModel] = useState("");
    const [verifierApiKey, setVerifierApiKey] = useState("");
    const [searchMode, setSearchMode] = useState<ReadWeaveAiSettings["searchMode"]>("automatic");
    const [searchBudgetCny, setSearchBudgetCny] = useState("0.009");
    const [mathShortcut, setMathShortcut] = useState("Alt+=");
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
            const value = await server.put<ReadWeaveAiSettings>("readweave/settings", {
                baseUrl,
                model,
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
            <h5>独立质量核验</h5>
            <p className="form-text">
                只有配置了不同服务来源的第二模型并通过复核，答案才会显示绿色；未配置时答案会保存为黄色待核验，不会误标为正确
            </p>
            <OptionsRow name="readweave-verifier-base-url" label="核验服务地址" description="必须与生成服务使用不同域名" stacked>
                <input
                    type="url"
                    className="form-control"
                    value={verifierBaseUrl}
                    placeholder="https://api.openai.com/v1"
                    onInput={event => setVerifierBaseUrl(event.currentTarget.value)}
                    data-testid="readweave-verifier-base-url"
                />
            </OptionsRow>
            <OptionsRow name="readweave-verifier-model" label="核验模型" description="用于事实、命题命中和内部一致性复核" stacked>
                <input
                    type="text"
                    className="form-control"
                    value={verifierModel}
                    placeholder="独立核验模型名称"
                    onInput={event => setVerifierModel(event.currentTarget.value)}
                    data-testid="readweave-verifier-model"
                />
            </OptionsRow>
            <OptionsRow name="readweave-verifier-api-key" label="核验服务密钥" description={settings?.verifier.hasApiKey
                ? `已配置 ${settings.verifier.maskedApiKey ?? "••••••••"}`
                : "尚未配置"} stacked>
                <input
                    type="password"
                    className="form-control"
                    value={verifierApiKey}
                    autocomplete="new-password"
                    placeholder={settings?.verifier.hasApiKey ? "留空则保留现有密钥" : "输入核验服务密钥"}
                    onInput={event => setVerifierApiKey(event.currentTarget.value)}
                    data-testid="readweave-verifier-api-key"
                />
            </OptionsRow>
            <p className={`form-text mb-0 ${settings?.verifier.independent ? "text-success" : "text-warning"}`}>
                {settings?.verifier.independent ? "独立核验已启用" : "独立核验未启用，答案不会显示绿色"}
            </p>
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
            <OptionsRow name="readweave-math-shortcut" label="公式快捷键" description="默认 Alt+=，可改为其他包含修饰键的组合" stacked>
                <input
                    type="text"
                    className="form-control"
                    value={mathShortcut}
                    onInput={event => setMathShortcut(event.currentTarget.value)}
                    data-testid="readweave-math-shortcut"
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
            const response = await server.post<{ trial: ReadWeaveHarnessTrialResult }>(`readweave/harness/${encodeURIComponent(draft.versionId)}/trial`, {});
            setTrial(response.trial);
            await loadProfiles(draft.versionId);
            setStatus(response.trial.passed ? "全部案例通过，可以发布" : `${response.trial.totalCases - response.trial.passedCases} 个案例未通过，禁止发布`);
        } catch {
            setStatus("试跑未完成，当前版本不能发布");
        } finally {
            setBusy(false);
        }
    }

    async function publishDraft() {
        if (!draft || draft.status !== "trial" || !trial?.passed) return;
        setBusy(true);
        try {
            await server.post(`readweave/harness/${encodeURIComponent(draft.versionId)}/publish`, {});
            await loadProfiles(draft.versionId);
            setStatus("Harness 已发布，新任务将记录该版本");
        } catch {
            setStatus("发布失败，必须先通过全部关键案例");
        } finally {
            setBusy(false);
        }
    }

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
        if (!draft || draft.status === "published") return;
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
                    <OptionsRow name={`readweave-harness-${key}`} label={label} stacked>
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
                    <button type="button" className="btn btn-success" disabled={busy || draft.status !== "trial" || !trial?.passed} onClick={publishDraft}>发布</button>
                    <button type="button" className="btn btn-outline-warning" disabled={busy || draft.status !== "archived"} onClick={rollbackProfile}>回滚到此版本</button>
                    <button type="button" className="btn btn-outline-danger" disabled={busy || draft.status === "published"} onClick={archiveProfile}>归档</button>
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
