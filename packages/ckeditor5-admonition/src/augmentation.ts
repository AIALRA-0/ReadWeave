import AdmonitionCommand from './admonitioncommand.js';
import AdmonitionEditing from './admonitionediting.js';
import AdmonitionUI from './admonitionui.js';
import type { Admonition } from './index.js';

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Admonition.pluginName ]: Admonition;
		[ AdmonitionEditing.pluginName ]: AdmonitionEditing;
		[ AdmonitionUI.pluginName ]: AdmonitionUI;
	}

	interface CommandsMap {
		admonition: AdmonitionCommand;
	}

}
