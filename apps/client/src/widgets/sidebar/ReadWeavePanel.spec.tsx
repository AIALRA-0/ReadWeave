import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadWeavePanel from "./ReadWeavePanel.js";
import { readReadWeaveGenerationPreferences } from "./readweave_generation_preferences.js";

const state = vi.hoisted(() => ({ root: null as HTMLElement | null, noteContext: null as unknown, job: null as unknown, post: vi.fn(), get: vi.fn() }));
vi.mock("@triliumnext/ckeditor5", () => ({ updateReadWeaveAnchorIdOnRange: vi.fn(), parseReadWeaveAnchorIds: (value?: string) => value?.split(/\s+/u).filter(Boolean) ?? [] }));
vi.mock("../../services/server.js", () => ({ default: { get: state.get, post: (url: string, body: unknown) => url === "readweave/candidates" ? Promise.resolve({ candidates: [] }) : state.post(url, body), getWithSilentNotFound: vi.fn(async () => ({ job: state.job, events: [], nextSequence: 0 })) } }));
vi.mock("../../services/i18n.js", () => ({ t: (key: string, values?: {excerpt?:string}) => key === "readweave.default_question_short" ? `“${values?.excerpt}”是什么意思？` : key }));
vi.mock("../../services/utils.js", () => ({ default: { randomString: () => Math.random().toString(36).slice(2) } }));
vi.mock("../react/hooks.js", () => ({
    useActiveNoteContext: () => ({ note: { type: "text", isContentAvailable: () => true }, noteId: "article", noteContext: state.noteContext }),
    useContentElement: () => state.root
}));
vi.mock("./RightPanelWidget.js", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("./ReadWeaveAnswer.js", () => ({ ReadWeaveAnswer: () => null }));
vi.mock("./ReadWeaveFollowUpWindow.js", () => ({ ReadWeaveFollowUpWindow: () => null }));

describe("ReadWeave panel generation actions", () => {
    let host: HTMLDivElement;
    const button = () => host.querySelector<HTMLButtonElement>('[data-testid="readweave-generate"]')!;
    const checkbox = (name: string) => host.querySelector<HTMLInputElement>(`[data-testid="readweave-${name}"]`)!;
    const question = () => host.querySelector<HTMLTextAreaElement>('[data-testid="readweave-question"]')!;
    async function select(text: string) {
        const p = Array.from(state.root!.querySelectorAll("p")).find(item => item.textContent === text)!;
        const range = document.createRange();
        range.selectNodeContents(p);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        await act(() => { p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
        await vi.waitFor(() => expect(question()?.value).toContain(text));
        await vi.waitFor(() => expect(document.querySelector(".readweave-selection-actions")).not.toBeNull());
    }
    async function toggle(name: string) {
        await act(() => {
            const input = checkbox(name);
            input.checked = !input.checked;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }
    beforeEach(async () => {
        vi.clearAllMocks();
        state.job = null;
        sessionStorage.clear();
        localStorage.clear();
        host = document.createElement("div");
        state.root = document.createElement("div");
        state.root.dataset.readweaveContentRoot = "readonly";
        state.root.innerHTML = "<p>First selection</p><p>Second selection</p>";
        document.body.append(state.root, host);
        state.noteContext = { getTextEditor: async () => null, getContentElement: async () => [ state.root ] };
        state.get.mockImplementation(async (url: string) => url.includes("generation-jobs") ? { jobs: [], removedJobIds: [], nextCursor: 0 } : url.endsWith("/anchors") ? { anchors: [] } : { entries: [] });
        state.post.mockRejectedValue(new Error("Provider unavailable"));
        vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
        await act(() => render(<ReadWeavePanel />, host));
        await new Promise(resolve => setTimeout(resolve, 60));
    });
    afterEach(async () => {
        await act(() => render(null, host));
        window.getSelection()?.removeAllRanges();
        host.remove();
        state.root?.remove();
        vi.restoreAllMocks();
    });
    it("confirms a pending selection, sends one request on rapid clicks, and surfaces failure", async () => {
        await select("First selection");
        expect(button().disabled).toBe(false);
        let reject!: (cause: Error) => void;
        state.post.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
        await act(() => { button().click(); button().click(); });
        expect(button().getAttribute("aria-busy")).toBe("true");
        await vi.waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
        expect(state.post.mock.calls[0][1]).toMatchObject({ rootSourceExcerpt: "First selection", quoteSelectedText: true });
        expect(state.post.mock.calls[0][1].fragments).toContainEqual({ id: "current-block", role: "section", text: "<p>First selection</p>", distance: 0 });
        await act(() => reject(new Error("Provider unavailable")));
        await vi.waitFor(() => expect(host.textContent).toContain("Provider unavailable"));
        expect(button().disabled).toBe(false);
        expect(state.post).toHaveBeenCalledTimes(1);
    });
    it("persists checkbox defaults across selections and reload, preserving manually typed quotes", async () => {
        await select("First selection");
        await toggle("optimize-question");
        await toggle("auto-apply-plan");
        await toggle("disable-external-search");
        await toggle("quote-selected-text");
        expect(question().value).toBe("First selection是什么意思？");
        await act(() => {
            question().value = 'Explain “manual literal”';
            question().dispatchEvent(new Event("input", { bubbles: true }));
        });
        await toggle("quote-selected-text");
        expect(question().value).toBe('Explain “manual literal”');
        await toggle("quote-selected-text");
        await select("Second selection");
        expect(checkbox("optimize-question").checked).toBe(false);
        expect(checkbox("auto-apply-plan").checked).toBe(false);
        expect(checkbox("disable-external-search").checked).toBe(true);
        expect(checkbox("quote-selected-text").checked).toBe(false);
        await act(() => render(null, host));
        await act(() => render(<ReadWeavePanel />, host));
        await new Promise(resolve => setTimeout(resolve, 60));
        await select("First selection");
        expect(readReadWeaveGenerationPreferences()).toEqual({ optimizeQuestion: false, autoApplyPlan: false, externalSearchDisabled: true, quoteSelectedText: false });
        expect(checkbox("quote-selected-text").checked).toBe(false);
    });
    it("does not turn a confirmed definition back into a question when the editor restores its range", async () => {
        await select("First selection");
        const paragraph = state.root!.querySelector("p")!;
        await act(() => {
            document.querySelector<HTMLButtonElement>('.readweave-selection-actions button[aria-label="readweave.define_action"]')!.click();
        });
        const selectedType = () => host.querySelector('.readweave-content-type-selector [aria-pressed="true"]')?.textContent;
        await vi.waitFor(() => expect(selectedType()).toBe("定义"));
        const restored = document.createRange();
        restored.selectNodeContents(paragraph);
        await act(() => {
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(restored);
            document.dispatchEvent(new Event("selectionchange"));
        });
        await new Promise(resolve => setTimeout(resolve, 90));
        expect(selectedType()).toBe("定义");
        await select("Second selection");
        expect(selectedType()).toBe("问题");
    });
    it("restores draft preferences without overwriting defaults, and sends those draft values", async () => {
        state.root!.querySelector("p")!.innerHTML = '<span data-readweave-range-anchor-id="saved">First selection</span>';
        sessionStorage.setItem("readweave:draft:article:saved:root:latest", JSON.stringify({
            kind: "question", contentType: "problem", questionTitle: 'Draft with “literal”',
            optimizeQuestion: false, autoApplyPlan: true, quoteSelectedText: false,
            externalSearchDisabled: true, termIdentity: {}, body: "", calloutType: "note"
        }));
        await select("First selection");
        await act(() => button().click());
        await vi.waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
        expect(state.post.mock.calls[0][1]).toMatchObject({ title: 'Draft with “literal”', optimizeQuestion: false, quoteSelectedText: false, autoExternalSearch: false });
        expect(checkbox("quote-selected-text").checked).toBe(false);
        expect(readReadWeaveGenerationPreferences()).toMatchObject({ optimizeQuestion: true, quoteSelectedText: true, externalSearchDisabled: false });
    });
    it("creates an editable plan on the first click and only one job on the second", async () => {
        await select("First selection");
        await toggle("auto-apply-plan");
        await act(() => button().click());
        await vi.waitFor(() => expect(host.querySelector('[data-testid="readweave-answer-plan-editor"]')).not.toBeNull());
        expect(state.post).not.toHaveBeenCalled();
        expect(button().disabled).toBe(false);
        await act(() => { button().click(); button().click(); });
        await vi.waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
        expect(state.post.mock.calls[0][1]).toMatchObject({ autoApplyPlan: false, answerPlan: { normalizedQuestion: "“First selection”是什么意思？", reviewStatus: "approved", autoApplied: false } });
    });
    it("keeps a successful request attached to the confirmed selection", async () => {
        state.post.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({ job: state.job = {
            ...body, jobId: "accepted-job", draftId: "accepted-draft", status: "running", progress: [],
            stateVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            sourceExcerpt: body.rootSourceExcerpt
        } }));
        await select("First selection");
        await act(() => button().click());
        await vi.waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.getItem(sessionStorage.key(i)!)).some(value => value?.includes('"generationJobId":"accepted-job"'))).toBe(true));
        expect(button().disabled).toBe(true);
    });
    it("shows an expired selection confirmation instead of silently abandoning Generate", async () => {
        await select("First selection");
        // Crossing an existing anchor leaves a visible preview but no valid action.
        state.root!.querySelector("p")!.innerHTML = '<span data-readweave-range-anchor-id="existing">First</span> selection';
        await select("Second selection");
        const p = state.root!.querySelector("p")!;
        const range = document.createRange();
        range.setStart(p.querySelector("span")!.firstChild!, 2);
        range.setEnd(p.lastChild!, 4);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        await act(() => { p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
        await vi.waitFor(() => expect(question()?.value).toContain("rst sel"));
        await act(() => button().click());
        await vi.waitFor(() => expect(host.textContent).toContain("选区确认失败"));
        expect(state.post).not.toHaveBeenCalled();
    });
});
