#!/usr/bin/env node
// Prints what the token store now holds. No secrets are shown.
import { Entry } from '@napi-rs/keyring';
import { SCOPES } from '../build/auth/consent.js';
import { coversScopes } from '../build/auth/credential.js';

const raw = new Entry('google-slides-mcp', 'google-credential').getPassword();
if (!raw) {
  console.log('No credential in the keychain.');
  process.exit(1);
}
const credential = JSON.parse(raw);
console.log('granted scopes:');
for (const scope of credential.scopes ?? []) {
  console.log(`  ${scope}`);
}
if (!credential.scopes) {
  console.log('  (none recorded - this is still the legacy credential)');
}
console.log('\nrequired scopes:');
for (const scope of SCOPES) {
  const has = (credential.scopes ?? []).includes(scope);
  console.log(`  ${has ? 'OK     ' : 'MISSING'} ${scope}`);
}
console.log(`\nusable without re-consent: ${coversScopes(credential, SCOPES)}`);
