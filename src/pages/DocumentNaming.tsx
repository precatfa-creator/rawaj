import React, { useEffect, useState } from 'react';
import { Hash, Save } from 'lucide-react';
import { useAppStore } from '../store';
import { supabase } from '../db/supabase';
import { describeSeries } from '../components/forms';
import { Combobox } from '../components/Combobox';
import { ErrorNote } from '../components/Confirm';
import { Card, DataTable, EmptyState, PageHead, Pill, actionButton, count, quietButton } from '../components/ui';
import type { NamingCounter } from '../types';

const fieldClass =
  'w-full bg-white border border-surface-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500';

/**
 * Document naming settings — where the series a doctype offers are decided.
 *
 * Frappe's model, and its division of labour: the series live with the doctype,
 * the counters live apart and can be moved by hand. That second part is not a
 * convenience — a business that issued ORD-2026-0500 on paper before it had
 * this app needs the next one to be 0501, and nothing else can express that.
 */
export const DocumentNamingSettings: React.FC = () => {
  const { documentNaming, stores } = useAppStore();
  const [drafts, setDrafts] = useState<Record<string, { series: string; defaultSeries: string }>>({});
  const [counters, setCounters] = useState<NamingCounter[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  // Seeded from the loaded config, and re-seeded when it changes underneath —
  // realtime keeps `documentNaming` fresh, and a stale draft would silently
  // overwrite someone else's edit on save.
  const key = documentNaming.map(item => `${item.doctype}:${item.series.join('|')}:${item.defaultSeries}`).join(';');
  const [seeded, setSeeded] = useState('');
  if (key !== seeded) {
    setSeeded(key);
    setDrafts(Object.fromEntries(documentNaming.map(item => [
      item.doctype,
      { series: item.series.join('\n'), defaultSeries: item.defaultSeries },
    ])));
  }

  const loadCounters = async () => {
    const { data, error: queryError } = await supabase
      .from('naming_counters')
      .select('prefix,storeKey:store_key,current')
      .order('prefix');
    if (queryError) { console.error('naming counters failed', queryError); return; }
    setCounters((data ?? []) as unknown as NamingCounter[]);
  };

  useEffect(() => { void loadCounters(); }, []);

  const save = async (doctype: string) => {
    const draft = drafts[doctype];
    // One series per line; blank lines are how a list is typed, not entries.
    const series = [...new Set(draft.series.split('\n').map(line => line.trim()).filter(Boolean))];
    if (series.length === 0) { setError('أضف تسلسلاً واحداً على الأقل.'); return; }

    const defaultSeries = series.includes(draft.defaultSeries) ? draft.defaultSeries : series[0];

    setBusy(doctype); setError(''); setNote('');
    const { error: writeError } = await supabase
      .from('document_naming')
      .update({ series, default_series: defaultSeries })
      .eq('doctype', doctype);
    setBusy('');
    if (writeError) {
      console.error('document naming save failed', writeError);
      setError('تعذر الحفظ. تأكد أن التسلسل الافتراضي ضمن القائمة.');
      return;
    }
    setNote('تم الحفظ.');
  };

  const setCounter = async (counter: NamingCounter, value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0) { setError('أدخل رقماً صحيحاً.'); return; }

    setBusy(counter.prefix); setError(''); setNote('');
    const { error: rpcError } = await supabase.rpc('set_naming_counter', {
      p_prefix: counter.prefix,
      p_store_id: counter.storeKey || null,
      p_current: next,
    });
    setBusy('');
    if (rpcError) {
      console.error('set_naming_counter failed', rpcError);
      setError('تعذر تعديل العدّاد.');
      return;
    }
    setNote(`المستند التالي في ${counter.prefix} سيحمل الرقم ${next + 1}.`);
    void loadCounters();
  };

  const storeName = (storeKey: string) =>
    storeKey === '' ? 'كل المتاجر' : (stores.find(store => store.id === storeKey)?.name ?? 'متجر محذوف');

  return (
    <div className="space-y-6">
      <PageHead
        title="تسمية المستندات"
        subtitle="كيف يُرقَّم كل نوع من المستندات، ومن أين يكمل العدّاد."
      >
        <Pill tone="bg-primary-50 text-primary-800 border-primary-200">
          <Hash size={14} />
          للمدراء
        </Pill>
      </PageHead>

      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-blue-900">
        <Hash size={18} className="shrink-0 mt-0.5" />
        <p className="text-sm font-medium leading-relaxed">
          التسلسل نمط: <span dir="ltr" className="font-black">.YYYY.</span> و
          <span dir="ltr" className="font-black"> .YY.</span> و
          <span dir="ltr" className="font-black"> .MM.</span> و
          <span dir="ltr" className="font-black"> .DD.</span> تُستبدل بالتاريخ وقت الإنشاء،
          و<span dir="ltr" className="font-black">####</span> هو العدّاد وعدد الرموز هو عدد الخانات.
          مثال: <span dir="ltr" className="font-black">ORD-.YYYY.-.####</span> ينتج
          <span dir="ltr" className="font-black"> ORD-{new Date().getFullYear()}-0001</span>.
          العدّاد لكل متجر على حدة، فيبدأ ترقيم كل متجر من 1.
        </p>
      </div>

      {error && <ErrorNote message={error} />}
      {note && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 font-bold text-sm p-3">
          {note}
        </p>
      )}

      {documentNaming.length === 0 ? (
        <EmptyState
          icon={<Hash size={30} />}
          title="لا توجد أنواع مستندات"
          body="شغّل ترحيل قاعدة البيانات لتحميل إعدادات التسمية."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {documentNaming.map(config => {
            const draft = drafts[config.doctype] ?? { series: '', defaultSeries: '' };
            // What the textarea currently says, falling back to what is saved
            // while it is empty — one expression, so the select cannot offer a
            // series the textarea does not list.
            const typed = draft.series.split('\n').map(line => line.trim()).filter(Boolean);
            const options = typed.length > 0 ? typed : config.series;
            return (
              <Card key={config.doctype} className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-black text-lg text-surface-900">{config.label}</h3>
                    <p className="text-xs text-surface-500 mt-0.5" dir="ltr">{config.doctype}</p>
                  </div>
                  <Pill tone={config.perStore
                    ? 'bg-primary-50 text-primary-800 border-primary-200'
                    : 'bg-surface-100 text-surface-600 border-surface-200'}>
                    {config.perStore ? 'عدّاد لكل متجر' : 'عدّاد مشترك'}
                  </Pill>
                </div>

                <label className="block">
                  <span className="block text-sm font-bold text-surface-700 mb-1.5">التسلسلات المتاحة</span>
                  <textarea
                    dir="ltr"
                    rows={Math.max(3, options.length + 1)}
                    value={draft.series}
                    onChange={e => setDrafts(current => ({
                      ...current,
                      [config.doctype]: { ...current[config.doctype], series: e.target.value },
                    }))}
                    className={`${fieldClass} font-mono text-left`}
                  />
                  <span className="block text-xs text-surface-500 mt-1.5">تسلسل واحد في كل سطر.</span>
                </label>

                <Combobox
                  showLabel
                  label="التسلسل الافتراضي"
                  value={draft.defaultSeries}
                  onChange={value => setDrafts(current => ({
                    ...current,
                    [config.doctype]: { ...current[config.doctype], defaultSeries: value },
                  }))}
                  options={options.map(series => ({ value: series, label: series, hint: describeSeries(series) }))}
                />

                <button
                  type="button"
                  onClick={() => void save(config.doctype)}
                  disabled={busy === config.doctype}
                  className={actionButton}
                >
                  <Save size={18} />
                  {busy === config.doctype ? 'جارٍ الحفظ…' : 'حفظ'}
                </button>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-surface-200/70">
          <h3 className="font-black text-surface-900">العدّادات</h3>
          <p className="text-sm text-surface-500 mt-1">
            آخر رقم استُخدم لكل بادئة. عدّله ليكمل الترقيم من حيث توقف نظامك السابق.
          </p>
        </div>
        {counters.length === 0 ? (
          <p className="p-8 text-center text-surface-500">لم يُنشأ أي مستند بعد، فلا عدّادات.</p>
        ) : (
          <DataTable headers={['البادئة', 'المتجر', 'آخر رقم', 'التالي', '']}>
            {counters.map(counter => (
              <tr key={`${counter.prefix}::${counter.storeKey}`} className="hover:bg-surface-50/60 transition-colors">
                <td className="px-5 py-3.5 font-black text-surface-900" dir="ltr">{counter.prefix}</td>
                <td className="px-5 py-3.5 text-surface-700">{storeName(counter.storeKey)}</td>
                <td className="px-5 py-3.5 tabular-nums text-surface-700">{count(counter.current)}</td>
                <td className="px-5 py-3.5 tabular-nums font-bold text-surface-900" dir="ltr">
                  {counter.prefix}{String(counter.current + 1).padStart(4, '0')}
                </td>
                <td className="px-5 py-3.5">
                  <form
                    className="flex items-center gap-2"
                    onSubmit={event => {
                      event.preventDefault();
                      const input = event.currentTarget.elements.namedItem('value') as HTMLInputElement;
                      void setCounter(counter, input.value);
                    }}
                  >
                    <input
                      name="value"
                      type="number"
                      min={0}
                      defaultValue={counter.current}
                      aria-label={`آخر رقم في ${counter.prefix}`}
                      className="w-24 bg-white border border-surface-200 rounded-lg px-2 py-1.5 text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                    />
                    <button type="submit" disabled={busy === counter.prefix} className={`${quietButton} py-1.5 px-3`}>
                      تعيين
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
};
