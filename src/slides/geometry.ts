import type { slides_v1 } from 'googleapis';

const EMU_PER_POINT = 12700;
const EMU_PER_PIXEL = 9525;
const EMU_PER_INCH = 914400;
const DEFAULT_MARGIN_EMU = EMU_PER_INCH / 2;
const HALF = 2;

export const pointsToEmu = (points: number): number => Math.round(points * EMU_PER_POINT);

export const emuToPoints = (emu: number): number => emu / EMU_PER_POINT;

export type Placement = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Size = {
  width: number;
  height: number;
};

/** Pixel dimensions of the image itself, when they are known. */
export type Natural = Size;

const dimension = (magnitude: number): slides_v1.Schema$Dimension => ({ magnitude, unit: 'EMU' });

/**
 * Builds elementProperties with an explicit unit scale.
 *
 * scaleX/scaleY must always be sent. An ABSOLUTE transform zeroes every field
 * omitted from it, which collapses the element to nothing. Holding both at
 * exactly 1 also makes `size` the visual size, so callers never have to reason
 * about the affine matrix.
 */
export const elementProperties = (pageObjectId: string, box: Box): slides_v1.Schema$PageElementProperties => ({
  pageObjectId,
  size: {
    width: dimension(box.width),
    height: dimension(box.height),
  },
  transform: {
    scaleX: 1,
    scaleY: 1,
    translateX: box.x,
    translateY: box.y,
    unit: 'EMU',
  },
});

export const readEmu = (value: slides_v1.Schema$Dimension | undefined): number | undefined => {
  if (!value || typeof value.magnitude !== 'number') {
    return undefined;
  }
  return value.unit === 'PT' ? pointsToEmu(value.magnitude) : value.magnitude;
};

export type PageSize = {
  width: number;
  height: number;
};

export const readPageSize = (presentation: slides_v1.Schema$Presentation): PageSize | undefined => {
  const width = readEmu(presentation.pageSize?.width);
  const height = readEmu(presentation.pageSize?.height);
  if (width === undefined || height === undefined) {
    return undefined;
  }
  return { width, height };
};

const naturalEmu = (natural: Natural): Size => ({
  width: natural.width * EMU_PER_PIXEL,
  height: natural.height * EMU_PER_PIXEL,
});

/** Shrinks to fit the bounds, never enlarges past the image's own size. */
const fitWithin = (natural: Size, bounds: Size): Size => {
  const scale = Math.min(bounds.width / natural.width, bounds.height / natural.height, 1);
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
};

/**
 * Derives the frame the image is placed in.
 *
 * A caller who gives one dimension gets the other from the image's aspect
 * ratio, so a width alone cannot produce a frame that runs off the slide. With
 * no dimensions at all the image keeps its own size, shrunk to fit the margins.
 */
const heightFor = (width: number, bounds: Size, image: Size | undefined): number =>
  image === undefined ? bounds.height : Math.round((width * image.height) / image.width);

const widthFor = (height: number, bounds: Size, image: Size | undefined): number =>
  image === undefined ? bounds.width : Math.round((height * image.width) / image.height);

const sizeFor = (placement: Placement, bounds: Size, natural: Natural | undefined): Size => {
  const width = placement.width === undefined ? undefined : pointsToEmu(placement.width);
  const height = placement.height === undefined ? undefined : pointsToEmu(placement.height);
  const image = natural === undefined ? undefined : naturalEmu(natural);
  if (width !== undefined && height !== undefined) {
    return { width, height };
  }
  if (width !== undefined) {
    return { width, height: heightFor(width, bounds, image) };
  }
  if (height !== undefined) {
    return { width: widthFor(height, bounds, image), height };
  }
  return image === undefined ? bounds : fitWithin(image, bounds);
};

/**
 * Resolves caller placement (in points) against the deck's own page size.
 * Any omitted field falls back to centring inside a half-inch margin. The page
 * size is read rather than hardcoded because 4:3 and custom decks are common.
 */
