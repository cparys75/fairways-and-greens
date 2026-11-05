// Generate a VAPID (P-256) key pair and print the private key as a one-line JWK,
// ready to paste into the VAPID_JWK secret. Usage: npm run vapid
import { webcrypto as crypto } from 'node:crypto';

const { privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
console.log(JSON.stringify(await crypto.subtle.exportKey('jwk', privateKey)));
