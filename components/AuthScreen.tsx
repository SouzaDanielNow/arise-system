import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loader, Shield, LogIn, UserPlus } from 'lucide-react';

type AuthMode = 'login' | 'register';

// Only lowercase letters, numbers, underscore — no spaces
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
const USERNAME_HINT = 'Letters, numbers and _ only. Example: daniel_souza';

const normalizeUsername = (raw: string) =>
  raw.trim().toLowerCase().replace(/\s+/g, '_');

const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleLogin = async () => {
    const normalized = normalizeUsername(username);

    const { data, error: lookupErr } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', normalized)
      .single();

    if (lookupErr || !data?.email) {
      setError('Hunter not found. Check your username or register first.');
      setLoading(false);
      return;
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: data.email,
      password,
    });

    if (signInErr) {
      if (signInErr.message.toLowerCase().includes('email')) {
        setError('Email not confirmed yet. Check your inbox and click the confirmation link.');
      } else if (signInErr.message.toLowerCase().includes('invalid')) {
        setError('Wrong password.');
      } else {
        setError(signInErr.message);
      }
    }
  };

  const handleRegister = async () => {
    const normalized = normalizeUsername(username);

    if (!USERNAME_REGEX.test(normalized)) {
      setError(`Invalid hunter name. ${USERNAME_HINT}`);
      setLoading(false);
      return;
    }

    // Check if username already taken
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalized)
      .maybeSingle();

    if (existing) {
      setError('This hunter name is already taken. Choose another.');
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: normalized } },
    });

    if (error) {
      setError(error.message);
    } else {
      setSuccessMsg(
        `Hunter "${normalized}" registered! Check your email and click the confirmation link to activate your account.`
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    if (mode === 'login') await handleLogin();
    else await handleRegister();
    setLoading(false);
  };

  const handleUsernameChange = (raw: string) => {
    // Auto-convert spaces to underscore as user types
    setUsername(raw.replace(/\s/g, '_').toLowerCase());
  };

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center px-4 font-mono">
      {/* Background grid */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              'linear-gradient(#3b82f6 1px, transparent 1px), linear-gradient(90deg, #3b82f6 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-900/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <Shield size={48} className="text-blue-500 drop-shadow-[0_0_20px_rgba(59,130,246,0.8)]" />
              <div className="absolute inset-0 animate-ping opacity-20">
                <Shield size={48} className="text-blue-400" />
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-blue-400 tracking-widest drop-shadow-[0_0_15px_rgba(59,130,246,0.6)] mb-1">
            ARISE
          </h1>
          <p className="text-slate-500 text-xs tracking-[0.3em] uppercase">
            Hunter Authentication Required
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-6 shadow-[0_0_40px_rgba(59,130,246,0.08)]">
          {/* Mode toggle */}
          <div className="flex mb-6 border border-slate-700 rounded overflow-hidden">
            <button
              onClick={() => { setMode('login'); setError(null); setSuccessMsg(null); }}
              className={`flex-1 py-2 text-xs font-bold tracking-wider transition-all flex items-center justify-center gap-2
                ${mode === 'login' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-500 hover:text-slate-300'}`}
            >
              <LogIn size={13} /> LOGIN
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); setSuccessMsg(null); }}
              className={`flex-1 py-2 text-xs font-bold tracking-wider transition-all flex items-center justify-center gap-2
                ${mode === 'register' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-500 hover:text-slate-300'}`}
            >
              <UserPlus size={13} /> REGISTER
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Hunter name */}
            <div>
              <label className="block text-slate-400 text-xs tracking-wider mb-1">HUNTER NAME</label>
              <input
                type="text"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                required
                autoComplete="username"
                placeholder="daniel_souza"
                maxLength={20}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
              />
              {mode === 'register' && (
                <p className="text-slate-600 text-[10px] mt-1">{USERNAME_HINT}</p>
              )}
            </div>

            {/* Email — register only */}
            {mode === 'register' && (
              <div>
                <label className="block text-slate-400 text-xs tracking-wider mb-1">EMAIL</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="hunter@arise.sys"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
                />
              </div>
            )}

            <div>
              <label className="block text-slate-400 text-xs tracking-wider mb-1">PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-700/50 rounded px-3 py-2 text-red-400 text-xs leading-relaxed">
                ⚠ {error}
              </div>
            )}

            {successMsg && (
              <div className="bg-green-900/20 border border-green-700/50 rounded px-3 py-2 text-green-400 text-xs leading-relaxed">
                ✓ {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-sm tracking-widest transition-all duration-200 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
            >
              {loading ? (
                <><Loader size={15} className="animate-spin" /> AUTHENTICATING...</>
              ) : mode === 'login' ? (
                <><LogIn size={15} /> ENTER THE SYSTEM</>
              ) : (
                <><UserPlus size={15} /> CREATE HUNTER</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-700 text-xs mt-6 tracking-wider">
          ARISE SYSTEM v2.0 — SOLO LEVELING
        </p>
      </div>
    </div>
  );
};

export default AuthScreen;
