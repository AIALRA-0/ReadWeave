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
import {
    deleteReadWeaveLink,
    getAnchorSummaries,
    getEntriesForAnchor
} from "./readweave_repository.js";
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

function result(body = "测试片段说明后台任务能够生成、检查并持久化保存回答"): ReadWeaveGenerateResponse {
    const completeBody = body.replace(/[。；\s]+$/u, "").length >= 50
        ? body
        : `${body.replace(/[。；\s]+$/u, "")}；保存后的内容能够在同一文字锚点重新打开，并继续编辑、重新生成或删除`;
    return {
        body: completeBody,
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
        if (job.status === "failed") {
            throw new Error(`Job ${jobId} failed: ${job.error}; ${job.progress.flatMap(event => event.issues).join(" | ")}`);
        }
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
        cls.init(() => {
            for (const summary of getAnchorSummaries(request.articleId)) {
                for (const entry of summary.entries) deleteReadWeaveLink(entry.linkId);
            }
        });
        generateMock.mockReset();
        generateMock.mockImplementation(async (_request, onProgress) => {
            onProgress?.({ stage: "drafting", round: 1, message: "正在生成测试首稿", issues: [] });
            onProgress?.({ stage: "checking", round: 2, message: "测试检查发现分组问题", issues: [ "作者姓名不应作为术语" ] });
            return result();
        });
    });

    it("persists live events, unread results and incremental cursors", async () => {
        generateMock.mockImplementationOnce(async (_request, onProgress) => {
            onProgress?.({ stage: "drafting", round: 1, message: "正在生成测试首稿。  ", issues: [] });
            onProgress?.({
                stage: "checking",
                round: 2,
                message: "模型返回“failed.”。",
                issues: [ "作者姓名不应作为术语。", "联网失败（timeout.）" ]
            });
            return result();
        });
        const started = startReadWeaveGenerationJob(request);
        expect(started.sourceExcerpt).toBe("测试片段");
        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.unread).toBe(true);
        expect(completed.savedLinkId).toBeTruthy();
        expect(getEntriesForAnchor(request.articleId, request.anchorId)).toHaveLength(1);
        expect(getEntriesForAnchor(request.articleId, request.anchorId)[0]).toMatchObject({
            linkId: completed.savedLinkId,
            kind: "question",
            calloutType: "note"
        });
        const listedJobs = listReadWeaveGenerationJobs(request.articleId);
        expect(listedJobs).toHaveLength(1);
        expect(listedJobs[0].progress).toEqual([]);
        expect(listedJobs[0].result?.body).toBe(completed.result?.body);
        expect(getReadWeaveGenerationJob(started.jobId).progress.length).toBeGreaterThanOrEqual(3);

        const firstPage = getReadWeaveGenerationEvents(started.jobId, 0);
        expect(firstPage.events.length).toBeGreaterThanOrEqual(3);
        expect(firstPage.events.map(event => event.message)).toContain("正在生成测试首稿");
        expect(firstPage.events.map(event => event.message)).toContain("模型返回“failed”");
        expect(firstPage.events.flatMap(event => event.issues)).toEqual(expect.arrayContaining([
            "作者姓名不应作为术语",
            "联网失败（timeout）"
        ]));
        expect(firstPage.events.some(event => event.issueGroups?.[0]?.category === "entity")).toBe(true);
        expect(getReadWeaveGenerationEvents(started.jobId, firstPage.nextSequence).events).toEqual([]);

        expect(markReadWeaveGenerationJobViewed(started.jobId).unread).toBe(false);
    });

    it("automatically regenerates an internally rejected draft and only completes with a clean result", async () => {
        generateMock
            .mockResolvedValueOnce({
                ...result("这是仍含内部质量问题的首稿；"),
                reviewIssues: [ "英文名称格式尚未通过" ]
            })
            .mockResolvedValueOnce(result("这是自动修复后通过全部检查的回答；"));

        const started = startReadWeaveGenerationJob(request);
        const completed = await waitForStatus(started.jobId, "complete");

        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(completed.result?.body).toContain("通过全部检查");
        expect(completed.result?.reviewIssues).toBeUndefined();
        expect(completed.progress.some(event => event.message.includes("正在自动重试第 2 次"))).toBe(true);
        expect(generateMock.mock.calls[1][0].feedback).toContain("英文名称格式尚未通过");
    });

    it("feeds a thrown internal protocol failure into the next automatic regeneration", async () => {
        generateMock
            .mockRejectedValueOnce(new Error("内部检查协议未能形成有效修复计划"))
            .mockResolvedValueOnce(result("这是自动恢复后通过全部检查的回答；"));

        const started = startReadWeaveGenerationJob(request);
        const completed = await waitForStatus(started.jobId, "complete");

        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(completed.result?.body).toContain("自动恢复后通过");
        expect(generateMock.mock.calls[1][0].feedback).toContain("内部检查协议未能形成有效修复计划");
        expect(completed.progress.some(event => event.message.includes("正在自动恢复第 2 次"))).toBe(true);
        expect(completed.progress.find(event => event.message.includes("正在自动恢复第 2 次"))?.issues)
            .toEqual([ "内部检查协议未能形成有效修复计划" ]);
    });

    it("allows regeneration without feedback while retaining the previous result and resetting progress", async () => {
        const started = startReadWeaveGenerationJob(request);
        const firstCompleted = await waitForStatus(started.jobId, "complete");
        sql.execute("UPDATE readweave_generation_jobs SET createdAt = ? WHERE jobId = ?", [
            "2020-01-01T00:00:00.000Z",
            started.jobId
        ]);
        const originalEvents = getReadWeaveGenerationEvents(started.jobId, 0).events;
        expect(originalEvents.some(event => event.message === "正在生成测试首稿")).toBe(true);

        let release: ((value: ReadWeaveGenerateResponse) => void) | undefined;
        generateMock.mockImplementationOnce(async () => await new Promise<ReadWeaveGenerateResponse>(resolve => { release = resolve; }));
        const regenerating = regenerateReadWeaveGenerationJob(started.jobId, "");
        expect(regenerating.status).toBe("running");
        expect(regenerating.result?.body).toContain("持久化");
        expect(regenerating.feedback).toBeUndefined();
        expect(Date.parse(regenerating.createdAt)).toBeGreaterThan(Date.parse("2020-01-01T00:00:00.000Z"));

        const resetEvents = getReadWeaveGenerationEvents(started.jobId, 0);
        expect(resetEvents.events).toHaveLength(1);
        expect(resetEvents.events[0]).toMatchObject({ sequence: 1, stage: "queued" });
        expect(resetEvents.events[0].elapsedMs).toBeLessThan(1_000);
        expect(resetEvents.events.some(event => event.message === "正在生成测试首稿")).toBe(false);
        expect(resetEvents.nextSequence).toBe(1);

        release?.(result("这是按修正意见生成的新回答；"));
        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.result?.body).toContain("新回答");
        expect(completed.savedLinkId).toBe(firstCompleted.savedLinkId);
        expect(getEntriesForAnchor(request.articleId, request.anchorId)).toHaveLength(1);
        expect(getEntriesForAnchor(request.articleId, request.anchorId)[0].body).toContain("新回答");
        expect(completed.feedback).toBeUndefined();
        expect(discardReadWeaveGenerationJob(started.jobId)).toEqual({ discarded: true });
        expect(() => getReadWeaveGenerationJob(started.jobId)).toThrow();
    });

    it("regenerates with the question, selection and options currently shown in the editor", async () => {
        const started = startReadWeaveGenerationJob(request);
        await waitForStatus(started.jobId, "complete");
        generateMock.mockClear();

        const updatedFragments: ReadWeaveGenerateRequest["fragments"] = [
            { id: "selected", role: "selected", text: "BS-PDN-Last:" },
            {
                id: "section",
                role: "section",
                text: "BS-PDN-Last：面向具有多功能背面金属层的最优电源分配网络设计"
            }
        ];
        generateMock.mockResolvedValueOnce(result(
            "BS-PDN-Last 是一种面向背面供电网络的设计方法；它在给定设计约束下组织供电路径，并以可检查的网络结果作为输出"
        ));
        const regenerating = regenerateReadWeaveGenerationJob(started.jobId, {
            title: "BS-PDN-Last是什么",
            optimizeQuestion: true,
            fragments: updatedFragments
        });
        expect(regenerating.title).toBe("BS-PDN-Last是什么");
        expect(regenerating.sourceExcerpt).toBe("BS-PDN-Last:");

        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.title).toBe("BS-PDN-Last是什么");
        expect(completed.sourceExcerpt).toBe("BS-PDN-Last:");
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(generateMock.mock.calls[0][0]).toMatchObject({
            title: "BS-PDN-Last是什么",
            optimizeQuestion: true,
            fragments: updatedFragments
        });
        expect(completed.progress[0]?.message).toContain("当前问题");
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

    it("automatically rebuilds legacy rejected drafts and recoverable verification failures on startup", async () => {
        const now = new Date().toISOString();
        const dirtyJobId = "legacy_dirty_complete";
        const protocolJobId = "legacy_protocol_failure";
        const insert = (jobId: string, status: "complete" | "failed", storedResult: ReadWeaveGenerateResponse | null, error: string | null) => {
            sql.execute(/* sql */`
                INSERT INTO readweave_generation_jobs (
                    jobId, articleId, anchorId, anchorType, kind, title, sourceExcerpt,
                    requestJson, status, resultJson, error, unread, feedback, isProtected, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, ?, ?)
            `, [
                jobId,
                request.articleId,
                `${request.anchorId}-${jobId}`,
                request.anchorType,
                request.kind,
                request.title,
                "测试片段",
                JSON.stringify({ ...request, anchorId: `${request.anchorId}-${jobId}` }),
                status,
                storedResult ? JSON.stringify(storedResult) : null,
                error,
                now,
                now
            ]);
            sql.execute(/* sql */`
                INSERT INTO readweave_generation_events (jobId, sequence, progressJson, createdAt)
                VALUES (?, 9, ?, ?)
            `, [ jobId, JSON.stringify({ stage: "failed", round: 0, message: "旧日志", issues: [ "旧错误" ] }), now ]);
        };
        insert(dirtyJobId, "complete", {
            ...result("旧版未通过内部检查的草稿；"),
            reviewIssues: [ "旧版格式检查未通过" ]
        }, null);
        insert(protocolJobId, "failed", null, "Invalid verification repair plan");
        generateMock
            .mockResolvedValueOnce(result("旧版脏草稿已自动重建；"))
            .mockResolvedValueOnce(result("检查协议失败已自动恢复；"));

        initializeReadWeaveGenerationJobs();
        const [ rebuilt, recovered ] = await Promise.all([
            waitForStatus(dirtyJobId, "complete"),
            waitForStatus(protocolJobId, "complete")
        ]);

        expect(rebuilt.result?.reviewIssues).toBeUndefined();
        expect(rebuilt.result?.body).toContain("自动重建");
        expect(recovered.result?.body).toContain("自动恢复");
        expect(rebuilt.progress.some(event => event.message.includes("旧版未通过内部检查"))).toBe(true);
        expect(recovered.progress.some(event => event.message.includes("旧版检查协议中断"))).toBe(true);
        expect(rebuilt.progress.some(event => event.message === "旧日志")).toBe(false);
        expect(recovered.progress.some(event => event.message === "旧日志")).toBe(false);
    });

    it("reuses the same unsaved definition job for an identical fragment", () => {
        const termRequest: ReadWeaveGenerateRequest = { ...request, kind: "term", title: "NPU", termIdentity: { abbreviation: "NPU" } };
        const first = startReadWeaveGenerationJob(termRequest);
        const second = startReadWeaveGenerationJob(termRequest);
        expect(second.jobId).toBe(first.jobId);
    });

    it("auto-saves a verified method name that has no expandable abbreviation", async () => {
        generateMock.mockResolvedValueOnce({
            ...result("BS-PDN-Last 是一种背面供电网络设计方法；它面向供电路径的组织与约束检查，并输出可继续验证的网络设计结果"),
            verifiedNonExpandableArtifact: {
                originalName: "BS-PDN-Last",
                entityType: "method"
            }
        });
        const started = startReadWeaveGenerationJob({
            ...request,
            kind: "term",
            title: "BS-PDN-Last",
            termIdentity: undefined
        });
        const completed = await waitForStatus(started.jobId, "complete");
        expect(completed.result?.verifiedNonExpandableArtifact).toEqual({
            originalName: "BS-PDN-Last",
            entityType: "method"
        });
        expect(completed.savedLinkId).toBeTruthy();
        expect(getEntriesForAnchor(request.articleId, request.anchorId)[0].title).toBe("BS-PDN-Last");
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
