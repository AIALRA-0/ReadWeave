import { describe, expect, it } from "vitest";

import { insertOrReplaceReadWeaveQuestion, readWeaveQuestionStackFromText } from "./readweave_question_stack.js";

describe("ReadWeave question stack", () => {
    it("replaces the only question", () => {
        expect(insertOrReplaceReadWeaveQuestion("“缓存”是什么？", "“缓存”为什么能提速？", 3))
            .toBe("“缓存”为什么能提速？");
    });

    it("appends when the caret is at the end", () => {
        expect(insertOrReplaceReadWeaveQuestion("“缓存”是什么？", "“缓存”如何工作？"))
            .toBe("“缓存”是什么？\n“缓存”如何工作？");
    });

    it("replaces only the question containing the caret", () => {
        const current = "“缓存”是什么？\n“缓存”如何工作？";
        expect(insertOrReplaceReadWeaveQuestion(current, "“缓存”为什么能提速？", 10))
            .toBe("“缓存”是什么？\n“缓存”为什么能提速？");
    });

    it("round-trips an ordered stack without duplicating blank lines", () => {
        expect(readWeaveQuestionStackFromText(" 第一问？\n\n第二问？ ")).toEqual([
            { id: "question-1", text: "第一问？" },
            { id: "question-2", text: "第二问？" }
        ]);
    });
});
