#!/usr/bin/env node
/**
 * End-to-end smoke test against the real Google APIs.
 *
 * CREATES A REAL PRESENTATION in your Drive and leaves it there so you can look
 * at it. Prints its URL at the end. Run only after consent has been redone.
 *
 *   node scripts/smoke.mjs /path/to/image.png
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGoogleCredential } from '../build/auth/resolveCredential.js';
import { buildClients } from '../build/google/clients.js';
import { addSlide } from '../build/tools/addSlide.js';
import { arrangeElements } from '../build/tools/arrangeElements.js';
import { batchUpdatePresentation } from '../build/tools/batchUpdatePresentation.js';
import { copyPresentation } from '../build/tools/copyPresentation.js';
import { createPresentation } from '../build/tools/createPresentation.js';
import { getPageThumbnail } from '../build/tools/getPageThumbnail.js';
import { insertImage } from '../build/tools/insertImage.js';
import { listLayouts } from '../build/tools/listLayouts.js';
import { listPageElements } from '../build/tools/listPageElements.js';
import { manageSlides } from '../build/tools/manageSlides.js';
import { replaceAllText } from '../build/tools/replaceAllText.js';
import { replaceImage } from '../build/tools/replaceImage.js';
import { setElementGeometry } from '../build/tools/setElementGeometry.js';
import { setElementText } from '../build/tools/setElementText.js';
import { setPageBackground } from '../build/tools/setPageBackground.js';
import { setShapeProperties } from '../build/tools/setShapeProperties.js';
import { setTextStyle } from '../build/tools/setTextStyle.js';
import { setThemeColors } from '../build/tools/setThemeColors.js';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('usage: node scripts/smoke.mjs /path/to/image.png');
  process.exit(1);
}

const clients = buildClients(await resolveGoogleCredential());
let failures = 0;

const step = async (label, fn) => {
  process.stdout.write(`${label} ... `);
  try {
    const result = await fn();
    console.log('ok');
    return result;
  } catch (error) {
    failures += 1;
    console.log(`FAILED\n    ${error.message}`);
    return undefined;
  }
};

const deck = await step('create_presentation', () =>
  createPresentation.handler(clients, { title: `smoke ${new Date().toISOString()}` })
);
if (!deck) process.exit(1);
const presentationId = deck.presentationId;

const slide = await step('add_slide (TITLE_AND_BODY + text)', () =>
  addSlide.handler(clients, {
    presentationId,
    layout: 'TITLE_AND_BODY',
    title: 'Smoke test',
    body: 'PLACEHOLDER_TOKEN',
  })
);

await step('set_element_text on the empty-then-filled title', () =>
  setElementText.handler(clients, {
    presentationId,
    objectId: slide.placeholders.find((p) => p.type === 'TITLE').objectId,
    text: 'Smoke test (renamed)',
  })
);

const replaced = await step('replace_all_text', () =>
  replaceAllText.handler(clients, {
    presentationId,
    text: 'PLACEHOLDER_TOKEN',
    replaceText: 'replaced by replace_all_text',
  })
);
if (replaced) console.log(`    occurrencesChanged=${replaced.occurrencesChanged}`);

const inserted = await step('insert_image (local transparent PNG -> Drive staging)', () =>
  insertImage.handler(clients, {
    presentationId,
    pageObjectId: slide.slideObjectId,
    imagePath,
    x: 40,
    y: 220,
    width: 240,
    height: 135,
    altText: 'smoke test image',
  })
);
if (inserted) {
  console.log(`    urlForm=${inserted.urlForm} staged=${inserted.staged}`);
  if (inserted.warning) console.log(`    WARNING: ${inserted.warning}`);
}

await step('insert_image (public URL, no Drive round-trip)', () =>
  insertImage.handler(clients, {
    presentationId,
    pageObjectId: slide.slideObjectId,
    imageUrl: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
    x: 320,
    y: 220,
    width: 240,
  })
);

// A failed image insert should not take the later steps down with it.
const imageId = inserted?.objectId;

if (imageId) {
  await step('replace_image (keeps id, position, Z-order)', () =>
    replaceImage.handler(clients, { presentationId, imageObjectId: imageId, imagePath })
  );
}

const titleId = slide.placeholders.find((p) => p.type === 'TITLE').objectId;
const bodyId = slide.placeholders.find((p) => p.type === 'BODY').objectId;

const elementOf = async (objectId) => {
  const data = (
    await clients.slides.presentations.get({
      presentationId,
      fields: 'slides(pageElements(objectId,size,transform,shape(shapeProperties)))',
    })
  ).data;
  return data.slides.flatMap((s) => s.pageElements ?? []).find((e) => e.objectId === objectId);
};

const expectFailure = (label, fn) =>
  step(label, async () => {
    try {
      await fn();
    } catch (error) {
      return error.message;
    }
    throw new Error('succeeded when it should have been rejected');
  });

const listed = await step('list_page_elements (the ids the styling tools need)', async () => {
  const result = await listPageElements.handler(clients, { presentationId });
  const ids = result.pages.flatMap((page) => page.elements.map((el) => el.objectId));
  if (!ids.includes(titleId)) throw new Error('title placeholder missing from discovery');
  if (imageId && !ids.includes(imageId)) throw new Error('inserted image missing from discovery');
  return result;
});
if (listed) {
  const own = listed.pages.find((page) => page.pageObjectId === slide.slideObjectId);
  console.log(`    ${listed.pages.length} slides, ${own.elements.length} elements on the new one`);
}

await step('set_shape_properties (fill, outline, alignment, autofit)', () =>
  setShapeProperties.handler(clients, {
    presentationId,
    objectId: bodyId,
    backgroundColor: '#FFF2CC',
    outlineColor: 'ACCENT1',
    outlineWeight: 2,
    outlineDashStyle: 'SOLID',
    contentAlignment: 'MIDDLE',
    autofit: 'NONE',
  })
);

// The mask-reset regression. A second call naming only the outline must leave the
// fill and the content alignment exactly where the first call put them.
await step('set_shape_properties (outline NONE only -> fill and alignment survive)', async () => {
  await setShapeProperties.handler(clients, { presentationId, objectId: bodyId, outlineColor: 'NONE' });
  const props = (await elementOf(bodyId)).shape.shapeProperties;
  if (!props.shapeBackgroundFill?.solidFill) throw new Error('fill was reset by the outline-only mask');
  if (props.contentAlignment !== 'MIDDLE') throw new Error('contentAlignment was reset by the outline-only mask');
  if (props.outline?.propertyState !== 'NOT_RENDERED') throw new Error('outline was not cleared');
});

await step('set_text_style (size, colour, alignment, autofit last)', async () => {
  await setTextStyle.handler(clients, {
    presentationId,
    objectId: titleId,
    bold: true,
    fontSize: 30,
    foregroundColor: 'ACCENT1',
    alignment: 'CENTER',
    lineSpacing: 115,
    autofit: 'NONE',
  });
  const autofit = (await elementOf(titleId)).shape.shapeProperties.autofit;
  console.log(`    autofitType=${autofit?.autofitType} fontScale=${autofit?.fontScale}`);
  if (autofit?.autofitType !== 'NONE') {
    throw new Error(`autofit did not stick: ${JSON.stringify(autofit)}`);
  }
});

await step('set_text_style (bold:false un-bolds rather than being dropped)', () =>
  setTextStyle.handler(clients, { presentationId, objectId: titleId, bold: false })
);

if (imageId) {
  await step('set_element_geometry (move, then resize, round-trips in points)', async () => {
    await setElementGeometry.handler(clients, { presentationId, objectId: imageId, x: 60, y: 300 });
    const out = await setElementGeometry.handler(clients, { presentationId, objectId: imageId, width: 180 });
    if (Math.abs(out.width - 180) > 0.5) throw new Error(`width came back ${out.width}`);
    const seen = await listPageElements.handler(clients, { presentationId });
    const el = seen.pages.flatMap((page) => page.elements).find((item) => item.objectId === imageId);
    if (Math.abs(el.x - 60) > 0.5 || Math.abs(el.width - 180) > 0.5) {
      throw new Error(`discovery disagrees with geometry: ${JSON.stringify(el)}`);
    }
  });

  // Rotation lives in the shear terms, so a naive resize would silently un-rotate.
  await step('set_element_geometry keeps a rotated element rotated', async () => {
    const angle = Math.PI / 6;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const before = await elementOf(imageId);
    await batchUpdatePresentation.handler(clients, {
      presentationId,
      requests: [
        {
          updatePageElementTransform: {
            objectId: imageId,
            applyMode: 'ABSOLUTE',
            transform: {
              scaleX: c * before.transform.scaleX,
              shearX: -sn * before.transform.scaleY,
              shearY: sn * before.transform.scaleX,
              scaleY: c * before.transform.scaleY,
              translateX: before.transform.translateX,
              translateY: before.transform.translateY,
              unit: 'EMU',
            },
          },
        },
      ],
    });
    await setElementGeometry.handler(clients, { presentationId, objectId: imageId, width: 200 });
    const t = (await elementOf(imageId)).transform;
    const degrees = (Math.atan2(t.shearY, t.scaleX) * 180) / Math.PI;
    if (Math.abs(degrees - 30) > 0.5) throw new Error(`rotation drifted to ${degrees} degrees`);
  });

  await expectFailure('set_shape_properties on an image is refused locally', () =>
    setShapeProperties.handler(clients, { presentationId, objectId: imageId, backgroundColor: '#FF0000' })
  );
}

await expectFailure('autofit TEXT_AUTOFIT is refused locally, not by Google', () =>
  setShapeProperties.handler(clients, { presentationId, objectId: bodyId, autofit: 'TEXT_AUTOFIT' })
);

await expectFailure('transparent text is refused locally', () =>
  setTextStyle.handler(clients, { presentationId, objectId: titleId, foregroundColor: 'NONE' })
);

await expectFailure('set_element_geometry on an unknown id names list_page_elements', () =>
  setElementGeometry.handler(clients, { presentationId, objectId: 'no_such_element', x: 10 })
);

// ---- backup copy -------------------------------------------------------------

await step('copy_presentation (timestamped name, then delete the copy)', async () => {
  const copy = await copyPresentation.handler(clients, { presentationId });
  if (!copy.presentationId || copy.presentationId === presentationId)
    throw new Error(`bad copy id ${copy.presentationId}`);
  if (!/\(backup \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/.test(copy.name)) throw new Error(`unexpected name ${copy.name}`);
  console.log(`    ${copy.name}`);
  await clients.drive.files.delete({ fileId: copy.presentationId });
});

// Set COPY_FOREIGN_DECK to the id of a deck this app did not create, to check
// whether drive.file plus drive.readonly is enough to copy it.
if (process.env.COPY_FOREIGN_DECK) {
  await step('copy_presentation on a deck this app did not create', async () => {
    const copy = await copyPresentation.handler(clients, { presentationId: process.env.COPY_FOREIGN_DECK });
    await clients.drive.files.delete({ fileId: copy.presentationId });
  });
}

// ---- layouts and masters --------------------------------------------------------

const layouts = await step('list_layouts', async () => {
  const result = await listLayouts.handler(clients, { presentationId });
  if (result.masters.length === 0) throw new Error('no masters reported');
  const all = result.masters.flatMap((master) => master.layouts);
  console.log(`    ${result.masters.length} master(s), ${all.length} layouts`);
  return { ...result, all };
});
const layoutNamed = (name) => layouts?.all.find((layout) => layout.name === name);

const slideIndex = async (objectId) =>
  (await clients.slides.presentations.get({ presentationId, fields: 'slides(objectId)' })).data.slides.findIndex(
    (s) => s.objectId === objectId
  );

const relaid = await step('manage_slides relayout carries text, style, bullets and notes', async () => {
  const added = await addSlide.handler(clients, {
    presentationId,
    layout: 'TITLE_AND_BODY',
    title: 'Relayout me',
    body: 'first point\nsecond point',
  });
  const relTitle = added.placeholders.find((p) => p.type === 'TITLE').objectId;
  const relBody = added.placeholders.find((p) => p.type === 'BODY').objectId;
  await setTextStyle.handler(clients, { presentationId, objectId: relTitle, bold: true });
  const notesId = (
    await clients.slides.presentations.get({
      presentationId,
      fields: 'slides(objectId,slideProperties(notesPage(notesProperties)))',
    })
  ).data.slides.find((s) => s.objectId === added.slideObjectId).slideProperties.notesPage.notesProperties
    .speakerNotesObjectId;
  await batchUpdatePresentation.handler(clients, {
    presentationId,
    requests: [
      {
        createParagraphBullets: {
          objectId: relBody,
          textRange: { type: 'ALL' },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      },
      { insertText: { objectId: notesId, text: 'speaker notes survive', insertionIndex: 0 } },
    ],
  });
  const before = await slideIndex(added.slideObjectId);
  const out = await manageSlides.handler(clients, {
    presentationId,
    action: 'relayout',
    slideObjectId: added.slideObjectId,
    layout: 'TITLE_AND_TWO_COLUMNS',
  });
  console.log(`    reusedIds=${out.reusedIds} notesCopied=${out.notesCopied}`);
  if (!out.notesCopied) throw new Error('notes were not copied');
  if ((await slideIndex(out.slideObjectId)) !== before) throw new Error('slide moved');
  const page = (await clients.slides.presentations.pages.get({ presentationId, pageObjectId: out.slideObjectId })).data;
  if (page.slideProperties.layoutObjectId !== layoutNamed('TITLE_AND_TWO_COLUMNS')?.objectId)
    throw new Error('layout not applied');
  const runs = page.pageElements.flatMap((e) => e.shape?.text?.textElements ?? []);
  const titleRun = runs.find((r) => r.textRun?.content?.startsWith('Relayout me'));
  if (!titleRun?.textRun.style?.bold) throw new Error('title lost its bold');
  const bulleted = runs.filter((r) => r.paragraphMarker?.bullet).length;
  if (bulleted !== 2) throw new Error(`expected 2 bulleted paragraphs, saw ${bulleted}`);
  const newNotes = page.slideProperties.notesPage.pageElements
    .flatMap((e) => e.shape?.text?.textElements ?? [])
    .map((r) => r.textRun?.content ?? '')
    .join('');
  if (!newNotes.includes('speaker notes survive')) throw new Error(`notes came back as ${JSON.stringify(newNotes)}`);
  return out;
});

await expectFailure('relayout refuses a slide carrying images', () =>
  manageSlides.handler(clients, {
    presentationId,
    action: 'relayout',
    slideObjectId: slide.slideObjectId,
    layout: 'TITLE_ONLY',
  })
);

if (relaid) {
  await expectFailure('relayout refuses when the body has nowhere to go', () =>
    manageSlides.handler(clients, {
      presentationId,
      action: 'relayout',
      slideObjectId: relaid.slideObjectId,
      layout: 'TITLE_ONLY',
    })
  );

  await step('manage_slides duplicate, move, delete', async () => {
    const count = async () =>
      (await clients.slides.presentations.get({ presentationId, fields: 'slides(objectId)' })).data.slides.length;
    const start = await count();
    const dup = await manageSlides.handler(clients, {
      presentationId,
      action: 'duplicate',
      slideObjectId: relaid.slideObjectId,
      insertionIndex: 0,
    });
    if ((await slideIndex(dup.slideObjectId)) !== 0) throw new Error('duplicate not at index 0');
    await manageSlides.handler(clients, {
      presentationId,
      action: 'move',
      slideObjectIds: [dup.slideObjectId],
      insertionIndex: start + 1,
    });
    if ((await slideIndex(dup.slideObjectId)) !== start) throw new Error('move did not reach the end');
    await manageSlides.handler(clients, { presentationId, action: 'delete', slideObjectIds: [dup.slideObjectId] });
    if ((await count()) !== start) throw new Error('delete did not restore the count');
  });
}

// ---- arrangement ---------------------------------------------------------------

const blank = await step('add_slide BLANK for arrangement', () =>
  addSlide.handler(clients, { presentationId, layout: 'BLANK' })
);
if (blank) {
  const boxIds = ['arr_a', 'arr_b', 'arr_c'];
  await step('arrange_elements align, distribute, z_order, group, ungroup', async () => {
    await batchUpdatePresentation.handler(clients, {
      presentationId,
      requests: boxIds.map((objectId, i) => ({
        createShape: {
          objectId,
          shapeType: 'RECTANGLE',
          elementProperties: {
            pageObjectId: blank.slideObjectId,
            size: { width: { magnitude: 60 + 20 * i, unit: 'PT' }, height: { magnitude: 40, unit: 'PT' } },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: [30, 140, 400][i],
              translateY: [20, 90, 200][i],
              unit: 'PT',
            },
          },
        },
      })),
    });
    await arrangeElements.handler(clients, { presentationId, action: 'align', objectIds: boxIds, edge: 'top' });
    const dist = await arrangeElements.handler(clients, {
      presentationId,
      action: 'distribute',
      objectIds: boxIds,
      axis: 'horizontal',
    });
    const seen = (await listPageElements.handler(clients, { presentationId, pageObjectId: blank.slideObjectId }))
      .pages[0].elements;
    const els = boxIds.map((id) => seen.find((e) => e.objectId === id));
    if (new Set(els.map((e) => e.y)).size !== 1) throw new Error(`tops differ: ${els.map((e) => e.y)}`);
    const gapAB = els[1].x - (els[0].x + els[0].width);
    const gapBC = els[2].x - (els[1].x + els[1].width);
    if (Math.abs(gapAB - gapBC) > 0.5) throw new Error(`gaps differ: ${gapAB} vs ${gapBC} (${JSON.stringify(dist)})`);
    await arrangeElements.handler(clients, {
      presentationId,
      action: 'z_order',
      objectIds: ['arr_a'],
      operation: 'BRING_TO_FRONT',
    });
    const grouped = await arrangeElements.handler(clients, { presentationId, action: 'group', objectIds: boxIds });
    await arrangeElements.handler(clients, {
      presentationId,
      action: 'align',
      objectIds: [grouped.groupObjectId],
      edge: 'center',
      relativeTo: 'page',
    });
    await arrangeElements.handler(clients, { presentationId, action: 'ungroup', objectIds: [grouped.groupObjectId] });
  });

  await expectFailure('arrange_elements refuses a group member', async () => {
    const grouped = await arrangeElements.handler(clients, {
      presentationId,
      action: 'group',
      objectIds: ['arr_a', 'arr_b'],
    });
    try {
      await arrangeElements.handler(clients, {
        presentationId,
        action: 'align',
        objectIds: ['arr_a', 'arr_c'],
        edge: 'left',
      });
    } finally {
      await arrangeElements.handler(clients, { presentationId, action: 'ungroup', objectIds: [grouped.groupObjectId] });
    }
  });

  await step('set_page_background colour, image, inherit on a slide', async () => {
    await setPageBackground.handler(clients, { presentationId, pageObjectId: blank.slideObjectId, color: '#203040' });
    const image = await setPageBackground.handler(clients, {
      presentationId,
      pageObjectId: blank.slideObjectId,
      imagePath,
    });
    console.log(`    image urlForm=${image.urlForm}`);
    await setPageBackground.handler(clients, { presentationId, pageObjectId: blank.slideObjectId, inherit: true });
  });
}

const titleAndBody = layoutNamed('TITLE_AND_BODY');
if (titleAndBody) {
  await step('set_page_background on a layout', () =>
    setPageBackground.handler(clients, { presentationId, pageObjectId: titleAndBody.objectId, color: '#FFFDF5' })
  );

  await step('list_page_elements and set_shape_properties on a layout placeholder', async () => {
    const listedLayout = await listPageElements.handler(clients, {
      presentationId,
      pageObjectId: titleAndBody.objectId,
    });
    if (listedLayout.pages[0].pageType !== 'layout') throw new Error('layout page not labelled');
    const layoutTitle = titleAndBody.placeholders.find((p) => p.type === 'TITLE').objectId;
    await setShapeProperties.handler(clients, { presentationId, objectId: layoutTitle, backgroundColor: '#EEEEEE' });
  });
}

await step('set_theme_colors ACCENT1, read back through list_layouts', async () => {
  await setThemeColors.handler(clients, { presentationId, colors: { ACCENT1: '#FF6600' } });
  const after = await listLayouts.handler(clients, { presentationId });
  if (after.masters[0].themeColors.ACCENT1 !== '#FF6600')
    throw new Error(`ACCENT1 is ${after.masters[0].themeColors.ACCENT1}`);
});

const thumb = await step('get_page_thumbnail', () =>
  getPageThumbnail.handler(clients, { presentationId, pageObjectId: slide.slideObjectId })
);
if (thumb) {
  const image = thumb.content.find((c) => c.type === 'image');
  const out = join(tmpdir(), 'google-slides-mcp-smoke.png');
  writeFileSync(out, Buffer.from(image.data, 'base64'));
  console.log(`    ${thumb.content[0].text}`);
  console.log(`    saved to ${out}`);
}

// Nothing should be left behind by staging.
const leftovers = await clients.drive.files.list({
  q: "name contains 'google-slides-mcp-staged' and trashed = false",
  fields: 'files(id,name)',
});
const stale = leftovers.data.files ?? [];
console.log(`\nstaged files left in Drive: ${stale.length}${stale.length ? ' <-- LEAK' : ' (clean)'}`);
for (const file of stale) console.log(`  ${file.id} ${file.name}`);

console.log(`\nhttps://docs.google.com/presentation/d/${presentationId}/edit`);
console.log(failures === 0 ? 'ALL STEPS PASSED' : `${failures} STEP(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
