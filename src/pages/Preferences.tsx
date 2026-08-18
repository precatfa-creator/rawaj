import React, { useState } from 'react';
import { PanelsTopLeft, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAppStore } from '../store';
import { Card, PageHead, Pill, quietButton } from '../components/ui';
import { Confirm } from '../components/Confirm';
import { clearCachedData, type SidebarGroupsMode } from '../lib/settings';

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

/**
 * Preferences for the signed-in user.
 *
 * Everything here is private and per person: the rows live in `user_settings`
 * keyed by user id, and the policies compare that id to the caller's, so there
 * is no path — administrator included — to read or change someone else's.
 */
export const Preferences: React.FC = () => {
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

  return (
    <div className="space-y-6">
      <PageHead title="تفضيلاتي" subtitle="إعدادات تخصّك وحدك، وتتبعك على أي جهاز تسجّل الدخول منه.">
        <Pill tone="bg-primary-50 text-primary-800 border-primary-200">
          <SlidersHorizontal size={14} />
          خاصة بك
        </Pill>
      </PageHead>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-900 font-bold text-sm p-3">
          {error}
        </p>
      )}

      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <PanelsTopLeft size={20} className="shrink-0 mt-0.5 text-surface-400" />
          <div>
            <h3 className="font-black text-surface-900">مجموعات القائمة الجانبية</h3>
            <p className="text-sm text-surface-500 mt-0.5">
              أقسام المتجر مرتّبة في مجموعات: المخزون، المبيعات، التوصيل، التقارير.
            </p>
          </div>
        </div>

        {/* A radiogroup, not two switches: the two states are exclusive, and a
            pair of independent toggles would let both be off. */}
        <div role="radiogroup" aria-label="مجموعات القائمة الجانبية" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div className="flex items-start gap-3">
          <Trash2 size={20} className="shrink-0 mt-0.5 text-surface-400" />
          <div>
            <h3 className="font-black text-surface-900">مسح ذاكرة التطبيق</h3>
            <p className="text-sm text-surface-500 mt-0.5 leading-relaxed">
              يحذف النسخة المخزّنة من التطبيق على هذا الجهاز ويعيد تحميله من جديد. استخدمه إذا ظهرت
              شاشة قديمة أو لم يظهر تحديث. لن تخرج من حسابك، ولن تفقد أي بيانات — كل شيء محفوظ على الخادم.
            </p>
          </div>
        </div>

        <button type="button" onClick={() => setConfirmClear(true)} className={quietButton}>
          <Trash2 size={17} />
          مسح الذاكرة وإعادة التحميل
        </button>
      </Card>

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
