import type { ReadWeaveEvidenceSource } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { fitReadWeaveWriterEvidence } from "./readweave_writer_budget.js";

describe("answer-first evidence allocation", () => {
    const source = (id:string, excerpt:string):ReadWeaveEvidenceSource => ({
        sourceId:id,excerpt,sourceType:id.startsWith("L")?"local":"external",title:id,provider:"test",accessedAt:"2026-01-01"
    });
    const input = (sources:ReadWeaveEvidenceSource[]) => JSON.stringify(sources.map(s=>[ s.sourceId,s.excerpt ]));
    const rates = { cacheHitInput:0.1,cacheMissInput:3,output:9 };
    it("retains all source identities regardless of a small planning budget",()=>{
        const selected = source("L1","条件为 3 秒，禁止上传");
        const complete = source("S2","The interval is three seconds; raw data must not be uploaded.");
        const result = fitReadWeaveWriterEvidence([ selected,source("S1","irrelevant ".repeat(3000)),complete,
            source("S3",complete.excerpt) ],new Set([ "L1" ]),input,"rules",1600,rates,0.02);
        expect(result.sources.map(source=>source.sourceId)).toEqual([ "L1","S1","S2","S3" ]);
        expect(result.reservation).toBeGreaterThan(.02);
        expect(result.input).toContain(complete.excerpt);
    });
    it("never silently discards a mandatory selection to meet an impossible tariff",()=>{
        const selected = source("L1","完整的指定原文");
        const result=fitReadWeaveWriterEvidence([ selected ],new Set([ "L1" ]),input,"rules",1600,rates,0.001);
        expect(result.sources).toEqual([ selected ]);
        expect(result.reservation).toBeGreaterThan(.001);
    });
});
