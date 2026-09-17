import { addSlide } from './tools/addSlide.js';
import { batchUpdatePresentation } from './tools/batchUpdatePresentation.js';
import { createPresentation } from './tools/createPresentation.js';
import { getPage } from './tools/getPage.js';
import { getPageThumbnail } from './tools/getPageThumbnail.js';
import { getPresentation } from './tools/getPresentation.js';
import { insertImage } from './tools/insertImage.js';
import { listPageElements } from './tools/listPageElements.js';
import { replaceAllText } from './tools/replaceAllText.js';
import { replaceImage } from './tools/replaceImage.js';
import { setElementGeometry } from './tools/setElementGeometry.js';
import { setElementText } from './tools/setElementText.js';
import { setShapeProperties } from './tools/setShapeProperties.js';
import { setTextStyle } from './tools/setTextStyle.js';
import { summarizePresentation } from './tools/summarizePresentation.js';
import { handleGoogleApiError } from './utils/errorHandler.js';
import { isToolContent, type ToolContent, type ToolModule } from './utils/tool.js';
import type { GoogleClients } from './google/clients.js';
import type { McpServer } from '@modelcontextprotocol/server';

const JSON_INDENT = 2;

const jsonText = (data: unknown): ToolContent => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, JSON_INDENT) }],
});

const invoke = async <T>(clients: GoogleClients, tool: ToolModule<T>, args: T): Promise<ToolContent> => {
  try {
    const payload = await tool.handler(clients, args);
    // A handler that already built content blocks (an image, say) passes
    // through untouched; every other payload is JSON-wrapped.
    return isToolContent(payload) ? payload : jsonText(payload);
  } catch (error: unknown) {
    throw handleGoogleApiError(error, tool.name);
  }
};

const register = <T>(server: McpServer, clients: GoogleClients, tool: ToolModule<T>): void => {
  server.registerTool(
    tool.name,
    {
      description: tool.descriptor.description,
      inputSchema: tool.schema,
    },
    async (args) => invoke(clients, tool, args)
  );
};

export const setupToolHandlers = (server: McpServer, clients: GoogleClients): void => {
  register(server, clients, createPresentation);
  register(server, clients, getPresentation);
  register(server, clients, batchUpdatePresentation);
  register(server, clients, getPage);
  register(server, clients, summarizePresentation);
  register(server, clients, insertImage);
  register(server, clients, replaceImage);
  register(server, clients, getPageThumbnail);
  register(server, clients, addSlide);
  register(server, clients, setElementText);
  register(server, clients, replaceAllText);
  register(server, clients, listPageElements);
  register(server, clients, setShapeProperties);
  register(server, clients, setTextStyle);
  register(server, clients, setElementGeometry);
};
