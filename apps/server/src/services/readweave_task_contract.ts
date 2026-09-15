import { createHash, randomUUID } from "node:crypto";

import type { ReadWeaveClaim, ReadWeaveEvidenceSource, ReadWeaveGenerateRequest, ReadWeaveUsageSummary } from "@triliumnext/commons";
import type { ContentBlock, ExecutionEvent, InputRef, Locator, RequestEnvelope, SemanticProposal, TaskContract } from "@triliumnext/commons/src/lib/readweave_task_contract.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { READWEAVE_PRICING_VERSION, type ReadWeaveBudget, readWeaveEstimatedInputTokens } from "./readweave_budget.js";
import schema from "./readweave_task_contract.schema.json";

export const READWEAVE_TASK_POLICY_VERSION = "open-domain-root-v1";
const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false });
addFormats(ajv);
ajv.addSchema(schema);
const validateProposal = ajv.getSchema<SemanticProposal>(`${schema.$id}#/$defs/SemanticProposal`)!;
const validateContract = ajv.getSchema<TaskContract>(`${schema.$id}#/$defs/TaskContract`)!;

export function readWeaveContentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function freeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}

function whole(blockId: string): InputRef { return { blockId, locator: { kind: "whole" } }; }

/** Capture before the first await. IDs are server-owned; duplicate fragment IDs cannot alias blocks. */
export function captureReadWeaveTask(request: ReadWeaveGenerateRequest, _legacySearchEnabled: boolean, now = new Date(),
    priceSnapshotId = READWEAVE_PRICING_VERSION): TaskContract {
    const capturedAt = now.toISOString();
    const requestId = randomUUID();
    const block = (id: string, role: ContentBlock["role"], text: string, sourceId: string): ContentBlock => ({
        id, role, mimeType: "text/plain", text, blobRef: null, contentHash: readWeaveContentHash(text),
        sourceId, sourceVersion: readWeaveContentHash(text), sourceUrl: null, capturedAt,
        extraction: { status: "original", method: null, warnings: [] },
        origin: { kind: role === "question" || role === "prior_user" ? "user" : request.parentLinkId ? "assistant" : "article",
            messageId: null, parentAnswerId: request.parentLinkId ?? null }, instructionAuthority: "none"
    });
    const blocks = [block("question", "question", request.title, requestId),
        ...request.fragments.map((fragment, index) => block(`fragment-${index}`,
            fragment.role === "selected" ? "selection" : "article_context", fragment.text,
            `${request.articleId}:${fragment.id}`))];
    if (request.feedback) blocks.push(block("feedback", "prior_user", request.feedback, requestId));
    if (request.answerPlan) blocks.push(block("reviewed-plan", "prior_user", JSON.stringify(request.answerPlan), requestId));
    // The immutable per-task request is the authority for retrieval.  Older
    // installations can retain readWeaveSearchMode=off after upgrading from
    // the former two-switch UI; that obsolete host preference must not turn
    // an explicitly authorised task into a no-search task.  The user's single
    // "close external search" choice is represented by both legacy fields
    // being false and remains an absolute deny.
    const explicitlyEnabled = request.activeExternalSearch === true || request.autoExternalSearch === true;
    const search = request.contentType === "key-point"
        || request.activeExternalSearch !== true && request.autoExternalSearch === false
        || !_legacySearchEnabled && !explicitlyEnabled ? "off"
        : request.activeExternalSearch === true ? "required" : "allowed";
    const envelope: RequestEnvelope = {
        requestId, tenantScope: "authenticated-workspace", sessionId: null, turnId: requestId,
        parentAnswerId: request.parentLinkId ?? null, receivedAt: capturedAt, timezone: "UTC",
        questionText: request.title, questionRef: whole("question"),
        selectionRefs: blocks.filter(item => item.role === "selection").map(item => whole(item.id)),
        articleContextRefs: blocks.filter(item => item.role === "article_context").map(item => whole(item.id)),
        conversationRefs: blocks.filter(item => item.role === "prior_user").map(item => whole(item.id)),
        attachmentRefs: [], blocks,
        options: { externalSearch: search, knowledgeMode: request.contentType === "key-point" ? "provided_only" : "mixed",
            language: "zh", requestedAsOf: null, requestedLength: null, privacyMode: "standard" }
    };
    // Unbounded counters are explicit sentinels, not artificial output ceilings.
    // Budget, cancellation, provider capacity and the operational deadline govern execution.
    const unbounded = Number.MAX_SAFE_INTEGER;
    const task: TaskContract = {
        schemaVersion: "1.0", request: freeze(envelope),
        policy: freeze({ policyVersion: READWEAVE_TASK_POLICY_VERSION, writerRoute: "unified",
            budget: { currency: "CNY", unit: "micro-CNY", hardLimit: 100_000, writerReserve: 0,
                maxModelCalls: unbounded, maxSearchRequests: unbounded, maxRetrievalWaves: unbounded,
                maxPageFetches: unbounded, maxRepairCalls: unbounded, maxToolCalls: unbounded,
                maxBilledInputTokens: unbounded, maxBilledOutputTokens: unbounded,
                deadlineAt: new Date(now.getTime() + 10 * 60_000).toISOString(), priceSnapshotId },
            permissions: { externalSearch: search, externalModelProcessing: true,
                allowedCapabilities: search === "off" ? [] : ["search", "page_read"],
                allowSideEffects: false, redactQueries: false, allowedSourceScopes: ["provided", "public"] },
            answerPolicy: { unknownIntent: "continue", evidenceGap: "limit_only_affected_claims", classifierMayRefuse: false,
                requireCitationForExternalClaims: true, preserveOriginalQuestion: true, preserveSelections: true },
            safety: { decisionId: `${requestId}:policy`, basis: "independent_policy_on_original_request", restrictions: [] } }),
        rootRequirement: freeze({ id: "root", instruction: request.title, origin: whole("question"), owner: "server" }),
        interpretation: { status: "not_needed", proposal: { tasks: [] }, producer: "deterministic_fallback", diagnostics: [] },
        runtime: { evidence: [], claims: [], taskResults: [], projection: null, events: [], answerBlocks: [],
            usage: { inputTokens: 0, cachedInputTokens: 0, outputTokensIncludingReasoning: 0, modelCalls: 0,
                searchRequests: 0, retrievalWaves: 0, pageFetches: 0, upperBoundReservedMicroCny: 0,
                knownChargedMicroCny: 0, unsettledMicroCny: 0, wallTimeMs: 0, priceSnapshotId } },
        compatibility: { legacyTaskId: null, legacyCategoryReadOnly: null, legacyPayloadRef: null,
            lossWarnings: ["来源版本为捕获内容散列，不冒充文章数据库修订号", "旧版请求仅提供文本，未声明读取原始图像或表格对象"] }
    };
    task.interpretation.proposal = fallbackReadWeaveProposal(task);
    recordReadWeaveTaskEvent(task, "capture", "ok", "original-request-captured");
    return task;
}

