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

const readEmu = (value: slides_v1.Schema$Dimension | undefined): number | undefined => {
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
