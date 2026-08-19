import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { supabase } from '../db/supabase';
import { roleLabels } from '../lib/actors';
import { Combobox } from '../components/Combobox';
import { Pagination } from '../components/ui';
import type { Profile, UserRole } from '../types';

interface AdminUsersProps {
  currentUserId: string;
}

const USERS_PAGE_SIZE = 20;

const toProfile = (row: Record<string, unknown>): Profile => ({
  id: row.id as string,
  email: row.email as string,
  displayName: (row.display_name as string) || (row.email as string),
  role: row.role as UserRole,
  active: row.active as boolean,
  createdAt: row.created_at as string,
});

export const AdminUsers: React.FC<AdminUsersProps> = ({ currentUserId }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [changingUserId, setChangingUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadProfiles = useCallback(async () => {
    // Paged like every other list; `total` comes from the server so the badge
    // never reports the size of the loaded page.
    const from = page * USERS_PAGE_SIZE;
    const { data, count, error: loadError } = await supabase
      .from('profiles')
      .select('id,email,display_name,role,active,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + USERS_PAGE_SIZE - 1);

    if (loadError) {
      setError('تعذر تحميل قائمة المستخدمين.');
    } else {
      setProfiles((data ?? []).map((item) => toProfile(item)));
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    const { error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'create',
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        role,
      },
    });

    if (invokeError) {
      setError('تعذر إنشاء المستخدم. تأكد أن البريد غير مستخدم وأن كلمة المرور لا تقل عن 8 أحرف.');
    } else {
      setEmail('');
      setDisplayName('');
      setPassword('');
      setRole('user');
      setSuccess('تم إنشاء المستخدم وتفعيله بنجاح.');
      await loadProfiles();
    }
    setSubmitting(false);
  };

  const setUserStatus = async (profile: Profile) => {
    setChangingUserId(profile.id);
    setError('');
    setSuccess('');

    const { error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'set-status',
        userId: profile.id,
        active: !profile.active,
      },
    });

    if (invokeError) {
      setError('تعذر تغيير حالة المستخدم.');
    } else {
      setSuccess(profile.active ? 'تم تعطيل المستخدم.' : 'تم تفعيل المستخدم.');
      await loadProfiles();
    }
    setChangingUserId(null);
  };

  return (
    <div className="space-y-7" dir="rtl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl bg-primary-100 text-primary-700"><ShieldCheck size={25} /></div>
          <h2 className="text-3xl font-black text-surface-900">إدارة المستخدمين</h2>
        </div>
        <p className="text-surface-500">إنشاء حسابات الموظفين والتحكم في صلاحية دخولهم.</p>
      </div>

      {(error || success) && (
        <div className={`p-4 rounded-2xl border flex items-center gap-3 ${error ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
          {error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span className="font-bold text-sm">{error || success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6 items-start">
        <form onSubmit={createUser} className="glass-panel rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <UserPlus size={21} className="text-primary-700" />
            <h3 className="text-lg font-black">إضافة مستخدم</h3>
          </div>

          <label className="block">
            <span className="block text-sm font-bold text-surface-600 mb-2">الاسم</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-bold text-surface-600 mb-2">البريد الإلكتروني</span>
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-bold text-surface-600 mb-2">كلمة المرور المؤقتة</span>
            <input
              type="password"
              dir="ltr"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="new-password"
              className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </label>

          <Combobox
            showLabel
            label="الصلاحية"
            value={role}
            onChange={value => setRole(value as UserRole)}
            options={[
              { value: 'user', label: roleLabels.user },
              { value: 'agent', label: roleLabels.agent },
              { value: 'admin', label: roleLabels.admin },
            ]}
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors"
          >
            {submitting ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم'}
          </button>
        </form>

        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-surface-200/70 flex items-center gap-2">
            <Users size={21} className="text-primary-700" />
            <h3 className="text-lg font-black">المستخدمون</h3>
            <span className="mr-auto bg-surface-100 text-surface-600 text-xs font-bold rounded-full px-3 py-1">{total}</span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-surface-500">جارٍ التحميل…</div>
          ) : profiles.length === 0 ? (
            <div className="p-10 text-center text-surface-500">لا يوجد مستخدمون.</div>
          ) : (
            <div className="divide-y divide-surface-200/70">
              {profiles.map((item) => (
                <div key={item.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-11 h-11 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-black shrink-0">
                    {(item.displayName || item.email).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-surface-900 truncate">{item.displayName}</p>
                      {item.id === currentUserId && <span className="text-[11px] font-bold bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">حسابك</span>}
                    </div>
                    <p className="text-sm text-surface-500 truncate" dir="ltr">{item.email}</p>
                  </div>
                  <span className={`text-xs font-bold rounded-full px-3 py-1 ${
                    item.role === 'admin' ? 'bg-violet-50 text-violet-700'
                      : item.role === 'agent' ? 'bg-sky-50 text-sky-700'
                      : 'bg-surface-100 text-surface-600'
                  }`}>
                    {roleLabels[item.role] ?? item.role}
                  </span>
                  <button
                    type="button"
                    disabled={item.id === currentUserId || changingUserId === item.id}
                    onClick={() => void setUserStatus(item)}
                    className={`text-xs font-bold rounded-xl px-4 py-2 transition-colors disabled:opacity-40 ${item.active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                  >
                    {changingUserId === item.id ? '…' : item.active ? 'مفعّل' : 'معطّل'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <Pagination page={page} total={total} pageSize={USERS_PAGE_SIZE} onPage={setPage} loading={loading} />
        </div>
      </div>
    </div>
  );
};
