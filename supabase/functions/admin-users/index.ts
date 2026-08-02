import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: 'Server is not configured' }, 500);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role,active')
    .eq('id', userData.user.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin' || !callerProfile.active) {
    return json({ error: 'Admin access required' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'set-status') {
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const active = body.active;
    if (!userId || typeof active !== 'boolean') return json({ error: 'Invalid status request' }, 400);
    if (userId === userData.user.id && !active) return json({ error: 'You cannot disable your own account' }, 400);

    const { data, error } = await adminClient
      .from('profiles')
      .update({ active })
      .eq('id', userId)
      .select('id,active')
      .single();

    if (error) return json({ error: error.message }, 400);
    return json({ user: data });
  }

  if (body.action !== 'create') return json({ error: 'Unknown action' }, 400);

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const role = body.role === 'admin' ? 'admin' : 'user';

  if (!email || !email.includes('@') || !displayName || password.length < 8) {
    return json({ error: 'A valid email, name, and password of at least 8 characters are required' }, 400);
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (createError || !created.user) {
    return json({ error: createError?.message || 'Could not create user' }, 400);
  }

  const { error: saveError } = await adminClient.from('profiles').upsert({
    id: created.user.id,
    email,
    display_name: displayName,
    role,
    active: true,
  });

  if (saveError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return json({ error: saveError.message }, 500);
  }

  return json({
    user: {
      id: created.user.id,
      email,
      displayName,
      role,
      active: true,
    },
  }, 201);
});
