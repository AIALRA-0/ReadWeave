import { Plugin, RemoveFormat } from "ckeditor5";

/**
 * A simple plugin that extends the remove format feature to consider links.
 */
export default class RemoveFormatLinksPlugin extends Plugin {

    static get requires() {
        return [ RemoveFormat ]
    }

    init() {
        // Extend the editor schema and mark the "linkHref" model attribute as formatting.
        this.editor.model.schema.setAttributeProperties( 'linkHref', {
            isFormatting: true
        });
    }

}
