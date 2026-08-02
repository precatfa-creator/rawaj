import React, { FormEvent, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Info, LockKeyhole, Mail } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../db/supabase';
import { AboutModal } from '../components/AboutModal';

interface LoginProps {
  authNotice?: string;
}

export const Login: React.FC<LoginProps> = ({ authNotice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAbout, setShowAbout] = useState(false);

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

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4 relative overflow-hidden rtl" dir="rtl">
      <div className="absolute top-1/4 -right-20 w-96 h-96 bg-primary-200 rounded-full blur-[100px] opacity-50 mix-blend-multiply pointer-events-none" />
      <div className="absolute bottom-1/4 -left-20 w-96 h-96 bg-blue-200 rounded-full blur-[100px] opacity-50 mix-blend-multiply pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, type: 'spring' }}
        className="w-full max-w-md"
      >
        <div className="glass-panel p-8 sm:p-10 rounded-3xl relative">
          <div className="text-center mb-8">
            <h1 className="font-black text-5xl text-gradient tracking-tight mb-4 pb-2">رَوَاج</h1>
            <p className="text-surface-500 font-medium tracking-wide">تسجيل الدخول إلى لوحة الإدارة</p>
          </div>

          {(authNotice || error) && (
            <div className="bg-amber-50 text-amber-800 p-4 rounded-2xl text-sm font-medium border border-amber-200/80 flex items-start gap-3 mb-5">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="font-bold">{error || authNotice}</p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleLogin}>
            <label className="block">
              <span className="block text-sm font-bold text-surface-700 mb-2">البريد الإلكتروني</span>
              <div className="relative">
                <Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400" size={19} />
                <input
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  className="w-full bg-white border border-surface-200 rounded-2xl py-3.5 pr-12 pl-4 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
              </div>
            </label>

            <label className="block">
              <span className="block text-sm font-bold text-surface-700 mb-2">كلمة المرور</span>
              <div className="relative">
                <LockKeyhole className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400" size={19} />
                <input
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full bg-white border border-surface-200 rounded-2xl py-3.5 pr-12 pl-4 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || !isSupabaseConfigured}
              className="w-full bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-primary-500/20 transition-all flex items-center justify-center"
            >
              {loading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : 'تسجيل الدخول'}
            </button>
          </form>

          <p className="mt-7 text-center text-xs font-medium text-surface-500 leading-relaxed">
            إنشاء الحسابات متاح لمدير النظام فقط.
          </p>
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-surface-500 transition-colors hover:bg-surface-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Info size={15} />
            عن رَوَاج
          </button>
        </div>
      </motion.div>
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
};
