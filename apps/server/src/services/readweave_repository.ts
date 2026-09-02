import {
    READWEAVE_LEGACY_SCHEMA_VERSION,
    READWEAVE_PREVIOUS_SCHEMA_VERSION,
    READWEAVE_SCHEMA_VERSION,
    type ReadWeaveAnchorSummary,
    type ReadWeaveAnchorType,
    type ReadWeaveCalloutType,
    type ReadWeaveDeleteResult,
    type ReadWeaveEditRequest,
    type ReadWeaveExport,
    type ReadWeaveImpact,
    type ReadWeaveLink,
    type ReadWeaveObject,
    type ReadWeaveQualityState,
    type ReadWeaveResolvedEntry,
    type ReadWeaveSaveRequest,
    type ReadWeaveSourceLocator,
    type ReadWeaveTermIdentity,
    type ReadWeaveVerifiedNonExpandableArtifact
} from "@triliumnext/commons";
import { becca, type BNote, note_service as noteService, NotFoundError, ValidationError } from "@triliumnext/core";
import crypto from "crypto";

import {
    formatReadWeaveTermIdentity,
    parseFormattedReadWeaveTermIdentity,
    validateReadWeaveTermIdentity
} from "./readweave_ai.js";
import { normalizeReadWeaveTitle } from "./readweave_engine.js";
import { newEntityId } from "./utils.js";

const OBJECTS_ROOT_ID = "_readweaveObjects";
const LINKS_ROOT_ID = "_readweaveLinks";
const CALLOUT_TYPES = new Set<ReadWeaveCalloutType>([ "note", "tip", "important", "warning", "caution" ]);

function now(): string {
    return new Date().toISOString();
}

function requireText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string") throw new ValidationError(`${field} must be a string.`);
    const result = value.replace(/\r\n/g, "\n").trim();
    if (!result) throw new ValidationError(`${field} is required.`);
    if (result.length > maxLength) throw new ValidationError(`${field} exceeds ${maxLength} characters.`);
    return result;
}

function requireId(value: unknown, field: string): string {
    const result = requireText(value, field, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new ValidationError(`${field} is invalid.`);
    return result;
}

function requireAnchorType(value: unknown): ReadWeaveAnchorType {
    if (value !== "paragraph" && value !== "range") throw new ValidationError("anchorType must be paragraph or range.");
    return value;
}

function requireCalloutType(value: unknown, kind: ReadWeaveObject["kind"]): ReadWeaveCalloutType {
    if (value === undefined) return kind === "term" ? "tip" : "note";
    if (!CALLOUT_TYPES.has(value as ReadWeaveCalloutType)) throw new ValidationError("Unknown ReadWeave visual type.");
    return value as ReadWeaveCalloutType;
}

function normalizeVerifiedNonExpandableArtifact(
    value: unknown,
    title: string
): ReadWeaveVerifiedNonExpandableArtifact | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("The verified non-expandable artifact metadata is invalid.");
    }
    const candidate = value as Partial<ReadWeaveVerifiedNonExpandableArtifact>;
    const originalName = typeof candidate.originalName === "string" ? candidate.originalName.normalize("NFKC").trim() : "";
    if (!originalName || originalName.length > 100
        || (candidate.entityType !== "method" && candidate.entityType !== "system" && candidate.entityType !== "product")) {
        throw new ValidationError("The verified non-expandable artifact metadata is invalid.");
    }
    const normalizedTitle = title.normalize("NFKC");
    const index = normalizedTitle.indexOf(originalName);
    const before = index > 0 ? normalizedTitle[index - 1] : "";
    const after = index >= 0 ? normalizedTitle[index + originalName.length] ?? "" : "";
    if (index < 0 || /[\p{Script=Latin}\p{N}_]/u.test(before) || /[\p{Script=Latin}\p{N}_]/u.test(after)) {
        throw new ValidationError("The verified non-expandable artifact must exactly match the current title or subject.");
    }
    return { originalName, entityType: candidate.entityType };
}

function parseLegacyTermTitle(title: string): ReadWeaveTermIdentity | undefined {
    const canonical = parseFormattedReadWeaveTermIdentity(title);
    if (canonical) return canonical;
    const oldFormat = title.match(/^([A-Za-z][A-Za-z0-9.+/-]{1,30})（([^，]+)，([A-Za-z][^）]+)）$/);
    if (!oldFormat) return undefined;
    try {
        return validateReadWeaveTermIdentity({ abbreviation: oldFormat[1], chineseName: oldFormat[2], englishName: oldFormat[3] });
    } catch {
        return undefined;
    }
}

