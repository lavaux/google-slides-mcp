import { z } from 'zod';

export const CreatePresentationArgsSchema = z.object({
  title: z.string().min(1, { error: '"title" (string) is required.' }),
});
export type CreatePresentationArgs = z.infer<typeof CreatePresentationArgsSchema>;

export const GetPresentationArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  fields: z.string().optional(),
});
export type GetPresentationArgs = z.infer<typeof GetPresentationArgsSchema>;

export const BatchUpdatePresentationArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  requests: z.array(z.unknown()).min(1, { error: '"requests" (array) is required.' }),
  writeControl: z.unknown().optional(),
});
export type BatchUpdatePresentationArgs = z.infer<typeof BatchUpdatePresentationArgsSchema>;

export const GetPageArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  pageObjectId: z.string().min(1, { error: '"pageObjectId" (string) is required.' }),
});
export type GetPageArgs = z.infer<typeof GetPageArgsSchema>;

export const SummarizePresentationArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  include_notes: z.boolean().optional(),
});
export type SummarizePresentationArgs = z.infer<typeof SummarizePresentationArgsSchema>;

const IMAGE_SOURCE_FIELDS = ['imageUrl', 'imagePath', 'imageBase64', 'driveFileId'] as const;

const ImageSourceShape = {
  imageUrl: z.string().min(1).optional(),
  imagePath: z.string().min(1).optional(),
  imageBase64: z.string().min(1).optional(),
  driveFileId: z.string().min(1).optional(),
};

// Flat mutually exclusive fields rather than a discriminated union, so the
// generated JSON schema stays simple for hosts that handle oneOf poorly.
const exactlyOneSource = (value: Record<string, unknown>, ctx: z.RefinementCtx): void => {
  const provided = IMAGE_SOURCE_FIELDS.filter((field) => value[field] !== undefined);
  if (provided.length === 1) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message:
      provided.length === 0
        ? `Provide exactly one image source: ${IMAGE_SOURCE_FIELDS.join(', ')}.`
        : `Provide exactly one image source, got ${provided.length}: ${provided.join(', ')}.`,
  });
};

export const InsertImageArgsSchema = z
  .object({
    presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
    pageObjectId: z.string().min(1, { error: '"pageObjectId" (string) is required.' }),
    ...ImageSourceShape,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    objectId: z.string().min(1).optional(),
    altText: z.string().optional(),
  })
  .superRefine(exactlyOneSource);
export type InsertImageArgs = z.infer<typeof InsertImageArgsSchema>;

export const ReplaceImageArgsSchema = z
  .object({
    presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
    imageObjectId: z.string().min(1, { error: '"imageObjectId" (string) is required.' }),
    ...ImageSourceShape,
    imageReplaceMethod: z.enum(['CENTER_INSIDE', 'CENTER_CROP']).optional(),
  })
  .superRefine(exactlyOneSource);
export type ReplaceImageArgs = z.infer<typeof ReplaceImageArgsSchema>;

export const GetPageThumbnailArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  pageObjectId: z.string().min(1, { error: '"pageObjectId" (string) is required.' }),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE', 'WIDTH2000_PX']).optional(),
});
export type GetPageThumbnailArgs = z.infer<typeof GetPageThumbnailArgsSchema>;

export const AddSlideArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  layout: z
    .enum([
      'BLANK',
      'CAPTION_ONLY',
      'TITLE',
      'TITLE_AND_BODY',
      'TITLE_AND_TWO_COLUMNS',
      'TITLE_ONLY',
      'SECTION_HEADER',
      'SECTION_TITLE_AND_DESCRIPTION',
      'ONE_COLUMN_TEXT',
      'MAIN_POINT',
      'BIG_NUMBER',
    ])
    .optional(),
  layoutObjectId: z.string().min(1).optional(),
  insertionIndex: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  subtitle: z.string().optional(),
});
export type AddSlideArgs = z.infer<typeof AddSlideArgsSchema>;

export const SetElementTextArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  objectId: z.string().min(1, { error: '"objectId" (string) is required.' }),
  text: z.string(),
  rowIndex: z.number().int().nonnegative().optional(),
  columnIndex: z.number().int().nonnegative().optional(),
});
export type SetElementTextArgs = z.infer<typeof SetElementTextArgsSchema>;

export const ReplaceAllTextArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  text: z.string().min(1, { error: '"text" (string) is required.' }),
  replaceText: z.string(),
  matchCase: z.boolean().optional(),
  searchByRegex: z.boolean().optional(),
  pageObjectIds: z.array(z.string().min(1)).optional(),
});
export type ReplaceAllTextArgs = z.infer<typeof ReplaceAllTextArgsSchema>;
