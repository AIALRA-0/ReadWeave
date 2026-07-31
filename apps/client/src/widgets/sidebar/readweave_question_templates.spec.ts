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
        expect(decodeReadWeaveText("10.1109&amp;#x2F;TEST.2015.7342405")).toBe("10.1109/TEST.2015.7342405");
        expect(decodeReadWeaveText("&amp;amp;#47;")).toBe("/");
    });

    it("renders a readable question around the exact selected text", () => {
        expect(renderReadWeaveQuestionTemplate(DEFAULT_READWEAVE_QUESTION_TEMPLATES[0], "  “DOI”  "))
            .toBe("“DOI”是什么意思？");
        expect(DEFAULT_READWEAVE_QUESTION_TEMPLATES.every(template =>
            !/(?:请|给出|说明|解释原因|判断方法|适用条件)/u.test(template.pattern)
        )).toBe(true);
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

    it("upgrades stored built-in templates without changing custom templates", () => {
        const normalized = normalizeReadWeaveQuestionTemplates([
            {
                id: "what",
                label: "旧是什么",
                pattern: "“{selection}”是什么？请给出更多框定描述",
                uses: 7,
                builtin: true
            },
            {
                id: "custom-short",
                label: "自定义",
                pattern: "{selection}怎么回事？",
                uses: 3
            }
        ]);
        expect(normalized.find(template => template.id === "what")).toMatchObject({
            label: "是什么",
            pattern: "“{selection}”是什么？",
            uses: 7
        });
        expect(normalized.find(template => template.id === "custom-short")?.pattern).toBe("{selection}怎么回事？");
    });
});
