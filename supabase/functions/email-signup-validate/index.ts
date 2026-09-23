import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.11.20/max';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function fingerprint(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);

  try {
    const { email, phone } = await request.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      return reply({ error: 'invalid_email' }, 400);
    }

    const parsed = parsePhoneNumberFromString(String(phone || '').replace(/[\s().-]/g, ''));
    const phoneType = parsed?.getType();
    const mobileCapable = !phoneType || phoneType === 'MOBILE' || phoneType === 'FIXED_LINE_OR_MOBILE';
    if (!parsed || !parsed.isPossible() || !parsed.isValid() || !mobileCapable || !String(phone || '').trim().startsWith('+')) {
      return reply({ error: 'invalid_phone' }, 400);
    }
    const phoneE164 = parsed.number;

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const identityHash = await fingerprint(`${normalizedEmail}|${phoneE164}`);
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin.from('signup_validation_events').select('id', { count: 'exact', head: true })
      .eq('identity_hash', identityHash).eq('action', 'validate').gte('created_at', since);
    if ((count || 0) >= 5) return reply({ error: 'signup_rate_limited' }, 429);

    const [blockedEmail, blockedPhone, usedEmail, usedPhone] = await Promise.all([
      admin.from('blocked_accounts').select('id', { count: 'exact', head: true }).ilike('email', normalizedEmail),
      admin.from('blocked_accounts').select('id', { count: 'exact', head: true }).eq('phone_e164', phoneE164),
      admin.from('private_user_identities').select('user_id', { count: 'exact', head: true }).ilike('normalized_email', normalizedEmail),
      admin.from('private_user_identities').select('user_id', { count: 'exact', head: true }).eq('phone_e164', phoneE164),
    ]);
    const unavailable = [blockedEmail, blockedPhone, usedEmail, usedPhone].some((result) => (result.count || 0) > 0);
    await admin.from('signup_validation_events').insert({ identity_hash: identityHash, action: 'validate', succeeded: !unavailable });
    if (unavailable) return reply({ error: 'identity_unavailable' }, 403);

    const { data, error } = await admin.from('signup_identity_tickets')
      .insert({ normalized_email: normalizedEmail, phone_e164: phoneE164 })
      .select('id,expires_at').single();
    if (error || !data) throw error || new Error('ticket_creation_failed');
    return reply({ ticket: data.id, email: normalizedEmail, phone: phoneE164, expires_at: data.expires_at });
  } catch (error) {
    console.error('email-signup-validate failed', error);
    return reply({ error: 'signup_validation_failed' }, 500);
  }
});
