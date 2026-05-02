import { createClient } from 'npm:@supabase/supabase-js@2';
import { GoogleGenAI } from 'npm:@google/genai';

// ── VAPID JWT helpers (Web Crypto API — works natively in Deno) ──────────────

function b64uToBytes(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function textToB64u(text: string): string {
  return bytesToB64u(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

async function vapidJWT(
  endpoint: string,
  privateKeyB64u: string,
  publicKeyB64u: string,
  subject: string,
): Promise<string> {
  const { hostname, protocol } = new URL(endpoint);
  const aud = `${protocol}//${hostname}`;

  const header  = textToB64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = textToB64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: subject,
  }));
  const toSign = `${header}.${payload}`;

  // Convert raw P-256 private key (32 bytes) to PKCS8 DER
  const privBytes = b64uToBytes(privateKeyB64u);
  const pubBytes  = b64uToBytes(publicKeyB64u);        // 65 bytes uncompressed
  const pkcs8 = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20,
    ...privBytes,
    0xa1, 0x44, 0x03, 0x42, 0x00,
    ...pubBytes,
  ]);

  const key = await crypto.subtle.importKey(
    'pkcs8', pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(toSign),
  );
  return `${toSign}.${bytesToB64u(sig)}`;
}

// ── Web Push encryption (RFC 8291 / RFC 8188) ────────────────────────────────
// Encrypts the payload with the receiver's p256dh public key + auth secret.

async function encryptPushPayload(
  plaintext: string,
  p256dhB64u: string,
  authB64u: string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const enc      = new TextEncoder();
  const authInfo = enc.encode('Content-Encoding: auth\0');

  const receiverPub = await crypto.subtle.importKey(
    'raw', b64uToBytes(p256dhB64u),
    { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  );
  const authSecret = b64uToBytes(authB64u);

  // Generate ephemeral key pair
  const { privateKey: senderPriv, publicKey: senderPub } = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'],
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderPub));

  // ECDH shared secret
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPub }, senderPriv, 256,
  ));

  // PRK via HKDF-Extract with auth as salt
  const prk = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const prkBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo }, prk, 256,
  ));

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Expand content encryption key + nonce
  const receiverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', receiverPub));
  const keyInfo   = concat([enc.encode('Content-Encoding: aesgcm\0'), authInfo, label('P-256'), receiverPubRaw, senderPubRaw]);
  const nonceInfo = concat([enc.encode('Content-Encoding: nonce\0'),  authInfo, label('P-256'), receiverPubRaw, senderPubRaw]);

  const prkKey = await crypto.subtle.importKey('raw', prkBits, 'HKDF', false, ['deriveBits']);
  const cekBits   = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: keyInfo   }, prkKey, 128));
  const nonceBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prkKey, 96));

  const cekKey = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const padded = concat([new Uint8Array(2), enc.encode(plaintext)]); // 2-byte padding length prefix (0)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBits }, cekKey, padded));

  return { ciphertext, salt, serverPublicKey: senderPubRaw };
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function label(str: string): Uint8Array {
  const enc = new TextEncoder().encode(str);
  return concat(new Uint8Array([enc.length]), enc, new Uint8Array(1));
}

// ── Send a single push message ───────────────────────────────────────────────

