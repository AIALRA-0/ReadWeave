export const READWEAVE_SCHEMA_VERSION = "1.1" as const;
export const READWEAVE_LEGACY_SCHEMA_VERSION = "1.0" as const;

export type ReadWeaveObjectKind = "question" | "term";
export type ReadWeaveEditMode = "global" | "article-variant" | "display-only";
export type ReadWeaveAnchorType = "paragraph" | "range";
export type ReadWeaveCalloutType = "note" | "tip" | "important" | "warning" | "caution";
export type ReadWeaveContextRole = "selected" | "heading" | "previous" | "next" | "section" | "document";

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
    budgetCny: number;
    withinBudget: boolean;
}

export type ReadWeaveGenerationStage = "queued" | "optimizing" | "gathering-context" | "drafting" | "checking" | "repairing" | "expanding-context" | "complete" | "failed";

export type ReadWeaveGenerationIssueCategory = "format" | "entity" | "evidence" | "integrity" | "other";

export interface ReadWeaveGenerationIssue {
    code: string;
    category: ReadWeaveGenerationIssueCategory;
    message: string;
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
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    parentLinkId?: string;
    title: string;
    sourceExcerpt: string;
    status: "queued" | "running" | "complete" | "failed";
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
    parentLinkId?: string;
    rootSourceExcerpt?: string;
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
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
    reuseObjectId?: string;
}

export interface ReadWeaveEditRequest {
    mode: ReadWeaveEditMode;
    title: string;
    body: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    verifiedNonExpandableArtifact?: ReadWeaveVerifiedNonExpandableArtifact;
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
