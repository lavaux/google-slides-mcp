import { resolveImageSource } from '../images/source.js';
import { SetPageBackgroundArgsSchema, type SetPageBackgroundArgs } from '../layoutSchemas.js';
import { allPages, type PageType } from '../slides/elements.js';
import { buildUpdate, COLOR_NONE, leaf, parseColor } from '../slides/style.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const pageTypeOf = async (slides: slides_v1.Slides, args: SetPageBackgroundArgs): Promise<PageType> => {
  const presentation = (
    await slides.presentations.get({
      presentationId: args.presentationId,
      fields: 'slides(objectId),layouts(objectId),masters(objectId)',
    })
  ).data;
  const found = allPages(presentation).find((item) => item.page.objectId === args.pageObjectId);
  if (!found) {
    throw new Error(
      `No slide, layout or master with object id "${args.pageObjectId}". Run list_layouts to see page ids.`
    );
  }
  return found.pageType;
};

/**
 * The whole fill is written, and masked, as one value. Naming only the solid
 * colour would leave a stretched picture in place underneath it, and the mask
 * still names nothing the payload does not carry.
 */
const colorFill = (color: string): slides_v1.Schema$PageBackgroundFill =>
  color === COLOR_NONE
    ? { propertyState: 'NOT_RENDERED' }
    : { propertyState: 'RENDERED', solidFill: { color: parseColor(color) } };

const write = async (
  slides: slides_v1.Slides,
  args: SetPageBackgroundArgs,
  fill: slides_v1.Schema$PageBackgroundFill
) => {
  const update = buildUpdate([leaf('pageBackgroundFill', fill)]);
  await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: {
      requests: [
        {
          updatePageProperties: {
            objectId: args.pageObjectId,
            pageProperties: { ...update.properties },
            fields: update.fields,
          },
        },
      ],
    },
  });
};

const refuseMasterInherit = (pageType: PageType): void => {
  if (pageType === 'master') {
    throw new Error('A master has nothing to inherit from. Give it a color or an image instead.');
  }
};

const handler = async (clients: GoogleClients, args: SetPageBackgroundArgs): Promise<unknown> => {
  // Parsed before any round-trip so a bad colour fails locally.
  const fill = args.color === undefined ? undefined : colorFill(args.color);
  const pageType = await pageTypeOf(clients.slides, args);
  if (args.inherit === true) {
    refuseMasterInherit(pageType);
    await write(clients.slides, args, { propertyState: 'INHERIT' });
    return { pageObjectId: args.pageObjectId, pageType, background: 'inherited' };
  }
  if (fill !== undefined) {
    await write(clients.slides, args, fill);
    return { pageObjectId: args.pageObjectId, pageType, background: args.color };
  }
  const image = await resolveImageSource(clients, args);
  try {
    await write(clients.slides, args, { propertyState: 'RENDERED', stretchedPictureFill: { contentUrl: image.url } });
    return {
      pageObjectId: args.pageObjectId,
      pageType,
      background: 'image',
      urlForm: image.urlForm,
      staged: image.staged,
    };
  } finally {
    // Slides copies the picture when the request lands, as with insert_image.
    await image.release();
  }
};

export const setPageBackground: ToolModule<SetPageBackgroundArgs> = {
  name: 'set_page_background',
  schema: SetPageBackgroundArgsSchema,
  handler,
  descriptor: {
    description:
      'Set the background of a slide, a layout or a master. Pass exactly one of: color (#RRGGBB, #RGB, a theme colour such as ACCENT1, or NONE for no background), an image (imagePath, imageBase64, imageUrl or driveFileId, stretched to fill the page), or inherit: true to fall back to the layout or master background (slides and layouts only). Setting it on a layout or master changes every slide that inherits from it. list_layouts gives layout and master ids.',
  },
};
