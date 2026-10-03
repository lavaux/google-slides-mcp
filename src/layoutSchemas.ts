import { z } from 'zod';
import { ColorField, IMAGE_SOURCE_FIELDS, ImageSourceShape, PredefinedLayoutField } from './schemas.js';

/** Names, per action, the arguments that action cannot run without. */
const requireFor = (
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  rules: Partial<Record<string, { fields: string[]; hint: string }>>
): void => {
  const rule = rules[String(value.action)];
  if (rule === undefined) {
    return;
  }
  const missing = rule.fields.filter((field) => value[field] === undefined);
  if (missing.length === 0) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message: `Action "${String(value.action)}" needs ${missing.map((field) => `"${field}"`).join(' and ')}. ${rule.hint}`,
  });
};

const SLIDE_RULES = {
  move: {
    fields: ['slideObjectIds', 'insertionIndex'],
    hint: 'Pass the slides to move and the index to move them to.',
  },
  duplicate: { fields: ['slideObjectId'], hint: 'Pass the slide to duplicate.' },
  delete: { fields: ['slideObjectIds'], hint: 'Pass the slides to delete.' },
  relayout: { fields: ['slideObjectId'], hint: 'Pass the slide, and "layout" or "layoutObjectId" for its new layout.' },
};

const layoutChosen = (value: Record<string, unknown>, ctx: z.RefinementCtx): void => {
  if (value.action !== 'relayout' || value.layout !== undefined || value.layoutObjectId !== undefined) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message: 'Action "relayout" needs "layout" (a predefined layout) or "layoutObjectId" (an id from list_layouts).',
  });
};

export const ManageSlidesArgsSchema = z
  .object({
    presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
    action: z.enum(['move', 'duplicate', 'delete', 'relayout']),
    slideObjectId: z.string().min(1).optional(),
    slideObjectIds: z.array(z.string().min(1)).min(1).optional(),
    insertionIndex: z.number().int().nonnegative().optional(),
    layout: PredefinedLayoutField.optional(),
    layoutObjectId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    requireFor(value, ctx, SLIDE_RULES);
    layoutChosen(value, ctx);
  });
export type ManageSlidesArgs = z.infer<typeof ManageSlidesArgsSchema>;

const MIN_DISTRIBUTED = 3;
const MIN_GROUPED = 2;

const ARRANGE_RULES = {
  align: { fields: ['edge'], hint: 'Pass the edge or centre line to align on.' },
  distribute: { fields: ['axis'], hint: 'Pass "horizontal" or "vertical".' },
  z_order: { fields: ['operation'], hint: 'Pass the z-order operation.' },
};

const enoughElements = (
  value: { action: string; objectIds: string[]; relativeTo?: string | undefined },
  ctx: z.RefinementCtx
): void => {
  const count = value.objectIds.length;
  const problem =
    value.action === 'distribute' && count < MIN_DISTRIBUTED
      ? `Action "distribute" needs at least ${MIN_DISTRIBUTED} elements, got ${count}.`
      : value.action === 'group' && count < MIN_GROUPED
        ? `Action "group" needs at least ${MIN_GROUPED} elements, got ${count}.`
        : value.action === 'align' && count === 1 && value.relativeTo !== 'page'
          ? 'Aligning a single element needs relativeTo "page": a selection of one is already aligned with itself.'
          : undefined;
  if (problem !== undefined) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
};

export const ArrangeElementsArgsSchema = z
  .object({
    presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
    action: z.enum(['align', 'distribute', 'z_order', 'group', 'ungroup']),
    objectIds: z.array(z.string().min(1)).min(1, { error: '"objectIds" needs at least one object id.' }),
    edge: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']).optional(),
    relativeTo: z.enum(['selection', 'page']).optional(),
    axis: z.enum(['horizontal', 'vertical']).optional(),
    operation: z.enum(['BRING_TO_FRONT', 'BRING_FORWARD', 'SEND_BACKWARD', 'SEND_TO_BACK']).optional(),
    groupObjectId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    requireFor(value, ctx, ARRANGE_RULES);
    enoughElements(value, ctx);
  });
export type ArrangeElementsArgs = z.infer<typeof ArrangeElementsArgsSchema>;

const exactlyOneBackground = (value: Record<string, unknown>, ctx: z.RefinementCtx): void => {
  const provided = ['color', ...IMAGE_SOURCE_FIELDS, 'inherit'].filter(
    (field) => value[field] !== undefined && value[field] !== false
  );
  if (provided.length === 1) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message:
      provided.length === 0
        ? `Provide exactly one background: color, inherit, or one image source (${IMAGE_SOURCE_FIELDS.join(', ')}).`
        : `Provide exactly one background, got ${provided.length}: ${provided.join(', ')}.`,
  });
};

export const SetPageBackgroundArgsSchema = z
  .object({
    presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
    pageObjectId: z.string().min(1, { error: '"pageObjectId" (string) is required.' }),
    color: ColorField.optional(),
    ...ImageSourceShape,
    inherit: z.boolean().optional(),
  })
  .superRefine(exactlyOneBackground);
export type SetPageBackgroundArgs = z.infer<typeof SetPageBackgroundArgsSchema>;

export const THEME_COLOR_TYPES = [
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
] as const;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const SetThemeColorsArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  masterObjectId: z.string().min(1).optional(),
  colors: z
    .partialRecord(
      z.enum(THEME_COLOR_TYPES),
      z.string().regex(HEX_COLOR, { error: 'Theme colours are hex only: #RRGGBB or #RGB.' })
    )
    .refine((colors) => Object.keys(colors).length > 0, { error: '"colors" needs at least one theme colour.' }),
});
export type SetThemeColorsArgs = z.infer<typeof SetThemeColorsArgsSchema>;
