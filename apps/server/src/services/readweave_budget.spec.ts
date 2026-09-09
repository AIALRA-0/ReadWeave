import { describe, expect, it } from "vitest";

import {
    ReadWeaveBudget, readWeaveModelReservation, readWeaveModelUsageCost
} from "./readweave_budget.js";
describe("request-wide prepaid budget", () => {
    it.each([0.05, 0.1])("enforces the exact cap %s before a request", (cap) => {
        const budget = new ReadWeaveBudget(cap);
        expect(budget.reserve(cap - 0.001)).toBe(true);
        expect(budget.reserve(0.002)).toBe(false);
        expect(budget.remainingCny).toBe(0.001);
        expect(budget.reserve(0.001)).toBe(true);
        expect(budget.reserve(0.000001)).toBe(false);
    });
    it.each([-1, NaN, Infinity])("rejects invalid costs %s", (cost) => {
        expect(new ReadWeaveBudget(0.05).reserve(cost)).toBe(false);
    });
    it("accounts for Chinese UTF-8 input and maximum output", () => {
        expect(readWeaveModelReservation("规则", "正文", 100)).toBe((12 + 256 + 200) / 1e6);
    });
    it("does not hide failed or missing-usage model calls", () => {
        const budget = new ReadWeaveBudget(0.05);
        budget.reserve(0.01);
        budget.beginModelRequest(0.01);
        budget.reserve(0.02);
        const receipt = budget.beginModelRequest(0.02);
        budget.reportModelUsage(receipt,0.02);
        expect(budget.modelRequests).toBe(2);
        expect(budget.unreportedModelCostCny).toBeCloseTo(0.01);
        expect(budget.remainingCny).toBe(0.02);
    });
    it("releases unused reservation once, while retaining unknown failed-call cost", () => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserve(.0144); // Actual search cost.
        budget.reserve(.03);
        const receipt = budget.beginModelRequest(.03);
        expect(budget.remainingCny).toBe(.0056);
        expect(budget.reportModelUsage(receipt,.0046)).toBe(true);
        expect(budget.remainingCny).toBe(.031);
        expect(budget.reportModelUsage(receipt,0)).toBe(false);
        expect(budget.remainingCny).toBe(.031);
        expect(budget.reserve(.015)).toBe(true);
        budget.beginModelRequest(.015); // No usage receipt: keep this reservation.
        expect(budget.unreportedModelCostCny).toBeCloseTo(.015);
        expect(budget.remainingCny).toBe(.016);
        expect(budget.reserve(.016001)).toBe(false);
    });
    it("does not settle a malformed or unknown receipt", () => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserve(.02);
        const receipt = budget.beginModelRequest(.02);
        expect(budget.reportModelUsage(receipt,NaN)).toBe(false);
        expect(budget.reportModelUsage(receipt,-1)).toBe(false);
        expect(budget.reportModelUsage(receipt+1,0)).toBe(false);
        expect(budget.remainingCny).toBe(.03);
        expect(budget.unreportedModelCostCny).toBe(.02);
    });
    it("uses the same receipt rates for the ledger and displayed cost", () => {
        expect(readWeaveModelUsageCost({ prompt_tokens:1000,prompt_cache_hit_tokens:500,
            prompt_cache_miss_tokens:500,completion_tokens:100 })).toBe(.00071);
        expect(readWeaveModelUsageCost({ prompt_tokens:1000,completion_tokens:100 }))
            .toBe(.0012);
        expect(readWeaveModelUsageCost({ prompt_tokens:0,completion_tokens:0 })).toBe(0);
        expect(readWeaveModelUsageCost({ prompt_tokens:1000 })).toBeUndefined();
        expect(readWeaveModelUsageCost({ prompt_tokens:1000,completion_tokens:NaN }))
            .toBeUndefined();
        expect(readWeaveModelUsageCost({ prompt_tokens:10,prompt_cache_hit_tokens:11,
            completion_tokens:1 })).toBeUndefined();
        expect(readWeaveModelUsageCost({ prompt_tokens:100,prompt_cache_miss_tokens:1,
            completion_tokens:1 })).toBeUndefined();
        expect(readWeaveModelUsageCost({ prompt_tokens:1.5,completion_tokens:1 })).toBeUndefined();
    });
    it("separates equal reservations and clears pending cost without float residue", () => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserve(.010123);
        const first = budget.beginModelRequest(.010123);
        budget.reserve(.010123);
        const second = budget.beginModelRequest(.010123);
        expect(budget.reportModelUsage(first,.001001)).toBe(true);
        expect(budget.reportModelUsage(first,0)).toBe(false);
        expect(budget.unreportedModelCostCny).toBe(.010123);
        expect(budget.reportModelUsage(second,.001002)).toBe(true);
        expect(budget.unreportedModelCostCny).toBe(0);
        expect(budget.remainingCny).toBe(.047997);
    });
});
