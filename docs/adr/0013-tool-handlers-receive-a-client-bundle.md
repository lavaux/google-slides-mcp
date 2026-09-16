# Tool handlers receive a client bundle

A tool handler used to take a Slides client as its first parameter. Staging an image needs a Drive client as well, which that signature cannot express.

Handlers now take a `GoogleClients` bundle of the Slides and Drive clients, built once from a single OAuth client in `src/google/clients.ts`. `googleapis` already ships the Drive v3 client, so no dependency was added. Tools that need only Slides destructure `{ slides }` and are otherwise unchanged.

This extends ADR-0007 rather than replacing it. Tool modules still export a name, a descriptor, a schema and a handler, and still return a bare payload.

One narrow exception was added for `get_page_thumbnail`, which must return image bytes rather than JSON. A handler may return a pre-built content block, and `serverHandlers` passes it through instead of JSON-wrapping it. Every other handler keeps returning a bare payload.
