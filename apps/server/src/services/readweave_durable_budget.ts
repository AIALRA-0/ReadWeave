import {
    ReadWeaveBudget,
    type ReadWeaveBudgetSnapshot,
    type ReadWeaveBudgetStorage,
    readWeaveCnyToMicros
} from "./readweave_budget.js";
import sql from "./sql.js";

/** Server-authorized resource maximum, never request labels or a client-supplied
 * budget. The working target still starts at .05 and rises only as resources require. */
export interface ReadWeaveBudgetAuthorization {
    requiredUpperBoundCny: number;
    difficultWorkAuthorized?: boolean;
    /** Stable across transport retries/restarts; changes on explicit regeneration only. */
    generationKey?: string;
}

export function readWeaveAuthorizedBudgetCny(authorization: ReadWeaveBudgetAuthorization): number {
    const required = readWeaveCnyToMicros(authorization.requiredUpperBoundCny);
    if (required === undefined || required > 100_000) throw new Error("Resource requirement exceeds the allowed budget.");
    if (required <= 50_000) return 0.05;
    if (authorization.difficultWorkAuthorized !== true) throw new Error("Difficult work requires server authorization.");
    return 0.10;
}

type BudgetDatabase = Pick<typeof sql, "executeScript" | "execute" | "getRowOrNull">;

/** Uses the same database as generation jobs, without a migration file or changes to
 * job request/result serialization. Retry deletes progress and rewrites requestJson;
 * the separate job-keyed row deliberately survives both, including unknown charges.
 * It stores only amounts and numbered receipts, so protected content is never copied.
 *
 * Integration: after creating/claiming the job, pass the returned budget through an
 * optional server execution context. reserveModelRequest()/reserveResourceRequest()
 * must return a receipt before dispatch. Persist reportUsage() before publishing the
 * result. On timeout/cancellation do nothing to the receipt. Reopen the SAME job ID
 * and generationKey on retry; their stored ceiling wins over new authorization.
 * Explicit user regeneration advances generationKey and receives a fresh allowance.
 */
export function openReadWeaveJobBudget(
    jobId: string,
    authorization: ReadWeaveBudgetAuthorization = { requiredUpperBoundCny: 0.05 },
    database: BudgetDatabase = sql
): ReadWeaveBudget {
    if (typeof jobId !== "string" || !jobId.trim()) throw new Error("A generation job ID is required.");
    if (authorization.generationKey !== undefined
        && (typeof authorization.generationKey !== "string" || !authorization.generationKey.trim()))
        throw new Error("Invalid budget generation key.");
    const ledgerKey = authorization.generationKey === undefined ? jobId : `${jobId}:${authorization.generationKey}`;
    database.executeScript(/* sql */`
        CREATE TABLE IF NOT EXISTS readweave_generation_budgets (
            jobId TEXT PRIMARY KEY NOT NULL,
            snapshotJson TEXT NOT NULL
        );
    `);

    const read = (): ReadWeaveBudgetSnapshot | undefined => {
        const row = database.getRowOrNull<{ snapshotJson: string }>(
            "SELECT snapshotJson FROM readweave_generation_budgets WHERE jobId = ?", [ledgerKey]);
        if (!row) return undefined;
        // Corrupt state fails closed; never replace it with an empty allowance.
        return ReadWeaveBudget.restore(JSON.parse(row.snapshotJson)).snapshot();
    };

    let existing = read();
    if (!existing) {
        const initial = new ReadWeaveBudget(0.05, { hardLimitCny: readWeaveAuthorizedBudgetCny(authorization) }).snapshot();
        database.execute(/* sql */`
            INSERT INTO readweave_generation_budgets (jobId, snapshotJson)
            SELECT ?, ? WHERE EXISTS (SELECT 1 FROM readweave_generation_jobs WHERE jobId = ?)
            ON CONFLICT(jobId) DO NOTHING
        `, [ledgerKey, JSON.stringify(initial), jobId]);
        existing = read();
        if (!existing) throw new Error("Cannot persist budget for an unavailable generation job.");
    }

    const storage: ReadWeaveBudgetStorage = {
        read: () => {
            const current = read();
            if (!current) throw new Error("Persisted job budget is missing.");
            return current;
        },
        compareAndSwap: (previous, next) => database.execute(/* sql */`
            UPDATE readweave_generation_budgets SET snapshotJson = ?
            WHERE jobId = ? AND snapshotJson = ?
        `, [JSON.stringify(next), ledgerKey, JSON.stringify(previous)]).changes === 1
    };
    return new ReadWeaveBudget(existing.limitMicros / 1e6, { hardLimitCny: existing.hardLimitMicros / 1e6, storage });
}
