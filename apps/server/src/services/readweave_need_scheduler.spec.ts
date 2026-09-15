import type { ReadWeaveQuestionContract, ReadWeaveSemanticProposal, ReadWeaveTaskContract } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { readWeaveNeedQueries, scheduleReadWeaveNeeds } from "./readweave_need_scheduler.js";

const legacy = { normalizedQuestion: "The user's original question", searchQueries: ["Wrong person profile"] } as ReadWeaveQuestionContract;

describe("evidence need scheduling", () => {
    it("uses a root need when no semantic needs are available", () => {
        const [root] = scheduleReadWeaveNeeds(legacy);
        expect(root).toMatchObject({
            id: "root", questionToResolve: legacy.normalizedQuestion, candidateClaim: null,
            taskIds: ["root"], assessment: "unassessed", retrievalStatus: "unsearched"
        });
        expect(root.queries.map(query => query.query)).toEqual([legacy.normalizedQuestion]);
    });

    it("retains all needs and fairly schedules beyond the first twenty candidates", () => {
        const [root] = scheduleReadWeaveNeeds(legacy);
        const needs: NonNullable<ReadWeaveSemanticProposal["evidenceNeeds"]> = Array.from({ length: 45 }, (_, index) => ({
            ...root, id: `need-${index}`, questionToResolve: `Question ${index}`,
            queryCandidates: Array.from({ length: 25 }, (_, query) => `Alternative ${index}/${query}`)
        }));
        const input = {
            ...legacy,
            taskContract: {
                request: { questionText: "Original" },
                interpretation: { proposal: { tasks: [{ id: "root" }], evidenceNeeds: needs } }
            } as ReadWeaveTaskContract
        };
        const scheduled = scheduleReadWeaveNeeds(input);
        const queries = [...readWeaveNeedQueries(scheduled)];
        expect(scheduled).toHaveLength(45);
        expect(queries).toHaveLength(45 * 26);
        expect(queries[44]).toMatchObject({ need: { id: "need-44" }, query: { query: "Question 44" } });
        expect(queries[45]).toMatchObject({ need: { id: "need-0" }, query: { query: "Alternative 0/0" } });
        expect(queries.at(-1)?.query.query).toBe("Alternative 44/24");
    });

    it("deduplicates queries per need while retaining original proposal fields", () => {
        const [root] = scheduleReadWeaveNeeds(legacy);
        const evidenceNeeds: NonNullable<ReadWeaveSemanticProposal["evidenceNeeds"]> = [
            { ...root, queryCandidates: ["", root.questionToResolve.toUpperCase(), " Alternative "] }
        ];
        const input = {
            ...legacy,
            taskContract: {
                request: { questionText: "Original" },
                interpretation: { proposal: { tasks: [{ id: "root" }], evidenceNeeds } }
            } as ReadWeaveTaskContract
        };
        const [scheduled] = scheduleReadWeaveNeeds(input);
        expect(scheduled.queries.map(query => query.query)).toEqual([root.questionToResolve, "Alternative"]);
        expect(scheduled.queryCandidates).toEqual(evidenceNeeds[0].queryCandidates);
        scheduled.queryCandidates.push("Only runtime changes");
        expect(evidenceNeeds[0].queryCandidates).toHaveLength(3);
    });

    it("binds fallback evidence to the captured question and every proposed task", () => {
        const input: ReadWeaveQuestionContract = {
            ...legacy,
            taskContract: {
                request: { questionText: "Exact original", questionRef: { blockId: "q", locator: { kind: "whole" } } },
                interpretation: { proposal: { tasks: [{ id: "explain" }, { id: "compare" }] } }
            } as ReadWeaveTaskContract
        };
        const [root] = scheduleReadWeaveNeeds(input);
        expect(root.questionToResolve).toBe("Exact original");
        expect(root.taskIds).toEqual(["explain", "compare"]);
        expect(root.originRefs).toEqual([input.taskContract!.request.questionRef]);
    });
});
