import { Plugin } from "ckeditor5";

/**
 * Persists ReadWeave paragraph anchors in note HTML. The attribute lives on a
 * CKEditor block, so normal editing, undo, copy and Trilium synchronization all
 * keep the anchor together with its paragraph.
 */
export default class ReadWeaveAnchor extends Plugin {
    static get pluginName() {
        return "ReadWeaveAnchor" as const;
    }

    init() {
        const { editor } = this;
        editor.model.schema.extend("$block", { allowAttributes: [ "readWeaveAnchorId" ] });

        editor.conversion.for("upcast").attributeToAttribute({
            view: "data-readweave-anchor-id",
            model: "readWeaveAnchorId"
        });
        editor.conversion.for("downcast").attributeToAttribute({
            model: "readWeaveAnchorId",
            view: "data-readweave-anchor-id"
        });
    }
}
