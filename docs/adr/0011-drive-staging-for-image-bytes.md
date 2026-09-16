# Drive staging for image bytes

The Google Slides API accepts no image bytes. `createImage` takes only a `url`, which Google fetches server-side and unauthenticated. Inserting a local file therefore requires hosting it somewhere public first.

Google's documented recommendation is a Cloud Storage signed URL with a short TTL. We do not take that path because it would force every user to provision a bucket before inserting a single image. We stage on Drive instead, using `drive.file`.

The staging flow uploads the bytes, grants `anyone`/`reader` with `allowFileDiscovery: false`, resolves a public URL, inserts, then deletes the file. Deleting is safe: Slides copies the bytes at insertion time and keeps its own copy, so the URL only has to survive one fetch.

Drive's direct-link forms are degraded. The January 2024 third-party-cookie change broke `drive.google.com/uc?export=view`, and `File.webContentLink` resolves to that same endpoint. No documented, stable form remains. We therefore probe candidates in order and use the first that returns an `image/*` body to an unauthenticated request:

1. `uc?export=download` serves the original bytes and often returns 403.
2. `lh3.googleusercontent.com/d/ID=s4000` is a high-resolution CDN form.
3. `thumbnail?id=ID&sz=w2000` is the most reliable and the lowest fidelity.

The order is by fidelity, not by reliability. The `thumbnail` form transcodes to JPEG and caps resolution, so it silently flattens PNG transparency. Ranking it last makes it a fallback rather than the default, and the tool result reports which form won so a caller can tell when fidelity dropped.

All three forms are undocumented or degraded. This is the fragile part of the design, which is why it is isolated behind one ordered list in `src/images/stage.ts`.

We validate format, byte size and megapixels locally before uploading. Google answers every `createImage` failure with one opaque message that never names the violated constraint, so local checks are the only way a caller learns what actually went wrong.

Between the permission grant and the delete, the image is readable by anyone holding the link. The window is one API round-trip. It is a real exposure and is documented in the README.
