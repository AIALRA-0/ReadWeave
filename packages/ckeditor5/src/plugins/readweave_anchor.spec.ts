import { _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ReadWeaveAnchor, {
    addReadWeaveAnchorId,
    parseReadWeaveAnchorIds,
    removeReadWeaveAnchorId,
    serializeReadWeaveAnchorIds,
    updateReadWeaveAnchorIdOnRange
} from "./readweave_anchor.js";

describe("ReadWeaveAnchor", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, ReadWeaveAnchor ]);
    });

    it("registers the plugin and its model attributes", () => {
        expect(ReadWeaveAnchor.pluginName).toBe("ReadWeaveAnchor");
        expect(editor.plugins.get(ReadWeaveAnchor)).toBeInstanceOf(ReadWeaveAnchor);
        expect(editor.model.schema.checkAttribute([ "$root", "paragraph" ], "readWeaveParagraphAnchorId")).toBe(true);
        expect(editor.model.schema.checkAttribute([ "$root", "paragraph", "$text" ], "readWeaveAnchorId")).toBe(true);
    });

    it("upcasts paragraph and exact-range anchors from saved HTML", () => {
        editor.setData('<p data-readweave-anchor-id="paragraph-1">before <span data-readweave-range-anchor-id="range-1">target</span> after</p>');

        const root = editor.model.document.getRoot();
        const paragraph = root?.getChild(0);
        expect(paragraph?.getAttribute("readWeaveParagraphAnchorId")).toBe("paragraph-1");
        expect(Array.from(paragraph!.getChildren()).find(child => child.data === "target")?.getAttribute("readWeaveAnchorId")).toBe("range-1");
    });

    it("downcasts paragraph and exact-range anchors without expanding the selected text", () => {
        setModelData(
            editor.model,
            '<paragraph readWeaveParagraphAnchorId="paragraph-2">before <$text readWeaveAnchorId="range-2">target</$text> after</paragraph>'
        );

        expect(editor.getData()).toBe('<p data-readweave-anchor-id="paragraph-2">before <span data-readweave-range-anchor-id="range-2">target</span> after</p>');
    });

    it("normalizes an overlapping range ID set without duplicates", () => {
        expect(parseReadWeaveAnchorIds(undefined)).toEqual([]);
        expect(parseReadWeaveAnchorIds(" outer   inner outer ")).toEqual([ "outer", "inner" ]);
        expect(serializeReadWeaveAnchorIds([ "outer inner", "inner", "leaf" ])).toBe("outer inner leaf");
        expect(addReadWeaveAnchorId("outer", "inner")).toBe("outer inner");
        expect(addReadWeaveAnchorId("outer inner", "inner")).toBe("outer inner");
        expect(removeReadWeaveAnchorId("outer inner", "inner")).toBe("outer");
    });

    it("ignores non-text and invalid range items and skips unchanged anchors", () => {
        const parent = {};
        const writer = {
            createPositionAt: vi.fn((itemParent: object, offset: number) => ({ parent: itemParent, offset })),
            createRange: vi.fn((start: object, end: object) => ({ start, end })),
            removeAttribute: vi.fn(),
            setAttribute: vi.fn()
        };
        const range = {
            getItems: () => [
                { is: () => false },
                { is: (type: string) => type === "$text", parent: null, startOffset: 0, endOffset: 1 },
                { is: (type: string) => type === "$text", parent, startOffset: null, endOffset: 1 },
                { is: (type: string) => type === "$text", parent, startOffset: 0, endOffset: null },
                {
                    is: (type: string) => type === "$text",
                    parent,
                    startOffset: 0,
                    endOffset: 1,
                    getAttribute: () => "outer"
                }
            ]
        };

        updateReadWeaveAnchorIdOnRange(writer as never, range as never, "outer", "add");

        expect(writer.createPositionAt).toHaveBeenCalledTimes(2);
        expect(writer.createRange).toHaveBeenCalledTimes(1);
        expect(writer.setAttribute).not.toHaveBeenCalled();
        expect(writer.removeAttribute).not.toHaveBeenCalled();
    });

    it("normalizes a missing range ID from the upcast converter", () => {
        type UpcastRangeConverter = {
            model: {
                value: (viewElement: { getAttribute: (name: string) => string | undefined }) => string;
            };
        };

        let upcastRangeConverter: UpcastRangeConverter | undefined;
        const upcast = {
            attributeToAttribute: vi.fn(),
            elementToAttribute: vi.fn((converter: UpcastRangeConverter) => {
                upcastRangeConverter = converter;
            })
        };
        const downcast = {
            attributeToAttribute: vi.fn(),
            attributeToElement: vi.fn()
        };
        const plugin = {
            editor: {
                conversion: {
                    for: vi.fn((pipeline: string) => pipeline === "upcast" ? upcast : downcast)
                },
                model: {
                    schema: {
                        extend: vi.fn()
                    }
                }
            }
        };

        ReadWeaveAnchor.prototype.init.call(plugin as unknown as ReadWeaveAnchor);

        expect(upcastRangeConverter).toBeDefined();
        expect(upcastRangeConverter!.model.value({ getAttribute: () => undefined })).toBe("");
    });

    it("round-trips nested range anchors through saved HTML", () => {
        editor.setData('<p><span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="outer inner">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span></p>');

        const paragraph = editor.model.document.getRoot()?.getChild(0);
        expect(Array.from(paragraph!.getChildren()).map(child => [ child.data, child.getAttribute("readWeaveAnchorId") ])).toEqual([
            [ "BS-", "outer" ],
            [ "PDN", "outer inner" ],
            [ "-Last", "outer" ]
        ]);
        expect(editor.getData()).toBe('<p><span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="outer inner">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span></p>');
    });

    it("adds and removes a nested anchor without overwriting its parent", () => {
        setModelData(editor.model, '<paragraph><$text readWeaveAnchorId="outer">BS-PDN-Last</$text></paragraph>');
        const paragraph = editor.model.document.getRoot()!.getChild(0)!;

        editor.model.change(writer => {
            const nestedRange = writer.createRange(writer.createPositionAt(paragraph, 3), writer.createPositionAt(paragraph, 6));
            updateReadWeaveAnchorIdOnRange(writer, nestedRange, "inner", "add");
        });
        expect(editor.getData()).toBe('<p><span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="outer inner">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span></p>');

        editor.model.change(writer => {
            const nestedRange = writer.createRange(writer.createPositionAt(paragraph, 3), writer.createPositionAt(paragraph, 6));
            updateReadWeaveAnchorIdOnRange(writer, nestedRange, "inner", "remove");
        });
        expect(editor.getData()).toBe('<p><span data-readweave-range-anchor-id="outer">BS-PDN-Last</span></p>');
    });

    it("adds an outer range across mixed child attributes and preserves the child", () => {
        setModelData(editor.model, '<paragraph>BS-<$text readWeaveAnchorId="inner">PDN</$text>-Last</paragraph>');
        const paragraph = editor.model.document.getRoot()!.getChild(0)!;

        editor.model.change(writer => {
            const outerRange = writer.createRange(writer.createPositionAt(paragraph, 0), writer.createPositionAt(paragraph, "end"));
            updateReadWeaveAnchorIdOnRange(writer, outerRange, "outer", "add");
        });
        expect(editor.getData()).toBe('<p><span data-readweave-range-anchor-id="outer">BS-</span><span data-readweave-range-anchor-id="inner outer">PDN</span><span data-readweave-range-anchor-id="outer">-Last</span></p>');

        editor.model.change(writer => {
            const outerRange = writer.createRange(writer.createPositionAt(paragraph, 0), writer.createPositionAt(paragraph, "end"));
            updateReadWeaveAnchorIdOnRange(writer, outerRange, "outer", "remove");
        });
        expect(editor.getData()).toBe('<p>BS-<span data-readweave-range-anchor-id="inner">PDN</span>-Last</p>');
    });
});
