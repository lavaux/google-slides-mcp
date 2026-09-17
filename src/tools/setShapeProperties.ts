import { SetShapePropertiesArgsSchema, type SetShapePropertiesArgs } from '../schemas.js';
import { ELEMENT_TREE_FIELDS, requireShape } from '../slides/elements.js';
import { points } from '../slides/geometry.js';
import { autofitRequests, buildUpdate, COLOR_NONE, leaf, parseColor, type Leaf } from '../slides/style.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

/**
 * Clearing is a property state, not a colour, so NONE takes its own branch.
 * Both branches write leaf paths. Masking the parent `shapeBackgroundFill` would
 * reset the alpha and the property state the caller never mentioned.
 */
const fillLeaves = (value: string | undefined): (Leaf | undefined)[] => {
  if (value === undefined) {
    return [];
  }
  if (value === COLOR_NONE) {
    return [leaf('shapeBackgroundFill.propertyState', 'NOT_RENDERED')];
  }
  return [
    leaf('shapeBackgroundFill.solidFill.color', parseColor(value)),
    leaf('shapeBackgroundFill.propertyState', 'RENDERED'),
  ];
};

const outlineColorLeaves = (value: string | undefined): (Leaf | undefined)[] => {
  if (value === undefined) {
    return [];
  }
  if (value === COLOR_NONE) {
    return [leaf('outline.propertyState', 'NOT_RENDERED')];
  }
  return [leaf('outline.outlineFill.solidFill.color', parseColor(value)), leaf('outline.propertyState', 'RENDERED')];
};

const appearance = (args: SetShapePropertiesArgs) =>
  buildUpdate([
    leaf('contentAlignment', args.contentAlignment),
    ...fillLeaves(args.backgroundColor),
    ...outlineColorLeaves(args.outlineColor),
    leaf('outline.weight', args.outlineWeight === undefined ? undefined : points(args.outlineWeight)),
    leaf('outline.dashStyle', args.outlineDashStyle),
    leaf('link.url', args.linkUrl),
  ]);

const buildRequests = (args: SetShapePropertiesArgs): slides_v1.Schema$Request[] => {
  const update = appearance(args);
  const shaped =
    update.fields === ''
      ? []
      : [
          {
            updateShapeProperties: {
              objectId: args.objectId,
              shapeProperties: { ...update.properties },
              fields: update.fields,
            },
          },
        ];
  return [...shaped, ...autofitRequests(args.objectId, args.autofit)];
};

const masksOf = (requests: slides_v1.Schema$Request[]): string[] =>
  requests.flatMap((request) => {
    const fields = request.updateShapeProperties?.fields;
    return fields === undefined || fields === null ? [] : [fields];
  });

const handler = async ({ slides }: GoogleClients, args: SetShapePropertiesArgs): Promise<unknown> => {
  // Built first so a bad colour fails locally, before a round-trip.
  const requests = buildRequests(args);
  if (requests.length === 0) {
    return { objectId: args.objectId, changed: false };
  }
  const presentation = await slides.presentations.get({
    presentationId: args.presentationId,
    fields: ELEMENT_TREE_FIELDS,
  });
  requireShape(presentation.data, args.objectId);
  await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: { requests },
  });
  return { objectId: args.objectId, changed: true, fields: masksOf(requests) };
};

export const setShapeProperties: ToolModule<SetShapePropertiesArgs> = {
  name: 'set_shape_properties',
  schema: SetShapePropertiesArgsSchema,
  handler,
  descriptor: {
    description:
      'Change a shape or placeholder: text fitting (autofit), vertical content alignment, background fill, outline colour, weight and dash style, and its hyperlink. Only the properties you pass are touched. Colours are #RRGGBB, a theme name such as ACCENT1, or NONE to clear a fill or outline. Outline weight is in points. Autofit accepts only NONE: Google rejects TEXT_AUTOFIT and SHAPE_AUTOFIT through the API, so shrink-to-fit can only be chosen in the Slides editor. Setting NONE bakes in the current scaling and stops the text resizing itself.',
  },
};