function parseObject(note: BNote): ReadWeaveObject | null {
    if (!note.isContentAvailable()) return null;
    const value = note.getJsonContentSafely() as Partial<ReadWeaveObject> & { schemaVersion?: string } | null;
    if (!value || ![ READWEAVE_SCHEMA_VERSION, READWEAVE_PREVIOUS_SCHEMA_VERSION, READWEAVE_LEGACY_SCHEMA_VERSION ].includes(value.schemaVersion as never) || value.objectId !== note.noteId) return null;
    if (value.kind !== "question" && value.kind !== "term") return null;
    if (typeof value.title !== "string" || typeof value.body !== "string") return null;
    const termIdentity = value.kind === "term"
        ? (value.termIdentity ? (() => {
            try { return validateReadWeaveTermIdentity(value.termIdentity); } catch { return undefined; }
        })() : parseLegacyTermTitle(value.title))
        : undefined;
    const structuredTitle = termIdentity ? formatReadWeaveTermIdentity(termIdentity) : "";
    const title = structuredTitle || value.title;
    return {
        ...value,
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        qualityState: value.qualityState === "verified" || value.qualityState === "provisional"
            ? value.qualityState
            : "legacy-unverified",
        title,
        normalizedTitle: normalizeReadWeaveTitle(title),
        calloutType: requireCalloutType(value.calloutType, value.kind),
        termIdentity
    } as ReadWeaveObject;
}

function parseLink(note: BNote): ReadWeaveLink | null {
    if (!note.isContentAvailable()) return null;
    const value = note.getJsonContentSafely() as Partial<ReadWeaveLink> & { schemaVersion?: string } | null;
    if (!value || ![ READWEAVE_SCHEMA_VERSION, READWEAVE_PREVIOUS_SCHEMA_VERSION, READWEAVE_LEGACY_SCHEMA_VERSION ].includes(value.schemaVersion as never) || value.linkId !== note.noteId) return null;
    if (typeof value.articleId !== "string" || typeof value.anchorId !== "string" || typeof value.objectId !== "string") return null;
    return {
        ...value,
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        anchorType: value.anchorType === "range" ? "range" : "paragraph",
        depth: Number.isInteger(value.depth) && Number(value.depth) >= 0 && Number(value.depth) <= 5
            ? Number(value.depth)
            : 0,
        sourceExcerpt: typeof value.sourceExcerpt === "string" ? value.sourceExcerpt : "",
        sourceLocator: (() => {
            try { return normalizeSourceLocator(value.sourceLocator); } catch { return undefined; }
        })()
    } as ReadWeaveLink;
}

function listChildNotes(rootId: string): BNote[] {
    return becca.getNoteOrThrow(rootId).getChildNotes();
}

export function listReadWeaveObjects(): ReadWeaveObject[] {
    return listChildNotes(OBJECTS_ROOT_ID).map(parseObject).filter((value): value is ReadWeaveObject => !!value);
}

export function listReadWeaveLinks(): ReadWeaveLink[] {
    return listChildNotes(LINKS_ROOT_ID).map(parseLink).filter((value): value is ReadWeaveLink => !!value);
}

export function getReadWeaveObject(objectId: string): ReadWeaveObject {
    const note = becca.getNoteOrThrow(requireId(objectId, "objectId"));
    const object = parseObject(note);
    if (!object) throw new NotFoundError("ReadWeave object is unavailable.");
    return object;
}

function getReadWeaveLink(linkId: string): { note: BNote; link: ReadWeaveLink } {
    const note = becca.getNoteOrThrow(requireId(linkId, "linkId"));
    const link = parseLink(note);
    if (!link) throw new NotFoundError("ReadWeave link is unavailable.");
    return { note, link };
}

