import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.ADMIN_EMAIL || 'precatfa@gmail.com').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !password) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_PASSWORD are required.');
  process.exit(1);
}

if (password.length < 8) {
  console.error('ADMIN_PASSWORD must contain at least 8 characters.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: existingProfiles, error: lookupError } = await supabase
  .from('profiles')
  .select('id,email')
  .eq('email', email)
  .limit(1);

if (lookupError) throw lookupError;

let userId = existingProfiles?.[0]?.id;

if (!userId) {
  const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;
  userId = authUsers.users.find((user) => user.email?.toLowerCase() === email)?.id;
}

if (userId) {
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    user_metadata: { display_name: 'مدير النظام' },
  });
  if (error) throw error;
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'مدير النظام' },
  });
  if (error || !data.user) throw error || new Error('Supabase did not return the created user.');
  userId = data.user.id;
}

const { error: profileError } = await supabase.from('profiles').upsert({
  id: userId,
  email,
  display_name: 'مدير النظام',
  role: 'admin',
  active: true,
});

if (profileError) throw profileError;
console.log(`Admin account is ready: ${email}`);