export function fallbackReadWeaveProposal(task: TaskContract): SemanticProposal {
    return { tasks: [{ id: "answer-root", instruction: task.rootRequirement.instruction,
        intentHints: [], subjectIds: [], requirementIds: ["root"], originRefs: [task.request.questionRef],
        dependsOnTaskIds: [], expectedDeliverable: "直接完整回答原问题", acceptanceCriteria: ["逐项回答用户明确要求"], scope: "original-request" }] };
}

/** Host locators must be checked against captured material, not trusted because they parse. */
export function readWeaveInputRefValid(ref: InputRef, request: RequestEnvelope): boolean {
    const block = request.blocks.find(item => item.id === ref.blockId);
    if (!block) return false;
    return textLocatorValid(ref.locator, block.text);
}

function textLocatorValid(locator: Locator, text: string | null): boolean {
    if (locator.kind === "whole") return true;
    if (locator.kind === "text") {
        if (text === null || locator.offsetUnit !== "utf16-code-unit"
            || !Number.isSafeInteger(locator.start) || !Number.isSafeInteger(locator.end)
            || locator.start < 0 || locator.end <= locator.start || locator.end > text.length) return false;
        const splitsSurrogate = (offset: number) => offset > 0 && offset < text.length
            && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]);
        return !splitsSurrogate(locator.start) && !splitsSurrogate(locator.end)
            && text.slice(locator.start, locator.end) === locator.quote;
    }
    // The current capture adapter has no authoritative DOM/table/region index.
    // Keep original attachments available, but do not accept invented precise anchors.
    return false;
}

