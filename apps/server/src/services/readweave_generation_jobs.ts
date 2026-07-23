import type {
    ReadWeaveGenerateRequest,
    ReadWeaveGenerateResponse,
    ReadWeaveGenerationIssue,
    ReadWeaveGenerationIssueCategory,
    ReadWeaveGenerationJob,
    ReadWeaveGenerationProgress
} from "@triliumnext/commons";
import { becca, NotFoundError, protected_session as protectedSessionModule, ValidationError } from "@triliumnext/core";
import { randomUUID } from "crypto";

import { generateReadWeaveAnswer, mergeReadWeaveTermIdentity } from "./readweave_ai.js";
import sql from "./sql.js";

interface JobRow {
    jobId: string;
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveGenerateRequest["anchorType"];
    kind: ReadWeaveGenerateRequest["kind"];
    title: string;
    sourceExcerpt: string;
    requestJson: string;
    status: ReadWeaveGenerationJob["status"];
    resultJson: string | null;
    error: string | null;
    unread: number;
    feedback: string | null;
    isProtected: number;
    createdAt: string;
    updatedAt: string;
}

interface EventRow {
    sequence: number;
    progressJson: string;
    createdAt: string;
}

const activeJobs = new Set<string>();
const cancelledJobs = new Set<string>();
const protectedSession = protectedSessionModule.default;
let storageReady = false;

function requireReadableArticle(articleId: string) {
    const article = becca.getNoteOrThrow(articleId);
    if (!article.isContentAvailable()) throw new ValidationError("Article is unavailable in the current protected session.");
    return article;
}

function encodeStoredValue(value: string | null, isProtected: boolean): string | null {
    if (value === null || !isProtected) return value;
    const encrypted = protectedSession.encrypt(value);
    if (!encrypted) throw new ValidationError("The protected session must be unlocked to store this ReadWeave task.");
    return encrypted;
}

function decodeStoredValue(value: string | null, isProtected: number): string | null {
    if (value === null || !isProtected) return value;
    const decrypted = protectedSession.decryptString(value);
    if (decrypted === null) throw new ValidationError("The protected session must be unlocked to read this ReadWeave task.");
    return decrypted;
}

