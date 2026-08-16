import React, { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../db/supabase';
import type { DocTypeDefinition, StoreRole, StoreRolePermission } from '../types';

type PermissionKey =
  | 'canRead' | 'canWrite' | 'canCreate' | 'canDelete' | 'canSubmit' | 'canCancel'
  | 'canAmend' | 'canReport' | 'canExport' | 'canImport' | 'canSetUserPermissions'
  | 'canShare' | 'canPrint' | 'canEmail';

const ACTIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: 'canRead', label: 'قراءة' },
  { key: 'canWrite', label: 'تعديل' },
  { key: 'canCreate', label: 'إنشاء' },
  { key: 'canDelete', label: 'حذف' },
  { key: 'canSubmit', label: 'اعتماد' },
  { key: 'canCancel', label: 'إلغاء' },
  { key: 'canAmend', label: 'تعديل بعد الاعتماد' },
  { key: 'canReport', label: 'تقارير' },
  { key: 'canExport', label: 'تصدير' },
  { key: 'canImport', label: 'استيراد' },
  { key: 'canSetUserPermissions', label: 'تعيين صلاحيات المستخدمين' },
  { key: 'canShare', label: 'مشاركة' },
  { key: 'canPrint', label: 'طباعة' },
  { key: 'canEmail', label: 'بريد' },
];

interface Matrix {
  roles: StoreRole[];
  doctypes: DocTypeDefinition[];
  permissions: StoreRolePermission[];
}

interface StoreUser {
  userId: string;
  displayName: string;
  email: string;
  roleName: string;
}

interface UserPermissionRow {
  id: string;
  userId: string;
  allowDoctype: string;
  allowValue: string;
}

const mapRole = (row: Record<string, unknown>): StoreRole => ({
  id: row.id as string,
  storeId: row.store_id as string,
  name: row.name as string,
  description: row.description as string,
  rank: row.rank as number,
  isSystem: row.is_system as boolean,
});

const mapDoctype = (row: Record<string, unknown>): DocTypeDefinition => ({
  name: row.name as string,
  label: row.label as string,
  module: row.module as string,
  isSystem: row.is_system as boolean,
  isActive: row.is_active as boolean,
  isSubmittable: row.is_submittable as boolean,
});

const mapPermission = (row: Record<string, unknown>): StoreRolePermission => ({
  roleId: row.role_id as string,
  doctype: row.doctype as string,
  permLevel: row.perm_level as number,
  canRead: row.can_read as boolean,
  canWrite: row.can_write as boolean,
  canCreate: row.can_create as boolean,
  canDelete: row.can_delete as boolean,
  canSubmit: row.can_submit as boolean,
  canCancel: row.can_cancel as boolean,
  canAmend: row.can_amend as boolean,
  canReport: row.can_report as boolean,
  canExport: row.can_export as boolean,
  canImport: row.can_import as boolean,
  canSetUserPermissions: row.can_set_user_permissions as boolean,
  canShare: row.can_share as boolean,
  canPrint: row.can_print as boolean,
  canEmail: row.can_email as boolean,
});

const emptyPermission = (roleId: string, doctype: string, permLevel: number): StoreRolePermission => ({
  roleId, doctype, permLevel, canRead: false, canWrite: false, canCreate: false, canDelete: false,
  canSubmit: false, canCancel: false, canAmend: false, canReport: false, canExport: false,
  canImport: false, canSetUserPermissions: false, canShare: false, canPrint: false, canEmail: false,
});

