import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, KeyRound, Link2, Loader2, PanelsTopLeft, Store as StoreIcon, Trash2, UserRound,
} from 'lucide-react';
import { supabase } from '../db/supabase';
import { useAppStore } from '../store';
import { roleLabels } from '../lib/actors';
import { uploadAvatar, deleteAvatar } from '../lib/storage';
import { Avatar, Card, PageHead, Pill, StatusLine, type StatusMessage, actionButton, quietButton } from '../components/ui';
import { Confirm } from '../components/Confirm';
import { clearCachedData, type SidebarGroupsMode } from '../lib/settings';
import type { Profile } from '../types';

const SIDEBAR_OPTIONS: Array<{ value: SidebarGroupsMode; label: string; body: string }> = [
  {
    value: 'always',
    label: 'إظهار كل المجموعات دائماً',
    body: 'كل الأقسام مفتوحة طوال الوقت. لا توجد أزرار طي — القائمة أطول لكنها ثابتة، وكل قسم في مكانه المعتاد.',
  },
  {
    value: 'collapsible',
    label: 'السماح بطي المجموعات',
    body: 'اضغط على عنوان المجموعة لطيها أو فتحها. ما تطويه يُحفظ على هذا الجهاز، والمجموعة التي تحتوي الصفحة المفتوحة تبقى ظاهرة دائماً.',
  },
];

interface Membership {
  storeId: string;
  storeCode: string;
  storeName: string;
  roleName: string;
  isOwner: boolean;
}

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

interface AccountProps {
  profile: Profile;
  /** The rename must reach the header and sidebar the moment it saves. */
  onProfileUpdated: (profile: Profile) => void;
  /** The linked-stores card links out to the full network screen. */
  onOpenNetwork: () => void;
}

/**
 * The signed-in person's page: who they are, their password, where their
 * account reaches, and how the app behaves for them.
 *
 * Everything here is private and per person: the preference rows live in
 * `user_settings` keyed by user id, the profile policy only ever matches the
 * caller's own row, and the password change goes through the auth session —
 * there is no path, administrator included, to another person's section.
 */
