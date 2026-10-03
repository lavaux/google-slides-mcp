#!/usr/bin/env node
// Checks that bad input fails locally with a message naming the real constraint,
// instead of Google's single opaque error, and that the pure helpers the styling
// tools are built on produce exactly what they claim. Makes no Google calls.
import assert from 'node:assert/strict';
import { checkCropBox, cropBytes, imageInfo } from '../build/images/crop.js';
import { validateImageBytes } from '../build/images/validate.js';
import { CropImageArgsSchema, GetImageInfoArgsSchema } from '../build/imageSchemas.js';
import {
  ArrangeElementsArgsSchema,
  ManageSlidesArgsSchema,
  SetPageBackgroundArgsSchema,
  SetThemeColorsArgsSchema,
} from '../build/layoutSchemas.js';
import {
  InsertImageArgsSchema,
  ListPageElementsArgsSchema,
  SetElementGeometryArgsSchema,
  SetElementTextArgsSchema,
  SetShapePropertiesArgsSchema,
  SetTextStyleArgsSchema,
} from '../build/schemas.js';
import { alignDeltas, boundingBox, distributeDeltas, unionBox } from '../build/slides/arrange.js';
import { croppedBox, hasEditorCrop, placeFrame } from '../build/slides/cropFrame.js';
import { axisScales, points, pointsToEmu, resizeBlocker, resizeTransform } from '../build/slides/geometry.js';
import { mapPlaceholders, sourcePlaceholders, textRequests } from '../build/slides/relayout.js';
import {
  autofitRequests,
  buildUpdate,
  hexFromRgb,
  leaf,
  mergeColorScheme,
  optionalColorLeaves,
  parseColor,
} from '../build/slides/style.js';
import { backupName } from '../build/tools/copyPresentation.js';

const png = (width, height) => {
  const b = Buffer.alloc(64);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};

// Zod reports through a result object rather than a throw, so it is reshaped here
// to keep every row below throw-shaped.
const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '));
  }
};

const target = { presentationId: 'p', objectId: 'o' };

