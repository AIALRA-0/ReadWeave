import { Plugin } from 'ckeditor5';
import FootnoteEditing from './footnote-editing/footnote-editing.js';
import FootnoteUI from './footnote-ui.js';

export default class Footnotes extends Plugin {
	public static get pluginName() {
		return 'Footnotes' as const;
	}

	public static get requires() {
		return [ FootnoteEditing, FootnoteUI ] as const;
	}
}
