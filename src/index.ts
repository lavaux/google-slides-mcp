#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { resolveGoogleCredential } from './auth/resolveCredential.js';
import { createGoogleSession, type GoogleSession } from './google/session.js';
import { setupToolHandlers } from './serverHandlers.js';

const buildServer = (session: GoogleSession): McpServer => {
  const server = new McpServer({
    name: 'google-slides-mcp',
    version: '0.2.0',
  });
  setupToolHandlers(server, session);
  return server;
};

const start = async (): Promise<void> => {
  // One session per process, so a renewed credential reaches every server instance.
  const session = createGoogleSession(await resolveGoogleCredential());
  const handle = serveStdio(() => buildServer(session));
  const shutdown = (): void => {
    handle
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.error('Google Slides MCP server running and connected via stdio.');
};

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Failed to start Google Slides MCP server:', message);
  process.exit(1);
});
