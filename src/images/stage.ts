import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { validateImageBytes } from './validate.js';
import type { drive_v3 } from 'googleapis';

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const PROBE_TIMEOUT_MS = 10000;
const PROBE_ATTEMPTS = 3;
const PROBE_BACKOFF_MS = 750;
// Enough for a PNG or GIF header and for the SOF marker of any ordinary JPEG.
const PREFIX_BYTES = 65536;

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

/**
 * A blip and a refusal are not the same answer. Treating a dropped connection
 * as proof that a URL form is dead once made a whole insert fail even though
 * every form was working, so transient conditions are retried and only a
 * definitive rejection retires a form.
 */
type ProbeOutcome = 'ok' | 'dead' | 'transient';

export type Probe = {
  outcome: ProbeOutcome;
  /** The leading bytes of the response, kept so the format can be checked. */
  prefix?: Buffer;
};

const classify = (response: Response): ProbeOutcome => {
  if (response.status === HTTP_TOO_MANY_REQUESTS || response.status >= HTTP_SERVER_ERROR) {
    return 'transient';
  }
  if (response.status < HTTP_OK_MIN || response.status > HTTP_OK_MAX) {
    return 'dead';
  }
  return response.headers.get('content-type')?.startsWith('image/') === true ? 'ok' : 'dead';
};

type Reader = ReadableStreamDefaultReader<Uint8Array>;

/** Reads only the leading bytes, then drops the rest of the body. */
const readChunks = async (reader: Reader, chunks: Uint8Array[], total: number): Promise<Buffer> => {
  if (total >= PREFIX_BYTES) {
    await reader.cancel();
    return Buffer.concat(chunks);
  }
  const result = await reader.read();
  if (result.done) {
    return Buffer.concat(chunks);
  }
  chunks.push(result.value);
  return readChunks(reader, chunks, total + result.value.length);
};

const readPrefix = async (response: Response): Promise<Buffer | undefined> => {
  const reader = response.body?.getReader();
  if (!reader) {
    return undefined;
  }
  try {
    return await readChunks(reader, [], 0);
  } catch {
    return undefined;
  }
};

/** Fetches unauthenticated, exactly as Google's servers will. */
const fetchProbe = async (url: string): Promise<Probe> => {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const outcome = classify(response);
  if (outcome !== 'ok') {
    return { outcome };
  }
  return { outcome, prefix: await readPrefix(response) };
};

const probeOnce = async (url: string): Promise<Probe> => {
  try {
    return await fetchProbe(url);
  } catch {
    // A network error, a timeout or an abort. None of these say the URL is bad.
    return { outcome: 'transient' };
  }
};

const probeAttempt = async (url: string, attempt: number): Promise<Probe> => {
  const probe = await probeOnce(url);
  if (probe.outcome !== 'transient' || attempt >= PROBE_ATTEMPTS) {
    return probe;
  }
  await delay(PROBE_BACKOFF_MS * attempt);
  return probeAttempt(url, attempt + 1);
};

export const probeImage = async (url: string): Promise<Probe> => probeAttempt(url, 1);

export const probeUrl = async (url: string): Promise<boolean> => (await probeAttempt(url, 1)).outcome === 'ok';

/**
 * Walks the forms in order and stops at the first that serves an image.
 * Deliberately sequential rather than parallel: the forms are ranked by
 * fidelity, so the earliest success is the one worth keeping.
 */
const probeFailure = (sawTransient: boolean): Error => {
  const tried = urlForms.map((item) => item.name).join(', ');
  if (sawTransient) {
    return new Error(
      `The staged Drive file could not be reached (tried: ${tried}). Some attempts failed with a network or rate-limit ` +
        'error rather than a refusal, so this is likely temporary. Retry the call.'
    );
  }
  return new Error(
    `The staged Drive file was not publicly fetchable through any known URL form (tried: ${tried}). ` +
      'Google fetches image URLs server-side and unauthenticated, so the image could not be inserted.'
  );
};

const probeForms = async (fileId: string, index: number, sawTransient: boolean): Promise<ProbeResult> => {
  if (index >= urlForms.length) {
    throw probeFailure(sawTransient);
  }
  const form = urlForms[index];
  const url = form.build(fileId);
  const probe = await probeAttempt(url, 1);
  if (probe.outcome === 'ok') {
    return { url, urlForm: form.name };
  }
  return probeForms(fileId, index + 1, sawTransient || probe.outcome === 'transient');
};

export type StagedImage = ProbeResult & {
  release: () => Promise<void>;
  natural?: { width: number; height: number };
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
    const probe = await probeForms(fileId, 0, false);
    const natural =
      format.width === undefined || format.height === undefined
        ? undefined
        : { width: format.width, height: format.height };
    return { ...probe, release, natural };
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
