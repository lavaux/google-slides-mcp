import { z } from 'zod';
import { CropField, IMAGE_SOURCE_FIELDS, ImageSourceShape } from './schemas.js';

export const CropImageArgsSchema = z.object({
  presentationId: z.string().min(1, { error: '"presentationId" (string) is required.' }),
  imageObjectId: z.string().min(1, { error: '"imageObjectId" (string) is required.' }),
  crop: CropField,
});
export type CropImageArgs = z.infer<typeof CropImageArgsSchema>;

const INFO_TARGETS = ['imageObjectId', ...IMAGE_SOURCE_FIELDS];

const exactlyOneTarget = (value: Record<string, unknown>, ctx: z.RefinementCtx): void => {
  const provided = INFO_TARGETS.filter((field) => value[field] !== undefined);
  if (provided.length === 1) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    message:
      provided.length === 0
        ? `Provide exactly one image: imageObjectId for an image in the deck, or one of ${IMAGE_SOURCE_FIELDS.join(', ')}.`
        : `Provide exactly one image, got ${provided.length}: ${provided.join(', ')}.`,
  });
};

export const GetImageInfoArgsSchema = z
  .object({
    presentationId: z.string().min(1).optional(),
    imageObjectId: z.string().min(1).optional(),
    ...ImageSourceShape,
  })
  .superRefine(exactlyOneTarget)
  .superRefine((value, ctx) => {
    if (value.imageObjectId !== undefined && value.presentationId === undefined) {
      ctx.addIssue({ code: 'custom', message: '"presentationId" is required with "imageObjectId".' });
    }
  });
export type GetImageInfoArgs = z.infer<typeof GetImageInfoArgsSchema>;
