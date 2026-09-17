import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse, ReadWeaveGenerationProgress } from "@triliumnext/commons";
import { createHash } from "node:crypto";
import { ReadWeaveBudget, readWeaveGenerationBudgetMode, readWeaveModelRates } from "./readweave_budget.js";
import { runReadWeaveActivePipeline, type ActiveStage, type ActiveCheckpoint } from "./readweave_active_pipeline.js";
import { READWEAVE_FORMAT_VERSION } from "./readweave_format.js";
import { readReadWeavePageWithJina, searchReadWeaveActiveEvidence, withReadWeaveSearchPolicy } from "./readweave_search.js";
import { getReadWeaveRuntimeConfig } from "./readweave_settings.js";
import { readWeaveWritingSkill } from "./readweave_writing_skill.js";
import { readWeavePromptInputTokens } from "./readweave_tokenizer.js";
import { requestJson, usageSummary, type CompletionUsage, type ReadWeaveUnifiedExecutionContext } from "./readweave_unified_ai.js";

const VERSION = "active-research-v1";
/** Stored only in the protected job payload, not accepted from or returned to the browser. */
export interface ActiveSavedState {
    requestKey?: string;
    checkpoint: ActiveCheckpoint;
    usages: CompletionUsage[];
    searchQueries: string[];
    warnings: string[];
    searchCost: number;
    pageReads: number;
}
export type ActiveStoredResult = ReadWeaveGenerateResponse & { activeState?: ActiveSavedState };
export function readWeaveActiveRequestKey(request: ReadWeaveGenerateRequest): string {
    const {answerPlan: _answerPlan, ...stableRequest} = request;
    return createHash("sha256").update(JSON.stringify(stableRequest)).digest("hex");
}
const STAGE_SCHEMA = {
    type:"object", additionalProperties:false, required:["gaps","readyReason","actions","result"],
    properties:{gaps:{type:"array",items:{type:"string"}},readyReason:{type:"string"},
        actions:{type:"array",items:{type:"object"}}, result:{anyOf:[{type:"object"},{type:"null"}]}}
};

