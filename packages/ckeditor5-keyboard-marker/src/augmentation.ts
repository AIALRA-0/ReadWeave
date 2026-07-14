import type { Kbd, KbdEditing, KbdUI } from './index.js';

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Kbd.pluginName ]: Kbd;
		[ KbdUI.pluginName ]: KbdUI;
		[ KbdEditing.pluginName ]: KbdEditing;
	}
}
