export const READWEAVE_SCHEMA_VERSION = "1.0" as const;

export type ReadWeaveObjectKind = "question" | "term";
export type ReadWeaveEditMode = "global" | "article-variant" | "display-only";
export type ReadWeaveContextRole = "selected" | "heading" | "previous" | "next" | "document";

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
}

export interface ReadWeaveObject {
    schemaVersion: typeof READWEAVE_SCHEMA_VERSION;
    objectId: string;
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    normalizedTitle: string;
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
    objectId: string;
    sourceExcerpt: string;
    displayTitle?: string;
    displayBody?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReadWeaveResolvedEntry {
    linkId: string;
    articleId: string;
    anchorId: string;
    objectId: string;
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    canonicalTitle: string;
    canonicalBody: string;
    revision: number;
    isDisplayOverride: boolean;
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
    kind: ReadWeaveObjectKind;
    title: string;
    fragments: ReadWeaveContextFragment[];
    characterBudget?: number;
}

export interface ReadWeaveGenerateResponse {
    body: string;
    context: ReadWeaveContextDecision;
    provider: string;
    model: string;
}

export interface ReadWeaveSaveRequest {
    articleId: string;
    anchorId: string;
    kind: ReadWeaveObjectKind;
    title: string;
    body: string;
    sourceExcerpt: string;
    reuseObjectId?: string;
}

export interface ReadWeaveEditRequest {
    mode: ReadWeaveEditMode;
    title: string;
    body: string;
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
        selector: { type: "readweave-paragraph-v1"; value: string };
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
