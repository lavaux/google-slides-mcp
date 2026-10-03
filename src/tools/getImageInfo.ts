import { imageInfo } from '../images/crop.js';
import { downloadImageUrl } from '../images/download.js';
import { sourceBytes } from '../images/source.js';
import { GetImageInfoArgsSchema, type GetImageInfoArgs } from '../imageSchemas.js';
import { hasEditorCrop } from '../slides/cropFrame.js';
import { ELEMENT_TREE_FIELDS, requireImage } from '../slides/elements.js';
import { readEmu, toPointsRounded, translateEmu, visualSize } from '../slides/geometry.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

/** The frame as list_page_elements reports it, so the two outputs can be compared directly. */
export const frameBox = (element: slides_v1.Schema$PageElement) => {
  const transform = element.transform ?? {};
  const size = visualSize(
    { width: readEmu(element.size?.width) ?? 0, height: readEmu(element.size?.height) ?? 0 },
    transform
  );
  return {
    x: toPointsRounded(translateEmu(transform.translateX, transform.unit)),
    y: toPointsRounded(translateEmu(transform.translateY, transform.unit)),
    width: toPointsRounded(size.width),
    height: toPointsRounded(size.height),
  };
};

const deckImageInfo = async (slides: slides_v1.Slides, presentationId: string, imageObjectId: string) => {
  const presentation = (await slides.presentations.get({ presentationId, fields: ELEMENT_TREE_FIELDS })).data;
  const located = requireImage(presentation, imageObjectId);
  const bytes = await downloadImageUrl(located.element.image?.contentUrl ?? '');
  return {
    imageObjectId,
    ...(await imageInfo(bytes)),
    frame: frameBox(located.element),
    editorCrop: hasEditorCrop(located.element.image ?? undefined),
  };
};

const handler = async (clients: GoogleClients, args: GetImageInfoArgs): Promise<unknown> =>
  args.imageObjectId === undefined
    ? imageInfo(await sourceBytes(clients, args))
    : deckImageInfo(clients.slides, args.presentationId ?? '', args.imageObjectId);

export const getImageInfo: ToolModule<GetImageInfoArgs> = {
  name: 'get_image_info',
  schema: GetImageInfoArgsSchema,
  handler,
  descriptor: {
    description:
      'Report the pixel size, format and frame count of an image, which is what the crop arguments of crop_image, insert_image and replace_image are measured in. Pass presentationId with imageObjectId for an image in the deck, which also returns its frame on the slide in points and whether it carries a crop made in the Slides editor. Or pass one image source (imagePath, imageBase64, imageUrl, driveFileId) to inspect an image before inserting it.',
  },
};
