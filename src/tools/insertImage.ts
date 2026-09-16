import { resolveImageSource } from '../images/source.js';
import { InsertImageArgsSchema, type InsertImageArgs } from '../schemas.js';
import { elementProperties, readPageSize, resolveBox } from '../slides/geometry.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const pageSizeOf = async (slides: slides_v1.Slides, presentationId: string) => {
  const presentation = await slides.presentations.get({ presentationId, fields: 'pageSize' });
  const pageSize = readPageSize(presentation.data);
  if (!pageSize) {
    throw new Error('The presentation did not report a page size, so the image could not be placed.');
  }
  return pageSize;
};

const buildRequests = (args: InsertImageArgs, url: string, box: ReturnType<typeof resolveBox>) => {
  const createImage: slides_v1.Schema$Request = {
    createImage: {
      url,
      ...(args.objectId === undefined ? {} : { objectId: args.objectId }),
      elementProperties: elementProperties(args.pageObjectId, box),
    },
  };
  return [createImage];
};

const createdObjectId = (response: slides_v1.Schema$BatchUpdatePresentationResponse): string | undefined =>
  response.replies?.[0]?.createImage?.objectId ?? undefined;

type AltTextTarget = {
  presentationId: string;
  objectId: string | undefined;
  altText: string | undefined;
};

const applyAltText = async (slides: slides_v1.Slides, target: AltTextTarget): Promise<void> => {
  if (target.objectId === undefined || target.altText === undefined) {
    return;
  }
  await slides.presentations.batchUpdate({
    presentationId: target.presentationId,
    requestBody: {
      requests: [{ updatePageElementAltText: { objectId: target.objectId, description: target.altText } }],
    },
  });
};

const thumbnailWarning = (urlForm: string): { warning?: string } =>
  urlForm === 'thumbnail'
    ? {
        warning:
          'Served through the Drive thumbnail form, which transcodes to JPEG and caps resolution. Transparency was lost.',
      }
    : {};

/**
 * The box is the space the image is fitted into, not a forced shape. Slides
 * scales and centres within it while preserving the image's aspect ratio, so an
 * omitted width or height cannot distort the picture.
 */
const handler = async (clients: GoogleClients, args: InsertImageArgs): Promise<unknown> => {
  // The image is resolved first: its pixel dimensions decide the frame when the
  // caller gave only one of width or height.
  const image = await resolveImageSource(clients, args);
  try {
    const pageSize = await pageSizeOf(clients.slides, args.presentationId);
    const box = resolveBox(args, pageSize, image.natural);
    const response = await clients.slides.presentations.batchUpdate({
      presentationId: args.presentationId,
      requestBody: { requests: buildRequests(args, image.url, box) },
    });
    const objectId = createdObjectId(response.data);
    await applyAltText(clients.slides, {
      presentationId: args.presentationId,
      objectId,
      altText: args.altText,
    });
    return {
      objectId,
      urlForm: image.urlForm,
      staged: image.staged,
      ...thumbnailWarning(image.urlForm),
    };
  } finally {
    // Slides copies the bytes at insertion time, so the staged file is no
    // longer needed and must not stay link-readable.
    await image.release();
  }
};

export const insertImage: ToolModule<InsertImageArgs> = {
  name: 'insert_image',
  schema: InsertImageArgsSchema,
  handler,
  descriptor: {
    description:
      'Insert an image onto a slide from a local file path, base64 bytes, a public URL, or a Google Drive file id. Position and size are in points; omit them to centre the image on the slide.',
  },
};
