import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openReadWeaveJobBudget, readWeaveAuthorizedBudgetCny } from "./readweave_durable_budget.js";

type BudgetDatabase = NonNullable<Parameters<typeof openReadWeaveJobBudget>[2]>;

function adapter(db: Database.Database): BudgetDatabase {
    return {
        executeScript: query => { db.exec(query); },
        execute: (query, params = []) => {
            const result = db.prepare(query).run(params);
            return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
        },
        getRowOrNull: <T>(query: string, params: unknown[] = []) => (db.prepare(query).get(params) ?? null) as T | null
    };
}

describe("durable per-job budget", () => {
    let directory: string;
    let filename: string;
    let connections: Database.Database[];
    let database: BudgetDatabase;
    function connect(): BudgetDatabase {
        const connection = new Database(filename, { nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined });
        connections.push(connection);
        return adapter(connection);
    }

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "readweave-budget-"));
        filename = join(directory, "budget.db");
        connections = [];
        database = connect();
        database.executeScript("CREATE TABLE readweave_generation_jobs (jobId TEXT PRIMARY KEY, requestJson TEXT, resultJson TEXT)");
        database.execute("INSERT INTO readweave_generation_jobs (jobId, requestJson) VALUES (?, ?)", ["job", "{}"]);
    });
    afterEach(() => {
        for (const connection of connections) if (connection.open) connection.close();
        unlinkSync(filename);
        rmdirSync(directory);
    });

    it("persists pending timeout charges and settled receipts after closing and reopening the database", () => {
        const budget = openReadWeaveJobBudget("job", undefined, database);
        const pending = budget.reserveModelRequest(.02)!;
        const receipt = budget.reserveModelRequest(.025)!;
        expect(budget.reportModelUsage(receipt, .004)).toBe(true);
        connections[0].close();
        database = connect();
        const restored = openReadWeaveJobBudget("job", undefined, database);
        expect(restored.unreportedModelCostCny).toBe(.02);
        expect(restored.remainingCny).toBe(.026);
        expect(restored.reportModelUsage(receipt, .004)).toBe(true);
        expect(restored.reportModelUsage(receipt, .005)).toBe(false);
        expect(restored.remainingCny).toBe(.026);
        expect(restored.reserveModelRequest(.027)).toBeUndefined();
        expect(restored.reportModelUsage(pending, .001)).toBe(true);
        expect(restored.reserveModelRequest(.01)).toBe(3);
    });

    it("retains the immutable ceiling and charges when retry overwrites request and result", () => {
        const first = openReadWeaveJobBudget("job", undefined, database);
        first.reserveModelRequest(.04);
        database.execute("UPDATE readweave_generation_jobs SET requestJson = ?, resultJson = ? WHERE jobId = ?", ["{}", "{}", "job"]);
        const retry = openReadWeaveJobBudget("job", { requiredUpperBoundCny: .09, difficultWorkAuthorized: true }, database);
        expect(retry.limitCny).toBe(.05);
        expect(retry.remainingCny).toBe(.01);
        expect(() => retry.raiseLimit(.1)).toThrow(/immutable/);
    });

    it("reuses a generation epoch across disk restarts and isolates a new explicit generation", () => {
        const authorization = { requiredUpperBoundCny: .10, difficultWorkAuthorized: true, generationKey: "2026-09-15T00:00:00.000Z" };
        const first = openReadWeaveJobBudget("job", authorization, database);
        const oldReceipt = first.reserveModelRequest(.04)!;
        connections[0].close();
        database = connect();
        const restarted = openReadWeaveJobBudget("job", authorization, database);
        expect(restarted.unreportedModelCostCny).toBe(.04);
        expect(restarted.remainingCny).toBe(.01);
        const regenerated = openReadWeaveJobBudget("job", { ...authorization, generationKey: "2026-09-15T00:00:00.001Z" }, database);
        expect(regenerated.remainingCny).toBe(.05);
        expect(regenerated.hardLimitCny).toBe(.10);
        expect(regenerated.modelRequests).toBe(0);
        expect(restarted.reportModelUsage(oldReceipt, .003)).toBe(true);
        expect(regenerated.remainingCny).toBe(.05);
        expect(database.getRowOrNull<{ count: number }>("SELECT COUNT(*) AS count FROM readweave_generation_budgets")?.count).toBe(2);
        expect(() => openReadWeaveJobBudget("missing", authorization, database)).toThrow(/unavailable/);
        expect(() => openReadWeaveJobBudget("job", { ...authorization, generationKey: "" }, database)).toThrow(/generation key/);
    });

    it("selects the difficult ceiling only from authorized resource requirements", () => {
        expect(readWeaveAuthorizedBudgetCny({ requiredUpperBoundCny: .04, difficultWorkAuthorized: true })).toBe(.05);
        expect(() => readWeaveAuthorizedBudgetCny({ requiredUpperBoundCny: .08 })).toThrow(/authorization/);
        const budget = openReadWeaveJobBudget("job", { requiredUpperBoundCny: .08, difficultWorkAuthorized: true }, database);
        expect(budget.limitCny).toBe(.05);
        expect(budget.hardLimitCny).toBe(.10);
        budget.raiseLimit(.10);
        expect(budget.limitCny).toBe(.10);
        expect(budget.reserveModelRequest(.10)).toBe(1);
        expect(budget.reserveRequired(.000001)).toBe(false);
        const retry = openReadWeaveJobBudget("job", undefined, database);
        expect(retry.limitCny).toBe(.10);
        expect(retry.hardLimitCny).toBe(.10);
        expect(retry.remainingCny).toBe(0);
        expect(() => readWeaveAuthorizedBudgetCny({ requiredUpperBoundCny: .100001, difficultWorkAuthorized: true })).toThrow();
    });

    it("retries a stale reservation against the latest state on another SQL connection", () => {
        const other = openReadWeaveJobBudget("job", undefined, connect());
        let collided = false;
        const racingDatabase: BudgetDatabase = {
            ...database,
            execute: (query, params) => {
                if (query.includes("UPDATE readweave_generation_budgets") && !collided) {
                    collided = true;
                    expect(other.reserveModelRequest(.03)).toBe(1);
                }
                return database.execute(query, params);
            }
        };
        const budget = openReadWeaveJobBudget("job", undefined, racingDatabase);
        expect(budget.reserveModelRequest(.03)).toBeUndefined();
        expect(budget.modelRequests).toBe(1);
        expect(budget.remainingCny).toBe(.02);
        expect(budget.reserveModelRequest(.02)).toBe(2);
        expect(other.remainingCny).toBe(0);
    });

    it("shares atomic reservations across concurrent callers without overspending", async () => {
        const clients = [database, connect(), connect()].map(db => openReadWeaveJobBudget("job", undefined, db));
        const receipts = await Promise.all(Array.from({ length: 30 }, async (_, index) => {
            await Promise.resolve();
            return clients[index % clients.length].reserveModelRequest(.003);
        }));
        const accepted = receipts.filter(receipt => receipt !== undefined);
        expect(accepted).toHaveLength(16);
        expect(new Set(accepted).size).toBe(16);
        expect(clients[0].upperBoundCny).toBe(.048);
        expect(clients[1].remainingCny).toBe(.002);
    });

    it("settles duplicate receipts atomically even when another writer settles first", () => {
        const other = openReadWeaveJobBudget("job", undefined, connect());
        const receipt = other.reserveModelRequest(.03)!;
        let collided = false;
        const racingDatabase: BudgetDatabase = {
            ...database,
            execute: (query, params) => {
                if (query.includes("UPDATE readweave_generation_budgets") && !collided) {
                    collided = true;
                    expect(other.reportModelUsage(receipt, .004)).toBe(true);
                }
                return database.execute(query, params);
            }
        };
        const budget = openReadWeaveJobBudget("job", undefined, racingDatabase);
        expect(budget.reportModelUsage(receipt, .004)).toBe(true);
        expect(budget.remainingCny).toBe(.046);
        expect(other.reportModelUsage(receipt, .001)).toBe(false);
        expect(other.remainingCny).toBe(.046);
    });

    it("does not authorize work when persistence fails", () => {
        const failingDatabase: BudgetDatabase = {
            ...database,
            execute: (query, params) => {
                if (query.includes("UPDATE readweave_generation_budgets")) throw new Error("disk unavailable");
                return database.execute(query, params);
            }
        };
        const budget = openReadWeaveJobBudget("job", undefined, failingDatabase);
        expect(() => budget.reserveModelRequest(.01)).toThrow(/disk unavailable/);
        expect(openReadWeaveJobBudget("job", undefined, database).modelRequests).toBe(0);
    });

    it("rejects missing jobs and corrupt persisted amounts instead of resetting the budget", () => {
        expect(() => openReadWeaveJobBudget("missing", undefined, database)).toThrow(/unavailable/);
        const budget = openReadWeaveJobBudget("job", undefined, database);
        budget.reserveModelRequest(.04);
        const snapshot = budget.snapshot();
        snapshot.receipts[0].reservedMicros = .5;
        database.execute("UPDATE readweave_generation_budgets SET snapshotJson = ? WHERE jobId = ?", [JSON.stringify(snapshot), "job"]);
        expect(() => openReadWeaveJobBudget("job", undefined, database)).toThrow(/micro-CNY/);
    });
});
