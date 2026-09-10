/** One request owns one ledger. Reservations happen before any billable work. */
export class ReadWeaveBudget {
    private reservedMicros = 0;
    private pendingModelRequests = new Map<number, number>();
    modelRequests = 0;
    constructor(public limitCny: number) {}

    raiseLimit(limitCny: number): void {
        if (Number.isFinite(limitCny) && limitCny > this.limitCny) this.limitCny = limitCny;
    }

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

    /** Records required work even when it exceeds the planning target.
     * The caller can report the overrun, but must not turn a cost estimate into
     * an empty answer or a user-facing generation gate. */
    reserveRequired(costCny: number): boolean {
        if (!Number.isFinite(costCny) || costCny < 0) return false;
        this.reservedMicros += Math.ceil(costCny * 1e6);
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

export const READWEAVE_PRICING_VERSION = "deepseek-cny-2026-09-09";
export interface ReadWeaveModelRates {
    cacheHitInput: number;
    cacheMissInput: number;
    output: number;
}

/** Official CNY tariff: weekdays 01–04 / 06–10 UTC are peak hours.
 * Omit the time for a conservative peak-rate reservation, never a cache assumption.
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ */
export function readWeaveModelRates(model = "deepseek-flash", at?: Date): ReadWeaveModelRates {
    const weekday = at ? at.getUTCDay() >= 1 && at.getUTCDay() <= 5 : true;
    const hour = at?.getUTCHours();
    const peak = hour === undefined || weekday && (hour >= 1 && hour < 4 || hour >= 6 && hour < 10);
    const factor = peak ? 1 : 0.5;
    const pro = model.startsWith("deepseek-v4-pro");
    return { cacheHitInput:(pro ? 0.3 : 0.1) * factor,
        cacheMissInput:(pro ? 9 : 3) * factor,output:(pro ? 27 : 9) * factor };
}

/** The same configured rates settle reservations and produce the user estimate.
 * An incomplete or malformed receipt must never release a pending reservation. */
export function readWeaveModelUsageCost(
    usage?: MeteredUsage, rates = readWeaveModelRates()
): number | undefined {
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
    return (hit * rates.cacheHitInput + miss * rates.cacheMissInput + output * rates.output) / 1e6;
}

export const READWEAVE_ROUTINE_BUDGET_CNY = 0.05;
export const READWEAVE_DIFFICULT_BUDGET_CNY = 0.1;
export const READWEAVE_RESEARCH_ACTION_LIMIT = 20;

// Uses the configured DeepSeek rates already used by ReadWeave. This is an
// estimate, not a provider invoice; UTF-8 bytes conservatively bound input tokens.
export function readWeaveModelReservation(
    system: string, user: string, maxTokens: number, rates = readWeaveModelRates()
): number {
    return ((Buffer.byteLength(system + user, "utf8") + 256) * rates.cacheMissInput
        + maxTokens * rates.output) / 1e6;
}
