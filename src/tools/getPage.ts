import { GetPageArgsSchema, type GetPageArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const handler = async ({ slides }: GoogleClients, args: GetPageArgs): Promise<unknown> => {
  const response = await slides.presentations.pages.get({
    presentationId: args.presentationId,
    pageObjectId: args.pageObjectId,
  });
  return response.data;
};

export const getPage: ToolModule<GetPageArgs> = {
  name: 'get_page',
  schema: GetPageArgsSchema,
  handler,
  descriptor: {
    description: 'Get details about a specific page (slide) in a presentation',
  },
};
