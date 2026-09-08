import type { ReadWeaveResolvedEntry } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadWeaveFollowUpWindow } from "./ReadWeaveFollowUpWindow.js";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("../../services/server.js", () => ({ default: api }));

describe("independent follow-up lifecycle", () => {
    const host = document.createElement("div");
    const parent = { linkId: "parent", articleId: "article", anchorId: "anchor", anchorType: "range", revision: 1, depth: 0 } as ReadWeaveResolvedEntry;
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
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
});
