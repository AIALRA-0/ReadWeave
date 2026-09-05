import type {
    ReadWeaveCalloutType,
    ReadWeaveEvidenceState,
    ReadWeaveFailureClass,
    ReadWeaveGenerateRequest,
    ReadWeaveGenerateResponse,
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
import { getPublishedReadWeaveHarnessProfile, initializeReadWeaveHarnessTrials } from "./readweave_harness.js";
import { editReadWeaveLink, saveReadWeaveEntry } from "./readweave_repository.js";
import sql from "./sql.js";

interface JobRow {
    jobId: string;
    draftId: string | null;
    savedLinkId: string | null;
    stateVersion: number;
    activeAttemptId: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    cancelRequestedAt: string | null;
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
    issuesJson: string | null;
    resultJson: string | null;
    error: string | null;
    unread: number;
    feedback: string | null;
    isProtected: number;
    createdAt: string;
    updatedAt: string;
}

interface ChangeRow {
    sequence: number;
    jobId: string;
    changeType: "upsert" | "delete";
}

interface EventRow {
    sequence: number;
    progressJson: string;
    createdAt: string;
}

const activeJobs = new Map<string, { attemptId: string; controller: AbortController }>();
let commitFaultForTests: "after-object" | "after-link" | "before-task-update" | undefined;
const protectedSession = protectedSessionModule.default;
// One user action runs one generation attempt. Transport failures are kept as
// a durable task state for an explicit user retry; the scheduler must not
// silently spend another model call.
const MAX_BACKGROUND_GENERATION_ATTEMPTS = 1;
const MAX_CONCURRENT_GENERATION_JOBS = 2;
const LEASE_DURATION_MS = 30_000;
const LEASE_HEARTBEAT_MS = 10_000;
const PROCESS_OWNER_ID = randomUUID();
let storageReady = false;
let schedulerStarted = false;

function requireReadableArticle(articleId: string) {
    const article = becca.getNoteOrThrow(articleId);
    if (!article.isContentAvailable()) throw new ValidationError("Article is unavailable in the current protected session.");
    return article;
}

function validateSourceLocator(value: ReadWeaveGenerateRequest["sourceLocator"]): void {
    if (value === undefined) return;
    if (!value || typeof value !== "object" || value.version !== 1
        || !Number.isInteger(value.blockIndex) || value.blockIndex < 0
        || !Number.isInteger(value.startOffset) || value.startOffset < 0
        || !Number.isInteger(value.endOffset) || value.endOffset < value.startOffset
        || typeof value.prefix !== "string" || typeof value.suffix !== "string"
        || value.prefix.length > 64 || value.suffix.length > 64) {
        throw new ValidationError("sourceLocator is invalid.");
    }
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

function encodeStoredJson(value: unknown, isProtected: boolean): string {
    return encodeStoredValue(JSON.stringify(value), isProtected) ?? "[]";
}

function decodeStoredJson<T>(value: string | null, isProtected: number): T | undefined {
    if (!value) return undefined;
    if (!isProtected) return parseJson<T>(value);
    const decrypted = protectedSession.decryptString(value);
    if (decrypted !== null) return parseJson<T>(decrypted);
    // Compatibility for protected jobs created before structured issues were
    // encrypted. The article readability check still prevents locked access.
    if (/^\s*[[{]/u.test(value)) return parseJson<T>(value);
    throw new ValidationError("The protected session must be unlocked to read this ReadWeave task.");
}

function ensureStorage() {
    if (storageReady) return;
    sql.executeScript(/* sql */`
        CREATE TABLE IF NOT EXISTS readweave_generation_jobs (
            jobId TEXT PRIMARY KEY,
            draftId TEXT,
            savedLinkId TEXT,
            stateVersion INTEGER NOT NULL DEFAULT 1,
            activeAttemptId TEXT,
            leaseOwner TEXT,
            leaseExpiresAt TEXT,
            cancelRequestedAt TEXT,
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
            issuesJson TEXT NOT NULL DEFAULT '[]',
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
        CREATE TABLE IF NOT EXISTS readweave_generation_changes (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            jobId TEXT NOT NULL,
            changeType TEXT NOT NULL,
            createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS readweave_generation_changes_sequence
            ON readweave_generation_changes(sequence);
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
    if (!columns.includes("issuesJson")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN issuesJson TEXT NOT NULL DEFAULT '[]'");
    if (!columns.includes("stateVersion")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN stateVersion INTEGER NOT NULL DEFAULT 1");
    if (!columns.includes("activeAttemptId")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN activeAttemptId TEXT");
    if (!columns.includes("leaseOwner")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN leaseOwner TEXT");
    if (!columns.includes("leaseExpiresAt")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN leaseExpiresAt TEXT");
    if (!columns.includes("cancelRequestedAt")) sql.execute("ALTER TABLE readweave_generation_jobs ADD COLUMN cancelRequestedAt TEXT");
    sql.execute("UPDATE readweave_generation_jobs SET draftId = jobId WHERE draftId IS NULL OR draftId = ''");
    sql.execute("UPDATE readweave_generation_jobs SET status = CASE WHEN savedLinkId IS NULL THEN 'ready-for-review' ELSE 'saved' END WHERE status = 'complete'");
    sql.execute("UPDATE readweave_generation_jobs SET qualityState = 'legacy-unverified' WHERE qualityState = 'verified' AND harnessVersion <> 'quality-closure-v2.2.0'");

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
        const fields = [ "title", "sourceExcerpt", "requestJson", "resultJson", "error", "feedback", "unresolvedIssuesJson", "issuesJson" ] as const;
        const values = fields.map(field => encodeStoredValue(row[field], true));
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET title = ?, sourceExcerpt = ?, requestJson = ?, resultJson = ?, error = ?, feedback = ?,
                unresolvedIssuesJson = ?, issuesJson = ?, isProtected = 1
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

function recordJobChange(jobId: string, changeType: ChangeRow["changeType"] = "upsert") {
    sql.execute(
        "INSERT INTO readweave_generation_changes (jobId, changeType, createdAt) VALUES (?, ?, ?)",
        [ jobId, changeType, new Date().toISOString() ]
    );
}

function issueDetails(messages: string[], failureClass?: ReadWeaveFailureClass): ReadWeaveGenerationIssue[] {
    return messages.map((message, index) => {
        const category = categoryForIssue(message);
        const retryable = failureClass === "transport" || failureClass === "protected-session";
        const terminal = failureClass === "internal";
        return {
            code: issueCode(category, index),
            category,
            message,
            severity: terminal ? "blocking" as const : "warning" as const,
            recoverability: retryable ? "retryable" as const : terminal ? "terminal" as const : "manual-review" as const
        };
    });
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
        stateVersion: row.stateVersion || 1,
        activeAttemptId: row.activeAttemptId || undefined,
        articleId: row.articleId,
        anchorId: row.anchorId,
        anchorType: row.anchorType,
        kind: row.kind,
        parentLinkId: storedRequest?.parentLinkId,
        title: decodeStoredValue(row.title, row.isProtected) ?? "",
        sourceExcerpt: decodeStoredValue(row.sourceExcerpt, row.isProtected) ?? "",
        sourceLocator: storedRequest?.sourceLocator,
        status: row.status,
        qualityState: row.qualityState === "verified" || row.qualityState === "provisional" ? row.qualityState : "legacy-unverified",
        harnessVersion: row.harnessVersion || "legacy",
        evidenceState: row.evidenceState || "not-checked",
        failureClass: row.failureClass || undefined,
        issues: decodeStoredJson<ReadWeaveGenerationIssue[]>(row.issuesJson, row.isProtected)
            ?? issueDetails(decodeStoredJson<string[]>(row.unresolvedIssuesJson, row.isProtected) ?? [], row.failureClass || undefined),
        unresolvedIssues: decodeStoredJson<string[]>(row.unresolvedIssuesJson, row.isProtected) ?? [],
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
        return {
            code: issueCode(category, index),
            category,
            message,
            severity: category === "format" ? "info" as const : "warning" as const,
            recoverability: category === "format" ? "automatic" as const : "manual-review" as const
        };
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
        issues?: ReadWeaveGenerationIssue[];
        activeAttemptId?: string | null;
        clearLease?: boolean;
    } = {}
) {
    const row = rowFor(jobId);
    const updatedAt = new Date().toISOString();
    const canUpdateProtectedPayload = !row.isProtected || protectedSession.isProtectedSessionAvailable();
    const unresolvedIssues = values.unresolvedIssues ?? values.result?.unresolvedIssues ?? [];
    const issues = values.issues ?? issueDetails(unresolvedIssues, values.failureClass);
    sql.execute(/* sql */`
        UPDATE readweave_generation_jobs
        SET status = ?, resultJson = COALESCE(?, resultJson), error = ?, unread = ?,
            savedLinkId = COALESCE(?, savedLinkId),
            qualityState = COALESCE(?, qualityState), harnessVersion = COALESCE(?, harnessVersion),
            evidenceState = COALESCE(?, evidenceState), failureClass = ?,
            unresolvedIssuesJson = ?, issuesJson = ?,
            activeAttemptId = CASE WHEN ? THEN NULL ELSE COALESCE(?, activeAttemptId) END,
            leaseOwner = CASE WHEN ? THEN NULL ELSE leaseOwner END,
            leaseExpiresAt = CASE WHEN ? THEN NULL ELSE leaseExpiresAt END,
            stateVersion = stateVersion + 1, updatedAt = ?
        WHERE jobId = ?
    `, [
        status,
        values.result && canUpdateProtectedPayload ? encodeStoredValue(JSON.stringify(values.result), !!row.isProtected) : null,
        canUpdateProtectedPayload ? encodeStoredValue(values.error ?? null, !!row.isProtected) : row.error,
        values.unread ? 1 : 0,
        values.savedLinkId ?? null,
        values.result?.qualityState ?? null,
        values.result?.harnessVersion ?? null,
        values.result?.evidenceState ?? null,
        values.failureClass ?? null,
        canUpdateProtectedPayload ? encodeStoredJson(unresolvedIssues, !!row.isProtected) : row.unresolvedIssuesJson,
        canUpdateProtectedPayload ? encodeStoredJson(issues, !!row.isProtected) : row.issuesJson,
        values.activeAttemptId === null ? 1 : 0,
        values.activeAttemptId ?? null,
        values.clearLease ? 1 : 0,
        values.clearLease ? 1 : 0,
        updatedAt,
        jobId
    ]);
    recordJobChange(jobId);
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
        sourceLocator: request.sourceLocator,
        calloutType,
        termIdentity,
        verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact,
        evidenceSources: result.evidenceSources,
        claims: result.claims,
        audit: result.audit,
        qualityState: result.qualityState
    }, {
        afterObject: () => {
            if (commitFaultForTests === "after-object") throw new Error("Injected ReadWeave commit fault after object creation");
        },
        afterLink: () => {
            if (commitFaultForTests === "after-link") throw new Error("Injected ReadWeave commit fault after link creation");
        }
    }).linkId;
}

export function setReadWeaveCommitFaultForTests(point?: typeof commitFaultForTests) {
    commitFaultForTests = point;
}

function classifyFailure(error: unknown): ReadWeaveFailureClass {
    const message = error instanceof Error ? error.message : String(error);
    if (/protected session|受保护会话/iu.test(message)) return "protected-session";
    if (/401|402|403|无效.*(?:api.?key|密钥)|api.?key.*(?:缺失|missing|invalid)|凭据|credential|model.*(?:not found|不存在)|模型不存在|endpoint.*(?:不兼容|unsupported)/iu.test(message)) return "configuration";
    if (/费用|预算|cost|budget/iu.test(message)) return "budget";
    if (/来源|证据|搜索|联网|source|evidence|search/iu.test(message)) return "evidence";
    if (/格式|标点|括号|乱码|format|schema|json/iu.test(message)) return "format";
    if (/检查协议|修复计划|事实错误|答非所问|矛盾|语义|verification|semantic/iu.test(message)) return "semantic";
    if (/超时|限流|连接|网络|temporar|timeout|429|5\d\d|ECONN|fetch failed/iu.test(message)) return "transport";
    if (error instanceof NonRetryableReadWeaveError) return "semantic";
    if (error instanceof ValidationError) return "internal";
    return "internal";
}

function isRetryableTransport(error: unknown): boolean {
    return classifyFailure(error) === "transport";
}

function leaseExpiry(): string {
    return new Date(Date.now() + LEASE_DURATION_MS).toISOString();
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
        }, { once: true });
    });
}

function claimJob(jobId: string, leaseOwner: string = PROCESS_OWNER_ID): { row: JobRow; attemptId: string } | undefined {
    const current = rowFor(jobId);
    const attemptId = current.activeAttemptId || randomUUID();
    const now = new Date().toISOString();
    const claimed = sql.execute(/* sql */`
        UPDATE readweave_generation_jobs
        SET status = 'running', activeAttemptId = ?, leaseOwner = ?, leaseExpiresAt = ?,
            cancelRequestedAt = NULL, stateVersion = stateVersion + 1, updatedAt = ?
        WHERE jobId = ?
          AND (status = 'queued' OR (status = 'running' AND (leaseExpiresAt IS NULL OR leaseExpiresAt < ?)))
    `, [ attemptId, leaseOwner, leaseExpiry(), now, jobId, now ]);
    if (claimed.changes !== 1) return undefined;
    recordJobChange(jobId);
    return { row: rowFor(jobId), attemptId };
}

export function claimReadWeaveGenerationJobLeaseForTests(jobId: string, leaseOwner: string): string | undefined {
    return claimJob(jobId, leaseOwner)?.attemptId;
}

function scheduleQueuedJobs() {
    ensureStorage();
    const available = Math.max(0, MAX_CONCURRENT_GENERATION_JOBS - activeJobs.size);
    if (available === 0) return;
    const queuedIds = sql.getColumn<string>(/* sql */`
        SELECT jobId FROM readweave_generation_jobs
        WHERE status = 'queued'
           OR (status = 'running' AND (leaseExpiresAt IS NULL OR leaseExpiresAt < ?))
        ORDER BY createdAt
        LIMIT 50
    `, [ new Date().toISOString() ]);
    for (const queuedId of queuedIds) {
        if (activeJobs.size >= MAX_CONCURRENT_GENERATION_JOBS) break;
        runJob(queuedId);
    }
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
    if (row.isProtected && !protectedSession.isProtectedSessionAvailable()) {
        setJobState(jobId, "paused", {
            error: "受保护会话当前不可用",
            failureClass: "protected-session",
            unresolvedIssues: [ "解锁受保护会话后可以继续生成" ],
            clearLease: true
        });
        return;
    }
    let request: ReadWeaveGenerateRequest;
    try {
        request = requestFor(row);
    } catch (error) {
        const message = error instanceof Error ? error.message : "ReadWeave 任务数据损坏";
        setJobState(jobId, "failed", {
            error: message,
            failureClass: "internal",
            unresolvedIssues: [ message ],
            clearLease: true
        });
        return;
    }
    const claimed = claimJob(jobId);
    if (!claimed) return;
    row = claimed.row;
    const { attemptId } = claimed;
    const controller = new AbortController();
    activeJobs.set(jobId, { attemptId, controller });
    const heartbeat = setInterval(() => {
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET leaseExpiresAt = ?, updatedAt = ?
            WHERE jobId = ? AND status = 'running' AND activeAttemptId = ? AND leaseOwner = ?
        `, [ leaseExpiry(), new Date().toISOString(), jobId, attemptId, PROCESS_OWNER_ID ]);
    }, LEASE_HEARTBEAT_MS);
    heartbeat.unref?.();
    if (eventsFor(jobId).length === 0) {
        appendProgress(jobId, { stage: "queued", round: 0, message: "后台任务已接收，正在准备生成", issues: [] });
    }

    const generateWithTransportRecovery = async () => {
        let latestError: unknown;
        for (let attempt = 1; attempt <= MAX_BACKGROUND_GENERATION_ATTEMPTS; attempt++) {
            try {
                const result = await generateReadWeaveAnswer(request, progress => appendProgress(jobId, progress), controller.signal);
                // A non-empty, structurally valid answer with review warnings is
                // still a deliverable draft.  The unified workflow has already
                // rejected empty, unparsable, unsafe and invariant-breaking
                // results; format/evidence/semantic warnings belong in
                // ready-for-review + provisional so the user can inspect and
                // correct them instead of losing the draft as a paused job.
                return result;
            } catch (error) {
                latestError = error;
                if (controller.signal.aborted) throw error;
                if (!isRetryableTransport(error) || attempt >= MAX_BACKGROUND_GENERATION_ATTEMPTS) break;
                const diagnostic = error instanceof Error ? error.message.trim().slice(0, 2_000) : "";
                appendProgress(jobId, {
                    stage: "queued",
                    round: 0,
                    message: `服务暂不可用，正在自动恢复第 ${attempt + 1} 次`,
                    issues: diagnostic ? [ diagnostic ] : []
                });
                await abortableDelay(Math.min(750 * 2 ** (attempt - 1), 6_000), controller.signal);
            }
        }
        throw latestError ?? new ValidationError("ReadWeave 后台任务暂停，等待服务恢复");
    };

    void generateWithTransportRecovery().then(result => {
        const current = rowFor(jobId);
        if (current.status !== "running" || current.activeAttemptId !== attemptId
            || current.leaseOwner !== PROCESS_OWNER_ID || current.cancelRequestedAt) return;
        if (current.isProtected && !protectedSession.isProtectedSessionAvailable()) {
            setJobState(jobId, "paused", {
                failureClass: "protected-session",
                unresolvedIssues: [ "解锁受保护会话后可以继续生成" ],
                activeAttemptId: null,
                clearLease: true
            });
            return;
        }
        const unresolvedIssues = Array.from(new Set([ ...(result.unresolvedIssues ?? []), ...(result.reviewIssues ?? []) ]));
        const issues = issueDetails(unresolvedIssues, result.qualityState === "verified" ? undefined : "semantic");
        setJobState(jobId, "ready-for-review", {
            result,
            unread: true,
            unresolvedIssues,
            issues,
            activeAttemptId: null,
            clearLease: true
        });
        appendProgress(jobId, {
            stage: "complete",
            round: 0,
            message: result.qualityState === "verified" ? "回答已通过核验，等待确认入库" : "回答已保存为待审核草稿",
            issues: unresolvedIssues
        });
    }).catch(error => {
        let current: JobRow;
        try {
            current = rowFor(jobId);
        } catch {
            return;
        }
        if (controller.signal.aborted || current.status === "cancelled" || current.activeAttemptId !== attemptId) return;
        const message = error instanceof Error ? error.message : "ReadWeave 后台任务等待恢复";
        const failureClass = classifyFailure(error);
        const status = failureClass === "internal" ? "failed" : "paused";
        if (!current.isProtected || protectedSession.isProtectedSessionAvailable()) {
            appendProgress(jobId, {
                stage: status === "failed" ? "failed" : "paused",
                round: 0,
                message: status === "failed" ? "任务数据异常，已停止执行" : "任务已暂停，保留全部状态并等待重试",
                issues: [ message ]
            });
        }
        setJobState(jobId, status, {
            error: message,
            failureClass,
            unresolvedIssues: [ message ],
            activeAttemptId: null,
            clearLease: true
        });
    }).finally(() => {
        clearInterval(heartbeat);
        const active = activeJobs.get(jobId);
        if (active?.attemptId === attemptId) activeJobs.delete(jobId);
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
    initializeReadWeaveHarnessTrials();
    sql.execute("UPDATE readweave_generation_jobs SET status = CASE WHEN savedLinkId IS NULL THEN 'ready-for-review' ELSE 'saved' END WHERE status = 'complete'");
    sql.execute("UPDATE readweave_generation_jobs SET qualityState = 'legacy-unverified' WHERE qualityState = 'verified' AND harnessVersion <> 'quality-closure-v2.2.0'");
    const now = new Date().toISOString();
    const interrupted = sql.getRows<JobRow>(/* sql */`
        SELECT * FROM readweave_generation_jobs
        WHERE status = 'running' AND (leaseExpiresAt IS NULL OR leaseExpiresAt < ?)
    `, [ now ]);
    for (const row of interrupted) {
        const attemptId = randomUUID();
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET status = 'queued', activeAttemptId = ?, leaseOwner = NULL, leaseExpiresAt = NULL,
                stateVersion = stateVersion + 1, updatedAt = ?
            WHERE jobId = ?
        `, [ attemptId, now, row.jobId ]);
        recordJobChange(row.jobId);
        if (!row.isProtected || protectedSession.isProtectedSessionAvailable()) {
            appendProgress(row.jobId, { stage: "queued", round: 0, message: "服务器恢复了未完成任务，正在安全重启生成流程", issues: [] });
        }
    }
    const legacyRejected = sql.getRows<JobRow>(/* sql */`
        SELECT * FROM readweave_generation_jobs
        WHERE status = 'failed'
        ORDER BY updatedAt
    `);
    for (const row of legacyRejected) {
        if (row.isProtected && !protectedSession.isProtectedSessionAvailable()) continue;
        const storedError = decodeStoredValue(row.error, row.isProtected) ?? "";
        const hasRecoverableProtocolFailure = /verification checkpoint|verification repair plan|invalid verification|检查协议|修复计划/iu.test(storedError);
        if (!hasRecoverableProtocolFailure) continue;
        const attemptId = randomUUID();
        sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ row.jobId ]);
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET status = 'queued', activeAttemptId = ?, error = NULL, unread = 0,
                failureClass = NULL, stateVersion = stateVersion + 1, updatedAt = ?
            WHERE jobId = ?
        `, [ attemptId, new Date().toISOString(), row.jobId ]);
        recordJobChange(row.jobId);
        appendProgress(row.jobId, {
            stage: "queued",
            round: 0,
            message: "检测到旧版检查协议中断，正在后台自动恢复",
            issues: []
        });
    }
    sql.execute("UPDATE readweave_generation_jobs SET activeAttemptId = COALESCE(activeAttemptId, jobId) WHERE status = 'queued'");
    scheduleQueuedJobs();
    if (!schedulerStarted) {
        schedulerStarted = true;
        const scheduler = setInterval(() => {
            const retryBefore = new Date(Date.now() - 60_000).toISOString();
            const retryable = sql.getRows<JobRow>(/* sql */`
                SELECT * FROM readweave_generation_jobs
                WHERE status = 'paused' AND failureClass = 'protected-session' AND updatedAt < ?
                ORDER BY updatedAt LIMIT 20
            `, [ retryBefore ]);
            for (const row of retryable) {
                if (row.failureClass === "protected-session" && !protectedSession.isProtectedSessionAvailable()) continue;
                const attemptId = randomUUID();
                sql.execute(/* sql */`
                    UPDATE readweave_generation_jobs
                    SET status = 'queued', activeAttemptId = ?, error = NULL, failureClass = NULL,
                        stateVersion = stateVersion + 1, updatedAt = ?
                    WHERE jobId = ? AND status = 'paused'
                `, [ attemptId, new Date().toISOString(), row.jobId ]);
                recordJobChange(row.jobId);
            }
            scheduleQueuedJobs();
        }, 5_000);
        scheduler.unref?.();
    }
}

export function startReadWeaveGenerationJob(request: ReadWeaveGenerateRequest): ReadWeaveGenerationJob {
    ensureStorage();
    if (!request.articleId || !request.anchorId || !request.title?.trim() || !Array.isArray(request.fragments)) {
        throw new ValidationError("ReadWeave generation request is incomplete.");
    }
    validateSourceLocator(request.sourceLocator);
    const article = requireReadableArticle(request.articleId);
    const isProtected = article.isProtected === true;
    if (request.kind === "term") {
        const existing = sql.getRowOrNull<JobRow>(/* sql */`
            SELECT * FROM readweave_generation_jobs
            WHERE articleId = ? AND anchorId = ? AND kind = 'term'
              AND status IN ('queued', 'running', 'ready-for-review', 'saving', 'saved')
            ORDER BY updatedAt DESC LIMIT 1
        `, [ request.articleId, request.anchorId ]);
        if (existing) return publicJob(existing);
    }
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const draftId = randomUUID();
    const attemptId = randomUUID();
    const harnessVersion = getPublishedReadWeaveHarnessProfile().versionId;
    const storedRequest = structuredClone(request);
    sql.execute(/* sql */`
        INSERT INTO readweave_generation_jobs (
            jobId, draftId, savedLinkId, stateVersion, activeAttemptId, articleId, anchorId, anchorType, kind, title, sourceExcerpt,
            requestJson, status, qualityState, harnessVersion, evidenceState, failureClass,
            unresolvedIssuesJson, issuesJson, resultJson, error, unread, feedback, isProtected, createdAt, updatedAt
        ) VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'provisional', ?, 'not-checked', NULL,
            ?, ?, NULL, NULL, 0, ?, ?, ?, ?)
    `, [
        jobId,
        draftId,
        attemptId,
        storedRequest.articleId,
        storedRequest.anchorId,
        storedRequest.anchorType,
        storedRequest.kind,
        encodeStoredValue(storedRequest.title.trim(), isProtected),
        encodeStoredValue(sourceExcerpt(storedRequest), isProtected),
        encodeStoredValue(JSON.stringify(storedRequest), isProtected),
        harnessVersion,
        encodeStoredJson([], isProtected),
        encodeStoredJson([], isProtected),
        encodeStoredValue(storedRequest.feedback?.trim() || null, isProtected),
        isProtected ? 1 : 0,
        now,
        now
    ]);
    recordJobChange(jobId);
    appendProgress(jobId, { stage: "queued", round: 0, message: "后台任务已接收，页面关闭后仍会继续", issues: [] });
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

export function listReadWeaveGenerationJobsGlobal(afterSequence = 0): {
    jobs: ReadWeaveGenerationJob[];
    removedJobIds: string[];
    nextCursor: number;
} {
    ensureStorage();
    const cursor = Math.max(0, afterSequence);
    const changes = cursor > 0 ? sql.getRows<ChangeRow>(/* sql */`
        SELECT sequence, jobId, changeType
        FROM readweave_generation_changes
        WHERE sequence > ?
        ORDER BY sequence
        LIMIT 1_000
    `, [ cursor ]) : [];
    const changedIds = cursor > 0
        ? Array.from(new Set(changes.filter(change => change.changeType === "upsert").map(change => change.jobId)))
        : [];
    const rows = cursor > 0
        ? changedIds.flatMap(jobId => {
            const row = sql.getRowOrNull<JobRow>("SELECT * FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
            return row ? [ row ] : [];
        })
        : sql.getRows<JobRow>(/* sql */`
            SELECT * FROM readweave_generation_jobs
            ORDER BY updatedAt DESC
            LIMIT 500
        `);
    const unreadableJobIds = new Set<string>();
    const jobs = rows.flatMap(row => {
        try {
            requireReadableArticle(row.articleId);
            return [ publicJob(row, false) ];
        } catch {
            unreadableJobIds.add(row.jobId);
            return [];
        }
    });
    const firstUnreadableSequence = changes.find(change => unreadableJobIds.has(change.jobId))?.sequence;
    const nextCursor = firstUnreadableSequence !== undefined
        ? Math.max(cursor, firstUnreadableSequence - 1)
        : unreadableJobIds.size > 0 && cursor === 0
            ? 0
            : changes.at(-1)?.sequence
                ?? sql.getValue<number>("SELECT COALESCE(MAX(sequence), 0) FROM readweave_generation_changes")
                ?? cursor;
    return {
        jobs,
        removedJobIds: Array.from(new Set(changes.filter(change => change.changeType === "delete").map(change => change.jobId))),
        nextCursor
    };
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
    if ((row.status === "ready-for-review" || row.status === "saved") && row.unread) {
        sql.execute("UPDATE readweave_generation_jobs SET unread = 0, stateVersion = stateVersion + 1, updatedAt = ? WHERE jobId = ?", [ new Date().toISOString(), jobId ]);
        recordJobChange(jobId);
    }
    return getReadWeaveGenerationJob(jobId);
}

interface ReadWeaveRegenerateRequest {
    feedback?: unknown;
    title?: unknown;
    optimizeQuestion?: unknown;
    autoApplyPlan?: unknown;
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
    if (Object.hasOwn(input, "autoApplyPlan")) {
        if (input.autoApplyPlan !== undefined && typeof input.autoApplyPlan !== "boolean") {
            throw new ValidationError("autoApplyPlan must be boolean.");
        }
        request.autoApplyPlan = input.autoApplyPlan as boolean | undefined;
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
    const attemptId = randomUUID();
    sql.transactional(() => {
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET title = ?, sourceExcerpt = ?, requestJson = ?, status = 'queued', error = NULL,
                unread = 0, feedback = ?, qualityState = 'provisional', harnessVersion = ?,
                evidenceState = 'not-checked', failureClass = NULL, unresolvedIssuesJson = ?, issuesJson = ?,
                activeAttemptId = ?, leaseOwner = NULL, leaseExpiresAt = NULL, cancelRequestedAt = NULL,
                stateVersion = stateVersion + 1, createdAt = ?, updatedAt = ?
            WHERE jobId = ?
        `, [
            encodeStoredValue(request.title, !!row.isProtected),
            encodeStoredValue(sourceExcerpt(request), !!row.isProtected),
            encodeStoredValue(JSON.stringify(request), !!row.isProtected),
            encodeStoredValue(feedback || null, !!row.isProtected),
            harnessVersion,
            encodeStoredJson([], !!row.isProtected),
            encodeStoredJson([], !!row.isProtected),
            attemptId,
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
        recordJobChange(jobId);
    });
    scheduleQueuedJobs();
    return getReadWeaveGenerationJob(jobId);
}

export function discardReadWeaveGenerationJob(jobId: string) {
    rowFor(jobId);
    const active = activeJobs.get(jobId);
    sql.transactional(() => {
        sql.execute("DELETE FROM readweave_generation_events WHERE jobId = ?", [ jobId ]);
        sql.execute("DELETE FROM readweave_generation_jobs WHERE jobId = ?", [ jobId ]);
        recordJobChange(jobId, "delete");
    });
    active?.controller.abort(new Error("ReadWeave task discarded"));
    return { discarded: true };
}

export function cancelReadWeaveGenerationJob(jobId: string): ReadWeaveGenerationJob {
    const row = rowFor(jobId);
    if (row.status === "ready-for-review" || row.status === "saved" || row.status === "failed" || row.status === "cancelled") {
        return publicJob(row, true);
    }
    const timestamp = new Date().toISOString();
    sql.execute(/* sql */`
        UPDATE readweave_generation_jobs
        SET status = 'cancelled', cancelRequestedAt = ?, error = ?, failureClass = 'cancelled',
            unresolvedIssuesJson = ?, issuesJson = ?, leaseOwner = NULL, leaseExpiresAt = NULL,
            stateVersion = stateVersion + 1, updatedAt = ?
        WHERE jobId = ? AND status IN ('queued', 'running', 'paused')
    `, [
        timestamp,
        encodeStoredValue("用户已取消任务", !!row.isProtected),
        encodeStoredJson([], !!row.isProtected),
        encodeStoredJson([], !!row.isProtected),
        timestamp,
        jobId
    ]);
    recordJobChange(jobId);
    appendProgress(jobId, {
        stage: "cancelled",
        round: 0,
        message: "用户已取消任务，已保留问题和现有草稿",
        issues: []
    });
    const active = activeJobs.get(jobId);
    if (active && (!row.activeAttemptId || active.attemptId === row.activeAttemptId)) {
        active.controller.abort(new Error("ReadWeave task cancelled"));
    }
    return getReadWeaveGenerationJob(jobId);
}

interface CommitGenerationJobInput {
    expectedStateVersion?: unknown;
    title?: unknown;
    body?: unknown;
    calloutType?: unknown;
    termIdentity?: unknown;
}

export function commitReadWeaveGenerationJob(jobId: string, inputValue: unknown): ReadWeaveGenerationJob {
    const input = inputValue && typeof inputValue === "object" && !Array.isArray(inputValue)
        ? inputValue as CommitGenerationJobInput
        : {};
    const expectedStateVersion = input.expectedStateVersion;
    if (!Number.isInteger(expectedStateVersion) || Number(expectedStateVersion) < 1) {
        throw new ValidationError("expectedStateVersion is required");
    }
    const initial = rowFor(jobId);
    if (initial.status === "saved" && initial.savedLinkId) return publicJob(initial, true);
    if (initial.status !== "ready-for-review") throw new ValidationError("ReadWeave draft is not ready for review");
    if (initial.stateVersion !== expectedStateVersion) throw new ValidationError("ReadWeave draft changed in another view; reload before saving");
    const request = requestFor(initial);
    const storedResult = parseJson<ReadWeaveGenerateResponse>(decodeStoredValue(initial.resultJson, initial.isProtected));
    if (!storedResult?.body?.trim()) throw new ValidationError("ReadWeave draft has no generated answer");
    const result = structuredClone(storedResult);
    let manuallyEdited = false;
    if (input.body !== undefined) {
        if (typeof input.body !== "string" || !input.body.trim() || input.body.length > 40_000) throw new ValidationError("ReadWeave draft body is invalid");
        result.body = input.body.trim();
        manuallyEdited = result.body !== storedResult.body;
    }
    if (input.title !== undefined) {
        if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 10_000) throw new ValidationError("ReadWeave draft title is invalid");
        const nextTitle = input.title.trim();
        manuallyEdited = manuallyEdited || nextTitle !== request.title;
        request.title = nextTitle;
    }
    if (input.calloutType !== undefined) {
        if (input.calloutType !== "note" && input.calloutType !== "tip" && input.calloutType !== "important"
            && input.calloutType !== "warning" && input.calloutType !== "caution") throw new ValidationError("ReadWeave callout type is invalid");
        request.calloutType = input.calloutType;
    }
    if (input.termIdentity !== undefined) {
        if (!input.termIdentity || typeof input.termIdentity !== "object" || Array.isArray(input.termIdentity)) throw new ValidationError("ReadWeave term identity is invalid");
        const nextIdentity = input.termIdentity as ReadWeaveGenerateRequest["termIdentity"];
        manuallyEdited = manuallyEdited || JSON.stringify(nextIdentity ?? {}) !== JSON.stringify(result.termIdentity ?? request.termIdentity ?? {});
        request.termIdentity = nextIdentity;
        result.termIdentity = request.termIdentity;
    }
    if (manuallyEdited) {
        result.qualityState = "provisional";
        result.audit = result.audit ? { ...result.audit, qualityState: "provisional", manuallyEdited: true } : result.audit;
    }
    return cls.init(() => sql.transactional(() => {
        const current = rowFor(jobId);
        if (current.status === "saved" && current.savedLinkId) return publicJob(current, true);
        if (current.status !== "ready-for-review" || current.stateVersion !== expectedStateVersion) {
            throw new ValidationError("ReadWeave draft changed in another view; reload before saving");
        }
        const savingAt = new Date().toISOString();
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET status = 'saving', stateVersion = stateVersion + 1, updatedAt = ?
            WHERE jobId = ? AND status = 'ready-for-review' AND stateVersion = ?
        `, [ savingAt, jobId, expectedStateVersion ]);
        recordJobChange(jobId);
        const savedLinkId = persistGeneratedResult(current, request, result);
        if (commitFaultForTests === "before-task-update") throw new Error("Injected ReadWeave commit fault before task update");
        const savedAt = new Date().toISOString();
        sql.execute(/* sql */`
            UPDATE readweave_generation_jobs
            SET status = 'saved', savedLinkId = ?, requestJson = ?, resultJson = ?,
                qualityState = ?, evidenceState = ?, unread = 0, error = NULL, failureClass = NULL,
                unresolvedIssuesJson = ?, issuesJson = ?, stateVersion = stateVersion + 1, updatedAt = ?
            WHERE jobId = ? AND status = 'saving'
        `, [
            savedLinkId,
            encodeStoredValue(JSON.stringify(request), !!current.isProtected),
            encodeStoredValue(JSON.stringify(result), !!current.isProtected),
            result.qualityState,
            result.evidenceState ?? current.evidenceState ?? "not-checked",
            encodeStoredJson(result.unresolvedIssues ?? [], !!current.isProtected),
            encodeStoredJson(issueDetails(result.unresolvedIssues ?? []), !!current.isProtected),
            savedAt,
            jobId
        ]);
        recordJobChange(jobId);
        appendProgress(jobId, { stage: "complete", round: 0, message: "审核结果已写入正式笔记", issues: [] });
        return getReadWeaveGenerationJob(jobId);
    }));
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
