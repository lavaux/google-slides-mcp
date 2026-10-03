import { ArrangeElementsArgsSchema, type ArrangeElementsArgs } from '../layoutSchemas.js';
import { alignDeltas, distributeDeltas, unionBox, visibleBox, type Delta } from '../slides/arrange.js';
import {
  describeKind,
  ELEMENT_TREE_FIELDS,
  refuseGroupChild,
  requireLocated,
  type Located,
} from '../slides/elements.js';
import { readPageSize, toPointsRounded, type Box } from '../slides/geometry.js';
import { shortId } from '../slides/ids.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

type Presentation = slides_v1.Schema$Presentation;

const locateAll = (presentation: Presentation, args: ArrangeElementsArgs): Located[] => {
  const located = [...new Set(args.objectIds)].map((objectId) => requireLocated(presentation, objectId));
  const pages = [...new Set(located.map((item) => item.pageObjectId))];
  if (pages.length > 1) {
    throw new Error(
      `The elements sit on ${pages.length} different pages (${pages.join(', ')}). They must all be on one page.`
    );
  }
  // Ungrouping takes groups wherever they are. Every other action moves or
  // regroups top-level elements, which a group child is not.
  if (args.action !== 'ungroup') {
    located.forEach(refuseGroupChild);
  }
  return located;
};

const pageBox = (presentation: Presentation): Box => {
  const size = readPageSize(presentation);
  if (!size) {
    throw new Error('The presentation did not report a page size, so elements cannot be aligned to the page.');
  }
  return { x: 0, y: 0, ...size };
};

/** A RELATIVE translation moves the element and leaves its rotation and scale alone. */
const translation = (objectId: string, delta: Delta): slides_v1.Schema$Request[] => {
  const dx = Math.round(delta.dx);
  const dy = Math.round(delta.dy);
  if (dx === 0 && dy === 0) {
    return [];
  }
  return [
    {
      updatePageElementTransform: {
        objectId,
        applyMode: 'RELATIVE',
        transform: { scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, translateX: dx, translateY: dy, unit: 'EMU' },
      },
    },
  ];
};

const report = (located: Located[], boxes: Box[], deltas: Delta[]) =>
  located.map((item, index) => ({
    objectId: item.element.objectId,
    x: toPointsRounded(boxes[index].x + deltas[index].dx),
    y: toPointsRounded(boxes[index].y + deltas[index].dy),
  }));

type Plan = { requests: slides_v1.Schema$Request[]; result: Record<string, unknown> };

const movePlan = (located: Located[], boxes: Box[], deltas: Delta[]): Plan => ({
  requests: located.flatMap((item, index) => translation(item.element.objectId ?? '', deltas[index])),
  result: { elements: report(located, boxes, deltas) },
});

const align = (presentation: Presentation, args: ArrangeElementsArgs, located: Located[]): Plan => {
  const boxes = located.map((item) => visibleBox(item.element));
  const reference = args.relativeTo === 'page' ? pageBox(presentation) : unionBox(boxes);
  return movePlan(located, boxes, alignDeltas(boxes, reference, args.edge ?? 'left'));
};

const distribute = (_: Presentation, args: ArrangeElementsArgs, located: Located[]): Plan => {
  const boxes = located.map((item) => visibleBox(item.element));
  return movePlan(located, boxes, distributeDeltas(boxes, args.axis ?? 'horizontal'));
};

const zOrder = (_: Presentation, args: ArrangeElementsArgs, located: Located[]): Plan => ({
  requests: [
    {
      updatePageElementsZOrder: {
        pageElementObjectIds: located.map((item) => item.element.objectId ?? ''),
        operation: args.operation,
      },
    },
  ],
  result: {},
});

const group = (_: Presentation, args: ArrangeElementsArgs, located: Located[]): Plan => {
  const groupObjectId = args.groupObjectId ?? shortId('group');
  return {
    requests: [
      { groupObjects: { groupObjectId, childrenObjectIds: located.map((item) => item.element.objectId ?? '') } },
    ],
    result: { groupObjectId },
  };
};

const ungroup = (_: Presentation, __: ArrangeElementsArgs, located: Located[]): Plan => {
  const notGroups = located.filter((item) => item.kind !== 'group');
  if (notGroups.length > 0) {
    throw new Error(
      `Only groups can be ungrouped, and ${notGroups.map((item) => `"${item.element.objectId}" is ${describeKind(item.kind)}`).join(', ')}.`
    );
  }
  return {
    requests: [{ ungroupObjects: { objectIds: located.map((item) => item.element.objectId ?? '') } }],
    result: {
      released: located.flatMap((item) => item.element.elementGroup?.children?.map((child) => child.objectId) ?? []),
    },
  };
};

const ACTIONS = { align, distribute, z_order: zOrder, group, ungroup };

const handler = async ({ slides }: GoogleClients, args: ArrangeElementsArgs): Promise<unknown> => {
  const presentation = (
    await slides.presentations.get({ presentationId: args.presentationId, fields: ELEMENT_TREE_FIELDS })
  ).data;
  const located = locateAll(presentation, args);
  const plan = ACTIONS[args.action](presentation, args, located);
  if (plan.requests.length > 0) {
    await slides.presentations.batchUpdate({
      presentationId: args.presentationId,
      requestBody: { requests: plan.requests },
    });
  }
  return { action: args.action, changed: plan.requests.length > 0, ...plan.result };
};

export const arrangeElements: ToolModule<ArrangeElementsArgs> = {
  name: 'arrange_elements',
  schema: ArrangeElementsArgsSchema,
  handler,
  descriptor: {
    description:
      'Arrange elements that sit on one page. action "align": lines up objectIds on an edge (left, right, top, bottom) or a centre line (center, middle), relative to the selection\'s bounding box or to the page. "distribute": spaces 3 or more objectIds with equal gaps along an axis, keeping the outermost two in place. "z_order": brings forward or sends back with operation. "group": groups 2 or more objectIds and returns the group id. "ungroup": dissolves the groups named in objectIds. Positions use the visible bounding box, so rotated elements line up by what is seen, and moves keep rotation and size. Group members are refused, except by ungroup; target the group instead. Run list_page_elements to find object ids.',
  },
};
