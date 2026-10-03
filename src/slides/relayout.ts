import { describeKind, elementKind, hasText } from './elements.js';
import { buildUpdate, leaf } from './style.js';
import type { slides_v1 } from 'googleapis';

type Request = slides_v1.Schema$Request;

export type SourcePlaceholder = { objectId: string; type: string; index: number; text: slides_v1.Schema$TextContent };

export type TargetPlaceholder = { objectId: string; type: string; index: number };

export type PlaceholderMapping = {
  sourceObjectId: string;
  layoutPlaceholderObjectId: string;
  text: slides_v1.Schema$TextContent;
};

/**
 * Placeholder types that stand in for one another across layouts. A title slide
 * has CENTERED_TITLE where a content slide has TITLE, and the text belongs in
 * either.
 */
const FAMILY: Record<string, string> = { CENTERED_TITLE: 'TITLE' };

const familyOf = (type: string): string => FAMILY[type] ?? type;

const byIndex = <T extends { index: number }>(items: T[]): T[] => items.toSorted((a, b) => a.index - b.index);

/**
 * Every element on the slide has to be a placeholder. Anything else (an image, a
 * free text box, a table) cannot be moved to another slide through the API, so
 * it would be lost when the old slide is deleted.
 */
export const sourcePlaceholders = (slide: slides_v1.Schema$Page): SourcePlaceholder[] => {
  const elements = slide.pageElements ?? [];
  const blockers = elements.filter((element) => !element.shape?.placeholder);
  if (blockers.length > 0) {
    const listed = blockers.map((element) => `"${element.objectId}" (${describeKind(elementKind(element))})`);
    throw new Error(
      `Slide "${slide.objectId}" holds elements that are not placeholders: ${listed.join(', ')}. The Slides API cannot change a slide's layout, so relayout recreates the slide and only placeholder text can be carried across. Move or delete these elements first, or add a new slide on the target layout and rebuild it there. Use copy_presentation first if you want a backup.`
    );
  }
  return elements.flatMap((element) => {
    const placeholder = element.shape?.placeholder;
    const text = element.shape?.text;
    if (!placeholder || !hasText(text ?? undefined)) {
      return [];
    }
    return [
      {
        objectId: element.objectId ?? '',
        type: placeholder.type ?? '',
        index: placeholder.index ?? 0,
        text: text ?? {},
      },
    ];
  });
};

export const targetPlaceholders = (layout: slides_v1.Schema$Page): TargetPlaceholder[] =>
  (layout.pageElements ?? []).flatMap((element) => {
    const placeholder = element.shape?.placeholder;
    return placeholder
      ? [{ objectId: element.objectId ?? '', type: placeholder.type ?? '', index: placeholder.index ?? 0 }]
      : [];
  });

/**
 * Pairs each filled placeholder with one on the target layout: same type family
 * first, then in index order, so a two-column slide's columns stay in order.
 * Empty placeholders are not carried, so they never block a relayout.
 */
export const mapPlaceholders = (source: SourcePlaceholder[], target: TargetPlaceholder[]): PlaceholderMapping[] => {
  const families = [...new Set(source.map((item) => familyOf(item.type)))];
  const unmatched: SourcePlaceholder[] = [];
  const mappings = families.flatMap((family) => {
    const from = byIndex(source.filter((item) => familyOf(item.type) === family));
    const to = byIndex(target.filter((item) => familyOf(item.type) === family));
    unmatched.push(...from.slice(to.length));
    return from.slice(0, to.length).map((item, position) => ({
      sourceObjectId: item.objectId,
      layoutPlaceholderObjectId: to[position].objectId,
      text: item.text,
    }));
  });
  if (unmatched.length > 0) {
    const listed = unmatched.map((item) => `"${item.objectId}" (${item.type})`);
    throw new Error(
      `The target layout has no free placeholder for ${listed.join(', ')}, so that text would be lost. Pick a layout that offers these placeholder types (list_layouts shows them), or clear the text first.`
    );
  }
  return mappings;
};

const appendRun = (paragraphs: Paragraph[], item: slides_v1.Schema$TextElement): void => {
  const current = paragraphs.at(-1);
  if (current === undefined) {
    paragraphs.push({ runs: [item], start: item.startIndex ?? 0, marker: undefined });
  } else {
    current.runs.push(item);
  }
};

type Paragraph = {
  /** Text runs in order. The last one carries the paragraph's newline. */
  runs: slides_v1.Schema$TextElement[];
  start: number;
  marker: slides_v1.Schema$ParagraphMarker | undefined;
};

/** Each paragraph marker opens a paragraph, and the text runs after it belong to it. */
const paragraphsOf = (text: slides_v1.Schema$TextContent): Paragraph[] => {
  const paragraphs: Paragraph[] = [];
  (text.textElements ?? []).forEach((item) => {
    if (item.paragraphMarker) {
      paragraphs.push({ runs: [], start: item.startIndex ?? 0, marker: item.paragraphMarker });
    } else if (item.textRun) {
      appendRun(paragraphs, item);
    }
  });
  return paragraphs;
};

