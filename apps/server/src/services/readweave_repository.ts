import {
    READWEAVE_SCHEMA_VERSION,
    type ReadWeaveEditRequest,
    type ReadWeaveExport,
    type ReadWeaveImpact,
    type ReadWeaveLink,
    type ReadWeaveObject,
    type ReadWeaveResolvedEntry,
    type ReadWeaveSaveRequest
} from "@triliumnext/commons";
import crypto from "crypto";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import NotFoundError from "../errors/not_found_error.js";
import ValidationError from "../errors/validation_error.js";
import noteService from "./notes.js";
import { normalizeReadWeaveTitle } from "./readweave_engine.js";
import { newEntityId } from "./utils.js";

const OBJECTS_ROOT_ID = "_readweaveObjects";
const LINKS_ROOT_ID = "_readweaveLinks";

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

function parseObject(note: BNote): ReadWeaveObject | null {
    if (!note.isContentAvailable()) return null;
    const value = note.getJsonContentSafely() as Partial<ReadWeaveObject> | null;
    if (!value || value.schemaVersion !== READWEAVE_SCHEMA_VERSION || value.objectId !== note.noteId) return null;
    if (value.kind !== "question" && value.kind !== "term") return null;
    if (typeof value.title !== "string" || typeof value.body !== "string") return null;
    return value as ReadWeaveObject;
}

