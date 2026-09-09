/** One request owns one ledger. Reservations happen before any billable work. */
export class ReadWeaveBudget {
    private reservedMicros = 0;
    private pendingModelRequests = new Map<number, number>();
    modelRequests = 0;
    constructor(readonly limitCny: number) {}

    get unreportedModelCostCny(): number {
        return [ ...this.pendingModelRequests.values() ].reduce((sum,cost)=>sum+cost,0);
    }

    get remainingCny(): number {
        return Math.max(0, Math.round(this.limitCny * 1e6) - this.reservedMicros) / 1e6;
    }

    reserve(costCny: number): boolean {
        if (!Number.isFinite(costCny) || costCny < 0) return false;
        const micros = Math.ceil(costCny * 1e6);
        if (micros > Math.round(this.remainingCny * 1e6)) return false;
        this.reservedMicros += micros;
        return true;
    }

    beginModelRequest(reservation: number): number {
        this.modelRequests++;
        this.pendingModelRequests.set(this.modelRequests, reservation);
        return this.modelRequests;
    }

    reportModelUsage(receipt: number, actualCostCny: number): boolean {
        const reservation = this.pendingModelRequests.get(receipt);
        if (reservation === undefined || !Number.isFinite(actualCostCny) || actualCostCny < 0)
            return false;
        this.pendingModelRequests.delete(receipt);
        // Remove binary floating noise before rounding up to the ledger's micro-yuan unit.
        const actualMicros = Math.ceil(Number((actualCostCny * 1e6).toFixed(6)));
        this.reservedMicros += actualMicros - Math.ceil(reservation * 1e6);
        return true;
    }
}

interface MeteredUsage {
    prompt_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens?: number;
}

/** The same configured rates settle reservations and produce the user estimate.
 * An incomplete or malformed receipt must never release a pending reservation. */
export function readWeaveModelUsageCost(usage?: MeteredUsage): number | undefined {
    if (!usage) return undefined;
    const input = usage.prompt_tokens, output = usage.completion_tokens;
    if (typeof input !== "number" || typeof output !== "number"
        || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0)
        return undefined;
    const hit = usage.prompt_cache_hit_tokens ?? 0;
    const miss = usage.prompt_cache_miss_tokens ?? input - hit;
    if (!Number.isSafeInteger(hit) || !Number.isSafeInteger(miss)
        || hit < 0 || miss < 0 || hit + miss !== input)
        return undefined;
    return (hit * 0.02 + miss + output * 2) / 1e6;
}

export const READWEAVE_ROUTINE_BUDGET_CNY = 0.05;
export const READWEAVE_DIFFICULT_BUDGET_CNY = 0.1;
export const READWEAVE_RESEARCH_ACTION_LIMIT = 20;

// Uses the configured DeepSeek rates already used by ReadWeave. This is an
// estimate, not a provider invoice; UTF-8 bytes conservatively bound input tokens.
export function readWeaveModelReservation(system: string, user: string, maxTokens: number): number {
    return (Buffer.byteLength(system + user, "utf8") + 256 + maxTokens * 2) / 1e6;
}
