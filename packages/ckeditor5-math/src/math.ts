import { Plugin, Widget } from 'ckeditor5';
import MathEditing from './mathediting.js';
import MathUI from './mathui.js';
import AutoMath from './automath.js';

export default class Math extends Plugin {
	public static get requires() {
		return [ MathEditing, MathUI, AutoMath, Widget ] as const;
	}

	public static get pluginName() {
		return 'Math' as const;
	}
}
