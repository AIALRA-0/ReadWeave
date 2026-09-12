import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

import { type ReadWeaveModelRates,readWeaveModelReservation } from "./readweave_budget.js";

/** Cost planning must not silently discard article context or collected evidence.
 * Keep every source ID. The input builder compacts repeated passages losslessly. */
export function fitReadWeaveWriterEvidence(
    sources: ReadWeaveEvidenceSource[], _mandatoryIds: ReadonlySet<string>,
    buildInput: (sources: ReadWeaveEvidenceSource[]) => string,
    system: string, outputTokens: number, rates: ReadWeaveModelRates, _availableCny: number
): { sources: ReadWeaveEvidenceSource[]; input: string; reservation: number } {
    const input = buildInput(sources);
    return { sources, input, reservation: readWeaveModelReservation(system, input, outputTokens, rates) };
}
