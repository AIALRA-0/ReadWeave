import { describe, expect, it } from "vitest";

import {
    ReadWeaveBudget,     type ReadWeaveBudgetSnapshot, readWeaveCnyToMicros, readWeaveEstimatedInputTokens, readWeaveModelPriceSnapshot,
    type ReadWeaveModelRates,
    readWeaveModelRates, readWeaveModelReservation, readWeaveModelUsageCost} from "./readweave_budget.js";
import { readWeaveWritingSkill } from "./readweave_writing_skill.js";

describe("maximum permitted input-rate reservation", () => {
    it("meters model and search charges beyond the former cap without dropping unsettled requests", () => {
        const budget = new ReadWeaveBudget(.05, { hardLimitCny: .10 });
        budget.raiseLimit(.10);
        const prior = budget.reserveModelRequest(.07)!;
        budget.reportModelUsage(prior, .064021);
        expect(budget.reserveModelRequest(.054234)).toBeUndefined();
        budget.suspendEnforcement();
        const writer = budget.reserveModelRequest(.054234)!;
        const search = budget.reserveResourceRequest(.0504)!;
        expect(writer).toBe(2);
        expect(search).toBe(3);
        expect(budget.reportModelUsage(writer, .059)).toBe(true);
        expect(budget.reportUsage(search, .0504, "configured-rate-estimate")).toBe(true);
        expect(budget.meteredEstimateCny).toBe(.173421);
        const pending = budget.reserveModelRequest(3.5)!;
        const restored = ReadWeaveBudget.restore(JSON.parse(JSON.stringify(budget.snapshot())));
        expect(restored.enforced).toBe(false);
        expect(restored.unreportedModelCostCny).toBe(3.5);
        expect(restored.reserveResourceRequest(.0504)).toBe(5);
        expect(restored.reportModelUsage(pending, .01)).toBe(true);
        expect(restored.reportModelUsage(pending, .02)).toBe(false);
        expect(restored.reserveModelRequest(NaN)).toBeUndefined();
        expect(restored.reserveModelRequest(Infinity)).toBeUndefined();
    });
    it("blocks the formerly under-reserved high-cache-hit compatible request before dispatch", () => {
        const rates = { cacheHitInput: 1000, cacheMissInput: 1, output: 1 };
        const reservation = readWeaveModelReservation("JSON", "review", 16, rates);
        expect(reservation).toBe(.261016);
        expect(new ReadWeaveBudget(.10).reserveModelRequest(reservation)).toBeUndefined();
        expect(readWeaveModelUsageCost({ prompt_tokens: 261, prompt_cache_hit_tokens: 261,
            prompt_cache_miss_tokens: 0, completion_tokens: 2 }, rates)).toBe(.261002);
    });

    it.each([[9, 1], [1, 9], [3, 3], [0, 0]])("covers every cache split at hit=%s and miss=%s", (hit, miss) => {
        const rates = { cacheHitInput: hit, cacheMissInput: miss, output: 2 };
        const input = readWeaveEstimatedInputTokens("JSONreview");
        const reservation = readWeaveModelReservation("JSON", "review", 16, rates);
        for (const hits of [0, Math.floor(input / 2), input]) {
            const cost = readWeaveModelUsageCost({ prompt_tokens: input, prompt_cache_hit_tokens: hits,
                prompt_cache_miss_tokens: input - hits, completion_tokens: 16 }, rates)!;
            expect(cost).toBeLessThanOrEqual(reservation);
        }
    });

    it.each([-1, NaN, Infinity, 10_001, "1"])("rejects malformed rates without authorizing a request: %s", rate => {
        for (const field of ["cacheHitInput", "cacheMissInput", "output"] as const) {
            const rates = { cacheHitInput: 1, cacheMissInput: 2, output: 3, [field]: rate } as ReadWeaveModelRates;
            const reservation = readWeaveModelReservation("JSON", "review", 16, rates);
            expect(new ReadWeaveBudget(.10).reserveModelRequest(reservation)).toBeUndefined();
            expect(readWeaveModelUsageCost({ prompt_tokens: 1, completion_tokens: 1 }, rates)).toBeUndefined();
        }
    });
});

