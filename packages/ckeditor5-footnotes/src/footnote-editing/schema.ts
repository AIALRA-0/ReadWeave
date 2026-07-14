// eslint-disable-next-line no-restricted-imports
import { ModelSchema } from 'ckeditor5';
import { ATTRIBUTES, ELEMENTS } from '../constants.js';

/**
 * Declares the custom element types used by the footnotes plugin.
 * See here for the meanings of each rule:
 * https://ckeditor.com/docs/ckeditor5/latest/api/module_engine_model_schema-SchemaItemDefinition.html#member-isObject
 */
export const defineSchema = ( schema: ModelSchema ): void => {
	/**
   * Footnote section at the footer of the document.
   */
	schema.register( ELEMENTS.footnoteSection, {
		isObject: true,
		allowWhere: '$block',
		allowIn: '$root',
		allowChildren: ELEMENTS.footnoteItem,
		allowAttributes: [ ATTRIBUTES.footnoteSection ]
	} );

	/**
   * Individual footnote item within the footnote section.
   */
	schema.register( ELEMENTS.footnoteItem, {
		isBlock: true,
		isObject: true,
		allowContentOf: '$root',
		allowAttributes: [ ATTRIBUTES.footnoteSection, ATTRIBUTES.footnoteId, ATTRIBUTES.footnoteIndex ]
	} );

	/**
   * Editable footnote item content container.
   */
	schema.register( ELEMENTS.footnoteContent, {
		allowIn: ELEMENTS.footnoteItem,
		allowContentOf: '$root',
		allowAttributes: [ ATTRIBUTES.footnoteSection ]
	} );

	/**
   * Inline footnote citation, placed within the main text.
   */
	schema.register( ELEMENTS.footnoteReference, {
		allowWhere: '$text',
		isInline: true,
		isObject: true,
		allowAttributes: [ ATTRIBUTES.footnoteReference, ATTRIBUTES.footnoteId, ATTRIBUTES.footnoteIndex ]
	} );

	/**
   * return link which takes you from the footnote to the inline reference.
   */
	schema.register( ELEMENTS.footnoteBackLink, {
		allowIn: ELEMENTS.footnoteItem,
		isInline: true,
		isSelectable: false,
		allowAttributes: [ ATTRIBUTES.footnoteBackLink, ATTRIBUTES.footnoteId ]
	} );

	schema.addChildCheck( ( context, childDefinition ) => {
		if ( context.endsWith( ELEMENTS.footnoteContent ) && childDefinition.name === ELEMENTS.footnoteSection ) {
			return false;
		}
		if ( context.endsWith( ELEMENTS.footnoteContent ) && childDefinition.name === 'listItem' ) {
			return false;
		}
	} );
};
