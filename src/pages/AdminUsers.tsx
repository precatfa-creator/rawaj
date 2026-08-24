import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Camera, ChevronLeft, KeyRound, Loader2, Search, ShieldCheck,
  Store as StoreIcon, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { supabase } from '../db/supabase';
import { roleLabels } from '../lib/actors';
import { uploadAvatar, deleteAvatar } from '../lib/storage';
import { Combobox } from '../components/Combobox';
import { Field, Modal, fieldClass, ghostButton, primaryButton } from '../components/Modal';
import { Confirm } from '../components/Confirm';
import {
  Avatar, Card, CopyableCode, PageHead, Pagination, Pill, StatusLine,
  type StatusMessage, actionButton, quietButton,
} from '../components/ui';
import type { Profile, UserRole } from '../types';

const USERS_PAGE_SIZE = 20;
const PROFILE_COLUMNS = 'id,email,display_name,role,active,created_at,avatar_url';

const toProfile = (row: Record<string, unknown>): Profile => ({
  id: row.id as string,
  email: row.email as string,
  displayName: (row.display_name as string) || (row.email as string),
  role: row.role as UserRole,
  active: row.active as boolean,
  createdAt: row.created_at as string,
  avatarUrl: (row.avatar_url as string) || '',
});

const rolePillTone = (role: UserRole) =>
  role === 'admin' ? 'bg-violet-50 text-violet-700 border-violet-200'
    : role === 'agent' ? 'bg-sky-50 text-sky-700 border-sky-200'
    : 'bg-surface-100 text-surface-600 border-surface-200';

const inputClass =
  'w-full bg-white border border-surface-200 rounded-xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40';

const cardHead = (icon: React.ReactNode, title: string, body: string) => (
  <div className="flex items-start gap-3">
    <span className="shrink-0 mt-0.5 text-surface-400">{icon}</span>
    <div>
      <h3 className="font-black text-surface-900">{title}</h3>
      <p className="text-sm text-surface-500 mt-0.5 leading-relaxed">{body}</p>
    </div>
  </div>
);

/** Every privileged change funnels through the Edge Function under the service role. */
const invokeAdmin = async (body: Record<string, unknown>): Promise<string> => {
  const { error } = await supabase.functions.invoke('admin-users', { body });
  return error ? (error.message ?? '') : '';
};

interface Membership {
  storeId: string;
  storeCode: string;
  storeName: string;
  roleName: string;
  isOwner: boolean;
}

// ---------------------------------------------------------------- list view

