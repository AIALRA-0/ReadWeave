import { describe, expect, it } from "vitest";

import { ReadWeaveBudget, readWeaveModelReservation } from "./readweave_budget.js";
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
        budget.beginModelRequest(0.02);
        budget.reportModelUsage(0.02);
        expect(budget.modelRequests).toBe(2);
        expect(budget.unreportedModelCostCny).toBeCloseTo(0.01);
        expect(budget.remainingCny).toBe(0.02);
    });
});
