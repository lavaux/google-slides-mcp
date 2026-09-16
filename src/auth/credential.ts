import { z } from 'zod';

export type PartialGoogleCredential = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  scopes?: string[];
};

export type GoogleCredential = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** What Google actually granted. Absent on credentials stored before scopes were tracked. */
  scopes?: string[];
};

export const GoogleCredentialSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
  // Optional so a credential written by an older build still parses instead of
  // being discarded as corrupt.
  scopes: z.array(z.string()).optional(),
});

const emptyToUndefined = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
};

export const isCompleteCredential = (value: PartialGoogleCredential): value is GoogleCredential =>
  Boolean(value.clientId && value.clientSecret && value.refreshToken);

export const parseCredential = (raw: string): GoogleCredential | undefined => {
  try {
    return GoogleCredentialSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

export const readEnvCredential = (): PartialGoogleCredential => ({
  clientId: emptyToUndefined(process.env.GOOGLE_CLIENT_ID),
  clientSecret: emptyToUndefined(process.env.GOOGLE_CLIENT_SECRET),
  refreshToken: emptyToUndefined(process.env.GOOGLE_REFRESH_TOKEN),
});

/**
 * A refresh token never gains scopes. If the stored grant predates a scope the
 * process now needs, the only fix is a fresh consent, so this must be checked
 * before the token is used rather than discovered as an opaque 403 later.
 */
export const coversScopes = (credential: PartialGoogleCredential, required: string[]): boolean => {
  const granted = credential.scopes;
  if (granted === undefined) {
    return false;
  }
  return required.every((scope) => granted.includes(scope));
};

export const mergeCredential = (stored: PartialGoogleCredential | undefined): PartialGoogleCredential => {
  const env = readEnvCredential();
  const refreshToken = env.refreshToken ?? stored?.refreshToken;
  return {
    clientId: env.clientId ?? stored?.clientId,
    clientSecret: env.clientSecret ?? stored?.clientSecret,
    refreshToken,
    // Scopes describe one specific refresh token, so they only carry over when
    // the stored token is the one being used.
    scopes: env.refreshToken === undefined ? stored?.scopes : undefined,
  };
};

export const sameCredential = (left: GoogleCredential, right: GoogleCredential): boolean =>
  left.clientId === right.clientId &&
  left.clientSecret === right.clientSecret &&
  left.refreshToken === right.refreshToken &&
  (left.scopes ?? []).join(' ') === (right.scopes ?? []).join(' ');
