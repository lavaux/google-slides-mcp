import { resizeTransform, translateEmu, visualSize, type Size } from './geometry.js';
import type { slides_v1 } from 'googleapis';

type CropBox = { x: number; y: number; width: number; height: number };

export type Frame = { transform: slides_v1.Schema$AffineTransform; intrinsic: Size };

export type FrameBox = { width: number; height: number; x: number; y: number };

/**
 * Where the frame of a cropped image must end up, in EMU, so that the pixels it
 * keeps stay exactly where and how large they were, as a crop in the Slides
 * editor behaves.
 *
 * The frame shrinks by the kept fraction on each axis, and its anchor moves to
 * where the kept region's top-left corner sat. That corner is mapped through the
 * element's own matrix, so a rotated image is cropped along its rotated axes.
 */
export const croppedBox = ({ transform, intrinsic }: Frame, source: Size, box: CropBox): FrameBox => {
  const visual = visualSize(intrinsic, transform);
  const px = (box.x / source.width) * intrinsic.width;
  const py = (box.y / source.height) * intrinsic.height;
  return {
    width: (visual.width * box.width) / source.width,
    height: (visual.height * box.height) / source.height,
    x: translateEmu(transform.translateX, transform.unit) + (transform.scaleX ?? 0) * px + (transform.shearX ?? 0) * py,
    y: translateEmu(transform.translateY, transform.unit) + (transform.shearY ?? 0) * px + (transform.scaleY ?? 0) * py,
  };
};

/**
 * The transform that puts a frame at `target`, applied to whatever replaceImage
 * left behind. Google re-derives the intrinsic size from the new pixels and fits
 * them inside the old frame keeping their aspect ratio, so a stretched image
 * would come back un-stretched and re-centred. Writing the transform afterwards
 * restores the frame the crop asked for.
 */
export const placeFrame = (after: Frame, target: FrameBox): slides_v1.Schema$AffineTransform =>
  resizeTransform(after.transform, after.intrinsic, target);

/** A crop made in the Slides editor. Replacing the pixels would combine with it unpredictably. */
export const hasEditorCrop = (image: slides_v1.Schema$Image | undefined): boolean => {
  const crop = image?.imageProperties?.cropProperties;
  return [crop?.leftOffset, crop?.rightOffset, crop?.topOffset, crop?.bottomOffset, crop?.angle].some(
    (value) => typeof value === 'number' && value !== 0
  );
};
