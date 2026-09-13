import type { ReadWeaveAnchorSummary, ReadWeaveResolvedEntry } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildReadWeaveChapterMap } from "./readweave_chapter_map.js";

function entry(linkId: string, title: string, parentLinkId?: string): ReadWeaveResolvedEntry {
    return { linkId, title, parentLinkId, kind: "question", contentType: "problem", depth: parentLinkId ? 1 : 0 } as ReadWeaveResolvedEntry;
}

describe("read-only chapter map", () => {
    it("keeps duplicate chapter titles separate and nests answer follow-ups", () => {
        const article = document.createElement("article");
        article.innerHTML = '<h2>方法</h2><p>甲</p><h2>方法</h2><p>乙</p>';
        const summaries = [
            { anchorId: "a", sourceLocator: { version: 1, blockIndex: 1 }, entries: [entry("one", "甲是什么"), entry("child", "追问甲", "one")] },
            { anchorId: "b", sourceLocator: { version: 1, blockIndex: 3 }, entries: [entry("two", "乙是什么")] }
        ] as ReadWeaveAnchorSummary[];
        const map = buildReadWeaveChapterMap(article, "测试文章", summaries);
        expect(map.children.map(node => node.topic)).toEqual(["方法", "方法"]);
        expect(map.children[0].children[0].id).toBe("entry:one");
        expect(map.children[0].children[0].children[0].id).toBe("entry:child");
        expect(map.children[1].children[0].id).toBe("entry:two");
    });

    it("shows missing anchors as unlocated instead of guessing a chapter", () => {
        const article = document.createElement("article");
        article.innerHTML = "<h2>章节</h2><p>正文</p>";
        const map = buildReadWeaveChapterMap(article, "文章", [
            { anchorId: "missing", entries: [entry("orphan", "孤立笔记")] }
        ] as ReadWeaveAnchorSummary[]);
        expect(map.children.at(-1)?.topic).toBe("待重新绑定的内容");
    });
});
