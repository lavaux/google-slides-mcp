import { AddSlideArgsSchema, type AddSlideArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const ID_RANDOM_BASE = 36;
const ID_RANDOM_LENGTH = 8;

const shortId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(ID_RANDOM_BASE)}${Math.random().toString(ID_RANDOM_BASE).slice(2, ID_RANDOM_LENGTH)}`;

type PlaceholderFill = {
  type: string;
  objectId: string;
  text: string;
};

const placeholderFills = (args: AddSlideArgs): PlaceholderFill[] => {
  const wanted: { type: string; text: string | undefined }[] = [
    { type: 'TITLE', text: args.title },
    { type: 'BODY', text: args.body },
    { type: 'SUBTITLE', text: args.subtitle },
  ];
  return wanted.flatMap((item) =>
    item.text === undefined ? [] : [{ type: item.type, objectId: shortId(item.type.toLowerCase()), text: item.text }]
  );
};

const layoutReference = (args: AddSlideArgs): slides_v1.Schema$LayoutReference | undefined => {
  if (args.layoutObjectId !== undefined) {
    return { layoutId: args.layoutObjectId };
  }
  if (args.layout !== undefined) {
    return { predefinedLayout: args.layout };
  }
  return undefined;
};

const handler = async ({ slides }: GoogleClients, args: AddSlideArgs): Promise<unknown> => {
  const slideObjectId = shortId('slide');
  const fills = placeholderFills(args);
  const reference = layoutReference(args);
  // One batch: the placeholder id mappings make the ids created by createSlide
  // addressable by the insertText requests that follow it.
  const requests: slides_v1.Schema$Request[] = [
    {
      createSlide: {
        objectId: slideObjectId,
        ...(args.insertionIndex === undefined ? {} : { insertionIndex: args.insertionIndex }),
        ...(reference === undefined ? {} : { slideLayoutReference: reference }),
        ...(fills.length === 0
          ? {}
          : {
              placeholderIdMappings: fills.map((fill) => ({
                layoutPlaceholder: { type: fill.type },
                objectId: fill.objectId,
              })),
            }),
      },
    },
    ...fills.map((fill) => ({
      insertText: { objectId: fill.objectId, text: fill.text, insertionIndex: 0 },
    })),
  ];
  const response = await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: { requests },
  });
  return {
    slideObjectId: response.data.replies?.[0]?.createSlide?.objectId ?? slideObjectId,
    placeholders: fills.map((fill) => ({ type: fill.type, objectId: fill.objectId })),
  };
};

export const addSlide: ToolModule<AddSlideArgs> = {
  name: 'add_slide',
  schema: AddSlideArgsSchema,
  handler,
  descriptor: {
    description:
      'Add a slide using a predefined layout and optionally fill its title, body and subtitle placeholders in the same call. Only pass text for placeholders the chosen layout actually has, because the whole call is rejected if one is missing. Returns the new slide and placeholder object ids.',
  },
};
