import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";

import { type ReadWeaveModelRates,readWeaveModelReservation } from "./readweave_budget.js";

/** Keep full passages and stable source IDs; the retrieved catalogue stays in the audit.
 * Mandatory selection is retained, external evidence precedes optional nearby context.
 * Never shorten the answer's reserved output in order to pack more search snippets. */
export function fitReadWeaveWriterEvidence(
    sources: ReadWeaveEvidenceSource[], mandatoryIds: ReadonlySet<string>,
    buildInput: (sources: ReadWeaveEvidenceSource[]) => string,
    system: string, outputTokens: number, rates: ReadWeaveModelRates, availableCny: number
): { sources: ReadWeaveEvidenceSource[]; input: string; reservation: number } {
    let chosen = sources.filter(source => mandatoryIds.has(source.sourceId));
    const cost = (items: ReadWeaveEvidenceSource[]) => readWeaveModelReservation(system, buildInput(items), outputTokens, rates);
    const optional = sources.filter(source => !mandatoryIds.has(source.sourceId))
        .toSorted((a, b) => Number(b.sourceType === "external") - Number(a.sourceType === "external"));
    const seen = new Set(chosen.map(source => source.excerpt));
    for (const source of optional) {
        if (seen.has(source.excerpt)) continue;
        const candidate = [ ...chosen, source ];
        if (Math.ceil(cost(candidate) * 1e6) <= Math.floor(availableCny * 1e6)) {
            chosen = candidate;
            seen.add(source.excerpt);
        }
    }
    return { sources: chosen, input: buildInput(chosen), reservation: cost(chosen) };
}
