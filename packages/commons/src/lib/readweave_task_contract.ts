// Generated from readweave-task-contract.schema.json.
// Validate untrusted JSON with Ajv 2020 + ajv-formats before treating it as these types.
// TypeScript types alone do not validate runtime JSON.

export type Locator = ({
  kind: "whole";
} | {
  kind: "text";
  start: number;
  end: number;
  offsetUnit: "utf16-code-unit";
  quote: string;
} | {
  kind: "node";
  anchorId: string;
  rangeAnchorId: (string | null);
} | {
  kind: "table";
  tableId: string;
  rowIds: Array<string>;
  columnIds: Array<string>;
} | {
  kind: "region";
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "normalized" | "pixel";
} | {
  kind: "pointer";
  pointer: string;
  format: string;
});

export type InputRef = {
  blockId: string;
  locator: Locator;
};

export type ContentBlock = {
  id: string;
  role: "question" | "selection" | "article_context" | "article_metadata" | "prior_user" | "prior_assistant" | "attachment";
  mimeType: string;
  text: (string | null);
  blobRef: (string | null);
  contentHash: string;
  sourceId: string;
  sourceVersion: string;
  sourceUrl: (string | null);
  capturedAt: string;
  extraction: {
  status: "original" | "extracted" | "partial" | "unavailable";
  method: (string | null);
  warnings: Array<string>;
};
  origin: {
  kind: "user" | "article" | "assistant" | "attachment";
  messageId: (string | null);
  parentAnswerId: (string | null);
};
  instructionAuthority: "none";
};

export type UserOptions = {
  externalSearch: "allowed" | "off" | "required";
  knowledgeMode: "mixed" | "provided_only";
  language: string;
  requestedAsOf: (string | null);
  requestedLength: (string | null);
  privacyMode: "standard" | "restricted";
};

export type RequestEnvelope = {
  requestId: string;
  tenantScope: string;
  sessionId: (string | null);
  turnId: string;
  parentAnswerId: (string | null);
  receivedAt: string;
  timezone: string;
  questionText: string;
  questionRef: InputRef;
  selectionRefs: Array<InputRef>;
  articleContextRefs: Array<InputRef>;
  conversationRefs: Array<InputRef>;
  attachmentRefs: Array<InputRef>;
  blocks: Array<ContentBlock>;
  options: UserOptions;
};

export type ServerPolicy = {
  policyVersion: string;
  writerRoute: "unified";
  budget: {
  currency: "CNY";
  unit: "micro-CNY";
  hardLimit: number;
  writerReserve: number;
  maxModelCalls: number;
  maxSearchRequests: number;
  maxRetrievalWaves: number;
  maxPageFetches: number;
  maxRepairCalls: number;
  maxToolCalls: number;
  maxBilledInputTokens: number;
  maxBilledOutputTokens: number;
  deadlineAt: string;
  priceSnapshotId: string;
};
  permissions: {
  externalSearch: "allowed" | "off" | "required";
  externalModelProcessing: boolean;
  allowedCapabilities: Array<string>;
  allowSideEffects: false;
  redactQueries: boolean;
  allowedSourceScopes: Array<string>;
};
  answerPolicy: {
  unknownIntent: "continue";
  evidenceGap: "limit_only_affected_claims";
  classifierMayRefuse: false;
  requireCitationForExternalClaims: boolean;
  preserveOriginalQuestion: true;
  preserveSelections: true;
};
  safety: {
  decisionId: string;
  basis: "independent_policy_on_original_request";
  restrictions: Array<{
  scopeRef: (InputRef | null);
  ruleId: string;
  instruction: string;
}>;
};
};

export type Subject = {
  id: string;
  surface: string;
  mentions: Array<InputRef>;
  kindHints: Array<string>;
  interpretation: string;
  aliases: Array<string>;
  role: "target" | "context" | "intermediate";
  introducedByTaskId: (string | null);
};

export type Requirement = {
  id: string;
  instruction: string;
  originRefs: Array<InputRef>;
  mustAddress: boolean;
};

export type Task = {
  id: string;
  instruction: string;
  intentHints: Array<string>;
  subjectIds: Array<string>;
  requirementIds: Array<string>;
  originRefs: Array<InputRef>;
  dependsOnTaskIds: Array<string>;
  expectedDeliverable: string;
  acceptanceCriteria: Array<string>;
  scope: string;
};

export type EvidenceNeed = {
  id: string;
  taskIds: Array<string>;
  subjectIds: Array<string>;
  questionToResolve: string;
  candidateClaim: (string | null);
  originRefs: Array<InputRef>;
  whyNeeded: string;
  sourcePreferences: Array<string>;
  queryCandidates: Array<string>;
  freshness: {
  timeIntent: string;
  asOf: (string | null);
  maxAgeSecondsHint: (number | null);
  versionHint: (string | null);
};
  necessity: "needed_for_specific_claim" | "helpful";
  alternativeIfMissing: string;
};

export type ReasoningStep = {
  id: string;
  taskIds: Array<string>;
  operation: string;
  inputNeedIds: Array<string>;
  dependsOnStepIds: Array<string>;
  capabilityHints: Array<string>;
  expectedResult: string;
  checks: Array<string>;
};

