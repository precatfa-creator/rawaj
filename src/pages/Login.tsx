import React, { FormEvent, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Info,
  LockKeyhole,
  Mail,
  Truck,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../db/supabase';
import { AboutModal } from '../components/AboutModal';

interface LoginProps {
  authNotice?: string;
}

const features = ['مخزون لحظي', 'طلبات وتوصيل', 'مندوبين وعمولات', 'تقارير مالية'];

const OrderCard: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.85, y: 24 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    transition={{ delay: 0.55, type: 'spring', duration: 0.8 }}
    className="w-64 rounded-xl border border-surface-200 bg-white shadow-sm"
    aria-hidden="true"
  >
    <div className="border-s-4 border-s-emerald-400 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-black text-surface-900" dir="ltr">ORD-2026-0142</p>
        <p className="text-sm font-black text-surface-900">450 د.ل</p>
      </div>
      <p className="mt-1 text-xs font-medium text-surface-500">
        تم التوصيل · حي الأندلس · طرابلس
      </p>
    </div>
  </motion.div>
);

const RevenueCard: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.85, y: 24 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    transition={{ delay: 0.75, type: 'spring', duration: 0.8 }}
    className="w-56 rounded-2xl border border-surface-200 bg-surface-50 p-4"
    aria-hidden="true"
  >
    <p className="text-sm text-surface-500">مبيعات اليوم</p>
    <p className="mt-2 text-2xl font-black text-surface-900">
      12,480 <span className="text-sm font-bold text-surface-500">د.ل</span>
    </p>
    <svg viewBox="0 0 96 32" className="mt-3 h-8 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="loginSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0,26 14,22 28,24 42,16 56,18 70,9 84,11 96,4 V32 H0 Z" fill="url(#loginSpark)" />
      <polyline
        points="0,26 14,22 28,24 42,16 56,18 70,9 84,11 96,4"
        fill="none"
        stroke="#0d9488"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
    <p className="mt-1 text-[11px] font-black text-emerald-700">+18% عن الأمس</p>
  </motion.div>
);

const DeliveryCard: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.85, y: 24 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    transition={{ delay: 0.95, type: 'spring', duration: 0.8 }}
    className="w-64 rounded-2xl border border-surface-200 bg-white p-4 shadow-sm"
    aria-hidden="true"
  >
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-600">
        <Truck size={18} />
      </span>
      <div>
        <p className="text-sm font-black text-surface-900">المندوب أحمد في الطريق</p>
        <p className="text-xs font-medium text-surface-500">8 من 12 طلب تسلّم</p>
      </div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-200">
      <div className="h-full w-2/3 rounded-full bg-primary-600 motion-reduce:transition-none" />
    </div>
  </motion.div>
);

