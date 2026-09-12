import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_READWEAVE_GENERATION_PREFERENCES, readReadWeaveGenerationPreferences, readWeaveGenerationPreferenceKey, writeReadWeaveGenerationPreference } from "./readweave_generation_preferences.js";
import { DEFAULT_READWEAVE_QUESTION_TEMPLATES, renderReadWeaveQuestionTemplate } from "./readweave_question_templates.js";
import { normalizeReadWeaveQuestionDraft } from "./readweave_question_normalizer.js";

describe("generation preferences and automatic quotes", () => {
    beforeEach(() => localStorage.clear());
    it("persists all checkboxes across new reads, scoped to the hosted instance", () => {
        expect(readReadWeaveGenerationPreferences("/first/")).toEqual(DEFAULT_READWEAVE_GENERATION_PREFERENCES);
        for (const key of Object.keys(DEFAULT_READWEAVE_GENERATION_PREFERENCES) as (keyof typeof DEFAULT_READWEAVE_GENERATION_PREFERENCES)[]) {
            writeReadWeaveGenerationPreference(key, !DEFAULT_READWEAVE_GENERATION_PREFERENCES[key], "/first/");
        }
        expect(readReadWeaveGenerationPreferences("/first/")).toEqual({ optimizeQuestion: false, autoApplyPlan: false, externalSearchDisabled: true, quoteSelectedText: false });
        expect(readReadWeaveGenerationPreferences("/second/")).toEqual(DEFAULT_READWEAVE_GENERATION_PREFERENCES);
    });
    it("ignores invalid values and unavailable storage", () => {
        localStorage.setItem(readWeaveGenerationPreferenceKey(), '{"optimizeQuestion":"false","quoteSelectedText":false}');
        expect(readReadWeaveGenerationPreferences()).toMatchObject({ optimizeQuestion: true, quoteSelectedText: false });
        const get = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
        expect(readReadWeaveGenerationPreferences()).toEqual(DEFAULT_READWEAVE_GENERATION_PREFERENCES);
        get.mockRestore();
    });
    it("applies the quote choice to built-ins without stripping custom literal quotes", () => {
        const builtin = DEFAULT_READWEAVE_QUESTION_TEMPLATES[0];
        expect(renderReadWeaveQuestionTemplate(builtin, "text")).toBe("“text”是什么意思？");
        expect(renderReadWeaveQuestionTemplate(builtin, "text", false)).toBe("text是什么意思？");
        expect(renderReadWeaveQuestionTemplate({ id: "custom", label: "custom", pattern: 'Literal “quote”: “{selection}”?', uses: 0 }, "text", false)).toBe('Literal “quote”: “text”?');
        expect(normalizeReadWeaveQuestionDraft("啥是GPU", false)).toBe("GPU是什么？");
        expect(normalizeReadWeaveQuestionDraft("啥是“GPU”", false)).toBe("“GPU”是什么？");
        expect(normalizeReadWeaveQuestionDraft('Explain “literal quotes”?', false)).toBe('Explain “literal quotes”？');
    });
});
