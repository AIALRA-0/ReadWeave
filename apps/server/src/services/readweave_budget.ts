/** One request owns one ledger. Reservations happen before any billable work. */
export class ReadWeaveBudget {
    private reservedMicros = 0;
    modelRequests = 0;
    unreportedModelCostCny = 0;
    constructor(readonly limitCny: number) {}

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

    beginModelRequest(reservation: number): void {
        this.modelRequests++;
        this.unreportedModelCostCny += reservation;
    }

    reportModelUsage(reservation: number): void {
        this.unreportedModelCostCny = Math.max(0, this.unreportedModelCostCny - reservation);
    }
}

export const READWEAVE_ROUTINE_BUDGET_CNY = 0.05;
export const READWEAVE_DIFFICULT_BUDGET_CNY = 0.1;
export const READWEAVE_RESEARCH_ACTION_LIMIT = 20;

// Uses the configured DeepSeek rates already used by ReadWeave. This is an
// estimate, not a provider invoice; UTF-8 bytes conservatively bound input tokens.
export function readWeaveModelReservation(system: string, user: string, maxTokens: number): number {
    return (Buffer.byteLength(system + user, "utf8") + 256 + maxTokens * 2) / 1e6;
}
