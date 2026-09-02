export const READWEAVE_SCHEMA_VERSION = "1.2" as const;
export const READWEAVE_PREVIOUS_SCHEMA_VERSION = "1.1" as const;
export const READWEAVE_LEGACY_SCHEMA_VERSION = "1.0" as const;

export type ReadWeaveObjectKind = "question" | "term";
export type ReadWeaveEditMode = "global" | "article-variant" | "display-only";
export type ReadWeaveAnchorType = "paragraph" | "range";
export type ReadWeaveCalloutType = "note" | "tip" | "important" | "warning" | "caution";
export type ReadWeaveContextRole = "selected" | "heading" | "previous" | "next" | "section" | "document";
export type ReadWeaveQualityState = "legacy-unverified" | "verified" | "provisional";
export type ReadWeaveEvidenceState = "not-checked" | "local-only" | "externally-checked" | "conflicted" | "insufficient";
export type ReadWeaveFailureClass = "format" | "semantic" | "evidence" | "transport" | "configuration" | "budget" | "protected-session" | "cancelled" | "internal";

/**
 * A content-only locator for a range in a rendered article. It deliberately
 * contains no CSS selector or DOM path, so it can be persisted beside an
 * answer without making the article HTML mutable or executable.
 */
export interface ReadWeaveSourceLocator {
    version: 1;
    blockIndex: number;
    startOffset: number;
    endOffset: number;
    prefix: string;
    suffix: string;
}

export interface ReadWeaveTermIdentity {
    abbreviation?: string;
    chineseName?: string;
    englishName?: string;
}

export interface ReadWeaveVerifiedNonExpandableArtifact {
    originalName: string;
    entityType: "method" | "system" | "product";
}

export interface ReadWeaveContextFragment {
    id: string;
    role: ReadWeaveContextRole;
    text: string;
    distance?: number;
}

export interface ReadWeaveContextDecision {
    fragmentIds: string[];
    characterCount: number;
    characterBudget: number;
    expansionLevel: number;
    attemptedBudgets: number[];
}

export interface ReadWeaveWorkflowSummary {
    generationAttempts: number;
    validationPasses: number;
    contextExpansions: number;
    repairRounds: number;
    unchangedSegmentsVerified: boolean;
}

export interface ReadWeaveUsageSummary {
    modelCalls: number;
    inputTokens: number;
    cacheHitInputTokens: number;
    cacheMissInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCny: number;
    targetCny: number;
    budgetCny: number;
    withinTarget: boolean;
    withinBudget: boolean;
}

export interface ReadWeaveQuestionContract {
    normalizedQuestion: string;
    objective: string;
    answerRequirements: string[];
    exclusions: string[];
    searchQueries: string[];
    requiresCurrentEvidence: boolean;
}

export interface ReadWeaveEvidenceSource {
    sourceId: string;
    sourceType: "local" | "external";
    provider: string;
    title: string;
    url?: string;
    excerpt: string;
    publishedAt?: string;
    accessedAt: string;
}

export interface ReadWeaveClaim {
    claimId: string;
    text: string;
    sourceIds: string[];
    confidence: "high" | "medium" | "low";
    unresolved?: boolean;
}

export interface ReadWeaveGenerationAudit {
    workflowVersion: "unified-evidence-v1" | "quality-closure-v2";
    harnessVersion?: string;
    qualityState?: ReadWeaveQualityState;
    evidenceState?: ReadWeaveEvidenceState;
    independentVerification?: "passed" | "failed" | "not-run";
    unresolvedIssues?: string[];
    questionContract: ReadWeaveQuestionContract;
    searchQueries: string[];
    unresolvedClaims: string[];
    validationIssues: string[];
    citationsVerified: boolean;
    generatedAt: string;
    manuallyEdited?: boolean;
}

export type ReadWeaveGenerationStage = "queued" | "optimizing" | "gathering-context" | "drafting" | "checking" | "repairing" | "expanding-context" | "complete" | "paused" | "cancelled" | "failed";

