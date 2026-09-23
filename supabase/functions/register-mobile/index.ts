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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);

  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: 'authentication_required' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user?.id || !user.email) return reply({ error: 'authentication_required' }, 401);

    const provider = String(user.app_metadata?.provider || '');
    if (provider !== 'google') return reply({ error: 'google_auth_required' }, 403);

    const { phone } = await request.json();
    const rawPhone = String(phone || '').trim();
    const parsed = parsePhoneNumberFromString(rawPhone.replace(/[\s().-]/g, ''));
    const phoneType = parsed?.getType();
    const mobileCapable = !phoneType || phoneType === 'MOBILE' || phoneType === 'FIXED_LINE_OR_MOBILE';
    if (!rawPhone.startsWith('+') || !parsed || !parsed.isPossible() || !parsed.isValid() || !mobileCapable) {
      return reply({ error: 'invalid_phone' }, 400);
    }
    const phoneE164 = parsed.number;
    const normalizedEmail = user.email.trim().toLowerCase();
    const identityHash = await fingerprint(`${user.id}|${phoneE164}`);
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin.from('signup_validation_events').select('id', { count: 'exact', head: true })
      .eq('identity_hash', identityHash).eq('action', 'register_mobile').gte('created_at', since);
    if ((count || 0) >= 5) return reply({ error: 'phone_rate_limited' }, 429);

    const [blockedEmail, blockedPhone, usedPhone, currentIdentity] = await Promise.all([
      admin.from('blocked_accounts').select('id', { count: 'exact', head: true }).ilike('email', normalizedEmail),
      admin.from('blocked_accounts').select('id', { count: 'exact', head: true }).eq('phone_e164', phoneE164),
      admin.from('private_user_identities').select('user_id').eq('phone_e164', phoneE164).neq('user_id', user.id).limit(1),
      admin.from('private_user_identities').select('phone_e164,phone_validated_at').eq('user_id', user.id).maybeSingle(),
    ]);
    const unavailable = (blockedEmail.count || 0) > 0 || (blockedPhone.count || 0) > 0 || (usedPhone.data || []).length > 0;
    await admin.from('signup_validation_events').insert({ identity_hash: identityHash, action: 'register_mobile', succeeded: !unavailable });
    if (unavailable) return reply({ error: 'identity_unavailable' }, 403);

    if (currentIdentity.data?.phone_e164 === phoneE164 && currentIdentity.data?.phone_validated_at) {
      return reply({ registered: true, phone_masked: `${phoneE164.slice(0, 3)}••••${phoneE164.slice(-4)}` });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin.from('private_user_identities').upsert({
      user_id: user.id,
      normalized_email: normalizedEmail,
      email_verified_at: user.email_confirmed_at || now,
      phone_e164: phoneE164,
      phone_validated_at: now,
      verification_required: true,
      updated_at: now,
    }, { onConflict: 'user_id' });
    if (updateError) {
      if (updateError.code === '23505') return reply({ error: 'identity_unavailable' }, 403);
      throw updateError;
    }
    return reply({ registered: true, phone_masked: `${phoneE164.slice(0, 3)}••••${phoneE164.slice(-4)}` });
  } catch (error) {
    console.error('register-mobile failed', error);
    return reply({ error: 'phone_registration_failed' }, 500);
  }
});
