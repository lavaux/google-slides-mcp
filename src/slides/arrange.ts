import { readEmu, translateEmu, type Box, type Size } from './geometry.js';
import type { slides_v1 } from 'googleapis';

const HALF = 2;

/**
 * The axis-aligned box an element visibly covers, in EMU. For a rotated element
 * this is the box around its four transformed corners, which is what a reader
 * lines up by eye, not the anchor Slides stores in translateX and translateY.
 */
export const boundingBox = (intrinsic: Size, transform: slides_v1.Schema$AffineTransform): Box => {
  const tx = translateEmu(transform.translateX, transform.unit);
  const ty = translateEmu(transform.translateY, transform.unit);
  const corners = [
    [0, 0],
    [intrinsic.width, 0],
    [0, intrinsic.height],
    [intrinsic.width, intrinsic.height],
  ].map(([cx, cy]) => ({
    x: (transform.scaleX ?? 0) * cx + (transform.shearX ?? 0) * cy + tx,
    y: (transform.shearY ?? 0) * cx + (transform.scaleY ?? 0) * cy + ty,
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

export type Delta = { dx: number; dy: number };

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** The smallest box holding every given box. */
export const unionBox = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
};

const EDGE_DELTAS: Record<AlignEdge, (box: Box, reference: Box) => Delta> = {
  left: (box, reference) => ({ dx: reference.x - box.x, dy: 0 }),
  center: (box, reference) => ({ dx: reference.x + reference.width / HALF - (box.x + box.width / HALF), dy: 0 }),
  right: (box, reference) => ({ dx: reference.x + reference.width - (box.x + box.width), dy: 0 }),
  top: (box, reference) => ({ dx: 0, dy: reference.y - box.y }),
  middle: (box, reference) => ({ dx: 0, dy: reference.y + reference.height / HALF - (box.y + box.height / HALF) }),
  bottom: (box, reference) => ({ dx: 0, dy: reference.y + reference.height - (box.y + box.height) }),
};

/** How far each box must move so its chosen edge or centre lines up with the reference's. */
export const alignDeltas = (boxes: Box[], reference: Box, edge: AlignEdge): Delta[] =>
  boxes.map((box) => EDGE_DELTAS[edge](box, reference));

export type DistributeAxis = 'horizontal' | 'vertical';

type Span = { index: number; start: number; size: number };

const spanOf = (box: Box, index: number, axis: DistributeAxis): Span =>
  axis === 'horizontal' ? { index, start: box.x, size: box.width } : { index, start: box.y, size: box.height };

/**
 * Equal gaps between neighbouring boxes along one axis. The first and the last
 * box, by position, stay where they are and the others move between them. The
 * gap comes out negative when the boxes are wider than the span, which overlaps
 * them evenly rather than refusing.
 */
export const distributeDeltas = (boxes: Box[], axis: DistributeAxis): Delta[] => {
  const spans = boxes.map((box, index) => spanOf(box, index, axis)).toSorted((a, b) => a.start - b.start);
  const first = spans[0];
  const last = spans.at(-1) ?? first;
  const occupied = spans.reduce((sum, span) => sum + span.size, 0);
  const gap = (last.start + last.size - first.start - occupied) / (spans.length - 1);
  const moves = new Map<number, number>();
  spans.reduce((cursor, span) => {
    moves.set(span.index, cursor - span.start);
    return cursor + span.size + gap;
  }, first.start);
  return boxes.map((_, index) => {
    const move = moves.get(index) ?? 0;
    return axis === 'horizontal' ? { dx: move, dy: 0 } : { dx: 0, dy: move };
  });
};

type Matrix = {
  scaleX: number;
  shearX: number;
  shearY: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

const IDENTITY: Matrix = { scaleX: 1, shearX: 0, shearY: 0, scaleY: 1, translateX: 0, translateY: 0 };

const matrixOf = (transform: slides_v1.Schema$AffineTransform): Matrix => ({
  scaleX: transform.scaleX ?? 0,
  shearX: transform.shearX ?? 0,
  shearY: transform.shearY ?? 0,
  scaleY: transform.scaleY ?? 0,
  translateX: translateEmu(transform.translateX, transform.unit),
  translateY: translateEmu(transform.translateY, transform.unit),
});

/** Parent then child: a group child's absolute transform is its group's preconcatenated with its own. */
const compose = (parent: Matrix, child: Matrix): Matrix => ({
  scaleX: parent.scaleX * child.scaleX + parent.shearX * child.shearY,
  shearX: parent.scaleX * child.shearX + parent.shearX * child.scaleY,
  shearY: parent.shearY * child.scaleX + parent.scaleY * child.shearY,
  scaleY: parent.shearY * child.shearX + parent.scaleY * child.scaleY,
  translateX: parent.scaleX * child.translateX + parent.shearX * child.translateY + parent.translateX,
  translateY: parent.shearY * child.translateX + parent.scaleY * child.translateY + parent.translateY,
});

const boxWithin = (element: slides_v1.Schema$PageElement, parent: Matrix): Box[] => {
  const absolute = compose(parent, element.transform ? matrixOf(element.transform) : IDENTITY);
  const children = element.elementGroup?.children;
  if (children) {
    return children.flatMap((child) => boxWithin(child, absolute));
  }
  const width = readEmu(element.size?.width) ?? 0;
  const height = readEmu(element.size?.height) ?? 0;
  return [boundingBox({ width, height }, { ...absolute, unit: 'EMU' })];
};

/**
 * What an element visibly covers on its page, in EMU. A group reports no size of
 * its own, so its box is the union of its members' boxes.
 */
export const visibleBox = (element: slides_v1.Schema$PageElement): Box => unionBox(boxWithin(element, IDENTITY));
