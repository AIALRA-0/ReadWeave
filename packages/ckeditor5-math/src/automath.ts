import { Clipboard, Plugin, type Editor, ModelLivePosition, ModelLiveRange, Undo } from 'ckeditor5';
import { extractDelimiters, hasDelimiters, delimitersCounts } from './utils.js';
import MathUI from './mathui.js';

export default class AutoMath extends Plugin {
	public static get requires() {
		return [ Clipboard, Undo ] as const;
	}

	public static get pluginName() {
		return 'AutoMath' as const;
	}

	private _timeoutId: null | number;
	private _positionToInsert: null | ModelLivePosition;
	private _pendingPasteRange: null | ModelLiveRange = null;
	private _handlingTypedInput = false;

	constructor( editor: Editor ) {
		super( editor );

		this._timeoutId = null;

		this._positionToInsert = null;
	}

	public init(): void {
		const editor = this.editor;
		const modelDocument = editor.model.document;
		this.listenTo( modelDocument, 'change:data', () => this._openTypedDelimitedInput() );

		this.listenTo( editor.editing.view.document, 'paste', ( _event, data: { dataTransfer?: { getData: ( type: string ) => string } } ) => {
			const html = data.dataTransfer?.getData( 'text/html' ) ?? '';
			const plain = data.dataTransfer?.getData( 'text/plain' ) ?? '';
			const text = ( plain || htmlToPlainText( html ) ).trim();
			if ( !hasDelimiters( text ) || delimitersCounts( text ) !== 2 ) {
				return;
			}
			modelDocument.once( 'change:data', () => this._schedulePastedMath( text ), { priority: 'low' } );
		}, { priority: 'high' } );

		editor.commands.get( 'undo' )?.on( 'execute', () => {
			if ( this._timeoutId ) {
				window.clearTimeout( this._timeoutId );
				this._positionToInsert?.detach();
				this._pendingPasteRange?.detach();

				this._timeoutId = null;
				this._positionToInsert = null;
				this._pendingPasteRange = null;
			}
		}, { priority: 'high' } );
	}

	private _schedulePastedMath( text: string ): void {
		const editor = this.editor;
		const position = editor.model.document.selection.getFirstPosition();
		if ( !position || !editor.model.document.selection.isCollapsed || position.offset < text.length ) {
			return;
		}
		const start = editor.model.createPositionAt( position.parent, position.offset - text.length );
		const rawRange = editor.model.createRange( start, position );
		let actual = '';
		for ( const step of rawRange.getWalker( { ignoreElementEnd: true } ) ) {
			if ( !step.item.is( '$textProxy' ) ) return;
			actual += step.item.data;
		}
		if ( actual.trim() !== text ) return;
		const mathCommand = editor.commands.get( 'math' );
		if ( !mathCommand?.isEnabled ) return;
		const mathConfig = editor.config.get( 'math' );
		const insertPosition = ModelLivePosition.fromPosition( start );
		const equationRange = ModelLiveRange.fromRange( rawRange );
		this._positionToInsert = insertPosition;
		this._pendingPasteRange = equationRange;
		this._timeoutId = window.setTimeout( () => {
			this._timeoutId = null;
			editor.model.change( writer => {
				writer.remove( equationRange );
				const params = Object.assign( extractDelimiters( text ), { type: mathConfig?.outputType } );
				const mathElement = writer.createElement( params.display ? 'mathtex-display' : 'mathtex-inline', params );
				editor.model.insertContent( mathElement, insertPosition );
				writer.setSelection( mathElement, 'on' );
			} );
			equationRange.detach();
			insertPosition.detach();
			this._pendingPasteRange = null;
			this._positionToInsert = null;
		}, 100 );
	}

