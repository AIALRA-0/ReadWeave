import { Plugin } from 'ckeditor5';

import MermaidEditing from './mermaidediting.js';
import MermaidToolbar from './mermaidtoolbar.js';
import MermaidUI from './mermaidui.js';

export default class Mermaid extends Plugin {

	static get requires() {
		return [ MermaidEditing, MermaidToolbar, MermaidUI ];
	}

	public static get pluginName() {
		return 'Mermaid' as const;
	}

}