function normalizeAnchorExcerpt(value: string): string {
    return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeSourceLocator(value: unknown): ReadWeaveSourceLocator | undefined {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("sourceLocator is invalid.");
    }
    const candidate = value as Partial<ReadWeaveSourceLocator>;
    if (typeof candidate.prefix !== "string" || typeof candidate.suffix !== "string") {
        throw new ValidationError("sourceLocator is invalid.");
    }
    // Keep boundary whitespace: it is part of the normalized text context and
    // distinguishes a selection next to a space from one next to punctuation.
    const prefix = candidate.prefix.replace(/\s+/gu, " ");
    const suffix = candidate.suffix.replace(/\s+/gu, " ");
    if (candidate.version !== 1
        || !Number.isInteger(candidate.blockIndex) || Number(candidate.blockIndex) < 0 || Number(candidate.blockIndex) > 1_000_000
        || !Number.isInteger(candidate.startOffset) || Number(candidate.startOffset) < 0 || Number(candidate.startOffset) > 10_000_000
        || !Number.isInteger(candidate.endOffset) || Number(candidate.endOffset) < Number(candidate.startOffset) || Number(candidate.endOffset) > 10_000_000
        || prefix.length > 64 || suffix.length > 64) {
        throw new ValidationError("sourceLocator is invalid.");
    }
    return {
        version: 1,
        blockIndex: Number(candidate.blockIndex),
        startOffset: Number(candidate.startOffset),
        endOffset: Number(candidate.endOffset),
        prefix,
        suffix
    };
}

function validateAnchorConsistency(articleId: string, anchorId: string, anchorType: ReadWeaveAnchorType, sourceExcerpt: string): void {
    const normalizedExcerpt = normalizeAnchorExcerpt(sourceExcerpt);
    for (const link of listReadWeaveLinks()) {
        if (link.articleId !== articleId || link.anchorId !== anchorId) continue;
        if (link.anchorType !== anchorType || normalizeAnchorExcerpt(link.sourceExcerpt) !== normalizedExcerpt) {
            throw new ValidationError("This anchor already belongs to a different text fragment. Select the intended fragment again to create a distinct anchor.");
        }
    }
}

function resolveLink(link: ReadWeaveLink): ReadWeaveResolvedEntry | null {
    let object: ReadWeaveObject;
    try {
        object = getReadWeaveObject(link.objectId);
    } catch {
        return null;
    }
    let parentStale = false;
    if (link.parentLinkId && link.parentRevision !== undefined) {
        try {
            const parentLink = getReadWeaveLink(link.parentLinkId).link;
            parentStale = getReadWeaveObject(parentLink.objectId).revision !== link.parentRevision;
        } catch {
            parentStale = true;
        }
    }
    return {
        linkId: link.linkId,
        articleId: link.articleId,
        anchorId: link.anchorId,
        anchorType: link.anchorType,
        objectId: object.objectId,
        sourceLocator: link.sourceLocator,
        parentLinkId: link.parentLinkId,
        rootLinkId: link.rootLinkId ?? link.linkId,
        depth: link.depth ?? 0,
        parentStale: parentStale || undefined,
        kind: object.kind,
        title: link.displayTitle || object.title,
        body: link.displayBody || object.body,
        calloutType: link.displayCalloutType || object.calloutType,
        termIdentity: object.termIdentity,
        verifiedNonExpandableArtifact: object.verifiedNonExpandableArtifact,
        evidenceSources: object.evidenceSources,
        claims: object.claims,
        audit: object.audit,
        qualityState: object.qualityState ?? "legacy-unverified",
        canonicalTitle: object.title,
        canonicalBody: object.body,
        canonicalCalloutType: object.calloutType,
        revision: object.revision,
        isDisplayOverride: !!(link.displayTitle || link.displayBody || link.displayCalloutType)
    };
}

function requireReadableArticle(articleIdValue: unknown): string {
    const articleId = requireId(articleIdValue, "articleId");
    const article = becca.getNoteOrThrow(articleId);
    if (!article.isContentAvailable()) throw new ValidationError("Article is unavailable in the current protected session.");
    return articleId;
}

export function getEntriesForAnchor(articleIdValue: unknown, anchorIdValue: unknown): ReadWeaveResolvedEntry[] {
    const articleId = requireReadableArticle(articleIdValue);
    const anchorId = requireId(anchorIdValue, "anchorId");
    return listReadWeaveLinks()
        .filter(link => link.articleId === articleId && link.anchorId === anchorId)
        .map(resolveLink)
        .filter((entry): entry is ReadWeaveResolvedEntry => !!entry)
        .toSorted((left, right) =>
            left.kind.localeCompare(right.kind)
            || left.depth - right.depth
            || left.linkId.localeCompare(right.linkId)
            || left.title.localeCompare(right.title));
}

