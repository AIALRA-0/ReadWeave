import Mathematics from '../src/math.js';
import AutoMath from '../src/automath.js';
import MathUI from '../src/mathui.js';
import { ClassicEditor, Clipboard, Paragraph, Undo, Typing, _getModelData as getData, _setModelData as setData } from 'ckeditor5';
import { describe, beforeEach, it, afterEach, expect } from "vitest";

describe( 'AutoMath - integration', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		return ClassicEditor
			.create( editorElement, {
				plugins: [ Mathematics, AutoMath, Typing, Paragraph ],
				licenseKey: "GPL",
				math: {
					engine: ( equation, element, display ) => {
						if ( display ) {
							element.innerHTML = '\\[' + equation + '\\]';
						} else {
							element.innerHTML = '\\(' + equation + '\\)';
						}
					}
				}
			} )
			.then( newEditor => {
				editor = newEditor;
			} );
	} );

	afterEach( () => {
		editorElement.remove();

		return editor.destroy();
	} );

	it( 'should load Clipboard plugin', () => {
		expect( editor.plugins.get( Clipboard ) ).to.instanceOf( Clipboard );
	} );

	it( 'should load Undo plugin', () => {
		expect( editor.plugins.get( Undo ) ).to.instanceOf( Undo );
	} );

	it( 'has proper name', () => {
		expect( AutoMath.pluginName ).to.equal( 'AutoMath' );
	} );

	describe( 'pasted formulas', () => {
		it( 'replaces pasted text with mathtex element after 100ms', async () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\][]</paragraph>'
			);

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]'
			);
		} );

		it( 'replaces pasted text with inline mathtex element after 100ms', async () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\(x^2\\)[]</paragraph>'
			);

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>[<mathtex-inline display="false" equation="x^2" type="script"></mathtex-inline>]</paragraph>'
			);
		} );

		it( 'can undo auto-mathing', async () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\][]</paragraph>'
			);

			await waitForAutoMath();

			editor.commands.execute( 'undo' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\][]</paragraph>'
			);
		} );

		it( 'works for not collapsed selection inside single element', async () => {
			setData( editor.model, '<paragraph>[Foo]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]'
			);
		} );

		it( 'works for not collapsed selection over a few elements', async () => {
			setData( editor.model, '<paragraph>Fo[o</paragraph><paragraph>Ba]r</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>Fo</paragraph>[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]<paragraph>r</paragraph>'
			);
		} );

		it( 'inserts mathtex in-place (collapsed selection)', async () => {
			setData( editor.model, '<paragraph>Foo []Bar</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>Foo </paragraph>' +
				'[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]' +
				'<paragraph>Bar</paragraph>'
			);
		} );

		it( 'inserts math in-place (non-collapsed selection)', async () => {
			setData( editor.model, '<paragraph>Foo [Bar] Baz</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>Foo </paragraph>' +
				'[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]' +
				'<paragraph> Baz</paragraph>'
			);
		} );

		it( 'does nothing if pasted two equation as text', async () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\] \\[\\sqrt{x}2\\]' );

			await waitForAutoMath();

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\] \\[\\sqrt{x}2\\][]</paragraph>'
			);
		} );
	} );

	function waitForAutoMath() {
		return new Promise( resolve => window.setTimeout( resolve, 120 ) );
	}

	it( 'opens a prefilled inline formula window for closed dollar delimiters', () => {
		setData( editor.model, '<paragraph>[]</paragraph>' );
		editor.model.change( writer => editor.model.insertContent( writer.createText( '$x^2$' ) ) );

		const mathUI = editor.plugins.get( MathUI );
		expect( mathUI.formView?.equation ).to.equal( 'x^2' );
		expect( mathUI.formView?.displayButtonView.isOn ).to.equal( false );
		expect( getData( editor.model ) ).to.equal( '<paragraph>[]</paragraph>' );
	} );

	it( 'restores the original inline delimiters when the formula window is cancelled', () => {
		setData( editor.model, '<paragraph>[]</paragraph>' );
		editor.model.change( writer => editor.model.insertContent( writer.createText( '$x^2$' ) ) );

		editor.plugins.get( MathUI ).formView?.fire( 'cancel' );

		expect( getData( editor.model ) ).to.equal( '<paragraph>$x^2$[]</paragraph>' );
	} );

	it( 'opens a prefilled display formula window for double dollar delimiters', () => {
		setData( editor.model, '<paragraph>[]</paragraph>' );
		editor.model.change( writer => editor.model.insertContent( writer.createText( '$$x^2$$' ) ) );

		const mathUI = editor.plugins.get( MathUI );
		expect( mathUI.formView?.equation ).to.equal( 'x^2' );
		expect( mathUI.formView?.displayButtonView.isOn ).to.equal( true );
	} );

	it( 'does not open formula input for escaped or unclosed dollars', () => {
		setData( editor.model, '<paragraph>[]</paragraph>' );
		editor.model.change( writer => editor.model.insertContent( writer.createText( '\\$x^2$' ) ) );

		const mathUI = editor.plugins.get( MathUI );
		expect( mathUI.formView?.equation ).to.equal( '' );
		expect( getData( editor.model ) ).to.equal( '<paragraph>\\$x^2$[]</paragraph>' );

		setData( editor.model, '<paragraph>[]</paragraph>' );
		editor.model.change( writer => editor.model.insertContent( writer.createText( '$x^2' ) ) );
		expect( getData( editor.model ) ).to.equal( '<paragraph>$x^2[]</paragraph>' );
	} );

	function pasteHtml( editor: ClassicEditor, html: string ) {
		editor.editing.view.document.fire( 'paste', {
			dataTransfer: createDataTransfer( { 'text/html': html } ),
			preventDefault() {},
			stopPropagation() {}
		} );
	}

	function createDataTransfer( data: Record<string, string> ) {
		return {
			getData( type: string ) {
				return data[ type ];
			}
		};
	}
} );
