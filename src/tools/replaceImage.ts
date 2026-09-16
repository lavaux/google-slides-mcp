import { resolveImageSource } from '../images/source.js';
import { ReplaceImageArgsSchema, type ReplaceImageArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const handler = async (clients: GoogleClients, args: ReplaceImageArgs): Promise<unknown> => {
  const image = await resolveImageSource(clients, args);
  try {
    await clients.slides.presentations.batchUpdate({
      presentationId: args.presentationId,
      requestBody: {
        requests: [
          {
            replaceImage: {
              imageObjectId: args.imageObjectId,
              url: image.url,
              ...(args.imageReplaceMethod === undefined ? {} : { imageReplaceMethod: args.imageReplaceMethod }),
            },
          },
        ],
      },
    });
    // replaceImage has no reply object, so the object id is echoed back from
    // the request to keep the result useful.
    return {
      imageObjectId: args.imageObjectId,
      urlForm: image.urlForm,
      staged: image.staged,
    };
  } finally {
    await image.release();
  }
};

export const replaceImage: ToolModule<ReplaceImageArgs> = {
  name: 'replace_image',
  schema: ReplaceImageArgsSchema,
  handler,
  descriptor: {
    description:
      'Replace the pixels of an existing image element while keeping its object id, position, size and Z-order. Prefer this over deleting and re-inserting when re-rendering a chart or figure.',
  },
};