export const RolePermissionManager: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [matrix, setMatrix] = useState<Matrix>({ roles: [], doctypes: [], permissions: [] });
  const [roleId, setRoleId] = useState('');
  const [doctype, setDoctype] = useState('');
  const [permLevel, setPermLevel] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<StoreUser[]>([]);
  const [userPermissions, setUserPermissions] = useState<UserPermissionRow[]>([]);
  const [permissionUserId, setPermissionUserId] = useState('');
  const [permissionDoctype, setPermissionDoctype] = useState('stores');
  const [permissionValue, setPermissionValue] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('store_permission_matrix', { p_store_id: storeId });
    if (loadError) {
      setError('تعذر تحميل مدير الصلاحيات.');
    } else {
      const value = (data ?? {}) as Record<string, unknown>;
      const next: Matrix = {
        roles: ((value.roles ?? []) as Record<string, unknown>[]).map(mapRole),
        doctypes: ((value.doctypes ?? []) as Record<string, unknown>[]).map(mapDoctype),
        permissions: ((value.permissions ?? []) as Record<string, unknown>[]).map(mapPermission),
      };
      setMatrix(next);
      setRoleId(current => current || next.roles[0]?.id || '');
      setDoctype(current => current || next.doctypes[0]?.name || '');
    }
    setLoading(false);
  };

  const loadUserPermissions = async () => {
    const [usersResult, permissionsResult] = await Promise.all([
      supabase.rpc('store_users', { p_store_id: storeId }),
      supabase.from('user_permissions').select('id,user_id,allow_doctype,allow_value').eq('store_id', storeId),
    ]);
    if (usersResult.error || permissionsResult.error) {
      setError('تعذر تحميل صلاحيات المستخدمين.');
      return;
    }
    const rows = ((usersResult.data ?? []) as Record<string, unknown>[]).map(row => ({
      userId: row.user_id as string,
      displayName: row.display_name as string,
      email: row.email as string,
      roleName: row.role_name as string,
    }));
    setUsers(rows);
    setPermissionUserId(current => current || rows[0]?.userId || '');
    setUserPermissions(((permissionsResult.data ?? []) as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      userId: row.user_id as string,
      allowDoctype: row.allow_doctype as string,
      allowValue: row.allow_value as string,
    })));
  };

  useEffect(() => { void load(); void loadUserPermissions(); }, [storeId]);

  const selected = useMemo(() => matrix.permissions.find(item =>
    item.roleId === roleId && item.doctype === doctype && item.permLevel === permLevel
  ) ?? emptyPermission(roleId, doctype, permLevel), [matrix.permissions, roleId, doctype, permLevel]);

  const setAction = (key: PermissionKey, checked: boolean) => {
    const next = { ...selected, [key]: checked };
    setMatrix(current => ({
      ...current,
      permissions: [
        ...current.permissions.filter(item => !(item.roleId === roleId && item.doctype === doctype && item.permLevel === permLevel)),
        next,
      ],
    }));
    setMessage('');
  };

  const save = async () => {
    if (!roleId || !doctype) return;
    setSaving(true);
    setMessage('');
    setError('');
    const { error: saveError } = await supabase.rpc('set_store_role_permission', {
      p_store_id: storeId,
      p_role_id: roleId,
      p_doctype: doctype,
      p_perm_level: permLevel,
      p_read: selected.canRead,
      p_write: selected.canWrite,
      p_create: selected.canCreate,
      p_delete: selected.canDelete,
      p_submit: selected.canSubmit,
      p_cancel: selected.canCancel,
      p_amend: selected.canAmend,
      p_report: selected.canReport,
      p_export: selected.canExport,
      p_import: selected.canImport,
      p_set_user_permissions: selected.canSetUserPermissions,
      p_share: selected.canShare,
      p_print: selected.canPrint,
      p_email: selected.canEmail,
    });
    if (saveError) setError('تعذر حفظ الصلاحيات.');
    else setMessage('تم حفظ الصلاحيات.');
    setSaving(false);
  };

  const saveUserPermission = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!permissionUserId || !permissionDoctype || !permissionValue.trim()) return;
    const { error: saveError } = await supabase.rpc('set_store_user_permission', {
      p_store_id: storeId,
      p_user_id: permissionUserId,
      p_allow_doctype: permissionDoctype,
      p_allow_value: permissionValue.trim(),
      p_apply_to_doctype: null,
    });
    if (saveError) setError('تعذر حفظ تقييد المستخدم.');
    else { setMessage('تم حفظ تقييد المستخدم.'); setPermissionValue(''); await loadUserPermissions(); }
  };

  const removeUserPermission = async (row: UserPermissionRow) => {
    const { error: removeError } = await supabase.rpc('remove_store_user_permission', { p_store_id: storeId, p_permission_id: row.id });
    if (removeError) setError('تعذر حذف تقييد المستخدم.');
    else { setMessage('تم حذف التقييد.'); await loadUserPermissions(); }
  };

  return (
    <div className="space-y-7" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-2xl bg-primary-100 text-primary-700"><ShieldCheck size={25} /></div>
            <h2 className="text-3xl font-black text-surface-900">مدير صلاحيات الأدوار</h2>
          </div>
          <p className="text-surface-500">الصلاحيات هنا خاصة بهذا المتجر ولا تنتقل إلى متجر آخر.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-surface-200 font-bold text-surface-700">
          <RefreshCw size={17} /> تحديث
        </button>
      </div>

      {(error || message) && <div className={`rounded-2xl border px-4 py-3 font-bold text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}

      {loading ? <div className="glass-panel rounded-3xl p-10 text-center text-surface-500">جارٍ تحميل الصلاحيات...</div> : (
        <div className="glass-panel rounded-3xl p-5 md:p-7 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block"><span className="block text-sm font-bold text-surface-600 mb-2">الدور</span>
              <select value={roleId} onChange={event => setRoleId(event.target.value)} className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3">
                {matrix.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="block text-sm font-bold text-surface-600 mb-2">DocType</span>
              <select value={doctype} onChange={event => setDoctype(event.target.value)} className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3">
                {matrix.doctypes.map(item => <option key={item.name} value={item.name}>{item.label} ({item.name})</option>)}
              </select>
            </label>
            <label className="block"><span className="block text-sm font-bold text-surface-600 mb-2">مستوى الحقل</span>
              <select value={permLevel} onChange={event => setPermLevel(Number(event.target.value))} className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3">
                {Array.from({ length: 10 }, (_, level) => <option key={level} value={level}>المستوى {level}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {ACTIONS.map(action => (
              <label key={action.key} className="flex items-center gap-2 rounded-xl border border-surface-200 bg-white px-3 py-3 cursor-pointer">
                <input type="checkbox" checked={selected[action.key]} onChange={event => setAction(action.key, event.target.checked)} className="w-4 h-4 rounded text-primary-700 focus:ring-primary-500" />
                <span className="text-sm font-bold text-surface-700">{action.label}</span>
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <button type="button" disabled={saving || !roleId || !doctype} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-primary-700 px-5 py-3 font-bold text-white hover:bg-primary-800 disabled:opacity-50">
              {saving ? <RefreshCw size={17} className="animate-spin" /> : <Save size={17} />}
              حفظ الصلاحيات
            </button>
          </div>

          <div className="rounded-2xl bg-surface-50 border border-surface-200 p-4 text-sm text-surface-600 flex items-start gap-3">
            <Check size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <span>مستوى الحقل يجب أن يطابق مستوى الصلاحية. إخفاء الحقل في الواجهة ليس بديلاً عن التحقق في قاعدة البيانات.</span>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-3xl p-5 md:p-7 space-y-5">
        <div><h3 className="text-xl font-black">User Permissions</h3><p className="text-sm text-surface-500 mt-1">قيّد مستخدماً بسجلات محددة. هذا التقييد مستقل عن صلاحيات الدور.</p></div>
        <form onSubmit={saveUserPermission} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="block"><span className="block text-sm font-bold text-surface-600 mb-2">المستخدم</span><select value={permissionUserId} onChange={event => setPermissionUserId(event.target.value)} className="w-full bg-white border border-surface-200 rounded-xl px-3 py-2.5">{users.map(user => <option key={user.userId} value={user.userId}>{user.displayName} — {user.roleName}</option>)}</select></label>
          <label className="block"><span className="block text-sm font-bold text-surface-600 mb-2">DocType</span><select value={permissionDoctype} onChange={event => setPermissionDoctype(event.target.value)} className="w-full bg-white border border-surface-200 rounded-xl px-3 py-2.5">{matrix.doctypes.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
          <label className="block"><span className="block text-sm font-bold text-surface-600 mb-2">قيمة السجل</span><input value={permissionValue} onChange={event => setPermissionValue(event.target.value)} dir="ltr" placeholder="معرّف السجل" className="w-full bg-white border border-surface-200 rounded-xl px-3 py-2.5" /></label>
          <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-700 text-white font-bold py-2.5"><Save size={17} /> حفظ التقييد</button>
        </form>
        {userPermissions.length > 0 && <div className="divide-y divide-surface-200/70">{userPermissions.map(row => <div key={row.id} className="py-3 flex flex-wrap items-center gap-3"><span className="font-bold">{users.find(user => user.userId === row.userId)?.displayName ?? row.userId}</span><span className="text-sm text-surface-500">{row.allowDoctype} = <b dir="ltr">{row.allowValue}</b></span><button type="button" onClick={() => void removeUserPermission(row)} className="mr-auto text-sm font-bold text-rose-700">حذف</button></div>)}</div>}
      </div>
    </div>
  );
};