export function getAnchorSummaries(articleIdValue: unknown): ReadWeaveAnchorSummary[] {
    const articleId = requireReadableArticle(articleIdValue);
    const grouped = new Map<string, ReadWeaveLink[]>();
    for (const link of listReadWeaveLinks().filter(item => item.articleId === articleId)) {
        grouped.set(link.anchorId, [ ...(grouped.get(link.anchorId) ?? []), link ]);
    }
    return Array.from(grouped, ([ anchorId, links ]) => {
        const entries = links.map(resolveLink).filter((entry): entry is ReadWeaveResolvedEntry => !!entry);
        return {
            articleId,
            anchorId,
            anchorType: links.find(link => link.anchorType === "range")?.anchorType ?? "paragraph",
            excerpt: links.find(link => link.sourceExcerpt)?.sourceExcerpt ?? "",
            sourceLocator: links.find(link => link.sourceLocator)?.sourceLocator,
            questionCount: new Set(entries.filter(entry => entry.kind === "question").map(entry => entry.objectId)).size,
            termCount: new Set(entries.filter(entry => entry.kind === "term").map(entry => entry.objectId)).size,
            entries
        };
    }).toSorted((left, right) => left.anchorId.localeCompare(right.anchorId));
}

function normalizeObjectInput(request: Pick<ReadWeaveSaveRequest, "kind" | "title" | "body" | "calloutType" | "termIdentity" | "verifiedNonExpandableArtifact" | "evidenceSources" | "claims" | "audit" | "qualityState">) {
    const kind = request.kind;
    if (kind !== "question" && kind !== "term") throw new ValidationError("kind must be question or term.");
    const rawIdentity = request.termIdentity && typeof request.termIdentity === "object"
        ? request.termIdentity as Partial<ReadWeaveTermIdentity>
        : undefined;
    if (typeof rawIdentity?.abbreviation === "string" && typeof rawIdentity.englishName === "string"
        && normalizeReadWeaveTitle(rawIdentity.abbreviation) === normalizeReadWeaveTitle(rawIdentity.englishName)) {
        throw new ValidationError("The English full name must expand the abbreviation. For an unexpanded product or method name, omit the abbreviation field.");
    }
    const candidateIdentity = kind === "term" ? validateReadWeaveTermIdentity(request.termIdentity) : undefined;
    if (candidateIdentity?.abbreviation && candidateIdentity.englishName
        && normalizeReadWeaveTitle(candidateIdentity.abbreviation) === normalizeReadWeaveTitle(candidateIdentity.englishName)) {
        throw new ValidationError("The English full name must expand the abbreviation. For an unexpanded product or method name, omit the abbreviation field.");
    }
    if (candidateIdentity?.abbreviation && candidateIdentity.chineseName
        && normalizeReadWeaveTitle(candidateIdentity.chineseName).includes(normalizeReadWeaveTitle(candidateIdentity.abbreviation))) {
        throw new ValidationError("The Chinese full name must not repeat the abbreviation.");
    }
    const structuredTitle = candidateIdentity ? formatReadWeaveTermIdentity(candidateIdentity) : "";
    const termIdentity = structuredTitle ? candidateIdentity : undefined;
    const title = structuredTitle || requireText(request.title, "title", 1_000);
    const body = requireText(request.body, "body", 50_000);
    const verifiedNonExpandableArtifact = normalizeVerifiedNonExpandableArtifact(request.verifiedNonExpandableArtifact, title);
    const evidenceSources = Array.isArray(request.evidenceSources) ? request.evidenceSources
        .filter(source => source && typeof source.sourceId === "string" && typeof source.title === "string" && typeof source.excerpt === "string")
        .filter(source => !source.url || (() => {
            try { return [ "http:", "https:" ].includes(new URL(source.url).protocol); } catch { return false; }
        })())
        .slice(0, 30) : undefined;
    const sourceIds = new Set(evidenceSources?.map(source => source.sourceId) ?? []);
    const claims = Array.isArray(request.claims) ? request.claims
        .filter(claim => claim && typeof claim.claimId === "string" && typeof claim.text === "string" && Array.isArray(claim.sourceIds))
        .map(claim => ({ ...claim, sourceIds: claim.sourceIds.filter(sourceId => sourceIds.has(sourceId)).slice(0, 12) }))
        .slice(0, 50) : undefined;
    const provenance = request.audit ? {
        evidenceSources,
        claims,
        audit: request.audit
    } : {};
    const qualityState: ReadWeaveQualityState = request.qualityState === "verified" || request.qualityState === "provisional"
        ? request.qualityState
        : "legacy-unverified";
    return {
        kind,
        qualityState,
        termIdentity,
        title,
        body,
        verifiedNonExpandableArtifact,
        ...provenance,
        calloutType: requireCalloutType(request.calloutType, kind)
    };
}

