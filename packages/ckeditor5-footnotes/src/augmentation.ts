import FootnoteEditing from './footnote-editing/footnote-editing.js';
import FootnoteUI from './footnote-ui.js';
import type { Footnotes } from './index.js';

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Footnotes.pluginName ]: Footnotes;
		[ FootnoteEditing.pluginName ]: FootnoteEditing;
		[ FootnoteUI.pluginName ]: FootnoteUI;
	}
}
