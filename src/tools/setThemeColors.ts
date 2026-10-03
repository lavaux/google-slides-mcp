import { SetThemeColorsArgsSchema, type SetThemeColorsArgs } from '../layoutSchemas.js';
import { hexFromRgb, mergeColorScheme } from '../slides/style.js';
import type { GoogleClients } from '../google/clients.js';
import type { ToolModule } from '../utils/tool.js';
import type { slides_v1 } from 'googleapis';

const masterById = (masters: slides_v1.Schema$Page[], masterObjectId: string): slides_v1.Schema$Page => {
  const found = masters.find((master) => master.objectId === masterObjectId);
  if (!found) {
    throw new Error(`No master with object id "${masterObjectId}". Run list_layouts to see master ids.`);
  }
  return found;
};

const pickMaster = (masters: slides_v1.Schema$Page[], masterObjectId: string | undefined): slides_v1.Schema$Page => {
  if (masterObjectId !== undefined) {
    return masterById(masters, masterObjectId);
  }
  if (masters.length !== 1) {
    throw new Error(
      `This presentation has ${masters.length} masters (${masters.map((master) => master.objectId).join(', ')}). Pass masterObjectId to say which one.`
    );
  }
  return masters[0];
};

const handler = async ({ slides }: GoogleClients, args: SetThemeColorsArgs): Promise<unknown> => {
  const masters =
    (
      await slides.presentations.get({
        presentationId: args.presentationId,
        fields: 'masters(objectId,pageProperties(colorScheme))',
      })
    ).data.masters ?? [];
  const master = pickMaster(masters, args.masterObjectId);
  const colors = mergeColorScheme(master.pageProperties?.colorScheme?.colors ?? [], args.colors);
  await slides.presentations.batchUpdate({
    presentationId: args.presentationId,
    requestBody: {
      requests: [
        {
          updatePageProperties: {
            objectId: master.objectId,
            pageProperties: { colorScheme: { colors } },
            fields: 'colorScheme.colors',
          },
        },
      ],
    },
  });
  return {
    masterObjectId: master.objectId,
    themeColors: Object.fromEntries(colors.map((pair) => [pair.type ?? '', hexFromRgb(pair.color ?? {})])),
  };
};

export const setThemeColors: ToolModule<SetThemeColorsArgs> = {
  name: 'set_theme_colors',
  schema: SetThemeColorsArgsSchema,
  handler,
  descriptor: {
    description:
      "Change a master's theme colours (DARK1, LIGHT1, DARK2, LIGHT2, ACCENT1 to ACCENT6, HYPERLINK, FOLLOWED_HYPERLINK) as #RRGGBB or #RGB. Colours you leave out keep their value. Everything coloured with a theme colour on slides using this master follows the change. masterObjectId is needed only when the deck has more than one master; list_layouts shows them with their current colours.",
  },
};