function createObject(request: ReadWeaveSaveRequest, variantOf?: ReadWeaveObject): ReadWeaveObject {
    const articleId = requireReadableArticle(request.articleId);
    const anchorId = requireId(request.anchorId, "anchorId");
    requireAnchorType(request.anchorType);
    const input = normalizeObjectInput(request);
    const sourceExcerpt = requireText(request.sourceExcerpt, "sourceExcerpt", 10_000);
    const article = becca.getNoteOrThrow(articleId);
    const objectId = newEntityId();
    const timestamp = now();
    const object: ReadWeaveObject = {
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        objectId,
        ...input,
        normalizedTitle: normalizeReadWeaveTitle(input.title),
        revision: 1,
        sourceArticleId: articleId,
        sourceAnchorId: anchorId,
        sourceExcerpt,
        createdAt: timestamp,
        updatedAt: timestamp
    };
    const { note } = noteService.createNewNote({
        noteId: objectId,
        parentNoteId: OBJECTS_ROOT_ID,
        title: object.title,
        type: "code",
        mime: "application/json",
        isProtected: article.isProtected,
        content: JSON.stringify(object, null, 2),
        ignoreForbiddenParents: true
    });
    note.setLabel("readweaveObject", input.kind);
    if (variantOf) note.setRelation("readweaveVariantOf", variantOf.objectId);
    return object;
}

function parentTreeFor(request: Pick<ReadWeaveSaveRequest, "articleId" | "anchorId" | "kind" | "parentLinkId">): {
    parentLinkId?: string;
    rootLinkId?: string;
    depth: number;
    parentRevision?: number;
} {
    if (!request.parentLinkId) return { depth: 0 };
    if (request.kind !== "question") throw new ValidationError("Only questions can be nested.");
    const { link: parentLink } = getReadWeaveLink(requireId(request.parentLinkId, "parentLinkId"));
    if (parentLink.articleId !== request.articleId || parentLink.anchorId !== request.anchorId) {
        throw new ValidationError("A follow-up question must remain under the same article anchor.");
    }
    const parentObject = getReadWeaveObject(parentLink.objectId);
    if (parentObject.kind !== "question") throw new ValidationError("A follow-up question must be attached to another question.");
    const depth = (parentLink.depth ?? 0) + 1;
    if (depth > 5) throw new ValidationError("ReadWeave follow-up questions are limited to five nested levels.");
    return {
        parentLinkId: parentLink.linkId,
        rootLinkId: parentLink.rootLinkId ?? parentLink.linkId,
        depth,
        parentRevision: parentObject.revision
    };
}

function createLink(request: ReadWeaveSaveRequest, object: ReadWeaveObject): ReadWeaveLink {
    const articleId = requireReadableArticle(request.articleId);
    const anchorId = requireId(request.anchorId, "anchorId");
    const anchorType = requireAnchorType(request.anchorType);
    const article = becca.getNoteOrThrow(articleId);
    const objectNote = becca.getNoteOrThrow(object.objectId);
    const sourceExcerpt = requireText(request.sourceExcerpt, "sourceExcerpt", 10_000);
    const sourceLocator = normalizeSourceLocator(request.sourceLocator);
    const tree = parentTreeFor(request);
    if (!objectNote.isContentAvailable()) throw new ValidationError("The reusable object is unavailable in the current protected session.");

    const existing = listReadWeaveLinks().find(link =>
        link.articleId === articleId
        && link.anchorId === anchorId
        && link.objectId === object.objectId
        && link.parentLinkId === tree.parentLinkId);
    if (existing) return existing;
    const linkId = newEntityId();
    const timestamp = now();
    const link: ReadWeaveLink = {
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        linkId,
        articleId,
        anchorId,
        anchorType,
        objectId: object.objectId,
        parentLinkId: tree.parentLinkId,
        rootLinkId: tree.rootLinkId ?? linkId,
        depth: tree.depth,
        parentRevision: tree.parentRevision,
        sourceExcerpt,
        sourceLocator,
        createdAt: timestamp,
        updatedAt: timestamp
    };
    const { note } = noteService.createNewNote({
        noteId: linkId,
        parentNoteId: LINKS_ROOT_ID,
        title: "ReadWeave link",
        type: "code",
        mime: "application/json",
        isProtected: article.isProtected || objectNote.isProtected,
        content: JSON.stringify(link, null, 2),
        ignoreForbiddenParents: true
    });
    note.setRelation("readweaveObject", object.objectId);
    return link;
}

