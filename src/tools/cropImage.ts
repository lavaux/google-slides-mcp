import { checkCropBox, cropBytes, imageInfo } from '../images/crop.js';
import { downloadImageUrl } from '../images/download.js';
import { stageImage } from '../images/stage.js';
import { CropImageArgsSchema, type CropImageArgs } from '../imageSchemas.js';
import { croppedBox, hasEditorCrop, placeFrame, type Frame, type FrameBox } from '../slides/cropFrame.js';
import { ELEMENT_TREE_FIELDS, refuseGroupChild, requireImage, type Located } from '../slides/elements.js';
import { readEmu } from '../slides/geometry.js';
import { frameBox } from './getImageInfo.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const STAGED_NAME = 'google-slides-mcp-staged-crop';

const refuseEditorCrop = (located: Located): void => {
  if (!hasEditorCrop(located.element.image ?? undefined)) {
    return;
  }
  throw new Error(
    `Image "${located.element.objectId}" already carries a crop made in the Slides editor, which the API can neither read back as pixels nor change. Reset it in the editor (Format options, or double-click the image and choose Reset image), then crop here.`
  );
};

const frameOf = (located: Located): Frame => ({
  transform: located.element.transform ?? {},
  intrinsic: {
    width: readEmu(located.element.size?.width) ?? 0,
    height: readEmu(located.element.size?.height) ?? 0,
  },
});

type Placement = { slides: slides_v1.Slides; presentationId: string; imageObjectId: string; target: FrameBox };

/**
 * The second batch. replaceImage has already reset the intrinsic size to the new
 * pixels, so the transform can only be computed once that size is read back.
 */
const place = async ({ slides, presentationId, imageObjectId, target }: Placement) => {
  const presentation = (await slides.presentations.get({ presentationId, fields: ELEMENT_TREE_FIELDS })).data;
  const after = frameOf(requireImage(presentation, imageObjectId));
  const transform = placeFrame(after, target);
  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [{ updatePageElementTransform: { objectId: imageObjectId, applyMode: 'ABSOLUTE', transform } }],
    },
  });
  return frameBox({
    size: {
      width: { magnitude: after.intrinsic.width, unit: 'EMU' },
      height: { magnitude: after.intrinsic.height, unit: 'EMU' },
    },
    transform,
  });
};

/**
 * Crops the pixels locally and swaps them in, because the API treats an image's
 * crop as read-only. The frame is then rewritten so the pixels that stay keep
 * their place and scale, including on an image that had been stretched.
 */
const handler = async ({ slides, drive }: GoogleClients, args: CropImageArgs): Promise<unknown> => {
  const presentation = (
    await slides.presentations.get({ presentationId: args.presentationId, fields: ELEMENT_TREE_FIELDS })
  ).data;
  const located = requireImage(presentation, args.imageObjectId);
  refuseGroupChild(located);
  refuseEditorCrop(located);
  const bytes = await downloadImageUrl(located.element.image?.contentUrl ?? '');
  const source = await imageInfo(bytes);
  checkCropBox(args.crop, source);
  const target = croppedBox(frameOf(located), source, args.crop);
  const staged = await stageImage(drive, await cropBytes(bytes, args.crop), STAGED_NAME);
  try {
    await slides.presentations.batchUpdate({
      presentationId: args.presentationId,
      requestBody: {
        requests: [
          { replaceImage: { imageObjectId: args.imageObjectId, url: staged.url, imageReplaceMethod: 'CENTER_INSIDE' } },
        ],
      },
    });
  } finally {
    await staged.release();
  }
  const frame = await place({ slides, presentationId: args.presentationId, imageObjectId: args.imageObjectId, target });
  return {
    imageObjectId: args.imageObjectId,
    sourcePixels: { width: source.width, height: source.height },
    croppedPixels: { width: args.crop.width, height: args.crop.height },
    frame,
    urlForm: staged.urlForm,
  };
};

export const cropImage: ToolModule<CropImageArgs> = {
  name: 'crop_image',
  schema: CropImageArgsSchema,
  handler,
  descriptor: {
    description:
      "Crop an image already on a slide to crop { x, y, width, height }, given in the image's own pixels with the origin at its top-left corner. Run get_image_info first to read the pixel size. The kept region stays where it was and the same size on the slide, and the frame shrinks around it, as a crop in the Slides editor does. The pixels are swapped first and the frame is placed in a second request, because Google refits replaced pixels to their own aspect ratio. The object id and Z-order are kept. The crop is applied to the pixels, so it cannot be undone later except by replacing the image; use copy_presentation first if needed. An image already cropped in the Slides editor, or inside a group, is refused.",
  },
};
