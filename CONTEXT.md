# Google Slides MCP

An MCP server that exposes Google Slides operations as tools.

## Language

**Tool**:
An MCP operation this server exposes to a client.
_Avoid_: command, endpoint, action

**Tool descriptor**:
The ListTools metadata for one tool: name, description, and input schema.
_Avoid_: tool definition, tool spec, tool schema

**Tool handler**:
The function that performs the Google Slides call for one tool.
_Avoid_: toolFn, executor, implementation

**Batch update request**:
A Google Slides API mutation object. This server does not model its shape.
_Avoid_: request body, patch

**Image source**:
Where a tool gets image bytes or a URL. One of a local path, base64 bytes, a public URL, or a Drive file id. Exactly one per call.
_Avoid_: input, image data, payload

**Staged image**:
An image this process uploaded to Drive, shared link-readable, and deleted once Slides had copied it. Only local bytes are staged. A public URL is not.
_Avoid_: temp file, cached image, hosted image

**URL form**:
One candidate public URL shape for a Drive file. This process probes the forms in fidelity order and reports which one served the bytes.
_Avoid_: link, direct link, share link

**Thumbnail**:
A slide rendered to PNG by the Slides API and returned inline. Its Google URL is short-lived and identity-tagged, so this process never surfaces it.
_Avoid_: preview, screenshot, render

**Granted scopes**:
The scopes Google reported at consent, stored with the Google credential. A stored grant that no longer covers what this process needs forces one fresh consent.
_Avoid_: permissions, access, entitlements

**Transport**:
The channel between this process and the host. This server uses stdio only.
_Avoid_: connection, socket, stream

**Protocol era**:
The MCP wire revision this process speaks. This server speaks `2025-11-25`.
_Avoid_: MCP version, v2, spec version

**Package line**:
The TypeScript SDK major line this repo depends on. This server uses the v2 packages and still speaks the `2025-11-25` protocol era.
_Avoid_: SDK version, MCP version

**Google credential**:
The Cloud client id, client secret, and Slides refresh token this process uses to call the Slides API.
_Avoid_: OAuth, MCP authorization, login, MCP access token, env

**Token store**:
The local place this process persists the Google credential. It tries the OS keychain first. It uses a user-config file if the keychain is not available. Process env can override one field. It is never required.
_Avoid_: secret, session, cookie

**MCP authorization**:
Host sign-in on HTTP. This server does not use it.
_Avoid_: Google credential, Google OAuth, /mcp

**MCP access token**:
The bearer token a host would send on HTTP. This server does not use it.
_Avoid_: refresh token, API key, session