const NUMBERED_GLYPH = /^\(?[0-9a-zA-Z]+[.)]/;

const bulletPreset = (bullet: slides_v1.Schema$Bullet): string =>
  NUMBERED_GLYPH.test(bullet.glyph ?? '') ? 'NUMBERED_DIGIT_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE';

/** Every present key, written whole. The mask names exactly what the payload carries. */
const presentKeys = (style: object | undefined | null) =>
  buildUpdate(Object.entries(style ?? {}).map(([key, value]) => (value === null ? undefined : leaf(key, value))));

type Range = { start: number; end: number };

const fixedRange = (range: Range): slides_v1.Schema$Range => ({
  type: 'FIXED_RANGE',
  startIndex: range.start,
  endIndex: range.end,
});

type Laid = {
  text: string;
  styles: { range: Range; style: slides_v1.Schema$TextStyle }[];
  paragraphStyles: { range: Range; style: slides_v1.Schema$ParagraphStyle }[];
  bullets: { range: Range; preset: string }[];
};

/**
 * Rebuilds the text with a leading tab per nesting level on each bulleted
 * paragraph, because createParagraphBullets turns those tabs into nesting and
 * there is no other way to set a level through the API.
 */
const layOut = (paragraphs: Paragraph[]): Laid => {
  const laid: Laid = { text: '', styles: [], paragraphStyles: [], bullets: [] };
  paragraphs.forEach((paragraph) => {
    const bullet = paragraph.marker?.bullet;
    const prefix = bullet ? '\t'.repeat(bullet.nestingLevel ?? 0) : '';
    const begin = laid.text.length;
    const shift = begin + prefix.length - paragraph.start;
    laid.text += prefix + paragraph.runs.map((run) => run.textRun?.content ?? '').join('');
    const range = { start: begin, end: laid.text.length };
    laid.styles.push(
      ...paragraph.runs.map((run) => ({
        range: { start: (run.startIndex ?? 0) + shift, end: (run.endIndex ?? 0) + shift },
        style: run.textRun?.style ?? {},
      }))
    );
    laid.paragraphStyles.push({ range, style: paragraph.marker?.style ?? {} });
    if (bullet) {
      laid.bullets.push({ range, preset: bulletPreset(bullet) });
    }
  });
  return laid;
};

/** Neighbouring bulleted paragraphs of one kind become one list, as they were. */
const mergeBullets = (bullets: Laid['bullets']): Laid['bullets'] => {
  const merged: Laid['bullets'] = [];
  bullets.forEach((item) => {
    const last = merged.at(-1);
    if (last !== undefined && last.preset === item.preset && last.range.end === item.range.start) {
      last.range = { start: last.range.start, end: item.range.end };
    } else {
      merged.push({ ...item });
    }
  });
  return merged;
};

const clamp = (range: Range, length: number): Range | undefined => {
  const end = Math.min(range.end, length);
  return range.start < end ? { start: range.start, end } : undefined;
};

/**
 * The requests that write `text` into an empty shape with its run styles,
 * paragraph styles and bullets.
 *
 * A shape's text always ends in a newline that the shape supplies itself, so the
 * final one is dropped before inserting or the copy would gain an empty
 * paragraph. Bullets go last and from the end backwards: each one removes its
 * nesting tabs, which shifts every index after it.
 */
export const textRequests = (objectId: string, text: slides_v1.Schema$TextContent): Request[] => {
  const laid = layOut(paragraphsOf(text));
  const content = laid.text.endsWith('\n') ? laid.text.slice(0, -1) : laid.text;
  if (content === '') {
    return [];
  }
  const styled = laid.styles.flatMap(({ range, style }) => {
    const clamped = clamp(range, content.length);
    const update = presentKeys(style);
    return clamped === undefined || update.fields === ''
      ? []
      : [
          {
            updateTextStyle: {
              objectId,
              textRange: fixedRange(clamped),
              style: { ...update.properties },
              fields: update.fields,
            },
          },
        ];
  });
  const paragraphs = laid.paragraphStyles.flatMap(({ range, style }) => {
    const clamped = clamp(range, content.length);
    const update = presentKeys(style);
    return clamped === undefined || update.fields === ''
      ? []
      : [
          {
            updateParagraphStyle: {
              objectId,
              textRange: fixedRange(clamped),
              style: { ...update.properties },
              fields: update.fields,
            },
          },
        ];
  });
  const bullets = mergeBullets(laid.bullets)
    .toReversed()
    .flatMap(({ range, preset }) => {
      const clamped = clamp(range, content.length);
      return clamped === undefined
        ? []
        : [{ createParagraphBullets: { objectId, textRange: fixedRange(clamped), bulletPreset: preset } }];
    });
  return [{ insertText: { objectId, text: content, insertionIndex: 0 } }, ...styled, ...paragraphs, ...bullets];
};
