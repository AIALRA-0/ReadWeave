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

export type ReadWeaveGenerationStage = "optimizing" | "gathering-context" | "drafting" | "checking" | "repairing" | "expanding-context" | "complete";

export interface ReadWeaveGenerationProgress {
    stage: ReadWeaveGenerationStage;
    round: number;
    message: string;
    issues: string[];
    repairedSegmentIds?: string[];
    unchangedSegmentsVerified?: boolean;
}

export interface ReadWeaveGenerationJob {
    jobId: string;
    status: "running" | "complete" | "failed";
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
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
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
}

export interface ReadWeaveImpact {
    objectId: string;
    linkCount: number;
    articleCount: number;
    articles: Array<{ articleId: string; title: string }>;
}

export interface ReadWeaveGenerateRequest {
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    title: string;
    optimizeQuestion?: boolean;
    termIdentity?: Partial<ReadWeaveTermIdentity>;
    fragments: ReadWeaveContextFragment[];
    characterBudget?: number;
}

export interface ReadWeaveGenerateResponse {
    body: string;
    optimizedTitle?: string;
    termIdentity?: ReadWeaveTermIdentity;
    reviewIssues?: string[];
    context: ReadWeaveContextDecision;
    workflow: ReadWeaveWorkflowSummary;
    provider: string;
    model: string;
}

export interface ReadWeaveSaveRequest {
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveAnchorType;
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    sourceExcerpt: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
    reuseObjectId?: string;
}

export interface ReadWeaveEditRequest {
    mode: ReadWeaveEditMode;
    title: string;
    body: string;
    calloutType: ReadWeaveCalloutType;
    termIdentity?: ReadWeaveTermIdentity;
}

export interface ReadWeaveAiSettings {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    maskedApiKey?: string;
    credentialSource: "settings" | "environment" | "missing";
}

export interface ReadWeaveAiSettingsUpdate {
    baseUrl: string;
    model: string;
    apiKey?: string;
    clearApiKey?: boolean;
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