export const Login: React.FC<LoginProps> = ({ authNotice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAbout, setShowAbout] = useState(false);
  const still = useReducedMotion();

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!isSupabaseConfigured) return;

    setLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      setLoading(false);
    }
  };

  const item = {
    hidden: still ? {} : { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div className="min-h-dvh bg-surface-50 rtl lg:grid lg:grid-cols-2" dir="rtl">
      <aside className="relative hidden overflow-hidden bg-gradient-to-bl from-primary-100/70 via-primary-50 to-surface-50 lg:flex lg:flex-col lg:justify-center lg:border-l lg:border-surface-200/70">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(rgba(13,148,136,0.15) 1.5px, transparent 1.5px)',
            backgroundSize: '24px 24px',
            maskImage: 'radial-gradient(ellipse 90% 80% at 60% 40%, black 20%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 60% 40%, black 20%, transparent 75%)',
          }}
        />
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-primary-200/40 blur-[110px]" />
        <div className="absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-primary-100/70 blur-[110px]" />

        <div className="absolute left-[7%] top-[14%] z-0 -rotate-2">
          <OrderCard />
        </div>
        <div className="absolute bottom-[26%] right-[7%] z-0 rotate-1">
          <RevenueCard />
        </div>
        <div className="absolute bottom-[8%] left-[10%] z-0 -rotate-1">
          <DeliveryCard />
        </div>

        <motion.div
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
          }}
          initial="hidden"
          animate="show"
          className="relative z-10 mx-auto w-full max-w-lg px-12 py-16"
        >
          <motion.div variants={item} className="flex items-center gap-3">
            <span className="text-[11px] font-black tabular-nums text-primary-600">01</span>
            <span className="text-[0.68rem] font-black tracking-[0.14em] text-surface-400">
              نظام إدارة المتاجر
            </span>
            <span className="h-px flex-1 bg-surface-300/70" />
          </motion.div>

          <motion.h2
            variants={item}
            className="mt-6 text-4xl font-black leading-[1.25] tracking-tight text-surface-900 xl:text-5xl"
          >
            من المخزون
            <br />
            إلى <span className="text-primary-700">باب العميل</span>
          </motion.h2>

          <motion.p variants={item} className="mt-5 max-w-md leading-relaxed text-surface-600">
            منتجات وطلبات ومناطق توصيل وتقارير — كل ما يشهده متجرك اليوم، في لوحة واحدة.
          </motion.p>

          <motion.ul variants={item} className="mt-10 grid grid-cols-2 border-t border-surface-200">
            {features.map((label, index) => (
              <li
                key={label}
                className="border-b border-surface-200 py-4 pe-8 odd:border-e odd:border-surface-200"
              >
                <span className="text-[11px] font-black tabular-nums text-primary-600">
                  0{index + 1}
                </span>
                <p className="mt-1 text-sm font-bold text-surface-800">{label}</p>
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </aside>

      <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-12 sm:px-12">
        <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-primary-100/60 blur-[100px]" />

        <motion.div
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } },
          }}
          initial="hidden"
          animate="show"
          className="relative z-10 w-full max-w-sm"
        >
          <motion.div variants={item} className="mb-9 text-center">
            <h1 className="mb-3">
              <img
                src="/esystm-logo.png"
                alt="esySTM"
                width={880}
                height={294}
                className="mx-auto h-14 w-auto sm:h-16"
                fetchPriority="high"
              />
            </h1>
            <p className="font-medium tracking-wide text-surface-500">تسجيل الدخول إلى لوحة الإدارة</p>
          </motion.div>

          {(authNotice || error) && (
            <motion.div
              variants={item}
              className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50 p-4 text-sm text-amber-800"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <p className="font-bold">{error || authNotice}</p>
            </motion.div>
          )}

          <motion.form variants={item} className="space-y-5" onSubmit={handleLogin}>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-surface-700">البريد الإلكتروني</span>
              <div className="relative">
                <Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400" size={19} />
                <input
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@company.com"
                  className="w-full rounded-2xl border border-surface-200 bg-white py-3.5 pl-4 pr-12 text-surface-900 shadow-sm transition placeholder:text-surface-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-surface-700">كلمة المرور</span>
              <div className="relative">
                <LockKeyhole className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400" size={19} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-2xl border border-surface-200 bg-white py-3.5 pl-12 pr-12 text-surface-900 shadow-sm transition placeholder:text-surface-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-surface-400 transition-colors hover:text-surface-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || !isSupabaseConfigured}
              className="group relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-primary-700 py-4 font-bold text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-800 hover:shadow-primary-500/30 active:scale-[0.98] disabled:opacity-60"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />
              <span className="relative flex items-center justify-center gap-2">
                {loading ? (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <>
                    تسجيل الدخول
                    <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-1" />
                  </>
                )}
              </span>
            </button>
          </motion.form>

          <motion.button
            variants={item}
            type="button"
            onClick={() => setShowAbout(true)}
            className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-surface-500 transition-colors hover:bg-surface-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Info size={15} />
            عن السستم
          </motion.button>

          <motion.div
            variants={item}
            className="mt-12 flex items-center justify-between border-t border-surface-200 pt-4 text-[11px] font-bold text-surface-400"
          >
            <span>esySTM — السستم</span>
            <span className="tabular-nums" dir="ltr">v{__APP_VERSION__}</span>
          </motion.div>
        </motion.div>
      </main>

      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
};
