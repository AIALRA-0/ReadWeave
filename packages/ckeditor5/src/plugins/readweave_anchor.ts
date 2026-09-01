import { Plugin, type ModelRange, type ModelWriter } from "ckeditor5";

const RANGE_ANCHOR_ATTRIBUTE = "readWeaveAnchorId";

/**
 * ReadWeave ranges can be nested. CKEditor model attributes are scalar, so a
 * text run stores the complete set of range IDs as a canonical, space-separated
 * token list (the same shape as the HTML class attribute).
 */
export function parseReadWeaveAnchorIds(value: unknown): string[] {
    if (typeof value !== "string") return [];
    return Array.from(new Set(value.split(/\s+/).map(anchorId => anchorId.trim()).filter(Boolean)));
}

export function serializeReadWeaveAnchorIds(anchorIds: Iterable<string>): string {
    return Array.from(new Set(Array.from(anchorIds).flatMap(anchorId => parseReadWeaveAnchorIds(anchorId)))).join(" ");
}

export function addReadWeaveAnchorId(value: unknown, anchorId: string): string {
    return serializeReadWeaveAnchorIds([ ...parseReadWeaveAnchorIds(value), anchorId ]);
}

export function removeReadWeaveAnchorId(value: unknown, anchorId: string): string {
    const removed = new Set(parseReadWeaveAnchorIds(anchorId));
    return serializeReadWeaveAnchorIds(parseReadWeaveAnchorIds(value).filter(candidate => !removed.has(candidate)));
}

/** Adds or removes one range ID without destroying any overlapping range IDs. */
export function updateReadWeaveAnchorIdOnRange(
    writer: ModelWriter,
    range: ModelRange,
    anchorId: string,
    operation: "add" | "remove"
) {
    const updates = Array.from(range.getItems({ shallow: true })).flatMap(item => {
        if (!item.is("$text") && !item.is("$textProxy")) return [];
        const { parent, startOffset, endOffset } = item;
        if (!parent || startOffset === null || endOffset === null) return [];
        const currentValue = item.getAttribute(RANGE_ANCHOR_ATTRIBUTE);
        const nextValue = operation === "add"
            ? addReadWeaveAnchorId(currentValue, anchorId)
            : removeReadWeaveAnchorId(currentValue, anchorId);
        return [ {
            currentValue: serializeReadWeaveAnchorIds(parseReadWeaveAnchorIds(currentValue)),
            nextValue,
            range: writer.createRange(
                writer.createPositionAt(parent, startOffset),
                writer.createPositionAt(parent, endOffset)
            )
        } ];
    });

    for (const update of updates) {
        if (update.nextValue === update.currentValue) continue;
        if (update.nextValue) writer.setAttribute(RANGE_ANCHOR_ATTRIBUTE, update.nextValue, update.range);
        else writer.removeAttribute(RANGE_ANCHOR_ATTRIBUTE, update.range);
    }
}

/** Persists both legacy paragraph anchors and fine-grained inline anchors. */
export default class ReadWeaveAnchor extends Plugin {
    static get pluginName() {
        return "ReadWeaveAnchor" as const;
    }

    init() {
        const { editor } = this;
        editor.model.schema.extend("$block", { allowAttributes: [ "readWeaveParagraphAnchorId" ] });
        editor.model.schema.extend("$text", { allowAttributes: [ "readWeaveAnchorId" ] });

        editor.conversion.for("upcast").attributeToAttribute({
            view: "data-readweave-anchor-id",
            model: "readWeaveParagraphAnchorId"
        });
        editor.conversion.for("upcast").elementToAttribute({
            view: {
                name: "span",
                attributes: {
                    "data-readweave-range-anchor-id": /.+/
                }
            },
            model: {
                key: "readWeaveAnchorId",
                value: viewElement => serializeReadWeaveAnchorIds([
                    viewElement.getAttribute("data-readweave-range-anchor-id") ?? ""
                ])
            }
        });
        editor.conversion.for("downcast").attributeToAttribute({
            model: "readWeaveParagraphAnchorId",
            view: "data-readweave-anchor-id"
        });
        editor.conversion.for("downcast").attributeToElement({
            model: "readWeaveAnchorId",
            view: (anchorId, { writer }) => writer.createAttributeElement("span", {
                "data-readweave-range-anchor-id": serializeReadWeaveAnchorIds([ String(anchorId ?? "") ])
            }, { priority: 5 })
        });
    }
}
