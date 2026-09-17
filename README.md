# Google Slides MCP Server

This process is an MCP server for the Google Slides API. A host talks to it on stdio. The first start opens a browser. You paste a Desktop client id and client secret. Google consent follows. Later starts read the token store.

## Prerequisites

- Node.js 20 or later
- A Google Cloud project with the Google Slides API enabled
- An OAuth Desktop client id and client secret

You do not need a refresh token. You do not need process env.

## Claude Code

1. Create a Desktop OAuth client. Use the Google Auth platform steps below.
2. In Claude Code run:

```
/plugin marketplace add matteoantoci/claude-plugins
/plugin install google-slides-mcp@matteoantoci-plugins
```

3. Run `/reload-plugins` if Claude asks.
4. The first start opens a browser. Paste the client id and the client secret. Finish Google consent.

Later sessions read the token store. No host JSON. No env.

## Other hosts

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run build`.
4. Create a Desktop OAuth client in [Google Cloud Console](https://console.cloud.google.com/):
   - Open [Google Auth platform](https://console.cloud.google.com/auth/branding).
   - If the page says the platform is not configured, click **Get Started**.
   - App name: `Google Slides MCP`. User support email: your address.
   - Audience: **External**.
   - Contact email: your address. Agree to the policy. Click **Create**.
   - Open [Audience](https://console.cloud.google.com/auth/audience). Add your Gmail as a test user.
   - Open [Data Access](https://console.cloud.google.com/auth/scopes). Add `https://www.googleapis.com/auth/presentations`, `https://www.googleapis.com/auth/drive.file`, and `https://www.googleapis.com/auth/drive.readonly`. Save.
   - Open [Clients](https://console.cloud.google.com/auth/clients). Click **Create Client**. Application type: **Desktop app**. Name: `Google Slides MCP Desktop`. Click **Create**.
   - Copy the client id and the client secret.
5. Run `npm run start`. Paste the client id and the client secret. Finish Google consent. Then stop the process.
6. Point the host at `node /path/to/google-slides-mcp/build/index.js`. Do not set env.

Example host config:

```json
"google-slides-mcp": {
  "transportType": "stdio",
  "command": "node",
  "args": [
    "/path/to/google-slides-mcp/build/index.js"
  ]
}
```

Replace the path with the compiled `build/index.js` on your machine.

## Upgrading from a build without image tools

The image tools need `https://www.googleapis.com/auth/drive.file`, which earlier builds never requested. A refresh token does not gain scopes, so a stored credential from an older build cannot use them.

The process detects this and runs consent once on the next start. Add the new scope under Data Access first, or consent will fail. Nothing else is needed, and later starts are silent again.

A refresh token supplied through `GOOGLE_REFRESH_TOKEN` is never checked this way, because its scopes are unknowable to this process. If you use env and the image tools return a permission error, mint a token that carries the new scope.

## First start

The process opens a loopback page.

- If the store has no client id or client secret, paste those two values.
- Continue to Google consent.
- Close the success page.

The process writes the Google credential to the token store. It tries the OS keychain first. It uses `~/.config/google-slides-mcp/credential.json` if the keychain is not available. File mode is `0600`.

Later starts use the store. No browser.

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` can override one field. They are never required. If env supplies a missing field, the process writes the merged credential to the store.

## Run without a host

```bash
npm run start
```

The process listens on stdio. Stderr prints `Google Slides MCP server running and connected via stdio.`

## Available Tools

- **`create_presentation`**: Creates a new Google Slides presentation.
  - **Input:**
    - `title` (string, required): The title for the new presentation.
  - **Output:** JSON object representing the created presentation details.

- **`get_presentation`**: Retrieves details about an existing presentation.
  - **Input:**
    - `presentationId` (string, required): The ID of the presentation to retrieve.
    - `fields` (string, optional): A field mask (e.g., "slides,pageSize") to limit the returned data.
  - **Output:** JSON object representing the presentation details.

- **`batch_update_presentation`**: Applies a series of updates to a presentation. This is the primary method for modifying slides (adding text, shapes, images, creating slides, etc.).
  - **Input:**
    - `presentationId` (string, required): The ID of the presentation to update.
    - `requests` (array, required): An array of request objects defining the updates. Refer to the [Google Slides API `batchUpdate` documentation](https://developers.google.com/slides/api/reference/rest/v1/presentations/batchUpdate#requestbody) for the structure of individual requests.
    - `writeControl` (object, optional): Controls write request execution (e.g., using revision IDs).
  - **Output:** JSON object representing the result of the batch update.

- **`get_page`**: Retrieves details about a specific page (slide) within a presentation.
  - **Input:**
    - `presentationId` (string, required): The ID of the presentation to retrieve.
    - `pageObjectId` (string, required): The object ID of the page (slide) to retrieve.
  - **Output:** JSON object representing the page details.

- **`list_page_elements`**: Lists the object ids on each slide. This is how you find the id the styling tools need.
  - **Input:** `presentationId`, optional `pageObjectId` for one slide, optional `kind` to keep only `shape`, `image`, `video`, `line`, `table`, `group`, `sheetsChart` or `wordArt`.
  - **Output:** `pageSize` and, per slide, each element's `objectId`, `kind`, `x`, `y`, `width`, `height` in points, its `shapeType` and `placeholder` when it has them, `rows` and `columns` for tables, and an 80-character text preview. Group members are listed too, each carrying the `groupObjectId` of the group it belongs to.

- **`insert_image`**: Inserts an image onto a slide.
  - **Input:**
    - `presentationId` (string, required)
    - `pageObjectId` (string, required): The slide to place the image on.
    - Exactly one image source:
      - `imagePath` (string): A local file. Uploaded through Drive.
      - `imageBase64` (string): Raw bytes, base64 encoded. Uploaded through Drive.
      - `imageUrl` (string): A publicly reachable URL. Used as-is, with no Drive round-trip.
      - `driveFileId` (string): An image already in your Drive.
    - `x`, `y`, `width`, `height` (number, optional): Points. Omit to centre the image on the slide.
    - `objectId` (string, optional), `altText` (string, optional)
  - **Output:** `objectId`, the `urlForm` that served the image, and whether it was staged.

- **`replace_image`**: Replaces the pixels of an existing image, keeping its object id, position, size, and Z-order. Prefer this over delete-and-reinsert when re-rendering a figure.
  - **Input:** `presentationId`, `imageObjectId`, one image source as above, optional `imageReplaceMethod` (`CENTER_INSIDE` or `CENTER_CROP`).

- **`get_page_thumbnail`**: Renders a slide to PNG and returns it inline, so a rendered layout can be checked visually.
  - **Input:** `presentationId`, `pageObjectId`, optional `size` (`SMALL`, `MEDIUM`, `LARGE`, `WIDTH2000_PX`; defaults to `WIDTH2000_PX`).
  - **Output:** A text line with the rendered pixel size, plus the image itself.

- **`add_slide`**: Adds a slide and optionally fills its placeholders in one call.
  - **Input:** `presentationId`, optional `layout` (a predefined layout such as `TITLE_AND_BODY`) or `layoutObjectId`, optional `insertionIndex`, optional `title`, `body`, `subtitle`.
  - **Output:** The new slide object id and the placeholder object ids.

- **`set_element_text`**: Replaces all text in a shape, placeholder, or table cell.
  - **Input:** `presentationId`, `objectId`, `text`, and `rowIndex` plus `columnIndex` together to target a table cell.

- **`set_shape_properties`**: Changes a shape or placeholder: text fitting, fill, outline, vertical alignment, hyperlink.
  - **Input:** `presentationId`, `objectId`, and any of `autofit` (only `NONE` is accepted by Google; see below), `contentAlignment` (`TOP`, `MIDDLE`, `BOTTOM`), `backgroundColor`, `outlineColor`, `outlineWeight` (points), `outlineDashStyle`, `linkUrl`.
  - **Output:** `objectId`, `changed`, and the field masks that were sent.

- **`set_text_style`**: Styles the text of a shape, placeholder or table cell.
  - **Input:** `presentationId`, `objectId`, optional `rowIndex` plus `columnIndex` for a table cell, optional `startIndex` and `endIndex` to style part of the text, and any of `fontFamily`, `fontSize`, `bold`, `italic`, `underline`, `strikethrough`, `smallCaps`, `baselineOffset`, `foregroundColor`, `backgroundColor`, `linkUrl`, `alignment`, `direction`, `spacingMode`, `lineSpacing`, `spaceAbove`, `spaceBelow`, `indentStart`, `indentEnd`, `indentFirstLine`, `autofit`.
  - Sizes, spacing and indents are in points. `lineSpacing` is a percentage where 100 is normal.

- **`set_element_geometry`**: Moves or resizes a page element.
  - **Input:** `presentationId`, `objectId`, and any of `x`, `y`, `width`, `height` in points. Omitted values are kept.
  - **Output:** the resulting box in points.

- **`replace_all_text`**: Finds and replaces text across a presentation.
  - **Input:** `presentationId`, `text`, `replaceText`, optional `matchCase`, `searchByRegex`, `pageObjectIds`.
  - **Output:** `occurrencesChanged`.

- **`summarize_presentation`**: Extracts and formats all text content from a presentation for easier summarization.
  - **Input:**
    - `presentationId` (string, required): The ID of the presentation to summarize.
    - `include_notes` (boolean, optional): Whether to include speaker notes in the summary. Defaults to false.
  - **Output:** JSON object containing:
    - `title`: The presentation's title
    - `slideCount`: Total number of slides
    - `lastModified`: Revision information
    - `slides`: Array of slide objects containing:
      - `slideNumber`: Position in presentation
      - `slideId`: Object ID of the slide
      - `content`: All text extracted from the slide
      - `notes`: Speaker notes (if requested and available)

## How shape styling works

Four facts decide whether a styling call does what you meant.

**A field mask resets what it names.** Every `update*Properties` request carries a
`fields` mask. Google treats a path named in the mask whose value is unset as "reset
this property to its default", so a hand-written mask that is one path too wide wipes
formatting silently. These tools build the mask and the payload from one list, so the
mask can only ever name a path a value was written at. Pass only the properties you
want changed; everything else is left alone.

**Only `NONE` can be written to autofit.** Google rejects `TEXT_AUTOFIT` and
`SHAPE_AUTOFIT` on every shape, placeholder or not, with "Autofit types other than NONE
are not supported". Shrink-text-on-overflow and resize-shape-to-fit can be chosen in the
Slides editor, but they cannot be set through the API. Both tools reject them locally
and say so. What `autofit: 'NONE'` does is real and useful: it turns text fitting off,
baking the current font scale into the font size so the text stops resizing itself.

To make text fit a box, set `fontSize` or `lineSpacing` with `set_text_style`, or resize
the box with `set_element_geometry`.

**Autofit is still written last.** Any request that may affect text fitting resets
`autofitType` to `NONE`, so both tools emit the autofit change as a trailing request of
its own, and both take an `autofit` argument so it can travel with the change that would
otherwise clear it.

**Some properties cannot be written.** A shape's `shadow`, and autofit's `fontScale`
and `lineSpacingReduction`, are read-only in the API. Text has no transparent
foreground, so `foregroundColor` will not take `NONE`, though the text `backgroundColor`
and a shape's fill and outline all will. None of this is a limitation of these tools:
`batch_update_presentation` hits the same walls.

**There is no resize request.** Size is a property of the element's transform, not a
field you can set. `set_element_geometry` reads the element and rewrites its whole
transform, scaling each matrix column as a unit so a rotated element keeps its angle.
Two consequences: `x` and `y` are the anchor Slides stores, which for a rotated element
is not the top-left of its visible bounding box, and an element inside a group is
refused, because a group child's position is relative to its group rather than to the
slide.

Set text before styling it. `set_element_text` deletes and reinserts, which discards the
character styling the old text carried.

## How images work

The Google Slides API accepts no image bytes. `createImage` takes only a URL, which Google fetches from its own servers without your credentials. Anything local must be publicly reachable for the moment of that fetch.

So `insert_image` uploads the bytes to Drive, grants read access to anyone with the link, hands Slides a URL, and deletes the Drive file once the insert returns. Slides keeps its own copy, so deleting is safe and nothing stays public.

Two consequences worth knowing:

- **The image is briefly public.** Between the permission grant and the delete, anyone holding the link could read it. The window is one API round-trip and the file is then removed. Pass `imageUrl` instead if you would rather this process never touch Drive.
- **Fidelity can drop.** Drive's direct-link forms were degraded by Google's January 2024 third-party-cookie change, so this process probes several and uses the first that works. The last resort transcodes to JPEG and caps resolution, which loses PNG transparency. The result reports the `urlForm` used and warns when that fallback was hit.

Images must be PNG, JPEG, or GIF, under 50 MB, and at most 25 megapixels. SVG and WebP are not supported. These limits are checked locally, because Google reports every such failure with one message that never says which limit you hit.
