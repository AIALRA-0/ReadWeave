import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse, ReadWeaveSourceLocator } from "@triliumnext/commons";
import { cls, hidden_subtree as hiddenSubtreeService, note_service as noteService, protected_session as protectedSessionModule } from "@triliumnext/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NonRetryableReadWeaveError } from "./readweave_errors.js";

const generateMock = vi.hoisted(() => vi.fn());
const protectedSession = protectedSessionModule.default;

vi.mock("./readweave_ai.js", async importOriginal => ({
    ...(await importOriginal<typeof import("./readweave_ai.js")>()),
    generateReadWeaveAnswer: generateMock
}));

import {
    cancelReadWeaveGenerationJob,
    claimReadWeaveGenerationJobLeaseForTests,
    commitReadWeaveGenerationJob,
    discardReadWeaveGenerationJob,
    getReadWeaveGenerationEvents,
    getReadWeaveGenerationJob,
    initializeReadWeaveGenerationJobs,
    listReadWeaveGenerationJobs,
    listReadWeaveGenerationJobsGlobal,
    markReadWeaveGenerationJobViewed,
    regenerateReadWeaveGenerationJob,
    setReadWeaveCommitFaultForTests,
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
        qualityState: "verified",
        evidenceState: "externally-checked",
        harnessVersion: "test-harness",
        unresolvedIssues: [],
        context: { fragmentIds: [ "selected" ], characterCount: 4, characterBudget: 800, expansionLevel: 0, attemptedBudgets: [ 800 ] },
        workflow: { generationAttempts: 1, validationPasses: 1, contextExpansions: 0, repairRounds: 0, unchangedSegmentsVerified: true },
        provider: "test",
        model: "test-model"
    };
}

