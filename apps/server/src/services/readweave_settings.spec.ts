import { cls, hidden_subtree as hiddenSubtreeService } from "@triliumnext/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { NonRetryableReadWeaveError } from "./readweave_errors.js";
import {
    getReadWeaveAiSettings,
    getReadWeaveRuntimeConfig,
    getReadWeaveVerifierRuntimeConfig,
    listReadWeaveModels,
    updateReadWeaveAiSettings
} from "./readweave_settings.js";
import sqlInit from "./sql_init.js";

describe("ReadWeave settings", () => {
    afterEach(() => vi.unstubAllGlobals());
    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
        cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    it("stores the API key locally while returning only a mask", () => {
        cls.init(() => {
            const secret = "test-not-a-real-secret-1234";
            const settings = updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com/",
                model: "deepseek-v4-pro",
                apiKey: secret
            });

            expect(settings).toMatchObject({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                hasApiKey: true,
                credentialSource: "settings"
            });
            expect(JSON.stringify(settings)).not.toContain(secret);
            expect(getReadWeaveAiSettings().maskedApiKey).toMatch(/^tes.*1234$/);

            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-pro",
                clearApiKey: true
            });
        });
    });

    it("supports arbitrary compatible gateways, model aliases and independent pricing", () => {
        cls.init(() => {
            const settings = updateReadWeaveAiSettings({
                providerType:"deepseek-compatible",baseUrl:"https://gateway.example",model:"vendor/deepseek-chat",
                apiKey:"placeholder",cacheHitInputCnyPerMillion:0.01,
                cacheMissInputCnyPerMillion:0.1,outputCnyPerMillion:0.2
            });
            expect(settings).toMatchObject({ providerType:"deepseek-compatible",baseUrl:"https://gateway.example/v1",
                pricing:{ source:"custom",outputCnyPerMillion:0.2 } });
            expect(getReadWeaveRuntimeConfig()).toMatchObject({ rates:{ cacheHitInput:0.01,cacheMissInput:0.1,output:0.2 },
                pricingVersion:"third-party-configured-cny-v1" });
            expect(JSON.stringify(settings)).not.toContain('"placeholder"');
            expect(()=>updateReadWeaveAiSettings({ baseUrl:"https://different.example/v1",model:"deepseek-chat" }))
                .toThrow("原来源密钥不会自动发送");
            updateReadWeaveAiSettings({ baseUrl:"https://api.deepseek.com",model:"deepseek-v4-flash",clearApiKey:true });
        });
    });

    it.each([ -1, Number.NaN, Infinity, "0.1" ])("rejects an invalid price %s without replacing the provider", price => {
        cls.init(()=>{
            const before = getReadWeaveAiSettings();
            expect(()=>updateReadWeaveAiSettings({ baseUrl:"https://gateway.example/v1",model:"deepseek-chat",
                outputCnyPerMillion:price as number })).toThrow();
            expect(getReadWeaveAiSettings()).toEqual(before);
        });
    });

    it("rejects URL credentials", () => {
        const address = new URL("https://gateway.example");
        address.username = "example";
        address.password = "placeholder";
        cls.init(() => expect(() => updateReadWeaveAiSettings({
            baseUrl: address.href, model: "deepseek-chat"
        })).toThrow("不能包含账号"));
    });

    it("validates optional settings before changing provider or credentials", () => {
        cls.init(() => {
            const before = getReadWeaveAiSettings();
            expect(() => updateReadWeaveAiSettings({
                baseUrl: "https://gateway.example/v1",
                model: "deepseek-chat",
                apiKey: "placeholder",
                mathShortcut: "invalid shortcut"
            })).toThrow("shortcut");
            expect(getReadWeaveAiSettings()).toEqual(before);
        });
    });

    it.each([ 200,401,402,403,404,429,503 ])("tests the configured gateway without disclosing credentials: %s", async status => {
        await cls.init(async()=>{
            updateReadWeaveAiSettings({ baseUrl:"https://gateway.example",model:"deepseek-chat",apiKey:"placeholder" });
            vi.stubGlobal("fetch",vi.fn(async()=>Response.json(status===200?{ data:[ { id:"deepseek-chat" } ] }:
                { error:{ message:"placeholder" } },{ status })));
            try {
                if(status===200) expect(await listReadWeaveModels()).toEqual([ { id:"deepseek-chat" } ]);
                else await expect(listReadWeaveModels()).rejects.toThrow(`HTTP ${status}`);
                expect(fetch).toHaveBeenCalledTimes(1);
                expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://gateway.example/v1/models");
            } finally {
                updateReadWeaveAiSettings({ baseUrl:"https://api.deepseek.com",model:"deepseek-v4-flash",clearApiKey:true });
            }
        });
    });

    it("explains a gateway returning a website instead of JSON", async()=>{
        await cls.init(async()=>{
            updateReadWeaveAiSettings({ baseUrl:"https://gateway.example",model:"deepseek-chat",apiKey:"placeholder" });
            vi.stubGlobal("fetch",vi.fn(async()=>new Response("<html>login</html>")));
            try { await expect(listReadWeaveModels()).rejects.toThrow("/v1"); }
            finally { updateReadWeaveAiSettings({ baseUrl:"https://api.deepseek.com",model:"deepseek-v4-flash",clearApiKey:true }); }
        });
    });

    it("stores optional search credentials locally and exposes only masks", () => {
        cls.init(() => {
            const serperSecret = "serper-not-a-real-secret-1234";
            const unpaywallAddress = [ "reader", "example.org" ].join("@");
            const settings = updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                searchMode: "automatic",
                searchBudgetCny: 0.009,
                serperApiKey: serperSecret,
                exaApiKey: "exa-not-a-real-secret-5678",
                unpaywallEmail: unpaywallAddress
            });

            expect(settings.searchMode).toBe("always");
            expect(settings.searchBudgetCny).toBe(0.009);
            expect(settings.search.hasSerperApiKey).toBe(true);
            expect(settings.search.hasExaApiKey).toBe(true);
            expect(settings.search.hasUnpaywallEmail).toBe(true);
            expect(JSON.stringify(settings)).not.toContain(serperSecret);
            expect(JSON.stringify(settings)).not.toContain("exa-not-a-real-secret-5678");
            expect(JSON.stringify(settings)).not.toContain(unpaywallAddress);
            expect(settings.search.freeProviders).toContain("Crossref");

            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                clearSerperApiKey: true,
                clearExaApiKey: true,
                clearUnpaywallEmail: true
            });
        });
    });

    it("accepts a verifier only when it uses a different service origin", () => {
        cls.init(() => {
            const writerSecret = "writer-not-a-real-secret-1234";
            const verifierSecret = "verifier-not-a-real-secret-5678";
            let settings = updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                apiKey: writerSecret,
                verifierBaseUrl: "https://api.deepseek.com/v1",
                verifierModel: "deepseek-verifier",
                verifierApiKey: verifierSecret
            });

            expect(settings.verifier.independent).toBe(false);
            expect(getReadWeaveVerifierRuntimeConfig()).toBeUndefined();

            settings = updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                verifierBaseUrl: "https://independent.example.com/v1",
                verifierModel: "deepseek-independent-verifier"
            });
            expect(settings.verifier.independent).toBe(false);
            expect(getReadWeaveVerifierRuntimeConfig()).toBeUndefined();

            settings = updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                verifierBaseUrl: "https://independent.example.com/v1",
                verifierModel: "independent-verifier"
            });
            expect(settings.verifier.independent).toBe(true);
            expect(settings.verifier.maskedApiKey).toMatch(/^ver.*5678$/);
            expect(JSON.stringify(settings)).not.toContain(verifierSecret);
            expect(getReadWeaveVerifierRuntimeConfig()).toMatchObject({
                baseUrl: "https://independent.example.com/v1",
                model: "independent-verifier"
            });

            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                clearApiKey: true,
                clearVerifierApiKey: true,
                verifierBaseUrl: "",
                verifierModel: ""
            });
        });
    });

    it("classifies missing model credentials as a permanent configuration failure", () => {
        const previousEnvironmentKey = process.env.READWEAVE_DEEPSEEK_API_KEY;
        delete process.env.READWEAVE_DEEPSEEK_API_KEY;
        try {
            cls.init(() => {
                updateReadWeaveAiSettings({
                    baseUrl: "https://api.deepseek.com",
                    model: "deepseek-v4-flash",
                    clearApiKey: true
                });
                expect(() => getReadWeaveRuntimeConfig()).toThrow(NonRetryableReadWeaveError);
                expect(() => getReadWeaveRuntimeConfig()).toThrow(/Add an API key/);
            });
        } finally {
            if (previousEnvironmentKey === undefined) delete process.env.READWEAVE_DEEPSEEK_API_KEY;
            else process.env.READWEAVE_DEEPSEEK_API_KEY = previousEnvironmentKey;
        }
    });
});