function ensureStorage() {
    if (storageReady) return;
    sql.executeScript(/* sql */`
        CREATE TABLE IF NOT EXISTS readweave_generation_jobs (
            jobId TEXT PRIMARY KEY,
            articleId TEXT NOT NULL,
            anchorId TEXT NOT NULL,
            anchorType TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            sourceExcerpt TEXT NOT NULL,
            requestJson TEXT NOT NULL,
            status TEXT NOT NULL,
            resultJson TEXT,
            error TEXT,
            unread INTEGER NOT NULL DEFAULT 0,
            feedback TEXT,
            isProtected INTEGER NOT NULL DEFAULT 0,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS readweave_generation_jobs_article
            ON readweave_generation_jobs(articleId, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS readweave_generation_jobs_anchor
            ON readweave_generation_jobs(articleId, anchorId, kind, updatedAt DESC);
        CREATE TABLE IF NOT EXISTS readweave_generation_events (
            jobId TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            progressJson TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            PRIMARY KEY (jobId, sequence)
        );
        CREATE INDEX IF NOT EXISTS readweave_generation_events_job
            ON readweave_generation_events(jobId, sequence);
    `);
    const columns = sql.getColumn<string>("SELECT name FROM pragma_table_info('readweave_generation_jobs')");
    if (!columns.includes("isProtected")) {
        sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN isProtected INTEGER NOT NULL DEFAULT 0");
    }

    // This also safely upgrades any development-era plaintext rows created before
    // background tasks inherited Trilium's protected-note encryption semantics.
    for (const row of sql.getRows<JobRow>("SELECT * FROM readweave_generation_jobs WHERE isProtected = 0")) {
        const article = becca.getNote(row.articleId);
        if (!article?.isProtected) continue;
        if (!article.isContentAvailable()) {
            sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ row.jobId ]);
            sql.execute("DELETE FROM readweave_generation_jobs WHERE jobId = ?", [ row.jobId ]);
            continue;
        }
        const fields = [ "title", "sourceExcerpt", "requestJson", "resultJson", "error", "feedback" ] as const;
        const values = fields.map(field => encodeStoredValue(row[field], true));
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET title = ?, sourceExcerpt = ?, requestJson = ?, resultJson = ?, error = ?, feedback = ?, isProtected = 1
            WHERE jobId = ?
        `, [ ...values, row.jobId ]);
        for (const event of sql.getRows<EventRow>("SELECT sequence, progressJson, createdAt FROM readweave_generation_events WHERE jobId = ?", [ row.jobId ])) {
            sql.execute("UPDATE readweave_generation_events SET progressJson = ? WHERE jobId = ? AND sequence = ?", [
                encodeStoredValue(event.progressJson, true), row.jobId, event.sequence
            ]);
        }
    }
    storageReady = true;
}

function parseJson<T>(value: string | null): T | undefined {
    if (!value) return undefined;
    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function requestFor(row: JobRow): ReadWeaveGenerateRequest {
    requireReadableArticle(row.articleId);
    const request = parseJson<ReadWeaveGenerateRequest>(decodeStoredValue(row.requestJson, row.isProtected));
    if (!request) throw new ValidationError("ReadWeave generation request is corrupted.");
    return request;
}

function eventsFor(jobId: string, afterSequence = 0): ReadWeaveGenerationProgress[] {
    ensureStorage();
    const job = sql.getRowOrNull<Pick<JobRow, "articleId" | "isProtected">>("SELECT articleId, isProtected FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
    if (!job) return [];
    requireReadableArticle(job.articleId);
    return sql.getRows<EventRow>(/* sql */`
        SELECT sequence, progressJson, createdAt
        FROM readweave_generation_events
        WHERE jobId = ? AND sequence > ?
        ORDER BY sequence
        LIMIT 200
    `, [ jobId, afterSequence ]).flatMap(row => {
        const progress = parseJson<ReadWeaveGenerationProgress>(decodeStoredValue(row.progressJson, job.isProtected));
        return progress ? [ { ...progress, sequence: row.sequence, timestamp: progress.timestamp ?? row.createdAt } ] : [];
    });
}

function publicJob(row: JobRow, includeProgress = true): ReadWeaveGenerationJob {
    requireReadableArticle(row.articleId);
    const storedResult = parseJson<ReadWeaveGenerateResponse>(decodeStoredValue(row.resultJson, row.isProtected));
    let result = storedResult;
    if (row.kind === "term" && storedResult?.termIdentity) {
        try {
            result = { ...storedResult, termIdentity: mergeReadWeaveTermIdentity(storedResult.termIdentity, undefined) };
        } catch {
            // Keep the persisted draft visible for manual recovery if a legacy
            // model result is too malformed to normalize safely.
        }
    }
    return {
        jobId: row.jobId,
        articleId: row.articleId,
        anchorId: row.anchorId,
        anchorType: row.anchorType,
        kind: row.kind,
        title: decodeStoredValue(row.title, row.isProtected) ?? "",
        sourceExcerpt: decodeStoredValue(row.sourceExcerpt, row.isProtected) ?? "",
        status: row.status,
        unread: row.unread === 1,
        feedback: decodeStoredValue(row.feedback, row.isProtected) || undefined,
        progress: includeProgress ? eventsFor(row.jobId) : [],
        result,
        error: decodeStoredValue(row.error, row.isProtected) || undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

function rowFor(jobId: string): JobRow {
    ensureStorage();
    const row = sql.getRowOrNull<JobRow>("SELECT * FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
    if (!row) throw new NotFoundError("ReadWeave generation job was not found.");
    return row;
}

function categoryForIssue(message: string): ReadWeaveGenerationIssueCategory {
    if (/格式|全称|缩写|标点|英文名词|canonical|format/i.test(message)) return "format";
    if (/作者|人名|实体|产品|组织|术语|entity|author/i.test(message)) return "entity";
    if (/证据|来源|联网|事实|时效|evidence|source/i.test(message)) return "evidence";
    if (/守恒|片段|遗漏|篡改|integrity|segment/i.test(message)) return "integrity";
    return "other";
}

function issueCode(category: ReadWeaveGenerationIssueCategory, index: number): string {
    return `RW-${category.toUpperCase()}-${String(index + 1).padStart(2, "0")}`;
}

function structuredIssues(progress: ReadWeaveGenerationProgress): ReadWeaveGenerationIssue[] {
    if (progress.issueGroups?.length) return progress.issueGroups;
    return progress.issues.map((message, index) => {
        const category = categoryForIssue(message);
        return { code: issueCode(category, index), category, message };
    });
}

function appendProgress(jobId: string, input: ReadWeaveGenerationProgress) {
    ensureStorage();
    const row = sql.getRowOrNull<Pick<JobRow, "articleId" | "createdAt" | "isProtected">>("SELECT articleId, createdAt, isProtected FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
    if (!row) return;
    requireReadableArticle(row.articleId);
    const timestamp = new Date().toISOString();
    const sequence = (sql.getValue<number>("SELECT COALESCE(MAX(sequence), 0) + 1 FROM readweave_generation_events WHERE jobId = ?", [ jobId ]) ?? 1);
    const progress: ReadWeaveGenerationProgress = {
        ...input,
        sequence,
        timestamp,
        elapsedMs: Math.max(0, Date.now() - Date.parse(row.createdAt)),
        issueGroups: structuredIssues(input)
    };
    sql.execute(/* sql */`
        INSERT INTO readweave_generation_events (jobId, sequence, progressJson, createdAt)
        VALUES (?, ?, ?, ?)
    `, [ jobId, sequence, encodeStoredValue(JSON.stringify(progress), !!row.isProtected), timestamp ]);
    sql.execute("UPDATE readweave_generation_jobs SET updatedAt = ? WHERE jobId = ?", [ timestamp, jobId ]);
}

function setJobState(jobId: string, status: ReadWeaveGenerationJob["status"], values: { result?: ReadWeaveGenerateResponse; error?: string; unread?: boolean } = {}) {
    const row = rowFor(jobId);
    const updatedAt = new Date().toISOString();
    sql.execute(/* sql */`
        UPDATE readweave_generation_jobs
        SET status = ?, resultJson = COALESCE(?, resultJson), error = ?, unread = ?, updatedAt = ?
        WHERE jobId = ?
    `, [
        status,
        values.result ? encodeStoredValue(JSON.stringify(values.result), !!row.isProtected) : null,
        encodeStoredValue(values.error ?? null, !!row.isProtected),
        values.unread ? 1 : 0,
        updatedAt,
        jobId
    ]);
}

function runJob(jobId: string) {
    if (activeJobs.has(jobId)) return;
    let row: JobRow;
    try {
        row = rowFor(jobId);
    } catch {
        return;
    }
    if (row.status !== "queued" && row.status !== "running") return;
    if (row.isProtected && !protectedSession.isProtectedSessionAvailable()) return;
    let request: ReadWeaveGenerateRequest;
    try {
        request = requestFor(row);
    } catch {
        return;
    }
    activeJobs.add(jobId);
    cancelledJobs.delete(jobId);
    setJobState(jobId, "running");
    if (eventsFor(jobId).length === 0) {
        appendProgress(jobId, { stage: "queued", round: 0, message: "后台任务已接收，正在准备生成。", issues: [] });
    }

    void generateReadWeaveAnswer(request, progress => appendProgress(jobId, progress)).then(result => {
        if (cancelledJobs.has(jobId)) return;
        setJobState(jobId, "complete", { result, unread: true });
    }).catch(error => {
        if (cancelledJobs.has(jobId)) return;
        const message = error instanceof Error ? error.message : "ReadWeave generation failed for an unknown reason.";
        appendProgress(jobId, { stage: "failed", round: 0, message: "生成失败，等待用户处理。", issues: [ message ] });
        setJobState(jobId, "failed", { error: message });
    }).finally(() => {
        activeJobs.delete(jobId);
        cancelledJobs.delete(jobId);
    });
}

function sourceExcerpt(request: ReadWeaveGenerateRequest): string {
    return request.fragments.find(fragment => fragment.role === "selected")?.text.trim().slice(0, 10_000)
        || request.title.trim().slice(0, 10_000);
}

export function initializeReadWeaveGenerationJobs() {
    ensureStorage();
    const interrupted = sql.getRows<JobRow>("SELECT * FROM readweave_generation_jobs WHERE status = 'running'");
    for (const row of interrupted) {
        sql.execute("UPDATE readweave_generation_jobs SET status = 'queued', updatedAt = ? WHERE jobId = ?", [ new Date().toISOString(), row.jobId ]);
        if (!row.isProtected || protectedSession.isProtectedSessionAvailable()) {
            appendProgress(row.jobId, { stage: "queued", round: 0, message: "服务器恢复了未完成任务，正在安全重启生成流程。", issues: [] });
        }
    }
    const queuedIds = sql.getColumn<string>("SELECT jobId FROM readweave_generation_jobs WHERE status = 'queued' ORDER BY createdAt");
    queuedIds.forEach(runJob);
}

export function startReadWeaveGenerationJob(request: ReadWeaveGenerateRequest): ReadWeaveGenerationJob {
    ensureStorage();
    if (!request.articleId || !request.anchorId || !request.title?.trim() || !Array.isArray(request.fragments)) {
        throw new ValidationError("ReadWeave generation request is incomplete.");
    }
    const article = requireReadableArticle(request.articleId);
    const isProtected = article.isProtected === true;
    if (request.kind === "term") {
        const existing = sql.getRowOrNull<JobRow>(/* sql */`
            SELECT * FROM readweave_generation_jobs
            WHERE articleId = ? AND anchorId = ? AND kind = 'term'
              AND status IN ('queued', 'running', 'complete')
            ORDER BY updatedAt DESC LIMIT 1
        `, [ request.articleId, request.anchorId ]);
        if (existing) return publicJob(existing);
    }
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const storedRequest = structuredClone(request);
    sql.execute(/* sql */`
        INSERT INTO readweave_generation_jobs (
            jobId, articleId, anchorId, anchorType, kind, title, sourceExcerpt,
            requestJson, status, resultJson, error, unread, feedback, isProtected, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, 0, ?, ?, ?, ?)
    `, [
        jobId,
        storedRequest.articleId,
        storedRequest.anchorId,
        storedRequest.anchorType,
        storedRequest.kind,
        encodeStoredValue(storedRequest.title.trim(), isProtected),
        encodeStoredValue(sourceExcerpt(storedRequest), isProtected),
        encodeStoredValue(JSON.stringify(storedRequest), isProtected),
        encodeStoredValue(storedRequest.feedback?.trim() || null, isProtected),
        isProtected ? 1 : 0,
        now,
        now
    ]);
    appendProgress(jobId, { stage: "queued", round: 0, message: "后台任务已接收，页面关闭后仍会继续。", issues: [] });
    runJob(jobId);
    return getReadWeaveGenerationJob(jobId);
}

export function getReadWeaveGenerationJob(jobId: string): ReadWeaveGenerationJob {
    return publicJob(rowFor(jobId));
}

export function listReadWeaveGenerationJobs(articleId: string): ReadWeaveGenerationJob[] {
    ensureStorage();
    if (!articleId.trim()) throw new ValidationError("articleId is required.");
    requireReadableArticle(articleId);
    const rows = sql.getRows<JobRow>(/* sql */`
        SELECT * FROM readweave_generation_jobs
        WHERE articleId = ?
        ORDER BY updatedAt DESC
        LIMIT 200
    `, [ articleId ]);
    rows.filter(row => row.status === "queued").forEach(row => runJob(row.jobId));
    return rows.map(row => publicJob(rowFor(row.jobId)));
}

export function getReadWeaveGenerationEvents(jobId: string, afterSequence = 0) {
    const row = rowFor(jobId);
    const events = eventsFor(jobId, Math.max(0, afterSequence));
    return {
        job: publicJob(row, false),
        events,
        nextSequence: events.at(-1)?.sequence ?? Math.max(0, afterSequence)
    };
}

export function markReadWeaveGenerationJobViewed(jobId: string): ReadWeaveGenerationJob {
    const row = rowFor(jobId);
    if (row.status === "complete" && row.unread) {
        sql.execute("UPDATE readweave_generation_jobs SET unread = 0, updatedAt = ? WHERE jobId = ?", [ new Date().toISOString(), jobId ]);
    }
    return getReadWeaveGenerationJob(jobId);
}

export function regenerateReadWeaveGenerationJob(jobId: string, feedbackValue: unknown): ReadWeaveGenerationJob {
    const row = rowFor(jobId);
    if (row.status === "running" || row.status === "queued") throw new ValidationError("ReadWeave generation is already running.");
    if (feedbackValue !== undefined && feedbackValue !== null && typeof feedbackValue !== "string") {
        throw new ValidationError("Regeneration feedback must be text.");
    }
    const feedback = typeof feedbackValue === "string" ? feedbackValue.trim() : "";
    if (feedback.length > 4_000) throw new ValidationError("Regeneration feedback exceeds 4000 characters.");
    const request = { ...requestFor(row), feedback: feedback || undefined };
    const now = new Date().toISOString();
    sql.transactional(() => {
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET requestJson = ?, status = 'queued', error = NULL, unread = 0, feedback = ?, updatedAt = ?
            WHERE jobId = ?
        `, [
            encodeStoredValue(JSON.stringify(request), !!row.isProtected),
            encodeStoredValue(feedback || null, !!row.isProtected),
            now,
            jobId
        ]);
        sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ jobId ]);
        appendProgress(jobId, {
            stage: "queued",
            round: 0,
            message: feedback
                ? "已收到修正意见，旧草稿会保留到新结果成功。"
                : "已按原问题重新排队，旧草稿会保留到新结果成功。",
            issues: []
        });
    });
    runJob(jobId);
    return getReadWeaveGenerationJob(jobId);
}

export function discardReadWeaveGenerationJob(jobId: string) {
    rowFor(jobId);
    cancelledJobs.add(jobId);
    sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ jobId ]);
    sql.execute("DELETE FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
    return { discarded: true };
}
