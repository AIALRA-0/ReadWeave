import { Plugin } from 'ckeditor5';
import KbdEditing from './kbdediting.js';
import KbdUI from './kbdui.js';

/**
 * The keyboard shortcut feature.
 *
 * Provides a way to semantically mark keyboard shortcuts/hotkeys in the content.
 *
 * This is a "glue" plugin which loads the `KbdEditing` and `KbdUI` plugins.
 */
export default class Kbd extends Plugin {

	static get requires() {
		return [ KbdEditing, KbdUI ];
	}

	public static get pluginName() {
		return 'Kbd' as const;
	}

}
