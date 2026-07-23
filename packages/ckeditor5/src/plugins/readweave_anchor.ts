import { Plugin } from "ckeditor5";

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
                value: viewElement => viewElement.getAttribute("data-readweave-range-anchor-id")
            }
        });
        editor.conversion.for("downcast").attributeToAttribute({
            model: "readWeaveParagraphAnchorId",
            view: "data-readweave-anchor-id"
        });
        editor.conversion.for("downcast").attributeToElement({
            model: "readWeaveAnchorId",
            view: (anchorId, { writer }) => writer.createAttributeElement("span", {
                "data-readweave-range-anchor-id": anchorId
            }, { priority: 5 })
        });
    }
}
