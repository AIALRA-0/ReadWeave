import { type Editor, ModelElement, ModelText, ModelTextProxy, ViewElement } from 'ckeditor5';

// There's ample DRY violation in this file; type checking
// polymorphism without full typescript is just incredibly finicky.
// I (Jonathan) suspect there's a more elegant solution for this,
// but I tried a lot of things and none of them worked.

/**
 * Returns an array of all descendant elements of
 * the root for which the provided predicate returns true.
 */
export const modelQueryElementsAll = (
	editor: Editor,
	rootElement: ModelElement,
	predicate: ( item: ModelElement ) => boolean = _ => true
): Array<ModelElement> => {
	const range = editor.model.createRangeIn( rootElement );
	const output: Array<ModelElement> = [];

	for ( const item of range.getItems() ) {
		if ( !( item instanceof ModelElement ) ) {
			continue;
		}

		if ( predicate( item ) ) {
			output.push( item );
		}
	}
	return output;
};

/**
 * Returns an array of all descendant text nodes and text proxies of
 * the root for which the provided predicate returns true.
 */
export const modelQueryTextAll = (
	editor: Editor,
	rootElement: ModelElement,
	predicate: ( item: ModelText | ModelTextProxy ) => boolean = _ => true
): Array<ModelText | ModelTextProxy> => {
	const range = editor.model.createRangeIn( rootElement );
	const output: Array<ModelText | ModelTextProxy> = [];

	for ( const item of range.getItems() ) {
		if ( !( item instanceof ModelText || item instanceof ModelTextProxy ) ) {
			continue;
		}

		if ( predicate( item ) ) {
			output.push( item );
		}
	}
	return output;
};

/**
 * Returns the first descendant element of the root for which the provided
 * predicate returns true, or null if no such element is found.
 */
export const modelQueryElement = (
	editor: Editor,
	rootElement: ModelElement,
	predicate: ( item: ModelElement ) => boolean = _ => true
): ModelElement | null => {
	const range = editor.model.createRangeIn( rootElement );

	for ( const item of range.getItems() ) {
		if ( !( item instanceof ModelElement ) ) {
			continue;
		}

		if ( predicate( item ) ) {
			return item;
		}
	}
	return null;
};

/**
 * Returns the first descendant text node or text proxy of the root for which the provided
 * predicate returns true, or null if no such element is found.
 */
export const modelQueryText = (
	editor: Editor,
	rootElement: ModelElement,
	predicate: ( item: ModelText | ModelTextProxy ) => boolean = _ => true
): ModelText | ModelTextProxy | null => {
	const range = editor.model.createRangeIn( rootElement );

	for ( const item of range.getItems() ) {
		if ( !( item instanceof ModelText || item instanceof ModelTextProxy ) ) {
			continue;
		}

		if ( predicate( item ) ) {
			return item;
		}
	}
	return null;
};

/**
 * Returns the first descendant element of the root for which the provided
 * predicate returns true, or null if no such element is found.
 */
export const viewQueryElement = (
	editor: Editor,
	rootElement: ViewElement,
	predicate: ( item: ViewElement ) => boolean = _ => true
): ViewElement | null => {
	const range = editor.editing.view.createRangeIn( rootElement );

	for ( const item of range.getItems() ) {
		if ( !( item instanceof ViewElement ) ) {
			continue;
		}

		if ( predicate( item ) ) {
			return item;
		}
	}
	return null;
};