const cases = [
  [
    'WebP',
    () => validateImageBytes(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])),
    'PNG, JPEG and GIF only',
  ],
  [
    'SVG',
    () => validateImageBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    'PNG, JPEG and GIF only',
  ],
  ['oversized pixels', () => validateImageBytes(png(10000, 10000)), '25 megapixels'],

  ['hex too short', () => parseColor('#12345'), '#RRGGBB'],
  ['css colour name', () => parseColor('BLUE'), 'ACCENT1'],
  ['css function', () => parseColor('rgb(1,2,3)'), '#RRGGBB'],
  ['empty colour', () => parseColor(''), '#RRGGBB'],
  ['NONE is not a colour', () => parseColor('NONE'), 'NONE to clear'],

  [
    'lone rowIndex on set_element_text',
    () => parse(SetElementTextArgsSchema, { ...target, text: 'x', rowIndex: 0 }),
    'together',
  ],
  [
    'lone columnIndex on set_text_style',
    () => parse(SetTextStyleArgsSchema, { ...target, columnIndex: 2 }),
    'together',
  ],
  ['negative width', () => parse(SetElementGeometryArgsSchema, { ...target, width: -5 }), 'Too small'],
  ['zero font size', () => parse(SetTextStyleArgsSchema, { ...target, fontSize: 0 }), 'Too small'],
  ['unknown autofit', () => parse(SetShapePropertiesArgsSchema, { ...target, autofit: 'SHRINK' }), 'option'],
  ['unknown alignment', () => parse(SetTextStyleArgsSchema, { ...target, alignment: 'JUSTIFY' }), 'option'],
  ['unknown kind filter', () => parse(ListPageElementsArgsSchema, { presentationId: 'p', kind: 'shapes' }), 'option'],
  [
    'blank objectId',
    () => parse(SetShapePropertiesArgsSchema, { presentationId: 'p', objectId: '' }),
    '"objectId" (string) is required.',
  ],

  [
    'move without an index',
    () => parse(ManageSlidesArgsSchema, { presentationId: 'p', action: 'move', slideObjectIds: ['s'] }),
    '"insertionIndex"',
  ],
  [
    'relayout without a layout',
    () => parse(ManageSlidesArgsSchema, { presentationId: 'p', action: 'relayout', slideObjectId: 's' }),
    '"layoutObjectId"',
  ],
  [
    'delete without slides',
    () => parse(ManageSlidesArgsSchema, { presentationId: 'p', action: 'delete' }),
    '"slideObjectIds"',
  ],
  ['unknown slide action', () => parse(ManageSlidesArgsSchema, { presentationId: 'p', action: 'rename' }), 'option'],
  [
    'distribute two elements',
    () =>
      parse(ArrangeElementsArgsSchema, {
        presentationId: 'p',
        action: 'distribute',
        axis: 'horizontal',
        objectIds: ['a', 'b'],
      }),
    'at least 3',
  ],
  [
    'align one element to itself',
    () => parse(ArrangeElementsArgsSchema, { presentationId: 'p', action: 'align', edge: 'left', objectIds: ['a'] }),
    'relativeTo "page"',
  ],
  [
    'align without an edge',
    () => parse(ArrangeElementsArgsSchema, { presentationId: 'p', action: 'align', objectIds: ['a', 'b'] }),
    '"edge"',
  ],
  [
    'group one element',
    () => parse(ArrangeElementsArgsSchema, { presentationId: 'p', action: 'group', objectIds: ['a'] }),
    'at least 2',
  ],
  [
    'background with nothing',
    () => parse(SetPageBackgroundArgsSchema, { presentationId: 'p', pageObjectId: 'g' }),
    'exactly one background',
  ],
  [
    'background with two fills',
    () =>
      parse(SetPageBackgroundArgsSchema, {
        presentationId: 'p',
        pageObjectId: 'g',
        color: '#fff',
        imageUrl: 'https://x/y.png',
      }),
    'got 2',
  ],
  [
    'unknown theme colour key',
    () => parse(SetThemeColorsArgsSchema, { presentationId: 'p', colors: { ACCENT7: '#000' } }),
    'Invalid key',
  ],
  [
    'theme colour by name',
    () => parse(SetThemeColorsArgsSchema, { presentationId: 'p', colors: { ACCENT1: 'BLUE' } }),
    'hex only',
  ],
  ['no theme colours', () => parse(SetThemeColorsArgsSchema, { presentationId: 'p', colors: {} }), 'at least one'],
  [
    'scheme lacks a colour',
    () => mergeColorScheme([{ type: 'DARK1', color: {} }], { ACCENT1: '#000' }),
    'has no ACCENT1',
  ],
  [
    'relayout refuses a slide with an image',
    () => sourcePlaceholders({ objectId: 's', pageElements: [{ objectId: 'img', image: {} }] }),
    '"img" (an image)',
  ],
  [
    'relayout refuses text without a target placeholder',
    () =>
      mapPlaceholders(
        [{ objectId: 'b', type: 'BODY', index: 0, text: {} }],
        [{ objectId: 't', type: 'TITLE', index: 0 }]
      ),
    '"b" (BODY)',
  ],

  [
    'crop missing a field',
    () => parse(CropImageArgsSchema, { presentationId: 'p', imageObjectId: 'i', crop: { x: 0, y: 0, width: 5 } }),
    'expected number',
  ],
  [
    'crop of zero width',
    () =>
      parse(CropImageArgsSchema, {
        presentationId: 'p',
        imageObjectId: 'i',
        crop: { x: 0, y: 0, width: 0, height: 5 },
      }),
    'Too small',
  ],
  [
    'negative crop origin',
    () =>
      parse(InsertImageArgsSchema, {
        presentationId: 'p',
        pageObjectId: 'g',
        imagePath: 'a.png',
        crop: { x: -1, y: 0, width: 5, height: 5 },
      }),
    'Too small',
  ],
  [
    'fractional crop',
    () =>
      parse(InsertImageArgsSchema, {
        presentationId: 'p',
        pageObjectId: 'g',
        imagePath: 'a.png',
        crop: { x: 0.5, y: 0, width: 5, height: 5 },
      }),
    'expected int',
  ],
  ['image info for nothing', () => parse(GetImageInfoArgsSchema, {}), 'exactly one image'],
  [
    'image info for two images',
    () => parse(GetImageInfoArgsSchema, { presentationId: 'p', imageObjectId: 'i', imagePath: 'a.png' }),
    'got 2',
  ],
  [
    'deck image info without a deck',
    () => parse(GetImageInfoArgsSchema, { imageObjectId: 'i' }),
    '"presentationId" is required',
  ],
  [
    'crop past the right edge',
    () => checkCropBox({ x: 50, y: 0, width: 60, height: 10 }, { width: 100, height: 40 }),
    'which is 100x40 pixels',
  ],
  [
    'crop past the bottom',
    () => checkCropBox({ x: 0, y: 30, width: 10, height: 11 }, { width: 100, height: 40 }),
    'get_image_info',
  ],
];

