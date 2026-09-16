import { Readable } from 'node:stream';
import { validateImageBytes } from './validate.js';
import type { drive_v3 } from 'googleapis';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const PROBE_TIMEOUT_MS = 10000;

/**
 * Candidate public URL forms for a Drive file, ordered by fidelity.
 *
 * The `/uc` form serves the original bytes but frequently 403s since Google's
 * January 2024 third-party-cookie change. The `thumbnail` form is the most
 * reliable but transcodes to JPEG and caps resolution, so it silently flattens
 * PNG transparency; it is therefore the last resort rather than the default.
 * All three are undocumented or degraded, which is why the winner is probed
 * rather than assumed.
 */
const urlForms: { name: string; build: (fileId: string) => string }[] = [
  { name: 'uc-download', build: (id) => `https://drive.google.com/uc?export=download&id=${id}` },
  { name: 'googleusercontent', build: (id) => `https://lh3.googleusercontent.com/d/${id}=s4000` },
  { name: 'thumbnail', build: (id) => `https://drive.google.com/thumbnail?id=${id}&sz=w2000` },
];

export type ProbeResult = {
  url: string;
  urlForm: string;
};

const isImageResponse = (response: Response): boolean => {
  if (response.status < HTTP_OK_MIN || response.status > HTTP_OK_MAX) {
    return false;
  }
  return response.headers.get('content-type')?.startsWith('image/') === true;
};

/** Fetches unauthenticated, exactly as Google's servers will. */
export const probeUrl = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return isImageResponse(response);
  } catch {
    return false;
  }
};

/**
 * Walks the forms in order and stops at the first that serves an image.
 * Deliberately sequential rather than parallel: the forms are ranked by
 * fidelity, so the earliest success is the one worth keeping.
 */
const probeForms = async (fileId: string, index: number): Promise<ProbeResult> => {
  if (index >= urlForms.length) {
    const tried = urlForms.map((item) => item.name).join(', ');
    throw new Error(
      `The staged Drive file was not publicly fetchable through any known URL form (tried: ${tried}). ` +
        'Google fetches image URLs server-side and unauthenticated, so the image could not be inserted.'
    );
  }
  const form = urlForms[index];
  const url = form.build(fileId);
  if (await probeUrl(url)) {
    return { url, urlForm: form.name };
  }
  return probeForms(fileId, index + 1);
};

export type StagedImage = ProbeResult & {
  release: () => Promise<void>;
};

/**
 * Uploads bytes to Drive, shares them link-readable, and finds a URL form that
 * Google can actually fetch. The caller must invoke `release()` once the Slides
 * call has returned: Slides copies the bytes at insertion time, so deleting
 * afterwards is safe and closes the public window.
 */
export const stageImage = async (drive: drive_v3.Drive, bytes: Buffer, name: string): Promise<StagedImage> => {
  const format = validateImageBytes(bytes);
  const created = await drive.files.create({
    requestBody: { name: `${name}.${format.extension}` },
    media: { mimeType: format.mimeType, body: Readable.from(bytes) },
    fields: 'id',
  });
  const fileId = created.data.id;
  if (!fileId) {
    throw new Error('Drive did not return a file id for the staged image.');
  }
  const release = async (): Promise<void> => {
    try {
      await drive.files.delete({ fileId });
    } catch {
      // The image is already copied into the deck. A failed cleanup must not
      // fail the tool, but the file stays link-readable until removed by hand.
      console.error(`Failed to delete staged Drive file ${fileId}. Remove it manually.`);
    }
  };
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone', allowFileDiscovery: false },
    });
    const probe = await probeForms(fileId, 0);
    return { ...probe, release };
  } catch (error: unknown) {
    await release();
    throw error;
  }
};

// Narrowed at runtime rather than asserted: googleapis types `data` by the
// resource schema, which does not describe an arraybuffer response.
const toBuffer = (data: unknown): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data));
  }
  throw new Error('Drive returned an unexpected body for the image download.');
};

export const downloadDriveFile = async (drive: drive_v3.Drive, fileId: string): Promise<Buffer> => {
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return toBuffer(response.data);
};
