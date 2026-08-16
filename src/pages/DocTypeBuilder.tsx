import React, { useEffect, useState } from 'react';
import { Blocks, Plus, Save } from 'lucide-react';
import { supabase } from '../db/supabase';
import type { DocTypeDefinition } from '../types';

interface DocField {
  id: string;
  fieldname: string;
  label: string;
  fieldtype: string;
  options: string;
  permLevel: number;
  required: boolean;
  readOnly: boolean;
  hidden: boolean;
}

const FIELD_TYPES = ['Data', 'Text', 'Small Text', 'Int', 'Float', 'Currency', 'Check', 'Date', 'Datetime', 'Phone', 'Link', 'Select'];

export const DocTypeBuilder: React.FC = () => {
  const [doctypes, setDoctypes] = useState<DocTypeDefinition[]>([]);
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState<DocField[]>([]);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [field, setField] = useState({ fieldname: '', label: '', fieldtype: 'Data', options: '', permLevel: 0, required: false, readOnly: false, hidden: false });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadDoctypes = async () => {
    const { data, error: loadError } = await supabase.from('doctype_definitions').select('name,label,module,is_system,is_active,is_submittable').order('module').order('label');
    if (loadError) setError('تعذر تحميل DocTypes.');
    else {
      const next = (data ?? []) as unknown as DocTypeDefinition[];
      setDoctypes(next);
      setSelected(current => current || next[0]?.name || '');
    }
  };

  const loadFields = async (doctype: string) => {
    if (!doctype) { setFields([]); return; }
    const { data, error: loadError } = await supabase.from('doctype_fields').select('id,fieldname,label,fieldtype,options,perm_level,required,read_only,hidden').eq('doctype', doctype).order('position').order('fieldname');
    if (loadError) setError('تعذر تحميل حقول DocType.');
    else setFields((data ?? []).map(row => ({ id: row.id as string, fieldname: row.fieldname as string, label: row.label as string, fieldtype: row.fieldtype as string, options: row.options as string, permLevel: row.perm_level as number, required: row.required as boolean, readOnly: row.read_only as boolean, hidden: row.hidden as boolean })));
  };

  useEffect(() => { void loadDoctypes(); }, []);
  useEffect(() => { void loadFields(selected); }, [selected]);

  const createDocType = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!normalized || !label.trim()) { setError('أدخل اسم DocType واسم العرض.'); return; }
    const { error: saveError } = await supabase.from('doctype_definitions').insert({ name: normalized, label: label.trim(), module: 'Custom', is_system: false });
    if (saveError) setError('تعذر إنشاء DocType. قد يكون الاسم مستخدماً.');
    else { setMessage('تم إنشاء DocType.'); setName(''); setLabel(''); await loadDoctypes(); setSelected(normalized); }
  };

  const addField = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !field.fieldname.trim() || !field.label.trim()) { setError('أدخل اسم الحقل والعنوان.'); return; }
    const { error: saveError } = await supabase.from('doctype_fields').insert({ doctype: selected, fieldname: field.fieldname.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'), label: field.label.trim(), fieldtype: field.fieldtype, options: field.options.trim(), perm_level: field.permLevel, required: field.required, read_only: field.readOnly, hidden: field.hidden, position: fields.length });
    if (saveError) setError('تعذر إضافة الحقل.');
    else { setMessage('تمت إضافة الحقل.'); setField({ fieldname: '', label: '', fieldtype: 'Data', options: '', permLevel: 0, required: false, readOnly: false, hidden: false }); await loadFields(selected); }
  };

  const updateField = async (item: DocField, patch: Partial<DocField>) => {
    const next = { ...item, ...patch };
    setFields(current => current.map(row => row.id === item.id ? next : row));
    const { error: saveError } = await supabase.from('doctype_fields').update({ perm_level: next.permLevel, required: next.required, read_only: next.readOnly, hidden: next.hidden }).eq('id', item.id);
    if (saveError) setError('تعذر حفظ إعدادات الحقل.');
  };

  return (
    <div className="space-y-7" dir="rtl">
      <div className="flex items-center gap-3"><div className="p-2.5 rounded-2xl bg-primary-100 text-primary-700"><Blocks size={25} /></div><div><h2 className="text-3xl font-black text-surface-900">منشئ DocType</h2><p className="text-surface-500 mt-1">تعريفات عامة للنظام حالياً؛ لا ترتبط بمتجر واحد.</p></div></div>
      {(error || message) && <div className={`rounded-2xl border px-4 py-3 font-bold text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-6 items-start">
        <div className="space-y-6">
          <form onSubmit={createDocType} className="glass-panel rounded-3xl p-5 space-y-3"><h3 className="font-black text-lg">DocType جديد</h3><input value={name} onChange={event => setName(event.target.value)} dir="ltr" placeholder="doctype_name" className="w-full bg-white border border-surface-200 rounded-xl px-3 py-2.5" /><input value={label} onChange={event => setLabel(event.target.value)} placeholder="اسم العرض" className="w-full bg-white border border-surface-200 rounded-xl px-3 py-2.5" /><button className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-primary-700 text-white font-bold py-2.5"><Plus size={17} /> إنشاء</button></form>
          <div className="glass-panel rounded-3xl overflow-hidden"><div className="p-5 border-b border-surface-200/70"><h3 className="font-black">DocTypes</h3></div><div className="max-h-[520px] overflow-auto p-2">{doctypes.map(item => <button key={item.name} type="button" onClick={() => setSelected(item.name)} className={`w-full text-right rounded-xl px-3 py-3 ${selected === item.name ? 'bg-primary-50 text-primary-800' : 'hover:bg-surface-50'}`}><span className="block font-bold">{item.label}</span><span className="block text-xs text-surface-500 font-mono" dir="ltr">{item.name}</span></button>)}</div></div>
        </div>
        <div className="glass-panel rounded-3xl p-5 space-y-5"><div><h3 className="text-xl font-black">{doctypes.find(item => item.name === selected)?.label ?? 'اختر DocType'}</h3><p className="text-sm text-surface-500 font-mono" dir="ltr">{selected}</p></div>
          <form onSubmit={addField} className="rounded-2xl bg-surface-50 border border-surface-200 p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3"><input value={field.fieldname} onChange={event => setField(current => ({ ...current, fieldname: event.target.value }))} dir="ltr" placeholder="field_name" className="bg-white border border-surface-200 rounded-xl px-3 py-2.5" /><input value={field.label} onChange={event => setField(current => ({ ...current, label: event.target.value }))} placeholder="عنوان الحقل" className="bg-white border border-surface-200 rounded-xl px-3 py-2.5" /><select value={field.fieldtype} onChange={event => setField(current => ({ ...current, fieldtype: event.target.value }))} className="bg-white border border-surface-200 rounded-xl px-3 py-2.5">{FIELD_TYPES.map(item => <option key={item}>{item}</option>)}</select><input value={field.options} onChange={event => setField(current => ({ ...current, options: event.target.value }))} placeholder="خيارات / DocType مرتبط" className="bg-white border border-surface-200 rounded-xl px-3 py-2.5" /><select value={field.permLevel} onChange={event => setField(current => ({ ...current, permLevel: Number(event.target.value) }))} className="bg-white border border-surface-200 rounded-xl px-3 py-2.5">{Array.from({ length: 10 }, (_, level) => <option key={level} value={level}>مستوى {level}</option>)}</select><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={field.required} onChange={event => setField(current => ({ ...current, required: event.target.checked }))} /> مطلوب</label><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={field.readOnly} onChange={event => setField(current => ({ ...current, readOnly: event.target.checked }))} /> للقراءة فقط</label><button disabled={!selected} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-700 text-white font-bold py-2.5 disabled:opacity-50"><Plus size={17} /> إضافة حقل</button></form>
          <div className="divide-y divide-surface-200/70">{fields.map(item => <div key={item.id} className="py-4 flex flex-wrap items-center gap-3"><div className="flex-1 min-w-[180px]"><p className="font-bold">{item.label}</p><p className="text-xs text-surface-500 font-mono" dir="ltr">{item.fieldname} · {item.fieldtype}</p></div><label className="text-xs font-bold">المستوى<select value={item.permLevel} onChange={event => void updateField(item, { permLevel: Number(event.target.value) })} className="mr-2 bg-white border border-surface-200 rounded-lg px-2 py-1">{Array.from({ length: 10 }, (_, level) => <option key={level} value={level}>{level}</option>)}</select></label><label className="text-xs font-bold flex items-center gap-1"><input type="checkbox" checked={item.required} onChange={event => void updateField(item, { required: event.target.checked })} /> مطلوب</label><label className="text-xs font-bold flex items-center gap-1"><input type="checkbox" checked={item.readOnly} onChange={event => void updateField(item, { readOnly: event.target.checked })} /> قراءة فقط</label><Save size={16} className="text-surface-400" /></div>)}</div>
        </div>
      </div>
    </div>
  );
};
