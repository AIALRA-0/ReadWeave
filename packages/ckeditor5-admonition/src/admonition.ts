import { Plugin } from 'ckeditor5';

import AdmonitionEditing from './admonitionediting.js';
import AdmonitionUI from './admonitionui.js';
import AdmonitionAutoformat from './admonitionautoformat.js';

export default class Admonition extends Plugin {

	public static get requires() {
		return [ AdmonitionEditing, AdmonitionUI, AdmonitionAutoformat ] as const;
	}

	public static get pluginName() {
		return 'Admonition' as const;
	}

}
