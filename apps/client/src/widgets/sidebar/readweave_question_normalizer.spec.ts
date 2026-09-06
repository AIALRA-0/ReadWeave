import { describe, expect, it } from "vitest";

import { normalizeReadWeaveQuestionDraft } from "./readweave_question_normalizer.js";

describe("ReadWeave question normalization", () => {
    it.each([
        [ "啥事流行病学", "“流行病学”是什么？" ],
        [ "流行病学是啥", "“流行病学”是什么？" ],
        [ "啥是‘流行病学’？", "“流行病学”是什么？" ],
        [ "怎么理解缓存？", "“缓存”是什么？" ]
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizeReadWeaveQuestionDraft(input)).toBe(expected);
    });

    it("preserves a non-definition question while normalizing punctuation", () => {
        expect(normalizeReadWeaveQuestionDraft("缓存为什么能提速? ")).toBe("缓存为什么能提速？");
    });
});
