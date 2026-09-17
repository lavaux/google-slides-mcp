#!/usr/bin/env node
// Checks that bad input fails locally with a message naming the real constraint,
// instead of Google's single opaque error, and that the pure helpers the styling
// tools are built on produce exactly what they claim. Makes no Google calls.
import assert from 'node:assert/strict';
import { validateImageBytes } from '../build/images/validate.js';
import {
  ListPageElementsArgsSchema,
  SetElementGeometryArgsSchema,
  SetElementTextArgsSchema,
  SetShapePropertiesArgsSchema,
  SetTextStyleArgsSchema,
} from '../build/schemas.js';
import { axisScales, points, pointsToEmu, resizeBlocker, resizeTransform } from '../build/slides/geometry.js';
import { autofitRequests, buildUpdate, leaf, optionalColorLeaves, parseColor } from '../build/slides/style.js';

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

process.exit(bad === 0 ? 0 : 1);