function cycleIssues(nodes: Array<{ id: string; deps: string[] }>, name: string): string[] {
    const known = new Set(nodes.map(node => node.id));
    // A missing endpoint is a dangling reference, not evidence of a dependency cycle.
    const pending = new Map(nodes.map(node => [node.id, new Set(node.deps.filter(id => known.has(id)))]));
    const dependents = new Map<string, Set<string>>();
    for (const [id, deps] of pending) for (const dependency of deps) {
        if (!dependents.has(dependency)) dependents.set(dependency, new Set());
        dependents.get(dependency)!.add(id);
    }
    const ready = [...pending].filter(([, deps]) => !deps.size).map(([id]) => id);
    for (let index = 0; index < ready.length; index++) {
        const id = ready[index];
        pending.delete(id);
        for (const dependent of dependents.get(id) ?? []) {
            const deps = pending.get(dependent);
            if (deps?.delete(id) && !deps.size) ready.push(dependent);
        }
    }
    return pending.size ? [`cycle:${name}`] : [];
}

function referenceIssues(proposal: SemanticProposal, request: RequestEnvelope): string[] {
    const issues: string[] = [];
    const groups = { subject: proposal.subjects ?? [], requirement: proposal.requirements ?? [], task: proposal.tasks,
        need: proposal.evidenceNeeds ?? [], step: proposal.reasoning ?? [], assumption: proposal.assumptions ?? [], ambiguity: proposal.ambiguities ?? [] };
    const allIds = new Set<string>(["root"]);
    for (const [kind, items] of Object.entries(groups)) for (const item of items) {
        if (allIds.has(item.id)) issues.push(`duplicate-id:${kind}:${item.id}`);
        allIds.add(item.id);
    }
    const ids = (kind: keyof typeof groups) => new Set(groups[kind].map(item => item.id));
    const check = (values: string[], valid: Set<string>, field: string) => {
        for (const value of values) if (!valid.has(value)) issues.push(`dangling:${field}:${value}`);
    };
    const refs = (values: InputRef[]) => {
        for (const value of values) if (!readWeaveInputRefValid(value, request)) issues.push(`invalid-input-ref:${value.blockId}`);
    };
    for (const subject of groups.subject) {
        refs(subject.mentions);
        if (subject.introducedByTaskId) check([subject.introducedByTaskId], ids("task"), "introducedByTaskId");
        if (!subject.mentions.length && !subject.introducedByTaskId) issues.push(`unanchored-subject:${subject.id}`);
    }
    for (const requirement of groups.requirement) {
        refs(requirement.originRefs);
        if (!requirement.originRefs.length) issues.push(`unanchored-requirement:${requirement.id}`);
    }
    for (const task of groups.task) {
        check(task.subjectIds, ids("subject"), "task.subjectIds");
        check(task.requirementIds, new Set(["root", ...ids("requirement")]), "task.requirementIds");
        check(task.dependsOnTaskIds, ids("task"), "task.dependsOnTaskIds");
        refs(task.originRefs);
        if (!task.originRefs.length || !task.instruction.trim()) issues.push(`unanchored-task:${task.id}`);
    }
    for (const need of groups.need) {
        check(need.taskIds, ids("task"), "need.taskIds"); check(need.subjectIds, ids("subject"), "need.subjectIds"); refs(need.originRefs);
        if (!need.taskIds.length || !need.originRefs.length || !need.questionToResolve.trim()) issues.push(`unanchored-need:${need.id}`);
    }
    for (const step of groups.step) {
        check(step.taskIds, ids("task"), "step.taskIds"); check(step.inputNeedIds, ids("need"), "step.inputNeedIds");
        check(step.dependsOnStepIds, ids("step"), "step.dependsOnStepIds");
    }
    for (const assumption of groups.assumption) { check(assumption.taskIds, ids("task"), "assumption.taskIds"); refs(assumption.basisRefs); }
    for (const ambiguity of groups.ambiguity) {
        refs(ambiguity.originRefs);
        for (const alternative of ambiguity.alternatives) { check(alternative.subjectIds, ids("subject"), "alternative.subjectIds"); refs(alternative.supportRefs); }
    }
    for (const binding of proposal.contextBindings ?? []) { refs([binding.inputRef]); check(binding.taskIds, ids("task"), "binding.taskIds"); }
    if (proposal.answerPlan) check(proposal.answerPlan.orderedTaskIds, ids("task"), "answerPlan.orderedTaskIds");
    issues.push(...cycleIssues(groups.task.map(task => ({ id: task.id, deps: task.dependsOnTaskIds })), "tasks"),
        ...cycleIssues(groups.step.map(step => ({ id: step.id, deps: step.dependsOnStepIds })), "reasoning"));
    return issues;
}