export function saveReadWeaveEntry(request: ReadWeaveSaveRequest, hooks?: {
    afterObject?: () => void;
    afterLink?: () => void;
}): ReadWeaveResolvedEntry {
    const articleId = requireReadableArticle(request.articleId);
    const anchorId = requireId(request.anchorId, "anchorId");
    const anchorType = requireAnchorType(request.anchorType);
    const sourceExcerpt = requireText(request.sourceExcerpt, "sourceExcerpt", 10_000);
    normalizeSourceLocator(request.sourceLocator);
    validateAnchorConsistency(articleId, anchorId, anchorType, sourceExcerpt);
    parentTreeFor(request);
    if (request.kind === "term") {
        const existingDefinition = listReadWeaveLinks()
            .filter(link => link.articleId === articleId && link.anchorId === anchorId)
            .map(resolveLink)
            .find((entry): entry is ReadWeaveResolvedEntry => entry?.kind === "term");
        if (existingDefinition) {
            if (request.reuseObjectId === existingDefinition.objectId) return existingDefinition;
            throw new ValidationError("This text fragment already has a definition. Edit the existing definition or select a nested fragment.");
        }
    }
    let object: ReadWeaveObject;
    if (request.reuseObjectId) {
        object = getReadWeaveObject(request.reuseObjectId);
        if (object.kind !== request.kind) throw new ValidationError("The reusable object has a different kind.");
    } else {
        object = createObject(request);
    }
    hooks?.afterObject?.();
    const link = createLink(request, object);
    hooks?.afterLink?.();
    return resolveLink(link)!;
}

export function getReadWeaveImpact(objectIdValue: unknown): ReadWeaveImpact {
    const objectId = requireId(objectIdValue, "objectId");
    getReadWeaveObject(objectId);
    const links = listReadWeaveLinks().filter(link => link.objectId === objectId);
    const articleIds = Array.from(new Set(links.map(link => link.articleId)));
    const articles = articleIds.flatMap(articleId => {
        const article = becca.getNote(articleId);
        return article?.isContentAvailable() ? [ { articleId, title: article.title } ] : [];
    });
    const allLinks = listReadWeaveLinks();
    const rootLinkIds = new Set(links.map(link => link.linkId));
    const descendantIds = new Set<string>();
    let frontier = new Set(rootLinkIds);
    while (frontier.size > 0) {
        const next = allLinks.filter(link => link.parentLinkId && frontier.has(link.parentLinkId));
        frontier = new Set(next.map(link => link.linkId).filter(linkId => !descendantIds.has(linkId)));
        for (const linkId of frontier) descendantIds.add(linkId);
    }
    return {
        objectId,
        linkCount: links.length,
        articleCount: articleIds.length,
        childCount: allLinks.filter(link => link.parentLinkId && rootLinkIds.has(link.parentLinkId)).length,
        descendantCount: descendantIds.size,
        articles
    };
}

function updateCanonicalObject(note: BNote, object: ReadWeaveObject, request: ReadWeaveEditRequest): ReadWeaveObject {
    const input = normalizeObjectInput({
        kind: object.kind,
        ...request,
        verifiedNonExpandableArtifact: request.verifiedNonExpandableArtifact ?? object.verifiedNonExpandableArtifact,
        evidenceSources: request.evidenceSources ?? object.evidenceSources,
        claims: request.claims ?? object.claims,
        audit: request.audit ? { ...request.audit, manuallyEdited: true } : object.audit ? { ...object.audit, manuallyEdited: true } : undefined
    });
    const updated: ReadWeaveObject = {
        ...object,
        ...input,
        normalizedTitle: normalizeReadWeaveTitle(input.title),
        revision: object.revision + 1,
        updatedAt: now()
    };
    noteService.saveRevisionIfNeeded(note);
    note.title = input.title;
    note.save();
    noteService.triggerNoteTitleChanged(note);
    note.setContent(JSON.stringify(updated, null, 2));
    return updated;
}

