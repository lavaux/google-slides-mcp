import { startConsent } from '../auth/consent.js';
import { readEnvCredential, type GoogleCredential, type PartialGoogleCredential } from '../auth/credential.js';
import { writeTokenStore } from '../auth/tokenStore.js';
import { buildClients, type GoogleClients } from './clients.js';
import type { CredentialFailure } from '../utils/errorHandler.js';

export type GoogleSession = {
  /** The clients built from the newest Google credential. Read per call, never cached. */
  clients: () => GoogleClients;
  /**
   * Opens a consent page, or joins the one already open, and resolves to its
   * URL. Once consent finishes, the new credential is stored and `clients()`
   * starts returning clients built from it, so no restart is needed.
   */
  reauthorize: (failure: CredentialFailure) => Promise<string>;
};

const logAdoptError = (error: unknown): void => {
  console.error('Could not store the renewed Google credential.', error);
};

/**
 * A dead refresh token only needs the same client to consent again. A dead
 * client needs new client fields, so the setup page starts empty.
 */
const consentSeed = (credential: GoogleCredential, failure: CredentialFailure): PartialGoogleCredential =>
  failure === 'grant' ? { clientId: credential.clientId, clientSecret: credential.clientSecret } : {};

export const createGoogleSession = (initial: GoogleCredential): GoogleSession => {
  let credential = initial;
  let clients = buildClients(initial);
  let pending: Promise<string> | undefined;

  const adopt = async (next: GoogleCredential): Promise<void> => {
    credential = next;
    clients = buildClients(next);
    console.error('Google consent finished. Tool calls now use the renewed credential.');
    if (readEnvCredential().refreshToken !== undefined) {
      console.error('GOOGLE_REFRESH_TOKEN is set and will override the renewed token on the next start. Unset it.');
    }
    await writeTokenStore(next);
  };

  const begin = async (failure: CredentialFailure): Promise<string> => {
    const consent = await startConsent(consentSeed(credential, failure));
    consent.credential
      .then(adopt)
      .catch(logAdoptError)
      .finally(() => {
        pending = undefined;
      });
    return consent.url;
  };

  const reauthorize = (failure: CredentialFailure): Promise<string> => {
    pending ??= begin(failure).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };

  return { clients: () => clients, reauthorize };
};
