import { ReplaceAllTextArgsSchema, type ReplaceAllTextArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const handler = async ({ slides }: GoogleClients, args: ReplaceAllTextArgs): Promise<unknown> => {
  const response = await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: {
              text: args.text,
              ...(args.matchCase === undefined ? {} : { matchCase: args.matchCase }),
              ...(args.searchByRegex === undefined ? {} : { searchByRegex: args.searchByRegex }),
            },
            replaceText: args.replaceText,
            ...(args.pageObjectIds === undefined ? {} : { pageObjectIds: args.pageObjectIds }),
          },
        },
      ],
    },
  });
  return { occurrencesChanged: response.data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0 };
};

export const replaceAllText: ToolModule<ReplaceAllTextArgs> = {
  name: 'replace_all_text',
  schema: ReplaceAllTextArgsSchema,
  handler,
  descriptor: {
    description:
      'Find and replace text across a presentation, optionally scoped to specific pages. Supports regular expressions via searchByRegex.',
  },
};
