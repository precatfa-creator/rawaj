import { useEffect, useState } from 'react';
import { supabase } from '../db/supabase';

/**
 * Who made a change, resolved at read time.
 *
 * The audit log stores only the uid, so a deleted profile still leaves a
 * readable trail — and the name shown is always the current one.
 */
export const useActorNames = (): Map<string, string> => {
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void supabase.from('profiles').select('id,display_name,email').then(({ data }) => {
      setNames(new Map((data ?? []).map(row => [row.id as string, (row.display_name || row.email) as string])));
    });
  }, []);

  return names;
};

export const describeActor = (
  actor: { actorId: string | null; actorRole: string },
  names: Map<string, string>,
): string => {
  if (actor.actorId) return names.get(actor.actorId) ?? 'مستخدم محذوف';
  if (actor.actorRole === 'service_role') return 'خدمة النظام';
  // `postgres` is the role a migration runs under: `supabase db push` carries no
  // signed-in user, so these rows are the schema updating itself rather than
  // anybody working in the app.
  if (actor.actorRole === 'postgres') return 'ترحيل قاعدة البيانات';
  return actor.actorRole || 'غير معروف';
};
