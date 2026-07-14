import { Command } from "ckeditor5";

const MOCK_MERMAID_MARKUP = `flowchart TB
A --> B
B --> C`;

/**
 * The insert mermaid command.
 *
 * Allows to insert mermaid.
 */
export default class InsertMermaidCommand extends Command {

	override refresh() {
		const documentSelection = this.editor.model.document.selection;
		const selectedElement = documentSelection.getSelectedElement();

		if ( selectedElement && selectedElement.name === 'mermaid' ) {
			this.isEnabled = false;
		} else {
			this.isEnabled = true;
		}
	}

	override execute() {
		const editor = this.editor;
		const model = editor.model;
		let mermaidItem;

		model.change( writer => {
			mermaidItem = writer.createElement( 'mermaid', {
				displayMode: 'split',
				source: MOCK_MERMAID_MARKUP
			} );

			model.insertContent( mermaidItem );
		} );

		return mermaidItem;
	}
}
