import { describe, expect, it } from "vitest";

import {
    decodeReadWeaveText,
    DEFAULT_READWEAVE_QUESTION_TEMPLATES,
    normalizeReadWeaveQuestionTemplates,
    rankedReadWeaveQuestionTemplates,
    recordReadWeaveTemplateUse,
    renderReadWeaveQuestionTemplate
} from "./readweave_question_templates.js";

describe("ReadWeave question templates", () => {
    it("decodes editor entities and removes invisible control characters", () => {
        expect(decodeReadWeaveText("conf&#x2F;dac&#x2F;CongLW00\u200B")).toBe("conf/dac/CongLW00");
        expect(decodeReadWeaveText("A&amp;B &#47; C")).toBe("A&B / C");
    });

    it("renders a readable question around the exact selected text", () => {
        expect(renderReadWeaveQuestionTemplate(DEFAULT_READWEAVE_QUESTION_TEMPLATES[0], "  “DOI”  "))
            .toBe("“DOI”是什么？请从零开始给出通用、准确且容易理解的说明");
    });

    it("learns frequently used templates while retaining intent-sensitive ranking", () => {
        const learned = recordReadWeaveTemplateUse(DEFAULT_READWEAVE_QUESTION_TEMPLATES, "example");
        expect(rankedReadWeaveQuestionTemplates(learned, "请解释", 1)[0].id).toBe("example");
        expect(rankedReadWeaveQuestionTemplates(learned, "为什么会失败", 2)[0].id).toBe("why");
    });

    it("rejects malformed stored templates and restores defaults when necessary", () => {
        expect(normalizeReadWeaveQuestionTemplates([ { id: "bad", label: "坏", pattern: "没有占位符" } ]))
            .toHaveLength(DEFAULT_READWEAVE_QUESTION_TEMPLATES.length);
    });
});
