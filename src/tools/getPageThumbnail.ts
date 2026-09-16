import { GetPageThumbnailArgsSchema, type GetPageThumbnailArgs } from '../schemas.js';
import { toolContent } from '../utils/tool.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const DEFAULT_SIZE = 'WIDTH2000_PX';

const handler = async ({ slides }: GoogleClients, args: GetPageThumbnailArgs): Promise<unknown> => {
  const response = await slides.presentations.pages.getThumbnail({
    presentationId: args.presentationId,
    pageObjectId: args.pageObjectId,
    'thumbnailProperties.mimeType': 'PNG',
    'thumbnailProperties.thumbnailSize': args.size ?? DEFAULT_SIZE,
  });
  const contentUrl = response.data.contentUrl;
  if (!contentUrl) {
    throw new Error('Google did not return a thumbnail URL for this page.');
  }
  // The URL lives 30 minutes and is tagged with this account: anyone holding it
  // reads as us. Fetch the bytes now and never surface or log the URL itself.
  const image = await fetch(contentUrl);
  if (!image.ok) {
    throw new Error(`Failed to download the rendered thumbnail (HTTP ${String(image.status)}).`);
  }
  const bytes = Buffer.from(await image.arrayBuffer());
  return toolContent([
    {
      type: 'text',
      text: `Slide ${args.pageObjectId} rendered at ${String(response.data.width ?? 0)}x${String(response.data.height ?? 0)}.`,
    },
    { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
  ]);
};

export const getPageThumbnail: ToolModule<GetPageThumbnailArgs> = {
  name: 'get_page_thumbnail',
  schema: GetPageThumbnailArgsSchema,
  handler,
  descriptor: {
    description:
      'Render a slide as a PNG image and return it inline, so the rendered layout can be inspected visually. Use this to check an edit landed as intended.',
  },
};
