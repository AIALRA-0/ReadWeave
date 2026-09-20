import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { probeReadWeaveApiProvider } from "./readweave_api_health.js";
import {
    getReadWeaveApiControlSettings,
    getReadWeavePrimaryModelRoute,
    initializeReadWeaveApiRegistry,
    resetReadWeaveApiRegistryForTests,
    updateReadWeaveApiControlSettings
} from "./readweave_api_registry.js";
import sql from "./sql.js";
import sqlInit from "./sql_init.js";

describe("ReadWeave API control plane", () => {
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        initializeReadWeaveApiRegistry(false);
    });

    beforeEach(() => {
        vi.unstubAllGlobals();
        sql.execute("UPDATE readweave_api_providers SET enabled = 0, apiKey = NULL, credentialSource = 'missing', healthJson = '{}' ");
        sql.execute("DELETE FROM readweave_api_health_checks");
        sql.execute("DELETE FROM readweave_api_alerts");
    });

    afterAll(() => {
        sql.execute("UPDATE readweave_api_providers SET enabled = 0, apiKey = NULL, credentialSource = 'missing', healthJson = '{}' ");
        sql.execute("DELETE FROM readweave_api_health_checks");
        sql.execute("DELETE FROM readweave_api_alerts");
        resetReadWeaveApiRegistryForTests();
    });

    it("stores provider credentials without returning the original value", () => {
        const secret = "test-kuafu-secret-123456";
        const snapshot = updateReadWeaveApiControlSettings({ providers: [ {
            id: "kuafu", enabled: true, role: "primary", baseUrl: "https://api.kuafushe.cc/v1/",
            model: "deepseek-v4.1-flash", apiKey: secret
        } ] });
        const provider = snapshot.providers.find(item => item.id === "kuafu");
        expect(provider).toMatchObject({ enabled: true, hasApiKey: true, baseUrl: "https://api.kuafushe.cc/v1" });
        expect(JSON.stringify(snapshot)).not.toContain(secret);
        expect(getReadWeavePrimaryModelRoute()).toMatchObject({ id: "kuafu", apiKey: secret, requestProtocol: "responses" });
    });

    it("records a successful model catalog and Responses probe", async () => {
        updateReadWeaveApiControlSettings({ providers: [ { id: "kuafu", enabled: true, apiKey: "placeholder", model: "deepseek-v4.1-flash" } ] });
        vi.stubGlobal("fetch", vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [ { id: "deepseek-v4.1-flash" } ] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ remaining: 0.18, usage: { total: { actual_cost: 0.02 } } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", output: [ { type: "message", content: [ { type: "output_text", text: "OK" } ] } ] }), { status: 200 })));
        const provider = await probeReadWeaveApiProvider("kuafu", true);
        expect(provider.health).toMatchObject({ state: "healthy", catalogVerified: true, callableVerified: true, consecutiveFailures: 0 });
        expect(provider.health.detectedModels).toEqual([ "deepseek-v4.1-flash" ]);
        expect(provider.health.quota).toMatchObject({ supported: true, remaining: 0.18, used: 0.02 });
        expect(provider.health.quota.limit).toBeCloseTo(0.2, 12);
    });

    it("turns an authentication failure into a visible actionable alert", async () => {
        updateReadWeaveApiControlSettings({ providers: [ { id: "tinyfish", enabled: true, apiKey: "placeholder" } ] });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid key" }), { status: 401 })));
        const provider = await probeReadWeaveApiProvider("tinyfish", true);
        expect(provider.health).toMatchObject({ state: "degraded", lastErrorCode: "authentication", consecutiveFailures: 1 });
        expect(getReadWeaveApiControlSettings().alerts).toEqual(expect.arrayContaining([
            expect.objectContaining({ providerId: "tinyfish", code: "authentication", active: true, requiresAction: true })
        ]));
    });

    it("rejects malformed endpoints before replacing a working configuration", () => {
        updateReadWeaveApiControlSettings({ providers: [ { id: "octen", baseUrl: "https://api.octen.ai", apiKey: "placeholder" } ] });
        expect(() => updateReadWeaveApiControlSettings({ providers: [ { id: "octen", baseUrl: "file:///tmp/invalid" } ] })).toThrow();
        expect(getReadWeaveApiControlSettings().providers.find(item => item.id === "octen")?.baseUrl).toBe("https://api.octen.ai");
    });

    it("selects the configured fallback after the primary route becomes unavailable", () => {
        updateReadWeaveApiControlSettings({ providers: [
            { id: "kuafu", enabled: true, role: "primary", priority: 10, apiKey: "placeholder", model: "deepseek-v4.1-flash" },
            { id: "deepseek-official", enabled: true, role: "fallback", priority: 20, apiKey: "placeholder", model: "deepseek-flash" }
        ] });
        const primary = getReadWeaveApiControlSettings().providers.find(item => item.id === "kuafu")!;
        sql.execute("UPDATE readweave_api_providers SET healthJson = ? WHERE providerId = 'kuafu'", [
            JSON.stringify({ ...primary.health, state: "unavailable", consecutiveFailures: 3 })
        ]);
        expect(getReadWeavePrimaryModelRoute()).toMatchObject({ id: "deepseek-official", apiKey: "placeholder" });
    });

    it("rejects nested or non-finite request parameters", () => {
        expect(() => updateReadWeaveApiControlSettings({ providers: [ {
            id: "kuafu", modelParameters: { temperature: Number.NaN }
        } ] })).toThrow("调用参数");
    });
});
