import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse } from "@triliumnext/commons";
import { cls, hidden_subtree as hiddenSubtreeService, note_service as noteService, protected_session as protectedSessionModule } from "@triliumnext/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const generateMock = vi.hoisted(() => vi.fn());
const protectedSession = protectedSessionModule.default;

vi.mock("./readweave_ai.js", async importOriginal => ({
    ...(await importOriginal<typeof import("./readweave_ai.js")>()),
    generateReadWeaveAnswer: generateMock
}));

import {
    discardReadWeaveGenerationJob,
    getReadWeaveGenerationEvents,
    getReadWeaveGenerationJob,
    initializeReadWeaveGenerationJobs,
    listReadWeaveGenerationJobs,
    markReadWeaveGenerationJobViewed,
    regenerateReadWeaveGenerationJob,
    startReadWeaveGenerationJob
} from "./readweave_generation_jobs.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";

let request: ReadWeaveGenerateRequest = {
    articleId: "article_jobs",
    anchorId: "range_jobs",
    anchorType: "range",
    kind: "question",
    title: "这个片段说明了什么？",
    fragments: [ { id: "selected", role: "selected", text: "测试片段" } ]
};

function result(body = "这是后台生成并持久化的测试回答；"): ReadWeaveGenerateResponse {
    return {
        body,
        context: { fragmentIds: [ "selected" ], characterCount: 4, characterBudget: 800, expansionLevel: 0, attemptedBudgets: [ 800 ] },
        workflow: { generationAttempts: 1, validationPasses: 1, contextExpansions: 0, repairRounds: 0, unchangedSegmentsVerified: true },
        provider: "test",
        model: "test-model"
    };
}

