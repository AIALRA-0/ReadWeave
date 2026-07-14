import type { ReadWeaveEditRequest, ReadWeaveGenerateRequest, ReadWeaveObjectKind, ReadWeaveSaveRequest } from "@triliumnext/commons";
import type { Request } from "express";

import ValidationError from "../../errors/validation_error.js";
import { generateReadWeaveAnswer } from "../../services/readweave_ai.js";
import { findReadWeaveCandidates } from "../../services/readweave_engine.js";
import {
    editReadWeaveLink,
    exportReadWeave,
    getEntriesForAnchor,
    getReadWeaveImpact,
    getReadWeaveObject,
    listReadWeaveObjects,
    saveReadWeaveEntry
} from "../../services/readweave_repository.js";

function getEntries(req: Request<{ articleId: string; anchorId: string }>) {
    return { entries: getEntriesForAnchor(req.params.articleId, req.params.anchorId) };
}

function queryCandidates(req: Request) {
    const { title, kind } = req.body as { title?: unknown; kind?: unknown };
    if (typeof title !== "string" || !title.trim() || title.length > 1_000) {
        throw new ValidationError("A title of at most 1000 characters is required.");
    }
    if (kind !== "question" && kind !== "term") throw new ValidationError("kind must be question or term.");
    return { candidates: findReadWeaveCandidates(title, kind as ReadWeaveObjectKind, listReadWeaveObjects()) };
}

function getObject(req: Request<{ objectId: string }>) {
    return { object: getReadWeaveObject(req.params.objectId) };
}

function saveEntry(req: Request) {
    return { entry: saveReadWeaveEntry(req.body as ReadWeaveSaveRequest) };
}

function getImpact(req: Request<{ objectId: string }>) {
    return { impact: getReadWeaveImpact(req.params.objectId) };
}

function editLink(req: Request<{ linkId: string }>) {
    return { entry: editReadWeaveLink(req.params.linkId, req.body as ReadWeaveEditRequest) };
}

async function generate(req: Request) {
    return await generateReadWeaveAnswer(req.body as ReadWeaveGenerateRequest);
}

function exportIndex(req: Request) {
    const articleId = typeof req.query.articleId === "string" ? req.query.articleId : undefined;
    return exportReadWeave(articleId);
}

export default {
    getEntries,
    queryCandidates,
    getObject,
    saveEntry,
    getImpact,
    editLink,
    generate,
    exportIndex
};
