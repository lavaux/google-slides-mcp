import { CopyPresentationArgsSchema, type CopyPresentationArgs } from '../schemas.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';

const pad = (value: number): string => String(value).padStart(2, '0');

/** "<title> (backup YYYY-MM-DD HH:MM)" in the server's local time, so copies sort by when they were made. */
export const backupName = (title: string, date: Date): string => {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${title} (backup ${day} ${time})`;
};

/**
 * Drive copies a Slides file as a whole: slides, layouts, masters, notes and
 * comments. The copy lands next to the original and is owned by the caller.
 */
const handler = async ({ drive }: GoogleClients, args: CopyPresentationArgs): Promise<unknown> => {
  const name =
    args.name ??
    backupName(
      (await drive.files.get({ fileId: args.presentationId, fields: 'name', supportsAllDrives: true })).data.name ??
        'Untitled presentation',
      new Date()
    );
  const copy = await drive.files.copy({
    fileId: args.presentationId,
    requestBody: { name },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return {
    presentationId: copy.data.id,
    name: copy.data.name,
    url: copy.data.webViewLink ?? `https://docs.google.com/presentation/d/${copy.data.id ?? ''}/edit`,
  };
};

export const copyPresentation: ToolModule<CopyPresentationArgs> = {
  name: 'copy_presentation',
  schema: CopyPresentationArgsSchema,
  handler,
  descriptor: {
    description:
      'Make a full copy of a presentation in Google Drive, for example as a backup before large or destructive edits. The copy sits in the same folder as the original. Without a name it is called "<title> (backup YYYY-MM-DD HH:MM)". Returns the new presentation id and its URL.',
  },
};
