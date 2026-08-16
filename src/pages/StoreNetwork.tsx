import React, { useEffect, useState } from 'react';
import { Link2, RefreshCw, Store as StoreIcon, UserCheck, UserX } from 'lucide-react';
import { supabase } from '../db/supabase';
import type { StoreAccessRequest } from '../types';

interface Membership {
  storeId: string;
  storeCode: string;
  storeName: string;
  mobileNumber: string;
  roleName: string;
  isOwner: boolean;
}

const mapRequest = (row: Record<string, unknown>): StoreAccessRequest => ({
  id: row.id as string,
  storeId: row.store_id as string,
  storeCode: row.store_code as string,
  storeName: row.store_name as string,
  requesterId: row.requester_id as string,
  requesterName: row.requester_name as string,
  requestedRole: row.requested_role as string,
  status: row.status as StoreAccessRequest['status'],
  canReview: row.can_review as boolean,
  createdAt: row.created_at as string,
});

export const StoreNetwork: React.FC = () => {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [requests, setRequests] = useState<StoreAccessRequest[]>([]);
  const [storeCode, setStoreCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('my_store_network');
    if (loadError) {
      setError('تعذر تحميل شبكة المتاجر.');
    } else {
      const result = (data ?? {}) as Record<string, unknown>;
      setMemberships(((result.memberships ?? []) as Record<string, unknown>[]).map(row => ({
        storeId: row.store_id as string,
        storeCode: row.store_code as string,
        storeName: row.store_name as string,
        mobileNumber: row.mobile_number as string,
        roleName: row.role_name as string,
        isOwner: row.is_owner as boolean,
      })));
      setRequests(((result.requests ?? []) as Record<string, unknown>[]).map(mapRequest));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const requestAccess = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    const { error: requestError } = await supabase.rpc('request_store_access', { p_store_code: storeCode.trim() });
    if (requestError) {
      const raw = requestError.message ?? '';
      setError(raw.includes('NO_SUCH_STORE') ? 'معرّف المتجر غير موجود.' : raw.includes('ALREADY_MEMBER') ? 'أنت عضو بالفعل في هذا المتجر.' : 'تعذر إرسال طلب الربط.');
    } else {
      setStoreCode('');
      setMessage('تم إرسال الطلب. سيظهر للمالك للموافقة عليه.');
      await load();
    }
    setBusy(false);
  };

  const review = async (request: StoreAccessRequest, approve: boolean) => {
    setBusy(true); setMessage(''); setError('');
    const { error: reviewError } = await supabase.rpc('review_store_access', { p_request_id: request.id, p_approve: approve });
    if (reviewError) setError('تعذر تحديث طلب الربط.');
    else { setMessage(approve ? 'تمت الموافقة على الربط.' : 'تم رفض طلب الربط.'); await load(); }
    setBusy(false);
  };

  return (
    <div className="space-y-7" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-2xl bg-primary-100 text-primary-700"><Link2 size={25} /></div>
            <h2 className="text-3xl font-black text-surface-900">شبكة المتاجر</h2>
          </div>
          <p className="text-surface-500">اربط متاجرك المملوكة لتسهيل مشاركة العملاء والمندوبين والمناطق.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-surface-200 font-bold text-surface-700">
          <RefreshCw size={17} /> تحديث
        </button>
      </div>

      {(error || message) && <div className={`rounded-2xl border px-4 py-3 font-bold text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
        <form onSubmit={requestAccess} className="glass-panel rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2"><Link2 size={20} className="text-primary-700" /><h3 className="text-lg font-black">ربط متجر مملوك</h3></div>
          <p className="text-sm text-surface-500">أدخل Store ID الموجود على بطاقة المتجر. سيطلب المالك الحالي الموافقة.</p>
          <input value={storeCode} onChange={event => setStoreCode(event.target.value.toUpperCase())} dir="ltr" placeholder="ST-XXXXXXXXXX" required className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 font-mono" />
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary-700 px-4 py-3 font-bold text-white disabled:opacity-50">إرسال طلب الربط</button>
        </form>

        <div className="space-y-6">
          <div className="glass-panel rounded-3xl overflow-hidden">
            <div className="p-5 border-b border-surface-200/70 flex items-center gap-2"><StoreIcon size={20} className="text-primary-700" /><h3 className="font-black text-lg">المتاجر المرتبطة</h3></div>
            {loading ? <div className="p-8 text-center text-surface-500">جارٍ التحميل...</div> : memberships.length === 0 ? <div className="p-8 text-center text-surface-500">لا توجد متاجر مرتبطة.</div> : (
              <div className="divide-y divide-surface-200/70">{memberships.map(item => <div key={item.storeId} className="p-5 flex flex-wrap items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-700 grid place-items-center"><StoreIcon size={19} /></div>
                <div className="flex-1 min-w-0"><p className="font-bold text-surface-900 truncate">{item.storeName}</p><p className="text-xs text-surface-500 font-mono" dir="ltr">{item.storeCode}</p></div>
                <span className="text-xs font-bold rounded-full px-3 py-1 bg-surface-100 text-surface-600">{item.isOwner ? 'مالك' : item.roleName}</span>
              </div>)}</div>
            )}
          </div>

          {requests.length > 0 && <div className="glass-panel rounded-3xl overflow-hidden">
            <div className="p-5 border-b border-surface-200/70"><h3 className="font-black text-lg">طلبات الربط</h3></div>
            <div className="divide-y divide-surface-200/70">{requests.map(request => <div key={request.id} className="p-5 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0"><p className="font-bold text-surface-900">{request.requesterName}</p><p className="text-sm text-surface-500">طلب إدارة {request.storeName} ({request.storeCode})</p></div>
              {request.canReview && <><button type="button" disabled={busy} onClick={() => void review(request, true)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-bold disabled:opacity-50"><UserCheck size={16} /> موافقة</button><button type="button" disabled={busy} onClick={() => void review(request, false)} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 text-rose-700 px-3 py-2 text-sm font-bold disabled:opacity-50"><UserX size={16} /> رفض</button></>}
            </div>)}</div>
          </div>}
        </div>
      </div>
    </div>
  );
};