describe("durable model price provenance", () => {
    const config = () => ({ baseUrl: "https://gateway.example.com/v1", providerType: "deepseek-compatible",
        model: "example-model", rates: { cacheHitInput: .2, cacheMissInput: 2, output: 6 } });

    it("derives stable IDs from actual route/model/rates rather than object order or a generic tag", () => {
        const input = config();
        const first = readWeaveModelPriceSnapshot(input);
        const same = readWeaveModelPriceSnapshot({ rates: { output: 6, cacheMissInput: 2, cacheHitInput: .2 },
            model: " example-model ", providerType: " deepseek-compatible ", baseUrl: "https://GATEWAY.example.com:443/v1/" });
        expect(same).toEqual(first);
        expect(first.priceSnapshotId).toMatch(/^readweave-price-v1:[a-f0-9]{64}$/u);
        for (const change of [
            { baseUrl: "https://other.example.com/v1" }, { baseUrl: "https://gateway.example.com/other" },
            { model: "fallback-model" }, { providerType: "another-compatible-provider" },
            { rates: { ...input.rates, cacheHitInput: .3 } },
            { rates: { ...input.rates, cacheMissInput: 3 } }, { rates: { ...input.rates, output: 7 } }
        ]) expect(readWeaveModelPriceSnapshot({ ...input, ...change }).priceSnapshotId).not.toBe(first.priceSnapshotId);
    });

    it("does not store a real provider URL or credentials from runtime config", () => {
        const input = { ...config(), apiKey: "placeholder", pricingVersion: "generic-version" };
        const prices = readWeaveModelPriceSnapshot(input);
        const encoded = JSON.stringify(prices);
        expect(encoded).not.toContain(input.baseUrl);
        expect(encoded).not.toContain("gateway.example.com");
        expect(encoded).not.toContain("apiKey");
        expect(encoded).not.toContain("placeholder");
        expect(encoded).not.toContain(input.pricingVersion);
        expect(prices.provider).toMatch(/^readweave-provider-v1:[a-f0-9]{64}$/u);
        expect(readWeaveModelPriceSnapshot({ ...input, apiKey: "redacted" } as typeof input)).toEqual(prices);
    });

    it.each(["https://user:placeholder@example.com/v1", "https://example.com/v1?token=placeholder",
        "https://example.com/v1#placeholder", "file:///private/path", "not-a-url"])("rejects unsafe provider metadata without exposing it: %s", baseUrl => {
        expect(() => readWeaveModelPriceSnapshot({ ...config(), baseUrl })).toThrow(/price snapshot/i);
        try { readWeaveModelPriceSnapshot({ ...config(), baseUrl }); } catch (error) {
            expect(String(error)).not.toContain(baseUrl);
        }
    });

    it("captures detached immutable rates before later settings edits", () => {
        const input = config(), prices = readWeaveModelPriceSnapshot(input);
        input.rates.output = 99;
        expect(prices.rates.output).toBe(6);
        expect(Object.isFrozen(prices)).toBe(true);
        expect(Object.isFrozen(prices.rates)).toBe(true);
        const budget = new ReadWeaveBudget(.05);
        budget.reserveModelRequest(.02, prices);
        const detached = budget.snapshot();
        detached.receipts[0].priceSnapshot!.rates.output = 100;
        expect(budget.snapshot().receipts[0].priceSnapshot).toEqual(prices);
    });

    it("persists pending snapshots before dispatch and reopens the same prices on retry", () => {
        let serialized = JSON.stringify(new ReadWeaveBudget(.05, { hardLimitCny: .10 }).snapshot());
        const storage = {
            read: () => JSON.parse(serialized) as ReadWeaveBudgetSnapshot,
            compareAndSwap: (previous: ReadWeaveBudgetSnapshot, next: ReadWeaveBudgetSnapshot) => {
                if (JSON.stringify(previous) !== serialized) return false;
                serialized = JSON.stringify(next);
                return true;
            }
        };
        const prices = readWeaveModelPriceSnapshot(config());
        const first = new ReadWeaveBudget(.05, { hardLimitCny: .10, storage });
        const receipt = first.reserveModelRequest(.04, prices)!;
        expect(JSON.parse(serialized).receipts[0].priceSnapshot).toEqual(prices);
        const retry = new ReadWeaveBudget(.05, { hardLimitCny: .10, storage });
        expect(retry.remainingCny).toBe(.01);
        expect(retry.unreportedModelCostCny).toBe(.04);
        const currentPrices = readWeaveModelPriceSnapshot({ ...config(), rates: { ...config().rates, output: 10 } });
        expect(currentPrices.priceSnapshotId).not.toBe(prices.priceSnapshotId);
        expect(retry.snapshot().receipts[receipt - 1].priceSnapshot).toEqual(prices);
        expect(retry.snapshot().receipts[receipt - 1].settlementPriceSnapshot).toBeUndefined();
    });

    it("keeps reservation and settlement tariffs distinct across a tariff boundary", () => {
        const peak = readWeaveModelPriceSnapshot(config());
        const offPeak = readWeaveModelPriceSnapshot({ ...config(), rates: { cacheHitInput: .1, cacheMissInput: 1, output: 3 } });
        const budget = new ReadWeaveBudget(.05);
        const receipt = budget.reserveModelRequest(.03, peak)!;
        expect(budget.reportModelUsage(receipt, .004, offPeak)).toBe(true);
        expect(budget.snapshot().receipts[0]).toMatchObject({ priceSnapshot: peak, settlementPriceSnapshot: offPeak,
            settledMicros: 4000, costBasis: "configured-rate-estimate" });
        expect(budget.knownCostCny).toBe(0);
        expect(budget.reportModelUsage(receipt, .004, offPeak)).toBe(true);
        expect(budget.reportModelUsage(receipt, .004)).toBe(true); // Legacy repeat cannot erase provenance.
        expect(budget.reportModelUsage(receipt, .004, peak)).toBe(false);
        expect(budget.snapshot().receipts[0].settlementPriceSnapshot).toEqual(offPeak);
        expect(ReadWeaveBudget.restore(JSON.parse(JSON.stringify(budget.snapshot()))).snapshot()).toEqual(budget.snapshot());
    });

    it("assigns a new receipt to fallback prices without repricing the failed original call", () => {
        const original = readWeaveModelPriceSnapshot(config());
        const fallback = readWeaveModelPriceSnapshot({ ...config(), model: "fallback-model" });
        const budget = new ReadWeaveBudget(.10);
        const failed = budget.reserveModelRequest(.04, original)!;
        const succeeded = budget.reserveModelRequest(.03, fallback)!;
        expect(budget.reportModelUsage(failed, .001, fallback)).toBe(false);
        expect(budget.reportModelUsage(succeeded, .005, fallback)).toBe(true);
        const retry = ReadWeaveBudget.restore(JSON.parse(JSON.stringify(budget.snapshot())));
        expect(retry.unreportedModelCostCny).toBe(.04);
        expect(retry.remainingCny).toBe(.055);
        expect(retry.snapshot().receipts.map(receipt => receipt.priceSnapshot?.priceSnapshotId))
            .toEqual([original.priceSnapshotId, fallback.priceSnapshotId]);
    });

    it("loads legacy receipts without inventing a price snapshot or provider", () => {
        const budget = new ReadWeaveBudget(.05);
        const receipt = budget.reserveModelRequest(.02)!;
        budget.reportModelUsage(receipt, .003);
        const pending = budget.reserveResourceRequest(.01)!;
        const restored = ReadWeaveBudget.restore(JSON.parse(JSON.stringify(budget.snapshot())));
        expect(restored.snapshot().receipts[0]).toEqual({ id: receipt, kind: "model", reservedMicros: 20_000,
            settledMicros: 3000, costBasis: "configured-rate-estimate" });
        expect(restored.snapshot().receipts[1]).toEqual({ id: pending, kind: "resource", reservedMicros: 10_000 });
    });

    it.each(["rates", "id", "provider", "currency", "extra-field", "pending-settlement"])("rejects corrupt persisted price metadata: %s", change => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserveModelRequest(.02, readWeaveModelPriceSnapshot(config()));
        const snapshot = budget.snapshot(), prices = snapshot.receipts[0].priceSnapshot!;
        if (change === "rates") prices.rates.output++;
        if (change === "id") prices.priceSnapshotId = "invented";
        if (change === "provider") prices.provider = config().baseUrl;
        if (change === "currency") Object.assign(prices, { currency: "USD" });
        if (change === "extra-field") Object.assign(prices, { baseUrl: config().baseUrl });
        if (change === "pending-settlement") snapshot.receipts[0].settlementPriceSnapshot = prices;
        expect(() => ReadWeaveBudget.restore(snapshot)).toThrow();
    });
});

