import {describe,expect,it} from "vitest";
import {readWeavePromptInputTokens} from "./readweave_tokenizer.js";
import {readWeaveEstimatedInputTokens} from "./readweave_budget.js";
import {readWeaveWritingSkill} from "./readweave_writing_skill.js";

describe("complete skill token accounting", () => {
    it("encodes the complete official-model input without prefix truncation", () => {
        const skill = readWeaveWritingSkill(true).prompt;
        const count = readWeavePromptInputTokens(skill,"原问题","deepseek-v4-flash");
        expect(count).toBeGreaterThan(1000);
        expect(count).toBeLessThan(readWeaveEstimatedInputTokens(skill+"原问题"));
        expect(readWeavePromptInputTokens(skill,"原问题"+"末尾证据 ".repeat(500),"deepseek-v4-flash")).toBeGreaterThan(count);
        expect(readWeavePromptInputTokens(skill,"原问题","deepseek-v4-flash")).toBe(count);
    });
    it("does not claim exact accounting for an unknown third-party model", () => {
        expect(readWeavePromptInputTokens("规则","问题","custom-model")).toBe(readWeaveEstimatedInputTokens("规则问题"));
    });
});
