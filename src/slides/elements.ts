import type { slides_v1 } from 'googleapis';

type Element = slides_v1.Schema$PageElement;

const KIND_KEYS = ['shape', 'image', 'video', 'line', 'table', 'elementGroup', 'sheetsChart', 'wordArt'] as const;

/**
 * One fetch shape for every tool that has to find an element first.
 *
 * `pageElements` is deliberately left unmasked. A field mask cannot express
 * unbounded group nesting, and any fixed depth silently hides deeper elements.
 * The response is projected down before it leaves a handler, so the extra bytes
 * cost latency and nothing else.
 */
export const ELEMENT_TREE_FIELDS = 'pageSize,slides(objectId,pageElements)';

export const groupChildren = (element: Element): Element[] => element.elementGroup?.children ?? [];

const VOWELS = 'aeiou';

/** "is an image", not "is a image": these strings go straight to a reader. */
export const describeKind = (kind: string): string => `${VOWELS.includes(kind.slice(0, 1)) ? 'an' : 'a'} ${kind}`;

export const elementKind = (element: Element): string => {
  const key = KIND_KEYS.find((candidate) => element[candidate] !== undefined);
  return key === 'elementGroup' ? 'group' : (key ?? 'unknown');
};

export type Located = {
  element: Element;
  kind: string;
  pageObjectId: string;
  /** Enclosing group ids, outermost first. Empty when the element sits on the slide. */
  ancestors: string[];
};

type Scope = { pageObjectId: string; ancestors: string[] };

const descend = (element: Element, objectId: string, scope: Scope): Located[] => {
  const nested = locateIn(groupChildren(element), objectId, {
    pageObjectId: scope.pageObjectId,
    ancestors: [...scope.ancestors, element.objectId ?? ''],
  });
  return nested === undefined ? [] : [nested];
};

const locateIn = (elements: Element[], objectId: string, scope: Scope): Located | undefined => {
  const direct = elements.find((element) => element.objectId === objectId);
  if (direct) {
    return { element: direct, kind: elementKind(direct), ...scope };
  }
  return elements.flatMap((element) => descend(element, objectId, scope)).at(0);
};

/** Finds an element at any group depth, which a one-level search cannot do. */
export const locateElement = (presentation: slides_v1.Schema$Presentation, objectId: string): Located | undefined =>
  (presentation.slides ?? [])
    .flatMap((slide) => {
      const found = locateIn(slide.pageElements ?? [], objectId, {
        pageObjectId: slide.objectId ?? '',
        ancestors: [],
      });
      return found === undefined ? [] : [found];
    })
    .at(0);

export const requireLocated = (presentation: slides_v1.Schema$Presentation, objectId: string): Located => {
  const located = locateElement(presentation, objectId);
  if (!located) {
    throw new Error(
      `No page element with object id "${objectId}" was found in this presentation. Run list_page_elements to see the available object ids.`
    );
  }
  return located;
};

/** updateShapeProperties rejects anything that is not a shape, with no useful message of its own. */
export const requireShape = (presentation: slides_v1.Schema$Presentation, objectId: string): Located => {
  const located = requireLocated(presentation, objectId);
  if (located.kind === 'table') {
    throw new Error(
      `Object id "${objectId}" is a table. Table cells carry their own properties, which this tool does not cover. Use batch_update_presentation with updateTableCellProperties.`
    );
  }
  if (!located.element.shape) {
    throw new Error(
      `Object id "${objectId}" is ${describeKind(located.kind)}, not a shape. Shape properties apply to shapes and placeholders only.`
    );
  }
  return located;
};

export const requireTextElement = (presentation: slides_v1.Schema$Presentation, objectId: string): Located => {
  const located = requireLocated(presentation, objectId);
  if (!located.element.shape && !located.element.table) {
    throw new Error(
      `Object id "${objectId}" is ${describeKind(located.kind)} and carries no text. Text style applies to shapes, placeholders and table cells.`
    );
  }
  return located;
};

export type CellArgs = { rowIndex?: number | undefined; columnIndex?: number | undefined };

export const cellLocation = (args: CellArgs): slides_v1.Schema$TableCellLocation | undefined => {
  if (args.rowIndex === undefined || args.columnIndex === undefined) {
    return undefined;
  }
  return { rowIndex: args.rowIndex, columnIndex: args.columnIndex };
};

/** A cell location against a shape, or past the end of a table, is a caller mistake worth naming. */
export const checkCell = (located: Located, location: slides_v1.Schema$TableCellLocation | undefined): void => {
  const objectId = located.element.objectId ?? '';
  if (location === undefined) {
    return;
  }
  const table = located.element.table;
  if (!table) {
    throw new Error(
      `Object id "${objectId}" is ${describeKind(located.kind)}, so rowIndex and columnIndex do not apply.`
    );
  }
  const rows = table.rows ?? 0;
  const columns = table.columns ?? 0;
  if ((location.rowIndex ?? 0) >= rows || (location.columnIndex ?? 0) >= columns) {
    throw new Error(
      `Table "${objectId}" has ${rows} rows and ${columns} columns, so row ${location.rowIndex} column ${location.columnIndex} is out of range.`
    );
  }
};

const cellText = (
  element: Element,
  location: slides_v1.Schema$TableCellLocation
): slides_v1.Schema$TextContent | undefined =>
  element.table?.tableRows
    ?.flatMap((row) => row.tableCells ?? [])
    .find(
      (cell) =>
        (cell.location?.rowIndex ?? 0) === location.rowIndex &&
        (cell.location?.columnIndex ?? 0) === location.columnIndex
    )?.text;

export const textOf = (
  element: Element,
  location: slides_v1.Schema$TableCellLocation | undefined
): slides_v1.Schema$TextContent | undefined =>
  location === undefined ? element.shape?.text : cellText(element, location);

export const hasText = (text: slides_v1.Schema$TextContent | undefined): boolean =>
  text?.textElements?.some((item) => (item.textRun?.content ?? '') !== '') === true;