/** No object spread from model JSON into a policy/request. Invalid suggestions are disposable. */
export function adoptReadWeaveProposal(task: TaskContract, value: unknown): boolean {
    let diagnostics: string[];
    if (!validateProposal(value)) {
        diagnostics = (validateProposal.errors ?? []).map(error => `schema:${error.instancePath}:${error.keyword}`);
    } else diagnostics = referenceIssues(value as SemanticProposal, task.request);
    if (diagnostics.length) {
        task.interpretation = { status: "fallback", proposal: fallbackReadWeaveProposal(task),
            producer: "deterministic_fallback", diagnostics };
        recordReadWeaveTaskEvent(task, "interpret", "degraded", "proposal-discarded");
        return false;
    }
    task.interpretation = { status: "accepted", proposal: freeze(structuredClone(value as SemanticProposal)),
        producer: "existing_call", diagnostics: ["结构与引用已验证，未据此宣称语义完整或事实正确"] };
    recordReadWeaveTaskEvent(task, "interpret", "ok", "proposal-validated");
    return true;
}

/** Reuse compact legacy planning fields without granting them execution authority. */
export function proposalFromReadWeavePlan(task: TaskContract, plan: {
    objective?: string; answerRequirements?: unknown; exclusions?: unknown; searchQueries?: unknown;
}): SemanticProposal {
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
    const proposal = fallbackReadWeaveProposal(task);
    const queries = strings(plan.searchQueries);
    proposal.answerPlan = { objective: plan.objective || task.rootRequirement.instruction,
        requiredPoints: strings(plan.answerRequirements), exclusions: strings(plan.exclusions),
        orderedTaskIds: ["answer-root"], contextUse: "用完整文章消歧，不把背景对象替代问题目标" };
    proposal.evidenceNeeds = queries.map((query, index) => ({ id: `need-${index}`, taskIds: ["answer-root"], subjectIds: [],
        questionToResolve: query, candidateClaim: null, originRefs: [task.request.questionRef],
        whyNeeded: "补充原问题需要的直接资料", sourcePreferences: [], queryCandidates: [query],
        freshness: { timeIntent: "unspecified", asOf: null, maxAgeSecondsHint: null, versionHint: null },
        necessity: "helpful", alternativeIfMissing: "只限定未证实的具体事实，继续完成原问题其他部分" }));
    return proposal;
}

/** Materialize traceable needs without giving model hints execution permissions. */
export function ensureReadWeaveEvidenceNeeds(task: TaskContract, queries: string[]): void {
    if (task.interpretation.proposal.evidenceNeeds?.length || task.policy.permissions.externalSearch === "off") return;
    const proposal = structuredClone(task.interpretation.proposal);
    if (!proposal.tasks.length) proposal.tasks = fallbackReadWeaveProposal(task).tasks;
    const fallback = proposalFromReadWeavePlan(task, { searchQueries: queries.length ? queries : [task.request.questionText] });
    proposal.evidenceNeeds = fallback.evidenceNeeds?.map(need => ({ ...need, taskIds: proposal.tasks.map(item => item.id) }));
    task.interpretation.proposal = freeze(proposal);
}