let bad = 0;
for (const [label, thunk, expected] of cases) {
  try {
    await thunk();
    console.log(`FAIL  ${label}: accepted when it should have been rejected`);
    bad += 1;
  } catch (error) {
    const ok = error.message.includes(expected);
    if (!ok) bad += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${error.message}`);
  }
}

// The field mask and the properties object come from one list, so they can never
// disagree. A path named in the mask with no value behind it resets that property
// to its default, which is why these assertions are the real regression test.
const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: got ${actual}, wanted ${expected}`);

const positives = [
  ['empty update emits no mask', () => assert.deepEqual(buildUpdate([]), { properties: {}, fields: '' })],
  [
    'an absent argument contributes neither a key nor a path',
    () =>
      assert.deepEqual(buildUpdate([leaf('a.b', 1), leaf('a.c', undefined)]), {
        properties: { a: { b: 1 } },
        fields: 'a.b',
      }),
  ],
  [
    'false is a supplied value, not an absent one',
    () => assert.equal(buildUpdate([leaf('bold', false)]).fields, 'bold'),
  ],
  [
    'sibling leaves merge into one branch and two paths',
    () =>
      assert.deepEqual(buildUpdate([leaf('outline.weight', points(2)), leaf('outline.dashStyle', 'SOLID')]), {
        properties: { outline: { weight: { magnitude: 2, unit: 'PT' }, dashStyle: 'SOLID' } },
        fields: 'outline.weight,outline.dashStyle',
      }),
  ],
  [
    'clearing a fill masks the property state, not the colour',
    () =>
      assert.equal(
        buildUpdate([leaf('shapeBackgroundFill.propertyState', 'NOT_RENDERED'), leaf('contentAlignment', 'MIDDLE')])
          .fields,
        'shapeBackgroundFill.propertyState,contentAlignment'
      ),
  ],
  [
    'long hex',
    () => {
      const { rgbColor } = parseColor('#3366CC');
      near(rgbColor.red, 0.2, 'red');
      near(rgbColor.green, 0.4, 'green');
      near(rgbColor.blue, 0.8, 'blue');
    },
  ],
  [
    'short hex doubles each digit',
    () => {
      const { rgbColor } = parseColor('#f0a');
      near(rgbColor.red, 1, 'red');
      near(rgbColor.green, 0, 'green');
      near(rgbColor.blue, 170 / 255, 'blue');
    },
  ],
  [
    'autofit NONE is the one value Google takes',
    () => assert.equal(autofitRequests('o', 'NONE')[0].updateShapeProperties.fields, 'autofit.autofitType'),
  ],
  [
    'text background clears to an empty OptionalColor',
    () =>
      assert.deepEqual(optionalColorLeaves('backgroundColor', 'NONE', true), [{ path: 'backgroundColor', value: {} }]),
  ],
  ['theme colours are case insensitive', () => assert.deepEqual(parseColor('accent1'), { themeColor: 'ACCENT1' })],
  [
    'a plain resize halves the scale and sends all six components',
    () => {
      const next = resizeTransform(
        { scaleX: 1, scaleY: 1, translateX: 100, translateY: 200, unit: 'EMU' },
        { width: pointsToEmu(300), height: pointsToEmu(150) },
        { width: pointsToEmu(150) }
      );
      near(next.scaleX, 0.5, 'scaleX');
      near(next.scaleY, 1, 'scaleY');
      assert.equal(next.translateX, 100);
      assert.equal(next.unit, 'EMU');
      assert.deepEqual(
        Object.keys(next).sort(),
        ['scaleX', 'scaleY', 'shearX', 'shearY', 'translateX', 'translateY', 'unit'].sort()
      );
    },
  ],
  [
    'a resize keeps a rotated element rotated',
    () => {
      const angle = Math.PI / 6;
      const current = {
        scaleX: Math.cos(angle),
        shearX: -Math.sin(angle),
        shearY: Math.sin(angle),
        scaleY: Math.cos(angle),
        translateX: 0,
        translateY: 0,
        unit: 'EMU',
      };
      const next = resizeTransform(current, { width: 1000, height: 1000 }, { width: 2000 });
      near((Math.atan2(next.shearY, next.scaleX) * 180) / Math.PI, 30, 'angle');
      near(axisScales(next).x, 2, 'x scale');
      near(axisScales(next).y, 1, 'y scale');
    },
  ],
  [
    'a degenerate axis is named rather than divided by',
    () => {
      assert.equal(resizeBlocker({ width: 1000, height: 0 }, { x: 1, y: 1 }, { height: 500 }), 'height');
      assert.equal(resizeBlocker({ width: 1000, height: 0 }, { x: 1, y: 1 }, { width: 500 }), undefined);
      assert.equal(resizeBlocker({ width: 1000, height: 1000 }, { x: 0, y: 1 }, { width: 500 }), 'width');
    },
  ],
  [
    'backup name is the title with a local timestamp',
    () => assert.equal(backupName('Talk', new Date(2026, 9, 3, 9, 5)), 'Talk (backup 2026-10-03 09:05)'),
  ],
  ['hex round trip', () => assert.equal(hexFromRgb(parseColor('#3366CC').rgbColor), '#3366CC')],
  [
    'merging a scheme keeps the colours not named',
    () => {
      const merged = mergeColorScheme(
        [
          { type: 'DARK1', color: { red: 0, green: 0, blue: 0 } },
          { type: 'ACCENT1', color: { red: 1, green: 0, blue: 0 } },
        ],
        { ACCENT1: '#00FF00' }
      );
      assert.deepEqual(merged[0], { type: 'DARK1', color: { red: 0, green: 0, blue: 0 } });
      assert.deepEqual(merged[1], { type: 'ACCENT1', color: { red: 0, green: 1, blue: 0 } });
    },
  ],
  [
    'a rotated square is bounded by its corners',
    () => {
      const angle = Math.PI / 4;
      const box = boundingBox(
        { width: 100, height: 100 },
        {
          scaleX: Math.cos(angle),
          shearX: -Math.sin(angle),
          shearY: Math.sin(angle),
          scaleY: Math.cos(angle),
          translateX: 0,
          translateY: 0,
          unit: 'EMU',
        }
      );
      near(box.width, 100 * Math.SQRT2, 'width');
      near(box.x, -100 / Math.SQRT2, 'x');
      near(box.y, 0, 'y');
    },
  ],
  [
    'align right lines up the right edges of the selection',
    () => {
      const boxes = [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 50, y: 0, width: 30, height: 10 },
      ];
      assert.deepEqual(alignDeltas(boxes, unionBox(boxes), 'right'), [
        { dx: 70, dy: 0 },
        { dx: 0, dy: 0 },
      ]);
    },
  ],
  [
    'distribute leaves the outer boxes and evens the gaps',
    () => {
      const boxes = [
        { x: 100, y: 0, width: 10, height: 5 },
        { x: 0, y: 0, width: 10, height: 5 },
        { x: 20, y: 0, width: 20, height: 5 },
      ];
      const deltas = distributeDeltas(boxes, 'horizontal');
      assert.equal(deltas[0].dx, 0);
      assert.equal(deltas[1].dx, 0);
      near(boxes[2].x + deltas[2].dx, 45, 'middle box x');
    },
  ],
  [
    'CENTERED_TITLE text lands in a TITLE, columns stay in order',
    () => {
      const text = {};
      const mapped = mapPlaceholders(
        [
          { objectId: 'ct', type: 'CENTERED_TITLE', index: 0, text },
          { objectId: 'b2', type: 'BODY', index: 2, text },
          { objectId: 'b1', type: 'BODY', index: 1, text },
        ],
        [
          { objectId: 'L_title', type: 'TITLE', index: 0 },
          { objectId: 'L_body1', type: 'BODY', index: 1 },
          { objectId: 'L_body2', type: 'BODY', index: 2 },
        ]
      );
      assert.deepEqual(
        mapped.map((item) => [item.sourceObjectId, item.layoutPlaceholderObjectId]),
        [
          ['ct', 'L_title'],
          ['b1', 'L_body1'],
          ['b2', 'L_body2'],
        ]
      );
    },
  ],
  [
    'relaid text keeps styles, nests bullets with tabs, drops the final newline',
    () => {
      const requests = textRequests('n', {
        textElements: [
          {
            startIndex: 0,
            endIndex: 4,
            paragraphMarker: { style: { alignment: 'START' }, bullet: { nestingLevel: 0, glyph: '●' } },
          },
          { startIndex: 0, endIndex: 4, textRun: { content: 'one\n', style: { bold: true } } },
          { startIndex: 4, endIndex: 8, paragraphMarker: { style: {}, bullet: { nestingLevel: 1, glyph: '○' } } },
          { startIndex: 4, endIndex: 8, textRun: { content: 'two\n', style: {} } },
        ],
      });
      assert.deepEqual(requests[0], { insertText: { objectId: 'n', text: 'one\n\ttwo', insertionIndex: 0 } });
      const bold = requests.find((r) => r.updateTextStyle);
      assert.deepEqual(bold.updateTextStyle.textRange, { type: 'FIXED_RANGE', startIndex: 0, endIndex: 4 });
      assert.equal(bold.updateTextStyle.fields, 'bold');
      const bullets = requests.filter((r) => r.createParagraphBullets);
      assert.equal(bullets.length, 1, 'neighbouring bullets merge into one list');
      assert.deepEqual(bullets[0].createParagraphBullets.textRange, {
        type: 'FIXED_RANGE',
        startIndex: 0,
        endIndex: 8,
      });
      assert.equal(requests.at(-1), bullets[0], 'bullets go last');
    },
  ],
  [
    'cropping to the left half halves the frame and keeps its left edge',
    () => {
      const box = croppedBox(
        {
          transform: { scaleX: 2, scaleY: 2, shearX: 0, shearY: 0, translateX: 1000, translateY: 500, unit: 'EMU' },
          intrinsic: { width: 100, height: 50 },
        },
        { width: 400, height: 200 },
        { x: 0, y: 0, width: 200, height: 200 }
      );
      assert.deepEqual(box, { width: 100, height: 100, x: 1000, y: 500 });
    },
  ],
  [
    'cropping off the left moves the frame right by what was removed',
    () => {
      const box = croppedBox(
        {
          transform: { scaleX: 2, scaleY: 2, translateX: 1000, translateY: 500, unit: 'EMU' },
          intrinsic: { width: 100, height: 50 },
        },
        { width: 400, height: 200 },
        { x: 100, y: 50, width: 300, height: 150 }
      );
      assert.deepEqual(box, { width: 150, height: 75, x: 1050, y: 525 });
    },
  ],
  [
    'a stretched frame stays stretched after Google refits the pixels',
    () => {
      // 200x135 frame over 64x48 pixels: wider than the pixels' own aspect.
      const before = {
        transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: 'EMU' },
        intrinsic: { width: 200, height: 135 },
      };
      const target = croppedBox(before, { width: 64, height: 48 }, { x: 0, y: 0, width: 32, height: 48 });
      // What replaceImage leaves: pixel-derived intrinsic size, refitted and re-centred.
      const after = {
        transform: { scaleX: 2.8125, scaleY: 2.8125, translateX: 5, translateY: 0, unit: 'EMU' },
        intrinsic: { width: 32, height: 48 },
      };
      const t = placeFrame(after, target);
      near(t.translateX, 0, 'x');
      near(t.scaleX * 32, 100, 'width');
      near(t.scaleY * 48, 135, 'height');
    },
  ],
  [
    'a rotated crop keeps its angle and moves along the rotated axis',
    () => {
      const a = Math.PI / 6;
      const rotated = {
        scaleX: Math.cos(a),
        shearX: -Math.sin(a),
        shearY: Math.sin(a),
        scaleY: Math.cos(a),
        translateX: 0,
        translateY: 0,
        unit: 'EMU',
      };
      const box = croppedBox(
        { transform: rotated, intrinsic: { width: 100, height: 100 } },
        { width: 10, height: 10 },
        { x: 5, y: 0, width: 5, height: 10 }
      );
      near(box.x, 50 * Math.cos(a), 'x');
      near(box.y, 50 * Math.sin(a), 'y');
      const t = placeFrame({ transform: rotated, intrinsic: { width: 100, height: 100 } }, box);
      near((Math.atan2(t.shearY, t.scaleX) * 180) / Math.PI, 30, 'angle');
      near(Math.hypot(t.scaleX, t.shearY) * 100, 50, 'width');
    },
  ],
  [
    'an editor crop is spotted, an empty one is not',
    () => {
      assert.equal(hasEditorCrop({ imageProperties: { cropProperties: { leftOffset: 0.1 } } }), true);
      assert.equal(hasEditorCrop({ imageProperties: { cropProperties: {} } }), false);
      assert.equal(hasEditorCrop({}), false);
    },
  ],
];