export async function generateReadWeaveActiveAnswer(
    request: ReadWeaveGenerateRequest,
    onProgress?: (progress: ReadWeaveGenerationProgress) => void,
    signal?: AbortSignal,
    execution?: ReadWeaveUnifiedExecutionContext
): Promise<ActiveStoredResult> {
    const original = structuredClone(execution?.originalRequest ?? request);
    const config = getReadWeaveRuntimeConfig(), writingSkill = readWeaveWritingSkill(true);
    const budget = execution?.budget ?? new ReadWeaveBudget(0.05, { hardLimitCny: 0.1 });
    if (readWeaveGenerationBudgetMode() === "meter-only") budget.suspendEnforcement();
    const rates = config.providerType === "deepseek-official" || new URL(config.baseUrl).hostname === "api.deepseek.com"
        ? readWeaveModelRates(config.model) : config.rates ?? readWeaveModelRates(config.model);
    const searchEnabled = request.activeExternalSearch === true || request.autoExternalSearch !== false;
    const requestKey = readWeaveActiveRequestKey(original);
    const saved = execution?.activeState?.requestKey === requestKey || !execution?.activeState?.requestKey
        ? execution?.activeState : undefined;
    const usages: CompletionUsage[] = [...saved?.usages ?? []], searchQueries: string[] = [...saved?.searchQueries ?? []], warnings: string[] = [...saved?.warnings ?? []];
    let searchCost = saved?.searchCost ?? 0, pageReads = saved?.pageReads ?? 0, round = 0, actualModel = config.model;
    const stages: Record<ActiveStage, ReadWeaveGenerationProgress["stage"]> = {
        requirements: "gathering-context", outline: "gathering-context", writing: "drafting", format: "checking"
    };
    const report = (stage: ActiveStage, message: string) => onProgress?.({ stage: stages[stage], round: ++round, message, issues: [] });
    return withReadWeaveSearchPolicy({ externalSearch: searchEnabled ? "allowed" : "off", allowedSourceScopes: ["public"], signal }, async () => {
        const result = await runReadWeaveActivePipeline(structuredClone(request), {
            signal, searchEnabled, writingSkill: writingSkill.prompt, progress: report, checkpoint:saved?.checkpoint,
            saveCheckpoint: checkpoint => execution?.saveActiveState?.({requestKey,checkpoint:structuredClone(checkpoint),
                usages:structuredClone(usages),searchQueries:[...searchQueries],warnings:[...warnings],searchCost,pageReads}),
            budgetStatus: () => budget.enforced
                ? {mode:"enforced",remainingCny:budget.remainingCny,ceilingCny:budget.hardLimitCny,
                    guidance:"优先完成当前阶段的必要工作，查证只补实际缺口，已有事实不重复搜索，保留完整写作和格式修复的费用"}
                : {mode:"meter-only",remainingCny:null,ceilingCny:null,
                    guidance:"用户已暂时解除费用上限，完成必要研究、完整回答与格式修复，不因费用不足拒答或省略；已有资料复用，不重复检索"},
            async model(stage, system, input) {
                signal?.throwIfAborted();
                const user = JSON.stringify(input);
                const inputTokens = readWeavePromptInputTokens(system,user,config.model);
                const inputCost = inputTokens * Math.max(rates.cacheHitInput,rates.cacheMissInput) / 1e6;
                const minimumReservation = inputCost + 512 * rates.output / 1e6;
                if (budget.enforced && minimumReservation > budget.remainingCny && budget.limitCny < budget.hardLimitCny) {
                    budget.raiseLimit(budget.hardLimitCny);
                    report(stage, "完整生成所需费用超过普通目标，使用已授权的困难预算，仍逐次预留并记账");
                }
                // Reserve against the one financial ceiling. Stage percentages used to
                // truncate otherwise affordable plans and are intentionally not enforced.
                const allowance = Math.max(0, budget.remainingCny - inputCost - 0.000001);
                // Official V4 advertises 384K output; do not impose our former
                // 32K workflow cap. Unknown compatible services enforce their own
                // documented limit instead of receiving an invented application cap.
                const official = config.providerType === "deepseek-official" || new URL(config.baseUrl).hostname === "api.deepseek.com";
                const providerCeiling = official ? 384_000 : Number.MAX_SAFE_INTEGER;
                // In meter-only mode, no output limit is derived from money. For unknown
                // gateways omit the request limit; 384K is only a pending accounting estimate.
                const maxTokens = budget.enforced
                    ? Math.min(providerCeiling, Math.floor(allowance * 1e6 / Math.max(rates.output, 0.001)))
                    : 384_000;
                if (budget.enforced && (maxTokens < 128 || inputCost + maxTokens * rates.output / 1e6 > budget.remainingCny))
                    throw new Error(`当前模型费率下本阶段完整输入无法纳入剩余预算：${stage}；输入预估 ¥${inputCost.toFixed(6)}，剩余 ¥${budget.remainingCny.toFixed(6)}；未发起付费调用，未替换问题或答案`);
                const response = await requestJson<unknown>(system, user, maxTokens, 120_000, config, signal,
                    `主动流程 ${stage}`, budget, usage => { if (usage) usages.push(usage); }, new Set(), true,
                    {inputTokens,schema:STAGE_SCHEMA,omitOutputLimit:!budget.enforced && !official});
                if (response.outputLimitReached || response.outputEnvelopeIncomplete) throw new Error("模型未交付完整阶段结果，已保留费用记录，未使用截断结果或替代答案");
                actualModel = response.model;
                return response.value;
            },
            async retrieve(action, resources) {
                signal?.throwIfAborted();
                if (action.tool === "page") {
                    // Anonymous reader does not send a paid credential. SSRF checks still apply.
                    try {
                        const content = await readReadWeavePageWithJina(action.url, { signal, anonymous: true });
                        pageReads++;
                        if (!content) return { url: action.url, status: "unavailable", sourceIds: [] };
                        const document = resources.addDocument({ sourceType: "external", provider: "Jina/Direct public reader",
                            title: action.url, url: action.url, excerpt: content, accessedAt: new Date().toISOString(), retrievalMode: "page-reader" });
                        return { url: action.url, status: "indexed", ...document };
                    } catch (error) {
                        signal?.throwIfAborted();
                        const detail = error instanceof Error ? error.message : String(error);
                        warnings.push(detail);
                        return { url: action.url, status: "failed", detail, sourceIds: [] };
                    }
                }
                // Reserve before dispatch. The allowance covers every adapter selected by this call.
                const tariff = action.provider === "people" ? 0.0504 : 0.0072;
                if (budget.enforced && tariff > budget.remainingCny && budget.limitCny < budget.hardLimitCny) budget.raiseLimit(budget.hardLimitCny);
                const allowance = budget.enforced ? Math.min(budget.remainingCny, tariff) : tariff;
                const receipt = budget.reserveResourceRequest(allowance);
                if (receipt === undefined) throw new Error("检索费用预留失败，未发起外部调用");
                const evidence = await searchReadWeaveActiveEvidence({ query: action.query, provider: action.provider, budgetCny: allowance }, { signal });
                budget.reportUsage(receipt, evidence.searchCostCny, "configured-rate-estimate");
                searchCost += evidence.searchCostCny; searchQueries.push(action.query); warnings.push(...evidence.warnings);
                const ids = evidence.sources.map(source => resources.addExternal({
                    sourceType: "external", provider: source.provider, title: source.title, url: source.url,
                    excerpt: source.content || source.snippet, publishedAt: source.publishedAt,
                    accessedAt: new Date().toISOString(), queries: [action.query], retrievalMode: source.retrievalMode
                }));
                resources.open(ids, "search");
                return { query: action.query, sourceIds: ids, providers: evidence.providers, warnings: evidence.warnings };
            }
        });
        const sources = result.resources.allOpenedSources();
        // Released resources referenced by factual notes remain part of the delivered provenance.
        for (const id of new Set(result.outline.facts.flatMap(f => f.sourceIds)))
            if (!sources.some(s => s.sourceId === id)) sources.push(result.resources.get(id));
        const external = sources.filter(s => s.sourceType === "external");
        const decision = { mode: !searchEnabled ? "disabled" as const : request.activeExternalSearch ? "forced" as const : "automatic" as const, required: searchEnabled,
            reason: searchEnabled ? "default" as const : "disabled" as const, queries: searchQueries, executed: searchQueries.length > 0,
            sourceCount: new Set(external.map(s => s.url ?? s.sourceId)).size };
        const issues = result.formatIssues;
        const formatReviewInterrupted = !!result.trace.filter(entry => entry.stage === "format").at(-1)?.error;
        onProgress?.({ stage: "complete", round: ++round, message: result.checkpoint ? "资料与构造流已准备，请审核后生成答案"
            : formatReviewInterrupted ? "回答已生成，格式复核未完整完成；正文可保存，详情见执行记录"
                : issues.length ? "回答已生成，格式建议保留在详细日志" : "回答已生成，格式检查完成", issues });
        return {
            awaitingPlan: !!result.checkpoint,
            activeState: result.checkpoint ? {requestKey,checkpoint:result.checkpoint,usages,searchQueries,warnings,searchCost,pageReads} : undefined,
            body: result.body, optimizedTitle: request.optimizeQuestion ? result.requirements.normalizedQuestion : undefined,
            contentType: request.contentType, origin: request.origin, questionStack: request.questionStack,
            evidenceSources: sources, claims: result.outline.facts.map((f, i) => ({ claimId: `F${i + 1}`, text: f.statement,
                sourceIds: f.sourceIds, confidence: f.basis === "unresolved" ? "low" : "medium", status: "not-checked" })),
            answerPlan: result.plan, externalSearchDecision: decision, qualityState: "provisional", evidenceState: "not-checked",
            harnessVersion: VERSION, unresolvedIssues: issues,
            audit: {
                workflowVersion: "active-research-v1", harnessVersion: VERSION, formatVersion: `${READWEAVE_FORMAT_VERSION}+skill-${writingSkill.revision}`,
                questionContract: { normalizedQuestion: result.requirements.normalizedQuestion, objective: result.requirements.scope,
                    answerRequirements: result.requirements.needs.map(n => n.statement), exclusions: result.requirements.exclusions,
                    searchQueries, requiresCurrentEvidence: false },
                answerPlan: result.plan, externalSearchDecision: decision, searchQueries, unresolvedClaims: result.outline.facts.filter(f => f.basis === "unresolved").map(f => f.statement),
                validationIssues: issues, citationsVerified: false, generatedAt: new Date().toISOString(), independentVerification: "not-run",
                activeExecution: { requirements: result.requirements, outline: result.outline, stages: result.trace, reads: result.resources.trace, warnings },
                research: { budgetCny: budget.limitCny, budgetEnforced:budget.enforced, searchCostCny: searchCost, queryCount: searchQueries.length, pageReadCount: pageReads,
                    cacheHits: 0, stopReason: !searchEnabled ? "disabled" : result.outline.facts.some(f => f.basis === "unresolved") ? "exhausted" : "sufficient", queries: searchQueries,
                    missingFacts: result.outline.facts.filter(f => f.basis === "unresolved").map(f => f.statement) }
            },
            context: { fragmentIds: sources.filter(s => s.sourceType === "local").map(s => s.sourceId),
                characterCount: sources.filter(s => s.sourceType === "local").reduce((sum, s) => sum + s.excerpt.length, 0),
                characterBudget: original.fragments.reduce((sum, f) => sum + f.text.length, 0), expansionLevel: result.resources.trace.length, attemptedBudgets: [] },
            workflow: { generationAttempts: 1, validationPasses: result.trace.filter(t => t.stage === "format").length,
                contextExpansions: result.resources.trace.length, repairRounds: result.repairRounds, unchangedSegmentsVerified: true },
            provider: new URL(config.baseUrl).hostname, model: actualModel, usage: usageSummary(usages, searchCost, budget.limitCny, budget)
        };
    });
}