export const resolveBox = (placement: Placement, page: PageSize, natural?: Natural): Box => {
  const bounds = {
    width: page.width - DEFAULT_MARGIN_EMU * HALF,
    height: page.height - DEFAULT_MARGIN_EMU * HALF,
  };
  const size = sizeFor(placement, bounds, natural);
  return {
    ...size,
    x: placement.x === undefined ? Math.round((page.width - size.width) / HALF) : pointsToEmu(placement.x),
    y: placement.y === undefined ? Math.round((page.height - size.height) / HALF) : pointsToEmu(placement.y),
  };
};

/**
 * Style dimensions travel in points. The API accepts PT directly for font size,
 * outline weight and paragraph spacing, so there is no EMU round-trip to lose.
 */
export const points = (magnitude: number): slides_v1.Schema$Dimension => ({ magnitude, unit: 'PT' });

/** A transform carries its own unit, and the translate terms obey it. Scales do not. */
export const translateEmu = (value: number | null | undefined, unit: string | null | undefined): number => {
  if (typeof value !== 'number') {
    return 0;
  }
  return unit === 'PT' ? pointsToEmu(value) : value;
};

export type AxisScales = { x: number; y: number };

/**
 * Rotation lives in the shear terms, so the scale an axis is actually rendered at
 * is the magnitude of its column in the affine matrix, not scaleX or scaleY alone.
 */
export const axisScales = (transform: slides_v1.Schema$AffineTransform): AxisScales => ({
  x: Math.hypot(transform.scaleX ?? 0, transform.shearY ?? 0),
  y: Math.hypot(transform.shearX ?? 0, transform.scaleY ?? 0),
});

/** The size the element is rendered at, as opposed to the intrinsic size Google stores. */
export const visualSize = (intrinsic: Size, transform: slides_v1.Schema$AffineTransform): Size => {
  const scales = axisScales(transform);
  return { width: intrinsic.width * scales.x, height: intrinsic.height * scales.y };
};

/** Target extents and position in EMU. An omitted field keeps its current value. */
export type TargetBox = {
  width?: number | undefined;
  height?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
};

/**
 * Names the axis that cannot be resized, or undefined when the request is sound.
 *
 * A degenerate intrinsic extent is normal rather than exotic: a perfectly
 * horizontal line has zero height. Dividing by it yields Infinity, which either
 * errors at Google or collapses the element to nothing.
 */
export const resizeBlocker = (intrinsic: Size, scales: AxisScales, target: TargetBox): string | undefined => {
  if (target.width !== undefined && (intrinsic.width === 0 || scales.x === 0)) {
    return 'width';
  }
  if (target.height !== undefined && (intrinsic.height === 0 || scales.y === 0)) {
    return 'height';
  }
  return undefined;
};

const factor = (target: number | undefined, intrinsic: number, scale: number): number =>
  target === undefined ? 1 : target / (intrinsic * scale);

/**
 * Replaces the whole affine matrix, which is the only way to set a size: the API
 * has no resize request, and an ABSOLUTE transform zeroes every field it omits.
 *
 * Each column is scaled as a unit so a rotated element keeps its angle. Writing
 * scaleX on its own would silently un-rotate it, because the angle is carried by
 * the shear terms that sit in the same columns.
 */
export const resizeTransform = (
  transform: slides_v1.Schema$AffineTransform,
  intrinsic: Size,
  target: TargetBox
): slides_v1.Schema$AffineTransform => {
  const scales = axisScales(transform);
  const alongX = factor(target.width, intrinsic.width, scales.x);
  const alongY = factor(target.height, intrinsic.height, scales.y);
  return {
    scaleX: (transform.scaleX ?? 0) * alongX,
    shearY: (transform.shearY ?? 0) * alongX,
    shearX: (transform.shearX ?? 0) * alongY,
    scaleY: (transform.scaleY ?? 0) * alongY,
    translateX: target.x ?? translateEmu(transform.translateX, transform.unit),
    translateY: target.y ?? translateEmu(transform.translateY, transform.unit),
    unit: 'EMU',
  };
};

const POINT_PRECISION = 10;

/** Points, rounded for reporting back to a caller who asked in points. */
export const toPointsRounded = (emu: number): number =>
  Math.round(emuToPoints(emu) * POINT_PRECISION) / POINT_PRECISION;
