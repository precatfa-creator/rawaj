// Applies pending migrations through the Management API instead of a Postgres
// connection: `supabase db push` needs the database password, and the pooler
// rejects it on this project. The access token this repo already uses for
// `supabase:configure` is enough.
//
// Same contract as the CLI: files run in filename order, one at a time, and
// each is recorded in supabase_migrations.schema_migrations so the CLI and this
// script agree on what is applied.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * The files the remote has not run yet, in the order the CLI would run them.
 * `<version>_<name>.sql` is the CLI's own naming, so a version recorded here is
 * recognised by `supabase migration list` too.
 */
export const pendingMigrations = (files, applied) => files
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => {
    const [version, ...rest] = path.basename(file, '.sql').split('_');
    return { file, version, name: rest.join('_') };
  })
  .filter((migration) => !applied.has(migration.version));

// The check file imports the helper above, so the push runs only when this
// file is the one node was told to run.
if (import.meta.main) {
  const dir = 'supabase/migrations';
  const env = dotenv.parse(fs.readFileSync('.env.local', 'utf8'));
  const projectRef = (env.SUPABASE_PROJECT_REF ?? '').replace(/^https:\/\//, '').split('.')[0];
  const token = env.SUPABASE_ACCESS_TOKEN;

  if (!token || !projectRef) {
    throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');
  }

  const query = async (sql) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(body);
    return JSON.parse(body);
  };

  const applied = new Set(
    (await query('select version from supabase_migrations.schema_migrations'))
      .map((row) => row.version),
  );

  const pending = pendingMigrations(fs.readdirSync(dir), applied);

  if (pending.length === 0) {
    console.log('Remote database is up to date.');
    process.exit(0);
  }

  for (const migration of pending) {
    process.stdout.write(`${migration.file} ... `);
    await query(fs.readFileSync(path.join(dir, migration.file), 'utf8'));
    // Recorded only after the migration itself came back clean, so a failure
    // leaves the version unrecorded and the next run retries it.
    await query(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ('${migration.version}', '${migration.name.replace(/'/g, "''")}')
       on conflict do nothing`,
    );
    console.log('applied');
  }

  console.log(`Applied ${pending.length} migration(s).`);
}