export function recordReadWeaveTaskEvent(task: TaskContract, stage: ExecutionEvent["stage"], status: ExecutionEvent["status"], reasonCode: string): void {
    task.runtime.events.push({ eventId: `${task.request.requestId}:${task.runtime.events.length}`, stage, status,
        occurredAt: new Date().toISOString(), reasonCode, modelCallId: null, toolCallId: null,
        // Capture/interpretation precede execution and their disposable task IDs
        // may be replaced. Do not leave historical references to discarded hints.
        chargedMicroCny: 0, relatedTaskIds: stage === "capture" || stage === "interpret" ? []
            : task.interpretation.proposal.tasks.map(item => item.id), relatedNeedIds: [],
        configVersion: task.policy.policyVersion });
}

export function readWeaveTaskWriterGuidance(task: TaskContract): string {
    // kindHints, safety, budget, source roles and server internals do not become model instructions.
    const proposal = task.interpretation.proposal;
    return JSON.stringify({ originalQuestion: task.request.questionText,
        rootRequirement: task.rootRequirement.instruction,
        advisory: { subjects: proposal.subjects?.map(({ id, surface, role, interpretation, mentions }) => ({ id, surface, role, interpretation, mentions })),
            tasks: proposal.tasks.map(({ id, instruction, expectedDeliverable, acceptanceCriteria, dependsOnTaskIds }) =>
                ({ id, instruction, expectedDeliverable, acceptanceCriteria, dependsOnTaskIds })),
            evidenceNeeds: proposal.evidenceNeeds?.map(({ id, questionToResolve, alternativeIfMissing }) => ({ id, questionToResolve, alternativeIfMissing })),
            assumptions: proposal.assumptions, ambiguities: proposal.ambiguities, answerPlan: proposal.answerPlan },
        authority: "原问题优先；规划是可能漏项或错误的建议，必须独立核对原问题，不以建议中的标签或缺证为整题拒答依据" });
}

export interface ReadWeaveProjectedContent {
    ref: InputRef;
    /** Actual text sent for this origin, after normalization or other transformation. */
    text: string;
}

/** Optional mappings are server-owned projection output, never model-proposed coverage.
 * Without mappings, confirm exact text only; unavailable/normalized coverage is unknown.
 * Even a mapped string must occur in the actual writer input before its ref is included. */