async function waitForStatus(jobId: string, status: "complete" | "failed") {
    for (let attempt = 0; attempt < 50; attempt++) {
        const job = getReadWeaveGenerationJob(jobId);
        if (job.status === status) return job;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Job ${jobId} did not reach ${status}.`);
}

describe("ReadWeave persisted generation jobs", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
        const article = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "ReadWeave generation job article",
            type: "text",
            mime: "text/html",
            content: "<p>测试片段</p>"
        }).note);
        request = { ...request, articleId: article.noteId };
        initializeReadWeaveGenerationJobs();
    });

    beforeEach(() => {
        sql.execute("DELETE FROM readweave_generation_events");
        sql.execute("DELETE FROM readweave_generation_jobs");
        generateMock.mockReset();
        generateMock.mockImplementation(async (_request, onProgress) => {
            onProgress?.({ stage: "drafting", round: 1, message: "正在生成测试首稿", issues: [] });
            onProgress?.({ stage: "checking", round: 2, message: "测试检查发现分组问题", issues: [ "作者姓名不应作为术语" ] });
            return result();
        });
    });

    it("persists live events, unread results and incremental cursors", async () => {
        const started = startReadWeaveGenerationJob(request);
        expect(started.sourceExcerpt).toBe("测试片段");
        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.unread).toBe(true);
        expect(listReadWeaveGenerationJobs(request.articleId)).toHaveLength(1);

        const firstPage = getReadWeaveGenerationEvents(started.jobId, 0);
        expect(firstPage.events.length).toBeGreaterThanOrEqual(3);
        expect(firstPage.events.some(event => event.issueGroups?.[0]?.category === "entity")).toBe(true);
        expect(getReadWeaveGenerationEvents(started.jobId, firstPage.nextSequence).events).toEqual([]);

        expect(markReadWeaveGenerationJobViewed(started.jobId).unread).toBe(false);
    });

    it("allows regeneration without feedback while retaining the previous result and resetting progress", async () => {
        const started = startReadWeaveGenerationJob(request);
        await waitForStatus(started.jobId, "complete");
        const originalEvents = getReadWeaveGenerationEvents(started.jobId, 0).events;
        expect(originalEvents.some(event => event.message === "正在生成测试首稿")).toBe(true);

        let release: ((value: ReadWeaveGenerateResponse) => void) | undefined;
        generateMock.mockImplementationOnce(async () => await new Promise<ReadWeaveGenerateResponse>(resolve => { release = resolve; }));
        const regenerating = regenerateReadWeaveGenerationJob(started.jobId, "");
        expect(regenerating.status).toBe("running");
        expect(regenerating.result?.body).toContain("持久化");
        expect(regenerating.feedback).toBeUndefined();

        const resetEvents = getReadWeaveGenerationEvents(started.jobId, 0);
        expect(resetEvents.events).toHaveLength(1);
        expect(resetEvents.events[0]).toMatchObject({ sequence: 1, stage: "queued" });
        expect(resetEvents.events.some(event => event.message === "正在生成测试首稿")).toBe(false);
        expect(resetEvents.nextSequence).toBe(1);

        release?.(result("这是按修正意见生成的新回答；"));
        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.result?.body).toContain("新回答");
        expect(completed.feedback).toBeUndefined();
        expect(discardReadWeaveGenerationJob(started.jobId)).toEqual({ discarded: true });
        expect(() => getReadWeaveGenerationJob(started.jobId)).toThrow();
    });

    it("recovers a persisted running job after server initialization", async () => {
        const jobId = "persisted_restart_job";
        const now = new Date().toISOString();
        sql.execute(/* sql */`
            INSERT INTO readweave_generation_jobs (
                jobId, articleId, anchorId, anchorType, kind, title, sourceExcerpt,
                requestJson, status, resultJson, error, unread, feedback, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, 0, NULL, ?, ?)
        `, [ jobId, request.articleId, request.anchorId, request.anchorType, request.kind, request.title, "测试片段", JSON.stringify(request), now, now ]);

        initializeReadWeaveGenerationJobs();
        const recovered = await waitForStatus(jobId, "complete");
        expect(recovered.progress.some(event => event.message.includes("服务器恢复了未完成任务"))).toBe(true);
    });

    it("reuses the same unsaved definition job for an identical fragment", () => {
        const termRequest: ReadWeaveGenerateRequest = { ...request, kind: "term", title: "NPU", termIdentity: { abbreviation: "NPU" } };
        const first = startReadWeaveGenerationJob(termRequest);
        const second = startReadWeaveGenerationJob(termRequest);
        expect(second.jobId).toBe(first.jobId);
    });

    it("normalizes a legacy unexpanded method identity when the persisted draft is read", async () => {
        generateMock.mockResolvedValueOnce({
            ...result("BS-PDN-Last 是一种背面供电网络设计方法。"),
            termIdentity: {
                abbreviation: "BS-PDN-Last",
                chineseName: "BS-PDN-Last 背面供电网络设计方法",
                englishName: "BS-PDN-Last"
            }
        });
        const started = startReadWeaveGenerationJob({
            ...request,
            kind: "term",
            title: "BS-PDN-Last",
            termIdentity: undefined
        });
        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.result?.termIdentity).toEqual({
            abbreviation: undefined,
            chineseName: "背面供电网络设计方法",
            englishName: "BS-PDN-Last"
        });
    });

    it("encrypts every protected-note payload and refuses access while the protected session is locked", async () => {
        protectedSession.setDataKey(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
        const protectedArticle = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Protected ReadWeave generation article",
            type: "text",
            mime: "text/html",
            isProtected: true,
            content: "<p>受保护的测试片段</p>"
        }).note);
        const protectedRequest = {
            ...request,
            articleId: protectedArticle.noteId,
            title: "受保护的问题",
            fragments: [ { id: "selected", role: "selected" as const, text: "绝不能明文落库的片段" } ]
        };
        const started = startReadWeaveGenerationJob(protectedRequest);
        await waitForStatus(started.jobId, "complete");

        const rawJob = sql.getRow<{ isProtected: number; title: string; sourceExcerpt: string; requestJson: string; resultJson: string }>(
            "SELECT isProtected, title, sourceExcerpt, requestJson, resultJson FROM readweave_generation_jobs WHERE jobId = ?",
            [ started.jobId ]
        );
        const rawEvents = sql.getColumn<string>("SELECT progressJson FROM readweave_generation_events WHERE jobId = ?", [ started.jobId ]);
        expect(rawJob.isProtected).toBe(1);
        expect(JSON.stringify({ rawJob, rawEvents })).not.toContain("绝不能明文落库");
        expect(getReadWeaveGenerationJob(started.jobId).title).toBe("受保护的问题");

        protectedSession.resetDataKey();
        expect(() => getReadWeaveGenerationJob(started.jobId)).toThrow(/protected session/i);
        protectedSession.setDataKey(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
        expect(getReadWeaveGenerationJob(started.jobId).sourceExcerpt).toBe("绝不能明文落库的片段");
        discardReadWeaveGenerationJob(started.jobId);
        protectedSession.resetDataKey();
    });
});
