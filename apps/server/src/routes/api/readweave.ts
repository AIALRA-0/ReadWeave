import type {
    ReadWeaveAiSettingsUpdate,
    ReadWeaveEditRequest,
    ReadWeaveGenerateRequest,
    ReadWeaveLocalRewriteRequest,
    ReadWeaveObjectKind,
    ReadWeaveSaveRequest,
    ReadWeaveTermIdentity
} from "@triliumnext/commons";
import { NotFoundError, ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import { generateReadWeaveAnswer } from "../../services/readweave_ai.js";
import { findReadWeaveCandidates } from "../../services/readweave_engine.js";
import {
    cancelReadWeaveGenerationJob,
    commitReadWeaveGenerationJob,
    discardReadWeaveGenerationJob,
    discardReadWeaveGenerationJobsForSavedLinks,
    getReadWeaveGenerationEvents,
    getReadWeaveGenerationJob,
    listReadWeaveGenerationJobs,
    listReadWeaveGenerationJobsGlobal,
    markReadWeaveGenerationJobViewed,
    regenerateReadWeaveGenerationJob,
    startReadWeaveGenerationJob
} from "../../services/readweave_generation_jobs.js";
import {
    addReadWeaveHarnessCase,
    archiveReadWeaveHarnessProfile,
    createReadWeaveHarnessDraft,
    getLatestReadWeaveHarnessTrialJob,
    getReadWeaveHarnessProfile,
    getReadWeaveHarnessTrialJob,
    listReadWeaveHarnessProfiles,
    publishReadWeaveHarnessProfile,
    rollbackReadWeaveHarnessProfile,
    trialReadWeaveHarnessProfile,
    updateReadWeaveHarnessDraft
} from "../../services/readweave_harness.js";
import {
    deleteReadWeaveLink,
    editReadWeaveLink,
    exportReadWeave,
    getAnchorSummaries,
    getEntriesForAnchor,
    getReadWeaveImpact,
    getReadWeaveObject,
    listReadWeaveObjects,
    saveReadWeaveEntry
} from "../../services/readweave_repository.js";
import { testReadWeaveSearch } from "../../services/readweave_search.js";
import {
    getReadWeaveAiSettings,
    listReadWeaveModels,
    updateReadWeaveAiSettings
} from "../../services/readweave_settings.js";
import { generateReadWeaveLocalRewrite } from "../../services/readweave_unified_ai.js";

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
    return { candidates: findReadWeaveCandidates(title, kind as ReadWeaveObjectKind, listReadWeaveObjects(), 3, termIdentity) };
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

function deleteLink(req: Request<{ linkId: string }>) {
    const strategy = req.query.children === "promote" ? "promote" : "cascade";
    const result = deleteReadWeaveLink(req.params.linkId, strategy);
    discardReadWeaveGenerationJobsForSavedLinks(result.deletedLinkIds ?? [ result.linkId ]);
    return result;
}

async function generate(req: Request) {
    return await generateReadWeaveAnswer(req.body as ReadWeaveGenerateRequest);
}

async function rewriteLocal(req: Request) {
    return await generateReadWeaveLocalRewrite(req.body as ReadWeaveLocalRewriteRequest);
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

function listGlobalGenerationJobs(req: Request) {
    const after = typeof req.query.after === "string" ? Number.parseInt(req.query.after, 10) : 0;
    return listReadWeaveGenerationJobsGlobal(Number.isFinite(after) ? after : 0);
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
    return { job: regenerateReadWeaveGenerationJob(req.params.jobId, req.body) };
}

function discardGenerationJob(req: Request<{ jobId: string }>) {
    return discardReadWeaveGenerationJob(req.params.jobId);
}

function cancelGenerationJob(req: Request<{ jobId: string }>) {
    return { job: cancelReadWeaveGenerationJob(req.params.jobId) };
}

function commitGenerationJob(req: Request<{ jobId: string }>) {
    return { job: commitReadWeaveGenerationJob(req.params.jobId, req.body) };
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

async function testSearch(req: Request) {
    const query = (req.body as { query?: unknown })?.query;
    if (typeof query !== "string" || !query.trim() || query.length > 500) {
        throw new ValidationError("A search test query of at most 500 characters is required.");
    }
    return await testReadWeaveSearch(query);
}

function listHarnessProfiles() {
    return { profiles: listReadWeaveHarnessProfiles() };
}

function getHarnessProfile(req: Request<{ versionId: string }>) {
    return { profile: getReadWeaveHarnessProfile(req.params.versionId) };
}

function createHarnessDraft(req: Request) {
    return { profile: createReadWeaveHarnessDraft(req.body ?? {}) };
}

function updateHarnessDraft(req: Request<{ versionId: string }>) {
    return { profile: updateReadWeaveHarnessDraft(req.params.versionId, req.body ?? {}) };
}

function addHarnessCase(req: Request<{ versionId: string }>) {
    return { profile: addReadWeaveHarnessCase(req.params.versionId, req.body ?? {}) };
}

function trialHarness(req: Request<{ versionId: string }>) {
    return { trialJob: trialReadWeaveHarnessProfile(req.params.versionId, req.body ?? {}) };
}

function getHarnessTrial(req: Request<{ trialJobId: string }>) {
    return { trialJob: getReadWeaveHarnessTrialJob(req.params.trialJobId) };
}

function getLatestHarnessTrial(req: Request<{ versionId: string }>) {
    return { trialJob: getLatestReadWeaveHarnessTrialJob(req.params.versionId) ?? null };
}

function publishHarness(req: Request<{ versionId: string }>) {
    return { profile: publishReadWeaveHarnessProfile(req.params.versionId, req.body) };
}

function rollbackHarness(req: Request<{ versionId: string }>) {
    return { profile: rollbackReadWeaveHarnessProfile(req.params.versionId) };
}

function archiveHarness(req: Request<{ versionId: string }>) {
    return { profile: archiveReadWeaveHarnessProfile(req.params.versionId) };
}

export default {
    getEntries,
    getAnchors,
    queryCandidates,
    getObject,
    saveEntry,
    getImpact,
    editLink,
    deleteLink,
    generate,
    rewriteLocal,
    startGenerationJob,
    getGenerationJob,
    listGenerationJobs,
    listGlobalGenerationJobs,
    getGenerationEvents,
    markGenerationJobViewed,
    regenerateGenerationJob,
    discardGenerationJob,
    cancelGenerationJob,
    commitGenerationJob,
    exportIndex,
    getSettings,
    updateSettings,
    getModels,
    testSearch,
    listHarnessProfiles,
    getHarnessProfile,
    createHarnessDraft,
    updateHarnessDraft,
    addHarnessCase,
    trialHarness,
    getHarnessTrial,
    getLatestHarnessTrial,
    publishHarness,
    rollbackHarness,
    archiveHarness
};
