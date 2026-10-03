import { MAX_BYTES, validateImageBytes } from './validate.js';

const DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * Fetches image bytes for local processing. A deck image's contentUrl needs no
 * credentials: Google tags it with the requester's account for its short life.
 * The size cap is checked on the declared length first, so an oversized body is
 * refused before it is read.
 */
export const downloadImageUrl = async (url: string): Promise<Buffer> => {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Downloading the image failed with HTTP ${String(response.status)}: ${url}`);
  }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
    throw new Error('The image is larger than 50 MB, the Google Slides API limit.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  validateImageBytes(bytes);
  return bytes;
};
