import { SetElementTextArgsSchema, type SetElementTextArgs } from '../schemas.js';
import {
  cellLocation,
  checkCell,
  ELEMENT_TREE_FIELDS,
  hasText,
  requireTextElement,
  textOf,
} from '../slides/elements.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

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
    fields: ELEMENT_TREE_FIELDS,
  });
  const located = requireTextElement(presentation.data, args.objectId);
  const location = cellLocation(args);
  checkCell(located, location);
  const requests = buildRequests(args, hasText(textOf(located.element, location)));
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
      'Replace all text in a shape, placeholder or table cell with new text. Pass rowIndex and columnIndex together to target a table cell. Pass an empty string to clear the element. This discards any character styling the text already carried, so style it afterwards with set_text_style, which also resets autofit to NONE.',
  },
};