async function waitForStatus(jobId: string, status: "ready-for-review" | "saved" | "paused" | "failed") {
    for (let attempt = 0; attempt < 400; attempt++) {
        const job = getReadWeaveGenerationJob(jobId);
        if (job.status === status) return job;
        if (job.status === "failed") {
            throw new Error(`Job ${jobId} failed: ${job.error}; ${job.progress.flatMap(event => event.issues).join(" | ")}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Job ${jobId} did not reach ${status}.`);
}

async function waitUntil(predicate: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("Condition was not reached");
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
        sql.execute("DELETE FROM readweave_generation_changes");
        sql.execute("DELETE FROM readweave_generation_jobs");
        setReadWeaveCommitFaultForTests(undefined);
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
        expect(started.qualityState).toBe("provisional");
        expect(started.harnessVersion).toBe("quality-closure-v2.2.0");
        expect(started.evidenceState).toBe("not-checked");
        const completed = await waitForStatus(started.jobId, "ready-for-review");
        expect(completed.unread).toBe(true);
        expect(completed.savedLinkId).toBeUndefined();
        expect(getEntriesForAnchor(request.articleId, request.anchorId)).toHaveLength(0);
        const saved = commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: completed.stateVersion });
        expect(saved.status).toBe("saved");
        expect(saved.savedLinkId).toBeTruthy();
        expect(getEntriesForAnchor(request.articleId, request.anchorId)).toHaveLength(1);
        expect(getEntriesForAnchor(request.articleId, request.anchorId)[0]).toMatchObject({
            linkId: saved.savedLinkId,
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

    it("round-trips a source locator through the job, commit and saved link", async () => {
        const sourceLocator: ReadWeaveSourceLocator = {
            version: 1,
            blockIndex: 2,
            startOffset: 8,
            endOffset: 11,
            prefix: "前文",
            suffix: "后文"
        };
        const started = startReadWeaveGenerationJob({ ...request, anchorId: "range_jobs_locator", sourceLocator });
        expect(started.sourceLocator).toEqual(sourceLocator);
        const ready = await waitForStatus(started.jobId, "ready-for-review");
        expect(ready.sourceLocator).toEqual(sourceLocator);

        const saved = commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: ready.stateVersion });
        expect(saved.sourceLocator).toEqual(sourceLocator);
        expect(getEntriesForAnchor(request.articleId, "range_jobs_locator")[0].sourceLocator).toEqual(sourceLocator);
        expect(getAnchorSummaries(request.articleId).find(summary => summary.anchorId === "range_jobs_locator")?.sourceLocator)
            .toEqual(sourceLocator);
    });

    it("commits once with optimistic concurrency and returns the same saved link on retries", async () => {
        const anchorId = "range_jobs_commit_once";
        const started = startReadWeaveGenerationJob({ ...request, anchorId, title: "原子提交测试" });
        const ready = await waitForStatus(started.jobId, "ready-for-review");
        expect(getEntriesForAnchor(request.articleId, anchorId)).toHaveLength(0);

        const saved = commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: ready.stateVersion });
        const retried = commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: ready.stateVersion });

        expect(saved.status).toBe("saved");
        expect(retried.savedLinkId).toBe(saved.savedLinkId);
        expect(getEntriesForAnchor(request.articleId, anchorId)).toHaveLength(1);
        expect(() => commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: saved.stateVersion - 1 })).not.toThrow();
    });

    it.each([ "after-object", "after-link", "before-task-update" ] as const)("rolls back the entire commit when failure is injected at %s", async faultPoint => {
        const anchorId = `range_jobs_rollback_${faultPoint}`;
        const started = startReadWeaveGenerationJob({ ...request, anchorId, title: `回滚测试 ${faultPoint}` });
        const ready = await waitForStatus(started.jobId, "ready-for-review");
        const objectBranchesBefore = sql.getValue<number>("SELECT COUNT(*) FROM branches WHERE parentNoteId = '_readweaveObjects' AND isDeleted = 0");
        const linkBranchesBefore = sql.getValue<number>("SELECT COUNT(*) FROM branches WHERE parentNoteId = '_readweaveLinks' AND isDeleted = 0");
        setReadWeaveCommitFaultForTests(faultPoint);
        try {
            expect(() => commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: ready.stateVersion })).toThrow("Injected ReadWeave commit fault");
        } finally {
            setReadWeaveCommitFaultForTests(undefined);
        }
        expect(getReadWeaveGenerationJob(started.jobId).status).toBe("ready-for-review");
        expect(getEntriesForAnchor(request.articleId, anchorId)).toHaveLength(0);
        expect(sql.getValue<number>("SELECT COUNT(*) FROM branches WHERE parentNoteId = '_readweaveObjects' AND isDeleted = 0")).toBe(objectBranchesBefore);
        expect(sql.getValue<number>("SELECT COUNT(*) FROM branches WHERE parentNoteId = '_readweaveLinks' AND isDeleted = 0")).toBe(linkBranchesBefore);
    });

    it("persists deletion tombstones so an old snapshot cannot resurrect a discarded task", async () => {
        const started = startReadWeaveGenerationJob({ ...request, anchorId: "range_jobs_tombstone", title: "墓碑测试" });
        await waitForStatus(started.jobId, "ready-for-review");
        const initial = listReadWeaveGenerationJobsGlobal(0);
        expect(initial.jobs.some(job => job.jobId === started.jobId)).toBe(true);

        discardReadWeaveGenerationJob(started.jobId);
        const delta = listReadWeaveGenerationJobsGlobal(initial.nextCursor);
        expect(delta.removedJobIds).toContain(started.jobId);
        expect(delta.jobs.some(job => job.jobId === started.jobId)).toBe(false);
    });

    it("keeps three questions independent while running at most two model calls", async () => {
        const releases: Array<(value: ReadWeaveGenerateResponse) => void> = [];
        let active = 0;
        let maximumActive = 0;
        generateMock.mockImplementation(async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            return await new Promise<ReadWeaveGenerateResponse>(resolve => {
                releases.push(value => {
                    active -= 1;
                    resolve(value);
                });
            });
        });

        const jobs = [ "a", "b", "c" ].map(suffix => startReadWeaveGenerationJob({
            ...request,
            anchorId: `range_jobs_${suffix}`,
            title: `独立问题 ${suffix}`
        }));
        await waitUntil(() => releases.length === 2);

        expect(new Set(jobs.map(job => job.jobId)).size).toBe(3);
        expect(new Set(jobs.map(job => job.draftId)).size).toBe(3);
        expect(maximumActive).toBe(2);
        expect(getReadWeaveGenerationJob(jobs[2].jobId).status).toBe("queued");

        releases.shift()?.(result("第一个并发任务独立完成"));
        await waitUntil(() => releases.length === 2);
        expect(maximumActive).toBe(2);
        for (const release of releases.splice(0)) release(result("其余并发任务独立完成"));
        await Promise.all(jobs.map(job => waitForStatus(job.jobId, "ready-for-review")));
    });

    it("allows only one service instance to claim the same queued attempt", () => {
        const now = new Date().toISOString();
        const jobId = "lease_competition_job";
        sql.execute(/* sql */`
            INSERT INTO readweave_generation_jobs (
                jobId, draftId, stateVersion, activeAttemptId, articleId, anchorId, anchorType, kind,
                title, sourceExcerpt, requestJson, status, unread, isProtected, createdAt, updatedAt
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?, ?)
        `, [
            jobId,
            "lease_competition_draft",
            "lease_competition_attempt",
            request.articleId,
            "lease_competition_anchor",
            request.anchorType,
            request.kind,
            request.title,
            "测试片段",
            JSON.stringify({ ...request, anchorId: "lease_competition_anchor" }),
            now,
            now
        ]);

        const first = claimReadWeaveGenerationJobLeaseForTests(jobId, "service-instance-a");
        const second = claimReadWeaveGenerationJobLeaseForTests(jobId, "service-instance-b");

        expect(first).toBe("lease_competition_attempt");
        expect(second).toBeUndefined();
        expect(sql.getValue<string>("SELECT leaseOwner FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ])).toBe("service-instance-a");
    });

    it("does not let protected or damaged jobs at the queue head block a healthy job", async () => {
        const old = new Date(Date.now() - 60_000).toISOString();
        const insertQueued = (jobId: string, requestJson: string, isProtected: number) => {
            sql.execute(/* sql */`
                INSERT INTO readweave_generation_jobs (
                    jobId, draftId, stateVersion, activeAttemptId, articleId, anchorId, anchorType, kind,
                    title, sourceExcerpt, requestJson, status, unread, isProtected, createdAt, updatedAt
                ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
            `, [
                jobId,
                `${jobId}_draft`,
                `${jobId}_attempt`,
                request.articleId,
                `${jobId}_anchor`,
                request.anchorType,
                request.kind,
                request.title,
                "测试片段",
                requestJson,
                isProtected,
                old,
                old
            ]);
        };
        insertQueued("queue_head_protected", "encrypted-unavailable", 1);
        insertQueued("queue_head_damaged", "{not-json", 0);

        const healthy = startReadWeaveGenerationJob({ ...request, anchorId: "queue_head_healthy" });
        const completed = await waitForStatus(healthy.jobId, "ready-for-review");

        expect(completed.result?.body).toBeTruthy();
        expect(sql.getRow("SELECT status, failureClass FROM readweave_generation_jobs WHERE jobId = ?", [ "queue_head_protected" ])).toMatchObject({
            status: "paused",
            failureClass: "protected-session"
        });
        expect(getReadWeaveGenerationJob("queue_head_damaged")).toMatchObject({
            status: "failed",
            failureClass: "internal"
        });
    });

    it("keeps a cancelled job visible and ignores its late model result", async () => {
        let receivedSignal: AbortSignal | undefined;
        generateMock.mockImplementationOnce(async (_request, _onProgress, signal: AbortSignal) => await new Promise<ReadWeaveGenerateResponse>((resolve, reject) => {
            receivedSignal = signal;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }));
        const started = startReadWeaveGenerationJob({ ...request, anchorId: "range_jobs_cancel", title: "待取消问题" });
        await waitUntil(() => getReadWeaveGenerationJob(started.jobId).status === "running");

        const cancelled = cancelReadWeaveGenerationJob(started.jobId);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.failureClass).toBe("cancelled");
        expect(cancelled.progress.at(-1)?.stage).toBe("cancelled");

        expect(receivedSignal?.aborted).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(getReadWeaveGenerationJob(started.jobId).status).toBe("cancelled");
        expect(getReadWeaveGenerationJob(started.jobId).result).toBeUndefined();
    });

    it("persists an unresolved answer as a yellow draft without restarting the complete workflow", async () => {
        generateMock.mockResolvedValueOnce({
            ...result("这是仍含内部质量问题的首稿；"),
            qualityState: "provisional",
            unresolvedIssues: [ "核心事实尚未独立核验" ],
            reviewIssues: [ "核心事实尚未独立核验" ]
        });

        const started = startReadWeaveGenerationJob(request);
        const completed = await waitForStatus(started.jobId, "ready-for-review");

        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(completed.result?.qualityState).toBe("provisional");
        expect(completed.result?.reviewIssues).toEqual([ "核心事实尚未独立核验" ]);
        expect(completed.progress.some(event => event.message.includes("正在自动重试第 2 次"))).toBe(false);
    });

    it("keeps a non-empty answer with format warnings as a provisional review draft", async () => {
        generateMock.mockResolvedValueOnce({
            ...result("这份草稿仍有格式问题"),
            qualityState: "provisional",
            unresolvedIssues: [ "回答包含乱码字符" ],
            reviewIssues: [ "回答包含乱码字符" ]
        });

        const started = startReadWeaveGenerationJob({ ...request, anchorId: "range_jobs_format", title: "格式门测试" });
        const ready = await waitForStatus(started.jobId, "ready-for-review");

        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(ready.qualityState).toBe("provisional");
        expect(ready.failureClass).toBeUndefined();
        expect(ready.result?.body).toContain("这份草稿仍有格式问题");
        expect(ready.unresolvedIssues).toContain("回答包含乱码字符");
        expect(ready.savedLinkId).toBeUndefined();
        expect(getEntriesForAnchor(request.articleId, "range_jobs_format")).toHaveLength(0);
    });

    it("pauses a semantic protocol failure without replaying the whole workflow", async () => {
        generateMock.mockRejectedValueOnce(new Error("内部检查协议未能形成有效修复计划"));

        const started = startReadWeaveGenerationJob(request);
        const paused = await waitForStatus(started.jobId, "paused");

        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(paused.failureClass).toBe("semantic");
        expect(paused.error).toContain("内部检查协议未能形成有效修复计划");
        expect(paused.progress.some(event => event.stage === "paused")).toBe(true);
    });

    it("classifies provider configuration failures without retrying or re-queueing", async () => {
        generateMock.mockRejectedValue(new Error("401 invalid API key"));

        const started = startReadWeaveGenerationJob({ ...request, anchorId: "range_jobs_configuration" });
        const paused = await waitForStatus(started.jobId, "paused");

        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(paused.failureClass).toBe("configuration");
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(generateMock).toHaveBeenCalledTimes(1);
    });

    it("retries transport failures once and then waits for a manual retry", async () => {
        generateMock.mockRejectedValue(new Error("upstream timeout"));

        const started = startReadWeaveGenerationJob({ ...request, anchorId: "range_jobs_transport" });
        const paused = await waitForStatus(started.jobId, "paused");

        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(paused.failureClass).toBe("transport");
        expect(paused.progress.some(event => event.message.includes("自动恢复第 2 次"))).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(generateMock).toHaveBeenCalledTimes(2);
    });

    it("pauses without replay when evidence is only bibliographic metadata", async () => {
        generateMock.mockRejectedValue(new NonRetryableReadWeaveError(
            "ReadWeave 统一质量门未通过：事实引用的来源只有题名、DOI 或短标题，不能支撑该技术内容"
        ));

        const started = startReadWeaveGenerationJob(request);
        const paused = await waitForStatus(started.jobId, "paused");

        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(paused.error).toContain("只有题名、DOI 或短标题");
        expect(paused.failureClass).toBe("evidence");
        expect(paused.progress.some(event => event.message.includes("自动恢复第 2 次"))).toBe(false);
    });

    it("allows regeneration without feedback while retaining the previous result and resetting progress", async () => {
        const started = startReadWeaveGenerationJob(request);
        const firstCompleted = await waitForStatus(started.jobId, "ready-for-review");
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
        const completed = await waitForStatus(started.jobId, "ready-for-review");
        expect(completed.result?.body).toContain("新回答");
        expect(completed.savedLinkId).toBeUndefined();
        expect(firstCompleted.result?.body).not.toContain("新回答");
        expect(completed.feedback).toBeUndefined();
        expect(discardReadWeaveGenerationJob(started.jobId)).toEqual({ discarded: true });
        expect(() => getReadWeaveGenerationJob(started.jobId)).toThrow();
    });

    it("regenerates with the question, selection and options currently shown in the editor", async () => {
        const started = startReadWeaveGenerationJob(request);
        await waitForStatus(started.jobId, "ready-for-review");
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

        const completed = await waitForStatus(started.jobId, "ready-for-review");
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
        const recovered = await waitForStatus(jobId, "ready-for-review");
        expect(recovered.progress.some(event => event.message.includes("服务器恢复了未完成任务"))).toBe(true);
    });

    it("demotes legacy green drafts and recovers only interrupted verification protocols on startup", async () => {
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
        generateMock.mockResolvedValueOnce(result("检查协议失败已自动恢复；"));

        initializeReadWeaveGenerationJobs();
        const rebuilt = getReadWeaveGenerationJob(dirtyJobId);
        const recovered = await waitForStatus(protocolJobId, "ready-for-review");

        expect(rebuilt.status).toBe("ready-for-review");
        expect(rebuilt.qualityState).toBe("legacy-unverified");
        expect(rebuilt.result?.reviewIssues).toEqual([ "旧版格式检查未通过" ]);
        expect(recovered.result?.body).toContain("自动恢复");
        expect(recovered.progress.some(event => event.message.includes("旧版检查协议中断"))).toBe(true);
        expect(rebuilt.progress.some(event => event.message === "旧日志")).toBe(true);
        expect(recovered.progress.some(event => event.message === "旧日志")).toBe(false);
    });

    it("reuses the same unsaved definition job for an identical fragment", () => {
        const termRequest: ReadWeaveGenerateRequest = { ...request, kind: "term", title: "NPU", termIdentity: { abbreviation: "NPU" } };
        const first = startReadWeaveGenerationJob(termRequest);
        const second = startReadWeaveGenerationJob(termRequest);
        expect(second.jobId).toBe(first.jobId);
    });

    it("keeps a verified method name as a review draft until explicit commit", async () => {
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
        const completed = await waitForStatus(started.jobId, "ready-for-review");
        expect(completed.result?.verifiedNonExpandableArtifact).toEqual({
            originalName: "BS-PDN-Last",
            entityType: "method"
        });
        expect(completed.savedLinkId).toBeUndefined();
        expect(getEntriesForAnchor(request.articleId, request.anchorId)).toHaveLength(0);
        const saved = commitReadWeaveGenerationJob(started.jobId, { expectedStateVersion: completed.stateVersion });
        expect(saved.savedLinkId).toBeTruthy();
        expect(getEntriesForAnchor(request.articleId, request.anchorId)[0].title).toBe("BS-PDN-Last");
    });

    it("encrypts every protected-note payload and refuses access while the protected session is locked", async () => {
        generateMock.mockResolvedValueOnce({
            ...result("受保护的回答草稿只应在会话解锁后读取；后台任务状态可以恢复，但任何正文和问题详情都不能明文写入数据库"),
            qualityState: "provisional",
            unresolvedIssues: [ "受保护的私密核验问题" ]
        });
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
        await waitForStatus(started.jobId, "ready-for-review");

        const rawJob = sql.getRow<{
            isProtected: number;
            title: string;
            sourceExcerpt: string;
            requestJson: string;
            resultJson: string;
            unresolvedIssuesJson: string;
            issuesJson: string;
        }>(
            "SELECT isProtected, title, sourceExcerpt, requestJson, resultJson, unresolvedIssuesJson, issuesJson FROM readweave_generation_jobs WHERE jobId = ?",
            [ started.jobId ]
        );
        const rawEvents = sql.getColumn<string>("SELECT progressJson FROM readweave_generation_events WHERE jobId = ?", [ started.jobId ]);
        expect(rawJob.isProtected).toBe(1);
        expect(JSON.stringify({ rawJob, rawEvents })).not.toContain("绝不能明文落库");
        expect(JSON.stringify({ rawJob, rawEvents })).not.toContain("受保护的私密核验问题");
        expect(getReadWeaveGenerationJob(started.jobId).title).toBe("受保护的问题");

        protectedSession.resetDataKey();
        expect(() => getReadWeaveGenerationJob(started.jobId)).toThrow(/protected session/i);
        const lockedSnapshot = listReadWeaveGenerationJobsGlobal(0);
        expect(lockedSnapshot.jobs.some(job => job.jobId === started.jobId)).toBe(false);
        expect(lockedSnapshot.nextCursor).toBe(0);
        protectedSession.setDataKey(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
        expect(getReadWeaveGenerationJob(started.jobId).sourceExcerpt).toBe("绝不能明文落库的片段");
        const unlockedSnapshot = listReadWeaveGenerationJobsGlobal(lockedSnapshot.nextCursor);
        expect(unlockedSnapshot.jobs.some(job => job.jobId === started.jobId)).toBe(true);
        discardReadWeaveGenerationJob(started.jobId);
        protectedSession.resetDataKey();
    });

    it("pauses a protected task when the session locks during model execution", async () => {
        let release!: (value: ReadWeaveGenerateResponse) => void;
        generateMock.mockImplementationOnce(() => new Promise<ReadWeaveGenerateResponse>(resolve => {
            release = resolve;
        }));
        const dataKey = Uint8Array.from({ length: 16 }, (_, index) => index + 31);
        protectedSession.setDataKey(dataKey);
        const protectedArticle = cls.init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Protected mid-run lock article",
            type: "text",
            mime: "text/html",
            isProtected: true,
            content: "<p>运行中锁定测试</p>"
        }).note);
        const started = startReadWeaveGenerationJob({
            ...request,
            articleId: protectedArticle.noteId,
            anchorId: "protected_mid_run_lock",
            title: "运行中锁定的问题",
            fragments: [ { id: "selected", role: "selected", text: "运行中锁定测试" } ]
        });
        await waitUntil(() => sql.getValue<string>("SELECT status FROM readweave_generation_jobs WHERE jobId = ?", [ started.jobId ]) === "running");

        protectedSession.resetDataKey();
        release(result("迟到的受保护回答不能在密钥锁定后写入任务草稿；任务必须保留为暂停状态，并在用户重新解锁后再安全生成"));
        await waitUntil(() => sql.getValue<string>("SELECT status FROM readweave_generation_jobs WHERE jobId = ?", [ started.jobId ]) === "paused");

        const raw = sql.getRow<{ status: string; failureClass: string; resultJson: string | null }>(
            "SELECT status, failureClass, resultJson FROM readweave_generation_jobs WHERE jobId = ?",
            [ started.jobId ]
        );
        expect(raw).toMatchObject({ status: "paused", failureClass: "protected-session", resultJson: null });
        protectedSession.setDataKey(dataKey);
        discardReadWeaveGenerationJob(started.jobId);
        protectedSession.resetDataKey();
    });
});