describe("request-wide prepaid budget", () => {
    it("raises a .05 working target only within an explicitly authorized .10 hard ceiling", () => {
        const budget = new ReadWeaveBudget(.05, { hardLimitCny: .10 });
        expect(budget.limitCny).toBe(.05);
        expect(budget.hardLimitCny).toBe(.10);
        expect(budget.reserveModelRequest(.04)).toBe(1);
        expect(budget.reserveModelRequest(.02)).toBeUndefined();
        budget.raiseLimit(.10);
        expect(budget.remainingCny).toBe(.06);
        expect(budget.reserveModelRequest(.06)).toBe(2);
        expect(budget.reserveRequired(.000001)).toBe(false);
        expect(() => budget.raiseLimit(.100001)).toThrow(/immutable/);
        expect(() => new ReadWeaveBudget(.05, { hardLimitCny: .100001 })).toThrow();
        expect(() => new ReadWeaveBudget(.10, { hardLimitCny: .05 })).toThrow();
        const restored = ReadWeaveBudget.restore(JSON.parse(JSON.stringify(budget.snapshot())));
        expect(restored.hardLimitCny).toBe(.10);
        expect(restored.limitCny).toBe(.10);
        expect(restored.remainingCny).toBe(0);
        budget.raiseLimit(.05);
        expect(budget.limitCny).toBe(.10);
    });
    it("roundtrips detached integer snapshots with pending and settled receipts", () => {
        const budget = new ReadWeaveBudget(.05);
        const pending = budget.reserveModelRequest(.02)!;
        const settled = budget.reserveModelRequest(.015)!;
        expect(budget.reportModelUsage(settled, .003)).toBe(true);
        const snapshot = budget.snapshot();
        const restored = ReadWeaveBudget.restore(JSON.parse(JSON.stringify(snapshot)));
        snapshot.receipts[0].reservedMicros = 0;
        expect(restored.unreportedModelCostCny).toBe(.02);
        expect(restored.remainingCny).toBe(.027);
        expect(restored.reportModelUsage(settled, .003)).toBe(true);
        expect(restored.reportModelUsage(settled, .004)).toBe(false);
        expect(restored.remainingCny).toBe(.027);
        expect(restored.reportModelUsage(pending, .001)).toBe(true);
        expect(restored.reserveModelRequest(.01)).toBe(3);
        expect(budget.unreportedModelCostCny).toBe(.02);
    });
    it("separates known money, metered estimates, and pending upper-bound estimates", () => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserveModelRequest(.02); // Timed out, no usage receipt.
        const model = budget.reserveModelRequest(.015)!;
        const search = budget.reserveResourceRequest(.01)!;
        budget.reportModelUsage(model, .003);
        budget.reportUsage(search, .005, "actual");
        expect(budget.knownCostCny).toBe(.005);
        expect(budget.meteredEstimateCny).toBe(.003);
        expect(budget.upperBoundCny).toBe(.028);
        expect(budget.unreportedModelCostCny).toBe(.02);
        expect(budget.modelRequests).toBe(2);
    });
    it("keeps the server ceiling immutable and reserves unpaired model requests", () => {
        const budget = new ReadWeaveBudget(.05);
        expect(() => budget.raiseLimit(.10)).toThrow(/immutable/);
        expect(() => new ReadWeaveBudget(.100001)).toThrow();
        expect(() => new ReadWeaveBudget(NaN)).toThrow();
        const receipt = budget.beginModelRequest(.04);
        expect(budget.remainingCny).toBe(.01);
        expect(() => budget.beginModelRequest(.02)).toThrow(/ceiling/);
        expect(budget.modelRequests).toBe(1);
        expect(budget.reportModelUsage(receipt, .04)).toBe(true);
    });
    it("reports a real overrun without creating further spending authority", () => {
        const budget = new ReadWeaveBudget(.05);
        const receipt = budget.reserveModelRequest(.04)!;
        expect(budget.reportUsage(receipt, .06, "actual")).toBe(true);
        expect(budget.knownCostCny).toBe(.06);
        expect(budget.remainingCny).toBe(0);
        expect(budget.reserveRequired(.001)).toBe(false);
        expect(budget.reserveModelRequest(.001)).toBeUndefined();
        expect(ReadWeaveBudget.restore(budget.snapshot()).knownCostCny).toBe(.06);
    });
    it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER, "0.01", null])("fails closed for malformed amount %s", (amount) => {
        const budget = new ReadWeaveBudget(.05);
        const receipt = budget.reserveModelRequest(.02)!;
        const cost = amount as number;
        expect(budget.reserve(cost)).toBe(false);
        expect(budget.reserveRequired(cost)).toBe(false);
        expect(budget.reserveModelRequest(cost)).toBeUndefined();
        expect(budget.reportModelUsage(receipt, cost)).toBe(false);
        expect(budget.remainingCny).toBe(.03);
        expect(() => budget.beginModelRequest(cost)).toThrow();
    });
    it("rounds fractional micro-CNY upward without floating-point residue", () => {
        expect(readWeaveCnyToMicros(.010123)).toBe(10123);
        expect(readWeaveCnyToMicros(.0000011)).toBe(2);
        expect(readWeaveCnyToMicros(.00000000001)).toBe(1);
        const budget = new ReadWeaveBudget(.05);
        for (let index = 0; index < 10; index++) budget.reserve(.0000011);
        expect(budget.snapshot().unassignedMicros).toBe(20);
    });
    it.each([-.1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects noninteger or unsafe snapshot money %s", (amount) => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserveModelRequest(.02);
        const snapshot = budget.snapshot();
        expect(() => ReadWeaveBudget.restore({ ...snapshot, unassignedMicros: amount })).toThrow();
        expect(() => ReadWeaveBudget.restore({ ...snapshot, limitMicros: amount })).toThrow();
        snapshot.receipts[0].reservedMicros = amount;
        expect(() => ReadWeaveBudget.restore(snapshot)).toThrow();
    });
    it("rejects corrupt receipt identity and impossible pending totals", () => {
        const budget = new ReadWeaveBudget(.05);
        budget.reserveModelRequest(.03);
        const snapshot = budget.snapshot();
        snapshot.receipts.push({ ...snapshot.receipts[0], id: 2 });
        expect(() => ReadWeaveBudget.restore(snapshot)).toThrow();
        snapshot.receipts[1].reservedMicros = 1;
        snapshot.receipts[1].id = 1;
        expect(() => ReadWeaveBudget.restore(snapshot)).toThrow();
    });
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
    it("enforces the ceiling even for required work", () => {
        const budget = new ReadWeaveBudget(0.05);
        expect(budget.reserve(0.049)).toBe(true);
        expect(budget.reserve(0.01)).toBe(false);
        expect(budget.reserveRequired(0.01)).toBe(false);
        expect(budget.remainingCny).toBe(0.001);
    });
    it("reserves the cold-cache input with a safety margin and maximum output", () => {
        expect(readWeaveModelReservation("规则", "正文", 100)).toBe((260 * 3 + 900) / 1e6);
    });
    it("fits the complete skill prefix under the difficult-question cold-cache ceiling", () => {
        const { prompt } = readWeaveWritingSkill();
        expect(readWeaveModelReservation(prompt, "", 1600, readWeaveModelRates())).toBeLessThan(0.10);
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
            prompt_cache_miss_tokens:500,completion_tokens:100 })).toBe(.00245);
        expect(readWeaveModelUsageCost({ prompt_tokens:1000,completion_tokens:100 }))
            .toBe(.0039);
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
    it.each([
        [ "2026-09-09T00:59:59Z",4.5 ],[ "2026-09-09T01:00:00Z",9 ],
        [ "2026-09-09T03:59:59Z",9 ],[ "2026-09-09T04:00:00Z",4.5 ],
        [ "2026-09-09T06:00:00Z",9 ],[ "2026-09-09T09:59:59Z",9 ],
        [ "2026-09-09T10:00:00Z",4.5 ],[ "2026-09-12T06:00:00Z",4.5 ]
    ])("applies the official weekday tariff at %s", (date,output) => {
        expect(readWeaveModelRates("deepseek-v4-flash",new Date(date)).output).toBe(output);
    });
    it("reserves peak rates and distinguishes Pro from Flash", () => {
        expect(readWeaveModelRates()).toEqual({ cacheHitInput:.1,cacheMissInput:3,output:9 });
        expect(readWeaveModelRates("deepseek-v4-pro"))
            .toEqual({ cacheHitInput:.3,cacheMissInput:9,output:27 });
        const rates = readWeaveModelRates("deepseek-v4-flash",new Date("2026-09-12T06:00:00Z"));
        expect(readWeaveModelUsageCost({ prompt_tokens:1000,completion_tokens:100 },rates))
            .toBe(.00195);
    });
});