export const Preferences: React.FC<AccountProps> = ({ profile, onProfileUpdated, onOpenNetwork }) => {
  const { settings, updateSetting } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const choose = async (value: SidebarGroupsMode) => {
    if (value === settings.sidebarGroups) return;
    setBusy(true); setError('');
    const ok = await updateSetting('sidebarGroups', value);
    setBusy(false);
    if (!ok) setError('تعذر حفظ التفضيل. تحقق من الاتصال وحاول مجدداً.');
  };

  // --- profile ---

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<StatusMessage | null>(null);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const next = displayName.trim();
    if (!next || next === profile.displayName) return;
    setSavingName(true); setNameStatus(null);
    // The database grant limits this to display_name; role and active stay
    // admin-only no matter what this request tries to set.
    const { error: updateError } = await supabase
      .from('profiles').update({ display_name: next }).eq('id', profile.id);
    if (updateError) {
      setNameStatus({ ok: false, text: 'تعذر حفظ الاسم. تحقق من الاتصال وحاول مجدداً.' });
    } else {
      onProfileUpdated({ ...profile, displayName: next });
      setNameStatus({ ok: true, text: 'تم تحديث الاسم.' });
    }
    setSavingName(false);
  };

  const memberSince = useMemo(() => {
    const date = new Date(profile.createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ar-LY', { year: 'numeric', month: 'long' }).format(date);
  }, [profile.createdAt]);

  // --- avatar ---

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<StatusMessage | null>(null);

  const saveAvatarUrl = async (url: string, previousUrl: string) => {
    const { error: updateError } = await supabase
      .from('profiles').update({ avatar_url: url }).eq('id', profile.id);
    if (updateError) {
      setAvatarStatus({ ok: false, text: 'تعذر حفظ الصورة. حاول مجدداً.' });
      return false;
    }
    // The replaced object is garbage the moment the row points away from it.
    if (previousUrl) void deleteAvatar(previousUrl);
    onProfileUpdated({ ...profile, avatarUrl: url });
    return true;
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true); setAvatarStatus(null);
    const result = await uploadAvatar(file, profile.id);
    if (result.url) {
      const saved = await saveAvatarUrl(result.url, profile.avatarUrl);
      if (saved) setAvatarStatus({ ok: true, text: 'تم تحديث الصورة.' });
    } else {
      setAvatarStatus({ ok: false, text: result.message ?? 'تعذر رفع الصورة.' });
    }
    setUploadingAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true); setAvatarStatus(null);
    const saved = await saveAvatarUrl('', profile.avatarUrl);
    if (saved) setAvatarStatus({ ok: true, text: 'تمت إزالة الصورة.' });
    setUploadingAvatar(false);
  };

  // --- password ---

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<StatusMessage | null>(null);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setPasswordStatus({ ok: false, text: 'كلمة المرور الجديدة لا تقل عن 8 أحرف.' });
      return;
    }
    if (password !== confirmPassword) {
      setPasswordStatus({ ok: false, text: 'كلمتا المرور غير متطابقتين.' });
      return;
    }
    setSavingPassword(true); setPasswordStatus(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPasswordStatus({ ok: false, text: 'تعذر تغيير كلمة المرور. اختر كلمة أقوى وحاول مجدداً.' });
    } else {
      setPassword('');
      setConfirmPassword('');
      setPasswordStatus({ ok: true, text: 'تم تغيير كلمة المرور. استخدمها في الدخول القادم.' });
    }
    setSavingPassword(false);
  };

  // --- linked stores ---

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loadingNetwork, setLoadingNetwork] = useState(true);
  const [networkError, setNetworkError] = useState(false);

  const loadNetwork = useCallback(async () => {
    setLoadingNetwork(true);
    const { data, error: loadError } = await supabase.rpc('my_store_network');
    if (loadError) {
      setNetworkError(true);
    } else {
      setNetworkError(false);
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
  }, []);

  useEffect(() => { void loadNetwork(); }, [loadNetwork]);

  return (
    <div className="space-y-7" dir="rtl">
      <PageHead title="حسابي" subtitle="بياناتك وكلمة المرور والمتاجر المرتبطة بحسابك، وتفضيلاتك الخاصة.">
        <Pill tone="bg-primary-50 text-primary-800 border-primary-200">
          <UserRound size={14} />
          خاصة بك
        </Pill>
      </PageHead>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-900 font-bold text-sm p-3">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            {cardHead(<UserRound size={20} />, 'الملف الشخصي', 'اسمك كما يراه زملاؤك في السستم.')}

            <div className="flex items-center gap-4 rounded-2xl bg-surface-50 border border-surface-200/70 p-4">
              <div className="relative shrink-0">
                <Avatar
                  src={profile.avatarUrl}
                  name={profile.displayName || profile.email}
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
              <div className="min-w-0">
                <p className="font-black text-surface-900 truncate">{profile.displayName}</p>
                <p className="text-sm text-surface-500 truncate" dir="ltr">{profile.email}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <Pill>{roleLabels[profile.role] ?? profile.role}</Pill>
                  {memberSince && <span className="text-xs text-surface-400">عضو منذ {memberSince}</span>}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* The label wraps the input, so the whole button opens the
                  picker and no separate control is needed. */}
              <label className={`${quietButton} cursor-pointer`}>
                <Camera size={17} />
                {profile.avatarUrl ? 'تغيير الصورة' : 'إضافة صورة'}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploadingAvatar}
                  onChange={event => void pickAvatar(event.target.files?.[0])}
                  className="sr-only"
                />
              </label>
              {profile.avatarUrl && (
                <button
                  type="button"
                  onClick={() => void removeAvatar()}
                  disabled={uploadingAvatar}
                  className="inline-flex items-center justify-center gap-2 bg-white border border-surface-200 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-surface-700 px-4 py-2.5 rounded-xl font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  <Trash2 size={16} />
                  إزالة الصورة
                </button>
              )}
              <StatusLine status={avatarStatus} />
            </div>

            <form onSubmit={rename} className="space-y-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-600 mb-2">الاسم المعروض</span>
                <input
                  name="displayName"
                  autoComplete="name"
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  maxLength={60}
                  className={inputClass}
                />
              </label>
              {/* The mailbox is the login itself, and it changes through the
                  administrator — saying so beats a field that fails. */}
              <p className="text-xs text-surface-400">البريد الإلكتروني لا يتغير من هنا؛ لتغييره تواصل مع مدير النظام.</p>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={savingName || displayName.trim() === profile.displayName || !displayName.trim()}
                  className={actionButton}
                >
                  {savingName ? 'جارٍ الحفظ…' : 'حفظ الاسم'}
                </button>
                <StatusLine status={nameStatus} />
              </div>
            </form>
          </Card>

          <Card className="p-5 space-y-4">
            {cardHead(<KeyRound size={20} />, 'كلمة المرور', 'غيّرها في أي وقت؛ جلستك الحالية تبقى كما هي.')}

            <form onSubmit={changePassword} className="space-y-3">
              <label className="block">
                <span className="block text-sm font-bold text-surface-600 mb-2">كلمة المرور الجديدة</span>
                <input
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  spellCheck={false}
                  dir="ltr"
                  minLength={8}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  required
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-bold text-surface-600 mb-2">تأكيد كلمة المرور</span>
                <input
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  spellCheck={false}
                  dir="ltr"
                  minLength={8}
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  required
                  className={inputClass}
                />
              </label>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={savingPassword} className={actionButton}>
                  {savingPassword ? 'جارٍ التغيير…' : 'تغيير كلمة المرور'}
                </button>
                <StatusLine status={passwordStatus} />
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            {cardHead(
              <Link2 size={20} />,
              'المتاجر المرتبطة',
              'المتاجر التي يصل إليها حسابك، ودورك في كل واحد منها.',
            )}

            {loadingNetwork ? (
              <div className="p-6 text-center text-surface-500 text-sm">جارٍ التحميل…</div>
            ) : networkError ? (
              <div className="p-6 text-center text-rose-700 text-sm font-bold">تعذر تحميل المتاجر المرتبطة.</div>
            ) : memberships.length === 0 ? (
              <p className="p-6 text-center text-surface-500 text-sm">لا توجد متاجر مرتبطة بحسابك بعد.</p>
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

            <button type="button" onClick={onOpenNetwork} className={quietButton}>
              <Link2 size={17} />
              إدارة الشبكة وطلبات الربط
            </button>
          </Card>

          <Card className="p-5 space-y-4">
            {cardHead(<PanelsTopLeft size={20} />, 'مجموعات القائمة الجانبية', 'أقسام المتجر مرتّبة في مجموعات: المخزون، المبيعات، التوصيل، التقارير.')}

            {/* A radiogroup, not two switches: the two states are exclusive, and a
                pair of independent toggles would let both be off. */}
            <div role="radiogroup" aria-label="مجموعات القائمة الجانبية" className="grid grid-cols-1 gap-3">
              {SIDEBAR_OPTIONS.map(option => {
                const selected = settings.sidebarGroups === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy}
                    onClick={() => void choose(option.value)}
                    className={`text-right rounded-2xl border p-4 transition-colors disabled:opacity-60
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                      selected
                        ? 'border-primary-300 bg-primary-50/70 shadow-sm'
                        : 'border-surface-200 hover:border-surface-300 hover:bg-surface-50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`w-4 h-4 rounded-full border-4 shrink-0 ${
                          selected ? 'border-primary-500 bg-white' : 'border-surface-300 bg-white'
                        }`}
                      />
                      <span className="font-black text-surface-900">{option.label}</span>
                    </span>
                    <span className="block text-sm text-surface-600 leading-relaxed mt-2">{option.body}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Kept apart from the preferences above: this changes nothing about how
              the app behaves, it only throws away what this device happens to be
              holding — so it belongs in its own block, not among the choices. */}
          <Card className="p-5 space-y-4">
            {cardHead(
              <Trash2 size={20} />,
              'مسح ذاكرة التطبيق',
              'يحذف النسخة المخزّنة من التطبيق على هذا الجهاز ويعيد تحميله من جديد. استخدمه إذا ظهرت شاشة قديمة أو لم يظهر تحديث. لن تخرج من حسابك، ولن تفقد أي بيانات — كل شيء محفوظ على الخادم.',
            )}

            <button type="button" onClick={() => setConfirmClear(true)} className={quietButton}>
              <Trash2 size={17} />
              مسح الذاكرة وإعادة التحميل
            </button>
          </Card>
        </div>
      </div>

      <Confirm
        open={confirmClear}
        title="مسح ذاكرة التطبيق"
        message="ستُحذف النسخة المخزّنة على هذا الجهاز وتُعاد تحميل الصفحة. حسابك وبياناتك لن تتأثر."
        confirmLabel="مسح وإعادة التحميل"
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearCachedData();
          window.location.reload();
          return { ok: true };
        }}
      />
    </div>
  );
};