const UserList: React.FC<{
  currentUserId: string;
  profiles: Profile[];
  total: number;
  page: number;
  loading: boolean;
  onSearch: (query: string) => void;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
  onCreated: (profile: Profile) => void;
}> = ({ currentUserId, profiles, total, page, loading, onSearch, onPage, onOpen, onCreated }) => {
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHead title="إدارة المستخدمين" subtitle="حسابات الموظفين والمندوبين: الملف، الصلاحية، وكلمة المرور.">
        <button type="button" onClick={() => setCreating(true)} className={actionButton}>
          <UserPlus size={17} />
          مستخدم جديد
        </button>
      </PageHead>

      <Card className="overflow-hidden">
        <div className="p-5 border-b border-surface-200/70 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-primary-700" />
            <h3 className="text-lg font-black">المستخدمون</h3>
            <span className="bg-surface-100 text-surface-600 text-xs font-bold rounded-full px-3 py-1 tabular-nums">{total}</span>
          </div>
          <div className="relative w-full sm:w-72 sm:mr-auto">
            <Search size={17} aria-hidden className="absolute start-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              type="search"
              value={term}
              onChange={event => { setTerm(event.target.value); onSearch(event.target.value); }}
              placeholder="ابحث بالاسم أو البريد…"
              aria-label="ابحث في المستخدمين"
              className="w-full bg-white border border-surface-200 rounded-xl ps-10 pe-9 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            />
            {term && (
              <button
                type="button"
                onClick={() => { setTerm(''); onSearch(''); }}
                aria-label="مسح البحث"
                className="absolute end-2.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-full text-surface-400 hover:text-surface-900 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {loading && profiles.length === 0 ? (
          <div className="p-10 text-center text-surface-500">جارٍ التحميل…</div>
        ) : profiles.length === 0 ? (
          <div className="p-10 text-center text-surface-500">
            {term ? 'لا توجد نتائج مطابقة للبحث.' : 'لا يوجد مستخدمون.'}
          </div>
        ) : (
          <div className="divide-y divide-surface-200/70">
            {profiles.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item.id)}
                className="w-full text-right p-5 flex items-center gap-4 transition-colors hover:bg-surface-50 focus-visible:outline-none focus-visible:bg-surface-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
              >
                <Avatar src={item.avatarUrl} name={item.displayName || item.email} className="w-11 h-11" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-surface-900 truncate">{item.displayName}</p>
                    {item.id === currentUserId && (
                      <span className="text-[11px] font-bold bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">حسابك</span>
                    )}
                  </div>
                  <p className="text-sm text-surface-500 truncate" dir="ltr">{item.email}</p>
                </div>
                <Pill tone={rolePillTone(item.role)}>{roleLabels[item.role] ?? item.role}</Pill>
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${item.active ? 'text-emerald-700' : 'text-rose-700'}`}>
                  <span aria-hidden className={`w-2 h-2 rounded-full ${item.active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {item.active ? 'مفعّل' : 'معطّل'}
                </span>
                <ChevronLeft size={17} aria-hidden className="text-surface-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
        <Pagination page={page} total={total} pageSize={USERS_PAGE_SIZE} onPage={onPage} loading={loading} />
      </Card>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={profile => { setCreating(false); onCreated(profile); }}
      />
    </div>
  );
};

// ---------------------------------------------------------------- create

const CreateUserModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (profile: Profile) => void;
}> = ({ open, onClose, onCreated }) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setDisplayName(''); setEmail(''); setPassword(''); setRole('user'); setError(''); }
  }, [open]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true); setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: { action: 'create', email: email.trim(), password, displayName: displayName.trim(), role },
    });
    if (invokeError) {
      setError('تعذر إنشاء المستخدم. تأكد أن البريد غير مستخدم وأن كلمة المرور لا تقل عن 8 أحرف.');
      setSubmitting(false);
      return;
    }
    const created = (data as { user?: Record<string, unknown> } | null)?.user;
    onCreated({
      id: (created?.id as string) ?? '',
      email: email.trim(),
      displayName: displayName.trim(),
      role,
      active: true,
      createdAt: new Date().toISOString(),
      avatarUrl: '',
    });
    setSubmitting(false);
  };

  return (
    <Modal open={open} title="مستخدم جديد" onClose={onClose}>
      <form onSubmit={create} className="space-y-4" dir="rtl">
        <Field label="الاسم">
          <input
            name="displayName" autoComplete="off" value={displayName}
            onChange={event => setDisplayName(event.target.value)} required className={fieldClass}
          />
        </Field>
        <Field label="البريد الإلكتروني">
          <input
            type="email" name="email" autoComplete="off" spellCheck={false} dir="ltr"
            value={email} onChange={event => setEmail(event.target.value)} required className={fieldClass}
          />
        </Field>
        <Field label="كلمة المرور المؤقتة" hint="ثمانية أحرف على الأقل. يغيّرها المستخدم من صفحة حسابه لاحقاً.">
          <input
            type="password" name="new-password" autoComplete="new-password" spellCheck={false} dir="ltr"
            minLength={8} value={password} onChange={event => setPassword(event.target.value)}
            required className={fieldClass}
          />
        </Field>
        <Combobox
          showLabel label="الصلاحية" value={role} onChange={value => setRole(value as UserRole)}
          options={[
            { value: 'user', label: roleLabels.user },
            { value: 'agent', label: roleLabels.agent },
            { value: 'admin', label: roleLabels.admin },
          ]}
        />
        {error && <p role="alert" className="text-sm font-bold text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-3 pt-1">
          <button type="submit" disabled={submitting} className={primaryButton}>
            {submitting ? 'جارٍ الإنشاء…' : 'إنشاء المستخدم'}
          </button>
          <button type="button" onClick={onClose} className={ghostButton}>إلغاء</button>
        </div>
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------- detail view

interface UserDetailProps {
  user: Profile;
  currentUserId: string;
  onBack: () => void;
  onChanged: (profile: Profile) => void;
  /** Called after the account is deleted, so the page can return to the list. */
  onDeleted: () => void;
}

const UserDetail: React.FC<UserDetailProps> = ({ user, currentUserId, onBack, onChanged, onDeleted }) => {
  const isSelf = user.id === currentUserId;

  // --- identity ---

  const [displayName, setDisplayName] = useState(user.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<StatusMessage | null>(null);

  useEffect(() => setDisplayName(user.displayName), [user.displayName]);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const next = displayName.trim();
    if (!next || next === user.displayName) return;
    setSavingName(true); setNameStatus(null);
    const { error } = await supabase.from('profiles').update({ display_name: next }).eq('id', user.id);
    if (error) setNameStatus({ ok: false, text: 'تعذر حفظ الاسم. حاول مجدداً.' });
    else { onChanged({ ...user, displayName: next }); setNameStatus({ ok: true, text: 'تم تحديث الاسم.' }); }
    setSavingName(false);
  };

  // --- email (service role: no confirmation mail exists to wait for) ---

  const [email, setEmail] = useState(user.email);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<StatusMessage | null>(null);

  useEffect(() => setEmail(user.email), [user.email]);

  const changeEmail = async (event: FormEvent) => {
    event.preventDefault();
    const next = email.trim().toLowerCase();
    if (!next.includes('@') || next === user.email) return;
    setSavingEmail(true); setEmailStatus(null);
    const message = await invokeAdmin({ action: 'set-email', userId: user.id, email: next });
    setSavingEmail(false);
    if (message) setEmailStatus({ ok: false, text: 'تعذر تغيير البريد. تأكد أنه غير مستخدم وحاول مجدداً.' });
    else { onChanged({ ...user, email: next }); setEmailStatus({ ok: true, text: 'تم تغيير البريد؛ يُستخدم في الدخول من الآن.' }); }
  };

  const memberSince = (() => {
    const date = new Date(user.createdAt);
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat('ar-LY', { year: 'numeric', month: 'long' }).format(date);
  })();

  // --- avatar (self only: the bucket only accepts uploads into the owner's folder) ---

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true);
    const result = await uploadAvatar(file, user.id);
    if (result.url) {
      const { error } = await supabase.from('profiles').update({ avatar_url: result.url }).eq('id', user.id);
      if (error) setNameStatus({ ok: false, text: 'تعذر حفظ الصورة. حاول مجدداً.' });
      else {
        if (user.avatarUrl) void deleteAvatar(user.avatarUrl);
        onChanged({ ...user, avatarUrl: result.url });
      }
    } else {
      setNameStatus({ ok: false, text: result.message ?? 'تعذر رفع الصورة.' });
    }
    setUploadingAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true);
    const { error } = await supabase.from('profiles').update({ avatar_url: '' }).eq('id', user.id);
    if (error) setNameStatus({ ok: false, text: 'تعذر إزالة الصورة.' });
    else {
      if (user.avatarUrl) void deleteAvatar(user.avatarUrl);
      onChanged({ ...user, avatarUrl: '' });
    }
    setUploadingAvatar(false);
  };

  // --- role & status (admin, service role) ---

  const [role, setRole] = useState<UserRole>(user.role);
  const [savingRole, setSavingRole] = useState(false);
  const [roleStatus, setRoleStatus] = useState<StatusMessage | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const saveRole = async () => {
    if (role === user.role) return;
    setSavingRole(true); setRoleStatus(null);
    const message = await invokeAdmin({ action: 'set-role', userId: user.id, role });
    setSavingRole(false);
    if (message) setRoleStatus({ ok: false, text: 'تعذر تغيير الصلاحية. حاول مجدداً.' });
    else { onChanged({ ...user, role }); setRoleStatus({ ok: true, text: 'تم تغيير الصلاحية.' }); }
  };

  const setStatus = async (active: boolean): Promise<boolean> => {
    setTogglingStatus(true); setStatusMessage(null);
    const message = await invokeAdmin({ action: 'set-status', userId: user.id, active });
    setTogglingStatus(false);
    if (message) {
      setStatusMessage({ ok: false, text: 'تعذر تغيير حالة المستخدم.' });
      return false;
    }
    onChanged({ ...user, active });
    setStatusMessage({ ok: true, text: active ? 'تم تفعيل الحساب.' : 'تم تعطيل الحساب.' });
    return true;
  };

  // --- password ---

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<StatusMessage | null>(null);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) { setPasswordStatus({ ok: false, text: 'كلمة المرور لا تقل عن 8 أحرف.' }); return; }
    if (!isSelf && password !== confirmPassword) {
      setPasswordStatus({ ok: false, text: 'كلمتا المرور غير متطابقتين.' });
      return;
    }
    setSavingPassword(true); setPasswordStatus(null);
    if (isSelf) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setPasswordStatus({ ok: false, text: 'تعذر تغيير كلمة المرور. اختر كلمة أقوى وحاول مجدداً.' });
      else { setPassword(''); setConfirmPassword(''); setPasswordStatus({ ok: true, text: 'تم تغيير كلمة المرور.' }); }
    } else {
      const message = await invokeAdmin({ action: 'set-password', userId: user.id, password });
      if (message) setPasswordStatus({ ok: false, text: 'تعذر تعيين كلمة المرور. حاول مجدداً.' });
      else { setPassword(''); setConfirmPassword(''); setPasswordStatus({ ok: true, text: 'تم تعيين كلمة المرور، وتم تسجيل خروج المستخدم من كل أجهزته.' }); }
    }
    setSavingPassword(false);
  };

  // --- delete (service role; the database cascades the rest) ---

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteAccount = async (): Promise<boolean> => {
    setDeleting(true);
    const message = await invokeAdmin({ action: 'delete', userId: user.id });
    setDeleting(false);
    if (message) {
      setStatusMessage({ ok: false, text: 'تعذر حذف الحساب. حاول مجدداً.' });
      return false;
    }
    onDeleted();
    return true;
  };

  // --- linked stores ---

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loadingNetwork, setLoadingNetwork] = useState(true);

  const loadNetwork = useCallback(async () => {
    setLoadingNetwork(true);
    const { data, error } = await supabase.rpc('user_store_network', { p_user_id: user.id });
    if (!error) {
      const result = (data ?? {}) as Record<string, unknown>;
      setMemberships(((result.memberships ?? []) as Record<string, unknown>[]).map(row => ({
        storeId: row.store_id as string,
        storeCode: row.store_code as string,
        storeName: row.store_name as string,
        roleName: row.role_name as string,
        isOwner: row.is_owner as boolean,
      })));
    }
    setLoadingNetwork(false);
  }, [user.id]);

  useEffect(() => { void loadNetwork(); }, [loadNetwork]);

  return (
    <div className="space-y-6" dir="rtl">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-bold text-surface-600 hover:text-primary-800 rounded-lg px-2 py-1 -mr-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <ArrowRight size={18} />
        كل المستخدمين
      </button>

      <Card className="p-6 flex flex-wrap items-center gap-4">
        <div className="relative shrink-0">
          <Avatar
            src={user.avatarUrl}
            name={user.displayName || user.email}
            className="w-16 h-16"
            textClass="text-xl"
            fallbackClass="bg-gradient-to-br from-primary-400 to-primary-600 text-white"
          />
          {uploadingAvatar && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-surface-900/40">
              <Loader2 size={20} className="animate-spin text-white" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-surface-900 truncate">{user.displayName}</h2>
            {isSelf && <span className="text-[11px] font-bold bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">حسابك</span>}
          </div>
          <p className="text-sm text-surface-500 truncate" dir="ltr">{user.email}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Pill tone={rolePillTone(user.role)}>{roleLabels[user.role] ?? user.role}</Pill>
            <Pill tone={user.active
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'}
            >
              {user.active ? 'مفعّل' : 'معطّل'}
            </Pill>
            {memberSince && <span className="text-xs text-surface-400">عضو منذ {memberSince}</span>}
          </div>
        </div>
        {isSelf && (
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${quietButton} cursor-pointer`}>
              <Camera size={17} />
              {user.avatarUrl ? 'تغيير الصورة' : 'إضافة صورة'}
              <input
                ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                disabled={uploadingAvatar} onChange={event => void pickAvatar(event.target.files?.[0])}
                className="sr-only"
              />
            </label>
            {user.avatarUrl && (
              <button
                type="button" onClick={() => void removeAvatar()} disabled={uploadingAvatar}
                aria-label="إزالة الصورة" title="إزالة الصورة"
                className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-surface-200 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-surface-700 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            {cardHead(<Users size={20} />, 'الملف الشخصي', 'الاسم والبريد كما يراهما بقية الفريق، والبريد هو ما يُستخدم في الدخول.')}
            <form onSubmit={rename} className="space-y-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-600 mb-2">الاسم المعروض</span>
                <input
                  name="displayName" autoComplete="off" value={displayName} maxLength={60}
                  onChange={event => setDisplayName(event.target.value)} className={inputClass}
                />
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="submit" disabled={savingName || displayName.trim() === user.displayName || !displayName.trim()}
                  className={actionButton}
                >
                  {savingName ? 'جارٍ الحفظ…' : 'حفظ الاسم'}
                </button>
                <StatusLine status={nameStatus} />
              </div>
            </form>
            <form onSubmit={changeEmail} className="space-y-3 pt-1 border-t border-surface-100">
              <label className="block">
                <span className="block text-sm font-bold text-surface-600 mb-2">البريد الإلكتروني</span>
                <input
                  type="email" name="email" autoComplete="off" spellCheck={false} dir="ltr"
                  value={email} onChange={event => setEmail(event.target.value)} required className={inputClass}
                />
              </label>
              <p className="text-xs text-surface-400">معرّف الحساب: <CopyableCode value={user.id} /></p>
              <div className="flex items-center gap-3">
                <button
                  type="submit" disabled={savingEmail || email.trim().toLowerCase() === user.email}
                  className={quietButton}
                >
                  {savingEmail ? 'جارٍ الحفظ…' : 'تغيير البريد'}
                </button>
                <StatusLine status={emailStatus} />
              </div>
            </form>
          </Card>

          <Card className="p-5 space-y-4">
            {cardHead(<KeyRound size={20} />, 'كلمة المرور', isSelf
              ? 'غيّرها في أي وقت؛ جلستك الحالية تبقى كما هي.'
              : 'تعيين كلمة مرور مؤقتة يُسجّل المستخدم خروجاً من كل أجهزته.')}
            <form onSubmit={changePassword} className="space-y-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-600 mb-2">
                  {isSelf ? 'كلمة المرور الجديدة' : 'كلمة المرور المؤقتة'}
                </span>
                <input
                  type="password" name="new-password" autoComplete="new-password" spellCheck={false}
                  dir="ltr" minLength={8} value={password}
                  onChange={event => setPassword(event.target.value)} required className={inputClass}
                />
              </label>
              {!isSelf && (
                <label className="block">
                  <span className="block text-sm font-bold text-surface-600 mb-2">تأكيد كلمة المرور</span>
                  <input
                    type="password" name="confirm-password" autoComplete="new-password" spellCheck={false}
                    dir="ltr" minLength={8} value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)} required className={inputClass}
                  />
                </label>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={savingPassword} className={actionButton}>
                  {savingPassword ? 'جارٍ الحفظ…' : isSelf ? 'تغيير كلمة المرور' : 'تعيين كلمة المرور'}
                </button>
                <StatusLine status={passwordStatus} />
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            {cardHead(<ShieldCheck size={20} />, 'الصلاحية والحالة', 'ما يستطيع هذا الحساب فعله، وهل يدخل أصلاً.')}

            <div>
              <span className="block text-sm font-bold text-surface-600 mb-2">الصلاحية</span>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-44">
                  <Combobox
                    value={role} onChange={value => setRole(value as UserRole)} label="الصلاحية"
                    disabled={isSelf || savingRole}
                    options={[
                      { value: 'user', label: roleLabels.user },
                      { value: 'agent', label: roleLabels.agent },
                      { value: 'admin', label: roleLabels.admin },
                    ]}
                  />
                </div>
                <button
                  type="button" onClick={() => void saveRole()}
                  disabled={isSelf || savingRole || role === user.role} className={quietButton}
                >
                  {savingRole ? 'جارٍ الحفظ…' : 'حفظ الصلاحية'}
                </button>
              </div>
              {isSelf && <p className="text-xs text-surface-400 mt-1.5">لا يمكن تغيير صلاحية حسابك من هنا.</p>}
              <StatusLine status={roleStatus} />
            </div>

            <div className="pt-1 border-t border-surface-100">
              <span className="block text-sm font-bold text-surface-600 mb-2">حالة الحساب</span>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => (user.active ? setConfirmDeactivate(true) : void setStatus(true))}
                  disabled={!isSelf && togglingStatus}
                  className={`text-xs font-bold rounded-xl px-4 py-2.5 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    user.active
                      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {togglingStatus ? '…' : user.active ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                </button>
                <StatusLine status={statusMessage} />
              </div>
              {isSelf && <p className="text-xs text-surface-400 mt-1.5">لا يمكن تعطيل حسابك من هنا.</p>}
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            {cardHead(<StoreIcon size={20} />, 'المتاجر المرتبطة', 'المتاجر التي يصل إليها هذا الحساب، ودوره في كل واحد منها.')}
            {loadingNetwork ? (
              <div className="p-6 text-center text-surface-500 text-sm">جارٍ التحميل…</div>
            ) : memberships.length === 0 ? (
              <p className="p-6 text-center text-surface-500 text-sm">لا توجد متاجر مرتبطة بهذا الحساب.</p>
            ) : (
              <div className="divide-y divide-surface-200/70 rounded-2xl border border-surface-200/70 overflow-hidden">
                {memberships.map(item => (
                  <div key={item.storeId} className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-700 grid place-items-center shrink-0">
                      <StoreIcon size={19} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-surface-900 truncate">{item.storeName}</p>
                      <p className="text-xs text-surface-500 font-mono" dir="ltr">{item.storeCode}</p>
                    </div>
                    <Pill>{item.isOwner ? 'مالك' : item.roleName}</Pill>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Kept outside the grid and visually apart: this is the one action
          that cannot be undone, so it never sits beside the everyday ones. */}
      <Card className="p-5 space-y-4 border-rose-200 bg-gradient-to-b from-rose-50/50 to-white">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 mt-0.5 text-rose-500" />
          <div>
            <h3 className="font-black text-rose-900">منطقة الخطر</h3>
            <p className="text-sm text-surface-500 mt-0.5 leading-relaxed">
              حذف الحساب نهائي ولا يمكن التراجع عنه: يفقد المستخدم دخوله فوراً، وتُحذف عضوياته في
              المتاجر وطلباته المعلّقة. سجل التدقيق يبقى محفوظاً ويظهر اسمه فيه كمستخدم محذوف.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={isSelf || deleting}
          title={isSelf ? 'لا يمكن حذف حسابك من هنا' : undefined}
          className="inline-flex items-center justify-center gap-2 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 px-4 py-2.5 rounded-xl font-bold transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
        >
          <Trash2 size={16} />
          حذف الحساب نهائياً
        </button>
        {isSelf && <p className="text-xs text-surface-400">لا يمكن حذف حسابك أنت؛ اطلب من مدير آخر ذلك.</p>}
        <StatusLine status={statusMessage} />
      </Card>

      <Confirm
        open={confirmDelete}
        title="حذف الحساب"
        message={`سيُحذف حساب ${user.displayName} (${user.email}) نهائياً من السستم. لا يمكن التراجع عن هذه الخطوة.`}
        confirmLabel="حذف نهائياً"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const done = await deleteAccount();
          return done ? { ok: true } : { ok: false, message: 'تعذر حذف الحساب. حاول مجدداً.' };
        }}
      />

      <Confirm
        open={confirmDeactivate}
        title="تعطيل الحساب"
        message={`سيمنع ذلك ${user.displayName} من الدخول إلى السستم فوراً، دون حذف أي بيانات.`}
        confirmLabel="تعطيل الحساب"
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={async () => {
          const done = await setStatus(false);
          return done ? { ok: true } : { ok: false, message: 'تعذر تعطيل الحساب. حاول مجدداً.' };
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------- page

interface AdminUsersProps {
  currentUserId: string;
}

/**
 * The users page, in the shape of a document system: a searchable list, and a
 * full page per user behind it.
 *
 * The old screen squeezed creation and a flat table side by side, which left
 * every account one row deep — no place for the avatar, the role, the
 * password, or the stores a person reaches. Splitting list from form gives
 * each user a page the way the rest of the app treats orders and products.
 */
export const AdminUsers: React.FC<AdminUsersProps> = ({ currentUserId }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  /** The open user is held by value, so the form renders before the list reload catches up. */
  const [selected, setSelected] = useState<Profile | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const from = page * USERS_PAGE_SIZE;
    let request = supabase
      .from('profiles')
      .select(PROFILE_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + USERS_PAGE_SIZE - 1);
    // `.or` parses its argument, so characters with meaning there are stripped
    // rather than escaped — a search term is never a filter expression.
    const term = query.trim().replace(/[,()%]/g, '');
    if (term) request = request.or(`display_name.ilike.%${term}%,email.ilike.%${term}%`);

    const { data, count, error: loadError } = await request;
    if (loadError) setError('تعذر تحميل قائمة المستخدمين.');
    else {
      setError('');
      setProfiles((data ?? []).map(toProfile));
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const search = (next: string) => { setQuery(next); setPage(0); };

  const patchProfile = (next: Profile) => {
    setProfiles(current => current.map(item => (item.id === next.id ? next : item)));
    setSelected(current => (current && current.id === next.id ? next : current));
  };

  return (
    <div className="space-y-7">
      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-900 font-bold text-sm p-3">
          {error}
        </p>
      )}

      {selected ? (
        <UserDetail
          key={selected.id}
          user={selected}
          currentUserId={currentUserId}
          onBack={() => setSelected(null)}
          onChanged={patchProfile}
          onDeleted={() => { setSelected(null); void load(); }}
        />
      ) : (
        <UserList
          currentUserId={currentUserId}
          profiles={profiles}
          total={total}
          page={page}
          loading={loading}
          onSearch={search}
          onPage={setPage}
          onOpen={id => setSelected(profiles.find(item => item.id === id) ?? null)}
          onCreated={profile => { void load(); setSelected(profile); }}
        />
      )}
    </div>
  );
};
