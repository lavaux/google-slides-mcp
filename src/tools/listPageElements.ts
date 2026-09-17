import { ListPageElementsArgsSchema, type ListPageElementsArgs } from '../schemas.js';
import { ELEMENT_TREE_FIELDS, elementKind, groupChildren } from '../slides/elements.js';
import { readEmu, readPageSize, toPointsRounded, visualSize } from '../slides/geometry.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

type Element = slides_v1.Schema$PageElement;

const PREVIEW_LIMIT = 80;
const WHITESPACE = /\s+/g;

const runs = (text: slides_v1.Schema$TextContent | undefined): string[] =>
  text?.textElements?.map((item) => item.textRun?.content ?? '') ?? [];

const allText = (element: Element): string =>
  [
    ...runs(element.shape?.text),
    ...(element.table?.tableRows?.flatMap((row) => row.tableCells?.flatMap((cell) => runs(cell.text)) ?? []) ?? []),
  ]
    .join(' ')
    .replaceAll(WHITESPACE, ' ')
    .trim();

/** A preview, not the text itself: summarize_presentation and get_page are for reading. */
const preview = (element: Element): Record<string, string> => {
  const text = allText(element);
  if (text === '') {
    return {};
  }
  return { text: text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}...` : text };
};

/**
 * The visual box, not the intrinsic size Google stores. Reporting the raw size of
 * a scaled element would hand the caller a number that set_element_geometry would
 * then read back as a resize.
 */
const box = (element: Element): Record<string, number> => {
  const width = readEmu(element.size?.width);
  const height = readEmu(element.size?.height);
  if (width === undefined || height === undefined) {
    return {};
  }
  const transform = element.transform ?? {};
  const size = visualSize({ width, height }, transform);
  return {
    x: toPointsRounded(transform.translateX ?? 0),
    y: toPointsRounded(transform.translateY ?? 0),
    width: toPointsRounded(size.width),
    height: toPointsRounded(size.height),
  };
};

const details = (element: Element): Record<string, unknown> => ({
  ...(element.shape?.shapeType === undefined || element.shape.shapeType === null
    ? {}
    : { shapeType: element.shape.shapeType }),
  ...(element.shape?.placeholder ? { placeholder: element.shape.placeholder } : {}),
  ...(element.table ? { rows: element.table.rows, columns: element.table.columns } : {}),
});

const view = (element: Element, groupObjectId: string | undefined): Record<string, unknown>[] => [
  {
    objectId: element.objectId,
    kind: elementKind(element),
    ...(groupObjectId === undefined ? {} : { groupObjectId }),
    ...box(element),
    ...details(element),
    ...preview(element),
  },
  ...groupChildren(element).flatMap((child) => view(child, element.objectId ?? undefined)),
];

const pageView = (slide: slides_v1.Schema$Page, index: number, kind: string | undefined) => {
  const elements = (slide.pageElements ?? []).flatMap((element) => view(element, undefined));
  return {
    pageObjectId: slide.objectId,
    slideNumber: index + 1,
    elements: kind === undefined ? elements : elements.filter((element) => element.kind === kind),
  };
};

const handler = async ({ slides }: GoogleClients, args: ListPageElementsArgs): Promise<unknown> => {
  const presentation = (
    await slides.presentations.get({ presentationId: args.presentationId, fields: ELEMENT_TREE_FIELDS })
  ).data;
  const pages = (presentation.slides ?? [])
    .map((slide, index) => pageView(slide, index, args.kind))
    .filter((page) => args.pageObjectId === undefined || page.pageObjectId === args.pageObjectId);
  const size = readPageSize(presentation);
  return {
    ...(size === undefined
      ? {}
      : { pageSize: { width: toPointsRounded(size.width), height: toPointsRounded(size.height) } }),
    pages,
  };
};

export const listPageElements: ToolModule<ListPageElementsArgs> = {
  name: 'list_page_elements',
  schema: ListPageElementsArgsSchema,
  handler,
  descriptor: {
    description:
      'List the object ids on each slide with their kind, position and size in points, and a short text preview. This is how you find the object id that set_shape_properties, set_text_style, set_element_geometry and set_element_text need. Group members are listed too, each carrying the id of the group it belongs to. Pass pageObjectId for one slide, or kind to keep only shapes, images, tables, lines or groups.',
  },
};
