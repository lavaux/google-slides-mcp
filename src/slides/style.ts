import type { slides_v1 } from 'googleapis';

const HEX_SHORT_LENGTH = 4;
const HEX_RADIX = 16;
const MAX_CHANNEL = 255;
const SHORT_STEP = 1;
const LONG_STEP = 2;
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The sentinel a caller passes to clear a fill or an outline instead of colouring it. */
export const COLOR_NONE = 'NONE';

const THEME_COLORS = new Set([
  'DARK1',
  'LIGHT1',
  'DARK2',
  'LIGHT2',
  'ACCENT1',
  'ACCENT2',
  'ACCENT3',
  'ACCENT4',
  'ACCENT5',
  'ACCENT6',
  'HYPERLINK',
  'FOLLOWED_HYPERLINK',
]);

const channel = (hex: string, start: number, step: number): number => {
  const digits = hex.slice(start, start + step);
  const expanded = step === SHORT_STEP ? `${digits}${digits}` : digits;
  return Number.parseInt(expanded, HEX_RADIX) / MAX_CHANNEL;
};

const rgbFromHex = (hex: string): slides_v1.Schema$RgbColor => {
  const step = hex.length === HEX_SHORT_LENGTH ? SHORT_STEP : LONG_STEP;
  return {
    red: channel(hex, 1, step),
    green: channel(hex, 1 + step, step),
    blue: channel(hex, 1 + step * 2, step),
  };
};

/**
 * Google reports every bad colour with one opaque 400, so the accepted forms are
 * named here instead. `NONE` is not a colour: the calling tool branches on it
 * before reaching this function, because clearing a fill is a property state and
 * not a value.
 */
export const parseColor = (value: string): slides_v1.Schema$OpaqueColor => {
  const themeColor = value.toUpperCase();
  if (THEME_COLORS.has(themeColor)) {
    return { themeColor };
  }
  if (HEX_PATTERN.test(value)) {
    return { rgbColor: rgbFromHex(value) };
  }
  throw new Error(
    `Colour "${value}" is not usable. Pass #RRGGBB or #RGB, one of ${[...THEME_COLORS].join(', ')}, or NONE to clear.`
  );
};

export type Leaf = { path: string; value: unknown };

export const leaf = (path: string, value: unknown): Leaf | undefined =>
  value === undefined ? undefined : { path, value };

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null;

// A path always splits to at least one segment, so segments is never empty.
const graft = (tree: Tree, segments: string[], value: unknown): Tree => {
  const head = segments[0];
  const rest = segments.slice(1);
  if (rest.length === 0) {
    return { ...tree, [head]: value };
  }
  const child = tree[head];
  return { ...tree, [head]: graft(isTree(child) ? child : {}, rest, value) };
};

export type Update = { properties: object; fields: string };

/**
 * Builds an update's properties object and its field mask from one list, so the
 * mask can never name a path the properties object does not carry.
 *
 * That invariant is the whole point. Google treats a path named in the mask whose
 * value is unset as "reset this property to its default", so a mask assembled
 * separately from the payload wipes formatting instead of failing.
 *
 * The properties object stays typed as `object`. It is built from string paths,
 * which TypeScript cannot relate to a schema type, so a caller spreads it into the
 * request field it belongs to, the same widening `batch_update_presentation` does.
 */
export const buildUpdate = (leaves: (Leaf | undefined)[]): Update => {
  const present = leaves.filter((item): item is Leaf => item !== undefined);
  const properties = present.reduce<Tree>((tree, item) => graft(tree, item.path.split('.'), item.value), {});
  return { properties, fields: present.map((item) => item.path).join(',') };
};

/**
 * Autofit always travels as its own trailing request.
 *
 * Any request that may affect text fitting resets autofitType to NONE, so an
 * autofit written in the same properties object as a fill or a font size would be
 * undone by its own batch.
 *
 * The mask path is `autofit.autofitType`. The bare `autofitType` that looks right
 * is rejected with "Invalid field: autofit_type", and fontScale and
 * lineSpacingReduction are read-only.
 *
 * Only NONE is accepted as a value. Google rejects TEXT_AUTOFIT and SHAPE_AUTOFIT
 * on every shape, placeholder or not, so the constraint is named here rather than
 * left to a failed batch.
 */
export const autofitRequests = (objectId: string, autofitType: string | undefined): slides_v1.Schema$Request[] => {
  if (autofitType === undefined) {
    return [];
  }
  if (autofitType !== 'NONE') {
    throw new Error(
      `Google accepts only autofit NONE through the API, not ${autofitType}. Shrink-text-on-overflow and resize-shape-to-fit can be chosen in the Slides editor but cannot be set through this interface. To make text fit, set fontSize or lineSpacing with set_text_style, or resize the shape with set_element_geometry.`
    );
  }
  return [
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: { autofit: { autofitType } },
        fields: 'autofit.autofitType',
      },
    },
  ];
};

/**
 * Text colours are OptionalColor, not the SolidFill that shapes use, so they wrap
 * in `opaqueColor` and clear to an empty object rather than to a property state.
 *
 * Only the background clears. Google rejects a transparent foreground outright,
 * so that one is refused here with the alternative named.
 */
export const optionalColorLeaves = (
  path: string,
  value: string | undefined,
  allowTransparent: boolean
): (Leaf | undefined)[] => {
  if (value === undefined) {
    return [];
  }
  if (value !== COLOR_NONE) {
    return [leaf(`${path}.opaqueColor`, parseColor(value))];
  }
  if (!allowTransparent) {
    throw new Error(
      `Slides does not support transparent text, so "${path}" cannot be NONE. Pass a colour, or change what sits behind the text with set_shape_properties.`
    );
  }
  return [leaf(path, {})];
};
