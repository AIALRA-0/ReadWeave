import type { ReadWeaveQuestionContract, ReadWeaveResearchAudit, ReadWeaveSemanticProposal } from "@triliumnext/commons";

type EvidenceNeed = NonNullable<ReadWeaveSemanticProposal["evidenceNeeds"]>[number];

export interface ReadWeaveNeedQuery {
    query: string;
    status: "pending" | "retrieved" | "empty" | "failed";
    sourceIds: string[];
    cacheHit: boolean;
    /** Another need already executed this exact query in this request. */
    reused: boolean;
}

export interface ReadWeaveNeedResearch extends EvidenceNeed {
    queries: ReadWeaveNeedQuery[];
    sourceIds: string[];
    pageSourceIds: string[];
    retrievalStatus: "unsearched" | "retrieved" | "no-results" | "unavailable";
    assessment: "unassessed";
    stopReason: ReadWeaveResearchAudit["stopReason"];
}

/** The proposal supplies evidence questions, never permissions or budgets.
 * No need or query is clipped; bounded execution leaves pending work visible. */
export function scheduleReadWeaveNeeds(contract: ReadWeaveQuestionContract): ReadWeaveNeedResearch[] {
    const taskContract = contract.taskContract;
    const originalQuestion = taskContract?.request.questionText ?? contract.normalizedQuestion;
    const proposed = taskContract?.interpretation.proposal.evidenceNeeds;
    const needs: EvidenceNeed[] = proposed?.length ? proposed : [{
        id: "root",
        taskIds: taskContract?.interpretation.proposal.tasks.map(task => task.id) ?? ["root"],
        subjectIds: [],
        questionToResolve: originalQuestion,
        candidateClaim: null,
        originRefs: taskContract ? [taskContract.request.questionRef] : [],
        whyNeeded: "Retrieve evidence for the original question.",
        sourcePreferences: [],
        // Legacy global query rewrites must not replace the original question.
        queryCandidates: [],
        freshness: { timeIntent: "unspecified", asOf: null, maxAgeSecondsHint: null, versionHint: null },
        necessity: "needed_for_specific_claim",
        alternativeIfMissing: "Keep the original task and qualify only claims lacking evidence."
    }];
    return needs.map(need => {
        const seen = new Set<string>();
        const queries = [need.questionToResolve, ...need.queryCandidates]
            .map(query => query.trim()).filter(query => {
                const key = query.toLocaleLowerCase();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            }).map(query => ({ query, status: "pending" as const, sourceIds: [], cacheHit: false, reused: false }));
        return {
            ...structuredClone(need), queries, sourceIds: [], pageSourceIds: [],
            retrievalStatus: "unsearched", assessment: "unassessed", stopReason: "exhausted"
        };
    });
}

/** Each need gets its first query before any need gets its second query. */
export function* readWeaveNeedQueries(needs: ReadWeaveNeedResearch[]) {
    for (let round = 0; needs.some(need => round < need.queries.length); round++) {
        for (const need of needs) {
            const query = need.queries[round];
            if (query) yield { need, query };
        }
    }
}
