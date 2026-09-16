const MAX_BYTES = 52428800;
const MAX_PIXELS = 25000000;
const BYTES_PER_MB = 1048576;
const HEX_CHARS_PER_BYTE = 2;

const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';
const JPEG_SIGNATURE_HEX = 'ffd8ff';
const GIF_SIGNATURE_HEX = '47494638';

const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const GIF_WIDTH_OFFSET = 6;
const GIF_HEIGHT_OFFSET = 8;

const JPEG_FIRST_SEGMENT_OFFSET = 2;
const JPEG_MARKER_PREFIX = 0xff;
const JPEG_TEM = 0x01;
const JPEG_RST_FIRST = 0xd0;
const JPEG_RST_LAST = 0xd9;
const JPEG_SOF_FIRST = 0xc0;
const JPEG_SOF_LAST = 0xcf;
const JPEG_DHT = 0xc4;
const JPEG_JPG = 0xc8;
const JPEG_DAC = 0xcc;
const JPEG_SOF_HEIGHT_OFFSET = 5;
const JPEG_SOF_WIDTH_OFFSET = 7;

const U16 = Uint16Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;

export type ImageFormat = {
  mimeType: string;
  extension: string;
};

// Compared as hex so the byte signatures stay readable and carry no bare numbers.
const startsWithHex = (bytes: Buffer, hex: string): boolean => {
  const byteLength = hex.length / HEX_CHARS_PER_BYTE;
  if (bytes.length < byteLength) {
    return false;
  }
  return bytes.subarray(0, byteLength).toString('hex') === hex;
};

export const sniffFormat = (bytes: Buffer): ImageFormat | undefined => {
  if (startsWithHex(bytes, PNG_SIGNATURE_HEX)) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (startsWithHex(bytes, JPEG_SIGNATURE_HEX)) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWithHex(bytes, GIF_SIGNATURE_HEX)) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  return undefined;
};

type Dimensions = {
  width: number;
  height: number;
};

const pngDimensions = (bytes: Buffer): Dimensions | undefined => {
  if (bytes.length < PNG_IHDR_HEIGHT_OFFSET + U32) {
    return undefined;
  }
  return {
    width: bytes.readUInt32BE(PNG_IHDR_WIDTH_OFFSET),
    height: bytes.readUInt32BE(PNG_IHDR_HEIGHT_OFFSET),
  };
};

const gifDimensions = (bytes: Buffer): Dimensions | undefined => {
  if (bytes.length < GIF_HEIGHT_OFFSET + U16) {
    return undefined;
  }
  return {
    width: bytes.readUInt16LE(GIF_WIDTH_OFFSET),
    height: bytes.readUInt16LE(GIF_HEIGHT_OFFSET),
  };
};

// Standalone markers carry no length field, so a segment walk must step over them.
const isStandaloneMarker = (marker: number): boolean =>
  marker === JPEG_TEM || (marker >= JPEG_RST_FIRST && marker <= JPEG_RST_LAST);

// SOF0..SOF15 hold the frame dimensions. DHT, JPG and DAC share the range and do not.
const isFrameMarker = (marker: number): boolean =>
  marker >= JPEG_SOF_FIRST &&
  marker <= JPEG_SOF_LAST &&
  marker !== JPEG_DHT &&
  marker !== JPEG_JPG &&
  marker !== JPEG_DAC;

const frameDimensions = (bytes: Buffer, offset: number): Dimensions | undefined => {
  if (offset + JPEG_SOF_WIDTH_OFFSET + U16 > bytes.length) {
    return undefined;
  }
  return {
    height: bytes.readUInt16BE(offset + JPEG_SOF_HEIGHT_OFFSET),
    width: bytes.readUInt16BE(offset + JPEG_SOF_WIDTH_OFFSET),
  };
};

/**
 * Walks JPEG segment to segment rather than byte to byte. Each segment declares
 * its own length, so the number of steps is small and bounded.
 */
const scanSegments = (bytes: Buffer, offset: number): Dimensions | undefined => {
  if (offset + U16 >= bytes.length) {
    return undefined;
  }
  if (bytes[offset] !== JPEG_MARKER_PREFIX) {
    return undefined;
  }
  const marker = bytes[offset + 1] ?? 0;
  // A repeated 0xFF is padding before the real marker.
  if (marker === JPEG_MARKER_PREFIX || isStandaloneMarker(marker)) {
    return scanSegments(bytes, offset + 1);
  }
  if (isFrameMarker(marker)) {
    return frameDimensions(bytes, offset);
  }
  return scanSegments(bytes, offset + U16 + bytes.readUInt16BE(offset + U16));
};

export const readDimensions = (bytes: Buffer, mimeType: string): Dimensions | undefined => {
  if (mimeType === 'image/png') {
    return pngDimensions(bytes);
  }
  if (mimeType === 'image/gif') {
    return gifDimensions(bytes);
  }
  return scanSegments(bytes, JPEG_FIRST_SEGMENT_OFFSET);
};

const megapixelError = (dimensions: Dimensions): string =>
  `Image is ${String(dimensions.width)}x${String(dimensions.height)} pixels. The Google Slides API limit is 25 megapixels.`;

/**
 * Google answers every createImage failure with one opaque message that never
 * says which constraint was violated. Checking locally is the only way a caller
 * learns what actually went wrong.
 */
export const validateImageBytes = (bytes: Buffer): ImageFormat => {
  const format = sniffFormat(bytes);
  if (!format) {
    throw new Error(
      'Unsupported image format. The Google Slides API accepts PNG, JPEG and GIF only. SVG and WebP are not supported.'
    );
  }
  if (bytes.length > MAX_BYTES) {
    throw new Error(
      `Image is ${String(Math.round(bytes.length / BYTES_PER_MB))} MB. The Google Slides API limit is 50 MB.`
    );
  }
  const dimensions = readDimensions(bytes, format.mimeType);
  if (dimensions && dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new Error(megapixelError(dimensions));
  }
  return format;
};
