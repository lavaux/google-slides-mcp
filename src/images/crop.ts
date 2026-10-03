import sharp, { type Sharp } from 'sharp';
import { sniffFormat, validateImageBytes } from './validate.js';

/** A rectangle in source pixels, origin at the top-left corner. */
export type CropBox = { x: number; y: number; width: number; height: number };

export type PixelSize = { width: number; height: number };

const JPEG_QUALITY = 92;

/**
 * Names the image's real size, because a caller choosing pixels has usually
 * guessed it from the frame, which is in points and says nothing about pixels.
 */
export const checkCropBox = (box: CropBox, size: PixelSize): void => {
  if (box.x + box.width <= size.width && box.y + box.height <= size.height) {
    return;
  }
  throw new Error(
    `Crop box ${String(box.width)}x${String(box.height)} at (${String(box.x)}, ${String(box.y)}) runs past the image, which is ${String(size.width)}x${String(size.height)} pixels. Run get_image_info to read the size.`
  );
};

export type ImageInfo = PixelSize & { format: string; frames: number };

/** An animated image reports the height of all its frames stacked; one frame's height is what a caller sees. */
export const imageInfo = async (bytes: Buffer): Promise<ImageInfo> => {
  const format = validateImageBytes(bytes);
  const meta = await sharp(bytes, { animated: true }).metadata();
  const frames = meta.pages ?? 1;
  return {
    format: format.extension,
    width: meta.width,
    height: meta.pageHeight ?? meta.height,
    frames,
  };
};

const ENCODERS: Record<string, (image: Sharp) => Sharp> = {
  png: (image) => image.png(),
  jpg: (image) => image.jpeg({ quality: JPEG_QUALITY }),
  gif: (image) => image.gif(),
};

/**
 * Crops every frame and writes the source format back, so a PNG stays lossless
 * and an animated GIF stays animated.
 */
export const cropBytes = async (bytes: Buffer, box: CropBox): Promise<Buffer> => {
  const info = await imageInfo(bytes);
  checkCropBox(box, info);
  const extension = sniffFormat(bytes)?.extension ?? 'png';
  const encode = ENCODERS[extension] ?? ENCODERS.png;
  const extracted = sharp(bytes, { animated: true }).extract({
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
  });
  const cropped = await encode(extracted).toBuffer();
  validateImageBytes(cropped);
  return cropped;
};
