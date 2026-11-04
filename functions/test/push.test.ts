import { describe, expect, it } from 'vitest';
import { sendPush, vapidPublicKey } from '../lib/push';

describe('web push (VAPID)', () => {
  it('derives a 65-byte application server key from the private JWK', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const key = vapidPublicKey({ VAPID_JWK: JSON.stringify(jwk) });
    expect(key).toBeTruthy();
    expect(key!.length).toBe(87); // 65 bytes (0x04 ‖ x ‖ y), base64url, no padding
    expect(key!.startsWith('B')).toBe(true); // 0x04 uncompressed-point prefix encodes to 'B…'
    expect(vapidPublicKey({})).toBeNull();
  });
  it('does nothing without a key configured', async () => {
    expect(await sendPush({}, 'https://push.example/x')).toBe(0);
  });
});