export type ReadWeaveGenerationIssueCategory = "format" | "entity" | "evidence" | "integrity" | "other";

export interface ReadWeaveGenerationIssue {
    code: string;
    category: ReadWeaveGenerationIssueCategory;
    message: string;
    severity?: "blocking" | "warning" | "info";
    recoverability?: "automatic" | "manual-review" | "retryable" | "terminal";
    segmentId?: string;
    entity?: string;
}

export interface ReadWeaveGenerationProgress {
    sequence?: number;
    timestamp?: string;
    elapsedMs?: number;
    stage: ReadWeaveGenerationStage;
    round: number;
    message: string;
    issues: string[];
    issueGroups?: ReadWeaveGenerationIssue[];
    repairedSegmentIds?: string[];
    unchangedSegmentsVerified?: boolean;
}

export interface ReadWeaveGenerationJob {
    jobId: string;
    draftId: string;
    savedLinkId?: string;
    stateVersion: number;
    activeAttemptId?: string;
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    parentLinkId?: string;
    title: string;
    sourceExcerpt: string;
    sourceLocator?: ReadWeaveSourceLocator;
    status: "queued" | "running" | "ready-for-review" | "saving" | "saved" | "paused" | "cancelled" | "failed";
    qualityState: ReadWeaveQualityState;
    harnessVersion: string;
    evidenceState: ReadWeaveEvidenceState;
    failureClass?: ReadWeaveFailureClass;
    issues: ReadWeaveGenerationIssue[];
    unresolvedIssues: string[];
    unread: boolean;
    feedback?: string;
    progress: ReadWeaveGenerationProgress[];
    result?: ReadWeaveGenerateResponse;
    error?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReadWeaveObject {
    schemaVersion: typeof READWEAVE_SCHEMA_VERSION;
    objectId: string;
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    normalizedTitle: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
    evidenceSources?: ReadWeaveEvidenceSource[];
    claims?: ReadWeaveClaim[];
    audit?: ReadWeaveGenerationAudit;
    qualityState?: ReadWeaveQualityState;
    revision: number;
    sourceArticleId: string;
    sourceAnchorId: string;
    sourceExcerpt: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReadWeaveLink {
    schemaVersion: typeof READWEAVE_SCHEMA_VERSION;
    linkId: string;
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    objectId: string;
    parentLinkId?: string;
    rootLinkId?: string;
    depth?: number;
    parentRevision?: number;
    sourceExcerpt: string;
    sourceLocator?: ReadWeaveSourceLocator;
    displayTitle?: string;
    displayBody?: string;
    displayCalloutType?: ReadWeaveCalloutType;
    createdAt: string;
    updatedAt: string;
}

export interface ReadWeaveResolvedEntry {
    linkId: string;
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    objectId: string;
    sourceLocator?: ReadWeaveSourceLocator;
    parentLinkId?: string;
    rootLinkId?: string;
    depth: number;
    parentStale?: boolean;
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
    evidenceSources?: ReadWeaveEvidenceSource[];
    claims?: ReadWeaveClaim[];
    audit?: ReadWeaveGenerationAudit;
    qualityState: ReadWeaveQualityState;
    canonicalTitle: string;
    canonicalBody: string;
    canonicalCalloutType: ReadWeaveCalloutType;
    revision: number;
    isDisplayOverride: boolean;
}

export interface ReadWeaveAnchorSummary {
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    excerpt: string;
    sourceLocator?: ReadWeaveSourceLocator;
    questionCount: number;
    termCount: number;
    entries: ReadWeaveResolvedEntry[];
}

export interface ReadWeaveCandidate {
    objectId: string;
    kind: ReadWeaveObjectKind;
    title: string;
    confidence: number;
    reuseRecommended: boolean;
    topicConfidence?: number;
    sameTopic?: boolean;
    intentMatch?: boolean;
}

export interface ReadWeaveImpact {
    objectId: string;
    linkCount: number;
    articleCount: number;
    childCount?: number;
    descendantCount?: number;
    articles: Array<{ articleId: string; title: string }>;
}

export interface ReadWeaveGenerateRequest {
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    calloutType?: ReadWeaveCalloutType;
    parentLinkId?: string;
    rootSourceExcerpt?: string;
    sourceLocator?: ReadWeaveSourceLocator;
    title: string;
    optimizeQuestion?: boolean;
    termIdentity?: Partial<ReadWeaveTermIdentity>;
    fragments: ReadWeaveContextFragment[];
    characterBudget?: number;
    feedback?: string;
}

export interface ReadWeaveGenerateResponse {
    body: string;
    optimizedTitle?: string;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
    evidenceSources?: ReadWeaveEvidenceSource[];
    claims?: ReadWeaveClaim[];
    audit?: ReadWeaveGenerationAudit;
    qualityState?: ReadWeaveQualityState;
    evidenceState?: ReadWeaveEvidenceState;
    harnessVersion?: string;
    unresolvedIssues?: string[];
    reviewIssues?: string[];
    context: ReadWeaveContextDecision;
    workflow: ReadWeaveWorkflowSummary;
    provider: string;
    model: string;
    usage?: ReadWeaveUsageSummary;
    webCalibration?: {
        used: true;
        sourceCount: number;
        model: string;
        providers?: string[];
        cacheHit?: boolean;
        searchCostCny?: number;
    };
}

export interface ReadWeaveSaveRequest {
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    parentLinkId?: string;
    title: string;
    body: string;
    sourceExcerpt: string;
    sourceLocator?: ReadWeaveSourceLocator;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
    evidenceSources?: ReadWeaveEvidenceSource[];
    claims?: ReadWeaveClaim[];
    audit?: ReadWeaveGenerationAudit;
    qualityState?: ReadWeaveQualityState;
    reuseObjectId?: string;
}

export interface ReadWeaveEditRequest {
    mode: ReadWeaveEditMode;
    title: string;
    body: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
    evidenceSources?: ReadWeaveEvidenceSource[];
    claims?: ReadWeaveClaim[];
    audit?: ReadWeaveGenerationAudit;
    qualityState?: ReadWeaveQualityState;
}

export interface ReadWeaveDeleteResult {
    deleted: true;
    linkId: string;
    objectId: string;
    objectDeleted: boolean;
    remainingLinkCount: number;
    deletedLinkIds?: string[];
    promotedLinkIds?: string[];
}

export interface ReadWeaveAiSettings {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    maskedApiKey?: string;
    credentialSource: "settings" | "environment" | "missing";
    searchMode: "off" | "automatic" | "always";
    searchBudgetCny: number;
    mathShortcut: string;
    verifier: {
        baseUrl: string;
        model: string;
        hasApiKey: boolean;
        maskedApiKey?: string;
        credentialSource: "settings" | "environment" | "missing";
        independent: boolean;
    };
    search: {
        freeProviders: string[];
        hasSerperApiKey: boolean;
        maskedSerperApiKey?: string;
        hasTavilyApiKey: boolean;
        maskedTavilyApiKey?: string;
        hasBraveApiKey: boolean;
        maskedBraveApiKey?: string;
        hasJinaApiKey: boolean;
        maskedJinaApiKey?: string;
        hasSemanticScholarApiKey: boolean;
        maskedSemanticScholarApiKey?: string;
        hasOpenAlexApiKey: boolean;
        maskedOpenAlexApiKey?: string;
        hasUnpaywallEmail: boolean;
        maskedUnpaywallEmail?: string;
    };
}

export interface ReadWeaveAiSettingsUpdate {
    baseUrl: string;
    model: string;
    apiKey?: string;
    clearApiKey?: boolean;
    searchMode?: "off" | "automatic" | "always";
    searchBudgetCny?: number;
    mathShortcut?: string;
    verifierBaseUrl?: string;
    verifierModel?: string;
    verifierApiKey?: string;
    clearVerifierApiKey?: boolean;
    serperApiKey?: string;
    clearSerperApiKey?: boolean;
    tavilyApiKey?: string;
    clearTavilyApiKey?: boolean;
    braveApiKey?: string;
    clearBraveApiKey?: boolean;
    jinaApiKey?: string;
    clearJinaApiKey?: boolean;
    semanticScholarApiKey?: string;
    clearSemanticScholarApiKey?: boolean;
    openAlexApiKey?: string;
    clearOpenAlexApiKey?: boolean;
    unpaywallEmail?: string;
    clearUnpaywallEmail?: boolean;
}

export interface ReadWeaveSearchTestResult {
    query: string;
    sourceCount: number;
    providers: string[];
    elapsedMs: number;
    cacheHit: boolean;
    searchCostCny: number;
    sources: Array<{
        provider: string;
        title: string;
        url: string;
        snippet: string;
    }>;
    warnings: string[];
}

export interface ReadWeaveModelInfo {
    id: string;
}

export type ReadWeaveHarnessStatus = "draft" | "trial" | "legacy-published" | "published" | "archived";

export interface ReadWeaveHarnessModules {
    questionNormalization: string;
    evidencePolicy: string;
    answerWriting: string;
    semanticRubric: string;
    formatRules: string;
}

export interface ReadWeaveHarnessCase {
    caseId: string;
    category: string;
    question: string;
    context?: string;
    expectedFacts: string[];
    forbiddenClaims: string[];
    critical: boolean;
    expectedIntent?: "identity" | "definition" | "form" | "mechanism" | "reason" | "comparison" | "calculation" | "boundary";
    badAnswer?: string;
    referenceAnswer?: string;
}

export interface ReadWeaveHarnessProfile {
    versionId: string;
    currentRevisionId: string;
    contentDigest: string;
    name: string;
    status: ReadWeaveHarnessStatus;
    parentVersionId?: string;
    modules: ReadWeaveHarnessModules;
    cases: ReadWeaveHarnessCase[];
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
    lastTrial?: ReadWeaveHarnessTrialResult;
}

export interface ReadWeaveHarnessRevision {
    revisionId: string;
    versionId: string;
    parentRevisionId?: string;
    contentDigest: string;
    modules: ReadWeaveHarnessModules;
    cases: ReadWeaveHarnessCase[];
    createdAt: string;
}

export interface ReadWeaveHarnessTrialJob {
    trialJobId: string;
    versionId: string;
    revisionId: string;
    contentDigest: string;
    status: "queued" | "running" | "passed" | "failed";
    completedCases: number;
    totalCases: number;
    result?: ReadWeaveHarnessTrialResult;
    error?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReadWeaveHarnessTrialResult {
    versionId: string;
    revisionId?: string;
    contentDigest?: string;
    passed: boolean;
    totalCases: number;
    passedCases: number;
    visibleCases: number;
    hiddenCases: number;
    hiddenFailedCases: number;
    failedCases: Array<{ caseId: string; issues: string[] }>;
}

export interface ReadWeaveExport {
    schemaVersion: typeof READWEAVE_SCHEMA_VERSION;
    exportId: string;
    exportedAt: string;
    generator: {
        name: "ReadWeave";
        version: string;
        triliumVersion: string;
        workflowVersion: string;
    };
    scope: {
        type: "all" | "articles";
        articleIds?: string[];
        includeContent: true;
    };
    articles: Array<{ articleId: string; title: string }>;
    anchors: Array<{
        anchorId: string;
        articleId: string;
        selector:
            | { type: "readweave-paragraph-v1"; value: string }
            | { type: "readweave-range-v1"; value: string; quote: string };
        excerpt: string;
        sourceLocator?: ReadWeaveSourceLocator;
    }>;
    objects: ReadWeaveObject[];
    links: ReadWeaveLink[];
    integrity: {
        valid: boolean;
        articleCount: number;
        anchorCount: number;
        objectCount: number;
        linkCount: number;
        contentSha256: string;
    };
}
