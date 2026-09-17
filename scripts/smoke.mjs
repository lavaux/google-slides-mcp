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
import { batchUpdatePresentation } from '../build/tools/batchUpdatePresentation.js';
import { createPresentation } from '../build/tools/createPresentation.js';
import { getPageThumbnail } from '../build/tools/getPageThumbnail.js';
import { insertImage } from '../build/tools/insertImage.js';
import { listPageElements } from '../build/tools/listPageElements.js';
import { replaceAllText } from '../build/tools/replaceAllText.js';
import { replaceImage } from '../build/tools/replaceImage.js';
import { setElementGeometry } from '../build/tools/setElementGeometry.js';
import { setElementText } from '../build/tools/setElementText.js';
import { setShapeProperties } from '../build/tools/setShapeProperties.js';
import { setTextStyle } from '../build/tools/setTextStyle.js';

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
