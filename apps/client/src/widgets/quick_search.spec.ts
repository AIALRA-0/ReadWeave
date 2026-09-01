import $ from "jquery";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    hide: vi.fn(),
    show: vi.fn(),
    update: vi.fn(),
    serverGet: vi.fn()
}));

vi.mock("bootstrap", () => ({
    Dropdown: {
        getOrCreateInstance: () => ({ hide: mocks.hide, show: mocks.show, update: mocks.update })
    },
    Tooltip: class {
        show() {}
        dispose() {}
    }
}));
vi.mock("../components/app_context.js", () => ({ default: { triggerCommand: vi.fn() } }));
vi.mock("../services/froca.js", () => ({ default: { getNote: vi.fn() } }));
vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../services/link.js", () => ({ default: { getHref: vi.fn() } }));
vi.mock("../services/server.js", () => ({ default: { get: mocks.serverGet } }));
vi.mock("../services/shortcuts.js", () => ({
    default: { bindElShortcut: vi.fn() },
    isIMEComposing: () => false
}));
vi.mock("../services/utils.js", () => ({
    default: {
        isMobile: () => false,
        escapeHtml: (value: string) => value,
        randomString: () => "test"
    },
    handleRightToLeftPlacement: (value: string) => value
}));

import QuickSearchWidget from "./quick_search.js";

function renderWidget() {
    const widget = new QuickSearchWidget();
    const $widget = widget.doRender();
    $(document.body).append($widget);
    return { widget, $widget };
}

describe("QuickSearchWidget result cleanup", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        mocks.hide.mockReset();
        mocks.show.mockReset();
        mocks.update.mockReset();
        mocks.serverGet.mockReset();
    });

    it("removes the result layer as soon as the query is cleared", () => {
        const { $widget } = renderWidget();
        const $input = $widget.find(".search-string");
        const $menu = $widget.find(".dropdown-menu");
        $input.val("旧查询");
        $menu.append('<a class="dropdown-item">旧结果</a>');

        $input.val("").trigger("input");

        expect($menu.children()).toHaveLength(0);
        expect(mocks.hide).toHaveBeenCalledTimes(1);
    });

    it("ignores a stale response that arrives after the query is cleared", async () => {
        let resolveSearch: ((value: unknown) => void) | undefined;
        mocks.serverGet.mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve; }));
        const { widget, $widget } = renderWidget();
        const $input = $widget.find(".search-string");
        const $menu = $widget.find(".dropdown-menu");
        $input.val("旧查询");

        const pendingSearch = widget.search();
        $input.val("").trigger("input");
        resolveSearch?.({ searchResultNoteIds: [ "old-note" ], searchResults: [], error: "" });
        await pendingSearch;

        expect($menu.children()).toHaveLength(0);
        expect(mocks.hide).toHaveBeenCalledTimes(1);
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
