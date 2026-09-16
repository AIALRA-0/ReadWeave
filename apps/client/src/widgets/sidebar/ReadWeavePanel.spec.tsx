import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadWeavePanel, { answerMarkers } from "./ReadWeavePanel.js";
import type { ReadWeaveGenerationJob, ReadWeaveResolvedEntry } from "@triliumnext/commons";
import { readReadWeaveGenerationPreferences } from "./readweave_generation_preferences.js";

const state = vi.hoisted(() => ({ root: null as HTMLElement | null, noteContext: null as unknown, job: null as unknown, post: vi.fn(), get: vi.fn(), events: vi.fn() }));
vi.mock("@triliumnext/ckeditor5", () => ({ updateReadWeaveAnchorIdOnRange: vi.fn(), parseReadWeaveAnchorIds: (value?: string) => value?.split(/\s+/u).filter(Boolean) ?? [] }));
vi.mock("../../services/server.js", () => ({ default: { get: state.get, post: (url: string, body: unknown) => url === "readweave/candidates" ? Promise.resolve({ candidates: [] }) : state.post(url, body), getWithSilentNotFound: state.events } }));
vi.mock("../../services/i18n.js", () => ({ t: (key: string, values?: {excerpt?:string}) => key === "readweave.default_question_short" ? `“${values?.excerpt}”是什么意思？` : key }));
vi.mock("../../services/utils.js", () => ({ default: { randomString: () => Math.random().toString(36).slice(2) } }));
vi.mock("../react/hooks.js", () => ({
    useActiveNoteContext: () => ({ note: { type: "text", isContentAvailable: () => true }, noteId: "article", noteContext: state.noteContext }),
    useContentElement: () => state.root
}));
vi.mock("./RightPanelWidget.js", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("./ReadWeaveAnswer.js", () => ({ ReadWeaveAnswer: () => null }));
vi.mock("../../services/math.js", () => ({ renderMathInElement: vi.fn() }));
vi.mock("./ReadWeaveFollowUpWindow.js", () => ({ ReadWeaveFollowUpWindow: () => null }));

describe("ReadWeave panel generation actions", () => {
    it("keeps follow-up markers bound to the exact parent revision and avoids saved duplicates", () => {
        const selected = { parentRevision:2,startOffset:4,endOffset:9,text:"回答内容" };
        const saved = { linkId:"child",parentLinkId:"parent",revision:1,title:"已保存追问",answerSelection:selected } as ReadWeaveResolvedEntry;
        const pending = { jobId:"pending",parentLinkId:"parent",answerSelection:selected,status:"ready-for-review",title:"待保存追问" } as ReadWeaveGenerationJob;
        const savedJob = { ...pending,jobId:"saved-job",savedLinkId:"child",status:"saved" } as ReadWeaveGenerationJob;
        expect(answerMarkers("parent",2,[saved],[pending,savedJob]).map(marker => marker.status)).toEqual(["saved","ready"]);
        expect(answerMarkers("parent",2,[{ ...saved,answerSelection:undefined }],[savedJob]).map(marker => marker.id))
            .toEqual(["job:saved-job"]);
        expect(answerMarkers("parent",3,[saved],[pending,savedJob])).toHaveLength(0);
    });
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
        state.events.mockReset().mockImplementation(async () => ({ job: state.job, events: [], nextSequence: 0 }));
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
        vi.useRealTimers();
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
        expect(state.post.mock.calls[0][1]).toMatchObject({ rootSourceExcerpt: "First selection", quoteSelectedText: true, autoSave: false });
        expect(state.post.mock.calls[0][1].fragments).toContainEqual({ id: "current-block", role: "section", text: "<p>First selection</p>", distance: 0 });
        await act(() => reject(new Error("Provider unavailable")));
        await vi.waitFor(() => expect(host.textContent).toContain("Provider unavailable"));
        expect(button().disabled).toBe(false);
        expect(state.post).toHaveBeenCalledTimes(1);
    });
    it("captures the auto-save choice in the generated job request", async () => {
        await select("First selection");
        await toggle("auto-save");
        await act(() => { button().click(); });
        await vi.waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
        expect(state.post.mock.calls[0][1]).toMatchObject({ autoSave: true });
    });
    it("persists checkbox defaults across selections and reload, preserving manually typed quotes", async () => {
        await select("First selection");
        await toggle("optimize-question");
        await toggle("auto-apply-plan");
        await toggle("disable-external-search");
        expect(checkbox("auto-save").checked).toBe(false);
        await toggle("auto-save");
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
        expect(checkbox("auto-save").checked).toBe(true);
        expect(checkbox("quote-selected-text").checked).toBe(false);
        await act(() => render(null, host));
        await act(() => render(<ReadWeavePanel />, host));
        await new Promise(resolve => setTimeout(resolve, 60));
        await select("First selection");
        expect(readReadWeaveGenerationPreferences()).toEqual({ optimizeQuestion: false, autoApplyPlan: false, externalSearchDisabled: true, quoteSelectedText: false, autoSave: true });
        expect(checkbox("quote-selected-text").checked).toBe(false);
    });
    it("shows a selected formula as the question, then restores its exact TeX for editing", async () => {
        state.root!.innerHTML = "<p>公式 $x_i$</p>";
        await select("公式 $x_i$");
        const raw = question().value;
        expect(raw).toContain("$x_i$");
        expect(question().hidden).toBe(true);
        const rendered = host.querySelector<HTMLElement>('[data-testid="readweave-question-rendered"]')!;
        expect(rendered.textContent).toContain("$x_i$");
        await act(() => rendered.querySelector<HTMLButtonElement>("button")!.click());
        expect(question().hidden).toBe(false);
        expect(rendered.isConnected).toBe(true);
        expect(rendered.hidden).toBe(true);
        expect(question().value).toBe(raw);
        await vi.waitFor(() => expect(document.activeElement).toBe(question()));
        await act(() => question().blur());
        expect(question().hidden).toBe(true);
        expect(host.querySelector('[data-testid="readweave-question-rendered"]')).toBe(rendered);
        expect(rendered.hidden).toBe(false);
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
    it("offers five floating actions and keeps the selected content type", async () => {
        await select("First selection");
        const actions = Array.from(document.querySelectorAll<HTMLButtonElement>(".readweave-selection-actions button"));
        expect(actions).toHaveLength(5);
        expect(actions.map(button => button.textContent)).toEqual(["提问", "定义", "注解", "总结", "笔记"]);
        await act(() => actions[3].click());
        await vi.waitFor(() => expect(host.querySelector('.readweave-content-type-selector [aria-pressed="true"]')?.textContent).toBe("总结"));
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
    it("researches an editable plan in one job, then approves that same job for writing", async () => {
        state.post.mockImplementation(async (url: string, body: Record<string, unknown>) => ({job:state.job = {
            ...body,jobId:"planned-job",draftId:"planned-job",status:url.endsWith("/regenerate") ? "running" : "awaiting-plan",
            stateVersion:1,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",progress:[],
            sourceExcerpt:body.rootSourceExcerpt, result:{body:"",awaitingPlan:true,answerPlan:{version:1,reviewStatus:"draft",answerType:"general",
                normalizedQuestion:"“First selection”是什么意思？",objective:"解释本次选区",steps:["选区说明计算过程"],answerRequirements:["选区含义"],autoApplied:false}}
        }}));
        await select("First selection");
        await toggle("auto-apply-plan");
        await act(() => button().click());
        await vi.waitFor(() => expect(host.querySelector('[data-testid="readweave-answer-plan-editor"]')).not.toBeNull());
        expect(state.post).toHaveBeenCalledTimes(1);
        expect(state.post.mock.calls[0][1]).toMatchObject({autoApplyPlan:false,answerPlan:undefined});
        expect(button().disabled).toBe(false);
        await act(() => { button().click(); button().click(); });
        await vi.waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
        expect(state.post.mock.calls[1][0]).toBe("readweave/generation-jobs/planned-job/regenerate");
        expect(state.post.mock.calls[1][1]).toMatchObject({ autoApplyPlan: false, answerPlan: { normalizedQuestion: "“First selection”是什么意思？", reviewStatus: "approved", autoApplied: false } });
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
    function acceptGenerationJobs() {
        state.post.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({ job: state.job = {
            ...body, jobId: `accepted-${state.post.mock.calls.length}`, draftId: `draft-${state.post.mock.calls.length}`,
            status: "running", progress: [], stateVersion: 1,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
            sourceExcerpt: body.rootSourceExcerpt
        } }));
    }

    it.each(["404", "null"])("clears a missing job (%s) without losing the question or draft", async missing => {
        acceptGenerationJobs();
        let resolvePoll!: (value: unknown) => void;
        let rejectPoll!: (error: unknown) => void;
        state.events.mockImplementation(() => new Promise((resolve, reject) => { resolvePoll = resolve; rejectPoll = reject; }));
        await select("First selection");
        const originalQuestion = "Explain First selection, keeping my exact question.";
        const originalBody = "My unfinished answer must survive a missing job.";
        await act(() => {
            question().value = originalQuestion;
            question().dispatchEvent(new Event("input", { bubbles: true }));
            const body = host.querySelector<HTMLTextAreaElement>('[data-testid="readweave-answer"]')!;
            body.value = originalBody;
            body.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(() => button().click());
        await vi.waitFor(() => expect(state.events).toHaveBeenCalledTimes(1));
        expect(state.events).toHaveBeenCalledWith(expect.stringContaining("accepted-1/events"), undefined, { preserveErrorStatus: true });
        expect(button().disabled).toBe(true);
        expect(host.querySelector('[data-testid="readweave-generation-monitor"]')).not.toBeNull();
        await act(() => {
            if (missing === "404") rejectPoll(Object.assign(new Error("Job missing"), { status: 404 }));
            else resolvePoll({ job: null, events: [], nextSequence: 0 });
        });
        await vi.waitFor(() => expect(button().disabled).toBe(false));
        expect(button().getAttribute("aria-busy")).toBe("false");
        expect(host.querySelector('[data-testid="readweave-generation-monitor"]')).toBeNull();
        expect(question().value).toBe(originalQuestion);
        const savedDraft = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)!)
            .filter(key => key.endsWith(":latest"))
            .map(key => JSON.parse(sessionStorage.getItem(key)!))
            .find(draft => draft.questionTitle === originalQuestion);
        expect(savedDraft).toMatchObject({ body: originalBody, newQuestionDraft: true });
        expect(savedDraft.generationJobId).toBeUndefined();
        expect(checkbox("quote-selected-text").checked).toBe(true);
        expect(state.post).toHaveBeenCalledTimes(1);
    });

    it.each(["404", "null"])("ignores an old poll's %s after a different selection starts a new job", async missing => {
        acceptGenerationJobs();
        let resolveOld!: (value: unknown) => void;
        let rejectOld!: (error: unknown) => void;
        state.events.mockImplementation((url: string) => url.includes("accepted-1/")
            ? new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; })
            : new Promise(() => {}));
        await select("First selection");
        await act(() => button().click());
        await vi.waitFor(() => expect(state.events).toHaveBeenCalledTimes(1));
        await select("Second selection");
        await act(() => button().click());
        await vi.waitFor(() => expect(state.events).toHaveBeenCalledTimes(2));
        const newQuestion = question().value;
        await act(() => {
            if (missing === "404") rejectOld(Object.assign(new Error("Old job missing"), { status: 404 }));
            else resolveOld({ job: null, events: [], nextSequence: 0 });
        });
        expect(button().disabled).toBe(true);
        expect(button().getAttribute("aria-busy")).toBe("true");
        expect(question().value).toBe(newQuestion);
        expect(host.querySelector('[data-testid="readweave-generation-monitor"]')).not.toBeNull();
        expect(state.post).toHaveBeenCalledTimes(2);
        expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.getItem(sessionStorage.key(index)!))
            .some(value => value?.includes('"generationJobId":"accepted-2"'))).toBe(true);
    });

    it("does not treat a transient poll failure as a deleted job", async () => {
        acceptGenerationJobs();
        let rejectPoll!: (error: unknown) => void;
        state.events.mockImplementation(() => new Promise((_resolve, reject) => { rejectPoll = reject; }));
        await select("First selection");
        await act(() => button().click());
        await vi.waitFor(() => expect(state.events).toHaveBeenCalledTimes(1));
        await act(() => rejectPoll(Object.assign(new Error("Temporary server failure"), { status: 500 })));
        expect(host.querySelector('[data-testid="readweave-generation-monitor"]')).not.toBeNull();
        expect(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.getItem(sessionStorage.key(index)!))
            .some(value => value?.includes('"generationJobId":"accepted-1"'))).toBe(true);
    });

    it("does not let an in-flight history snapshot resurrect a missing job", async () => {
        vi.useFakeTimers();
        acceptGenerationJobs();
        let rejectPoll!: (error: unknown) => void;
        state.events.mockImplementation(() => new Promise((_resolve, reject) => { rejectPoll = reject; }));
        await select("First selection");
        await act(() => button().click());
        await vi.waitFor(() => expect(state.events).toHaveBeenCalledTimes(1));
        const removedJob = state.job;
        let resolveHistory!: (value: unknown) => void;
        const history = new Promise(resolve => { resolveHistory = resolve; });
        let historyRequested = false;
        state.get.mockImplementation((url: string) => {
            if (url.startsWith("readweave/generation-jobs?")) {
                historyRequested = true;
                return history;
            }
            return Promise.resolve(url.endsWith("/anchors") ? { anchors: [] } : { entries: [] });
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
        expect(historyRequested).toBe(true);
        await act(async () => { rejectPoll(Object.assign(new Error("Job missing"), { status: 404 })); });
        await vi.waitFor(() => expect(button().disabled).toBe(false));
        await act(async () => { resolveHistory({ jobs: [removedJob], removedJobIds: [], nextCursor: 1 }); });
        expect(button().disabled).toBe(false);
        expect(host.querySelector('[data-testid="readweave-generation-monitor"]')).toBeNull();
        expect(state.events).toHaveBeenCalledTimes(1);
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
