import { addSlide } from './tools/addSlide.js';
import { arrangeElements } from './tools/arrangeElements.js';
import { batchUpdatePresentation } from './tools/batchUpdatePresentation.js';
import { copyPresentation } from './tools/copyPresentation.js';
import { createPresentation } from './tools/createPresentation.js';
import { getPage } from './tools/getPage.js';
import { getPageThumbnail } from './tools/getPageThumbnail.js';
import { getPresentation } from './tools/getPresentation.js';
import { insertImage } from './tools/insertImage.js';
import { listLayouts } from './tools/listLayouts.js';
import { listPageElements } from './tools/listPageElements.js';
import { manageSlides } from './tools/manageSlides.js';
import { replaceAllText } from './tools/replaceAllText.js';
import { replaceImage } from './tools/replaceImage.js';
import { setElementGeometry } from './tools/setElementGeometry.js';
import { setElementText } from './tools/setElementText.js';
import { setPageBackground } from './tools/setPageBackground.js';
import { setShapeProperties } from './tools/setShapeProperties.js';
import { setTextStyle } from './tools/setTextStyle.js';
import { setThemeColors } from './tools/setThemeColors.js';
import { summarizePresentation } from './tools/summarizePresentation.js';
import { credentialFailure, handleCredentialFailure, handleGoogleApiError } from './utils/errorHandler.js';
import { isToolContent, type ToolContent, type ToolModule } from './utils/tool.js';
import type { GoogleSession } from './google/session.js';
import type { McpServer, ProtocolError } from '@modelcontextprotocol/server';

const JSON_INDENT = 2;

const jsonText = (data: unknown): ToolContent => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, JSON_INDENT) }],
});

const toolError = async (session: GoogleSession, error: unknown, toolName: string): Promise<ProtocolError> => {
  const failure = credentialFailure(error);
  if (failure === undefined) {
    return handleGoogleApiError(error, toolName);
  }
  // A dead credential cannot be fixed by retrying. Start consent and tell the
  // caller to have the user finish it, instead of surfacing `invalid_grant`.
  return handleCredentialFailure(failure, await session.reauthorize(failure), toolName);
};

const invoke = async <T>(session: GoogleSession, tool: ToolModule<T>, args: T): Promise<ToolContent> => {
  try {
    const payload = await tool.handler(session.clients(), args);
    // A handler that already built content blocks (an image, say) passes
    // through untouched; every other payload is JSON-wrapped.
    return isToolContent(payload) ? payload : jsonText(payload);
  } catch (error: unknown) {
    throw await toolError(session, error, tool.name);
  }
};

const register = <T>(server: McpServer, session: GoogleSession, tool: ToolModule<T>): void => {
  server.registerTool(
    tool.name,
    {
      description: tool.descriptor.description,
      inputSchema: tool.schema,
    },
    async (args) => invoke(session, tool, args)
  );
};

const registerLayoutTools = (server: McpServer, session: GoogleSession): void => {
  register(server, session, copyPresentation);
  register(server, session, listLayouts);
  register(server, session, manageSlides);
  register(server, session, arrangeElements);
  register(server, session, setPageBackground);
  register(server, session, setThemeColors);
};

export const setupToolHandlers = (server: McpServer, session: GoogleSession): void => {
  register(server, session, createPresentation);
  register(server, session, getPresentation);
  register(server, session, batchUpdatePresentation);
  register(server, session, getPage);
  register(server, session, summarizePresentation);
  register(server, session, insertImage);
  register(server, session, replaceImage);
  register(server, session, getPageThumbnail);
  register(server, session, addSlide);
  register(server, session, setElementText);
  register(server, session, replaceAllText);
  register(server, session, listPageElements);
  register(server, session, setShapeProperties);
  register(server, session, setTextStyle);
  register(server, session, setElementGeometry);
  registerLayoutTools(server, session);
};
