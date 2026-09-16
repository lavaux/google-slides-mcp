import { CreatePresentationArgsSchema, type CreatePresentationArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const handler = async ({ slides }: GoogleClients, args: CreatePresentationArgs): Promise<unknown> => {
  const response = await slides.presentations.create({
    requestBody: {
      title: args.title,
    },
  });
  return response.data;
};

export const createPresentation: ToolModule<CreatePresentationArgs> = {
  name: 'create_presentation',
  schema: CreatePresentationArgsSchema,
  handler,
  descriptor: {
    description: 'Create a new Google Slides presentation',
  },
};
