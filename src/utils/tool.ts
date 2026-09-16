import type { GoogleClients } from '../google/clients.js';
import type { z } from 'zod';

export type ToolDescriptor = {
  description: string;
};

export type TextContent = {
  type: 'text';
  text: string;
};

export type ImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ToolContent = {
  content: (TextContent | ImageContent)[];
};

export type ToolModule<T> = {
  name: string;
  descriptor: ToolDescriptor;
  schema: z.ZodType<T>;
  handler: (clients: GoogleClients, parsedArgs: T) => Promise<unknown>;
};

export const toolContent = (content: (TextContent | ImageContent)[]): ToolContent => ({ content });

export const isToolContent = (value: unknown): value is ToolContent => {
  if (typeof value !== 'object' || value === null || !('content' in value)) {
    return false;
  }
  return Array.isArray(value.content);
};
