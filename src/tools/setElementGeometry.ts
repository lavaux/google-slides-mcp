import { SetElementGeometryArgsSchema, type SetElementGeometryArgs } from '../schemas.js';
import { ELEMENT_TREE_FIELDS, requireLocated, type Located } from '../slides/elements.js';
import {
  axisScales,
  pointsToEmu,
  readEmu,
  resizeBlocker,
  resizeTransform,
  toPointsRounded,
  visualSize,
  type Size,
  type TargetBox,
} from '../slides/geometry.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const emu = (value: number | undefined): number | undefined => (value === undefined ? undefined : pointsToEmu(value));

const targetBox = (args: SetElementGeometryArgs): TargetBox => ({
  width: emu(args.width),
  height: emu(args.height),
  x: emu(args.x),
  y: emu(args.y),
});

const isEmpty = (target: TargetBox): boolean =>
  target.width === undefined && target.height === undefined && target.x === undefined && target.y === undefined;

const intrinsicSize = (located: Located): Size => ({
  width: readEmu(located.element.size?.width) ?? 0,
  height: readEmu(located.element.size?.height) ?? 0,
});

/**
 * A group child's transform is relative to its group, so an ABSOLUTE write would
 * be composed with the group's own transform and land the element somewhere
 * unrelated to what was asked.
 */
const refuseGroupChild = (located: Located, objectId: string): void => {
  if (located.ancestors.length === 0) {
    return;
  }
  throw new Error(
    `Object id "${objectId}" is inside group "${located.ancestors.at(-1)}". A group child's position is relative to its group. Target the group itself, or ungroup first.`
  );
};

const refuseDegenerate = (located: Located, intrinsic: Size, target: TargetBox): void => {
  const axis = resizeBlocker(intrinsic, axisScales(located.element.transform ?? {}), target);
  if (axis === undefined) {
    return;
  }
  throw new Error(
    `Object id "${located.element.objectId}" has no ${axis} to scale, so it cannot be resized along that axis. Lines are the usual case. Move it instead, or use batch_update_presentation with a RELATIVE updatePageElementTransform.`
  );
};

const resultBox = (intrinsic: Size, transform: slides_v1.Schema$AffineTransform) => {
  const size = visualSize(intrinsic, transform);
  return {
    x: toPointsRounded(transform.translateX ?? 0),
    y: toPointsRounded(transform.translateY ?? 0),
    width: toPointsRounded(size.width),
    height: toPointsRounded(size.height),
  };
};

const handler = async ({ slides }: GoogleClients, args: SetElementGeometryArgs): Promise<unknown> => {
  const target = targetBox(args);
  if (isEmpty(target)) {
    return { objectId: args.objectId, changed: false };
  }
  const presentation = await slides.presentations.get({
    presentationId: args.presentationId,
    fields: ELEMENT_TREE_FIELDS,
  });
  const located = requireLocated(presentation.data, args.objectId);
  refuseGroupChild(located, args.objectId);
  const intrinsic = intrinsicSize(located);
  refuseDegenerate(located, intrinsic, target);
  const transform = resizeTransform(located.element.transform ?? {}, intrinsic, target);
  await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: {
      requests: [{ updatePageElementTransform: { objectId: args.objectId, applyMode: 'ABSOLUTE', transform } }],
    },
  });
  return { objectId: args.objectId, changed: true, ...resultBox(intrinsic, transform) };
};

export const setElementGeometry: ToolModule<SetElementGeometryArgs> = {
  name: 'set_element_geometry',
  schema: SetElementGeometryArgsSchema,
  handler,
  descriptor: {
    description:
      'Move or resize a page element. All four values are in points and any you omit keeps its current value. The API has no resize request, so this reads the element and rewrites its whole transform; a rotated element keeps its angle. Position is the anchor Slides stores, which for a rotated element is not the top-left of its visible bounding box. An element inside a group is refused, because its position is relative to the group. Run list_page_elements to find object ids.',
  },
};
