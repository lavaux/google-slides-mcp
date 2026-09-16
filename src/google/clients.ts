import { google, type drive_v3, type slides_v1 } from 'googleapis';
import type { GoogleCredential } from '../auth/credential.js';

export type GoogleClients = {
  slides: slides_v1.Slides;
  drive: drive_v3.Drive;
};

export const buildClients = (credential: GoogleCredential): GoogleClients => {
  const auth = new google.auth.OAuth2(credential.clientId, credential.clientSecret);
  auth.setCredentials({
    refresh_token: credential.refreshToken,
  });
  return {
    slides: google.slides({ version: 'v1', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
};
