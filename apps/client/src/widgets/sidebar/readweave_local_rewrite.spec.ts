import { describe, expect, it } from "vitest";

import { applyReadWeaveLocalReplacement } from "./readweave_local_rewrite.js";

describe("ReadWeave local rewrite", () => {
    it("changes only the selected fragment", () => {
        const body = "容器编排负责安排服务，系统会持续检查运行状态";
        const selectedText = "安排服务";
        const start = body.indexOf(selectedText);
        const next = applyReadWeaveLocalReplacement({
            body,
            selectedText,
            replacement: "调度服务",
            start,
            end: start + selectedText.length
        });

        expect(next).toBe("容器编排负责调度服务，系统会持续检查运行状态");
    });

    it("rejects a stale range and a paragraph-shaped replacement", () => {
        const body = "原句，后句";
        expect(() => applyReadWeaveLocalReplacement({
            body,
            selectedText: "旧句",
            replacement: "新句",
            start: 0,
            end: 2
        })).toThrow("回答内容已经变化");

        expect(() => applyReadWeaveLocalReplacement({
            body,
            selectedText: "原句",
            replacement: "整段\n\n新内容",
            start: 0,
            end: 2
        })).toThrow("整段内容");
    });
});
