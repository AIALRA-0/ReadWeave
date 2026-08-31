import type {
    ReadWeaveCalloutType,
    ReadWeaveGenerateRequest,
    ReadWeaveGenerateResponse,
    ReadWeaveEvidenceState,
    ReadWeaveFailureClass,
    ReadWeaveGenerationIssue,
    ReadWeaveGenerationIssueCategory,
    ReadWeaveGenerationJob,
    ReadWeaveGenerationProgress
} from "@triliumnext/commons";
import { becca, cls, NotFoundError, protected_session as protectedSessionModule, ValidationError } from "@triliumnext/core";
import { randomUUID } from "crypto";

import {
    formatReadWeaveTermIdentity,
    generateReadWeaveAnswer,
    mergeReadWeaveTermIdentity
} from "./readweave_ai.js";
import { NonRetryableReadWeaveError } from "./readweave_errors.js";
import { getPublishedReadWeaveHarnessProfile } from "./readweave_harness.js";
import { editReadWeaveLink, saveReadWeaveEntry } from "./readweave_repository.js";
import sql from "./sql.js";

interface JobRow {
    jobId: string;
    draftId: string | null;
    savedLinkId: string | null;
    articleId: string;
    anchorId: string;
    anchorType: ReadWeaveGenerateRequest["anchorType"];
    kind: ReadWeaveGenerateRequest["kind"];
    title: string;
    sourceExcerpt: string;
    requestJson: string;
    status: ReadWeaveGenerationJob["status"];
    qualityState: ReadWeaveGenerationJob["qualityState"] | null;
    harnessVersion: string | null;
    evidenceState: ReadWeaveEvidenceState | null;
    failureClass: ReadWeaveFailureClass | null;
    unresolvedIssuesJson: string | null;
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
const MAX_BACKGROUND_GENERATION_ATTEMPTS = 5;
const MAX_CONCURRENT_GENERATION_JOBS = 2;
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
            draftId TEXT,
            savedLinkId TEXT,
            articleId TEXT NOT NULL,
            anchorId TEXT NOT NULL,
            anchorType TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            sourceExcerpt TEXT NOT NULL,
            requestJson TEXT NOT NULL,
            status TEXT NOT NULL,
            qualityState TEXT NOT NULL DEFAULT 'legacy-unverified',
            harnessVersion TEXT NOT NULL DEFAULT 'legacy',
            evidenceState TEXT NOT NULL DEFAULT 'not-checked',
            failureClass TEXT,
            unresolvedIssuesJson TEXT NOT NULL DEFAULT '[]',
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
    if (!columns.includes("savedLinkId")) {
        sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN savedLinkId TEXT");
    }
    if (!columns.includes("draftId")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN draftId TEXT");
    if (!columns.includes("qualityState")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN qualityState TEXT NOT NULL DEFAULT 'legacy-unverified'");
    if (!columns.includes("harnessVersion")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN harnessVersion TEXT NOT NULL DEFAULT 'legacy'");
    if (!columns.includes("evidenceState")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN evidenceState TEXT NOT NULL DEFAULT 'not-checked'");
    if (!columns.includes("failureClass")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN failureClass TEXT");
    if (!columns.includes("unresolvedIssuesJson")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN unresolvedIssuesJson TEXT NOT NULL DEFAULT '[]'");
    sql.execute("UPDATE readweave_generation_jobs SET draftId = jobId WHERE draftId IS NULL OR draftId = ''");

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
    const storedRequest = parseJson<ReadWeaveGenerateRequest>(decodeStoredValue(row.requestJson, row.isProtected));
    return {
        jobId: row.jobId,
        draftId: row.draftId || row.jobId,
        savedLinkId: row.savedLinkId || undefined,
        articleId: row.articleId,
        anchorId: row.anchorId,
        anchorType: row.anchorType,
        kind: row.kind,
        parentLinkId: storedRequest?.parentLinkId,
        title: decodeStoredValue(row.title, row.isProtected) ?? "",
        sourceExcerpt: decodeStoredValue(row.sourceExcerpt, row.isProtected) ?? "",
        status: row.status,
        qualityState: row.qualityState === "verified" || row.qualityState === "provisional" ? row.qualityState : "legacy-unverified",
        harnessVersion: row.harnessVersion || "legacy",
        evidenceState: row.evidenceState || "not-checked",
        failureClass: row.failureClass || undefined,
        unresolvedIssues: parseJson<string[]>(row.unresolvedIssuesJson) ?? [],
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
    if (/格式|全称|缩写|标点|括号|乱码|空格|大小写|换行|英文名词|canonical|format/i.test(message)) return "format";
    if (/作者|人名|实体|产品|组织|术语|entity|author/i.test(message)) return "entity";
    if (/证据|来源|联网|事实|时效|evidence|source/i.test(message)) return "evidence";
    if (/守恒|片段|遗漏|篡改|integrity|segment/i.test(message)) return "integrity";
    return "other";
}

function issueCode(category: ReadWeaveGenerationIssueCategory, index: number): string {
    return `RW-${category.toUpperCase()}-${String(index + 1).padStart(2, "0")}`;
}

function compactProgressText(value: string): string {
    let result = value.trimEnd();
    let previous = "";
    while (result !== previous) {
        previous = result;
        result = result.replace(/[。．.]+(?=[\s"'’”」』）)\]】}》〉]*$)/u, "").trimEnd();
    }
    return result;
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
    const normalizedInput: ReadWeaveGenerationProgress = {
        ...input,
        message: compactProgressText(input.message),
        issues: input.issues.map(compactProgressText),
        issueGroups: input.issueGroups?.map(issue => ({ ...issue, message: compactProgressText(issue.message) }))
    };
    const progress: ReadWeaveGenerationProgress = {
        ...normalizedInput,
        sequence,
        timestamp,
        elapsedMs: Math.max(0, Date.now() - Date.parse(row.createdAt)),
        issueGroups: structuredIssues(normalizedInput)
    };
    sql.execute(/* sql */`
        INSERT INTO readweave_generation_events (jobId, sequence, progressJson, createdAt)
        VALUES (?, ?, ?, ?)
    `, [ jobId, sequence, encodeStoredValue(JSON.stringify(progress), !!row.isProtected), timestamp ]);
    sql.execute("UPDATE readweave_generation_jobs SET updatedAt = ? WHERE jobId = ?", [ timestamp, jobId ]);
}

function setJobState(
    jobId: string,
    status: ReadWeaveGenerationJob["status"],
    values: {
        result?: ReadWeaveGenerateResponse;
        error?: string;
        unread?: boolean;
        savedLinkId?: string;
        failureClass?: ReadWeaveFailureClass;
        unresolvedIssues?: string[];
    } = {}
) {
    const row = rowFor(jobId);
    const updatedAt = new Date().toISOString();
    sql.execute(/* sql */`
        UPDATE readweave_generation_jobs
        SET status = ?, resultJson = COALESCE(?, resultJson), error = ?, unread = ?,
            savedLinkId = COALESCE(?, savedLinkId),
            qualityState = COALESCE(?, qualityState), harnessVersion = COALESCE(?, harnessVersion),
            evidenceState = COALESCE(?, evidenceState), failureClass = ?,
            unresolvedIssuesJson = ?, updatedAt = ?
        WHERE jobId = ?
    `, [
        status,
        values.result ? encodeStoredValue(JSON.stringify(values.result), !!row.isProtected) : null,
        encodeStoredValue(values.error ?? null, !!row.isProtected),
        values.unread ? 1 : 0,
        values.savedLinkId ?? null,
        values.result?.qualityState ?? null,
        values.result?.harnessVersion ?? null,
        values.result?.evidenceState ?? null,
        values.failureClass ?? null,
        JSON.stringify(values.unresolvedIssues ?? values.result?.unresolvedIssues ?? []),
        updatedAt,
        jobId
    ]);
}

function defaultCalloutType(kind: ReadWeaveGenerateRequest["kind"]): ReadWeaveCalloutType {
    return kind === "term" ? "tip" : "note";
}

function persistGeneratedResult(
    row: JobRow,
    request: ReadWeaveGenerateRequest,
    result: ReadWeaveGenerateResponse
): string {
    const termIdentity = request.kind === "term" && result.termIdentity
        ? mergeReadWeaveTermIdentity(result.termIdentity, request.termIdentity)
        : undefined;
    const title = request.kind === "question"
        ? result.optimizedTitle?.trim() || request.title.trim()
        : termIdentity
            ? formatReadWeaveTermIdentity(termIdentity)
            : request.title.trim();
    const calloutType = request.calloutType ?? defaultCalloutType(request.kind);
    if (row.savedLinkId) {
        return editReadWeaveLink(row.savedLinkId, {
            mode: "article-variant",
            title,
            body: result.body,
            calloutType,
            termIdentity,
            verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact,
            evidenceSources: result.evidenceSources,
            claims: result.claims,
            audit: result.audit,
            qualityState: result.qualityState
        }).linkId;
    }
    return saveReadWeaveEntry({
        articleId: request.articleId,
        anchorId: request.anchorId,
        anchorType: request.anchorType,
        kind: request.kind,
        parentLinkId: request.parentLinkId,
        title,
        body: result.body,
        sourceExcerpt: sourceExcerpt(request),
        calloutType,
        termIdentity,
        verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact,
        evidenceSources: result.evidenceSources,
        claims: result.claims,
        audit: result.audit,
        qualityState: result.qualityState
    }).linkId;
}

function classifyFailure(error: unknown): ReadWeaveFailureClass {
    const message = error instanceof Error ? error.message : String(error);
    if (/费用|预算|cost|budget/iu.test(message)) return "budget";
    if (/来源|证据|搜索|联网|source|evidence|search/iu.test(message)) return "evidence";
    if (/格式|标点|括号|乱码|format|schema|json/iu.test(message)) return "format";
    if (/检查协议|修复计划|事实错误|答非所问|矛盾|语义|verification|semantic/iu.test(message)) return "semantic";
    if (/超时|限流|连接|网络|temporar|timeout|429|5\d\d|ECONN|fetch failed/iu.test(message)) return "transport";
    return error instanceof NonRetryableReadWeaveError ? "semantic" : "transport";
}

function isRetryableTransport(error: unknown): boolean {
    return classifyFailure(error) === "transport"
        && !/(?:401|402|403|404|API key|credential|模型不存在)/iu.test(error instanceof Error ? error.message : String(error));
}

function scheduleQueuedJobs() {
    ensureStorage();
    const available = Math.max(0, MAX_CONCURRENT_GENERATION_JOBS - activeJobs.size);
    if (available === 0) return;
    const queuedIds = sql.getColumn<string>(/* sql */`
        SELECT jobId FROM readweave_generation_jobs
        WHERE status = 'queued'
        ORDER BY createdAt
        LIMIT ?
    `, [ available ]);
    for (const queuedId of queuedIds) runJob(queuedId);
}

function runJob(jobId: string) {
    if (activeJobs.has(jobId) || activeJobs.size >= MAX_CONCURRENT_GENERATION_JOBS) return;
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

    const generateWithTransportRecovery = async () => {
        let latestError: unknown;
        for (let attempt = 1; attempt <= MAX_BACKGROUND_GENERATION_ATTEMPTS; attempt++) {
            try {
                const result = await generateReadWeaveAnswer(request, progress => appendProgress(jobId, progress));
                const unresolvedFormatIssues = (result.unresolvedIssues ?? result.reviewIssues ?? [])
                    .filter(issue => categoryForIssue(issue) === "format");
                if (unresolvedFormatIssues.length > 0) {
                    throw new NonRetryableReadWeaveError(`格式修复未闭环：${unresolvedFormatIssues.join("；")}`);
                }
                const currentRow = rowFor(jobId);
                const savedLinkId = cls.init(() => persistGeneratedResult(currentRow, request, result));
                appendProgress(jobId, {
                    stage: "complete",
                    round: 0,
                    message: result.qualityState === "verified"
                        ? currentRow.savedLinkId ? "回答已通过核验并完成覆盖" : "回答已通过核验并自动保存"
                        : currentRow.savedLinkId ? "未完全核验草稿已覆盖旧草稿" : "未完全核验草稿已自动保存",
                    issues: result.unresolvedIssues ?? []
                });
                return { result, savedLinkId };
            } catch (error) {
                latestError = error;
                if (!isRetryableTransport(error) || attempt >= MAX_BACKGROUND_GENERATION_ATTEMPTS) break;
                const diagnostic = error instanceof Error ? error.message.trim().slice(0, 2_000) : "";
                appendProgress(jobId, {
                    stage: "queued",
                    round: 0,
                    message: `服务暂不可用，正在自动恢复第 ${attempt + 1} 次`,
                    issues: diagnostic ? [ diagnostic ] : []
                });
                await new Promise(resolve => setTimeout(resolve, Math.min(750 * 2 ** (attempt - 1), 6_000)));
            }
        }
        throw latestError ?? new ValidationError("ReadWeave 后台任务暂停，等待服务恢复");
    };

    void generateWithTransportRecovery().then(({ result, savedLinkId }) => {
        if (cancelledJobs.has(jobId)) return;
        setJobState(jobId, "complete", { result, savedLinkId, unread: true });
    }).catch(error => {
        if (cancelledJobs.has(jobId)) return;
        const message = error instanceof Error ? error.message : "ReadWeave 后台任务等待恢复";
        const failureClass = classifyFailure(error);
        appendProgress(jobId, { stage: "paused", round: 0, message: "任务已暂停，保留全部状态并等待重试", issues: [ message ] });
        setJobState(jobId, "paused", { error: message, failureClass, unresolvedIssues: [ message ] });
    }).finally(() => {
        activeJobs.delete(jobId);
        cancelledJobs.delete(jobId);
        scheduleQueuedJobs();
    });
}

function sourceExcerpt(request: ReadWeaveGenerateRequest): string {
    return request.rootSourceExcerpt?.trim().slice(0, 10_000)
        || request.fragments.find(fragment => fragment.role === "selected")?.text.trim().slice(0, 10_000)
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
    const legacyRejected = sql.getRows<JobRow>(/* sql */`
        SELECT * FROM readweave_generation_jobs
        WHERE status IN ('complete', 'failed')
        ORDER BY updatedAt
    `);
    for (const row of legacyRejected) {
        if (row.isProtected && !protectedSession.isProtectedSessionAvailable()) continue;
        const storedResult = parseJson<ReadWeaveGenerateResponse>(decodeStoredValue(row.resultJson, row.isProtected));
        const storedError = decodeStoredValue(row.error, row.isProtected) ?? "";
        const hasRejectedDraft = row.status === "complete" && Boolean(storedResult?.reviewIssues?.length);
        const hasRecoverableProtocolFailure = row.status === "failed"
            && /verification checkpoint|verification repair plan|invalid verification|检查协议|修复计划/iu.test(storedError);
        if (!hasRejectedDraft && !hasRecoverableProtocolFailure) continue;
        sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ row.jobId ]);
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET status = 'queued', error = NULL, unread = 0, updatedAt = ?
            WHERE jobId = ?
        `, [ new Date().toISOString(), row.jobId ]);
        appendProgress(row.jobId, {
            stage: "queued",
            round: 0,
            message: hasRejectedDraft
                ? "检测到旧版未通过内部检查的草稿，正在后台自动重建"
                : "检测到旧版检查协议中断，正在后台自动恢复",
            issues: []
        });
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
    const draftId = randomUUID();
    const harnessVersion = getPublishedReadWeaveHarnessProfile().versionId;
    const storedRequest = structuredClone(request);
    sql.execute(/* sql */`
        INSERT INTO readweave_generation_jobs (
            jobId, draftId, savedLinkId, articleId, anchorId, anchorType, kind, title, sourceExcerpt,
            requestJson, status, qualityState, harnessVersion, evidenceState, failureClass,
            unresolvedIssuesJson, resultJson, error, unread, feedback, isProtected, createdAt, updatedAt
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'queued', 'provisional', ?, 'not-checked', NULL,
            '[]', NULL, NULL, 0, ?, ?, ?, ?)
    `, [
        jobId,
        draftId,
        storedRequest.articleId,
        storedRequest.anchorId,
        storedRequest.anchorType,
        storedRequest.kind,
        encodeStoredValue(storedRequest.title.trim(), isProtected),
        encodeStoredValue(sourceExcerpt(storedRequest), isProtected),
        encodeStoredValue(JSON.stringify(storedRequest), isProtected),
        harnessVersion,
        encodeStoredValue(storedRequest.feedback?.trim() || null, isProtected),
        isProtected ? 1 : 0,
        now,
        now
    ]);
    appendProgress(jobId, { stage: "queued", round: 0, message: "后台任务已接收，页面关闭后仍会继续。", issues: [] });
    scheduleQueuedJobs();
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
    // The article-level list is loaded on every note navigation and periodically
    // while any background job is active. Progress events are available from the
    // incremental per-job endpoint, so including every persisted event here makes
    // old articles increasingly expensive to open without adding UI state.
    return rows.map(row => publicJob(row, false));
}

export function listReadWeaveGenerationJobsGlobal(): ReadWeaveGenerationJob[] {
    ensureStorage();
    const rows = sql.getRows<JobRow>(/* sql */`
        SELECT * FROM readweave_generation_jobs
        ORDER BY updatedAt DESC
        LIMIT 500
    `);
    return rows.flatMap(row => {
        try {
            requireReadableArticle(row.articleId);
            return [ publicJob(row, false) ];
        } catch {
            return [];
        }
    });
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

interface ReadWeaveRegenerateRequest {
    feedback?: unknown;
    title?: unknown;
    optimizeQuestion?: unknown;
    calloutType?: unknown;
    termIdentity?: unknown;
    fragments?: unknown;
}

export function regenerateReadWeaveGenerationJob(jobId: string, inputValue: unknown): ReadWeaveGenerationJob {
    const row = rowFor(jobId);
    if (row.status === "running" || row.status === "queued") throw new ValidationError("ReadWeave generation is already running.");
    const input: ReadWeaveRegenerateRequest = typeof inputValue === "string"
        ? { feedback: inputValue }
        : inputValue === undefined || inputValue === null
            ? {}
            : typeof inputValue === "object" && !Array.isArray(inputValue)
                ? inputValue as ReadWeaveRegenerateRequest
                : (() => { throw new ValidationError("Regeneration request must be an object."); })();
    const feedbackValue = input.feedback;
    if (feedbackValue !== undefined && feedbackValue !== null && typeof feedbackValue !== "string") {
        throw new ValidationError("Regeneration feedback must be text.");
    }
    const feedback = typeof feedbackValue === "string" ? feedbackValue.trim() : "";
    if (feedback.length > 4_000) throw new ValidationError("Regeneration feedback exceeds 4000 characters.");
    const previousRequest = requestFor(row);
    const request: ReadWeaveGenerateRequest = { ...previousRequest, feedback: feedback || undefined };
    if (Object.hasOwn(input, "title")) {
        if (typeof input.title !== "string" || !input.title.trim()) {
            throw new ValidationError("Regeneration title must be non-empty text.");
        }
        if (input.title.trim().length > 10_000) throw new ValidationError("Regeneration title exceeds 10000 characters.");
        request.title = input.title.trim();
    }
    if (Object.hasOwn(input, "optimizeQuestion")) {
        if (input.optimizeQuestion !== undefined && typeof input.optimizeQuestion !== "boolean") {
            throw new ValidationError("optimizeQuestion must be boolean.");
        }
        request.optimizeQuestion = input.optimizeQuestion as boolean | undefined;
    }
    if (Object.hasOwn(input, "calloutType")) {
        if (input.calloutType !== "note" && input.calloutType !== "tip" && input.calloutType !== "important"
            && input.calloutType !== "warning" && input.calloutType !== "caution") {
            throw new ValidationError("calloutType is invalid.");
        }
        request.calloutType = input.calloutType;
    }
    if (Object.hasOwn(input, "termIdentity")) {
        if (input.termIdentity !== undefined
            && (typeof input.termIdentity !== "object" || input.termIdentity === null || Array.isArray(input.termIdentity))) {
            throw new ValidationError("termIdentity must be an object.");
        }
        request.termIdentity = input.termIdentity as ReadWeaveGenerateRequest["termIdentity"];
    }
    if (Object.hasOwn(input, "fragments")) {
        if (!Array.isArray(input.fragments) || input.fragments.length === 0 || input.fragments.length > 300
            || input.fragments.some(fragment => !fragment
                || typeof fragment !== "object"
                || typeof (fragment as { id?: unknown }).id !== "string"
                || typeof (fragment as { role?: unknown }).role !== "string"
                || typeof (fragment as { text?: unknown }).text !== "string")) {
            throw new ValidationError("Regeneration context fragments are invalid.");
        }
        request.fragments = structuredClone(input.fragments) as ReadWeaveGenerateRequest["fragments"];
    }
    const now = new Date().toISOString();
    const harnessVersion = getPublishedReadWeaveHarnessProfile().versionId;
    sql.transactional(() => {
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET title = ?, sourceExcerpt = ?, requestJson = ?, status = 'queued', error = NULL,
                unread = 0, feedback = ?, qualityState = 'provisional', harnessVersion = ?,
                evidenceState = 'not-checked', failureClass = NULL, unresolvedIssuesJson = '[]', createdAt = ?, updatedAt = ?
            WHERE jobId = ?
        `, [
            request.title,
            sourceExcerpt(request),
            encodeStoredValue(JSON.stringify(request), !!row.isProtected),
            encodeStoredValue(feedback || null, !!row.isProtected),
            harnessVersion,
            now,
            now,
            jobId
        ]);
        sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ jobId ]);
        appendProgress(jobId, {
            stage: "queued",
            round: 0,
            message: feedback
                ? "已收到修正意见，旧草稿会保留到新结果成功。"
                : request.title !== previousRequest.title
                    ? "已按当前问题重新排队，旧草稿会保留到新结果成功。"
                    : "已按原问题重新排队，旧草稿会保留到新结果成功。",
            issues: []
        });
    });
    scheduleQueuedJobs();
    return getReadWeaveGenerationJob(jobId);
}

export function discardReadWeaveGenerationJob(jobId: string) {
    rowFor(jobId);
    cancelledJobs.add(jobId);
    sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ jobId ]);
    sql.execute("DELETE FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
    return { discarded: true };
}

export function cancelReadWeaveGenerationJob(jobId: string): ReadWeaveGenerationJob {
    const row = rowFor(jobId);
    if (row.status === "complete" || row.status === "failed" || row.status === "cancelled") {
        return publicJob(row, true);
    }
    cancelledJobs.add(jobId);
    appendProgress(jobId, {
        stage: "cancelled",
        round: 0,
        message: "用户已取消任务，已保留问题和现有草稿",
        issues: []
    });
    setJobState(jobId, "cancelled", {
        error: "用户已取消任务",
        failureClass: "cancelled",
        unresolvedIssues: []
    });
    return getReadWeaveGenerationJob(jobId);
}

export function discardReadWeaveGenerationJobsForSavedLinks(linkIds: string[]) {
    ensureStorage();
    const normalized = Array.from(new Set(linkIds.filter(Boolean)));
    if (normalized.length === 0) return;
    for (const linkId of normalized) {
        const jobIds = sql.getColumn<string>(
            "SELECT jobId FROM readweave_generation_jobs WHERE savedLinkId = ?",
            [ linkId ]
        );
        for (const jobId of jobIds) discardReadWeaveGenerationJob(jobId);
    }
}
