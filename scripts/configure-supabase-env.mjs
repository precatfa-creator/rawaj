import fs from 'node:fs';
import dotenv from 'dotenv';

const envPath = '.env.local';
const source = fs.readFileSync(envPath, 'utf8');
const env = dotenv.parse(source);
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const rawProjectRef = env.SUPABASE_PROJECT_REF;

if (!accessToken || !rawProjectRef) {
  throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');
}

const projectRef = rawProjectRef
  .replace(/^https:\/\//, '')
  .split('.')[0];

if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_REF is not a valid project reference or project URL.');
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});

if (!response.ok) {
  throw new Error(`Could not retrieve project API keys (${response.status}).`);
}

const keys = await response.json();
const anonKey = keys.find((item) => item.type === 'publishable')?.api_key
  || keys.find((item) => item.name === 'anon')?.api_key;
// Supabase Auth Admin still requires a JWT service_role credential on some
// projects; the newer sb_secret key remains unsuitable as a Bearer token there.
const serviceRoleKey = keys.find((item) => item.name === 'service_role')?.api_key
  || keys.find((item) => item.type === 'secret')?.api_key;

if (!anonKey || !serviceRoleKey) {
  throw new Error('The project did not return publishable and secret API keys.');
}

const projectUrl = `https://${projectRef}.supabase.co`;
const values = {
  SUPABASE_PROJECT_REF: projectRef,
  SUPABASE_URL: projectUrl,
  VITE_SUPABASE_URL: projectUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  VITE_SUPABASE_ANON_KEY: anonKey,
};

let updated = source;
for (const [name, value] of Object.entries(values)) {
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  updated = pattern.test(updated) ? updated.replace(pattern, line) : `${updated.trimEnd()}\n${line}\n`;
}

fs.writeFileSync(envPath, updated);
console.log(`Supabase environment configured for project ${projectRef}.`);
