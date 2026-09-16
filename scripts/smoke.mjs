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
import { resolveGoogleCredential } from '../build/auth/resolveCredential.js';
import { buildClients } from '../build/google/clients.js';
import { addSlide } from '../build/tools/addSlide.js';
import { createPresentation } from '../build/tools/createPresentation.js';
import { getPageThumbnail } from '../build/tools/getPageThumbnail.js';
import { insertImage } from '../build/tools/insertImage.js';
import { replaceAllText } from '../build/tools/replaceAllText.js';
import { replaceImage } from '../build/tools/replaceImage.js';
import { setElementText } from '../build/tools/setElementText.js';

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

if (inserted?.objectId) {
  await step('replace_image (keeps id, position, Z-order)', () =>
    replaceImage.handler(clients, { presentationId, imageObjectId: inserted.objectId, imagePath })
  );
}

const thumb = await step('get_page_thumbnail', () =>
  getPageThumbnail.handler(clients, { presentationId, pageObjectId: slide.slideObjectId })
);
if (thumb) {
  const image = thumb.content.find((c) => c.type === 'image');
  const out =
    '/tmp/claude-1000/-home-lavaux-PROJECTS-tools-google-slides-mcp/45a4d9d1-6855-4db3-83a8-b1ab30e37654/scratchpad/slide.png';
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
