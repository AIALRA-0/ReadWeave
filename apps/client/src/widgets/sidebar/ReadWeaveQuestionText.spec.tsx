// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { hasReadWeaveQuestionMath, ReadWeaveQuestionText } from "./ReadWeaveQuestionText.js";

const host = document.createElement("div");
document.body.append(host);
// Prime the same lazy module used in production before the assertions start
// their short DOM polling window. Full-suite cold compilation can otherwise
// consume that window even though rendering itself is healthy.
beforeAll(async () => { await import("../../services/math.js"); }, 30_000);
afterEach(async () => { await act(() => render(null, host)); });

describe("rendered question text", () => {
    it("recognizes paired math delimiters without treating plain text as math", () => {
        expect(hasReadWeaveQuestionMath("什么是 $x_i$？")).toBe(true);
        expect(hasReadWeaveQuestionMath("什么是 $$x_i$$？")).toBe(true);
        expect(hasReadWeaveQuestionMath("什么是 $x_i？")).toBe(false);
    });

    it("renders formula visually and rebuilds from the next raw question", async () => {
        await act(() => render(<ReadWeaveQuestionText text="解释 $x_i$" />, host));
        await vi.waitFor(() => expect(host.querySelector(".katex-html")).not.toBeNull());
        expect(host.textContent).not.toContain("$x_i$");
        await act(() => render(<ReadWeaveQuestionText text="解释 $y_i$" />, host));
        await vi.waitFor(() => expect(host.querySelector("annotation")?.textContent).toBe("y_i"));
        expect(host.querySelectorAll(".katex-html")).toHaveLength(1);
        await act(() => render(<ReadWeaveQuestionText text="普通问题" />, host));
        expect(host.textContent).toBe("普通问题");
        expect(host.querySelector(".katex-html")).toBeNull();
    });

    it("renders a display formula without exposing its delimiters", async () => {
        await act(() => render(<ReadWeaveQuestionText text={"解释 $$x_i + y_i$$ 的含义"} />, host));
        await vi.waitFor(() => expect(host.querySelector(".katex-display .katex-html")).not.toBeNull());
        expect(host.textContent).not.toContain("$$");
        expect(host.querySelector<HTMLElement>(".readweave-rendered-question-text")?.style.visibility).toBe("");
    });
});
