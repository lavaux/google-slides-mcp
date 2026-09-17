import { SetTextStyleArgsSchema, type SetTextStyleArgs } from '../schemas.js';
import {
  cellLocation,
  checkCell,
  ELEMENT_TREE_FIELDS,
  hasText,
  requireTextElement,
  textOf,
} from '../slides/elements.js';
import { points } from '../slides/geometry.js';
import { autofitRequests, buildUpdate, leaf, optionalColorLeaves } from '../slides/style.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const dimension = (value: number | undefined): slides_v1.Schema$Dimension | undefined =>
  value === undefined ? undefined : points(value);

const textUpdate = (args: SetTextStyleArgs) =>
  buildUpdate([
    leaf('bold', args.bold),
    leaf('italic', args.italic),
    leaf('underline', args.underline),
    leaf('strikethrough', args.strikethrough),
    leaf('smallCaps', args.smallCaps),
    leaf('fontFamily', args.fontFamily),
    leaf('fontSize', dimension(args.fontSize)),
    leaf('baselineOffset', args.baselineOffset),
    leaf('link.url', args.linkUrl),
    ...optionalColorLeaves('foregroundColor', args.foregroundColor, false),
    ...optionalColorLeaves('backgroundColor', args.backgroundColor, true),
  ]);

const paragraphUpdate = (args: SetTextStyleArgs) =>
  buildUpdate([
    leaf('alignment', args.alignment),
    leaf('direction', args.direction),
    leaf('spacingMode', args.spacingMode),
    leaf('lineSpacing', args.lineSpacing),
    leaf('spaceAbove', dimension(args.spaceAbove)),
    leaf('spaceBelow', dimension(args.spaceBelow)),
    leaf('indentStart', dimension(args.indentStart)),
    leaf('indentEnd', dimension(args.indentEnd)),
    leaf('indentFirstLine', dimension(args.indentFirstLine)),
  ]);

const textRange = (args: SetTextStyleArgs): slides_v1.Schema$Range => {
  if (args.startIndex === undefined) {
    return { type: 'ALL' };
  }
  if (args.endIndex === undefined) {
    return { type: 'FROM_START_INDEX', startIndex: args.startIndex };
  }
  return { type: 'FIXED_RANGE', startIndex: args.startIndex, endIndex: args.endIndex };
};

const buildRequests = (args: SetTextStyleArgs): slides_v1.Schema$Request[] => {
  const location = cellLocation(args);
  const target = { objectId: args.objectId, ...(location === undefined ? {} : { cellLocation: location }) };
  const range = textRange(args);
  const text = textUpdate(args);
  const paragraph = paragraphUpdate(args);
  return [
    ...(text.fields === ''
      ? []
      : [{ updateTextStyle: { ...target, style: { ...text.properties }, fields: text.fields, textRange: range } }]),
    ...(paragraph.fields === ''
      ? []
      : [
          {
            updateParagraphStyle: {
              ...target,
              style: { ...paragraph.properties },
              fields: paragraph.fields,
              textRange: range,
            },
          },
        ]),
    ...autofitRequests(args.objectId, args.autofit),
  ];
};

const handler = async ({ slides }: GoogleClients, args: SetTextStyleArgs): Promise<unknown> => {
  // Built first so a bad colour fails locally, before a round-trip.
  const requests = buildRequests(args);
  if (requests.length === 0) {
    return { objectId: args.objectId, changed: false };
  }
  const presentation = await slides.presentations.get({
    presentationId: args.presentationId,
    fields: ELEMENT_TREE_FIELDS,
  });
  const located = requireTextElement(presentation.data, args.objectId);
  const location = cellLocation(args);
  checkCell(located, location);
  if (!hasText(textOf(located.element, location))) {
    throw new Error(`Object id "${args.objectId}" has no text to style. Set its text first with set_element_text.`);
  }
  await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: { requests },
  });
  return { objectId: args.objectId, changed: true, requests: requests.length };
};

export const setTextStyle: ToolModule<SetTextStyleArgs> = {
  name: 'set_text_style',
  schema: SetTextStyleArgsSchema,
  handler,
  descriptor: {
    description:
      'Style the text of a shape, placeholder or table cell: font family and size, bold, italic, underline, strikethrough, small caps, baseline offset, colours, hyperlink, and the paragraph settings alignment, line spacing, space above and below, and the three indents. Only the properties you pass are touched. Sizes, spacing and indents are in points; lineSpacing is a percentage where 100 is normal. Pass rowIndex and columnIndex together for a table cell, and startIndex or endIndex to style part of the text. backgroundColor accepts NONE to clear it; foregroundColor does not, because Slides has no transparent text. Pass autofit NONE here to turn text fitting off in the same call.',
  },
};
