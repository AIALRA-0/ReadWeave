# Content width
Some note types such as <a class="reference-link" href="../../Note%20Types/Text.md">Text</a>, <a class="reference-link" href="../../Note%20Types/Relation%20Map.md">Relation Map</a>, and saved search intentionally limit the width of the content.

This might appear surprising at first, but the idea is to make text fit well on wider screens without appearing distorted. This is especially the case if the document contains <a class="reference-link" href="../../Note%20Types/Text/Images.md">Images</a>, tables or other width-dependent elements.

## Configuring the content width and alignment

The content width is expressed in pixels and can be changed from <a class="reference-link" href="Options.md">Options</a> → _Appearance_ → _Content Width_ and adjusting the _Max content width_ section.

To effectively disable the content width limitation, simply set the width to a value larger than your screen size (e.g. 9999).

By default, the content is aligned to the left, but it can be centered horizontally by checking _Keep content centered_ from the same section as the content width.

## Adjusting at note level

For notes with large elements such as Tables, it sometimes makes sense to avoid the content width without affecting other notes. To do so, apply the `fullContentWidth` [label](../../Advanced%20Usage/Attributes/Labels.md) to the note.