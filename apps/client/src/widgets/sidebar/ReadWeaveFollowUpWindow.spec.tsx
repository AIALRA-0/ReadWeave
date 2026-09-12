import type { ReadWeaveResolvedEntry } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWeaveAnswerSelection } from "./ReadWeaveAnswer.js";
import { ReadWeaveFollowUpWindow } from "./ReadWeaveFollowUpWindow.js";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("../../services/server.js", () => ({ default: api }));

describe("independent follow-up lifecycle", () => {
    const host = document.createElement("div");
    const parent = { linkId: "parent", articleId: "article", anchorId: "anchor", anchorType: "range", revision: 1, depth: 0 } as ReadWeaveResolvedEntry;
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        document.body.append(host);
        api.post.mockResolvedValue({ job: { jobId: "child", title: "问题", status: "running" } });
        api.patch.mockResolvedValue({ job: { jobId: "child", title: "问题", status: "cancelled" } });
    });
    afterEach(async () => {
        await act(() => render(null, host));
        host.remove();
    });
    it("uses the actual PATCH cancel route and inherits search-off", async () => {
        await act(() => render(<ReadWeaveFollowUpWindow parent={parent}
            selection={{ parentRevision: 1, startOffset: 0, endOffset: 2, text: "选区" }}
            externalSearchDisabled onClose={() => {}} onOpen={() => {}} onJob={() => {}} />, host));
        const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(".readweave-follow-up-window button"))
            .find(element => element.textContent === text)!;
        await act(async () => { button("生成回答").click(); });
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post.mock.calls[0][1]).toMatchObject({ autoExternalSearch: false, activeExternalSearch: false });
        await vi.waitFor(() => expect(button("中断生成").disabled).toBe(false));
        await act(async () => { button("中断生成").click(); });
        await vi.waitFor(() => expect(api.patch).toHaveBeenCalledWith("readweave/generation-jobs/child/cancel", {}));
        await vi.waitFor(() => expect(button("中断生成")).toBeUndefined());
        expect(api.post).toHaveBeenCalledTimes(1);
    });
    it("reviews a complete editable plan before generating when the remembered automatic preference is off", async () => {
        await act(() => render(<ReadWeaveFollowUpWindow parent={parent}
            selection={{parentRevision:1,startOffset:0,endOffset:2,text:"选区"}}
            generationPreferences={{autoApplyPlan:false,optimizeQuestion:false,quoteSelectedText:false,externalSearchDisabled:true}}
            onClose={() => {}} onOpen={() => {}} onJob={() => {}} />, host));
        const button = (text:string) => Array.from(document.querySelectorAll<HTMLButtonElement>(".readweave-follow-up-window button"))
            .find(item=>item.textContent===text)!;
        await act(() => { button("生成流程计划").click(); });
        expect(api.post).not.toHaveBeenCalled();
        const steps = document.querySelector<HTMLTextAreaElement>('[data-testid="readweave-follow-up-plan"] label:nth-of-type(4) textarea')!;
        await act(() => { steps.value=""; steps.dispatchEvent(new Event("input",{bubbles:true})); });
        await act(() => { button("生成回答").click(); });
        expect(api.post).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("有效步骤");
        const lines=Array.from({length:20},(_,i)=>`解释第 ${i+1} 项要求`);
        await act(() => { steps.value=lines.join("\n"); steps.dispatchEvent(new Event("input",{bubbles:true})); });
        await act(async () => { button("生成回答").click(); });
        expect(api.post.mock.calls[0][1]).toMatchObject({autoApplyPlan:false,quoteSelectedText:false,
            answerPlan:{reviewStatus:"approved",steps:lines}});
    });
    it("saves an unsaved parent exactly once before opening the next independent level", async () => {
        const onOpen = vi.fn();
        api.post.mockImplementation(async (url: string) => url.endsWith("/commit")
            ? { job: { jobId: "child", title: "问题", status: "saved", stateVersion: 3,
                savedLinkId: "saved-child", result: { body: "回答包含可选文字" } } }
            : { job: { jobId: "child", title: "问题", status: "ready-for-review", stateVersion: 2,
                result: { body: "回答包含可选文字" } } });
        api.get.mockResolvedValue({ entries: [ { linkId: "saved-child", articleId: "article",
            anchorId: "anchor", anchorType: "range", revision: 4, depth: 1,
            body: "回答包含可选文字" } ] });
        await act(() => render(<ReadWeaveFollowUpWindow parent={parent}
            selection={{ parentRevision: 1, startOffset: 0, endOffset: 2, text: "选区" }}
            onClose={() => {}} onOpen={onOpen} onJob={() => {}} />, host));
        const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>(
            ".readweave-follow-up-window button"));
        await act(async () => { buttons().find(button => button.textContent === "生成回答")!.click(); });
        const answer = () => document.querySelector<HTMLElement>(
            ".readweave-follow-up-content > .readweave-answer-container > .readweave-readable-body");
        await vi.waitFor(() => expect(answer()?.textContent).toContain("回答包含"));
        const walker = document.createTreeWalker(answer()!, NodeFilter.SHOW_TEXT);
        let text: Node | null = null;
        while ((text = walker.nextNode()) && !text.textContent?.includes("回答包含")) { /* find answer text */ }
        expect(text?.textContent).toMatch(/^回答包含可选文字/u);
        const range = document.createRange();
        range.setStart(text!, 0);
        range.setEnd(text!, 4);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        expect(readWeaveAnswerSelection(answer()!, "回答包含可选文字", range, 0))
            .toMatchObject({ startOffset: 0, endOffset: 4, text: "回答包含" });
        await act(() => {
            answer()!.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
        });
        await vi.waitFor(() => expect(buttons().find(button => button.textContent === "保存并追问"))
            .toBeDefined());
        await act(async () => { buttons().find(button => button.textContent === "保存并追问")!.click(); });
        await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
        expect(api.post.mock.calls.filter(([ url ]) => String(url).endsWith("/commit"))).toHaveLength(1);
        expect(onOpen.mock.calls[0][0]).toMatchObject({ linkId: "saved-child", revision: 4, depth: 1 });
        expect(onOpen.mock.calls[0][1]).toMatchObject({ parentRevision: 4, startOffset: 0, endOffset: 4 });
    });
    it("prevents a fourth-level request in the client", async () => {
        await act(() => render(<ReadWeaveFollowUpWindow parent={{ ...parent, depth: 3 }}
            selection={{ parentRevision: 1, startOffset: 0, endOffset: 2, text: "选区" }}
            onClose={() => {}} onOpen={() => {}} onJob={() => {}} />, host));
        const generate = Array.from(document.querySelectorAll<HTMLButtonElement>(
            ".readweave-follow-up-window button")).find(button => button.textContent === "生成回答")!;
        expect(generate.disabled).toBe(true);
        await act(() => generate.click());
        expect(api.post).not.toHaveBeenCalled();
    });
});
