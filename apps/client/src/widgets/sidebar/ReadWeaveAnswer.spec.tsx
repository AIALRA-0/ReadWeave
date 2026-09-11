// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadWeaveAnswer, readWeaveAnswerSelection } from "./ReadWeaveAnswer.js";
const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
    await act(() => render(null, host));
    window.getSelection()?.removeAllRanges();
});
describe("selectable Markdown answers", () => {
    it("renders lists, code and links instead of plain Markdown text", async () => {
        await act(() =>
            render(
                <ReadWeaveAnswer
                    body={"- 第一项\n- 第二项\n\n`a: 1`\n\n[说明](https://example.org)"}
                />,
                host,
            ),
        );
        expect(host.querySelectorAll("li")).toHaveLength(2);
        expect(host.querySelector("code")?.textContent).toBe("a: 1");
        expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.org");
    });
    it("removes script and event handlers", async () => {
        await act(() =>
            render(
                <ReadWeaveAnswer
                    body={'正文<script>alert(1)</script><img src=x onerror="alert(1)">'}
                />,
                host,
            ),
        );
        expect(host.querySelector("script")).toBeNull();
        expect(host.querySelector("[onerror]")).toBeNull();
    });
    it("maps the second repeated phrase to its own source offsets", async () => {
        const body = "**相同文本**\n\n相同文本";
        await act(() => render(<ReadWeaveAnswer body={body} />, host));
        const root = host.querySelector<HTMLElement>(".readweave-readable-body")!;
        const text = root.querySelectorAll("p")[1].firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 4);
        expect(readWeaveAnswerSelection(root, body, range, 7)).toEqual({
            parentRevision: 7,
            startOffset: 10,
            endOffset: 14,
            text: "相同文本",
        });
    });
    it("maps decoded entities back to the exact saved representation", async () => {
        const body = "甲 &amp; 乙";
        await act(() => render(<ReadWeaveAnswer body={body} />, host));
        const root = host.querySelector<HTMLElement>(".readweave-readable-body")!;
        const text = root.querySelector("p")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 2);
        range.setEnd(text, 3);
        expect(readWeaveAnswerSelection(root, body, range, 1)?.text).toBe("&amp;");
    });
    it("maps a rendered inline formula back to one complete Markdown formula", () => {
        const body = "前文 $Ax=b$ 后文";
        const root = document.createElement("div");
        root.innerHTML = '<p>前文 <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">Ax=b</annotation></math></span><span class="katex-html" aria-hidden="true"><span>Ax=b</span></span></span> 后文</p>';
        const visual = root.querySelector<HTMLElement>(".katex-html span")!.firstChild!;
        const range = document.createRange();
        range.setStart(visual, 1);
        range.setEnd(visual, 3);
        expect(readWeaveAnswerSelection(root, body, range, 2)).toEqual({
            parentRevision: 2,
            startOffset: 3,
            endOffset: 9,
            text: "$Ax=b$",
        });
    });
    it("keeps mixed prose and rendered math in source order without duplicate MathML text", () => {
        const body = "甲 $x^2$ 乙 $x^2$ 丙";
        const root = document.createElement("div");
        root.innerHTML = '<p>甲 <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">x^2</annotation></math></span><span class="katex-html" aria-hidden="true"><span>x2</span></span></span> 乙 <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">x^2</annotation></math></span><span class="katex-html" aria-hidden="true"><span>x2</span></span></span> 丙</p>';
        const firstText = root.querySelector("p")!.firstChild!;
        const secondFormula = root.querySelectorAll<HTMLElement>(".katex-html span")[1].firstChild!;
        const range = document.createRange();
        range.setStart(firstText, 0);
        range.setEnd(secondFormula, 1);
        expect(readWeaveAnswerSelection(root, body, range, 4)?.text).toBe("甲 $x^2$ 乙 $x^2$");
    });
    it("offers save-and-follow-up after a keyboard selection", async () => {
        const follow = vi.fn();
        await act(() =>
            render(
                <ReadWeaveAnswer
                    body="可以选择答案"
                    followUpLabel="保存并追问"
                    onFollowUp={follow}
                />,
                host,
            ),
        );
        const root = host.querySelector<HTMLElement>(".readweave-readable-body")!;
        const range = document.createRange();
        range.selectNodeContents(root.querySelector("p")!.firstChild!);
        window.getSelection()!.addRange(range);
        await act(() => {
            root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
        });
        expect(host.querySelector("button")?.textContent).toBe("保存并追问");
        await act(() => host.querySelector("button")!.click());
        expect(follow).toHaveBeenCalledTimes(1);
        expect(follow.mock.calls[0][0].text).toBe("可以选择答案");
    });
});
