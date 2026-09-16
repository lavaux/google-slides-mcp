#!/usr/bin/env node
// Checks that bad input fails locally with a message naming the real constraint,
// instead of Google's single opaque error. Makes no Google calls.
import { validateImageBytes } from '../build/images/validate.js';

const cases = [
  ['WebP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), 'PNG, JPEG and GIF only'],
  ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'PNG, JPEG and GIF only'],
  [
    'oversized pixels',
    (() => {
      const b = Buffer.alloc(64);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
      b.writeUInt32BE(10000, 16);
      b.writeUInt32BE(10000, 20);
      return b;
    })(),
    '25 megapixels',
  ],
];

let bad = 0;
for (const [label, bytes, expected] of cases) {
  try {
    validateImageBytes(bytes);
    console.log(`FAIL  ${label}: accepted when it should have been rejected`);
    bad += 1;
  } catch (error) {
    const ok = error.message.includes(expected);
    if (!ok) bad += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${error.message}`);
  }
}
process.exit(bad === 0 ? 0 : 1);
