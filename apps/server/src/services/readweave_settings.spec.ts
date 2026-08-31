import { cls, hidden_subtree as hiddenSubtreeService } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
    getReadWeaveAiSettings,
    getReadWeaveVerifierRuntimeConfig,
    updateReadWeaveAiSettings
} from "./readweave_settings.js";
import sqlInit from "./sql_init.js";

describe("ReadWeave settings", () => {
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
                unpaywallEmail: unpaywallAddress
            });

            expect(settings.searchMode).toBe("automatic");
            expect(settings.searchBudgetCny).toBe(0.009);
            expect(settings.search.hasSerperApiKey).toBe(true);
            expect(settings.search.hasUnpaywallEmail).toBe(true);
            expect(JSON.stringify(settings)).not.toContain(serperSecret);
            expect(JSON.stringify(settings)).not.toContain(unpaywallAddress);
            expect(settings.search.freeProviders).toContain("Crossref");

            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-v4-flash",
                clearSerperApiKey: true,
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
});
