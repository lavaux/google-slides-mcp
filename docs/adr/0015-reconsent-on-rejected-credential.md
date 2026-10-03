# Re-run consent when Google rejects the credential mid-session

A refresh token can die while the process runs. Google revokes it after seven days for an app in Testing, after six months unused, or on user revocation. Every tool call then failed with a bare `invalid_grant`. The only fix was to restart the host, and nothing said so.

A tool call that fails with an OAuth error code now starts consent. `invalid_grant` reuses the stored client and goes straight to Google. `invalid_client`, `unauthorized_client` and `deleted_client` open the empty setup page, because the client fields are the broken part.

The tool call does not wait for consent. It fails at once with an error that names the loopback URL and tells the caller to have the user finish consent and retry. A blocking call would hold the host until a timeout, and the user might never see the browser tab. Concurrent failures join the one open consent run rather than opening a page each.

Handlers read clients through a `GoogleSession` on every call. When consent finishes, the session rebuilds the clients and writes the token store. This is why `setupToolHandlers` now takes a session instead of a client bundle. ADR-0013 still holds for the handlers themselves.

An env-supplied refresh token is replaced for the rest of the process but overrides the store on the next start. The process logs a warning instead of trying to edit the environment.
