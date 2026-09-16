import { GetPresentationArgsSchema, type GetPresentationArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const handler = async ({ slides }: GoogleClients, args: GetPresentationArgs): Promise<unknown> => {
  const response = await slides.presentations.get({
    presentationId: args.presentationId,
    fields: args.fields,
  });
  return response.data;
};

export const getPresentation: ToolModule<GetPresentationArgs> = {
  name: 'get_presentation',
  schema: GetPresentationArgsSchema,
  handler,
  descriptor: {
    description: 'Get details about a Google Slides presentation',
  },
};