function parseLink(note: BNote): ReadWeaveLink | null {
    if (!note.isContentAvailable()) return null;
    const value = note.getJsonContentSafely() as Partial<ReadWeaveLink> | null;
    if (!value || value.schemaVersion !== READWEAVE_SCHEMA_VERSION || value.linkId !== note.noteId) return null;
    if (typeof value.articleId !== "string" || typeof value.anchorId !== "string" || typeof value.objectId !== "string") return null;
    return {
        ...value,
        // Early development builds did not persist the excerpt on links. Keep
        // those links readable and populate the field on the next write.
        sourceExcerpt: typeof value.sourceExcerpt === "string" ? value.sourceExcerpt : ""
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

function resolveLink(link: ReadWeaveLink): ReadWeaveResolvedEntry | null {
    let object: ReadWeaveObject;
    try {
        object = getReadWeaveObject(link.objectId);
    } catch {
        return null;
    }
    return {
        linkId: link.linkId,
        articleId: link.articleId,
        anchorId: link.anchorId,
        objectId: object.objectId,
        kind: object.kind,
        title: link.displayTitle || object.title,
        body: link.displayBody || object.body,
        canonicalTitle: object.title,
        canonicalBody: object.body,
        revision: object.revision,
        isDisplayOverride: !!(link.displayTitle || link.displayBody)
    };
}

export function getEntriesForAnchor(articleIdValue: unknown, anchorIdValue: unknown): ReadWeaveResolvedEntry[] {
    const articleId = requireId(articleIdValue, "articleId");
    const anchorId = requireId(anchorIdValue, "anchorId");
    const article = becca.getNoteOrThrow(articleId);
    if (!article.isContentAvailable()) throw new ValidationError("Article is unavailable in the current protected session.");

    return listReadWeaveLinks()
        .filter(link => link.articleId === articleId && link.anchorId === anchorId)
        .map(resolveLink)
        .filter((entry): entry is ReadWeaveResolvedEntry => !!entry)
        .toSorted((left, right) => left.title.localeCompare(right.title));
}

function createObject(request: ReadWeaveSaveRequest, variantOf?: ReadWeaveObject): ReadWeaveObject {
    const articleId = requireId(request.articleId, "articleId");
    const anchorId = requireId(request.anchorId, "anchorId");
    const kind = request.kind;
    if (kind !== "question" && kind !== "term") throw new ValidationError("kind must be question or term.");
    const title = requireText(request.title, "title", 1_000);
    const body = requireText(request.body, "body", 50_000);
    const sourceExcerpt = requireText(request.sourceExcerpt, "sourceExcerpt", 10_000);
    const article = becca.getNoteOrThrow(articleId);
    if (!article.isContentAvailable()) throw new ValidationError("Article is unavailable in the current protected session.");

    const objectId = newEntityId();
    const timestamp = now();
    const object: ReadWeaveObject = {
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        objectId,
        kind,
        title,
        body,
        normalizedTitle: normalizeReadWeaveTitle(title),
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
        title,
        type: "code",
        mime: "application/json",
        isProtected: article.isProtected,
        content: JSON.stringify(object, null, 2),
        ignoreForbiddenParents: true
    });
    note.setLabel("readweaveObject", kind);
    if (variantOf) note.setRelation("readweaveVariantOf", variantOf.objectId);
    return object;
}

function createLink(articleIdValue: unknown, anchorIdValue: unknown, object: ReadWeaveObject, sourceExcerptValue: unknown): ReadWeaveLink {
    const articleId = requireId(articleIdValue, "articleId");
    const anchorId = requireId(anchorIdValue, "anchorId");
    const article = becca.getNoteOrThrow(articleId);
    const objectNote = becca.getNoteOrThrow(object.objectId);
    const sourceExcerpt = requireText(sourceExcerptValue, "sourceExcerpt", 10_000);
    if (!article.isContentAvailable() || !objectNote.isContentAvailable()) {
        throw new ValidationError("Article or object is unavailable in the current protected session.");
    }

    const existing = listReadWeaveLinks().find(link => link.articleId === articleId && link.anchorId === anchorId && link.objectId === object.objectId);
    if (existing) return existing;

    const linkId = newEntityId();
    const timestamp = now();
    const link: ReadWeaveLink = {
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        linkId,
        articleId,
        anchorId,
        objectId: object.objectId,
        sourceExcerpt,
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

export function saveReadWeaveEntry(request: ReadWeaveSaveRequest): ReadWeaveResolvedEntry {
    let object: ReadWeaveObject;
    if (request.reuseObjectId) {
        object = getReadWeaveObject(request.reuseObjectId);
        if (object.kind !== request.kind) throw new ValidationError("The reusable object has a different kind.");
    } else {
        object = createObject(request);
    }
    const link = createLink(request.articleId, request.anchorId, object, request.sourceExcerpt);
    return resolveLink(link)!;
}

export function getReadWeaveImpact(objectIdValue: unknown): ReadWeaveImpact {
    const objectId = requireId(objectIdValue, "objectId");
    getReadWeaveObject(objectId);
    const links = listReadWeaveLinks().filter(link => link.objectId === objectId);
    const articleIds = Array.from(new Set(links.map(link => link.articleId)));
    const articles = articleIds.flatMap(articleId => {
        const article = becca.getNote(articleId);
        return article?.isContentAvailable() ? [{ articleId, title: article.title }] : [];
    });
    return { objectId, linkCount: links.length, articleCount: articleIds.length, articles };
}

function updateCanonicalObject(note: BNote, object: ReadWeaveObject, titleValue: unknown, bodyValue: unknown): ReadWeaveObject {
    const title = requireText(titleValue, "title", 1_000);
    const body = requireText(bodyValue, "body", 50_000);
    const updated: ReadWeaveObject = {
        ...object,
        title,
        body,
        normalizedTitle: normalizeReadWeaveTitle(title),
        revision: object.revision + 1,
        updatedAt: now()
    };
    noteService.saveRevisionIfNeeded(note);
    note.title = title;
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
        updateCanonicalObject(objectNote, object, request.title, request.body);
    } else if (request.mode === "article-variant") {
        const variant = createObject({
            articleId: link.articleId,
            anchorId: link.anchorId,
            kind: object.kind,
            title: request.title,
            body: request.body,
            sourceExcerpt: object.sourceExcerpt
        }, object);
        link.objectId = variant.objectId;
        link.displayTitle = undefined;
        link.displayBody = undefined;
        link.updatedAt = now();
        linkNote.setRelation("readweaveObject", variant.objectId);
        linkNote.setContent(JSON.stringify(link, null, 2));
    } else if (request.mode === "display-only") {
        link.displayTitle = requireText(request.title, "title", 1_000);
        link.displayBody = requireText(request.body, "body", 50_000);
        link.updatedAt = now();
        linkNote.setContent(JSON.stringify(link, null, 2));
    } else {
        throw new ValidationError("Unknown edit mode.");
    }
    return resolveLink(link)!;
}

export function exportReadWeave(articleIdValue?: unknown): ReadWeaveExport {
    const articleId = articleIdValue === undefined ? undefined : requireId(articleIdValue, "articleId");
    if (articleId) {
        const article = becca.getNoteOrThrow(articleId);
        if (!article.isContentAvailable()) throw new ValidationError("Article is unavailable in the current protected session.");
    }
    const links = listReadWeaveLinks()
        .filter(link => !articleId || link.articleId === articleId)
        .toSorted((left, right) => left.linkId.localeCompare(right.linkId));
    const objectIds = new Set(links.map(link => link.objectId));
    const objects = listReadWeaveObjects()
        .filter(object => objectIds.has(object.objectId))
        .toSorted((left, right) => left.objectId.localeCompare(right.objectId));
    const articleIds = articleId ? [ articleId ] : Array.from(new Set(links.map(link => link.articleId))).toSorted();
    const articles = articleIds.flatMap(currentArticleId => {
        const article = becca.getNote(currentArticleId);
        return article?.isContentAvailable() ? [{ articleId: currentArticleId, title: article.title }] : [];
    });
    const anchors = Array.from(new Map(links.map(link => [
        `${link.articleId}:${link.anchorId}`,
        {
            anchorId: link.anchorId,
            articleId: link.articleId,
            selector: { type: "readweave-paragraph-v1" as const, value: link.anchorId },
            excerpt: link.sourceExcerpt
        }
    ])).values()).toSorted((left, right) => `${left.articleId}:${left.anchorId}`.localeCompare(`${right.articleId}:${right.anchorId}`));
    const articleIdSet = new Set(articles.map(article => article.articleId));
    const anchorIdSet = new Set(anchors.map(anchor => `${anchor.articleId}:${anchor.anchorId}`));
    const objectIdSet = new Set(objects.map(object => object.objectId));
    const valid = links.every(link => articleIdSet.has(link.articleId)
        && anchorIdSet.has(`${link.articleId}:${link.anchorId}`)
        && objectIdSet.has(link.objectId));
    const contentSha256 = crypto.createHash("sha256")
        .update(JSON.stringify({ articles, anchors, objects, links }))
        .digest("hex");
    return {
        schemaVersion: READWEAVE_SCHEMA_VERSION,
        exportId: `exp_${newEntityId()}`,
        exportedAt: now(),
        generator: {
            name: "ReadWeave",
            version: "0.1.0",
            triliumVersion: "0.103.0",
            workflowVersion: "context-v1"
        },
        scope: articleId
            ? { type: "articles", articleIds: [ articleId ], includeContent: true }
            : { type: "all", includeContent: true },
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