	private _openTypedDelimitedInput(): void {
		if ( this._handlingTypedInput ) {
			return;
		}
		const editor = this.editor;
		const selection = editor.model.document.selection;
		if ( !selection.isCollapsed ) {
			return;
		}
		const position = selection.getFirstPosition();
		if ( !position || position.parent.is( 'rootElement' ) ) {
			return;
		}
		let ancestor: typeof position.parent | null = position.parent;
		while ( ancestor ) {
			if ( ancestor.is( 'element', 'codeBlock' ) ) {
				return;
			}
			ancestor = ancestor.parent;
		}
		const start = editor.model.createPositionAt( position.parent, 0 );
		const beforeCaret = editor.model.createRange( start, position );
		let text = '';
		for ( const step of beforeCaret.getWalker( { ignoreElementEnd: true } ) ) {
			if ( !step.item.is( '$textProxy' ) ) {
				return;
			}
			text += step.item.data;
		}
		const blockMatch = text.match( /((?<![\\$])\$\$((?:\\.|[^$])+)\$\$)$/u );
		const inlineMatch = blockMatch ? null : text.match( /((?<![\\$])\$((?:\\.|[^$\n])+)\$)$/u );
		const match = blockMatch ?? inlineMatch;
		if ( !match || !match[ 2 ].trim() ) {
			return;
		}
		const mathUI = editor.plugins.get( 'MathUI' );
		if ( !( mathUI instanceof MathUI ) || !editor.commands.get( 'math' )?.isEnabled ) {
			return;
		}
		const original = match[ 1 ];
		const equation = match[ 2 ];
		const triggerStart = editor.model.createPositionAt( position.parent, position.offset - original.length );
		const restorePosition = ModelLivePosition.fromPosition( triggerStart );
		this._handlingTypedInput = true;
		editor.model.change( writer => {
			writer.remove( writer.createRange( triggerStart, position ) );
			writer.setSelection( triggerStart );
		} );
		this._handlingTypedInput = false;
		mathUI._showPrefilledUI( equation, !!blockMatch, committed => {
			if ( !committed && restorePosition.root.rootName !== '$graveyard' ) {
				this._handlingTypedInput = true;
				editor.model.change( writer => {
					editor.model.insertContent( writer.createText( original ), restorePosition );
				} );
				this._handlingTypedInput = false;
			}
			restorePosition.detach();
		} );
	}

	private _mathBetweenPositions(
		leftPosition: ModelLivePosition,
		rightPosition: ModelLivePosition
	) {
		const editor = this.editor;

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const mathConfig = this.editor.config.get( 'math' );

		const equationRange = new ModelLiveRange( leftPosition, rightPosition );
		const walker = equationRange.getWalker( { ignoreElementEnd: true } );

		let text = '';

		// Get equation text
		for ( const node of walker ) {
			if ( node.item.is( '$textProxy' ) ) {
				text += node.item.data;
			}
		}

		text = text.trim();

		// Skip if don't have delimiters
		if ( !hasDelimiters( text ) || delimitersCounts( text ) !== 2 ) {
			return;
		}

		const mathCommand = editor.commands.get( 'math' );

		// Do not anything if math element cannot be inserted at the current position
		if ( !mathCommand?.isEnabled ) {
			return;
		}

		this._positionToInsert = ModelLivePosition.fromPosition( leftPosition );

		// With timeout user can undo conversation if want use plain text
		this._timeoutId = window.setTimeout( () => {
			editor.model.change( writer => {
				this._timeoutId = null;

				writer.remove( equationRange );

				let insertPosition: ModelLivePosition | null;

				// Check if position where the math element should be inserted is still valid.
				if ( this._positionToInsert?.root.rootName !== '$graveyard' ) {
					insertPosition = this._positionToInsert;
				}

				editor.model.change( innerWriter => {
					const params = Object.assign( extractDelimiters( text ), {
						type: mathConfig?.outputType
					} );
					const mathElement = innerWriter.createElement( params.display ? 'mathtex-display' : 'mathtex-inline', params
					);

					editor.model.insertContent( mathElement, insertPosition );

					innerWriter.setSelection( mathElement, 'on' );
				} );

				this._positionToInsert?.detach();
				this._positionToInsert = null;
			} );
		}, 100 );
	}
}

function htmlToPlainText( html: string ): string {
	if ( !html ) return '';
	const container = document.createElement( 'div' );
	container.innerHTML = html;
	return container.textContent ?? '';
}