export function editReadWeaveLink(linkIdValue: unknown, request: ReadWeaveEditRequest): ReadWeaveResolvedEntry {
    const { note: linkNote, link } = getReadWeaveLink(requireId(linkIdValue, "linkId"));
    const objectNote = becca.getNoteOrThrow(link.objectId);
    const object = getReadWeaveObject(link.objectId);

    if (request.mode === "global") {
        updateCanonicalObject(objectNote, object, request);
    } else if (request.mode === "article-variant") {
        const variant = createObject({
            articleId: link.articleId,
            anchorId: link.anchorId,
            anchorType: link.anchorType,
            kind: object.kind,
            title: request.title,
            body: request.body,
            sourceExcerpt: object.sourceExcerpt,
            calloutType: request.calloutType,
            termIdentity: request.termIdentity,
            verifiedNonExpandableArtifact: request.verifiedNonExpandableArtifact ?? object.verifiedNonExpandableArtifact,
            evidenceSources: request.evidenceSources ?? object.evidenceSources,
            claims: request.claims ?? object.claims,
            audit: request.audit ? { ...request.audit, manuallyEdited: true } : object.audit ? { ...object.audit, manuallyEdited: true } : undefined
        }, object);
        link.objectId = variant.objectId;
        link.displayTitle = undefined;
        link.displayBody = undefined;
        link.displayCalloutType = undefined;
        link.updatedAt = now();
        linkNote.setRelation("readweaveObject", variant.objectId);
        linkNote.setContent(JSON.stringify(link, null, 2));
    } else if (request.mode === "display-only") {
        const input = normalizeObjectInput({
            kind: object.kind,
            ...request,
            verifiedNonExpandableArtifact: request.verifiedNonExpandableArtifact ?? object.verifiedNonExpandableArtifact,
            evidenceSources: request.evidenceSources ?? object.evidenceSources,
            claims: request.claims ?? object.claims,
            audit: request.audit ? { ...request.audit, manuallyEdited: true } : object.audit ? { ...object.audit, manuallyEdited: true } : undefined
        });
        link.displayTitle = input.title;
        link.displayBody = input.body;
        link.displayCalloutType = input.calloutType;
        link.updatedAt = now();
        linkNote.setContent(JSON.stringify(link, null, 2));
    } else {
        throw new ValidationError("Unknown edit mode.");
    }
    return resolveLink(link)!;
}

function writeReadWeaveLink(link: ReadWeaveLink): void {
    const note = becca.getNoteOrThrow(link.linkId);
    note.setContent(JSON.stringify(link, null, 2));
}

function revisionForLink(linkId: string | undefined): number | undefined {
    if (!linkId) return undefined;
    try {
        return getReadWeaveObject(getReadWeaveLink(linkId).link.objectId).revision;
    } catch {
        return undefined;
    }
}

function updatePromotedSubtree(
    link: ReadWeaveLink,
    parentLinkId: string | undefined,
    depth: number,
    rootLinkId: string,
    allLinks: ReadWeaveLink[],
    promotedLinkIds: string[]
): void {
    link.parentLinkId = parentLinkId;
    link.parentRevision = revisionForLink(parentLinkId);
    link.depth = depth;
    link.rootLinkId = rootLinkId;
    link.updatedAt = now();
    writeReadWeaveLink(link);
    promotedLinkIds.push(link.linkId);
    for (const child of allLinks.filter(candidate => candidate.parentLinkId === link.linkId)) {
        updatePromotedSubtree(child, link.linkId, depth + 1, rootLinkId, allLinks, promotedLinkIds);
    }
}