export function recordReadWeaveProjection(task: TaskContract, input: string, system: string,
    projectedContent?: readonly ReadWeaveProjectedContent[]): void {
    const strings: string[] = [];
    const collect = (value: unknown): void => {
        if (typeof value === "string") strings.push(value);
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    try { collect(JSON.parse(input)); } catch { strings.push(input); }
    const transmitted = (text: string) => !!text.trim() && strings.some(value => value.includes(text));
    const warnings = task.request.blocks.filter(block => block.extraction.status === "partial" || block.extraction.status === "unavailable")
        .flatMap(block => [`${block.id}:${block.extraction.status}`, ...block.extraction.warnings]);
    const candidates = projectedContent ?? task.request.blocks.filter(block => block.text !== null)
        .map(block => ({ ref: whole(block.id), text: block.text! }));
    const includedRefs: InputRef[] = [];
    for (const candidate of candidates) {
        if (!readWeaveInputRefValid(candidate.ref, task.request)) {
            warnings.push(`invalid-projection-origin:${candidate.ref.blockId}`);
            continue;
        }
        if (!transmitted(candidate.text)) {
            warnings.push(`not-confirmed-in-writer-input:${candidate.ref.blockId}`);
            continue;
        }
        const original = candidate.ref.locator.kind === "text" ? candidate.ref.locator.quote
            : task.request.blocks.find(block => block.id === candidate.ref.blockId)!.text;
        if (original !== candidate.text) warnings.push(`transformed-projection:${candidate.ref.blockId}:not-verbatim`);
        if (!includedRefs.some(ref => sameRef(ref, candidate.ref))) includedRefs.push(structuredClone(candidate.ref));
    }
    const omittedRefs: InputRef[] = [];
    for (const block of task.request.blocks) {
        const refs = includedRefs.filter(ref => ref.blockId === block.id);
        if (refs.some(ref => ref.locator.kind === "whole")) continue;
        if (!refs.length || block.text === null) {
            omittedRefs.push(whole(block.id));
            warnings.push(`projection-coverage-unconfirmed:${block.id}`);
            continue;
        }
        const ranges = refs.flatMap(ref => ref.locator.kind === "text" ? [ref.locator] : []).sort((a, b) => a.start - b.start);
        let end = 0;
        const omit = (start: number, stop: number) => {
            if (stop > start) omittedRefs.push({ blockId: block.id, locator: { kind: "text", start, end: stop,
                quote: block.text!.slice(start, stop), offsetUnit: "utf16-code-unit" } });
        };
        for (const range of ranges) { omit(end, range.start); end = Math.max(end, range.end); }
        omit(end, block.text.length);
    }
    task.runtime.projection = { includedRefs, omittedRefs, lossWarnings: [...new Set(warnings)],
        billedTokenEstimate: readWeaveEstimatedInputTokens(system + input), projectionVersion: "observed-writer-text-v2" };
}

function sameRef(left: InputRef, right: InputRef): boolean {
    return left.blockId === right.blockId && (left.locator.kind === "whole" && right.locator.kind === "whole"
        || left.locator.kind === "text" && right.locator.kind === "text"
            && left.locator.start === right.locator.start && left.locator.end === right.locator.end);
}

export function completeReadWeaveTask(task: TaskContract, body: string, sources: ReadWeaveEvidenceSource[], claims: ReadWeaveClaim[],
    usage: ReadWeaveUsageSummary, budget: ReadWeaveBudget): void {
    const taskIds = task.interpretation.proposal.tasks.map(item => item.id);
    task.runtime.evidence = sources.map(source => ({ id: source.sourceId, kind: source.sourceType === "local" ? "provided" : "external",
        needIds: (source as ReadWeaveEvidenceSource & { needIds?: string[] }).needIds ?? [],
        inputRefs: task.request.blocks.filter(block => block.text === source.excerpt).map(block => whole(block.id)),
        title: source.title, url: source.url ?? null, publisher: null, retrievedAt: source.accessedAt,
        publishedAt: source.publishedAt && Number.isFinite(Date.parse(source.publishedAt)) ? new Date(source.publishedAt).toISOString() : null,
        eventTime: null, sourceVersion: null, access: source.retrievalMode === "page-reader" ? "excerpt" : source.sourceType === "local" ? "full" : "snippet",
        contentText: source.excerpt, blobRef: null, contentHash: readWeaveContentHash(source.excerpt),
        independenceGroup: (() => { try { return source.url ? new URL(source.url).hostname : null; } catch { return null; } })(), transportRecordId: `${task.request.requestId}:${source.sourceId}`,
        instructionAuthority: "none", licenseId: null, usageRestriction: null, sourceWarnings: [] }));
    const sourceIndex = new Map(task.runtime.evidence.map(source => [source.id, source]));
    task.runtime.claims = claims.map(claim => {
        const cited = claim.sourceIds.map(id => sourceIndex.get(id));
        const citationIssues = claim.sourceIds.flatMap(id => {
            const source = sourceIndex.get(id);
            return !source ? [`citation-missing:${id}`]
                : source.access === "unavailable" || !source.contentText.trim() ? [`citation-unavailable:${id}`] : [];
        });
        return { id: claim.claimId, taskIds: [], statement: claim.text,
            // Unknown citations must not be relabeled as provided evidence.
            basis: claim.sourceIds.length ? cited.every(source => source?.kind === "provided") ? "provided" : "external" : "parametric",
            evidenceIds: [...claim.sourceIds], premiseClaimIds: [], status: claim.unresolved ? "unresolved" : "not_checked",
            assessedBy: "writer", asOf: null,
            qualifiers: citationIssues.length ? citationIssues : claim.sourceIds.length ? ["citation-links-valid; factual-support-not-checked"] : [],
            answerSpan: null };
    });
    task.runtime.answerBlocks = [{ id: "answer", mimeType: "text/markdown", content: body, taskIds, claimIds: claims.map(claim => claim.claimId) }];
    // A generated block is not proof all tasks were addressed. Independent evaluation owns that result.
    task.runtime.taskResults = [];
    const priceIds = [...new Set(budget.snapshot().receipts.flatMap(receipt =>
        [receipt.priceSnapshot?.priceSnapshotId, receipt.settlementPriceSnapshot?.priceSnapshotId]
            .filter((id): id is string => Boolean(id))))].sort();
    const effectivePriceId = priceIds.length > 1 ? `readweave-price-set-v1:${readWeaveContentHash(JSON.stringify(priceIds))}`
        : priceIds[0] ?? task.policy.budget.priceSnapshotId;
    task.runtime.usage = { ...task.runtime.usage, inputTokens: usage.inputTokens, cachedInputTokens: usage.cacheHitInputTokens,
        priceSnapshotId: effectivePriceId,
        outputTokensIncludingReasoning: usage.outputTokens, modelCalls: usage.modelCalls,
        upperBoundReservedMicroCny: Math.ceil(budget.upperBoundCny * 1e6),
        knownChargedMicroCny: Math.round(budget.knownCostCny * 1e6),
        unsettledMicroCny: budget.snapshot().receipts.filter(receipt => receipt.settledMicros === undefined)
            .reduce((total, receipt) => total + receipt.reservedMicros, 0), wallTimeMs: Date.now() - Date.parse(task.request.receivedAt) };
    recordReadWeaveTaskEvent(task, "publish", "ok", "draft-produced-coverage-not-self-certified");
}

export function readWeaveTaskContractIssues(value: unknown): string[] {
    if (!validateContract(value)) return (validateContract.errors ?? []).map(error => `schema:${error.instancePath}:${error.keyword}`);
    const contract = value as TaskContract;
    const issues = referenceIssues(contract.interpretation.proposal, contract.request);
    const { request, runtime, interpretation: { proposal } } = contract;
    const unique = (values: string[], name: string): Set<string> => {
        const seen = new Set<string>();
        for (const id of values) {
            if (seen.has(id)) issues.push(`duplicate-id:${name}:${id}`);
            seen.add(id);
        }
        return seen;
    };
    const check = (values: string[], valid: Set<string>, field: string) => {
        for (const id of values) if (!valid.has(id)) issues.push(`dangling:${field}:${id}`);
    };
    const refs = (values: InputRef[], field: string) => {
        for (const ref of values) if (!readWeaveInputRefValid(ref, request)) issues.push(`invalid-input-ref:${field}:${ref.blockId}`);
    };
    unique(request.blocks.map(block => block.id), "block");
    const taskIds = new Set(proposal.tasks.map(task => task.id));
    const needIds = new Set(proposal.evidenceNeeds?.map(need => need.id));
    const evidenceIds = unique(runtime.evidence.map(source => source.id), "evidence");
    const claimIds = unique(runtime.claims.map(claim => claim.id), "claim");
    const answerIds = unique(runtime.answerBlocks.map(block => block.id), "answerBlock");
    unique(runtime.events.map(event => event.eventId), "event");
    unique(runtime.taskResults.map(result => result.taskId), "taskResult");
    refs([request.questionRef], "questionRef");
    refs(request.selectionRefs, "selectionRefs");
    refs(request.articleContextRefs, "articleContextRefs");
    refs(request.conversationRefs, "conversationRefs");
    refs(request.attachmentRefs, "attachmentRefs");
    refs([contract.rootRequirement.origin], "root.origin");
    refs(contract.policy.safety.restrictions.flatMap(restriction => restriction.scopeRef ? [restriction.scopeRef] : []), "safety.scopeRef");
    if (!sameRef(contract.rootRequirement.origin, request.questionRef)) issues.push("root-origin-mismatch");
    if (contract.rootRequirement.instruction !== contract.request.questionText) issues.push("root-question-mismatch");
    const questionText = request.questionRef.locator.kind === "text" ? request.questionRef.locator.quote
        : request.blocks.find(block => block.id === request.questionRef.blockId)?.text;
    if (questionText !== request.questionText) issues.push("question-block-mismatch");
    for (const block of contract.request.blocks) if (block.text !== null && readWeaveContentHash(block.text) !== block.contentHash) issues.push(`hash-mismatch:${block.id}`);
    for (const source of runtime.evidence) {
        check(source.needIds, needIds, "evidence.needIds");
        refs(source.inputRefs, `evidence.${source.id}.inputRefs`);
        if (readWeaveContentHash(source.contentText) !== source.contentHash) issues.push(`hash-mismatch:evidence:${source.id}`);
        // transportRecordId points to an external transport log, not an ExecutionEvent ID.
    }
    const evidence = new Map(runtime.evidence.map(source => [source.id, source]));
    for (const claim of runtime.claims) {
        check(claim.taskIds, taskIds, "claim.taskIds");
        check(claim.evidenceIds, evidenceIds, "claim.evidenceIds");
        check(claim.premiseClaimIds, claimIds, "claim.premiseClaimIds");
        // Citation validity is checked for ALL statuses. Neither a valid citation nor
        // a well-formed reference upgrades not_checked into factual support.
        if (claim.basis === "external" && contract.policy.answerPolicy.requireCitationForExternalClaims && !claim.evidenceIds.length)
            issues.push(`missing-external-citation:${claim.id}`);
        for (const id of claim.evidenceIds) {
            const source = evidence.get(id);
            if (source && (source.access === "unavailable" || !source.contentText.trim())) issues.push(`unavailable-citation:${claim.id}:${id}`);
        }
        if (claim.status === "supported" && ["provided", "external", "tool_result"].includes(claim.basis) && !claim.evidenceIds.length)
            issues.push(`unsupported-evidence-basis:${claim.id}`);
        if (claim.answerSpan && !runtime.answerBlocks.some(block => block.claimIds.includes(claim.id)
            && textLocatorValid(claim.answerSpan!, block.content))) issues.push(`invalid-answer-span:${claim.id}`);
    }
    issues.push(...cycleIssues(runtime.claims.map(claim => ({ id: claim.id, deps: claim.premiseClaimIds })), "claims"));
    for (const result of runtime.taskResults) {
        check([result.taskId], taskIds, "taskResult.taskId");
        check(result.answerBlockIds, answerIds, "taskResult.answerBlockIds");
        check(result.claimIds, claimIds, "taskResult.claimIds");
    }
    for (const block of runtime.answerBlocks) {
        check(block.taskIds, taskIds, "answerBlock.taskIds");
        check(block.claimIds, claimIds, "answerBlock.claimIds");
    }
    for (const event of runtime.events) {
        check(event.relatedTaskIds, taskIds, "event.relatedTaskIds");
        check(event.relatedNeedIds, needIds, "event.relatedNeedIds");
    }
    if (runtime.projection) {
        const { includedRefs, omittedRefs } = runtime.projection;
        refs(includedRefs, "projection.includedRefs");
        refs(omittedRefs, "projection.omittedRefs");
        for (const included of includedRefs) for (const omitted of omittedRefs) {
            if (included.blockId !== omitted.blockId) continue;
            const a = included.locator, b = omitted.locator;
            if (a.kind === "whole" || b.kind === "whole" || a.kind === "text" && b.kind === "text" && a.start < b.end && b.start < a.end)
                issues.push(`contradictory-projection:${included.blockId}`);
        }
    }
    return issues;
}
