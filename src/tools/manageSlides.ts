import { ManageSlidesArgsSchema, type ManageSlidesArgs } from '../layoutSchemas.js';
import { shortId } from '../slides/ids.js';
import {
  mapPlaceholders,
  sourcePlaceholders,
  targetPlaceholders,
  textRequests,
  type PlaceholderMapping,
} from '../slides/relayout.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

type Slides = slides_v1.Slides;
type Presentation = slides_v1.Schema$Presentation;

const batch = async (slides: Slides, presentationId: string, requests: slides_v1.Schema$Request[]) =>
  (await slides.presentations.batchUpdate({ presentationId, requestBody: { requests } })).data;

const slideIdsOf = async (slides: Slides, presentationId: string): Promise<string[]> =>
  ((await slides.presentations.get({ presentationId, fields: 'slides(objectId)' })).data.slides ?? []).map(
    (slide) => slide.objectId ?? ''
  );

const noSuchSlides = (ids: string[]): Error =>
  new Error(
    `No slide with object id ${ids.map((id) => `"${id}"`).join(', ')} in this presentation. Run list_layouts or list_page_elements to see slide ids.`
  );

const requireSlides = (existing: string[], wanted: string[]): void => {
  const unknown = wanted.filter((id) => !existing.includes(id));
  if (unknown.length > 0) {
    throw noSuchSlides(unknown);
  }
};

/** The API wants the moved slides in their current deck order, so the caller's order is not trusted. */
const move = async (slides: Slides, args: ManageSlidesArgs): Promise<unknown> => {
  const wanted = args.slideObjectIds ?? [];
  const existing = await slideIdsOf(slides, args.presentationId);
  requireSlides(existing, wanted);
  const ordered = existing.filter((id) => wanted.includes(id));
  await batch(slides, args.presentationId, [
    { updateSlidesPosition: { slideObjectIds: ordered, insertionIndex: args.insertionIndex } },
  ]);
  return { action: 'move', slideObjectIds: ordered, insertionIndex: args.insertionIndex };
};

const duplicate = async (slides: Slides, args: ManageSlidesArgs): Promise<unknown> => {
  const source = args.slideObjectId ?? '';
  requireSlides(await slideIdsOf(slides, args.presentationId), [source]);
  const copy = shortId('slide');
  // Naming the copy's id up front lets the move ride in the same batch.
  await batch(slides, args.presentationId, [
    { duplicateObject: { objectId: source, objectIds: { [source]: copy } } },
    ...(args.insertionIndex === undefined
      ? []
      : [{ updateSlidesPosition: { slideObjectIds: [copy], insertionIndex: args.insertionIndex } }]),
  ]);
  return { action: 'duplicate', slideObjectId: copy, duplicatedFrom: source };
};

const remove = async (slides: Slides, args: ManageSlidesArgs): Promise<unknown> => {
  const wanted = [...new Set(args.slideObjectIds ?? [])];
  const existing = await slideIdsOf(slides, args.presentationId);
  requireSlides(existing, wanted);
  if (wanted.length === existing.length) {
    throw new Error('Deleting every slide is refused. A presentation keeps at least one slide.');
  }
  await batch(
    slides,
    args.presentationId,
    wanted.map((objectId) => ({ deleteObject: { objectId } }))
  );
  return { action: 'delete', deleted: wanted, remaining: existing.length - wanted.length };
};

const RELAYOUT_FIELDS = [
  'slides(objectId,pageElements,slideProperties(layoutObjectId,notesPage))',
  'layouts(objectId,layoutProperties,pageElements(objectId,shape(placeholder)))',
].join(',');

/**
 * A predefined name is resolved to a concrete layout id, preferring the master the
 * slide already uses, because the placeholders have to be known before the slide
 * is rebuilt.
 */
