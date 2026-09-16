import type { slides_v1 } from 'googleapis';

const EMU_PER_POINT = 12700;
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

/**
 * Resolves caller placement (in points) against the deck's own page size.
 * Any omitted field falls back to a centred box inside a half-inch margin.
 * The page size is read rather than hardcoded because 4:3 and custom decks
 * are common.
 */
export const resolveBox = (placement: Placement, page: PageSize): Box => {
  const maxWidth = page.width - DEFAULT_MARGIN_EMU * HALF;
  const maxHeight = page.height - DEFAULT_MARGIN_EMU * HALF;
  const width = placement.width === undefined ? maxWidth : pointsToEmu(placement.width);
  const height = placement.height === undefined ? maxHeight : pointsToEmu(placement.height);
  return {
    width,
    height,
    x: placement.x === undefined ? Math.round((page.width - width) / HALF) : pointsToEmu(placement.x),
    y: placement.y === undefined ? Math.round((page.height - height) / HALF) : pointsToEmu(placement.y),
  };
};