export type Assumption = {
  id: string;
  statement: string;
  taskIds: Array<string>;
  basisRefs: Array<InputRef>;
  consequenceIfFalse: string;
  mustDisclose: boolean;
};

export type Ambiguity = {
  id: string;
  originRefs: Array<InputRef>;
  alternatives: Array<{
  description: string;
  subjectIds: Array<string>;
  supportRefs: Array<InputRef>;
}>;
  handling: "use_context" | "answer_conditionally" | "cover_alternatives" | "ask_only_if_blocking";
  blockingReason: (string | null);
};

export type ContextBinding = {
  inputRef: InputRef;
  taskIds: Array<string>;
  purpose: string;
  relation: "disambiguation" | "evidence" | "background" | "counterevidence" | "example";
};

export type AnswerPlan = {
  objective: string;
  requiredPoints: Array<string>;
  exclusions: Array<string>;
  orderedTaskIds: Array<string>;
  contextUse: string;
};

export type SemanticProposal = {
  subjects?: Array<Subject>;
  requirements?: Array<Requirement>;
  tasks: Array<Task>;
  evidenceNeeds?: Array<EvidenceNeed>;
  reasoning?: Array<ReasoningStep>;
  assumptions?: Array<Assumption>;
  ambiguities?: Array<Ambiguity>;
  contextBindings?: Array<ContextBinding>;
  answerPlan?: AnswerPlan;
};

export type EvidenceItem = {
  id: string;
  kind: "provided" | "external" | "tool_result";
  needIds: Array<string>;
  inputRefs: Array<InputRef>;
  title: string;
  url: (string | null);
  publisher: (string | null);
  retrievedAt: string;
  publishedAt: (string | null);
  eventTime: (string | null);
  sourceVersion: (string | null);
  access: "full" | "excerpt" | "snippet" | "unavailable";
  contentText: string;
  blobRef: (string | null);
  contentHash: string;
  independenceGroup: (string | null);
  transportRecordId: string;
  instructionAuthority: "none";
  licenseId: (string | null);
  usageRestriction: (string | null);
  sourceWarnings: Array<string>;
};

export type ClaimAssessment = {
  id: string;
  taskIds: Array<string>;
  statement: string;
  basis: "provided" | "external" | "tool_result" | "parametric" | "inference" | "assumption";
  evidenceIds: Array<string>;
  premiseClaimIds: Array<string>;
  status: "supported" | "contradicted" | "unresolved" | "not_checked" | "not_applicable";
  assessedBy: "writer" | "checker" | "deterministic_tool" | "human";
  asOf: (string | null);
  qualifiers: Array<string>;
  answerSpan: (Locator | null);
};

export type TaskResult = {
  taskId: string;
  status: "addressed" | "partially_addressed" | "not_addressed";
  answerBlockIds: Array<string>;
  claimIds: Array<string>;
  unresolvedPoints: Array<string>;
  nextUsefulStep: (string | null);
};

export type PromptProjection = {
  includedRefs: Array<InputRef>;
  omittedRefs: Array<InputRef>;
  lossWarnings: Array<string>;
  billedTokenEstimate: number;
  projectionVersion: string;
};

export type ExecutionEvent = {
  eventId: string;
  stage: "capture" | "interpret" | "schedule" | "retrieve" | "tool" | "write" | "check" | "publish";
  status: "ok" | "skipped" | "degraded" | "failed";
  occurredAt: string;
  reasonCode: string;
  modelCallId: (string | null);
  toolCallId: (string | null);
  chargedMicroCny: number;
  relatedTaskIds: Array<string>;
  relatedNeedIds: Array<string>;
  configVersion: string;
};

export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokensIncludingReasoning: number;
  modelCalls: number;
  searchRequests: number;
  retrievalWaves: number;
  pageFetches: number;
  upperBoundReservedMicroCny: number;
  knownChargedMicroCny: number;
  unsettledMicroCny: number;
  wallTimeMs: number;
  priceSnapshotId: string;
};

export type AnswerBlock = {
  id: string;
  mimeType: string;
  content: string;
  taskIds: Array<string>;
  claimIds: Array<string>;
};

export type TaskContract = {
  schemaVersion: "1.0";
  request: RequestEnvelope;
  policy: ServerPolicy;
  rootRequirement: {
  id: "root";
  instruction: string;
  origin: InputRef;
  owner: "server";
};
  interpretation: {
  status: "accepted" | "fallback" | "not_needed";
  proposal: SemanticProposal;
  producer: "existing_call" | "deterministic_fallback" | "legacy_adapter";
  diagnostics: Array<string>;
};
  runtime: {
  evidence: Array<EvidenceItem>;
  claims: Array<ClaimAssessment>;
  taskResults: Array<TaskResult>;
  projection: (PromptProjection | null);
  events: Array<ExecutionEvent>;
  usage: Usage;
  answerBlocks: Array<AnswerBlock>;
};
  compatibility: {
  legacyTaskId: (string | null);
  legacyCategoryReadOnly: (string | null);
  legacyPayloadRef: (string | null);
  lossWarnings: Array<string>;
};
};