async function sendPush(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapidPriv: string,
  vapidPub: string,
  vapidSubject: string,
): Promise<void> {
  const { ciphertext, salt, serverPublicKey } = await encryptPushPayload(
    payload, sub.keys.p256dh, sub.keys.auth,
  );

  const jwt = await vapidJWT(sub.endpoint, vapidPriv, vapidPub, vapidSubject);

  // Build body: [salt(16) + rs(4=4096) + keyLen(1) + serverKey(65) + ciphertext]
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  const keyLen = new Uint8Array([serverPublicKey.length]);
  const body = concat(salt, rs, keyLen, serverPublicKey, ciphertext);

  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Encryption': `salt=${bytesToB64u(salt.buffer as ArrayBuffer)}`,
      'Crypto-Key': `dh=${bytesToB64u(serverPublicKey.buffer as ArrayBuffer)};p256ecdsa=${vapidPub}`,
      'Authorization': `vapid t=${jwt},k=${vapidPub}`,
      'TTL': '86400',
    },
    body,
  });

  if (!resp.ok && resp.status !== 201) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Push failed: ${resp.status} — ${text}`);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });

    const vapidPub  = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const vapidSub  = Deno.env.get('VAPID_SUBJECT')!;

    const today = new Date().toISOString().split('T')[0];

    // Fetch all profiles (generate for everyone, not just subscribed)
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, profile_data');
    if (profErr) throw profErr;

    // Fetch all push subscriptions (for notification delivery)
    const { data: pushSubs } = await supabase
      .from('push_subscriptions')
      .select('user_id, subscription');
    const subMap = new Map((pushSubs ?? []).map((s: any) => [s.user_id, s.subscription]));

    let generated = 0;
    let notified  = 0;

    for (const p of profiles ?? []) {
      try {
        // Skip if already generated today
        const { data: existing } = await supabase
          .from('daily_bonus_missions')
          .select('id')
          .eq('user_id', p.id)
          .eq('generated_date', today)
          .maybeSingle();
        if (existing) continue;

        const habits: any[] = p.profile_data?.habits ?? [];
        const recurring = habits.filter((h: any) => h.repeatType !== 'oneTime');
        const habitList = recurring.length > 0
          ? recurring.map((h: any) => `- ${h.title} [${h.repeatType}]`).join('\n')
          : '- (nenhum hábito recorrente cadastrado)';

        const resp = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text:
`Você é "O Arquiteto" do sistema ARISE. Com base nos hábitos do hunter abaixo, gere 3 missões bônus espontâneas para hoje. Devem complementar os hábitos com desafios criativos e variados. Varie XP (20-60) e Gold (10-30).

HÁBITOS DO HUNTER:
${habitList}

Responda SOMENTE com um array JSON válido, sem markdown:
[{"title":"...","rewardXp":...,"rewardGold":...}]`
          }]}],
        });

        const raw = resp.text?.trim() ?? '[]';
        const json = raw.startsWith('[') ? raw : raw.replace(/```json\n?|\n?```/g, '').trim();
        const parsed: { title: string; rewardXp: number; rewardGold: number }[] = JSON.parse(json);

        const missions = parsed.slice(0, 3).map((m, i) => ({
          id: `bonus-${Date.now()}-${i}`,
          title: String(m.title),
          rewardXp: Math.max(10, Math.min(100, Number(m.rewardXp) || 30)),
          rewardGold: Math.max(5, Math.min(50, Number(m.rewardGold) || 15)),
          isCompleted: false,
          generatedDate: today,
        }));

        await supabase.from('daily_bonus_missions').upsert({
          user_id: p.id,
          missions,
          generated_date: today,
        });
        generated++;

        // Send push if user has subscription
        const pushSub = subMap.get(p.id);
        if (pushSub) {
          try {
            await sendPush(
              pushSub,
              JSON.stringify({
                title: '⚡ ARISE — Missões Bônus',
                body: `O Arquiteto preparou ${missions.length} desafios para você hoje.`,
                url: '/',
              }),
              vapidPriv, vapidPub, vapidSub,
            );
            notified++;
          } catch (pushErr) {
            console.warn(`Push failed for user ${p.id}:`, pushErr);
            // If subscription is expired/invalid, remove it
            if (String(pushErr).includes('410') || String(pushErr).includes('404')) {
              await supabase.from('push_subscriptions').delete().eq('user_id', p.id);
            }
          }
        }
      } catch (userErr) {
        console.error(`Error for user ${p.id}:`, userErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, date: today, generated, notified }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders },
    );
  }
});
