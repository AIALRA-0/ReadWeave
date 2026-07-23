import type {
    ReadWeaveAiSettingsUpdate,
    ReadWeaveEditRequest,
    ReadWeaveGenerateRequest,
    ReadWeaveObjectKind,
    ReadWeaveSaveRequest,
    ReadWeaveTermIdentity
} from "@triliumnext/commons";
import { NotFoundError, ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import { generateReadWeaveAnswer } from "../../services/readweave_ai.js";
import { findReadWeaveCandidates } from "../../services/readweave_engine.js";
import {
    discardReadWeaveGenerationJob,
    getReadWeaveGenerationEvents,
    getReadWeaveGenerationJob,
    listReadWeaveGenerationJobs,
    markReadWeaveGenerationJobViewed,
    regenerateReadWeaveGenerationJob,
    startReadWeaveGenerationJob
} from "../../services/readweave_generation_jobs.js";
import {
    editReadWeaveLink,
    exportReadWeave,
    getAnchorSummaries,
    getEntriesForAnchor,
    getReadWeaveImpact,
    getReadWeaveObject,
    listReadWeaveObjects,
    saveReadWeaveEntry
} from "../../services/readweave_repository.js";
import {
    getReadWeaveAiSettings,
    listReadWeaveModels,
    updateReadWeaveAiSettings
} from "../../services/readweave_settings.js";

function getEntries(req: Request<{ articleId: string; anchorId: string }>) {
    return { entries: getEntriesForAnchor(req.params.articleId, req.params.anchorId) };
}

function getAnchors(req: Request<{ articleId: string }>) {
    return { anchors: getAnchorSummaries(req.params.articleId) };
}

function queryCandidates(req: Request) {
    const { title, kind, termIdentity } = req.body as { title?: unknown; kind?: unknown; termIdentity?: Partial<ReadWeaveTermIdentity> };
    if (typeof title !== "string" || !title.trim() || title.length > 1_000) {
        throw new ValidationError("A title of at most 1000 characters is required.");
    }
    if (kind !== "question" && kind !== "term") throw new ValidationError("kind must be question or term.");
    return { candidates: findReadWeaveCandidates(title, kind as ReadWeaveObjectKind, listReadWeaveObjects(), 8, termIdentity) };
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

function startGenerationJob(req: Request) {
    return { job: startReadWeaveGenerationJob(req.body as ReadWeaveGenerateRequest) };
}

function getGenerationJob(req: Request<{ jobId: string }>) {
    return { job: getReadWeaveGenerationJob(req.params.jobId) };
}

function listGenerationJobs(req: Request<{ articleId: string }>) {
    return { jobs: listReadWeaveGenerationJobs(req.params.articleId) };
}

function getGenerationEvents(req: Request<{ jobId: string }>) {
    const after = typeof req.query.after === "string" ? Number.parseInt(req.query.after, 10) : 0;
    const cursor = Number.isFinite(after) ? after : 0;
    try {
        return getReadWeaveGenerationEvents(req.params.jobId, cursor);
    } catch (error) {
        // A completed draft can be saved or discarded while an already-issued
        // incremental poll is in flight. Treat that expected race as a clean end.
        if (error instanceof NotFoundError) return { job: null, events: [], nextSequence: cursor };
        throw error;
    }
}

function markGenerationJobViewed(req: Request<{ jobId: string }>) {
    try {
        return { job: markReadWeaveGenerationJobViewed(req.params.jobId) };
    } catch (error) {
        if (error instanceof NotFoundError) return { job: null };
        throw error;
    }
}

function regenerateGenerationJob(req: Request<{ jobId: string }>) {
    return { job: regenerateReadWeaveGenerationJob(req.params.jobId, (req.body as { feedback?: unknown })?.feedback) };
}

function discardGenerationJob(req: Request<{ jobId: string }>) {
    return discardReadWeaveGenerationJob(req.params.jobId);
}

function exportIndex(req: Request) {
    const articleId = typeof req.query.articleId === "string" ? req.query.articleId : undefined;
    return exportReadWeave(articleId);
}

function getSettings() {
    return getReadWeaveAiSettings();
}

function updateSettings(req: Request) {
    return updateReadWeaveAiSettings(req.body as ReadWeaveAiSettingsUpdate);
}

async function getModels() {
    return { models: await listReadWeaveModels() };
}

export default {
    getEntries,
    getAnchors,
    queryCandidates,
    getObject,
    saveEntry,
    getImpact,
    editLink,
    generate,
    startGenerationJob,
    getGenerationJob,
    listGenerationJobs,
    getGenerationEvents,
    markGenerationJobViewed,
    regenerateGenerationJob,
    discardGenerationJob,
    exportIndex,
    getSettings,
    updateSettings,
    getModels
};