for (const [label, check] of positives) {
  try {
    check();
    console.log(`PASS  ${label}`);
  } catch (error) {
    bad += 1;
    console.log(`FAIL  ${label}: ${error.message}`);
  }
}

// sharp runs locally, so the crop itself is checked here too.
const sharp = (await import('sharp')).default;
const asyncPositives = [
  [
    'cropping a PNG keeps PNG and returns the box size',
    async () => {
      const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: '#336699' } })
        .png()
        .toBuffer();
      const out = await cropBytes(png, { x: 5, y: 5, width: 20, height: 10 });
      const info = await imageInfo(out);
      assert.deepEqual([info.format, info.width, info.height], ['png', 20, 10]);
    },
  ],
  [
    'cropping an animated GIF crops every frame',
    async () => {
      // Frames must differ, or the encoder merges identical ones into one.
      const raw = Buffer.alloc(20 * 30 * 3);
      raw.forEach((_, i) => (raw[i] = i % 3 === Math.floor(i / 600) ? 255 : 0));
      const gif = await sharp(raw, { raw: { width: 20, height: 30, channels: 3, pageHeight: 10 } })
        .gif()
        .toBuffer();
      const info = await imageInfo(await cropBytes(gif, { x: 2, y: 1, width: 8, height: 5 }));
      assert.deepEqual([info.format, info.width, info.height, info.frames], ['gif', 8, 5, 3]);
    },
  ],
];

for (const [label, check] of asyncPositives) {
  try {
    await check();
    console.log(`PASS  ${label}`);
  } catch (error) {
    bad += 1;
    console.log(`FAIL  ${label}: ${error.message}`);
  }
}

process.exit(bad === 0 ? 0 : 1);
