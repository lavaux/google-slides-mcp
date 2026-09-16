import { SCOPES, runConsent } from './consent.js';
import {
  coversScopes,
  isCompleteCredential,
  mergeCredential,
  readEnvCredential,
  sameCredential,
  type GoogleCredential,
} from './credential.js';
import { readTokenStore, writeTokenStore } from './tokenStore.js';

const persistIfChanged = async (stored: GoogleCredential | undefined, next: GoogleCredential): Promise<void> => {
  if (stored && sameCredential(stored, next)) {
    return;
  }
  await writeTokenStore(next);
};

/**
 * A stored refresh token that predates a newly required scope would otherwise be
 * used happily and fail later with an opaque 403, so a stale grant is treated as
 * no grant at all.
 *
 * An env-supplied refresh token is exempt. Its scopes are unknowable here, and
 * env is documented to work without ever opening a browser.
 */
const grantIsUsable = (credential: GoogleCredential): boolean =>
  readEnvCredential().refreshToken !== undefined || coversScopes(credential, SCOPES);

export const resolveGoogleCredential = async (): Promise<GoogleCredential> => {
  const stored = await readTokenStore();
  const merged = mergeCredential(stored);
  if (isCompleteCredential(merged) && grantIsUsable(merged)) {
    await persistIfChanged(stored, merged);
    return merged;
  }
  if (isCompleteCredential(merged)) {
    console.error('The stored Google credential predates a required scope. Re-running consent once.');
  }
  const credential = await runConsent(merged);
  await writeTokenStore(credential);
  return credential;
};
