# Record granted scopes and re-consent when they are stale

Staging images on Drive needs a write scope. `SCOPES` is now `presentations`, `drive.file` and `drive.readonly`. `drive.file` covers files this app created, which is all staging needs. `drive.readonly` is kept so an image that already lives in the user's Drive can be read.

A refresh token never gains scopes. Before this change the token store recorded no scope set, so an upgraded install would keep its old token, skip consent, and fail with an opaque 403 on the first image tool.

The Google credential therefore carries the scopes Google reported at consent. The field is optional so a credential written by an older build still parses instead of being discarded. A stored credential whose scopes do not cover `SCOPES`, including the legacy case where the field is absent, is treated as no grant at all and triggers one fresh consent.

A refresh token supplied through `GOOGLE_REFRESH_TOKEN` is exempt. Its scopes are unknowable to this process, and env is documented to work without ever opening a browser. Enforcing the check there would break that path on every start.

The cost is one extra browser prompt for existing users on upgrade. We accept it because the alternative is a 403 whose message does not say that re-consent is the fix.
