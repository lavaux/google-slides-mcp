import { SetElementTextArgsSchema, type SetElementTextArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const ELEMENT_FIELDS =
  'slides(pageElements(objectId,shape(text(textElements(textRun(content)))),table(tableRows(tableCells(location,text(textElements(textRun(content))))))))';

const hasContent = (text: slides_v1.Schema$TextContent | undefined): boolean =>
  text?.textElements?.some((element) => (element.textRun?.content ?? '') !== '') === true;

const findElement = (
  presentation: slides_v1.Schema$Presentation,
  objectId: string
): slides_v1.Schema$PageElement | undefined =>
  presentation.slides?.flatMap((slide) => slide.pageElements ?? []).find((element) => element.objectId === objectId);

const cellText = (
  element: slides_v1.Schema$PageElement,
  location: slides_v1.Schema$TableCellLocation
): slides_v1.Schema$TextContent | undefined =>
  element.table?.tableRows
    ?.flatMap((row) => row.tableCells ?? [])
    .find(
      (cell) =>
        (cell.location?.rowIndex ?? 0) === location.rowIndex &&
        (cell.location?.columnIndex ?? 0) === location.columnIndex
    )?.text;

const existingText = (
  element: slides_v1.Schema$PageElement | undefined,
  location: slides_v1.Schema$TableCellLocation | undefined
): boolean => {
  if (!element) {
    return false;
  }
  return hasContent(location === undefined ? element.shape?.text : cellText(element, location));
};

const cellLocation = (args: SetElementTextArgs): slides_v1.Schema$TableCellLocation | undefined => {
  if (args.rowIndex === undefined || args.columnIndex === undefined) {
    return undefined;
  }
  return { rowIndex: args.rowIndex, columnIndex: args.columnIndex };
};

/**
 * deleteText is only emitted when there is text to delete. Google rejects the
 * request outright on an empty shape, which would otherwise make this tool fail
 * on exactly the empty placeholder it is most useful for.
 *
 * Range type ALL is required when text is present: a shape always carries an
 * implicit trailing newline that a fixed range cannot delete.
 */
const buildRequests = (args: SetElementTextArgs, hasExisting: boolean): slides_v1.Schema$Request[] => {
  const location = cellLocation(args);
  const target = { objectId: args.objectId, ...(location === undefined ? {} : { cellLocation: location }) };
  const requests: slides_v1.Schema$Request[] = [];
  if (hasExisting) {
    requests.push({ deleteText: { ...target, textRange: { type: 'ALL' } } });
  }
  if (args.text !== '') {
    requests.push({ insertText: { ...target, text: args.text, insertionIndex: 0 } });
  }
  return requests;
};

const handler = async ({ slides }: GoogleClients, args: SetElementTextArgs): Promise<unknown> => {
  const presentation = await slides.presentations.get({
    presentationId: args.presentationId,
    fields: ELEMENT_FIELDS,
  });
  const element = findElement(presentation.data, args.objectId);
  if (!element) {
    throw new Error(`No page element with object id "${args.objectId}" was found in this presentation.`);
  }
  const requests = buildRequests(args, existingText(element, cellLocation(args)));
  if (requests.length === 0) {
    return { objectId: args.objectId, changed: false };
  }
  await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: { requests },
  });
  return { objectId: args.objectId, changed: true };
};

export const setElementText: ToolModule<SetElementTextArgs> = {
  name: 'set_element_text',
  schema: SetElementTextArgsSchema,
  handler,
  descriptor: {
    description:
      'Replace all text in a shape, placeholder or table cell with new text. Pass rowIndex and columnIndex together to target a table cell. Pass an empty string to clear the element.',
  },
};