const layoutById = (layouts: slides_v1.Schema$Page[], layoutObjectId: string): slides_v1.Schema$Page => {
  const found = layouts.find((layout) => layout.objectId === layoutObjectId);
  if (!found) {
    throw new Error(`No layout with object id "${layoutObjectId}". Run list_layouts to see layout ids.`);
  }
  return found;
};

const layoutByName = (layouts: slides_v1.Schema$Page[], name: string, currentLayoutId: string) => {
  const master = layouts.find((layout) => layout.objectId === currentLayoutId)?.layoutProperties?.masterObjectId;
  const named = layouts.filter((layout) => layout.layoutProperties?.name === name);
  const found = named.find((layout) => layout.layoutProperties?.masterObjectId === master) ?? named.at(0);
  if (!found) {
    throw new Error(
      `This presentation has no layout named ${name}. Its theme may rename or drop predefined layouts. Run list_layouts and pass layoutObjectId instead.`
    );
  }
  return found;
};

const targetLayout = (presentation: Presentation, args: ManageSlidesArgs, currentLayoutId: string) =>
  args.layoutObjectId === undefined
    ? layoutByName(presentation.layouts ?? [], args.layout ?? '', currentLayoutId)
    : layoutById(presentation.layouts ?? [], args.layoutObjectId);

const speakerNotes = (slide: slides_v1.Schema$Page): slides_v1.Schema$TextContent | undefined => {
  const notesPage = slide.slideProperties?.notesPage;
  const notesId = notesPage?.notesProperties?.speakerNotesObjectId;
  return notesPage?.pageElements?.find((element) => element.objectId === notesId)?.shape?.text ?? undefined;
};

type Plan = {
  slideObjectId: string;
  placeholderIds: Record<string, string>;
  requests: slides_v1.Schema$Request[];
};

/**
 * One atomic batch: delete, recreate at the same index, refill. Reusing the old
 * ids keeps links from other slides pointing at the right place. When Google will
 * not take an id back inside the batch that frees it, fresh ids are used instead.
 */
type Rebuild = {
  old: { objectId: string; index: number };
  layoutId: string;
  mappings: PlaceholderMapping[];
};

const rebuildPlan = ({ old, layoutId, mappings }: Rebuild, reuse: boolean): Plan => {
  const slideObjectId = reuse ? old.objectId : shortId('slide');
  const placeholderIds = Object.fromEntries(
    mappings.map((mapping) => [mapping.sourceObjectId, reuse ? mapping.sourceObjectId : shortId('placeholder')])
  );
  return {
    slideObjectId,
    placeholderIds,
    requests: [
      { deleteObject: { objectId: old.objectId } },
      {
        createSlide: {
          objectId: slideObjectId,
          insertionIndex: old.index,
          slideLayoutReference: { layoutId },
          placeholderIdMappings: mappings.map((mapping) => ({
            layoutPlaceholderObjectId: mapping.layoutPlaceholderObjectId,
            objectId: placeholderIds[mapping.sourceObjectId],
          })),
        },
      },
      ...mappings.flatMap((mapping) => textRequests(placeholderIds[mapping.sourceObjectId] ?? '', mapping.text)),
    ],
  };
};

const rebuild = async (
  slides: Slides,
  presentationId: string,
  plan: (reuse: boolean) => Plan
): Promise<{ plan: Plan; reusedIds: boolean }> => {
  const reused = plan(true);
  try {
    await batch(slides, presentationId, reused.requests);
    return { plan: reused, reusedIds: true };
  } catch {
    // The batch is atomic, so a refusal left the old slide untouched.
    const fresh = plan(false);
    await batch(slides, presentationId, fresh.requests);
    return { plan: fresh, reusedIds: false };
  }
};

type NotesTarget = { presentationId: string; slideObjectId: string };

/** The notes shape of a new slide only gets its id once the slide exists. */
const notesShapeId = async (slides: Slides, target: NotesTarget): Promise<string> => {
  const created = (
    await slides.presentations.get({
      presentationId: target.presentationId,
      fields: 'slides(objectId,slideProperties(notesPage(notesProperties)))',
    })
  ).data.slides?.find((slide) => slide.objectId === target.slideObjectId);
  return created?.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId ?? '';
};

