# Emulate relayout by recreating the slide

The Slides API has no request that moves an existing slide onto another layout. `manage_slides` still offers a `relayout` action, because changing a slide's layout is a common edit and the alternative is a manual rebuild.

Relayout deletes the slide and recreates it on the target layout, in one atomic batch. The new slide sits at the old index and reuses the old slide and placeholder ids, so links from other slides keep working. If Google refuses an id inside the batch that frees it, the batch is retried with fresh ids and the result says so. The live smoke test shows that reuse is accepted today.

Only placeholder text can be carried across. An image, a free text box or a table cannot be moved between slides through the API, so a slide holding any of them is refused, with the blocking ids named. Nothing is dropped silently. Filled placeholders are matched to the target layout by type, with `CENTERED_TITLE` and `TITLE` treated as one family, and then by index. Text with no counterpart on the target layout is refused too.

The text is written back with its run styles, paragraph styles and bullets. Each style request's field mask names exactly the keys read from the source, as ADR-0014 requires. Bullet nesting is encoded as leading tabs, because `createParagraphBullets` is the only way to set a nesting level. The bullet requests go last and run from the end of the text backwards, since each one removes tabs and shifts the indices after it.

Speaker notes go in a second batch, because the new notes shape only has an id once the slide exists. If that batch fails, the error returns the notes text, because the old slide is already gone. Relayout cannot be undone. Its description points at `copy_presentation`, and it takes no backup itself.
