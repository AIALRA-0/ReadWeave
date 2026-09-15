import { createHash } from "node:crypto";

export type ReadWeaveCostBasis = "actual" | "configured-rate-estimate";

/** Numeric tariff provenance, not a provider-confirmed bill or credential identity. */
export interface ReadWeavePriceSnapshot {
    version: 1;
    priceSnapshotId: string;
    currency: "CNY";
    unit: "CNY-per-million-tokens";
    /** Opaque route digest; neither the provider base URL nor credentials are stored. */
    provider: string;
    providerType: string;
    model: string;
    rates: ReadWeaveModelRates;
}

/** Copy only public routing and price fields; never retain an API key from config. */
export function readWeaveModelPriceSnapshot(config: {
    baseUrl: string; providerType: string; model: string; rates: ReadWeaveModelRates;
}): ReadWeavePriceSnapshot {
    let url: URL;
    try { url = new URL(config.baseUrl); } catch { throw new Error("Invalid price snapshot provider."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new Error("Price snapshot provider must be an uncredentialed base URL.");
    const provider = `readweave-provider-v1:${  createHash("sha256")
        .update(url.href.replace(/\/+$/u, "")).digest("hex")}`;
    return buildPriceSnapshot(provider, config.providerType, config.model, config.rates);
}

function buildPriceSnapshot(provider: string, rawProviderType: string, rawModel: string, rawRates: ReadWeaveModelRates): ReadWeavePriceSnapshot {
    if (typeof provider !== "string" || !/^readweave-provider-v1:[a-f0-9]{64}$/u.test(provider))
        throw new Error("Invalid price snapshot provider identity.");
    if (typeof rawProviderType !== "string" || !rawProviderType.trim()
        || typeof rawModel !== "string" || !rawModel.trim()) throw new Error("Invalid price snapshot model route.");
    if (!validModelRates(rawRates)) throw new Error("Invalid price snapshot rates.");
    const providerType = rawProviderType.trim(), model = rawModel.trim();
    const rates = Object.freeze({ cacheHitInput: rawRates.cacheHitInput || 0,
        cacheMissInput: rawRates.cacheMissInput || 0, output: rawRates.output || 0 });
    const priceSnapshotId = `readweave-price-v1:${  createHash("sha256").update(JSON.stringify([
        1, "CNY", "CNY-per-million-tokens", provider, providerType, model,
        rates.cacheHitInput, rates.cacheMissInput, rates.output
    ])).digest("hex")}`;
    return Object.freeze({ version: 1, priceSnapshotId, currency: "CNY", unit: "CNY-per-million-tokens",
        provider, providerType, model, rates });
}

function copyPriceSnapshot(value: ReadWeavePriceSnapshot): ReadWeavePriceSnapshot {
    if (!value || value.version !== 1 || value.currency !== "CNY" || value.unit !== "CNY-per-million-tokens")
        throw new Error("Invalid price snapshot.");
    if (Object.keys(value).some(key => !["version", "priceSnapshotId", "currency", "unit", "provider", "providerType", "model", "rates"].includes(key))
        || !value.rates || Object.keys(value.rates).some(key => !["cacheHitInput", "cacheMissInput", "output"].includes(key)))
        throw new Error("Unexpected price snapshot fields.");
    const canonical = buildPriceSnapshot(value.provider, value.providerType, value.model, value.rates);
    if (value.priceSnapshotId !== canonical.priceSnapshotId || value.provider !== canonical.provider
        || value.model !== canonical.model || value.providerType !== canonical.providerType)
        throw new Error("Price snapshot identity does not match its rates and route.");
    return canonical;
}

function samePriceRoute(left: ReadWeavePriceSnapshot, right: ReadWeavePriceSnapshot): boolean {
    return left.provider === right.provider && left.providerType === right.providerType && left.model === right.model;
}

export interface ReadWeaveBudgetReceipt {
    id: number;
    kind: "model" | "resource";
    reservedMicros: number;
    settledMicros?: number;
    costBasis?: ReadWeaveCostBasis;
    /** Tariff used to authorize this dispatch; immutable across retries. Legacy receipts omit it. */
    priceSnapshot?: ReadWeavePriceSnapshot;
    /** Tariff used for metered settlement, which may differ across an official tariff boundary. */
    settlementPriceSnapshot?: ReadWeavePriceSnapshot;
}

/** JSON-safe server state. All money is a nonnegative safe integer in micro-CNY. */
export interface ReadWeaveBudgetSnapshot {
    version: 1;
    limitMicros: number;
    hardLimitMicros: number;
    unassignedMicros: number;
    receipts: ReadWeaveBudgetReceipt[];
}

/** compareAndSwap must atomically replace only the exact previously read state. */
export interface ReadWeaveBudgetStorage {
    read(): ReadWeaveBudgetSnapshot;
    compareAndSwap(previous: ReadWeaveBudgetSnapshot, next: ReadWeaveBudgetSnapshot): boolean;
}

export interface ReadWeaveBudgetOptions {
    /** Server-authorized immutable ceiling. Defaults to the initial target. */
    hardLimitCny?: number;
    storage?: ReadWeaveBudgetStorage;
}

export function readWeaveCnyToMicros(costCny: number): number | undefined {
    if (typeof costCny !== "number" || !Number.isFinite(costCny) || costCny < 0) return undefined;
    const scaled = costCny * 1e6;
    const nearest = Math.round(scaled);
    // Remove representation noise at integer boundaries, not real fractional micro-CNY.
    const micros = Math.abs(scaled - nearest) <= Number.EPSILON * Math.abs(scaled) * 2
        ? nearest : Math.ceil(scaled);
    return Number.isSafeInteger(micros) ? micros : undefined;
}

function requireMicros(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid budget micro-CNY amount.");
}

function accountedMicros(state: ReadWeaveBudgetSnapshot): number {
    return state.receipts.reduce((sum, receipt) => sum + (receipt.settledMicros ?? receipt.reservedMicros), state.unassignedMicros);
}

function validateSnapshot(state: ReadWeaveBudgetSnapshot): void {
    if (!state || state.version !== 1 || !Array.isArray(state.receipts)) throw new Error("Invalid budget snapshot.");
    requireMicros(state.limitMicros);
    requireMicros(state.hardLimitMicros);
    requireMicros(state.unassignedMicros);
    if (state.hardLimitMicros > 100_000 || state.limitMicros > state.hardLimitMicros)
        throw new Error("Invalid budget ceiling or target.");
    for (const [index, receipt] of state.receipts.entries()) {
        if (!receipt || receipt.id !== index + 1 || !["model", "resource"].includes(receipt.kind))
            throw new Error("Invalid budget receipt.");
        requireMicros(receipt.reservedMicros);
        if (receipt.reservedMicros > state.limitMicros) throw new Error("Invalid budget reservation.");
        if (receipt.priceSnapshot !== undefined) copyPriceSnapshot(receipt.priceSnapshot);
        if (receipt.settlementPriceSnapshot !== undefined) {
            copyPriceSnapshot(receipt.settlementPriceSnapshot);
            if (receipt.settledMicros === undefined) throw new Error("Unsettled receipt has settlement prices.");
            if (receipt.priceSnapshot && !samePriceRoute(receipt.priceSnapshot, receipt.settlementPriceSnapshot))
                throw new Error("Settlement prices belong to a different model route.");
        }
        if (receipt.settledMicros !== undefined) {
            requireMicros(receipt.settledMicros);
            if (receipt.costBasis !== "actual" && receipt.costBasis !== "configured-rate-estimate")
                throw new Error("Invalid budget cost basis.");
        } else if (receipt.costBasis !== undefined) throw new Error("Unsettled receipt has a cost basis.");
    }
    if (state.unassignedMicros > state.limitMicros) throw new Error("Invalid unassigned reservation.");
    requireMicros(accountedMicros(state));
    // Settled provider costs may reveal an overrun; unknown reservations cannot cause one.
    const pending = state.receipts.filter(r => r.settledMicros === undefined)
        .reduce((sum, r) => sum + r.reservedMicros, state.unassignedMicros);
    if (pending > state.limitMicros) throw new Error("Pending reservations exceed budget ceiling.");
}

/** One immutable server ceiling per job. Persist before starting billable work.
 * A timeout has no settlement operation: its reservation remains across restarts. */
export class ReadWeaveBudget {
    private state: ReadWeaveBudgetSnapshot;
    private readonly ceilingMicros: number;
    private readonly storage?: ReadWeaveBudgetStorage;

    constructor(limitCny = 0.05, options: ReadWeaveBudgetOptions | ReadWeaveBudgetStorage = {}) {
        const limitMicros = readWeaveCnyToMicros(limitCny);
        const config = "read" in options ? { storage: options } : options;
        const hardLimitMicros = readWeaveCnyToMicros(config.hardLimitCny ?? limitCny);
        if (limitMicros === undefined || hardLimitMicros === undefined
            || hardLimitMicros > 100_000 || limitMicros > hardLimitMicros) throw new Error("Invalid budget ceiling.");
        this.ceilingMicros = hardLimitMicros;
        this.storage = config.storage;
        this.state = { version: 1, limitMicros, hardLimitMicros, unassignedMicros: 0, receipts: [] };
        if (this.storage) this.snapshot();
    }

    static restore(snapshot: ReadWeaveBudgetSnapshot): ReadWeaveBudget {
        validateSnapshot(snapshot);
        const budget = new ReadWeaveBudget(snapshot.limitMicros / 1e6, { hardLimitCny: snapshot.hardLimitMicros / 1e6 });
        budget.state = structuredClone(snapshot);
        return budget;
    }

    snapshot(): ReadWeaveBudgetSnapshot {
        const state = this.storage?.read() ?? this.state;
        validateSnapshot(state);
        if (state.hardLimitMicros !== this.ceilingMicros) throw new Error("Budget ceiling is immutable.");
        return structuredClone(state);
    }

    private update<T>(change: (state: ReadWeaveBudgetSnapshot) => T): T {
        for (let attempt = 0; attempt < 32; attempt++) {
            const previous = this.snapshot();
            const next = structuredClone(previous);
            const result = change(next);
            validateSnapshot(next);
            if (!this.storage || this.storage.compareAndSwap(previous, next)) {
                this.state = next;
                return result;
            }
        }
        throw new Error("Budget reservation contention; no work was authorized.");
    }

    get limitCny(): number { return this.snapshot().limitMicros / 1e6; }
    get hardLimitCny(): number { return this.ceilingMicros / 1e6; }
    get modelRequests(): number { return this.snapshot().receipts.filter(r => r.kind === "model").length; }

    /** Raises the working target within the already-authorized immutable ceiling.
     * Example: new ReadWeaveBudget(.05, { hardLimitCny: .10 }) for authorized work. */
    raiseLimit(limitCny: number): void {
        const micros = readWeaveCnyToMicros(limitCny);
        if (micros === undefined || micros > this.ceilingMicros) throw new Error("Budget ceiling is immutable.");
        this.update(state => { state.limitMicros = Math.max(state.limitMicros, micros); });
    }

    get unreportedModelCostCny(): number {
        return this.snapshot().receipts.filter(r => r.kind === "model" && r.settledMicros === undefined)
            .reduce((sum, r) => sum + r.reservedMicros, 0) / 1e6;
    }

    /** Only provider-confirmed money, excluding costs computed from token tariffs. */
    get knownCostCny(): number {
        return this.snapshot().receipts.filter(r => r.costBasis === "actual")
            .reduce((sum, r) => sum + r.settledMicros!, 0) / 1e6;
    }

    get meteredEstimateCny(): number {
        return this.snapshot().receipts.filter(r => r.costBasis === "configured-rate-estimate")
            .reduce((sum, r) => sum + r.settledMicros!, 0) / 1e6;
    }

    /** Accounting upper-bound estimate; pending reservations are not known charges. */
    get upperBoundCny(): number { return accountedMicros(this.snapshot()) / 1e6; }
    get remainingCny(): number {
        const state = this.snapshot();
        return Math.max(0, state.limitMicros - accountedMicros(state)) / 1e6;
    }

    reserve(costCny: number): boolean {
        const micros = readWeaveCnyToMicros(costCny);
        if (micros === undefined) return false;
        return this.update(state => {
            if (micros > state.limitMicros - accountedMicros(state)) return false;
            state.unassignedMicros += micros;
            return true;
        });
    }

    /** Required work has the same ceiling as optional work. */
    reserveRequired(costCny: number): boolean { return this.reserve(costCny); }

    /** Preferred API: creates a receipt and reserves its entire cost atomically. */
    reserveModelRequest(costCny: number, priceSnapshot?: ReadWeavePriceSnapshot): number | undefined {
        return this.reserveRequest(costCny, "model", priceSnapshot);
    }
    reserveResourceRequest(costCny: number): number | undefined { return this.reserveRequest(costCny, "resource"); }

    private reserveRequest(costCny: number, kind: ReadWeaveBudgetReceipt["kind"], priceSnapshot?: ReadWeavePriceSnapshot): number | undefined {
        const micros = readWeaveCnyToMicros(costCny);
        if (micros === undefined) return undefined;
        const prices = priceSnapshot === undefined ? undefined : copyPriceSnapshot(priceSnapshot);
        return this.update(state => {
            if (micros > state.limitMicros - accountedMicros(state)) return undefined;
            const id = state.receipts.length + 1;
            state.receipts.push({ id, kind, reservedMicros: micros, ...(prices ? { priceSnapshot: prices } : {}) });
            return id;
        });
    }

    /** Legacy reserve()/beginModelRequest() pair. New callers should use reserveModelRequest(). */
    beginModelRequest(reservation: number): number {
        const micros = readWeaveCnyToMicros(reservation);
        if (micros === undefined) throw new Error("Invalid model reservation.");
        return this.update(state => {
            const prepaid = Math.min(state.unassignedMicros, micros);
            if (micros - prepaid > state.limitMicros - accountedMicros(state)) throw new Error("Budget ceiling reached.");
            state.unassignedMicros -= prepaid;
            const id = state.receipts.length + 1;
            state.receipts.push({ id, kind: "model", reservedMicros: micros });
            return id;
        });
    }

    reportModelUsage(receipt: number, actualCostCny: number, settlementPriceSnapshot?: ReadWeavePriceSnapshot): boolean {
        return this.reportUsage(receipt, actualCostCny, "configured-rate-estimate", settlementPriceSnapshot);
    }

    /** Identical settlements succeed without changing money; conflicting duplicates fail.
     * Only call with a valid usage receipt, never infer zero cost from a timeout or HTTP error. */
    reportUsage(receipt: number, costCny: number, costBasis: ReadWeaveCostBasis, settlementPriceSnapshot?: ReadWeavePriceSnapshot): boolean {
        const micros = readWeaveCnyToMicros(costCny);
        if (!Number.isSafeInteger(receipt) || receipt < 1 || micros === undefined
            || (costBasis !== "actual" && costBasis !== "configured-rate-estimate")) return false;
        const prices = settlementPriceSnapshot === undefined ? undefined : copyPriceSnapshot(settlementPriceSnapshot);
        return this.update(state => {
            const entry = state.receipts[receipt - 1];
            if (!entry) return false;
            if (prices && entry.priceSnapshot && !samePriceRoute(prices, entry.priceSnapshot)) return false;
            if (entry.settledMicros !== undefined) return entry.settledMicros === micros && entry.costBasis === costBasis
                && (!prices || entry.settlementPriceSnapshot?.priceSnapshotId === prices.priceSnapshotId);
            if (!Number.isSafeInteger(accountedMicros(state) - entry.reservedMicros + micros)) return false;
            entry.settledMicros = micros;
            entry.costBasis = costBasis;
            if (prices) entry.settlementPriceSnapshot = prices;
            return true;
        });
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

function validModelRates(rates: ReadWeaveModelRates): boolean {
    return !!rates && [rates.cacheHitInput, rates.cacheMissInput, rates.output]
        .every(rate => typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 10_000);
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
    if (!usage || !validModelRates(rates)) return undefined;
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

// Uses the configured rates for a preflight estimate, never for final billing.
// DeepSeek documents about 0.6 token per Chinese character and 0.3 per
// English character. Use a 50% safety margin; UTF-8 bytes
// triple-count ordinary Chinese and would incorrectly consume the search
// allowance when the complete writing skill is supplied.
export function readWeaveEstimatedInputTokens(text: string): number {
    let han = 0;
    let ascii = 0;
    let other = 0;
    for (const character of text) {
        if (/\p{Script=Han}/u.test(character)) han++;
        else if (character.codePointAt(0)! <= 0x7f) ascii++;
        else other++;
    }
    return Math.ceil(han * 0.9 + ascii * 0.45 + other * 1.5 + 256);
}

export function readWeaveModelReservation(
    system: string, user: string, maxTokens: number, rates = readWeaveModelRates()
): number {
    // Custom gateways may charge more for a cache hit than a miss. Reserve the
    // larger permitted rate without assuming which cache class the provider uses.
    if (!validModelRates(rates) || !Number.isSafeInteger(maxTokens) || maxTokens < 0) return NaN;
    return (readWeaveEstimatedInputTokens(system + user) * Math.max(rates.cacheHitInput, rates.cacheMissInput)
        + maxTokens * rates.output) / 1e6;
}
