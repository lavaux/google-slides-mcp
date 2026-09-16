import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { downloadDriveFile, probeImage, stageImage, type StagedImage } from './stage.js';
import { readDimensions, sniffFormat } from './validate.js';
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
  /** Pixel size, known only for staged images. A caller-supplied URL is never downloaded. */
  natural?: { width: number; height: number };
};

const noRelease = async (): Promise<void> => undefined;

const stagedName = (): string => `${STAGED_NAME_PREFIX}-${String(Date.now())}`;

const fromStaged = (staged: StagedImage): ResolvedImage => ({
  url: staged.url,
  urlForm: staged.urlForm,
  staged: true,
  release: staged.release,
  natural: staged.natural,
});

/**
 * Reads the format and pixel size out of the bytes the probe already fetched.
 * Checking here means a URL serving WebP or SVG is rejected by name, rather
 * than passing the probe and failing later on Google's one opaque message.
 */
const describeUrlImage = (prefix: Buffer | undefined): { width: number; height: number } | undefined => {
  if (prefix === undefined || prefix.length === 0) {
    return undefined;
  }
  const format = sniffFormat(prefix);
  if (!format) {
    throw new Error(
      'The URL served an image the Google Slides API cannot use. It accepts PNG, JPEG and GIF only. SVG and WebP are not supported.'
    );
  }
  return readDimensions(prefix, format.mimeType);
};

const fromUrl = async (url: string): Promise<ResolvedImage> => {
  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`Image URL is ${String(url.length)} characters. The Google Slides API limit is 2048.`);
  }
  const probe = await probeImage(url);
  if (probe.outcome !== 'ok') {
    throw new Error(
      `The URL did not return a publicly fetchable image: ${url}. ` +
        'Google fetches image URLs server-side and unauthenticated, so a private or redirecting URL cannot be used.'
    );
  }
  return {
    url,
    urlForm: 'caller-supplied',
    staged: false,
    release: noRelease,
    natural: describeUrlImage(probe.prefix),
  };
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