export function deleteReadWeaveLink(
    linkIdValue: unknown,
    childStrategy: "cascade" | "promote" = "cascade"
): ReadWeaveDeleteResult {
    const linkId = requireId(linkIdValue, "linkId");
    const { note: linkNote, link } = getReadWeaveLink(linkId);
    requireReadableArticle(link.articleId);
    if (childStrategy !== "cascade" && childStrategy !== "promote") {
        throw new ValidationError("Unknown follow-up deletion strategy.");
    }
    const allLinks = listReadWeaveLinks();
    const directChildren = allLinks.filter(candidate => candidate.parentLinkId === linkId);
    const deletedLinkIds = [ linkId ];
    const promotedLinkIds: string[] = [];

    if (childStrategy === "cascade") {
        const frontier = [ ...directChildren ];
        while (frontier.length > 0) {
            const child = frontier.shift()!;
            if (deletedLinkIds.includes(child.linkId)) continue;
            deletedLinkIds.push(child.linkId);
            frontier.push(...allLinks.filter(candidate => candidate.parentLinkId === child.linkId));
        }
    } else {
        for (const child of directChildren) {
            const rootLinkId = link.parentLinkId
                ? link.rootLinkId ?? link.parentLinkId
                : child.linkId;
            updatePromotedSubtree(
                child,
                link.parentLinkId,
                Math.max(0, link.depth ?? 0),
                rootLinkId,
                allLinks,
                promotedLinkIds
            );
        }
    }

    const objectIds = new Set(
        deletedLinkIds.flatMap(deletedId => {
            const deletedLink = allLinks.find(candidate => candidate.linkId === deletedId);
            return deletedLink ? [ deletedLink.objectId ] : [];
        })
    );
    for (const deletedId of deletedLinkIds.toReversed()) {
        const note = deletedId === linkId ? linkNote : becca.getNote(deletedId);
        if (note) note.deleteNote();
    }
    const survivingLinks = listReadWeaveLinks();
    for (const objectId of objectIds) {
        if (survivingLinks.some(candidate => candidate.objectId === objectId)) continue;
        becca.getNote(objectId)?.deleteNote();
    }
    const remainingLinks = survivingLinks.filter(candidate => candidate.objectId === link.objectId);
    const objectDeleted = remainingLinks.length === 0;

    return {
        deleted: true,
        linkId,
        objectId: link.objectId,
        objectDeleted,
        remainingLinkCount: remainingLinks.length,
        deletedLinkIds,
        promotedLinkIds
    };
}

export function exportReadWeave(articleIdValue?: unknown): ReadWeaveExport {
    const articleId = articleIdValue === undefined ? undefined : requireReadableArticle(articleIdValue);
    const links = listReadWeaveLinks().filter(link => !articleId || link.articleId === articleId).toSorted((a, b) => a.linkId.localeCompare(b.linkId));
    const objectIds = new Set(links.map(link => link.objectId));
    const objects = listReadWeaveObjects().filter(object => objectIds.has(object.objectId)).toSorted((a, b) => a.objectId.localeCompare(b.objectId));
    const articleIds = articleId ? [ articleId ] : Array.from(new Set(links.map(link => link.articleId))).toSorted();
    const articles = articleIds.flatMap(currentArticleId => {
        const article = becca.getNote(currentArticleId);
        return article?.isContentAvailable() ? [ { articleId: currentArticleId, title: article.title } ] : [];
    });
    const anchors: ReadWeaveExport["anchors"] = Array.from(new Map(links.map(link => [
        `${link.articleId}:${link.anchorId}`,
        {
            anchorId: link.anchorId,
            articleId: link.articleId,
            selector: link.anchorType === "range"
                ? { type: "readweave-range-v1" as const, value: link.anchorId, quote: link.sourceExcerpt }
                : { type: "readweave-paragraph-v1" as const, value: link.anchorId },
            excerpt: link.sourceExcerpt,
            ...(link.sourceLocator ? { sourceLocator: link.sourceLocator } : {})
        }
    ])).values()).toSorted((a, b) => `${a.articleId}:${a.anchorId}`.localeCompare(`${b.articleId}:${b.anchorId}`));
    const articleIdSet = new Set(articles.map(article => article.articleId));
    const anchorIdSet = new Set(anchors.map(anchor => `${anchor.articleId}:${anchor.anchorId}`));
    const objectIdSet = new Set(objects.map(object => object.objectId));
    const valid = links.every(link => articleIdSet.has(link.articleId) && anchorIdSet.has(`${link.articleId}:${link.anchorId}`) && objectIdSet.has(link.objectId));
    const contentSha256 = crypto.createHash("sha256").update(JSON.stringify({ articles, anchors, objects, links })).digest("hex");
    return {
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        exportId: `exp_${newEntityId()}`,
        exportedAt: now(),
        generator: {
            name: "ReadWeave",
            version: "0.2.0",
            triliumVersion: "0.103.0",
            workflowVersion: "unified-evidence-v1"
        },
        scope: articleId ? { type: "articles", articleIds: [ articleId ], includeContent: true } : { type: "all", includeContent: true },
        articles,
        anchors,
        objects,
        links,
        integrity: {
            valid,
            articleCount: articles.length,
            anchorCount: anchors.length,
            objectCount: objects.length,
            linkCount: links.length,
            contentSha256
        }
    };
}
