import { beforeAll, describe, expect, it } from "vitest";

import optionsRoute from "../routes/api/options.js";
import cls from "./cls.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import {
    getReadWeaveAiSettings,
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
                model: "deepseek-chat",
                apiKey: secret
            });

            expect(settings).toMatchObject({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-chat",
                hasApiKey: true,
                credentialSource: "settings"
            });
            expect(JSON.stringify(settings)).not.toContain(secret);
            expect(JSON.stringify(optionsRoute.getOptions())).not.toContain(secret);
            expect(JSON.stringify(optionsRoute.getOptions())).not.toContain("readWeaveApiKey");
            expect(getReadWeaveAiSettings().maskedApiKey).toMatch(/^tes.*1234$/);

            updateReadWeaveAiSettings({
                baseUrl: "https://api.deepseek.com",
                model: "deepseek-chat",
                clearApiKey: true
            });
        });
    });
});
