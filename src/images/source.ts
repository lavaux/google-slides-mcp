import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { downloadDriveFile, probeUrl, stageImage, type StagedImage } from './stage.js';
import type { GoogleClients } from '../google/clients.js';

const MAX_URL_LENGTH = 2048;
const STAGED_NAME_PREFIX = 'google-slides-mcp-staged';

export type ImageSource = {
  imageUrl?: string;
  imagePath?: string;
  imageBase64?: string;
  driveFileId?: string;
};

export type ResolvedImage = {
  url: string;
  urlForm: string;
  staged: boolean;
  release: () => Promise<void>;
};

const noRelease = async (): Promise<void> => undefined;

const stagedName = (): string => `${STAGED_NAME_PREFIX}-${String(Date.now())}`;

const fromStaged = (staged: StagedImage): ResolvedImage => ({
  url: staged.url,
  urlForm: staged.urlForm,
  staged: true,
  release: staged.release,
});

const fromUrl = async (url: string): Promise<ResolvedImage> => {
  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`Image URL is ${String(url.length)} characters. The Google Slides API limit is 2048.`);
  }
  if (!(await probeUrl(url))) {
    throw new Error(
      `The URL did not return a publicly fetchable image: ${url}. ` +
        'Google fetches image URLs server-side and unauthenticated, so a private or redirecting URL cannot be used.'
    );
  }
  return { url, urlForm: 'caller-supplied', staged: false, release: noRelease };
};

/**
 * Resolves an image source to a URL Google can fetch.
 *
 * `imageUrl` is used as-is, with no Drive round-trip. Every other source ends up
 * staged on Drive, because the Slides API accepts no image bytes of any kind.
 * A pre-existing Drive file is downloaded and re-staged rather than shared in
 * place: it is private, and `drive.file` cannot change permissions on a file
 * this app did not create.
 */
export const resolveImageSource = async (clients: GoogleClients, source: ImageSource): Promise<ResolvedImage> => {
  if (source.imageUrl !== undefined) {
    return fromUrl(source.imageUrl);
  }
  if (source.imagePath !== undefined) {
    const bytes = await readFile(source.imagePath);
    return fromStaged(await stageImage(clients.drive, bytes, basename(source.imagePath)));
  }
  if (source.imageBase64 !== undefined) {
    const bytes = Buffer.from(source.imageBase64, 'base64');
    return fromStaged(await stageImage(clients.drive, bytes, stagedName()));
  }
  if (source.driveFileId !== undefined) {
    const bytes = await downloadDriveFile(clients.drive, source.driveFileId);
    return fromStaged(await stageImage(clients.drive, bytes, stagedName()));
  }
  throw new Error('No image source was provided.');
};