/** The old slide is gone by now, so a failure hands the notes back rather than losing them. */
const notesFailure = (target: NotesTarget, notes: slides_v1.Schema$TextContent, error: unknown): Error => {
  const text = (notes.textElements ?? []).map((item) => item.textRun?.content ?? '').join('');
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `The slide was relaid out as "${target.slideObjectId}", but copying its speaker notes failed (${reason}). The notes were:\n${text}`,
    { cause: error }
  );
};

const copyNotes = async (
  slides: Slides,
  target: NotesTarget,
  notes: slides_v1.Schema$TextContent | undefined
): Promise<boolean> => {
  if (notes === undefined) {
    return false;
  }
  const requests = textRequests(await notesShapeId(slides, target), notes);
  if (requests.length === 0) {
    return false;
  }
  try {
    await batch(slides, target.presentationId, requests);
  } catch (error: unknown) {
    throw notesFailure(target, notes, error);
  }
  return true;
};

const relayout = async (slides: Slides, args: ManageSlidesArgs): Promise<unknown> => {
  const presentation = (
    await slides.presentations.get({ presentationId: args.presentationId, fields: RELAYOUT_FIELDS })
  ).data;
  const deck = presentation.slides ?? [];
  const index = deck.findIndex((slide) => slide.objectId === args.slideObjectId);
  if (index === -1) {
    throw noSuchSlides([args.slideObjectId ?? '']);
  }
  const slide = deck[index];
  const currentLayoutId = slide.slideProperties?.layoutObjectId ?? '';
  const layout = targetLayout(presentation, args, currentLayoutId);
  const layoutId = layout.objectId ?? '';
  if (layoutId === currentLayoutId) {
    return { action: 'relayout', slideObjectId: slide.objectId, layoutObjectId: layoutId, changed: false };
  }
  const mappings = mapPlaceholders(sourcePlaceholders(slide), targetPlaceholders(layout));
  const notes = speakerNotes(slide);
  const spec = { old: { objectId: slide.objectId ?? '', index }, layoutId, mappings };
  const { plan, reusedIds } = await rebuild(slides, args.presentationId, (reuse) => rebuildPlan(spec, reuse));
  const notesCopied = await copyNotes(
    slides,
    { presentationId: args.presentationId, slideObjectId: plan.slideObjectId },
    notes
  );
  return {
    action: 'relayout',
    slideObjectId: plan.slideObjectId,
    layoutObjectId: layoutId,
    changed: true,
    reusedIds,
    placeholders: plan.placeholderIds,
    notesCopied,
  };
};

const ACTIONS = { move, duplicate, delete: remove, relayout };

const handler = async ({ slides }: GoogleClients, args: ManageSlidesArgs): Promise<unknown> =>
  ACTIONS[args.action](slides, args);

export const manageSlides: ToolModule<ManageSlidesArgs> = {
  name: 'manage_slides',
  schema: ManageSlidesArgsSchema,
  handler,
  descriptor: {
    description:
      'Reorder, duplicate, delete or change the layout of slides. action "move": slideObjectIds go to insertionIndex, keeping their deck order. "duplicate": copies slideObjectId, optionally to insertionIndex, and returns the copy\'s id. "delete": removes slideObjectIds; deleting every slide is refused. "relayout": moves slideObjectId onto a new layout, given as a predefined "layout" name or a "layoutObjectId" from list_layouts. The API has no layout change, so relayout deletes and recreates the slide in place, carrying placeholder text with its styles, bullets and the speaker notes. It refuses slides holding anything other than placeholders, and refuses when the new layout lacks a placeholder for some text. Delete and relayout cannot be undone; call copy_presentation first for a backup.',
  },
};
