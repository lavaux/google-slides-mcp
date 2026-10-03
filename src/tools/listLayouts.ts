import { ListLayoutsArgsSchema, type ListLayoutsArgs } from '../schemas.js';
import { hexFromRgb } from '../slides/style.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const LAYOUT_FIELDS = [
  'masters(objectId,masterProperties,pageProperties(colorScheme))',
  'layouts(objectId,layoutProperties,pageElements(objectId,shape(placeholder)))',
  'slides(objectId,slideProperties(layoutObjectId))',
].join(',');

const themeColors = (master: slides_v1.Schema$Page): Record<string, string> =>
  Object.fromEntries(
    (master.pageProperties?.colorScheme?.colors ?? []).map((pair) => [pair.type ?? '', hexFromRgb(pair.color ?? {})])
  );

const placeholders = (layout: slides_v1.Schema$Page) =>
  (layout.pageElements ?? []).flatMap((element) => {
    const placeholder = element.shape?.placeholder;
    return placeholder ? [{ type: placeholder.type, index: placeholder.index ?? 0, objectId: element.objectId }] : [];
  });

const layoutView = (layout: slides_v1.Schema$Page) => ({
  objectId: layout.objectId,
  name: layout.layoutProperties?.name,
  displayName: layout.layoutProperties?.displayName,
  placeholders: placeholders(layout),
});

const handler = async ({ slides }: GoogleClients, args: ListLayoutsArgs): Promise<unknown> => {
  const presentation = (await slides.presentations.get({ presentationId: args.presentationId, fields: LAYOUT_FIELDS }))
    .data;
  const layouts = presentation.layouts ?? [];
  return {
    masters: (presentation.masters ?? []).map((master) => ({
      objectId: master.objectId,
      displayName: master.masterProperties?.displayName,
      themeColors: themeColors(master),
      layouts: layouts.filter((layout) => layout.layoutProperties?.masterObjectId === master.objectId).map(layoutView),
    })),
    slides: (presentation.slides ?? []).map((slide, index) => ({
      objectId: slide.objectId,
      slideNumber: index + 1,
      layoutObjectId: slide.slideProperties?.layoutObjectId,
    })),
  };
};

export const listLayouts: ToolModule<ListLayoutsArgs> = {
  name: 'list_layouts',
  schema: ListLayoutsArgsSchema,
  handler,
  descriptor: {
    description:
      "List the presentation's masters with their theme colours, the layouts under each master with the placeholders each one offers, and the layout every slide currently uses. Layout ids feed add_slide and manage_slides relayout. Layout and master ids also work as pageObjectId in list_page_elements and set_page_background, and their element ids work in the shape, text and geometry tools, which edits what every slide on that layout inherits.",
  },
};
