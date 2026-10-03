import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

const readMessage = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('message' in value)) {
    return undefined;
  }
  if (typeof value.message !== 'string') {
    return undefined;
  }
  return value.message;
};

const readNested = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
};

const googleApiMessage = (err: unknown): string | undefined => {
  const response = readNested(err, 'response');
  const data = readNested(response, 'data');
  const error = readNested(data, 'error');
  return readMessage(error);
};

const extractRawErrorMessage = (err: unknown): string =>
  googleApiMessage(err) ?? readMessage(err) ?? (typeof err === 'string' ? err : 'Unknown Google API error');

export const handleGoogleApiError = (error: unknown, toolName: string): ProtocolError => {
  const finalErrorMessage = `Google API Error in ${toolName}: ${extractRawErrorMessage(error)}`;
  console.error(`Google API Error (${toolName}):`, error);
  return new ProtocolError(ProtocolErrorCode.InternalError, finalErrorMessage);
};

/**
 * Why Google refused the Google credential, if it did. `grant` means the refresh
 * token expired or was revoked. `client` means the OAuth client itself is gone or
 * wrong. Both surface from the token endpoint as a bare OAuth error code, which
 * the generic message path would print as an opaque `invalid_grant`.
 */
export type CredentialFailure = 'grant' | 'client';

const GRANT_ERRORS = new Set(['invalid_grant']);
const CLIENT_ERRORS = new Set(['invalid_client', 'unauthorized_client', 'deleted_client']);

const oauthErrorCode = (err: unknown): string | undefined => {
  const code = readNested(readNested(readNested(err, 'response'), 'data'), 'error');
  return typeof code === 'string' ? code : undefined;
};

export const credentialFailure = (err: unknown): CredentialFailure | undefined => {
  const code = oauthErrorCode(err);
  if (code === undefined) {
    return undefined;
  }
  if (GRANT_ERRORS.has(code)) {
    return 'grant';
  }
  return CLIENT_ERRORS.has(code) ? 'client' : undefined;
};

const reauthInstruction = (failure: CredentialFailure, url: string): string => {
  if (failure === 'grant') {
    return (
      'Google rejected the stored authorization: the refresh token expired or was revoked. ' +
      `A new Google sign-in was started. Ask the user to open ${url} in a browser on the machine running this ` +
      'server and finish Google consent. Then retry this call.'
    );
  }
  return (
    'Google rejected the OAuth client: the client id or client secret is wrong, or the client was deleted. ' +
    `A new setup was started. Ask the user to open ${url} in a browser on the machine running this server, ` +
    'paste a valid Desktop client id and client secret, and finish Google consent. Then retry this call.'
  );
};

export const handleCredentialFailure = (failure: CredentialFailure, url: string, toolName: string): ProtocolError => {
  console.error(`Google credential rejected in ${toolName} (${failure}). Consent page: ${url}`);
  return new ProtocolError(ProtocolErrorCode.InternalError, `${toolName}: ${reauthInstruction(failure, url)}`);
};
