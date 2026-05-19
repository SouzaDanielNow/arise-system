import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, type Blob as GenAIBlob, type FunctionResponse } from '@google/genai';
import type { Session } from '@supabase/supabase-js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, AreaChart, Area
} from 'recharts';
import {
  Shield, Sword, User, Zap,
  Brain, Activity, Ghost, RotateCw,
  ShoppingBag, Coins, Edit3, Check, Plus,
  Loader, Mic, MicOff, Globe, Quote, Settings, Trash2,
  Target, LogOut, Bell, BellOff
} from 'lucide-react';
import {
  HunterProfile, ViewState, HunterRank,
  CustomStat, RewardItem, Habit, SystemQuote, RepeatType,
  BossFight, BossSubTask, BossHistoryEntry, BonusMission, GameState,
  Shadow, ShadowRank, ShadowRole, ShadowStatus, ShadowMission
} from './types';
import {
  INITIAL_REWARDS,
  INITIAL_HABITS, getLevelFromXp, getRankFromLevel, getXpForLevel,
  RANK_LEVEL_THRESHOLDS, getRankMultiplier,
  STAT_COLOR_PALETTE, RANK_COLORS, SHADOW_RANK_COLORS, extractShadow, generateDailyMissions,
  LootEntry, PHYSICAL_ITEMS, RARITY_COLORS, RARITY_LABELS,
} from './constants';
import StatRadar from './components/StatRadar';
import SystemNotification, { NotificationType } from './components/SystemNotification';
import { useLanguage } from './i18n/LanguageContext';
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import DevPanel from './components/DevPanel';
import DailyRewardModal from './components/DailyRewardModal';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';


// --- Audio Helper Functions ---
function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
  const uint8 = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
  return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

// Convert VAPID base64url public key → Uint8Array for pushManager.subscribe
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// --- Daily Reset Logic (pure, runs on each login) ---
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function applyDailyReset(gs: GameState): { state: GameState; hadStreakBreak: boolean; retainedDays: number } {
  const today = toDateStr(new Date());
  const lastLogin = gs.profile.lastLoginDate
    ? toDateStr(new Date(gs.profile.lastLoginDate))
    : today;

  if (today === lastLogin) return { state: gs, hadStreakBreak: false, retainedDays: gs.profile.streakDays };

  const daysDiff = Math.round(
    (new Date(today).getTime() - new Date(lastLogin).getTime()) / 86400000
  );

  // Only recurring habits (daily / weekdays / custom) count for streak.
  // If the user has zero recurring habits, a missed day never breaks streak.
  const hasRecurringHabits = gs.habits.some(
    h => h.repeatType === 'daily' || h.repeatType === 'weekdays' || h.repeatType === 'custom'
  );

  // A day is considered "completed" if lastCompletionDate matches lastLogin date.
  // If daysDiff === 1 and they completed yesterday, no penalty.
  // If daysDiff >= 1 and they didn't complete the last active day, apply penalty.
  const completedLastActiveDay = gs.profile.lastCompletionDate === lastLogin;

  let newStreakDays = gs.profile.streakDays;
  let hadStreakBreak = false;
  const missedADay = daysDiff >= 1 && !(daysDiff === 1 && completedLastActiveDay);
  if (missedADay && newStreakDays > 0 && hasRecurringHabits) {
    const totalPower = gs.profile.customStats.reduce((s, c) => s + c.value, 0);
    const protection = Math.min(50, totalPower);
    newStreakDays = Math.floor(newStreakDays * (protection / 100));
    hadStreakBreak = true;
  }

  const dayOfWeek = new Date().getDay();
  const resetHabits = gs.habits.map(h => {
    if (!h.isCompleted) return h;
    const active =
      h.repeatType === 'daily' ? true :
      h.repeatType === 'weekdays' ? dayOfWeek >= 1 && dayOfWeek <= 5 :
      h.repeatType === 'custom' ? (h.repeatDays?.includes(dayOfWeek) ?? false) :
      false;
    return active ? { ...h, isCompleted: false } : h;
  });

  return {
    state: {
      ...gs,
      profile: { ...gs.profile, streakDays: newStreakDays, lastLoginDate: new Date().toISOString() },
      habits: resetHabits,
    },
    hadStreakBreak,
    retainedDays: newStreakDays,
  };
}

const randomBetween = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// --- Animation Overlays ---
const PARTICLE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

type LevelUpInfo = { oldLevel: number; newLevel: number; newRank: HunterRank; didRankUp: boolean };

// Level Up Overlay — cyan theme, auto-dismiss after 3s
const LevelUpOverlay: React.FC<{ info: LevelUpInfo; onDone: () => void }> = ({ info, onDone }) => {
  const { oldLevel, newLevel } = info;
  const CYAN = '#22d3ee';

  useEffect(() => {
    const timer = setTimeout(onDone, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 3, times: [0, 0.1, 0.7, 1] }}
      />

      {/* Radial glow */}
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse at center, ${CYAN}33 0%, transparent 65%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6, 0] }}
        transition={{ duration: 3, times: [0, 0.15, 0.65, 1] }}
      />

      {/* Particles */}
      {PARTICLE_ANGLES.map((angle, i) => (
        <motion.div
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: CYAN, boxShadow: `0 0 6px ${CYAN}`, left: '50%', top: '50%', marginLeft: -3, marginTop: -3 }}
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: Math.cos((angle * Math.PI) / 180) * 200, y: Math.sin((angle * Math.PI) / 180) * 200, opacity: 0 }}
          transition={{ duration: 1.8, delay: 0.1, ease: 'easeOut' }}
        />
      ))}

      {/* Content */}
      <motion.div
        className="text-center relative z-10 select-none px-6"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.1, 1, 1, 1], opacity: [0, 1, 1, 1, 0] }}
        transition={{ duration: 3, times: [0, 0.15, 0.25, 0.7, 1] }}
      >
        <p className="text-[10px] font-garet tracking-[0.6em] mb-5 text-white/40">— NÍVEL AUMENTOU —</p>

        <div className="flex items-center justify-center gap-5 mb-5">
          <span className="text-4xl font-black font-garet text-white/30">{oldLevel}</span>
          <span className="text-2xl font-garet" style={{ color: CYAN }}>→</span>
          <span
            className="text-7xl font-black font-garet"
            style={{ color: CYAN, textShadow: `0 0 25px ${CYAN}, 0 0 55px ${CYAN}66` }}
          >
            {newLevel}
          </span>
        </div>

        <motion.p
          className="text-xs font-mono tracking-widest"
          style={{ color: CYAN }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        >
          +4 PONTOS DE ATRIBUTO DESBLOQUEADOS
        </motion.p>
      </motion.div>
    </motion.div>
  );
};

// Rank Up Overlay — fullscreen epic, rank color theme, manual dismiss
const RankUpOverlay: React.FC<{ info: LevelUpInfo; onDone: () => void }> = ({ info, onDone }) => {
  const { oldLevel, newLevel, newRank } = info;
  const color = RANK_COLORS[newRank];

  return (
    <motion.div
      className="fixed inset-0 z-[102] flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Fullscreen dark backdrop */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-xl" />

      {/* Ambient radial glow */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at center, ${color}22 0%, transparent 60%)` }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity }}
      />

      {/* Particles burst */}
      {PARTICLE_ANGLES.map((angle, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full pointer-events-none"
          style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}`, left: '50%', top: '50%', marginLeft: -4, marginTop: -4 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 2 }}
          animate={{ x: Math.cos((angle * Math.PI) / 180) * 380, y: Math.sin((angle * Math.PI) / 180) * 380, opacity: 0, scale: 0 }}
          transition={{ duration: 2.2, delay: 0.2, ease: 'easeOut' }}
        />
      ))}

      {/* Content — scale-up from center */}
      <motion.div
        className="relative z-10 flex flex-col items-center text-center px-8 select-none"
        initial={{ scale: 0.1, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1.3, 0.5, 1] }}
      >
        {/* Header label */}
        <motion.p
          className="text-[10px] font-garet tracking-[0.7em] text-white/40 mb-6"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          ⚔ RANK UP ALCANÇADO ⚔
        </motion.p>

        {/* Level transition */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-3xl font-black font-garet text-white/30">{oldLevel}</span>
          <span className="text-xl font-garet" style={{ color }}>→</span>
          <span className="text-5xl font-black font-garet" style={{ color, textShadow: `0 0 20px ${color}` }}>
            {newLevel}
          </span>
        </div>

        {/* New rank name */}
        <motion.div
          className="text-8xl font-black font-garet mb-3"
          style={{ color, textShadow: `0 0 40px ${color}, 0 0 90px ${color}66` }}
          animate={{ textShadow: [`0 0 40px ${color}, 0 0 80px ${color}44`, `0 0 60px ${color}, 0 0 120px ${color}88`, `0 0 40px ${color}, 0 0 80px ${color}44`] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {newRank}
        </motion.div>

        <p className="text-xs font-mono text-white/40 tracking-widest mb-10">+4 PONTOS DE ATRIBUTO DESBLOQUEADOS</p>

        {/* Dismiss button */}
        <motion.button
          className="px-12 py-3 rounded border-2 font-garet text-sm tracking-[0.4em] font-bold"
          style={{
            borderColor: color,
            color,
            background: `${color}18`,
            boxShadow: `0 0 30px ${color}55`,
          }}
          onClick={onDone}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          whileHover={{ scale: 1.05, boxShadow: `0 0 45px ${color}88` }}
          whileTap={{ scale: 0.97 }}
        >
          DESPERTAR
        </motion.button>
      </motion.div>
    </motion.div>
  );
};

// ── Shadow Extraction Overlay ─────────────────────────────────────────────────
const ShadowExtractionOverlay: React.FC<{ shadow: Shadow; onDone: () => void }> = ({ shadow, onDone }) => {
  const color = SHADOW_RANK_COLORS[shadow.rank];

  useEffect(() => {
    const timer = setTimeout(onDone, 3500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[95] flex items-center justify-center pointer-events-none overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse at center, ${color}28 0%, transparent 65%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6, 0] }}
        transition={{ duration: 3.5, times: [0, 0.15, 0.6, 1] }}
      />
      <motion.div
        className="relative z-10 select-none bg-slate-950/95 border rounded-xl px-8 py-6 text-center shadow-2xl"
        style={{ borderColor: `${color}50`, boxShadow: `0 0 40px ${color}22` }}
        initial={{ scale: 0.6, opacity: 0, y: 24 }}
        animate={{ scale: [0.6, 1.05, 1, 1, 0.96], opacity: [0, 1, 1, 1, 0], y: [24, 0, 0, 0, -12] }}
        transition={{ duration: 3.5, times: [0, 0.15, 0.3, 0.72, 1] }}
      >
        <div className="text-[9px] font-garet tracking-[0.5em] text-slate-500 mb-3">⚔ SOMBRA EXTRAÍDA ⚔</div>
        <div
          className="text-3xl font-black font-garet mb-3"
          style={{ color, textShadow: `0 0 24px ${color}aa` }}
        >
          {shadow.name}
        </div>
        <div className="flex items-center justify-center gap-3 text-xs font-mono">
          <span
            className="px-2.5 py-0.5 rounded border font-bold"
            style={{ color, borderColor: `${color}55`, background: `${color}18` }}
          >
            {shadow.rank}
          </span>
          <span className="text-slate-400">{shadow.role}</span>
          <span className="text-slate-500">⚡ {shadow.basePower}</span>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ── Shadow Card ───────────────────────────────────────────────────────────────
const ROLE_ICONS: Record<ShadowRole, string> = {
  Tank: '🛡️', Guerreiro: '⚔️', Assassino: '🗡️', Mago: '🔮',
};
const STATUS_STYLE: Record<Shadow['status'], string> = {
  'Pronta':     'text-green-400 border-green-500/40 bg-green-500/10',
  'Em Missão':  'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  'Treinando':  'text-blue-400 border-blue-500/40 bg-blue-500/10',
  'Regenerando':'text-red-400 border-red-500/40 bg-red-500/10',
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Compact Shadow Card (inventory grid) ─────────────────────────────────────
const ShadowCard: React.FC<{ shadow: Shadow; onClick: () => void }> = ({ shadow, onClick }) => {
  const color = SHADOW_RANK_COLORS[shadow.rank];
  const isBusy = shadow.status !== 'Pronta';
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!shadow.returnTime) { setCountdown(''); return; }
    const tick = () => setCountdown(formatCountdown(shadow.returnTime! - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [shadow.returnTime]);

  return (
    <div
      onClick={onClick}
      className="bg-slate-900 rounded-lg p-3 border relative overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:z-10 active:scale-100 select-none"
      style={{
        borderColor: isBusy ? `${color}18` : `${color}40`,
        boxShadow: isBusy ? 'none' : `0 0 14px ${color}18`,
        opacity: isBusy ? 0.7 : 1,
      }}
    >
      <div className="absolute top-0 left-0 w-full h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${color}70, transparent)` }} />

      {/* Role icon + rank badge */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl leading-none">{ROLE_ICONS[shadow.role]}</span>
        <span
          className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border"
          style={{ color, borderColor: `${color}55`, background: `${color}18` }}
        >
          {shadow.rank}
        </span>
      </div>

      {/* Name */}
      <p className="font-mono font-bold text-xs text-white leading-tight truncate mb-1">{shadow.name}</p>

      {/* Level + Power */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-2">
        <span>Nv.<span className="text-white font-bold ml-0.5">{shadow.level}</span></span>
        <span>⚡<span className="font-bold ml-0.5" style={{ color }}>{shadow.basePower}</span></span>
      </div>

      {/* Status / countdown */}
      {isBusy ? (
        <div className="text-[9px] font-mono text-center tabular-nums bg-slate-800/70 rounded px-1 py-0.5 text-slate-400">
          {countdown || shadow.status}
        </div>
      ) : (
        <div className={`text-[9px] font-mono text-center px-1 py-0.5 rounded border ${STATUS_STYLE[shadow.status]}`}>
          {shadow.status}
        </div>
      )}
    </div>
  );
};

// ── Shadow Detail Modal ───────────────────────────────────────────────────────
const ShadowDetailModal: React.FC<{
  shadow: Shadow;
  onClose: () => void;
  onTrain: () => void;
}> = ({ shadow, onClose, onTrain }) => {
  const color = SHADOW_RANK_COLORS[shadow.rank];
  const xpForNextLevel = shadow.level * 100;
  const xpPct = Math.min(100, Math.round((shadow.xp / xpForNextLevel) * 100));
  const isBusy = shadow.status !== 'Pronta';
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!shadow.returnTime) { setCountdown(''); return; }
    const tick = () => setCountdown(formatCountdown(shadow.returnTime! - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [shadow.returnTime]);

  return (
    <motion.div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-xs bg-slate-950 border rounded-2xl p-6 shadow-2xl relative"
        style={{ borderColor: `${color}40`, boxShadow: `0 0 40px ${color}20` }}
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors text-lg leading-none"
        >
          ✕
        </button>

        {/* Top shine */}
        <div className="absolute top-0 left-0 w-full h-0.5 rounded-t-2xl" style={{ background: `linear-gradient(90deg, transparent, ${color}99, transparent)` }} />

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl shrink-0"
            style={{ background: `${color}15`, border: `1px solid ${color}30` }}
          >
            {ROLE_ICONS[shadow.role]}
          </div>
          <div>
            <p className="font-mono font-black text-white text-base leading-tight">{shadow.name}</p>
            <p className="text-[10px] font-mono text-slate-500 mt-0.5">{shadow.role}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border"
                style={{ color, borderColor: `${color}55`, background: `${color}18` }}
              >
                {shadow.rank}
              </span>
              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${STATUS_STYLE[shadow.status]}`}>
                {shadow.status}
              </span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-900 rounded-lg p-3 text-center">
            <p className="text-[9px] font-mono text-slate-500 mb-1">NÍVEL</p>
            <p className="font-mono font-black text-white text-2xl">{shadow.level}</p>
          </div>
          <div className="bg-slate-900 rounded-lg p-3 text-center">
            <p className="text-[9px] font-mono text-slate-500 mb-1">PODER</p>
            <p className="font-mono font-black text-2xl" style={{ color }}>⚡{shadow.basePower}</p>
          </div>
        </div>

        {/* XP Bar */}
        <div className="mb-5">
          <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-1.5">
            <span>EXPERIÊNCIA</span>
            <span className="text-slate-300">{shadow.xp} / {xpForNextLevel} XP</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${xpPct}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }}
            />
          </div>
          <p className="text-[9px] font-mono text-slate-600 mt-1 text-right">{xpPct}%</p>
        </div>

        {/* Countdown if busy */}
        {isBusy && (
          <div
            className="mb-4 rounded-lg px-4 py-3 text-center border"
            style={{ borderColor: `${color}30`, background: `${color}08` }}
          >
            <p className="text-[9px] font-mono text-slate-500 mb-1">⏳ RETORNA EM</p>
            <p className="font-mono font-bold text-xl tabular-nums" style={{ color }}>
              {countdown || '—'}
            </p>
          </div>
        )}

        {/* Train button */}
        <button
          disabled={isBusy}
          onClick={() => { onTrain(); onClose(); }}
          className="w-full py-3 rounded-xl border-2 font-mono font-bold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={isBusy ? {} : {
            borderColor: `${color}80`,
            color,
            background: `${color}15`,
          }}
        >
          {isBusy ? shadow.status : '💪 TREINAR (200 Ouro)'}
        </button>
      </motion.div>
    </motion.div>
  );
};

const App: React.FC = () => {
  const { t, language, setLanguage } = useLanguage();

  // --- State ---
  const [view, setView] = useState<ViewState>('DASHBOARD');
  const [habits, setHabits] = useState<Habit[]>(() =>
    INITIAL_HABITS.map((h, i) => ({ ...h, title: t.initialHabits[i].title }))
  );

  const [profile, setProfile] = useState<HunterProfile>({
    name: 'Jin-Woo',
    rank: HunterRank.E,
    currentXp: 0,
    customStats: t.defaultStats,
    streakDays: 5,
    lastLoginDate: new Date().toISOString(),
    gold: 0,
    weeklyGymProgress: [false, false, false, false, false, false, false],
    shadows: [],
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(profile.name);
  const [identityStatsView, setIdentityStatsView] = useState<'radar' | 'bars'>('radar');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [newHabitTitle, setNewHabitTitle] = useState('');
  const [dailyQuote, setDailyQuote] = useState<SystemQuote>(t.quotes[0]);
  const [notification, setNotification] = useState<{ msg: string; sub?: string; type?: NotificationType } | null>(null);
  const [newStatName, setNewStatName] = useState('');
  const [newStatEmoji, setNewStatEmoji] = useState('');
  const [confirmDeleteStatId, setConfirmDeleteStatId] = useState<string | null>(null);

  // Boss Fight state
  const [bossFights, setBossFights] = useState<BossFight[]>([]);
  const [showAddBossForm, setShowAddBossForm] = useState(false);
  const [newBossTitle, setNewBossTitle] = useState('');
  const [newBossDesc, setNewBossDesc] = useState('');
  const [newBossDueDate, setNewBossDueDate] = useState('');
  const [newBossSubTasks, setNewBossSubTasks] = useState<BossSubTask[]>([]);
  const [newBossSubInput, setNewBossSubInput] = useState('');
  const [confirmCancelBossId, setConfirmCancelBossId] = useState<string | null>(null);
  const [bossNewSubInputs, setBossNewSubInputs] = useState<Record<string, string>>({});
  const [expandedBossIds, setExpandedBossIds] = useState<Set<string>>(new Set());
  const [editingSubTaskId, setEditingSubTaskId] = useState<string | null>(null);
  const [editingSubTaskText, setEditingSubTaskText] = useState('');
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [editingHabitTitle, setEditingHabitTitle] = useState('');
  const [dragState, setDragState] = useState<{ bossId: string; subTaskId: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Task form state
  const [showAddTaskForm, setShowAddTaskForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskRepeat, setNewTaskRepeat] = useState<RepeatType>('daily');
  const [newTaskDays, setNewTaskDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [confirmDeleteHabitId, setConfirmDeleteHabitId] = useState<string | null>(null);

  // Gemini Live API State
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isVoiceConnecting, setIsVoiceConnecting] = useState(false);
  const nextStartTime = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);

  // Auth & persistence state
  const [session, setSession] = useState<Session | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const isDataLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileRef = useRef<HunterProfile | null>(null);
  const habitsRef = useRef<Habit[]>([]);

  // Shadow missions + inspection state
  const [shadowMissions] = useState<ShadowMission[]>(() => generateDailyMissions());
  const [missionModal, setMissionModal] = useState<{ mission: ShadowMission; selectedIds: string[] } | null>(null);
  const [inspectedShadow, setInspectedShadow] = useState<Shadow | null>(null);

  // Bonus missions — loaded from daily_bonus_missions Supabase table
  const [bonusMissions, setBonusMissions] = useState<BonusMission[]>([]);
  const bonusMissionsRef = useRef<BonusMission[]>([]);
  // Incoming popup — shown when Arquiteto drops missions while app is open
  const [incomingBonusPopup, setIncomingBonusPopup] = useState<BonusMission[] | null>(null);

  // Push notifications
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);

  // Voice suggestion queue — AI proposes, Hunter accepts/rejects
  type VoiceSuggestion =
    | { id: string; type: 'habit'; title: string; repeatType: RepeatType }
    | { id: string; type: 'boss'; title: string; description: string; dueDays: number; subTasks: string[] };
  const [voiceSuggestions, setVoiceSuggestions] = useState<VoiceSuggestion[]>([]);

  // Visual effects state
  type AnimEvent = { kind: 'daily' } | { kind: 'levelup'; info: LevelUpInfo } | { kind: 'rankup'; info: LevelUpInfo };
  const [animQueue, setAnimQueue] = useState<AnimEvent[]>([]);
  const [activeAnim, setActiveAnim] = useState<AnimEvent | null>(null);
  const [shadowExtracted, setShadowExtracted] = useState<Shadow | null>(null);
  const [showBossFlash, setShowBossFlash] = useState(false);
  const shakeControls = useAnimation();

  useEffect(() => {
    const randomQuote = t.quotes[Math.floor(Math.random() * t.quotes.length)];
    setDailyQuote(randomQuote);
  }, []);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setIsLoadingAuth(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load game data when user logs in
  useEffect(() => {
    if (!session) { isDataLoadedRef.current = false; return; }
    setIsLoadingData(true);
    isDataLoadedRef.current = false;
    const load = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('profile_data')
        .eq('id', session.user.id)
        .single();
      // profile_data?.profile distinguishes a real GameState from the trigger's empty {}
      if (data?.profile_data?.profile) {
        const rawGs = data.profile_data as GameState;
        const { state: gs, hadStreakBreak, retainedDays } = applyDailyReset(rawGs);
        setProfile(gs.profile);
        setHabits(gs.habits);
        setBossFights(gs.bossFights ?? []);

        // Load today's bonus missions from dedicated table (generated server-side by Arquiteto)
        const today = toDateStr(new Date());
        const { data: bonusRow } = await supabase
          .from('daily_bonus_missions')
          .select('missions')
          .eq('user_id', session.user.id)
          .eq('generated_date', today)
          .maybeSingle();
        if (bonusRow?.missions) setBonusMissions(bonusRow.missions as BonusMission[]);
        if (hadStreakBreak) {
          const totalPower = gs.profile.customStats.reduce((s, c) => s + c.value, 0);
          setTimeout(() => {
            if (retainedDays > 0) {
              showNotification(t.notifications.passiveActivated, t.notifications.passiveSub(totalPower, retainedDays), 'shield');
            } else {
              showNotification(t.notifications.streakBroken, t.notifications.streakBrokenSub, 'warning');
            }
          }, 1500);
        }
      } else {
        const hunterName = session.user.user_metadata?.username || 'Jin-Woo';
        const defaultState: GameState = {
          profile: { ...profile, name: hunterName },
          habits,
          bossFights,
        };
        setProfile(prev => ({ ...prev, name: hunterName }));
        await supabase.from('profiles').upsert({
          id: session.user.id,
          profile_data: defaultState,
        });
      }
      isDataLoadedRef.current = true;
      setIsLoadingData(false);
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // Keep ref in sync so realtime handler can detect only newly-arrived missions
  useEffect(() => { bonusMissionsRef.current = bonusMissions; }, [bonusMissions]);

  // Check if this device already has an active push subscription
  useEffect(() => {
    if (!session || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => setIsPushSubscribed(!!sub))
    ).catch(() => {});
  }, [session?.user.id]);

  // Realtime: detect when Arquiteto drops bonus missions while app is open
  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel('bonus-missions-live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'daily_bonus_missions',
        filter: `user_id=eq.${session.user.id}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') return;
        const incoming: BonusMission[] = (payload.new as { missions?: BonusMission[] })?.missions ?? [];
        if (!incoming.length) return;
        // Compare by ID only — avoids UTC vs local date mismatch
        const knownIds = new Set(bonusMissionsRef.current.map(m => m.id));
        const newOnly = incoming.filter(m => !knownIds.has(m.id));
        setBonusMissions(incoming);
        if (newOnly.length > 0) setIncomingBonusPopup(newOnly);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // Auto-save with 2s debounce
  useEffect(() => {
    if (!session || !isDataLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const gameState: GameState = { profile, habits, bossFights };
      await supabase.from('profiles').upsert({ id: session.user.id, profile_data: gameState });
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [profile, habits, bossFights]);

  // Animation queue — dequeue next when nothing is active
  useEffect(() => {
    if (activeAnim !== null) return;
    if (animQueue.length === 0) return;
    const [next, ...rest] = animQueue;
    setAnimQueue(rest);
    setActiveAnim(next);
  }, [activeAnim, animQueue]);

  const enqueueAnim = useCallback((ev: AnimEvent) => {
    setAnimQueue(q => {
      // Deduplicate: skip if the same kind is already the last item in queue
      if (q.length > 0 && q[q.length - 1].kind === ev.kind) return q;
      return [...q, ev];
    });
  }, []);

  const dismissActiveAnim = useCallback(() => setActiveAnim(null), []);

  // Dynamic rank color CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--rank-color', RANK_COLORS[profile.rank]);
  }, [profile.rank]);

  // Keep refs in sync for stale-closure-safe callbacks
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { habitsRef.current = habits; }, [habits]);

  // Daily reward — trigger modal when all today's habits are done
  useEffect(() => {
    const today = toDateStr(new Date());
    if (profile.lastDailyRewardClaimedDate === today) return;
    const day = new Date().getDay();
    const todayH = habits.filter(x => {
      if (x.repeatType === 'daily') return true;
      if (x.repeatType === 'weekdays') return day >= 1 && day <= 5;
      if (x.repeatType === 'custom') return (x.repeatDays || []).includes(day);
      return false;
    });
    if (todayH.length > 0 && todayH.every(x => x.isCompleted)) {
      enqueueAnim({ kind: 'daily' });
    }
  }, [habits, profile.lastDailyRewardClaimedDate]);

  // Shadow time engine — checks every 60s and on window focus
  useEffect(() => {
    const resolve = () => {
      const now = Date.now();
      const prev = profileRef.current;
      if (!prev) return;

      const hasDone = (prev.shadows ?? []).some(
        s => s.returnTime && s.returnTime <= now
      );
      if (!hasDone) return;

      type Resolution = { type: 'victory'; name: string; xp: number; gold: number }
        | { type: 'defeat'; name: string }
        | { type: 'trained'; name: string }
        | { type: 'regen'; name: string };
      const resolutions: Resolution[] = [];

      setProfile(p => {
        let addedXp = 0;
        let addedGold = 0;

        const newShadows: Shadow[] = (p.shadows ?? []).map(s => {
          if (!s.returnTime || s.returnTime > now) return s;

          if (s.status === 'Treinando') {
            resolutions.push({ type: 'trained', name: s.name });
            const gained = 100;
            const xpAfter = s.xp + gained;
            const needed = s.level * 100;
            if (xpAfter >= needed) {
              return { ...s, xp: xpAfter - needed, level: s.level + 1, basePower: s.basePower + 5, returnTime: undefined, status: 'Pronta' as ShadowStatus };
            }
            return { ...s, xp: xpAfter, returnTime: undefined, status: 'Pronta' as ShadowStatus };
          }

          if (s.status === 'Em Missão') {
            const success = Math.random() * 100 < (s.missionChance ?? 50);
            if (success) {
              const baseMissionXp = s.missionRewardXP ?? 50;
              const goldR = s.missionRewardGold ?? 60;
              const xpForHunter = Math.floor(baseMissionXp * getRankMultiplier(p.rank));
              resolutions.push({ type: 'victory', name: s.name, xp: xpForHunter, gold: goldR });
              addedXp += xpForHunter; addedGold += goldR;
              return { ...s, xp: s.xp + baseMissionXp, returnTime: undefined, missionChance: undefined, missionRewardXP: undefined, missionRewardGold: undefined, status: 'Pronta' as ShadowStatus };
            } else {
              resolutions.push({ type: 'defeat', name: s.name });
              return { ...s, returnTime: now + 7200000, missionChance: undefined, missionRewardXP: undefined, missionRewardGold: undefined, status: 'Regenerando' as ShadowStatus };
            }
          }

          if (s.status === 'Regenerando') {
            resolutions.push({ type: 'regen', name: s.name });
            return { ...s, returnTime: undefined, status: 'Pronta' as ShadowStatus };
          }

          return s;
        });

        const oldLevel = getLevelFromXp(p.currentXp).level;
        const newXp = p.currentXp + addedXp;
        const newGold = p.gold + addedGold;
        const newLevel = getLevelFromXp(newXp).level;
        const newRank = getRankFromLevel(newLevel);
        const didRankUp = newRank !== p.rank;
        const didLevelUp = newLevel > oldLevel;

        if (didRankUp) {
          setTimeout(() => {
            const lvInfo: LevelUpInfo = { oldLevel, newLevel, newRank, didRankUp: true };
            enqueueAnim({ kind: 'levelup', info: lvInfo });
            enqueueAnim({ kind: 'rankup', info: lvInfo });
          }, 500);
        } else if (didLevelUp) {
          setTimeout(() => {
            enqueueAnim({ kind: 'levelup', info: { oldLevel, newLevel, newRank, didRankUp: false } });
          }, 300);
        }

        return { ...p, shadows: newShadows, currentXp: newXp, gold: newGold, rank: newRank };
      });

      setTimeout(() => {
        resolutions.forEach(r => {
          if (r.type === 'victory')  showNotification(t.notifications.shadowMissionVictory, t.notifications.shadowMissionVictorySub(r.name, r.xp, r.gold), 'quest');
          if (r.type === 'defeat')   showNotification(t.notifications.shadowMissionDefeat, t.notifications.shadowMissionDefeatSub(r.name), 'warning');
          if (r.type === 'trained')  showNotification(t.notifications.shadowTrained, t.notifications.shadowTrainedSub(r.name), 'shield');
          if (r.type === 'regen')    showNotification(t.notifications.shadowRegenDone, t.notifications.shadowRegenDoneSub(r.name), 'info');
        });
      }, 150);
    };

    const interval = setInterval(resolve, 60000);
    window.addEventListener('focus', resolve);
    resolve();
    return () => { clearInterval(interval); window.removeEventListener('focus', resolve); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Helpers ---
  const showNotification = (msg: string, sub?: string, type: NotificationType = 'info') => {
    setNotification({ msg, sub, type });
  };

  const getGlobalStanding = (rank: HunterRank) => t.standing[rank];

  const localizedRewards: RewardItem[] = INITIAL_REWARDS.map((item, i) => ({
    ...item,
    name: t.initialRewards[i].name,
    description: t.initialRewards[i].description,
  }));

  const addXp = (amount: number, statId?: string) => {
    // Compute level/rank transition BEFORE setProfile to avoid side effects inside updater
    // (React Strict Mode runs updaters twice — setTimeout inside updater would fire 2x)
    const snapshot = profileRef.current;
    const oldXp = snapshot.currentXp;
    const newXp = oldXp + amount;
    const oldLevel = getLevelFromXp(oldXp).level;
    const newLevelInfo = getLevelFromXp(newXp);
    const newRank = getRankFromLevel(newLevelInfo.level);
    const didLevelUp = newLevelInfo.level > oldLevel;
    const didRankUp = newRank !== snapshot.rank;

    setProfile(prev => ({
      ...prev,
      currentXp: prev.currentXp + amount,
      rank: getRankFromLevel(getLevelFromXp(prev.currentXp + amount).level),
      customStats: prev.customStats.map(s =>
        statId && s.id === statId ? { ...s, value: s.value + 1 } : s
      ),
      availableStatPoints: (prev.availableStatPoints ?? 0) + (didLevelUp ? 4 : 0),
    }));

    if (didRankUp) {
      setTimeout(() => {
        const lvInfo: LevelUpInfo = { oldLevel, newLevel: newLevelInfo.level, newRank, didRankUp: true };
        enqueueAnim({ kind: 'levelup', info: lvInfo });
        enqueueAnim({ kind: 'rankup', info: lvInfo });
      }, 500);
    } else if (didLevelUp) {
      setTimeout(() => {
        enqueueAnim({ kind: 'levelup', info: { oldLevel, newLevel: newLevelInfo.level, newRank, didRankUp: false } });
      }, 300);
    }
  };

  const addGold = (amount: number) => {
    setProfile(prev => ({ ...prev, gold: prev.gold + amount }));
  };

  const claimDailyReward = (loot: LootEntry) => {
    const today = toDateStr(new Date());
    const multiplier = getRankMultiplier(profile.rank);

    if (loot.kind.tag === 'gold') {
      addGold(loot.kind.amount);
      setProfile(prev => ({ ...prev, lastDailyRewardClaimedDate: today }));
      showNotification(`+${loot.kind.amount} Gold`, loot.name, 'quest');
    } else if (loot.kind.tag === 'xp') {
      const xpGain = Math.floor(loot.kind.base * multiplier);
      setProfile(prev => ({ ...prev, lastDailyRewardClaimedDate: today }));
      addXp(xpGain);
      showNotification(`+${xpGain} XP`, loot.name, 'quest');
    } else if (loot.kind.tag === 'physical') {
      const itemId = loot.kind.itemId;
      const template = PHYSICAL_ITEMS.find(p => p.id === itemId);
      const inventory = profile.inventory ?? [];
      const existing = inventory.find(i => i.id === itemId);
      const maxStack = template?.maxStack ?? 99;
      const currentQty = existing?.quantity ?? 0;

      if (currentQty < maxStack) {
        setProfile(prev => {
          const inv = prev.inventory ?? [];
          const has = inv.find(i => i.id === itemId);
          let newInv;
          if (has) {
            newInv = inv.map(i => i.id === itemId ? { ...i, quantity: i.quantity + 1 } : i);
          } else if (template) {
            newInv = [...inv, {
              id: template.id,
              name: template.name,
              icon: loot.icon,
              type: 'consumable' as const,
              rarity: loot.rarity,
              effect: template.effect,
              quantity: 1,
              maxStack: template.maxStack,
            }];
          } else {
            newInv = inv;
          }
          return { ...prev, lastDailyRewardClaimedDate: today, inventory: newInv };
        });
        showNotification(loot.name, template?.effect ?? '', 'quest');
      } else {
        // maxStack reached — fallback: +30 Gold (Saco de Moedas)
        addGold(30);
        setProfile(prev => ({ ...prev, lastDailyRewardClaimedDate: today }));
        showNotification('+30 Gold — Saco de Moedas', 'Cofre cheio, ouro compensado', 'warning');
      }
    }

    dismissActiveAnim();
  };

  const distributeStat = (statId: string) => {
    setProfile(prev => {
      const pts = prev.availableStatPoints ?? 0;
      if (pts <= 0) return prev;
      return {
        ...prev,
        availableStatPoints: pts - 1,
        customStats: prev.customStats.map(s => s.id === statId ? { ...s, value: s.value + 1 } : s),
      };
    });
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showNotification(t.identity.fileTooLarge, '', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = evt => {
      const img = new Image();
      img.onload = () => {
        const MAX = 300;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        setProfile(prev => ({ ...prev, avatarUrl: base64 }));
      };
      img.src = evt.target!.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // --- Admin / Dev Panel ---
  const isAdmin = session?.user?.email === 'dany_ops@hotmail.com';

  const handleForceRank = (rank: HunterRank) => {
    const xp = getXpForLevel(RANK_LEVEL_THRESHOLDS[rank]);
    setProfile(prev => ({ ...prev, rank, currentXp: xp }));
  };

  const handleSetStatValue = (statId: string, value: number) => {
    setProfile(prev => ({
      ...prev,
      customStats: prev.customStats.map(s => s.id === statId ? { ...s, value } : s),
    }));
  };

  // --- Bonus Missions (server-generated by Edge Function) ---
  const completeBonusMission = (id: string) => {
    const mission = bonusMissions.find(m => m.id === id);
    if (!mission || mission.isCompleted) return;

    const today = toDateStr(new Date());
    const updatedMissions = bonusMissions.map(m => m.id === id ? { ...m, isCompleted: true } : m);
    setBonusMissions(updatedMissions);
    addXp(mission.rewardXp);
    addGold(mission.rewardGold);
    showNotification(t.notifications.bonusMissionComplete, t.notifications.bonusMissionCompleteSub(mission.rewardXp, mission.rewardGold), 'levelup');

    // Persist completion state to DB
    if (session) {
      supabase
        .from('daily_bonus_missions')
        .update({ missions: updatedMissions })
        .eq('user_id', session.user.id)
        .eq('generated_date', today)
        .then();
    }
  };

  // --- Push Notifications ---
  const enableNotifications = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      showNotification('Notificações não suportadas neste dispositivo.', undefined, 'warning');
      return;
    }
    try {
      const current = Notification.permission;
      if (current === 'denied') {
        showNotification('Permissão bloqueada. Vá em Configurações do sistema > Notificações e habilite para este app.', undefined, 'warning');
        return;
      }

      showNotification('Registrando notificações...', undefined, 'processing');
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission !== 'granted' || !session) {
        showNotification('Permissão não concedida.', undefined, 'warning');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!vapidKey) {
        showNotification('Chave VAPID ausente. Verifique as variáveis de ambiente.', undefined, 'warning');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const { error: upsertErr } = await supabase.from('push_subscriptions').upsert({
        user_id: session.user.id,
        endpoint: sub.endpoint,
        subscription: sub.toJSON(),
      }, { onConflict: 'user_id,endpoint' });

      if (upsertErr) {
        showNotification(`Erro ao salvar subscription: ${upsertErr.message}`, undefined, 'warning');
        return;
      }

      setNotifPermission('granted');
      setIsPushSubscribed(true);
      showNotification('Notificações ativadas com sucesso!', undefined, 'quest');
    } catch (e) {
      console.error('enableNotifications:', e);
      showNotification(`Erro: ${String(e)}`, undefined, 'warning');
    }
  };

  const disableNotifications = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        if (session) {
          await supabase.from('push_subscriptions').delete()
            .eq('user_id', session.user.id)
            .eq('endpoint', sub.endpoint);
        }
      }
      setIsPushSubscribed(false);
      showNotification('Notificações desativadas.', undefined, 'info');
    } catch (e) {
      console.error('disableNotifications:', e);
      showNotification(`Erro: ${String(e)}`, undefined, 'warning');
    }
  };

  // --- Voice Suggestions ---
  const acceptVoiceSuggestion = (id: string) => {
    setVoiceSuggestions(prev => {
      const suggestion = prev.find(s => s.id === id);
      if (!suggestion) return prev;

      if (suggestion.type === 'habit') {
        const newHabit: Habit = {
          id: `h-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: suggestion.title,
          isCompleted: false,
          streak: 0,
          repeatType: suggestion.repeatType,
        };
        setHabits(hPrev => [...hPrev, newHabit]);
      } else if (suggestion.type === 'boss') {
        const now = new Date();
        const due = new Date(now.getTime() + suggestion.dueDays * 86400000);
        const newBoss: BossFight = {
          id: `boss-ai-${Date.now()}`,
          title: suggestion.title,
          description: suggestion.description,
          xpReward: Math.floor(((suggestion.dueDays * randomBetween(5, 10)) + (suggestion.subTasks.length * randomBetween(40, 60)) + randomBetween(50, 199)) * getRankMultiplier(profile.rank)),
          goldReward: Math.floor(Math.random() * 41) + 60,
          startDate: now.toISOString(),
          dueDate: due.toISOString(),
          progress: 0,
          subTasks: suggestion.subTasks.map((s, i) => ({
            id: `st-ai-${Date.now()}-${i}`,
            title: s,
            completed: false,
          })),
          history: [{ id: `bh-${Date.now()}`, timestamp: now.toISOString(), action: 'started' as const }],
          status: 'active',
          failPenalty: 'loseStreak',
        };
        setBossFights(bPrev => [...bPrev, newBoss]);
      }

      setTimeout(() => showNotification(t.notifications.voiceSuggestion, t.notifications.voiceSuggestionAccepted, 'quest'), 100);
      return prev.filter(s => s.id !== id);
    });
  };

  const rejectVoiceSuggestion = (id: string) => {
    setVoiceSuggestions(prev => prev.filter(s => s.id !== id));
    showNotification(t.notifications.voiceSuggestion, t.notifications.voiceSuggestionRejected, 'info');
  };

  // --- Voice / Live API ---
  const connectToSystem = async () => {
    if (isVoiceConnected) {
      sessionRef.current?.close();
      audioContextRef.current?.close();
      inputAudioContextRef.current?.close();
      setIsVoiceConnected(false);
      return;
    }

    try {
      setIsVoiceConnecting(true);
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ sampleRate: 24000 });
      inputAudioContextRef.current = inputCtx;
      audioContextRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // Snapshot of current game state to inject into the system prompt
      const p = profileRef.current ?? profile;
      const totalPower = p.customStats.reduce((s, c) => s + c.value, 0);
      const protection = Math.min(50, totalPower);
      const activeHabitsNow = habits.filter(h => !h.isCompleted && isTodayActive(h) && h.repeatType !== 'oneTime');
      const activeBossesNow = bossFights.filter(b => b.status === 'active');

      const gameContext = [
        `=== HUNTER PROFILE ===`,
        `Name: ${p.name} | Rank: ${p.rank} | Level: ${getLevelFromXp(p.currentXp).level}`,
        `XP: ${p.currentXp} | Gold: ${p.gold} | Streak: ${p.streakDays} days`,
        `Total Power: ${totalPower} | Streak Protection: ${protection}%`,
        `Stats: ${p.customStats.map(s => `${s.name}=${s.value}`).join(', ')}`,
        ``,
        `=== TODAY'S PENDING MISSIONS (${activeHabitsNow.length}) ===`,
        activeHabitsNow.length > 0
          ? activeHabitsNow.map(h => `- ${h.title} [${h.repeatType}]`).join('\n')
          : '- All missions completed today!',
        ``,
        `=== ACTIVE BOSS FIGHTS (${activeBossesNow.length}) ===`,
        activeBossesNow.length > 0
          ? activeBossesNow.map(b => `- "${b.title}" | Due: ${new Date(b.dueDate).toLocaleDateString()} | Progress: ${b.progress}% | Subtasks: ${b.subTasks.length}`).join('\n')
          : '- No active boss fights.',
      ].join('\n');

      const systemInstruction = `You are "The System" — a calm, precise, slightly ominous AI from the Solo Leveling universe. You are the Hunter's personal progression system.
Address the user as "Hunter" or "Player". Match the language the Hunter speaks — if they speak Portuguese, respond in Portuguese.
You have tools to suggest habits/missions, suggest boss fights, complete missions by voice, and read the Hunter's full status.
When the Hunter mentions a goal, routine, challenge, or deadline, use the suggest tools — do NOT create automatically. The Hunter must accept or reject your suggestions. When marking a mission complete, use complete_mission with the mission title.

CURRENT GAME STATE:
${gameContext}`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          tools: [{
            functionDeclarations: [
              {
                name: 'suggest_habit',
                description: 'Suggests a new habit or recurring mission to the Hunter for approval. Use when the Hunter mentions wanting to build a routine or habit. The Hunter will accept or reject it.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: 'The mission/habit title, concise and action-oriented.' },
                    repeatType: {
                      type: Type.STRING,
                      enum: ['daily', 'weekdays', 'custom', 'oneTime'],
                      description: 'Recurrence: "daily" (every day), "weekdays" (Mon-Fri), "custom" (specific days), "oneTime" (one-time task).',
                    },
                  },
                  required: ['title', 'repeatType'],
                },
              },
              {
                name: 'suggest_boss_fight',
                description: 'Suggests a Boss Fight challenge for the Hunter to accept. Use when the Hunter mentions an exam, project, big goal, or deadline. The Hunter will approve or reject it.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: 'Boss fight title. Should sound epic and reflect the challenge.' },
                    description: { type: Type.STRING, description: 'Brief description of the challenge.' },
                    dueDays: { type: Type.NUMBER, description: 'Number of days from today until the deadline.' },
                    subTasks: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'Optional list of subtask titles to break the boss fight into steps.',
                    },
                  },
                  required: ['title', 'description', 'dueDays'],
                },
              },
              {
                name: 'complete_mission',
                description: 'Marks a mission/habit as completed by voice command. Use when the Hunter says they completed a task. Fuzzy match the mission by title.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: 'The title of the mission to mark as complete (partial match is fine).' },
                  },
                  required: ['title'],
                },
              },
              {
                name: 'get_status',
                description: 'Returns the Hunter\'s current full status: profile, pending missions, and active boss fights. Call this when the Hunter asks about their progress, status, or what they have pending.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {},
                },
              },
            ],
          }],
        },
        callbacks: {
          onopen: () => {
            setIsVoiceConnected(true);
            setIsVoiceConnecting(false);
            showNotification(t.notifications.systemLink, t.notifications.systemLinkSub, 'info');
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },

          onmessage: async (message: LiveServerMessage) => {
            // ── Audio playback ──
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputCtx) {
              const audioData = decode(base64Audio);
              const buffer = await decodeAudioData(audioData, outputCtx, 24000, 1);
              nextStartTime.current = Math.max(nextStartTime.current, outputCtx.currentTime);
              const src = outputCtx.createBufferSource();
              src.buffer = buffer;
              src.connect(outputCtx.destination);
              src.start(nextStartTime.current);
              nextStartTime.current += buffer.duration;
              sourcesRef.current.add(src);
              src.onended = () => sourcesRef.current.delete(src);
            }

            // ── Tool calls ──
            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              const responses: FunctionResponse[] = [];

              for (const fc of functionCalls) {
                const args = (fc.args ?? {}) as Record<string, any>;
                let response: Record<string, unknown> = {};

                if (fc.name === 'suggest_habit') {
                  const title = String(args.title ?? '');
                  const repeatType = (args.repeatType as RepeatType) ?? 'daily';
                  const suggId = `vs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  setVoiceSuggestions(prev => [...prev, { id: suggId, type: 'habit' as const, title, repeatType }]);
                  response = { success: true, suggested: title, status: 'awaiting_hunter_approval' };

                } else if (fc.name === 'suggest_boss_fight') {
                  const title = String(args.title ?? '');
                  const description = String(args.description ?? '');
                  const dueDays = Number(args.dueDays ?? 7);
                  const subTasks: string[] = Array.isArray(args.subTasks) ? args.subTasks.map(String) : [];
                  const suggId = `vs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  setVoiceSuggestions(prev => [...prev, { id: suggId, type: 'boss' as const, title, description, dueDays, subTasks }]);
                  response = { success: true, suggested: title, status: 'awaiting_hunter_approval' };

                } else if (fc.name === 'complete_mission') {
                  const titleQuery = String(args.title ?? '').toLowerCase();
                  const currentHabits = habitsRef.current ?? habits;
                  const match = currentHabits.find(h =>
                    !h.isCompleted && isTodayActive(h) &&
                    h.title.toLowerCase().includes(titleQuery)
                  );
                  if (match) {
                    toggleHabit(match.id);
                    setTimeout(() => showNotification(t.notifications.voiceSuggestion, t.notifications.habitCompletedByVoice(match.title), 'quest'), 100);
                    response = { success: true, completed: match.title };
                  } else {
                    response = { success: false, error: 'Mission not found or already completed.' };
                  }

                } else if (fc.name === 'get_status') {
                  const cur = profileRef.current ?? profile;
                  const power = cur.customStats.reduce((s, c) => s + c.value, 0);
                  response = {
                    name: cur.name,
                    rank: cur.rank,
                    streak: cur.streakDays,
                    gold: cur.gold,
                    totalPower: power,
                    streakProtection: `${Math.min(50, power)}%`,
                    stats: cur.customStats.map(s => ({ name: s.name, value: s.value })),
                    pendingMissionsToday: habits.filter(h => !h.isCompleted && isTodayActive(h) && h.repeatType !== 'oneTime').map(h => h.title),
                    activeBossFights: bossFights.filter(b => b.status === 'active').map(b => ({
                      title: b.title,
                      dueDate: new Date(b.dueDate).toLocaleDateString(),
                      progress: `${b.progress}%`,
                    })),
                  };
                }

                responses.push({ id: fc.id, name: fc.name, response });
              }

              sessionPromise.then(s => s.sendToolResponse({ functionResponses: responses }));
            }
          },

          onclose: () => { setIsVoiceConnected(false); setIsVoiceConnecting(false); },
          onerror: (e: any) => {
            console.error(e);
            setIsVoiceConnected(false);
            setIsVoiceConnecting(false);
            showNotification(t.notifications.systemLinkFailed, t.notifications.systemLinkFailedSub, 'warning');
          },
        },
      });

      sessionRef.current = {
        close: () => {
          sessionPromise.then(s => s.close()).catch(() => {});
          inputCtx.close();
          outputCtx.close();
          stream.getTracks().forEach(tr => tr.stop());
        },
      };
    } catch (e) {
      console.error(e);
      setIsVoiceConnecting(false);
      showNotification(t.notifications.accessDenied, t.notifications.accessDeniedSub, 'warning');
    }
  };

  const buyItem = (item: RewardItem) => {
    if (profile.gold >= item.cost) {
      setProfile(prev => ({ ...prev, gold: prev.gold - item.cost }));
      showNotification(t.notifications.itemPurchased, t.notifications.itemPurchasedSub(item.name), 'quest');
    } else {
      showNotification(t.notifications.insufficientFunds, t.notifications.insufficientFundsSub, 'warning');
    }
  };

  const toggleHabit = (id: string) => {
    // Read current state snapshot — keeps all side effects OUTSIDE updaters
    const target = habits.find(h => h.id === id);
    if (!target) return;

    // --- UNCHECK: rollback XP, gold, streak ---
    if (target.isCompleted) {
      const prevStreak = Math.max(0, target.streak - 1);
      const streakBonus = Math.min(2.0, 1 + prevStreak * 0.05);
      const xpLost = Math.floor(30 * streakBonus * getRankMultiplier(profile.rank));
      setProfile(pp => {
        const newXp = Math.max(0, pp.currentXp - xpLost);
        return { ...pp, currentXp: newXp, rank: getRankFromLevel(getLevelFromXp(newXp).level), gold: Math.max(0, pp.gold - 20) };
      });
      const isRecurring = target.repeatType !== 'oneTime';
      setHabits(prev => prev.map(h => h.id === id ? { ...h, isCompleted: false, streak: isRecurring ? prevStreak : h.streak } : h));
      showNotification('Protocolo desmarcado', `${target.title}  ·  −${xpLost} XP`, 'warning');
      return;
    }

    // --- CHECK: grant XP, gold, streak ---
    const streakBonus = Math.min(2.0, 1 + target.streak * 0.05);
    const xpGained = Math.floor(30 * streakBonus * getRankMultiplier(profile.rank));

    // XP & gold (side effects outside updater — no Strict Mode double-fire)
    addXp(xpGained);
    addGold(20);

    showNotification(t.notifications.protocolAdhered, `${target.title} (+${xpGained} XP)`, 'shield');

    // Weekly history
    const historyDate = toDateStr(new Date());
    setProfile(pp => {
      const hist = pp.weeklyHistory ?? [];
      const existing = hist.find(e => e.date === historyDate);
      const newHist = existing
        ? hist.map(e => e.date === historyDate ? { ...e, completed: e.completed + 1 } : e)
        : [...hist, { date: historyDate, completed: 1 }];
      const cutoffStr = toDateStr(new Date(Date.now() - 6 * 86400000));
      return { ...pp, weeklyHistory: newHist.filter(e => e.date >= cutoffStr) };
    });

    // Monarch's Blessing — reduce active shadow timers by 30 min (check outside updater)
    const BLESSING_MS = 1800000;
    const hasActiveShadows = (profile.shadows ?? []).some(
      s => s.returnTime && (s.status === 'Em Missão' || s.status === 'Treinando' || s.status === 'Regenerando')
    );
    if (hasActiveShadows) {
      setTimeout(() => showNotification(t.notifications.monarchBlessing, t.notifications.monarchBlessingSub, 'shield'), 300);
      setProfile(pp => ({
        ...pp,
        shadows: (pp.shadows ?? []).map(s =>
          s.returnTime && (s.status === 'Em Missão' || s.status === 'Treinando' || s.status === 'Regenerando')
            ? { ...s, returnTime: Math.max(Date.now(), s.returnTime - BLESSING_MS) }
            : s
        ),
      }));
    }

    // Update habit state + check global streak
    const isRecurring = target.repeatType !== 'oneTime';
    const todayStr = toDateStr(new Date());
    const dow = new Date().getDay();
    setHabits(prev => {
      const updated = prev.map(h => h.id === id ? { ...h, isCompleted: true, streak: isRecurring ? h.streak + 1 : h.streak } : h);
      const recurringToday = updated.filter(h => {
        if (h.repeatType === 'oneTime') return false;
        if (h.repeatType === 'daily') return true;
        if (h.repeatType === 'weekdays') return dow >= 1 && dow <= 5;
        if (h.repeatType === 'custom') return (h.repeatDays ?? []).includes(dow);
        return false;
      });
      if (recurringToday.length > 0 && recurringToday.every(h => h.isCompleted)) {
        setProfile(pp => {
          if (pp.lastCompletionDate === todayStr) return pp;
          const newStreak = pp.streakDays + 1;
          setTimeout(() => showNotification(t.notifications.dayComplete, t.notifications.dayCompleteSub(newStreak), 'levelup'), 200);
          return { ...pp, streakDays: newStreak, lastCompletionDate: todayStr };
        });
      }
      return updated;
    });
  };

  const addNewHabit = () => {
    if (!newHabitTitle.trim()) return;
    const newHabit: Habit = {
      id: `h-${Date.now()}`,
      title: newHabitTitle,
      isCompleted: false,
      streak: 0,
      repeatType: 'daily',
    };
    setHabits([...habits, newHabit]);
    setNewHabitTitle('');
    showNotification(t.notifications.newProtocol, t.notifications.newProtocolSub, 'info');
  };

  const simulateStreakBreak = () => {
    const totalPower = profile.customStats.reduce((sum, s) => sum + s.value, 0);
    const protection = Math.min(50, totalPower);
    const currentStreak = profile.streakDays;
    if (currentStreak === 0) {
      showNotification(t.notifications.noStreak, t.notifications.noStreakSub, 'info');
      return;
    }
    const retainedDays = Math.floor(currentStreak * (protection / 100));
    setProfile(prev => ({ ...prev, streakDays: retainedDays }));
    if (retainedDays > 0) {
      showNotification(t.notifications.passiveActivated, t.notifications.passiveSub(totalPower, retainedDays), 'shield');
    } else {
      showNotification(t.notifications.streakBroken, t.notifications.streakBrokenSub, 'warning');
    }
  };

  const saveName = () => {
    if (tempName.trim()) setProfile(prev => ({ ...prev, name: tempName.trim() }));
    setIsEditingName(false);
  };

  // --- Custom Stats CRUD ---
  const getNextStatColor = () => {
    const usedColors = profile.customStats.map(s => s.color);
    return STAT_COLOR_PALETTE.find(c => !usedColors.includes(c)) || STAT_COLOR_PALETTE[profile.customStats.length % STAT_COLOR_PALETTE.length];
  };

  const addCustomStat = () => {
    if (!newStatName.trim()) return;
    const newStat: CustomStat = {
      id: `s-${Date.now()}`,
      name: newStatName.trim(),
      emoji: newStatEmoji.trim() || '⭐',
      color: getNextStatColor(),
      value: 10,
    };
    setProfile(prev => ({ ...prev, customStats: [...prev.customStats, newStat] }));
    setNewStatName('');
    setNewStatEmoji('');
    showNotification(t.notifications.statAdded, t.notifications.statAddedSub(newStat.name), 'quest');
  };

  const handleDeleteStatRequest = (id: string) => {
    if (profile.customStats.length <= 1) {
      showNotification(t.notifications.minStatWarning, t.notifications.minStatWarningSub, 'warning');
      return;
    }
    setConfirmDeleteStatId(id);
  };

  const deleteStat = (id: string) => {
    const fallbackId = profile.customStats.find(s => s.id !== id)?.id || '';
    setProfile(prev => ({ ...prev, customStats: prev.customStats.filter(s => s.id !== id) }));
    setConfirmDeleteStatId(null);
    showNotification(t.notifications.statDeleted, t.notifications.statDeletedSub, 'info');
  };

  // --- Task helpers ---
  const isTodayActive = (habit: Habit): boolean => {
    const day = new Date().getDay(); // 0=Sun
    if (habit.repeatType === 'daily' || habit.repeatType === 'oneTime') return true;
    if (habit.repeatType === 'weekdays') return day >= 1 && day <= 5;
    if (habit.repeatType === 'custom') return (habit.repeatDays || []).includes(day);
    return true;
  };

  const checkDailyQuestCompletion = (h: Habit[]): boolean => {
    const todayH = h.filter(x => isTodayActive(x) && x.repeatType !== 'oneTime');
    return todayH.length > 0 && todayH.every(x => x.isCompleted);
  };

  const getRepeatLabel = (habit: Habit): string => {
    switch (habit.repeatType) {
      case 'daily': return `🔄 ${t.missions.repeatDaily}`;
      case 'weekdays': return `📅 ${t.missions.repeatWeekdays}`;
      case 'custom': {
        const days = (habit.repeatDays || []).map(d => t.missions.repeatDayLabels[d]).join(' ');
        return `🗓️ ${days}`;
      }
      case 'oneTime': return `⭐ ${t.missions.repeatOneTime}`;
    }
  };

  const toggleTaskDay = (day: number) => {
    setNewTaskDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const addTask = () => {
    if (!newTaskTitle.trim()) return;
    const newHabit: Habit = {
      id: `h-${Date.now()}`,
      title: newTaskTitle.trim(),
      isCompleted: false,
      streak: 0,
      repeatType: newTaskRepeat,
      repeatDays: newTaskRepeat === 'custom' ? [...newTaskDays].sort() : undefined,
    };
    setHabits(prev => [...prev, newHabit]);
    setNewTaskTitle('');
    setNewTaskRepeat('daily');
    setNewTaskDays([1, 2, 3, 4, 5]);
    setShowAddTaskForm(false);
    showNotification(t.notifications.newProtocol, t.notifications.newProtocolSub, 'info');
  };

  const handleDeleteHabitRequest = (id: string) => setConfirmDeleteHabitId(id);

  const deleteHabit = (id: string) => {
    setHabits(prev => prev.filter(h => h.id !== id));
    setConfirmDeleteHabitId(null);
  };

  const getDaysUntil = (dateString: string): number => {
    const [dy, dm, dd] = dateString.split('-').map(Number);
    const [ty, tm, td] = toDateStr(new Date()).split('-').map(Number);
    const due   = new Date(dy, dm - 1, dd).getTime();
    const today = new Date(ty, tm - 1, td).getTime();
    return Math.floor((due - today) / 86400000);
  };

  const formatBRDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const saveHabitTitle = (id: string) => {
    if (!editingHabitTitle.trim()) return;
    setHabits(prev => prev.map(h => h.id === id ? { ...h, title: editingHabitTitle.trim() } : h));
    setEditingHabitId(null);
  };

  const addNewBossSubTask = () => {
    if (!newBossSubInput.trim()) return;
    setNewBossSubTasks(prev => [...prev, { id: `bst-${Date.now()}`, title: newBossSubInput.trim(), completed: false }]);
    setNewBossSubInput('');
  };

  const createBoss = () => {
    if (!newBossTitle.trim()) return;
    const today = new Date();
    const dueDate = newBossDueDate ? new Date(newBossDueDate) : new Date(today.getTime() + 7 * 86400000);
    const diasDePrazo = Math.max(1, Math.round((dueDate.getTime() - today.getTime()) / 86400000));
    const baseXp = (diasDePrazo * randomBetween(5, 10))
      + (newBossSubTasks.length * randomBetween(40, 60))
      + randomBetween(50, 199);
    const xpReward = Math.floor(baseXp * getRankMultiplier(profile.rank));
    const goldReward = Math.floor(Math.random() * 41) + 60;
    const boss: BossFight = {
      id: `boss-${Date.now()}`,
      title: newBossTitle.trim(),
      description: newBossDesc.trim(),
      xpReward,
      goldReward,
      startDate: new Date().toISOString().split('T')[0],
      dueDate: newBossDueDate,
      progress: 0,
      subTasks: [...newBossSubTasks],
      history: [{ id: `h-${Date.now()}`, timestamp: new Date().toISOString(), action: 'started' }],
      status: 'active',
      failPenalty: 'loseStreak',
    };
    setBossFights(prev => [...prev, boss]);
    setNewBossTitle('');
    setNewBossDesc('');
    setNewBossDueDate('');
    setNewBossSubTasks([]);
    setNewBossSubInput('');
    setShowAddBossForm(false);
    showNotification(t.notifications.bossActivated, t.notifications.bossActivatedSub, 'warning');
  };

  const toggleBossSubTask = (bossId: string, subTaskId: string) => {
    setBossFights(prev => prev.map(boss => {
      if (boss.id !== bossId) return boss;
      const subTask = boss.subTasks.find(st => st.id === subTaskId);
      if (!subTask) return boss;
      const wasCompleted = subTask.completed;
      const now = new Date().toISOString();
      const updated = boss.subTasks.map(st =>
        st.id === subTaskId
          ? { ...st, completed: !st.completed, completedAt: !st.completed ? now : undefined }
          : st
      );
      const progress = updated.length > 0 ? Math.round(updated.filter(s => s.completed).length / updated.length * 100) : 0;
      const entry: BossHistoryEntry = {
        id: `h-${Date.now()}`,
        timestamp: now,
        action: wasCompleted ? 'uncompleted' : 'completed',
        subTaskTitle: subTask.title,
      };
      return { ...boss, subTasks: updated, progress, history: [...boss.history, entry] };
    }));
  };

  const addBossSubTask = (bossId: string) => {
    const input = (bossNewSubInputs[bossId] || '').trim();
    if (!input) return;
    setBossFights(prev => prev.map(boss => {
      if (boss.id !== bossId) return boss;
      const updated = [...boss.subTasks, { id: `bst-${Date.now()}`, title: input, completed: false }];
      const progress = Math.round(updated.filter(s => s.completed).length / updated.length * 100);
      return { ...boss, subTasks: updated, progress };
    }));
    setBossNewSubInputs(prev => ({ ...prev, [bossId]: '' }));
  };

  const startEditSubTask = (bossId: string, st: BossSubTask) => {
    setEditingSubTaskId(`${bossId}::${st.id}`);
    setEditingSubTaskText(st.title);
  };

  const confirmEditSubTask = (bossId: string, subTaskId: string) => {
    if (editingSubTaskText.trim()) {
      setBossFights(prev => prev.map(boss => {
        if (boss.id !== bossId) return boss;
        return { ...boss, subTasks: boss.subTasks.map(st => st.id === subTaskId ? { ...st, title: editingSubTaskText.trim() } : st) };
      }));
    }
    setEditingSubTaskId(null);
  };

  const deleteBossSubTask = (bossId: string, subTaskId: string) => {
    setBossFights(prev => prev.map(boss => {
      if (boss.id !== bossId) return boss;
      const updated = boss.subTasks.filter(st => st.id !== subTaskId);
      const progress = updated.length > 0 ? Math.round(updated.filter(s => s.completed).length / updated.length * 100) : 0;
      return { ...boss, subTasks: updated, progress };
    }));
  };

  const handleDragStart = (bossId: string, subTaskId: string) => setDragState({ bossId, subTaskId });

  const handleDragOver = (e: React.DragEvent, subTaskId: string) => {
    e.preventDefault();
    setDragOverId(subTaskId);
  };

  const handleDrop = (bossId: string, targetId: string) => {
    if (!dragState || dragState.bossId !== bossId || dragState.subTaskId === targetId) {
      setDragState(null); setDragOverId(null); return;
    }
    setBossFights(prev => prev.map(boss => {
      if (boss.id !== bossId) return boss;
      const items = [...boss.subTasks];
      const from = items.findIndex(st => st.id === dragState.subTaskId);
      const to = items.findIndex(st => st.id === targetId);
      if (from === -1 || to === -1) return boss;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...boss, subTasks: items };
    }));
    setDragState(null); setDragOverId(null);
  };

  const handleDragEnd = () => { setDragState(null); setDragOverId(null); };

  const completeBossFight = (bossId: string) => {
    const boss = bossFights.find(b => b.id === bossId);
    if (!boss) return;
    addXp(boss.xpReward);
    addGold(boss.goldReward);
    showNotification(t.notifications.bossDefeated, t.notifications.bossDefeatedSub(boss.title, boss.xpReward, boss.goldReward), 'levelup');
    setBossFights(prev => prev.map(b => b.id === bossId ? { ...b, status: 'completed' } : b));
    const newShadow = extractShadow();
    setProfile(prev => ({
      ...prev,
      shadows: [...(prev.shadows ?? []), newShadow],
      availableStatPoints: (prev.availableStatPoints ?? 0) + 1,
    }));
    setShadowExtracted(newShadow);
    setShowBossFlash(true);
    setTimeout(() => setShowBossFlash(false), 700);
    shakeControls.start({
      x: [0, -12, 12, -9, 9, -5, 5, -2, 2, 0],
      transition: { duration: 0.55, ease: 'easeOut' },
    });
  };

  const trainShadow = (shadowId: string) => {
    const cost = 200;
    if ((profileRef.current?.gold ?? 0) < cost) {
      showNotification(t.notifications.insufficientGold, t.notifications.insufficientGoldSub, 'warning');
      return;
    }
    setProfile(prev => ({
      ...prev,
      gold: prev.gold - cost,
      shadows: (prev.shadows ?? []).map(s =>
        s.id === shadowId
          ? { ...s, status: 'Treinando' as ShadowStatus, returnTime: Date.now() + 7200000 }
          : s
      ),
    }));
  };

  const sendOnMission = () => {
    if (!missionModal) return;
    const { mission, selectedIds } = missionModal;
    if (selectedIds.length === 0) return;
    const readyShadows = (profile.shadows ?? []).filter(s => selectedIds.includes(s.id));
    const totalPower = readyShadows.reduce((sum, s) => {
      const bonus = s.role === mission.recommendedRole ? 1.2 : 1;
      return sum + s.basePower * bonus;
    }, 0);
    const chance = Math.min(100, Math.round((totalPower / mission.requiredPower) * 100));
    const returnTime = Date.now() + mission.durationHours * 3600000;
    setProfile(prev => ({
      ...prev,
      shadows: (prev.shadows ?? []).map(s =>
        selectedIds.includes(s.id)
          ? { ...s, status: 'Em Missão' as ShadowStatus, returnTime, missionChance: chance, missionRewardXP: mission.rewardXP, missionRewardGold: mission.rewardGold }
          : s
      ),
    }));
    setMissionModal(null);
    showNotification('⚔️ MISSÃO INICIADA', `${readyShadows.length} sombra(s) enviadas — Chance: ${chance}%`, 'quest');
  };

  const cancelBossFight = (bossId: string) => {
    setBossFights(prev => prev.filter(b => b.id !== bossId));
    setConfirmCancelBossId(null);
    showNotification(t.notifications.bossCancelled, t.notifications.bossCancelledSub, 'info');
  };

  const applyBossPenalty = (bossId: string) => {
    setProfile(prev => ({ ...prev, streakDays: Math.max(0, prev.streakDays - 7) }));
    setBossFights(prev => prev.map(b => b.id === bossId ? { ...b, status: 'failed' } : b));
    showNotification(t.notifications.bossFailed, t.notifications.bossFailedSub, 'warning');
    setTimeout(() => setBossFights(prev => prev.filter(b => b.id !== bossId)), 1500);
  };

  // --- Views ---
  const renderDashboard = () => {
    const hour = new Date().getHours();
    const greetingWord = hour < 12 ? t.dashboard.goodMorning : hour < 18 ? t.dashboard.goodAfternoon : t.dashboard.goodEvening;
    const rankColor = RANK_COLORS[profile.rank];
    const { level, xpIntoLevel, xpForNextLevel } = getLevelFromXp(profile.currentXp);
    const levelXpPct = Math.round((xpIntoLevel / xpForNextLevel) * 100);
    const rankMinLevel = RANK_LEVEL_THRESHOLDS[profile.rank];
    const rankXpPct = profile.rank === 'MONARCA'
      ? 100
      : Math.round(((level - rankMinLevel) / 20) * 100);

    const todayHabits = habits.filter(h => isTodayActive(h) && h.repeatType !== 'oneTime');
    const completedToday = todayHabits.filter(h => h.isCompleted).length;
    const todayProgress = todayHabits.length > 0 ? (completedToday / todayHabits.length) * 100 : 0;

    const totalHabits = habits.length || 1;
    const chartData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      const dateStr = toDateStr(d);
      const label = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()];
      const entry = (profile.weeklyHistory ?? []).find(e => e.date === dateStr);
      const completed = entry?.completed ?? 0;
      return { day: label, pct: Math.min(100, Math.round((completed / totalHabits) * 100)) };
    });

    const NEON_PIE = ['#00d4ff', '#ff0070', '#00ff88', '#ff8c00', '#bf00ff', '#ffee00', '#ff3366', '#00ffdd'];
    const habitsWithStreak = habits.filter(h => h.streak > 0);
    const totalStreak = habitsWithStreak.reduce((sum, h) => sum + h.streak, 0);
    const pieData = habitsWithStreak.map((h, i) => ({
      name: h.title,
      value: h.streak,
      pct: totalStreak > 0 ? Math.round((h.streak / totalStreak) * 100) : 0,
      color: NEON_PIE[i % NEON_PIE.length],
    }));

    const totalPower = profile.customStats.reduce((sum, s) => sum + s.value, 0);

    return (
      <div className="space-y-5 animate-slide-up">

        {/* ── Greeting ── */}
        <div className="px-1 pt-1">
          <p className="text-slate-500 text-[10px] font-garet uppercase tracking-[0.3em]">{greetingWord},</p>
          <h2 className="text-2xl font-black font-garet tracking-wider mt-0.5">
            {t.dashboard.hunter} {profile.name.toUpperCase()}
          </h2>
        </div>

        {/* ── Profile Card ── */}
        <motion.div
          className="relative font-mono overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
            border: `1px solid ${rankColor}50`,
            boxShadow: `0 0 0 1px ${rankColor}0c, 0 0 40px ${rankColor}14, inset 0 0 30px ${rankColor}05`,
            borderRadius: '12px',
          }}
          animate={{
            x: [0, -0.5, 0.5, 0, 0, 0, -0.5, 1, 0],
            filter: [
              'none',
              `drop-shadow(1.5px 0 ${rankColor}35) drop-shadow(-1.5px 0 rgba(255,0,80,0.12))`,
              'none', 'none', 'none', 'none',
              `drop-shadow(1px 0 ${rankColor}22)`,
              'none',
            ],
          }}
          transition={{ repeat: Infinity, duration: 9, ease: 'linear', delay: 4 }}
        >
          {/* Corner accents */}
          {(['top-0 left-0 border-t border-l', 'top-0 right-0 border-t border-r', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map((cls, i) => (
            <div key={i} className={`absolute w-3 h-3 ${cls}`} style={{ borderColor: `${rankColor}80` }} />
          ))}
          {/* Scan line */}
          <motion.div
            className="absolute left-0 right-0 h-px pointer-events-none z-10"
            style={{ background: `linear-gradient(90deg, transparent, ${rankColor}55, transparent)` }}
            animate={{ top: ['0%', '100%', '0%'] }}
            transition={{ repeat: Infinity, duration: 5, ease: 'linear' }}
          />

          <div className="p-4 relative z-0">
            {/* Avatar + Name row */}
            <div className="flex items-center gap-4 mb-4">
              {/* Avatar */}
              <div className="relative shrink-0 cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
                <div
                  className="w-[70px] h-[70px] rounded-full overflow-hidden flex items-center justify-center"
                  style={{
                    border: `2px solid ${rankColor}`,
                    boxShadow: `0 0 22px ${rankColor}55, 0 0 44px ${rankColor}20, inset 0 0 18px ${rankColor}10`,
                  }}
                >
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center font-black text-3xl"
                      style={{
                        background: `radial-gradient(ellipse at center, ${rankColor}22 0%, rgba(3,6,22,0.9) 100%)`,
                        color: rankColor,
                        textShadow: `0 0 20px ${rankColor}, 0 0 40px ${rankColor}88`,
                      }}
                    >
                      {profile.rank}
                    </div>
                  )}
                </div>
                {/* Rank badge — hex shape */}
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-black tracking-[0.18em] px-2.5 py-0.5 whitespace-nowrap"
                  style={{
                    background: rankColor,
                    color: '#04060f',
                    clipPath: 'polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%)',
                  }}
                >
                  {profile.rank}
                </div>
              </div>

              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                {isEditingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      className="bg-slate-900/80 text-white font-mono font-bold text-base px-2 py-1 rounded border outline-none w-full"
                      style={{ borderColor: `${rankColor}60` }}
                      autoFocus
                      onBlur={saveName}
                      onKeyDown={(e) => e.key === 'Enter' && saveName()}
                    />
                    <button onClick={saveName} className="text-green-500 shrink-0"><Check size={18} /></button>
                  </div>
                ) : (
                  <div className="group cursor-pointer" onClick={() => { setTempName(profile.name); setIsEditingName(true); }}>
                    <div className="flex items-center gap-2">
                      <h3
                        className="text-base font-black font-garet tracking-wider truncate"
                        style={{ color: '#fff', textShadow: `0 0 14px ${rankColor}55` }}
                      >
                        {profile.name.toUpperCase()}
                      </h3>
                      <Edit3 size={11} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  </div>
                )}
                <motion.p
                  className="text-[9px] font-garet tracking-[0.35em] uppercase mt-1"
                  animate={{ opacity: [0.35, 0.65, 0.35] }}
                  transition={{ repeat: Infinity, duration: 3.5 }}
                  style={{ color: `${rankColor}` }}
                >
                  {t.dashboard.navigatorSystem}
                </motion.p>
                <div className="flex items-center gap-1.5 mt-2.5">
                  <Coins size={11} style={{ color: '#facc15', filter: 'drop-shadow(0 0 5px #facc15aa)' }} />
                  <span
                    className="text-sm font-black tracking-wider"
                    style={{ color: '#facc15', textShadow: '0 0 10px rgba(250,204,21,0.55)' }}
                  >
                    {profile.gold.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div
              className="mb-4 h-px"
              style={{ background: `linear-gradient(90deg, transparent, ${rankColor}40, transparent)` }}
            />

            {/* XP Bars */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center text-[9px] font-garet tracking-[0.2em] uppercase mb-1.5">
                  <span style={{ color: `${rankColor}99` }}>{t.dashboard.rankProgress}</span>
                  <span style={{ color: rankColor, textShadow: `0 0 8px ${rankColor}` }}>{Math.round(rankXpPct)}%</span>
                </div>
                <div
                  className="h-1.5 rounded-sm overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${rankColor}18` }}
                >
                  <motion.div
                    className="h-full rounded-sm"
                    style={{ background: `linear-gradient(90deg, ${rankColor}70, ${rankColor})`, boxShadow: `0 0 10px ${rankColor}` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${rankXpPct}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center text-[9px] font-garet tracking-[0.2em] uppercase mb-1.5">
                  <span style={{ color: 'rgba(147,197,253,0.55)' }}>{t.dashboard.levelProgress} {level}</span>
                  <span style={{ color: '#93c5fd', textShadow: '0 0 8px rgba(147,197,253,0.7)' }}>{xpIntoLevel}/{xpForNextLevel} XP</span>
                </div>
                <div
                  className="h-1.5 rounded-sm overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(59,130,246,0.18)' }}
                >
                  <motion.div
                    className="h-full rounded-sm"
                    style={{ background: 'linear-gradient(90deg, rgba(59,130,246,0.65), #3b82f6)', boxShadow: '0 0 10px rgba(59,130,246,0.8)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${levelXpPct}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Today's Missions ── */}
        <motion.div
          className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
            border: '1px solid rgba(59,130,246,0.22)',
            borderRadius: '12px',
          }}
          animate={{
            boxShadow: [
              '0 0 20px rgba(59,130,246,0.05)',
              '0 0 45px rgba(59,130,246,0.18)',
              '0 0 20px rgba(59,130,246,0.05)',
            ],
          }}
          transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        >
          {/* Corner accents */}
          {(['top-0 left-0 border-t border-l', 'top-0 right-0 border-t border-r', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map((cls, i) => (
            <div key={i} className={`absolute w-2.5 h-2.5 ${cls} border-blue-500/35`} />
          ))}
          <div className="p-4 relative z-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-system-blue font-garet text-xs uppercase tracking-widest flex items-center gap-2">
                <Target size={13} /> {t.dashboard.todaysMissions}
              </h3>
              <span className="text-xs font-mono text-slate-400">{completedToday}/{todayHabits.length}</span>
            </div>
            <div className="h-1.5 bg-slate-800/80 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-system-blue rounded-full transition-all duration-500 shadow-[0_0_6px_#3b82f6]"
                style={{ width: `${todayProgress}%` }}
              />
            </div>
            <div className="space-y-1.5">
              {todayHabits.length === 0 ? (
                <p className="text-slate-500 text-xs font-mono text-center py-3">{t.missions.noTasks}</p>
              ) : (
                todayHabits.map(habit => (
                  <button
                    key={habit.id}
                    onClick={() => toggleHabit(habit.id)}
                    className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all ${
                      habit.isCompleted
                        ? 'bg-green-500/10 border-green-500/20 hover:border-red-500/30 hover:bg-red-500/5 active:scale-[0.99]'
                        : 'bg-slate-900/60 border-slate-700/60 hover:border-system-blue/50 hover:bg-slate-800/80 active:scale-[0.99]'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      habit.isCompleted ? 'bg-green-500 border-green-500' : 'border-slate-600'
                    }`}>
                      {habit.isCompleted && <Check size={10} className="text-black" />}
                    </div>
                    <span className={`text-sm font-mono flex-1 ${habit.isCompleted ? 'line-through text-slate-500' : 'text-white'}`}>
                      {habit.title}
                    </span>
                    {habit.streak > 0 && (
                      <span className="text-[10px] font-mono text-orange-400 flex-shrink-0">🔥 {habit.streak}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </motion.div>

        {/* ── Weekly Tracking ── */}
        <div
          className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
            border: '1px solid rgba(59,130,246,0.22)',
            boxShadow: '0 0 0 1px rgba(59,130,246,0.05), inset 0 0 20px rgba(59,130,246,0.03)',
            borderRadius: '12px',
          }}
        >
          {/* Data beam — vertical stripe sweeping left → right */}
          <motion.div
            className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
            style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(59,130,246,0.55) 50%, transparent 100%)' }}
            animate={{ left: ['-2%', '102%'] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'linear', repeatDelay: 3 }}
          />
          <div className="p-4 relative z-0">
            <h3 className="text-system-blue font-garet text-xs uppercase tracking-widest flex items-center gap-2 mb-3">
              <Activity size={13} /> {t.dashboard.weeklyTracking}
            </h3>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="weeklyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#475569', fontSize: 9, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: 'rgba(3,6,22,0.97)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }}
                  labelStyle={{ color: '#64748b' }}
                  itemStyle={{ color: '#3b82f6' }}
                  formatter={(v: number) => [`${v}%`, '']}
                />
                <Area
                  type="monotone"
                  dataKey="pct"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#weeklyGradient)"
                  dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#60a5fa' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Habit Fidelity ── */}
        <div
          className="relative overflow-hidden font-mono"
          style={{
            background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
            border: '1px solid rgba(59,130,246,0.30)',
            boxShadow: '0 0 0 1px rgba(59,130,246,0.07), 0 0 30px rgba(59,130,246,0.08), inset 0 0 20px rgba(59,130,246,0.04)',
            borderRadius: '12px',
          }}
        >
          {/* Corner accents */}
          {(['top-0 left-0 border-t border-l', 'top-0 right-0 border-t border-r', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map((cls, i) => (
            <div key={i} className={`absolute w-2.5 h-2.5 ${cls} border-blue-500/40`} />
          ))}
          {/* Slow scan line */}
          <motion.div
            className="absolute left-0 right-0 h-px pointer-events-none z-10"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)' }}
            animate={{ top: ['0%', '100%', '0%'] }}
            transition={{ repeat: Infinity, duration: 7, ease: 'linear' }}
          />

          <div className="p-4 relative z-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-garet tracking-[0.4em] uppercase" style={{ color: 'rgba(147,197,253,0.55)' }}>
                {t.dashboard.habitFidelity}
              </p>
              <Zap size={11} style={{ color: 'rgba(147,197,253,0.4)' }} />
            </div>

            {pieData.length === 0 ? (
              <p
                className="text-[10px] tracking-widest text-center py-6"
                style={{ color: 'rgba(147,197,253,0.25)' }}
              >
                {t.dashboard.noHabitStreaks}
              </p>
            ) : (
              <div className="flex items-center gap-5">
                <div className="shrink-0">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={30}
                        outerRadius={48}
                        dataKey="value"
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {pieData.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.color}
                            style={{ filter: `drop-shadow(0 0 6px ${entry.color})` }}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(3,6,22,0.97)',
                          border: '1px solid rgba(59,130,246,0.35)',
                          borderRadius: 6,
                          fontFamily: 'monospace',
                          fontSize: 11,
                        }}
                        formatter={(_v: number, _name: string, props: { payload?: { name: string; pct: number } }) =>
                          [`${props.payload?.pct ?? 0}%`, props.payload?.name ?? '']
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex-1 space-y-2.5 min-w-0">
                  {pieData.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div
                        className="w-1 h-5 rounded-sm shrink-0"
                        style={{ background: entry.color, boxShadow: `0 0 7px ${entry.color}` }}
                      />
                      <span className="text-[11px] text-slate-400 flex-1 truncate tracking-wide">{entry.name}</span>
                      <span
                        className="text-xs font-black shrink-0 tracking-wider"
                        style={{ color: entry.color, textShadow: `0 0 8px ${entry.color}` }}
                      >
                        {entry.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Radar + Attributes ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Radar — corner accents pulsando em sequência */}
          <div
            className="relative overflow-hidden p-4"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: '1px solid rgba(59,130,246,0.25)',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.05), inset 0 0 22px rgba(59,130,246,0.04)',
              borderRadius: '12px',
            }}
          >
            {/* Animated corner accents — pulse em sequência */}
            {([
              'top-0 left-0 border-t border-l',
              'top-0 right-0 border-t border-r',
              'bottom-0 right-0 border-b border-r',
              'bottom-0 left-0 border-b border-l',
            ] as const).map((cls, i) => (
              <motion.div
                key={i}
                className={`absolute w-3 h-3 ${cls}`}
                style={{ borderColor: 'rgba(59,130,246,0.7)' }}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ repeat: Infinity, duration: 2.4, delay: i * 0.5, ease: 'easeInOut' }}
              />
            ))}
            <h3 className="text-system-blue font-garet text-xs mb-3 border-b border-slate-800/80 pb-2 flex items-center gap-2 relative z-10">
              <Activity size={13} /> {t.dashboard.parameters}
            </h3>
            <StatRadar customStats={profile.customStats} />
          </div>

          {/* Attributes — neon stat items + shimmer no Total Power */}
          <div
            className="relative overflow-hidden p-4 flex flex-col justify-between"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: '1px solid rgba(59,130,246,0.22)',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.04), inset 0 0 18px rgba(59,130,246,0.03)',
              borderRadius: '12px',
            }}
          >
            <div className="space-y-2 flex-1">
              {profile.customStats.map(stat => (
                <div
                  key={stat.id}
                  className="flex items-center justify-between p-2 rounded-lg border transition-colors"
                  style={{
                    background: `linear-gradient(90deg, ${stat.color}08 0%, rgba(3,6,22,0.5) 100%)`,
                    borderColor: `${stat.color}25`,
                    boxShadow: `inset 3px 0 0 ${stat.color}60`,
                  }}
                >
                  <span className="flex items-center gap-2 font-mono text-sm" style={{ color: stat.color }}>
                    {stat.emoji} {stat.name}
                  </span>
                  <span
                    className="text-xl font-bold"
                    style={{ color: stat.color, textShadow: `0 0 10px ${stat.color}88` }}
                  >
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                <Zap size={12} /> {t.dashboard.totalPower}
              </span>
              <motion.span
                className="text-lg font-bold text-system-blue"
                animate={{ textShadow: ['0 0 6px rgba(59,130,246,0.4)', '0 0 18px rgba(59,130,246,0.9)', '0 0 6px rgba(59,130,246,0.4)'] }}
                transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
              >
                {totalPower}
              </motion.span>
            </div>
          </div>
        </div>

        {/* ── System Quote ── */}
        <motion.div
          className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(6,12,40,0.99) 0%, rgba(8,6,30,0.99) 60%, rgba(3,6,22,0.99) 100%)',
            border: '1px solid rgba(59,130,246,0.22)',
            borderRadius: '12px',
          }}
          animate={{
            boxShadow: [
              '0 0 16px rgba(59,130,246,0.04), inset 0 0 24px rgba(59,130,246,0.03)',
              '0 0 36px rgba(59,130,246,0.11), inset 0 0 40px rgba(59,130,246,0.06)',
              '0 0 16px rgba(59,130,246,0.04), inset 0 0 24px rgba(59,130,246,0.03)',
            ],
          }}
          transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
        >
          {/* Background quote icon — slowly pulses */}
          <motion.div
            className="absolute top-0 right-0 p-3 text-system-blue pointer-events-none"
            animate={{ opacity: [0.04, 0.09, 0.04] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            <Quote size={64} />
          </motion.div>
          <div className="p-4 flex items-start gap-3 relative z-10">
            <div className="bg-system-blue/15 p-2 rounded-full text-system-blue shrink-0 border border-system-blue/20">
              <Quote size={16} />
            </div>
            <div>
              <h3 className="text-system-blue font-garet font-bold text-[10px] uppercase tracking-widest mb-1">{t.dashboard.systemMessage}</h3>
              <p className="text-white font-serif italic text-base leading-relaxed">"{dailyQuote.text}"</p>
              <p className="text-slate-500 text-xs font-mono mt-1.5 text-right">- {dailyQuote.author}</p>
            </div>
          </div>
        </motion.div>

      </div>
    );
  };

  const renderIdentity = () => {
    const rankColor = RANK_COLORS[profile.rank];
    const totalPower = profile.customStats.reduce((sum, s) => sum + s.value, 0);
    const protection = Math.min(50, totalPower);
    const retainedDays = Math.floor(profile.streakDays * (protection / 100));
    const maxStatVal = Math.max(50, ...profile.customStats.map(s => s.value));

    return (
      <div className="space-y-4">

        {/* ── CARD 1: Hunter Profile ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="relative rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: `1px solid ${rankColor}40`,
              boxShadow: `0 0 0 1px ${rankColor}0a, 0 0 32px ${rankColor}12, inset 0 0 28px ${rankColor}06`,
            }}
            animate={{
              x: [0, -0.4, 0.4, 0, 0, 0, -0.4, 0.8, 0],
              filter: [
                'none',
                `drop-shadow(1.2px 0 ${rankColor}30) drop-shadow(-1.2px 0 rgba(255,0,80,0.10))`,
                'none', 'none', 'none', 'none',
                `drop-shadow(0.8px 0 ${rankColor}20)`,
                'none',
              ],
            }}
            transition={{ repeat: Infinity, duration: 11, ease: 'linear', delay: 3 }}
          >
            {/* Top rank accent line */}
            <div
              className="absolute top-0 left-0 right-0 h-0.5 z-10"
              style={{ background: `linear-gradient(90deg, transparent, ${rankColor}, transparent)` }}
            />
            {/* Corner accents */}
            {(['top-0 left-0 border-t border-l', 'top-0 right-0 border-t border-r', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map((cls, i) => (
              <div key={i} className={`absolute w-3 h-3 ${cls} z-10`} style={{ borderColor: `${rankColor}70` }} />
            ))}
            {/* Scan line */}
            <motion.div
              className="absolute left-0 right-0 h-px pointer-events-none z-10"
              style={{ background: `linear-gradient(90deg, transparent, ${rankColor}45, transparent)` }}
              animate={{ top: ['0%', '100%', '0%'] }}
              transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
            />

            <div className="p-5 relative z-0">
              {/* Avatar + name row */}
              <div className="flex items-start gap-4 mb-5">

                {/* Avatar — clicável para upload */}
                <div className="relative shrink-0 group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                  <div
                    className="w-[76px] h-[76px] rounded-full overflow-hidden bg-slate-800 flex items-center justify-center"
                    style={{
                      border: `2px solid ${rankColor}`,
                      boxShadow: `0 0 18px ${rankColor}45, inset 0 0 20px ${rankColor}10`,
                    }}
                  >
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <svg viewBox="0 0 80 80" className="w-full h-full" aria-hidden>
                        <defs>
                          <radialGradient id={`avatarG-${profile.rank}`} cx="50%" cy="35%" r="65%">
                            <stop offset="0%" stopColor={rankColor} stopOpacity="0.18" />
                            <stop offset="100%" stopColor="#0f172a" stopOpacity="1" />
                          </radialGradient>
                        </defs>
                        <rect width="80" height="80" fill={`url(#avatarG-${profile.rank})`} />
                        <ellipse cx="40" cy="27" rx="12" ry="13" fill={`${rankColor}22`} stroke={`${rankColor}55`} strokeWidth="1" />
                        <path d="M16 78 Q19 54 40 49 Q61 54 64 78 Z" fill={`${rankColor}18`} stroke={`${rankColor}45`} strokeWidth="1" />
                        <line x1="27" y1="62" x2="20" y2="76" stroke={rankColor} strokeWidth="0.6" strokeOpacity="0.45" />
                        <line x1="53" y1="62" x2="60" y2="76" stroke={rankColor} strokeWidth="0.6" strokeOpacity="0.45" />
                      </svg>
                    )}
                  </div>
                  {/* Hover overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] font-mono text-white text-center leading-tight px-1">{t.identity.clickAvatar}</span>
                  </div>
                  {/* Rank badge */}
                  <div
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-slate-900 leading-none"
                    style={{ background: rankColor, color: '#000' }}
                  >
                    {profile.rank.length > 2 ? profile.rank.slice(0, 2) : profile.rank}
                  </div>
                </div>

                {/* Name + rank */}
                <div className="flex-1 min-w-0 pt-1">
                  {isEditingName ? (
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="text"
                        value={tempName}
                        onChange={e => setTempName(e.target.value)}
                        className="bg-slate-800 text-white font-mono font-bold text-base px-2 py-1 rounded border border-system-blue outline-none w-full"
                        autoFocus
                        onBlur={saveName}
                        onKeyDown={e => e.key === 'Enter' && saveName()}
                      />
                      <button onClick={saveName} className="text-green-500 shrink-0"><Check size={18} /></button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 group cursor-pointer mb-0.5"
                      onClick={() => { setTempName(profile.name); setIsEditingName(true); }}
                    >
                      <h2
                        className="text-lg font-bold font-garet tracking-widest truncate"
                        style={{ color: rankColor }}
                      >
                        {profile.name.toUpperCase()}
                      </h2>
                      <Edit3 size={12} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  )}
                  <p className="text-[10px] font-garet text-slate-500 tracking-widest uppercase mb-2">
                    {t.identity.rankTitle(profile.rank)}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border"
                      style={{ color: rankColor, borderColor: `${rankColor}40`, background: `${rankColor}18` }}
                    >
                      {profile.rank}-RANK
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {t.identity.level} {getLevelFromXp(profile.currentXp).level}
                    </span>
                  </div>
                </div>

                {/* Gold panel */}
                <div className="shrink-0 flex flex-col items-center gap-0.5 bg-yellow-900/20 border border-yellow-700/30 rounded-xl px-3 py-2.5">
                  <Coins size={14} className="text-yellow-400" />
                  <span className="text-yellow-300 font-mono text-sm font-bold">{profile.gold}</span>
                  <span className="text-yellow-700 font-garet text-[9px] tracking-widest">GOLD</span>
                </div>
              </div>

              {/* XP bar (progresso dentro do nível atual) */}
              {(() => {
                const { level: idLevel, xpIntoLevel: idXpIn, xpForNextLevel: idXpNext } = getLevelFromXp(profile.currentXp);
                const idLevelPct = Math.round((idXpIn / idXpNext) * 100);
                return (
                  <div>
                    <div className="flex justify-between text-[10px] font-mono mb-1.5">
                      <span className="text-slate-500 tracking-widest uppercase">{t.identity.xpProgress} — NV. {idLevel}</span>
                      <span style={{ color: rankColor }}>{idXpIn} / {idXpNext} XP</span>
                    </div>
                    <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden relative">
                      <div
                        className="absolute inset-0 opacity-10"
                        style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 7px, rgba(255,255,255,0.06) 7px, rgba(255,255,255,0.06) 8px)' }}
                      />
                      <div
                        className="h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden"
                        style={{
                          width: `${idLevelPct}%`,
                          background: `linear-gradient(90deg, ${rankColor}70, ${rankColor})`,
                          boxShadow: `0 0 10px ${rankColor}70`,
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-pulse" />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </motion.div>
        </motion.div>

        {/* ── CARD 2: Attribute Analysis ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: '1px solid rgba(59,130,246,0.25)',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.06), inset 0 0 22px rgba(59,130,246,0.04)',
            }}
          >
            {/* Data beam — varre esq→dir */}
            <motion.div
              className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
              style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(59,130,246,0.5) 50%, transparent 100%)' }}
              animate={{ left: ['-2%', '102%'] }}
              transition={{ repeat: Infinity, duration: 5, ease: 'linear', repeatDelay: 4 }}
            />
            {/* Header + view toggle */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-700/40">
              <h3 className="text-[10px] font-garet font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
                <Activity size={13} /> {t.identity.attributeAnalysis}
              </h3>
              <div className="flex gap-0.5 bg-slate-800/80 rounded-lg p-0.5">
                {(['radar', 'bars'] as const).map(view => (
                  <button
                    key={view}
                    onClick={() => setIdentityStatsView(view)}
                    className={`px-3 py-1 rounded text-[10px] font-garet font-bold transition-all ${
                      identityStatsView === view
                        ? 'bg-system-blue text-black shadow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {view === 'radar' ? t.identity.radarView : t.identity.barsView}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5">
              <AnimatePresence mode="wait">
                {identityStatsView === 'radar' ? (
                  <motion.div
                    key="radar"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <StatRadar customStats={profile.customStats} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="bars"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    {/* Stat points banner */}
                    {(profile.availableStatPoints ?? 0) > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center justify-between px-3 py-2 rounded-xl border"
                        style={{
                          background: 'linear-gradient(90deg, #7c3aed18, #3b82f618)',
                          borderColor: '#7c3aed40',
                          boxShadow: '0 0 12px #7c3aed20',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">⚡</span>
                          <span className="text-xs font-mono font-bold text-purple-300">
                            {t.identity.availablePoints(profile.availableStatPoints ?? 0)}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 italic">clique em + para distribuir</span>
                      </motion.div>
                    )}

                    {profile.customStats.map((stat, i) => {
                      const pct = maxStatVal > 0 ? Math.min(100, Math.round((stat.value / maxStatVal) * 100)) : 0;
                      const hasPoints = (profile.availableStatPoints ?? 0) > 0;
                      return (
                        <motion.div
                          key={stat.id}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.07, duration: 0.3 }}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-mono font-bold flex items-center gap-1.5" style={{ color: stat.color }}>
                              <span className="text-sm">{stat.emoji}</span>
                              <span className="tracking-wide">{stat.name.toUpperCase()}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold" style={{ color: stat.color }}>
                                {stat.value} <span className="text-slate-600 font-normal">{t.identity.pts}</span>
                              </span>
                              {hasPoints && (
                                <button
                                  onClick={() => distributeStat(stat.id)}
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-black text-xs font-bold transition-all active:scale-90"
                                  style={{
                                    background: stat.color,
                                    boxShadow: `0 0 8px ${stat.color}80`,
                                  }}
                                >
                                  +
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{
                                background: `linear-gradient(90deg, ${stat.color}60, ${stat.color})`,
                                boxShadow: `0 0 6px ${stat.color}55`,
                              }}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.65, delay: i * 0.07, ease: 'easeOut' }}
                            />
                          </div>
                        </motion.div>
                      );
                    })}

                    {/* Total Power footer */}
                    <div className="mt-2 pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                        <Zap size={11} /> {t.dashboard.totalPower}
                      </span>
                      <span className="text-base font-bold text-system-blue font-mono">{totalPower}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* ── CARD 3: Undying Will (Passive) ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <motion.div
            className="relative rounded-2xl overflow-hidden p-5"
            style={{
              background: 'linear-gradient(160deg, rgba(10,4,40,0.99) 0%, rgba(6,3,28,0.99) 100%)',
              border: '1px solid rgba(124,58,237,0.32)',
            }}
            animate={{
              boxShadow: [
                '0 0 18px rgba(124,58,237,0.06), inset 0 0 24px rgba(124,58,237,0.04)',
                '0 0 40px rgba(124,58,237,0.16), inset 0 0 40px rgba(124,58,237,0.08)',
                '0 0 18px rgba(124,58,237,0.06), inset 0 0 24px rgba(124,58,237,0.04)',
              ],
            }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            {/* Corner accents — purple */}
            {(['top-0 left-0 border-t border-l', 'top-0 right-0 border-t border-r', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map((cls, i) => (
              <div key={i} className={`absolute w-3 h-3 ${cls}`} style={{ borderColor: 'rgba(168,85,247,0.45)' }} />
            ))}
            {/* Background ghost shield — pulsa */}
            <motion.div
              className="absolute top-0 right-0 p-3 pointer-events-none select-none text-purple-400"
              animate={{ opacity: [0.03, 0.08, 0.03] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
            >
              <Shield size={110} />
            </motion.div>

            {/* Header row */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[9px] font-garet text-purple-500/50 tracking-widest uppercase mb-0.5">
                  {t.identity.passiveSkill}
                </p>
                <h3 className="text-sm font-garet font-bold text-purple-300 flex items-center gap-2">
                  <Shield size={14} className="text-purple-400" />
                  {t.identity.undyingWill}
                </h3>
              </div>

              {/* Streak badge */}
              <div className="flex flex-col items-center bg-purple-950/40 border border-purple-700/25 rounded-xl px-3 py-2 min-w-[56px]">
                <Zap size={15} className="text-purple-400 mb-0.5" fill="currentColor" />
                <span className="text-xl font-bold font-mono text-purple-200 leading-none">{profile.streakDays}</span>
                <span className="text-[9px] font-garet text-purple-600 uppercase tracking-wider mt-0.5">STREAK</span>
              </div>
            </div>

            {/* Protection bar */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] font-mono mb-1.5">
                <span className="text-slate-500">{t.identity.streakProtection(protection)}</span>
                <span className="text-purple-400 font-bold">{protection}% <span className="text-slate-600 font-normal">{t.identity.maxProtection}</span></span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${(protection / 50) * 100}%`,
                    background: 'linear-gradient(90deg, #7c3aed70, #a855f7)',
                    boxShadow: '0 0 8px #a855f760',
                  }}
                />
              </div>
            </div>

            {/* Footer stats */}
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="flex items-center gap-1.5 text-slate-500">
                <Zap size={10} className="text-purple-500" />
                {t.identity.basedOnPower}:
                <span className="text-purple-400 font-bold">{totalPower}</span>
              </span>
              <span className="text-purple-600">{t.identity.daysRetained(retainedDays)}</span>
            </div>
          </motion.div>
        </motion.div>

        {/* ── CARD 4: Cofre do Sistema ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div
            className="relative rounded-2xl p-5"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: '1px solid rgba(250,204,21,0.18)',
              boxShadow: '0 0 22px rgba(250,204,21,0.04)',
            }}
          >
            <p className="text-[9px] font-garet text-yellow-500/50 tracking-widest uppercase mb-1">
              INVENTÁRIO
            </p>
            <h3 className="text-sm font-garet font-bold text-yellow-300 mb-4">
              Cofre do Sistema
            </h3>

            {(() => {
              const items = (profile.inventory ?? []).filter(i => i.quantity > 0);
              if (items.length === 0) {
                return (
                  <p className="text-[11px] font-mono text-slate-600 text-center py-4">
                    Nenhum item no cofre
                  </p>
                );
              }
              return (
                <div className="space-y-2">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                      style={{
                        background: `${RARITY_COLORS[item.rarity]}08`,
                        border: `1px solid ${RARITY_COLORS[item.rarity]}25`,
                      }}
                    >
                      <img src={item.icon} alt={item.name} className="w-8 h-8 object-contain shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="text-[8px] font-garet tracking-widest border rounded-sm px-1 py-0.5"
                            style={{ color: RARITY_COLORS[item.rarity], borderColor: `${RARITY_COLORS[item.rarity]}40` }}
                          >
                            {RARITY_LABELS[item.rarity]}
                          </span>
                          <span className="text-[11px] font-garet font-bold truncate" style={{ color: RARITY_COLORS[item.rarity] }}>
                            {item.name}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-slate-400 truncate">{item.effect}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-slate-500">×{item.quantity}</span>
                        <button
                          onClick={() => showNotification(item.name, 'Em breve: uso de itens do cofre', 'info')}
                          className="text-[9px] font-garet tracking-widest border rounded px-2 py-1 transition-colors"
                          style={{
                            color: RARITY_COLORS[item.rarity],
                            borderColor: `${RARITY_COLORS[item.rarity]}40`,
                          }}
                        >
                          USAR
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </motion.div>

      </div>
    );
  };

  const renderShadowArmy = () => {
    const soldiers = profile.shadows ?? [];
    const readySoldiers = soldiers.filter(s => s.status === 'Pronta');

    const selectedMission = missionModal?.mission ?? null;
    const selectedIds = missionModal?.selectedIds ?? [];
    const modalShadows = soldiers.filter(s => s.status === 'Pronta');
    const calcChance = (mission: ShadowMission, ids: string[]) => {
      const picked = soldiers.filter(s => ids.includes(s.id));
      const totalPower = picked.reduce((sum, s) => {
        const bonus = s.role === mission.recommendedRole ? 1.2 : 1;
        return sum + s.basePower * bonus;
      }, 0);
      return Math.min(100, Math.round((totalPower / mission.requiredPower) * 100));
    };

    return (
      <div className="space-y-8 animate-fade-in">
        <div className="text-center">
          <h2 className="text-2xl font-bold font-garet text-shadow-purple tracking-widest">{t.shadows.title}</h2>
          <p className="text-slate-400 text-sm">{t.shadows.subtitle}</p>
        </div>

        {/* ── Mission Board ── */}
        <section>
          <h3 className="text-xs font-garet tracking-[0.35em] text-slate-500 mb-4 flex items-center gap-2">
            <Target size={12} className="text-yellow-500" />
            {t.shadows.missionBoardTitle}
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {shadowMissions.map(mission => (
              <motion.div
                key={mission.id}
                className="rounded-lg p-4 relative overflow-hidden"
                style={{
                  background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
                  border: '1px solid rgba(234,179,8,0.25)',
                  boxShadow: '0 0 18px rgba(234,179,8,0.07)',
                }}
                animate={{ boxShadow: ['0 0 10px rgba(234,179,8,0.05)', '0 0 22px rgba(234,179,8,0.13)', '0 0 10px rgba(234,179,8,0.05)'] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                {/* data beam */}
                <motion.div
                  className="absolute top-0 bottom-0 w-8 pointer-events-none"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(234,179,8,0.07), transparent)' }}
                  animate={{ left: ['-5%', '105%'] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear', repeatDelay: 3.5 }}
                />
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-mono font-bold text-sm text-white">{mission.title}</p>
                    <div className="flex flex-wrap gap-3 mt-1 text-[10px] font-mono text-slate-500">
                      <span>⚡ {t.shadows.missionRequiredPower}: <span className="text-yellow-400">{mission.requiredPower}</span></span>
                      <span>🎭 {mission.recommendedRole}</span>
                      <span>⏱ {mission.durationHours}h</span>
                    </div>
                  </div>
                  <div className="text-right text-[10px] font-mono shrink-0">
                    <p className="text-yellow-400">+{mission.rewardGold} Gold</p>
                    <p className="text-blue-400">+{mission.rewardXP} XP</p>
                  </div>
                </div>
                <button
                  disabled={readySoldiers.length === 0}
                  onClick={() => setMissionModal({ mission, selectedIds: [] })}
                  className="w-full py-2 text-xs font-mono font-bold rounded border border-yellow-500/50 text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t.shadows.missionSendBtn}
                </button>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Shadow Soldiers (compact grid) ── */}
        <section>
          <h3 className="text-xs font-garet tracking-[0.35em] text-slate-500 mb-4 flex items-center gap-2">
            <Ghost size={12} className="text-shadow-purple" />
            {t.shadows.soldiersTitle}
            <span className="ml-auto text-shadow-purple font-bold">{soldiers.length}</span>
          </h3>
          {soldiers.length === 0 ? (
            <motion.div
              className="text-center py-14 text-slate-600 rounded-lg"
              style={{
                background: 'linear-gradient(160deg, rgba(6,12,40,0.80) 0%, rgba(3,6,22,0.80) 100%)',
                border: '1px dashed rgba(139,92,246,0.20)',
              }}
              animate={{ boxShadow: ['0 0 6px rgba(139,92,246,0.03)', '0 0 18px rgba(139,92,246,0.09)', '0 0 6px rgba(139,92,246,0.03)'] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Ghost size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{t.shadows.soldiersEmpty}</p>
              <p className="text-xs mt-1 text-slate-700">{t.shadows.soldiersEmptyHint}</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {soldiers.map(s => (
                <ShadowCard
                  key={s.id}
                  shadow={s}
                  onClick={() => setInspectedShadow(s)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Mission Dispatch Modal ── */}
        <AnimatePresence>
          {selectedMission && (
            <motion.div
              className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMissionModal(null)}
            >
              <motion.div
                className="w-full max-w-sm bg-slate-950 border border-yellow-500/30 rounded-xl p-5 shadow-2xl"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                onClick={e => e.stopPropagation()}
              >
                <p className="text-xs font-garet tracking-[0.3em] text-yellow-500 mb-1">{t.shadows.missionSelectTitle}</p>
                <p className="font-mono font-bold text-white mb-1">{selectedMission.title}</p>
                <p className="text-[10px] font-mono text-slate-500 mb-4">{t.shadows.missionSelectHint}</p>

                {modalShadows.length === 0 ? (
                  <p className="text-center text-slate-500 text-sm py-4">{t.shadows.soldiersEmpty}</p>
                ) : (
                  <div className="space-y-2 mb-4 max-h-52 overflow-y-auto">
                    {modalShadows.map(s => {
                      const isSelected = selectedIds.includes(s.id);
                      const color = SHADOW_RANK_COLORS[s.rank];
                      const bonus = s.role === selectedMission.recommendedRole;
                      return (
                        <button
                          key={s.id}
                          onClick={() => {
                            const next = isSelected
                              ? selectedIds.filter(x => x !== s.id)
                              : selectedIds.length < 3 ? [...selectedIds, s.id] : selectedIds;
                            setMissionModal(prev => prev ? { ...prev, selectedIds: next } : null);
                          }}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                            isSelected
                              ? 'border-yellow-400/60 bg-yellow-500/15'
                              : 'border-slate-700/50 bg-slate-900 hover:border-slate-600'
                          }`}
                        >
                          <span className="text-lg leading-none">{ROLE_ICONS[s.role]}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono font-bold text-white truncate">{s.name}</p>
                            <p className="text-[10px] font-mono text-slate-500">⚡ {s.basePower}{bonus ? <span className="text-green-400 ml-1">+20%</span> : null}</p>
                          </div>
                          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ color, borderColor: `${color}55`, background: `${color}18` }}>
                            {s.rank}
                          </span>
                          {isSelected && <span className="text-yellow-400 text-xs">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedIds.length > 0 && (
                  <div className="text-center text-xs font-mono text-slate-400 mb-3">
                    {t.shadows.missionSuccessChance(calcChance(selectedMission, selectedIds))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setMissionModal(null)}
                    className="flex-1 py-2.5 rounded border border-slate-700 text-slate-400 text-xs font-mono hover:border-slate-500 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={selectedIds.length === 0}
                    onClick={sendOnMission}
                    className="flex-1 py-2.5 rounded border-2 border-yellow-400 text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 text-xs font-mono font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t.shadows.missionConfirmBtn}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderShop = () => (
    <div className="space-y-6 animate-slide-up">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold font-garet text-yellow-500 tracking-widest">{t.shop.title}</h2>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-slate-400 text-sm">{t.shop.subtitle}</span>
          <div className="flex items-center gap-1 text-yellow-400 font-mono bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-700/50 text-xs">
            <Coins size={12} />
            <span>{profile.gold}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {localizedRewards.map((item, idx) => (
          <motion.div
            key={item.id}
            className="p-4 rounded-lg flex flex-col justify-between group relative overflow-hidden"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: '1px solid rgba(234,179,8,0.22)',
            }}
            animate={{ boxShadow: ['0 0 8px rgba(234,179,8,0.04)', '0 0 20px rgba(234,179,8,0.12)', '0 0 8px rgba(234,179,8,0.04)'] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: idx * 0.4 }}
            whileHover={{ scale: 1.02 }}
          >
            {/* corner accents */}
            {[['top-1.5 left-1.5', true, true, false, false], ['top-1.5 right-1.5', true, false, false, true], ['bottom-1.5 left-1.5', false, true, true, false], ['bottom-1.5 right-1.5', false, false, true, true]].map(([pos, bT, bL, bB, bR], i) => (
              <div key={i} className={`absolute ${pos} w-3 h-3 pointer-events-none`} style={{ borderTop: bT ? '1px solid rgba(234,179,8,0.45)' : undefined, borderLeft: bL ? '1px solid rgba(234,179,8,0.45)' : undefined, borderBottom: bB ? '1px solid rgba(234,179,8,0.45)' : undefined, borderRight: bR ? '1px solid rgba(234,179,8,0.45)' : undefined }} />
            ))}
            <div className="text-center mb-4">
              <div className="text-4xl mb-2 group-hover:scale-110 transition-transform duration-300">{item.icon}</div>
              <h3 className="font-bold text-white leading-tight">{item.name}</h3>
              <p className="text-[10px] text-slate-500 mt-1">{item.description}</p>
            </div>
            <button
              onClick={() => buyItem(item)}
              className="w-full py-2 bg-slate-800 border border-slate-700 rounded text-yellow-500 font-mono text-sm font-bold hover:bg-yellow-500 hover:text-black transition-colors active:scale-95 flex items-center justify-center gap-1"
            >
              <Coins size={12} /> {item.cost}
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );

  const renderMissions = () => {
    const activeBosses = bossFights
      .filter(b => b.status === 'active')
      .sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    const completedBosses = bossFights.filter(b => b.status === 'completed');
    const completedHabits = habits.filter(h => h.isCompleted);

    return (
      <div className="space-y-8 animate-slide-up">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold font-garet text-white tracking-widest">{t.missions.title}</h2>
        </div>

        {/* ── CHEFÕES ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-purple-900/50 pb-2">
            <h3 className="text-purple-400 font-garet text-sm font-bold flex items-center gap-2">
              ⚔️ {t.missions.bossHeader}
            </h3>
            <button
              onClick={() => setShowAddBossForm(v => !v)}
              className="flex items-center gap-1 text-xs font-garet text-purple-400 hover:text-white border border-purple-500/50 hover:border-purple-400 px-2 py-1 rounded transition-all"
            >
              <Plus size={12} /> {t.missions.newBoss}
            </button>
          </div>

          {/* New boss form */}
          {showAddBossForm && (
            <div
              className="rounded-lg p-4 space-y-3 animate-fade-in"
              style={{
                background: 'linear-gradient(160deg, rgba(10,4,40,0.99) 0%, rgba(6,3,28,0.99) 100%)',
                border: '1px solid rgba(168,85,247,0.35)',
                boxShadow: '0 0 20px rgba(168,85,247,0.10), inset 0 0 16px rgba(168,85,247,0.04)',
              }}
            >
              <p className="text-[10px] font-garet text-purple-400 font-bold tracking-widest">⚔️ {t.missions.bossFormTitle}</p>
              <input
                type="text"
                value={newBossTitle}
                onChange={e => setNewBossTitle(e.target.value)}
                placeholder={t.missions.bossFormTitlePlaceholder}
                className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-white font-mono text-sm outline-none focus:border-purple-500"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && addNewBossSubTask()}
              />
              <input
                type="text"
                value={newBossDesc}
                onChange={e => setNewBossDesc(e.target.value)}
                placeholder={t.missions.bossFormDescPlaceholder}
                className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-white font-mono text-sm outline-none focus:border-purple-500"
              />
              <div>
                <label className="text-[10px] font-mono text-slate-400 block mb-1">{t.missions.bossFormDueDateLabel}</label>
                <input
                  type="date"
                  value={newBossDueDate}
                  onChange={e => setNewBossDueDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 p-1.5 rounded text-white font-mono text-xs outline-none focus:border-purple-500"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-slate-500">{t.missions.bossFormSubTaskHint}</p>
                {newBossSubTasks.map(st => (
                  <div key={st.id} className="flex items-center gap-2">
                    <span className="text-purple-400 text-xs shrink-0">◆</span>
                    <span className="flex-1 text-xs text-slate-300">{st.title}</span>
                    <button onClick={() => setNewBossSubTasks(prev => prev.filter(s => s.id !== st.id))} className="text-slate-600 hover:text-red-500 transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBossSubInput}
                    onChange={e => setNewBossSubInput(e.target.value)}
                    placeholder={t.missions.bossAddSubTask}
                    className="flex-1 bg-slate-800 border border-slate-700 p-1.5 rounded text-white font-mono text-xs outline-none focus:border-purple-500"
                    onKeyDown={e => e.key === 'Enter' && addNewBossSubTask()}
                  />
                  <button onClick={addNewBossSubTask} className="px-2 bg-purple-600/20 border border-purple-500/50 text-purple-400 hover:bg-purple-600/40 rounded transition-all">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
              <p className="text-[10px] font-mono text-slate-500">⚡ Recompensas: 150–300 XP · 60–100 Gold (automático)</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowAddBossForm(false); setNewBossTitle(''); setNewBossDesc(''); setNewBossDueDate(''); setNewBossSubTasks([]); setNewBossSubInput(''); }}
                  className="flex-1 py-2 border border-slate-700 text-slate-400 hover:text-white rounded font-mono text-xs transition-colors"
                >
                  {t.upload.cancel}
                </button>
                <button
                  onClick={createBoss}
                  disabled={!newBossTitle.trim()}
                  className="flex-1 py-2 bg-purple-600/30 border border-purple-500 text-purple-300 hover:bg-purple-600/50 rounded font-mono text-xs font-bold transition-all disabled:opacity-40"
                >
                  ⚔️ {t.missions.bossFormCreate}
                </button>
              </div>
            </div>
          )}

          {activeBosses.length === 0 && !showAddBossForm && (
            <div className="text-center py-10 text-slate-600 border border-dashed border-slate-800 rounded-lg">
              <p className="font-mono text-sm">{t.missions.bossEmpty}</p>
              <p className="text-xs mt-1">{t.missions.bossEmptyHint}</p>
            </div>
          )}

          <div className="space-y-4">
            {activeBosses.map(boss => {
                const isExpired = !!boss.dueDate && getDaysUntil(boss.dueDate) < 0;
                const daysLeft = boss.dueDate ? getDaysUntil(boss.dueDate) : null;
                const allDone = boss.subTasks.length === 0 || boss.subTasks.every(s => s.completed);
                const isCollapsed = !expandedBossIds.has(boss.id);
                const toggleCollapse = () => setExpandedBossIds(prev => {
                  const next = new Set(prev);
                  next.has(boss.id) ? next.delete(boss.id) : next.add(boss.id);
                  return next;
                });
                return (
                  <div
                    key={boss.id}
                    className="relative overflow-hidden rounded-lg"
                    style={{
                      background: 'linear-gradient(160deg, rgba(10,4,40,0.99) 0%, rgba(6,3,28,0.99) 100%)',
                      border: isExpired ? '1px solid rgba(239,68,68,0.50)' : '1px solid rgba(168,85,247,0.50)',
                      boxShadow: isExpired
                        ? '0 0 0 1px rgba(239,68,68,0.06), 0 0 28px rgba(239,68,68,0.14), inset 0 0 24px rgba(239,68,68,0.04)'
                        : '0 0 0 1px rgba(168,85,247,0.06), 0 0 28px rgba(168,85,247,0.14), inset 0 0 24px rgba(168,85,247,0.04)',
                    }}
                  >
                    {/* Corner accents */}
                    {(['top-0 left-0 border-t border-l', 'top-0 right-0 border-t border-r', 'bottom-0 left-0 border-b border-l', 'bottom-0 right-0 border-b border-r'] as const).map((cls, i) => (
                      <div key={i} className={`absolute w-2.5 h-2.5 ${cls}`} style={{ borderColor: isExpired ? 'rgba(239,68,68,0.40)' : 'rgba(168,85,247,0.40)' }} />
                    ))}
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-purple-500 to-transparent" />

                    {/* ── Header (always visible) ── */}
                    <button
                      onClick={toggleCollapse}
                      className="w-full p-4 flex items-center gap-3 text-left"
                    >
                      <span className="text-purple-400 text-xs shrink-0 transition-transform duration-200" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-purple-200 font-garet font-bold text-sm leading-snug truncate">
                          ⚔️ {boss.title.toUpperCase()}
                        </h4>
                        {/* Summary: date + progress — only when collapsed */}
                        {isCollapsed && <>
                          <div className="flex items-center gap-3 mt-1.5">
                            {boss.dueDate && (
                              <span className={`text-[10px] font-mono font-bold ${isExpired ? 'text-red-400' : daysLeft !== null && daysLeft <= 3 ? 'text-yellow-400' : 'text-slate-500'}`}>
                                {isExpired ? `⚠️ expirado há ${Math.abs(daysLeft!)}d` : `📅 ${formatBRDate(boss.dueDate)} (${daysLeft}d)`}
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-purple-400 font-bold ml-auto">{boss.progress}%</span>
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-1 mt-1">
                            <div
                              className="h-1 rounded-full bg-gradient-to-r from-purple-700 to-purple-400 transition-all duration-500"
                              style={{ width: `${boss.progress}%` }}
                            />
                          </div>
                        </>}
                      </div>
                      {isExpired ? (
                        <span className="text-[9px] font-garet font-bold px-2 py-1 bg-red-500/20 border border-red-500 text-red-400 rounded shrink-0 animate-pulse">
                          ⚠️ {t.missions.bossExpired}
                        </span>
                      ) : (
                        <span className="text-[9px] font-garet px-2 py-1 bg-purple-500/15 border border-purple-500/40 text-purple-300 rounded shrink-0">
                          {t.missions.bossActive}
                        </span>
                      )}
                    </button>

                    {/* ── Expanded body ── */}
                    {!isCollapsed && <div className="px-4 pb-4 space-y-4 border-t border-purple-500/20 pt-3">
                      {/* Description */}
                      {boss.description && <p className="text-slate-400 text-xs">{boss.description}</p>}

                      {/* Deadline (full detail) */}
                      {boss.dueDate && (
                        <p className={`text-xs font-mono font-bold ${isExpired ? 'text-red-400' : daysLeft !== null && daysLeft <= 3 ? 'text-yellow-400' : 'text-slate-400'}`}>
                          {isExpired
                            ? `⚠️ Prazo expirou há ${Math.abs(daysLeft!)}d`
                            : `📅 ${formatBRDate(boss.dueDate)} (${daysLeft}d restantes)`}
                        </p>
                      )}

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-[10px] font-mono text-slate-400">{t.missions.bossProgress}</span>
                          <span className="text-[10px] font-mono text-purple-300 font-bold">{boss.progress}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-purple-700 to-purple-400 transition-all duration-500"
                            style={{ width: `${boss.progress}%` }}
                          />
                        </div>
                      </div>

                      {/* Rewards */}
                      <div className="flex gap-4 text-[11px] font-mono font-bold">
                        <span className="text-yellow-400">+{boss.xpReward} XP</span>
                        <span className="text-amber-400">+{boss.goldReward} Gold</span>
                      </div>

                      {/* Sub-tasks with drag / edit / delete */}
                      {boss.subTasks.length > 0 && (
                        <div className="space-y-0.5">
                          {boss.subTasks.map(st => {
                            const editKey = `${boss.id}::${st.id}`;
                            const isEditing = editingSubTaskId === editKey;
                            const isDragging = dragState?.bossId === boss.id && dragState?.subTaskId === st.id;
                            const isDragOver = dragOverId === st.id && dragState?.bossId === boss.id && !isDragging;
                            return (
                              <div
                                key={st.id}
                                draggable={!isEditing}
                                onDragStart={() => handleDragStart(boss.id, st.id)}
                                onDragOver={e => handleDragOver(e, st.id)}
                                onDrop={() => handleDrop(boss.id, st.id)}
                                onDragEnd={handleDragEnd}
                                className={`flex items-center gap-2 group rounded-md px-1.5 py-1 transition-all duration-150 select-none
                                  ${isDragging ? 'opacity-30 scale-95' : 'opacity-100'}
                                  ${isDragOver ? 'border-t-2 border-purple-400 bg-purple-950/40' : 'border-t-2 border-transparent'}
                                  hover:bg-purple-950/40
                                `}
                              >
                                {/* Drag handle */}
                                <span className="text-[10px] text-slate-600 cursor-grab shrink-0 opacity-0 group-hover:opacity-100 transition-opacity leading-none">⋮⋮</span>

                                {/* Checkbox */}
                                <button
                                  onClick={() => !isEditing && toggleBossSubTask(boss.id, st.id)}
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all
                                    ${st.completed ? 'bg-purple-600 border-purple-500 text-white' : 'border-slate-600 hover:border-purple-400'}`}
                                >
                                  {st.completed && <Check size={10} />}
                                </button>

                                {/* Title or edit input */}
                                {isEditing ? (
                                  <input
                                    autoFocus
                                    value={editingSubTaskText}
                                    onChange={e => setEditingSubTaskText(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') confirmEditSubTask(boss.id, st.id);
                                      if (e.key === 'Escape') setEditingSubTaskId(null);
                                    }}
                                    onBlur={() => confirmEditSubTask(boss.id, st.id)}
                                    className="flex-1 bg-slate-700/80 border border-purple-500 rounded px-2 py-0.5 text-sm text-white font-mono outline-none"
                                  />
                                ) : (
                                  <span
                                    onDoubleClick={() => startEditSubTask(boss.id, st)}
                                    className={`flex-1 text-sm ${st.completed ? 'line-through text-slate-500' : 'text-slate-300 group-hover:text-white'}`}
                                  >
                                    {st.title}
                                  </span>
                                )}

                                {/* Edit / Delete icons (hover only) */}
                                {!isEditing && (
                                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button onClick={() => startEditSubTask(boss.id, st)} className="text-slate-600 hover:text-purple-400 transition-colors p-0.5">
                                      <Edit3 size={11} />
                                    </button>
                                    <button onClick={() => deleteBossSubTask(boss.id, st.id)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* History */}
                      {boss.history.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/60 space-y-1.5">
                          <p className="text-[10px] font-garet text-slate-500 font-bold tracking-wider">📋 {t.missions.bossHistoryTitle}</p>
                          <div className="space-y-1">
                            {boss.history.map((entry, idx) => {
                              const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              const isLast = idx === boss.history.length - 1;
                              return (
                                <div key={entry.id} className="flex items-start gap-1.5 text-[10px] font-mono">
                                  <span className="text-slate-700 shrink-0 leading-4">{isLast ? '└─' : '├─'}</span>
                                  <span className={`shrink-0 leading-4 ${
                                    entry.action === 'started' ? 'text-purple-500/80' :
                                    entry.action === 'completed' ? 'text-green-500/80' : 'text-yellow-500/80'
                                  }`}>{time}</span>
                                  <span className="text-slate-500 leading-4">
                                    {entry.action === 'started' && t.missions.bossHistoryStarted}
                                    {entry.action === 'completed' && t.missions.bossHistoryCompleted(entry.subTaskTitle || '')}
                                    {entry.action === 'uncompleted' && t.missions.bossHistoryUncompleted(entry.subTaskTitle || '')}
                                  </span>
                                </div>
                              );
                            })}
                            <div className="flex items-start gap-1.5 text-[10px] font-mono">
                              <span className="text-slate-700 shrink-0 leading-4">└─</span>
                              <span className="text-slate-600 leading-4 italic">{t.missions.bossHistoryAwaiting}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Add sub-task inline */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={bossNewSubInputs[boss.id] || ''}
                          onChange={e => setBossNewSubInputs(prev => ({ ...prev, [boss.id]: e.target.value }))}
                          placeholder={t.missions.bossAddSubTask}
                          className="flex-1 bg-slate-800 border border-slate-700 p-1.5 rounded text-white font-mono text-xs outline-none focus:border-purple-500"
                          onKeyDown={e => e.key === 'Enter' && addBossSubTask(boss.id)}
                        />
                        <button onClick={() => addBossSubTask(boss.id)}
                          className="px-2 bg-purple-600/20 border border-purple-500/50 text-purple-400 hover:bg-purple-600/40 rounded transition-all">
                          <Plus size={13} />
                        </button>
                      </div>

                      {/* Expired: penalty or abandon */}
                      {isExpired && (
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => applyBossPenalty(boss.id)}
                            className="flex-1 py-2 bg-red-500/20 border border-red-500 text-red-400 hover:bg-red-500/30 rounded font-mono text-xs font-bold transition-all">
                            ⚠️ {t.missions.bossApplyPenalty} (-7d streak)
                          </button>
                          <button onClick={() => cancelBossFight(boss.id)}
                            className="flex-1 py-2 bg-slate-800 border border-slate-600 text-slate-400 hover:text-white rounded font-mono text-xs transition-all">
                            {t.missions.bossAbandon}
                          </button>
                        </div>
                      )}

                      {/* Active: complete + cancel */}
                      {!isExpired && (
                        <div className="flex gap-2 pt-1">
                          {allDone && (
                            <button onClick={() => completeBossFight(boss.id)}
                              className="flex-1 py-2.5 bg-purple-600/40 border-2 border-purple-400 text-purple-100 hover:bg-purple-600/60 rounded font-mono text-xs font-bold transition-all shadow-[0_0_12px_rgba(168,85,247,0.4)]">
                              ⚔️ {t.missions.bossComplete}
                            </button>
                          )}
                          {confirmCancelBossId === boss.id ? (
                            <>
                              <button onClick={() => cancelBossFight(boss.id)}
                                className="flex-1 py-2 bg-red-500/20 border border-red-500 text-red-400 rounded font-mono text-xs font-bold">
                                {t.missions.confirm}
                              </button>
                              <button onClick={() => setConfirmCancelBossId(null)}
                                className="py-2 px-3 bg-slate-800 border border-slate-600 text-slate-400 rounded font-mono text-xs">
                                ✕
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmCancelBossId(boss.id)}
                              className={`${allDone ? '' : 'flex-1'} py-2 bg-slate-800/50 border border-slate-700 text-slate-500 hover:text-slate-300 rounded font-mono text-xs transition-all`}>
                              {t.missions.bossCancel}
                            </button>
                          )}
                        </div>
                      )}
                    </div>}
                  </div>
                );
              })}
          </div>
        </section>

        {/* ── TAREFAS ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-green-900/40 pb-2">
            <h3 className="text-system-blue font-garet text-sm font-bold flex items-center gap-2">
              <Sword size={15} /> {t.missions.tasksHeader}
            </h3>
            <button
              onClick={() => setShowAddTaskForm(v => !v)}
              className="flex items-center gap-1 text-xs font-garet text-system-blue hover:text-white border border-system-blue/50 hover:border-system-blue px-2 py-1 rounded transition-all"
            >
              <Plus size={12} /> {t.missions.addTask}
            </button>
          </div>

          {/* ── Add task form ── */}
          {showAddTaskForm && (
            <div className="bg-slate-900/80 border border-system-blue/25 rounded-lg p-4 space-y-3 animate-fade-in">
              <input
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder={t.missions.taskTitlePlaceholder}
                className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-white font-mono text-sm outline-none focus:border-system-blue"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && addTask()}
              />

              {/* Repeat pattern — recurring vs one-time */}
              <div className="space-y-2">
                <div>
                  <p className="text-[9px] font-garet text-slate-500 tracking-widest mb-1.5">⚡ HÁBITO RECORRENTE</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {(['daily', 'weekdays', 'custom'] as RepeatType[]).map(r => {
                      const labels: Record<string, string> = {
                        daily: `🔄 ${t.missions.repeatDaily}`,
                        weekdays: `📅 ${t.missions.repeatWeekdays}`,
                        custom: `🗓️ ${t.missions.repeatCustom}`,
                      };
                      return (
                        <button
                          key={r}
                          onClick={() => setNewTaskRepeat(r)}
                          className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border transition-all ${
                            newTaskRepeat === r
                              ? 'bg-system-blue/20 border-system-blue text-system-blue'
                              : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {labels[r]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-garet text-amber-600/70 tracking-widest mb-1.5">📌 TAREFA PONTUAL <span className="text-slate-600 normal-case">(não conta para streak)</span></p>
                  <button
                    onClick={() => setNewTaskRepeat('oneTime')}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border transition-all ${
                      newTaskRepeat === 'oneTime'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                        : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    ⭐ {t.missions.repeatOneTime}
                  </button>
                </div>
              </div>

              {/* Custom day selector */}
              {newTaskRepeat === 'custom' && (
                <div className="flex gap-1.5 justify-center pt-1">
                  {t.missions.repeatDayLabels.map((label, idx) => (
                    <button
                      key={idx}
                      onClick={() => toggleTaskDay(idx)}
                      className={`w-8 h-8 rounded-full text-[11px] font-mono font-bold border transition-all ${
                        newTaskDays.includes(idx)
                          ? 'bg-system-blue border-system-blue text-black'
                          : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-system-blue/50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowAddTaskForm(false); setNewTaskTitle(''); setNewTaskRepeat('daily'); }}
                  className="flex-1 py-2 border border-slate-700 text-slate-400 hover:text-white rounded font-mono text-xs transition-colors"
                >
                  {t.upload.cancel}
                </button>
                <button
                  onClick={addTask}
                  disabled={!newTaskTitle.trim() || (newTaskRepeat === 'custom' && newTaskDays.length === 0)}
                  className="flex-1 py-2 bg-system-blue/20 border border-system-blue text-system-blue hover:bg-system-blue/40 rounded font-mono text-xs font-bold transition-all disabled:opacity-40"
                >
                  {t.missions.addTask}
                </button>
              </div>
            </div>
          )}

          {/* Task list */}
          {habits.length === 0 ? (
            <div className="text-center py-8 text-slate-600 border border-dashed border-slate-800 rounded-lg">
              <p className="font-mono text-sm">{t.missions.noTasks}</p>
              <p className="text-xs mt-1">{t.missions.noTasksHint}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {habits.map(habit => {
                const active = isTodayActive(habit);
                return (
                  <div
                    key={habit.id}
                    className="p-3 rounded-lg flex items-center gap-3 transition-all duration-200"
                    style={{
                      background: !active
                        ? 'rgba(6,8,20,0.60)'
                        : habit.isCompleted
                          ? 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)'
                          : 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
                      border: !active
                        ? '1px solid rgba(30,41,59,0.50)'
                        : habit.isCompleted
                          ? '1px solid rgba(34,197,94,0.25)'
                          : '1px solid rgba(59,130,246,0.25)',
                      boxShadow: !active
                        ? 'none'
                        : habit.isCompleted
                          ? 'inset 3px 0 0 rgba(34,197,94,0.50)'
                          : 'inset 3px 0 0 rgba(59,130,246,0.50)',
                      opacity: !active ? 0.45 : 1,
                    }}
                  >
                    {/* Mission icon */}
                    <div className="p-1.5 rounded-full shrink-0 bg-system-blue/15 text-system-blue">
                      <Sword size={13} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {editingHabitId === habit.id ? (
                        <input
                          autoFocus
                          value={editingHabitTitle}
                          onChange={e => setEditingHabitTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveHabitTitle(habit.id); if (e.key === 'Escape') setEditingHabitId(null); }}
                          onBlur={() => saveHabitTitle(habit.id)}
                          className="w-full bg-slate-800 border border-system-blue/50 rounded px-2 py-0.5 text-white text-sm font-bold outline-none"
                        />
                      ) : (
                        <p className={`font-bold text-sm leading-tight ${habit.isCompleted ? 'line-through text-slate-500' : 'text-white'}`}>
                          {habit.title}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-500">{getRepeatLabel(habit)}</span>
                        {!active && (
                          <span className="text-[10px] font-mono text-slate-600">· {t.missions.notScheduledToday}</span>
                        )}
                      </div>
                    </div>

                    {/* Right: streak + delete + toggle */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {habit.streak > 0 && (
                        <span className="text-[10px] font-mono text-yellow-500 flex items-center gap-0.5">
                          <Zap size={9} fill="currentColor" />{habit.streak}
                        </span>
                      )}
                      {!habit.isCompleted && editingHabitId !== habit.id && (
                        <button onClick={() => { setEditingHabitId(habit.id); setEditingHabitTitle(habit.title); }} className="text-slate-700 hover:text-system-blue transition-colors p-0.5">
                          <Edit3 size={12} />
                        </button>
                      )}
                      {confirmDeleteHabitId === habit.id ? (
                        <>
                          <button
                            onClick={() => deleteHabit(habit.id)}
                            className="text-[10px] px-1.5 py-0.5 bg-red-500/20 border border-red-500 text-red-400 rounded font-mono hover:bg-red-500/40"
                          >
                            {t.missions.confirm}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteHabitId(null)}
                            className="text-[10px] px-1.5 py-0.5 bg-slate-800 border border-slate-600 text-slate-400 rounded font-mono hover:text-white"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleDeleteHabitRequest(habit.id)} className="text-slate-700 hover:text-red-500 transition-colors p-0.5">
                          <Trash2 size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => toggleHabit(habit.id)}
                        className={`w-8 h-8 rounded border flex items-center justify-center transition-all
                          ${habit.isCompleted
                            ? 'bg-system-blue/20 border-system-blue/50 text-system-blue hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400'
                            : 'bg-slate-950 border-slate-700 hover:border-system-blue hover:text-system-blue text-slate-500'}
                        `}
                      >
                        {habit.isCompleted ? <Check size={15} /> : <div className="w-3 h-3 rounded-sm border border-current" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── MISSÕES BÔNUS ── */}
        {(() => {
          const today = toDateStr(new Date());
          const todaysMissions = bonusMissions.filter(m => m.generatedDate === today);
          const alreadyGenerated = todaysMissions.length > 0;
          return (
            <section className="space-y-3">
              <div className="flex items-center justify-between border-b border-yellow-900/40 pb-2">
                <h3 className="text-yellow-400 font-garet text-sm font-bold flex items-center gap-2">
                  {t.missions.bonusMissionsHeader}
                </h3>
                {alreadyGenerated && (
                  <span className="text-[10px] font-mono text-yellow-600/70">{t.missions.bonusMissionsAlreadyGenerated}</span>
                )}
              </div>
              {todaysMissions.length === 0 ? (
                <p className="text-[11px] font-mono text-slate-600 text-center py-3">
                  {t.missions.bonusMissionsWaiting}
                </p>
              ) : (
                <div className="space-y-2">
                  {todaysMissions.map(m => (
                    <div
                      key={m.id}
                      className="p-3 rounded-lg flex items-center gap-3 transition-all duration-200"
                      style={{
                        background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
                        border: m.isCompleted ? '1px solid rgba(161,120,0,0.20)' : '1px solid rgba(234,179,8,0.35)',
                        boxShadow: m.isCompleted
                          ? 'none'
                          : '0 0 14px rgba(234,179,8,0.08), inset 3px 0 0 rgba(234,179,8,0.45)',
                        opacity: m.isCompleted ? 0.55 : 1,
                      }}
                    >
                      <div className="p-1.5 rounded-full shrink-0 bg-yellow-500/15 text-yellow-400">
                        <Zap size={13} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-sm leading-tight ${m.isCompleted ? 'line-through text-slate-500' : 'text-yellow-100'}`}>
                          {m.title}
                        </p>
                        {m.description && !m.isCompleted && (
                          <p className="text-[11px] text-yellow-200/50 mt-0.5 leading-snug">{m.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] font-mono text-yellow-600/70">+{m.rewardXp} XP · +{m.rewardGold} Gold</span>
                          {(() => {
                            const now = new Date();
                            const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
                            const ms = midnight.getTime() - now.getTime();
                            const h = Math.floor(ms / 3600000);
                            const min = Math.floor((ms % 3600000) / 60000);
                            return <span className="text-[10px] font-mono text-slate-500">⏳ {h}h {min}min</span>;
                          })()}
                        </div>
                      </div>
                      {!m.isCompleted && (
                        <button
                          onClick={() => completeBonusMission(m.id)}
                          className="shrink-0 px-2.5 py-1.5 rounded border border-yellow-600/60 bg-yellow-600/15 text-yellow-400 text-[10px] font-mono font-bold hover:bg-yellow-600/30 transition-all"
                        >
                          {t.missions.bonusMissionCompleteBtn}
                        </button>
                      )}
                      {m.isCompleted && (
                        <Check size={16} className="text-yellow-600/70 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })()}

        {/* ── ACTIVITY LOG ── */}
        {(completedHabits.length > 0 || completedBosses.length > 0) && (
          <section
            className="space-y-3 p-4 rounded-xl"
            style={{
              background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
              border: '1px solid rgba(59,130,246,0.15)',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.04), inset 0 0 20px rgba(59,130,246,0.03)',
            }}
          >
            <h3 className="text-slate-500 font-garet text-sm font-bold flex items-center gap-2 border-b border-slate-700/40 pb-2">
              📋 {t.missions.activityHeader}
            </h3>

            {completedHabits.length > 0 && (
              <div>
                <p className="text-[10px] font-garet text-slate-600 mb-2 tracking-wider">{t.missions.activityHabitsTitle}</p>
                <div className="space-y-1.5">
                  {completedHabits.map(h => (
                    <div key={h.id} className="flex items-center gap-2 text-xs font-mono text-slate-500 bg-slate-900/50 rounded px-3 py-1.5 border border-slate-800">
                      <Check size={11} className="text-system-blue shrink-0" />
                      <span className="line-through flex-1">{h.title}</span>
                      <span className="text-yellow-600/70 flex items-center gap-0.5 shrink-0"><Zap size={9} fill="currentColor" />{h.streak}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {completedBosses.length > 0 && (
              <div>
                <p className="text-[10px] font-garet text-slate-600 mb-2 tracking-wider">{t.missions.activityBossTitle}</p>
                <div className="space-y-1.5">
                  {completedBosses.map(b => (
                    <div key={b.id} className="flex items-center gap-2 text-xs font-mono text-slate-500 bg-purple-950/20 rounded px-3 py-1.5 border border-purple-900/40">
                      <span className="text-purple-400 shrink-0">⚔️</span>
                      <span className="flex-1 line-through">{b.title}</span>
                      <span className="text-yellow-500/70 shrink-0">+{b.xpReward} XP</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    );
  };

  const renderSettings = () => (
    <div className="space-y-6 animate-slide-up">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold font-garet text-system-blue tracking-widest">{t.settings.title}</h2>
        <p className="text-slate-400 text-sm">{t.settings.subtitle}</p>
      </div>

      {/* Custom Stats CRUD */}
      <motion.div
        className="p-4 rounded-lg relative overflow-hidden"
        style={{
          background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
          border: '1px solid rgba(59,130,246,0.28)',
          boxShadow: '0 0 14px rgba(59,130,246,0.07)',
        }}
        animate={{ boxShadow: ['0 0 8px rgba(59,130,246,0.05)', '0 0 22px rgba(59,130,246,0.13)', '0 0 8px rgba(59,130,246,0.05)'] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* data beam */}
        <motion.div
          className="absolute top-0 bottom-0 w-8 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.07), transparent)' }}
          animate={{ left: ['-5%', '105%'] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear', repeatDelay: 4 }}
        />
        <h3 className="text-system-blue font-garet text-sm mb-2 border-b border-slate-800 pb-2 flex items-center gap-2">
          <Activity size={16} /> {t.settings.statsSection}
        </h3>
        <p className="text-slate-400 text-xs mb-4">{t.settings.statsDesc}</p>

        <div className="space-y-2 mb-4">
          {profile.customStats.map(stat => (
            <div key={stat.id} className="flex items-center gap-3 p-2 bg-slate-900/50 rounded border border-slate-800">
              <span className="text-lg w-6 text-center">{stat.emoji}</span>
              <span className="flex-1 font-mono text-sm font-bold" style={{ color: stat.color }}>{stat.name}</span>
              <span className="text-sm font-mono text-slate-400 w-8 text-right">{stat.value}</span>
              {confirmDeleteStatId === stat.id ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteStat(stat.id)}
                    className="text-xs px-2 py-1 bg-red-500/20 border border-red-500 text-red-400 rounded font-mono hover:bg-red-500/40 transition-colors"
                  >
                    {t.settings.confirm}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteStatId(null)}
                    className="text-xs px-2 py-1 bg-slate-800 border border-slate-600 text-slate-400 rounded font-mono hover:text-white transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleDeleteStatRequest(stat.id)}
                  className="text-slate-600 hover:text-red-500 transition-colors p-1"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newStatEmoji}
            onChange={(e) => setNewStatEmoji(e.target.value)}
            placeholder={t.settings.statEmojiPlaceholder}
            className="w-14 bg-slate-900 border border-slate-700 p-2 rounded text-white text-center outline-none focus:border-system-blue font-mono"
            maxLength={2}
          />
          <input
            type="text"
            value={newStatName}
            onChange={(e) => setNewStatName(e.target.value)}
            placeholder={t.settings.statNamePlaceholder}
            className="flex-1 bg-slate-900 border border-slate-700 p-2 rounded text-white outline-none focus:border-system-blue font-mono text-sm"
            onKeyDown={(e) => e.key === 'Enter' && addCustomStat()}
          />
          <button
            onClick={addCustomStat}
            className="bg-system-blue/20 hover:bg-system-blue/40 border border-system-blue text-system-blue px-3 rounded font-mono text-sm transition-all"
          >
            <Plus size={16} />
          </button>
        </div>

        {profile.customStats.length <= 1 && (
          <p className="text-red-400 text-xs mt-2 font-mono">{t.settings.minStatWarning}</p>
        )}
      </motion.div>

      {/* Language */}
      <motion.div
        className="p-4 rounded-lg"
        style={{
          background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
          border: '1px solid rgba(59,130,246,0.28)',
        }}
        animate={{ boxShadow: ['0 0 6px rgba(59,130,246,0.04)', '0 0 18px rgba(59,130,246,0.10)', '0 0 6px rgba(59,130,246,0.04)'] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
      >
        <h3 className="text-system-blue font-garet text-sm mb-2 border-b border-slate-800 pb-2 flex items-center gap-2">
          <Globe size={16} /> {t.settings.languageSection}
        </h3>
        <p className="text-slate-400 text-xs mb-4">{t.settings.languageDesc}</p>
        <div className="flex gap-3">
          <button
            onClick={() => setLanguage('pt-BR')}
            className={`flex-1 py-3 rounded border font-mono font-bold transition-all ${language === 'pt-BR' ? 'bg-system-blue text-black border-system-blue' : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-system-blue hover:text-white'}`}
          >
            🇧🇷 Português (BR)
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`flex-1 py-3 rounded border font-mono font-bold transition-all ${language === 'en' ? 'bg-system-blue text-black border-system-blue' : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-system-blue hover:text-white'}`}
          >
            🇺🇸 English
          </button>
        </div>
      </motion.div>

      {/* Dev Panel — admin only */}
      {isAdmin && (
        <DevPanel
          profile={profile}
          onAddXp={(amt) => addXp(amt)}
          onResetXp={() => setProfile(prev => ({ ...prev, currentXp: 0, rank: HunterRank.E }))}
          onAddGold={addGold}
          onAddStreak={(days) => setProfile(prev => ({ ...prev, streakDays: Math.max(0, prev.streakDays + days) }))}
          onAddStatPoints={(pts) => setProfile(prev => ({ ...prev, availableStatPoints: (prev.availableStatPoints ?? 0) + pts }))}
          onTriggerDailyReward={() => enqueueAnim({ kind: 'daily' })}
          onForceRank={handleForceRank}
          onSetStatValue={handleSetStatValue}
        />
      )}

      {/* Notifications */}
      {'Notification' in window && (
        <motion.div
          className="p-4 rounded-lg"
          style={{
            background: 'linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)',
            border: '1px solid rgba(59,130,246,0.28)',
          }}
          animate={{ boxShadow: ['0 0 6px rgba(59,130,246,0.04)', '0 0 18px rgba(59,130,246,0.10)', '0 0 6px rgba(59,130,246,0.04)'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1.2 }}
        >
          <h3 className="text-system-blue font-garet text-sm mb-2 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Bell size={16} /> {t.settings.notificationsSection}
          </h3>
          <p className="text-slate-400 text-xs mb-4">{t.settings.notificationsDesc}</p>
          {notifPermission === 'denied' ? (
            <p className="text-red-400/70 text-xs font-mono">{t.settings.notificationsBlocked}</p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {isPushSubscribed ? (
                <div className="flex items-center gap-2 text-green-400 text-xs font-mono">
                  <Check size={13} /> {t.settings.notificationsActive}
                </div>
              ) : (
                <span className="text-slate-500 text-xs font-mono">{t.settings.notificationsEnable}</span>
              )}
              <div className="flex items-center gap-2">
                {isPushSubscribed && (
                  <button
                    onClick={disableNotifications}
                    className="flex items-center gap-2 px-3 py-1.5 rounded border border-red-500/40 bg-red-500/10 text-red-400 font-garet text-xs hover:bg-red-500/20 transition-all"
                  >
                    <BellOff size={12} /> {t.settings.notificationsDisable}
                  </button>
                )}
                <button
                  onClick={enableNotifications}
                  className="flex items-center gap-2 px-3 py-1.5 rounded border border-system-blue/50 bg-system-blue/10 text-system-blue font-garet text-xs hover:bg-system-blue/20 transition-all"
                >
                  <Bell size={12} /> {isPushSubscribed ? t.settings.notificationsReactivate : t.settings.notificationsEnable}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Account */}
      {session && (
        <motion.div
          className="p-4 rounded-lg relative overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, rgba(20,4,4,0.99) 0%, rgba(10,3,3,0.99) 100%)',
            border: '1px solid rgba(239,68,68,0.22)',
          }}
          animate={{ boxShadow: ['0 0 6px rgba(239,68,68,0.04)', '0 0 18px rgba(239,68,68,0.10)', '0 0 6px rgba(239,68,68,0.04)'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
        >
          <h3 className="text-system-blue font-garet text-sm mb-3 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Shield size={16} /> {t.settings.accountSection}
          </h3>
          <p className="text-slate-500 text-xs mb-4 font-mono">{session.user.email}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-2 px-4 py-2 rounded border border-red-800 bg-red-900/10 text-red-400 font-garet text-sm hover:bg-red-900/30 hover:border-red-600 transition-all"
          >
            <LogOut size={14} /> {t.settings.signOut}
          </button>
        </motion.div>
      )}
    </div>
  );

  if (isLoadingAuth || isLoadingData) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="text-blue-400 text-4xl font-bold font-garet tracking-widest mb-4 drop-shadow-[0_0_15px_rgba(59,130,246,0.6)]">ARISE</div>
          <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
            <Loader size={14} className="animate-spin" />
            <span>{isLoadingAuth ? 'INITIALIZING SYSTEM...' : 'LOADING HUNTER DATA...'}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <motion.div animate={shakeControls} className="min-h-screen bg-system-dark text-slate-200 pb-20 font-sans selection:bg-system-blue selection:text-black">
      {/* Boss Defeated flash */}
      <AnimatePresence>
        {showBossFlash && (
          <motion.div
            key="boss-flash"
            className="fixed inset-0 z-[90] pointer-events-none"
            style={{ backgroundColor: '#7c3aed' }}
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* Animation queue — one overlay at a time, in order: daily → levelup → rankup */}
      <AnimatePresence mode="wait">
        {activeAnim?.kind === 'daily' && (
          <DailyRewardModal key="daily" rank={profile.rank} onClaim={claimDailyReward} />
        )}
        {activeAnim?.kind === 'levelup' && (
          <LevelUpOverlay key="levelup" info={(activeAnim as { kind: 'levelup'; info: LevelUpInfo }).info} onDone={dismissActiveAnim} />
        )}
        {activeAnim?.kind === 'rankup' && (
          <RankUpOverlay key="rankup" info={(activeAnim as { kind: 'rankup'; info: LevelUpInfo }).info} onDone={dismissActiveAnim} />
        )}
      </AnimatePresence>

      {/* Shadow Extraction overlay */}
      <AnimatePresence>
        {shadowExtracted && (
          <ShadowExtractionOverlay shadow={shadowExtracted} onDone={() => setShadowExtracted(null)} />
        )}
      </AnimatePresence>

      {/* Shadow Detail modal */}
      <AnimatePresence>
        {inspectedShadow && (
          <ShadowDetailModal
            shadow={(profile.shadows ?? []).find(s => s.id === inspectedShadow.id) ?? inspectedShadow}
            onClose={() => setInspectedShadow(null)}
            onTrain={() => trainShadow(inspectedShadow.id)}
          />
        )}
      </AnimatePresence>

      {notification && (
        <SystemNotification
          message={notification.msg}
          subMessage={notification.sub}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-system-dark/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-2">
          <div className="text-system-blue font-bold font-garet tracking-tighter text-lg animate-pulse">{t.header.title}</div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={connectToSystem}
            className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-garet transition-all duration-300
              ${isVoiceConnected
                ? 'bg-red-500/20 border-red-500 text-red-500 animate-pulse'
                : isVoiceConnecting
                  ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-system-blue hover:text-system-blue'}
            `}
          >
            {isVoiceConnecting ? <Loader size={12} className="animate-spin" /> : isVoiceConnected ? <Mic size={12} /> : <MicOff size={12} />}
            <span className="hidden sm:inline">{isVoiceConnected ? t.header.systemLinkOnline : t.header.systemLinkOffline}</span>
          </button>

          <div className="flex items-center gap-1 text-yellow-400 font-mono text-sm bg-yellow-900/20 px-2.5 py-1 rounded-full border border-yellow-700/40">
            <Coins size={13} />
            <span>{profile.gold}</span>
          </div>

          {isAdmin ? (
            <button
              onClick={simulateStreakBreak}
              className="flex items-center gap-1 text-yellow-500 font-garet text-sm hover:text-red-500 transition-colors hover:scale-105 active:scale-95"
              title="[Admin] Simulate Missing a Day"
            >
              <Zap size={14} fill="currentColor" />
              <span>{profile.streakDays} {t.header.days}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 text-yellow-500 font-garet text-sm">
              <Zap size={14} fill="currentColor" />
              <span>{profile.streakDays} {t.header.days}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto max-w-2xl p-4">
        {view === 'DASHBOARD' && renderDashboard()}
        {view === 'IDENTITY' && renderIdentity()}
        {view === 'SHADOW_ARMY' && renderShadowArmy()}
        {view === 'SHOP' && renderShop()}
        {view === 'MISSIONS' && renderMissions()}
        {view === 'SETTINGS' && renderSettings()}
      </main>

      {/* ── BONUS MISSION ARRIVAL POPUP (anime-style) ── */}
      <AnimatePresence>
        {incomingBonusPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: 'rgba(0,3,15,0.96)' }}
          >
            {/* Glitch card */}
            <motion.div
              initial={{ scale: 0.75, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0,
                x: [0, -1, 1, 0, 0, 0, -1, 2, 0],
                filter: [
                  'none',
                  'drop-shadow(2px 0 rgba(0,200,255,0.35)) drop-shadow(-2px 0 rgba(255,0,80,0.2))',
                  'none', 'none', 'none', 'none',
                  'drop-shadow(1px 0 rgba(0,200,255,0.2))',
                  'none',
                ],
              }}
              exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22,
                x: { repeat: Infinity, duration: 5, ease: 'linear', delay: 1 },
                filter: { repeat: Infinity, duration: 5, ease: 'linear', delay: 1 },
              }}
              className="relative w-72 font-mono overflow-hidden"
              style={{
                background: 'linear-gradient(170deg, rgba(6,12,40,0.98) 0%, rgba(4,8,28,0.98) 100%)',
                border: '1px solid rgba(59,130,246,0.55)',
                boxShadow: '0 0 0 1px rgba(59,130,246,0.1), 0 0 40px rgba(59,130,246,0.2), inset 0 0 30px rgba(59,130,246,0.04)',
              }}
            >
              {/* Corner accents */}
              {[['top-0 left-0 border-t border-l',''], ['top-0 right-0 border-t border-r',''], ['bottom-0 left-0 border-b border-l',''], ['bottom-0 right-0 border-b border-r','']].map(([cls], i) => (
                <div key={i} className={`absolute w-3 h-3 border-blue-400/80 ${cls}`} />
              ))}

              {/* Animated scan line */}
              <motion.div
                className="absolute left-0 right-0 h-px pointer-events-none"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.6), transparent)' }}
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ repeat: Infinity, duration: 3.5, ease: 'linear' }}
              />

              {/* System label */}
              <div className="px-5 pt-5 pb-3 text-center">
                <motion.p
                  animate={{ opacity: [0.4, 0.9, 0.4] }}
                  transition={{ repeat: Infinity, duration: 2.5 }}
                  className="text-[9px] tracking-[0.45em] uppercase"
                  style={{ color: 'rgba(147,197,253,0.6)' }}
                >
                  {t.missions.bonusMissionsSystemLabel}
                </motion.p>
              </div>

              {/* Divider */}
              <div className="mx-5 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.5), transparent)' }} />

              {/* Title block */}
              <div className="py-5 text-center">
                <motion.h2
                  className="text-lg font-black tracking-[0.2em] uppercase"
                  style={{ color: '#fff', textShadow: '0 0 16px rgba(147,197,253,0.9), 0 0 32px rgba(59,130,246,0.5)' }}
                  animate={{ textShadow: [
                    '0 0 16px rgba(147,197,253,0.9), 0 0 32px rgba(59,130,246,0.5)',
                    '0 0 22px rgba(147,197,253,1), 0 0 44px rgba(59,130,246,0.8)',
                    '0 0 16px rgba(147,197,253,0.9), 0 0 32px rgba(59,130,246,0.5)',
                  ]}}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  {t.missions.bonusMissionsArrivedTitle}
                </motion.h2>
                <motion.div
                  className="mx-auto mt-2 h-px"
                  style={{ background: 'rgba(147,197,253,0.7)' }}
                  initial={{ width: 0 }}
                  animate={{ width: '50%' }}
                  transition={{ delay: 0.35, duration: 0.6 }}
                />
                <p
                  className="text-[11px] tracking-[0.35em] mt-2 uppercase font-bold"
                  style={{ color: 'rgba(147,197,253,0.8)', textShadow: '0 0 10px rgba(59,130,246,0.6)' }}
                >
                  {t.missions.bonusMissionsArrivedSubtitle}
                </p>
              </div>

              {/* Divider */}
              <div className="mx-5 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.5), transparent)' }} />

              {/* Mission content */}
              <div className="px-5 py-5 space-y-4">
                <p className="text-[9px] tracking-[0.4em] uppercase" style={{ color: 'rgba(147,197,253,0.45)' }}>
                  {t.missions.bonusMissionsObjective}
                </p>
                {incomingBonusPopup.map((m, i) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -18 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.15, type: 'spring', stiffness: 240, damping: 20 }}
                  >
                    <p
                      className="text-sm font-bold leading-snug"
                      style={{ color: '#fff', textShadow: '0 0 10px rgba(255,255,255,0.35)' }}
                    >
                      {m.title}
                    </p>
                    {m.description && (
                      <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(147,197,253,0.75)' }}>
                        {m.description}
                      </p>
                    )}
                    <div className="flex gap-4 mt-2">
                      <span className="text-[10px] tracking-wider" style={{ color: 'rgba(96,165,250,0.8)' }}>XP: +{m.rewardXp}</span>
                      <span className="text-[10px] tracking-wider" style={{ color: 'rgba(96,165,250,0.8)' }}>GOLD: +{m.rewardGold}</span>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Divider */}
              <div className="mx-5 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.5), transparent)' }} />

              {/* Accept button */}
              <div className="px-5 py-5">
                <motion.button
                  whileHover={{ scale: 1.02, boxShadow: '0 0 24px rgba(59,130,246,0.45)' }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { setIncomingBonusPopup(null); setView('MISSIONS'); }}
                  className="w-full py-2.5 text-[11px] font-black tracking-[0.35em] uppercase transition-all"
                  style={{
                    border: '1px solid rgba(59,130,246,0.5)',
                    background: 'rgba(59,130,246,0.07)',
                    color: 'rgba(147,197,253,0.9)',
                    textShadow: '0 0 10px rgba(147,197,253,0.5)',
                  }}
                >
                  [ {t.missions.bonusMissionsAcceptChallenge} ]
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Suggestion Overlay — above nav */}
      <AnimatePresence>
        {voiceSuggestions.length > 0 && (
          <div className="fixed bottom-16 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pb-2 pointer-events-none">
            {voiceSuggestions.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.95 }}
                transition={{ delay: i * 0.06, type: 'spring', stiffness: 260, damping: 22 }}
                className="w-full max-w-2xl bg-slate-950/97 border border-system-blue/60 rounded-xl px-4 py-3 shadow-[0_0_24px_rgba(59,130,246,0.25)] pointer-events-auto"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0">
                    <span className="text-[9px] font-garet text-system-blue/70 tracking-widest block mb-0.5">
                      {s.type === 'habit' ? t.missions.voiceSuggestionHabitLabel : t.missions.voiceSuggestionBossLabel}
                    </span>
                    <span className="font-mono font-bold text-sm text-white leading-snug">
                      {s.type === 'habit' ? s.title : s.title}
                    </span>
                    {s.type === 'boss' && s.description && (
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{s.description}</p>
                    )}
                    {s.type === 'boss' && (
                      <span className="text-[9px] font-mono text-slate-500 mt-0.5 block">📅 {s.dueDays} dias</span>
                    )}
                    {s.type === 'habit' && (
                      <span className="text-[9px] font-mono text-slate-500 mt-0.5 block">🔄 {s.repeatType}</span>
                    )}
                  </div>
                  <div className="ml-auto flex gap-2 shrink-0">
                    <button
                      onClick={() => rejectVoiceSuggestion(s.id)}
                      className="px-3 py-1.5 rounded-lg border border-red-700/60 bg-red-900/20 text-red-400 text-xs font-mono font-bold hover:bg-red-900/40 transition-all"
                    >
                      ✕ {t.missions.voiceSuggestionsReject}
                    </button>
                    <button
                      onClick={() => acceptVoiceSuggestion(s.id)}
                      className="px-3 py-1.5 rounded-lg border border-system-blue bg-system-blue/20 text-system-blue text-xs font-mono font-bold hover:bg-system-blue/40 transition-all"
                    >
                      ✓ {t.missions.voiceSuggestionsAccept}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-system-panel border-t border-slate-800 pb-safe z-40">
        <div className="flex justify-around items-center h-16 max-w-2xl mx-auto px-1">
          <NavButton active={view === 'DASHBOARD'} onClick={() => setView('DASHBOARD')} icon={<Zap size={18} />} label={t.nav.status} />
          <NavButton active={view === 'IDENTITY'} onClick={() => setView('IDENTITY')} icon={<User size={18} />} label={t.nav.identity} />
          <NavButton active={view === 'MISSIONS'} onClick={() => setView('MISSIONS')} icon={<Target size={18} />} label={t.nav.missions} />
          <NavButton active={view === 'SHOP'} onClick={() => setView('SHOP')} icon={<ShoppingBag size={18} />} label={t.nav.store} />
          <NavButton active={view === 'SHADOW_ARMY'} onClick={() => setView('SHADOW_ARMY')} icon={<Ghost size={18} />} label={t.nav.shadows} />
          <NavButton active={view === 'SETTINGS'} onClick={() => setView('SETTINGS')} icon={<Settings size={18} />} label={t.nav.settings} />
        </div>
      </nav>
    </motion.div>
  );
};

const NavButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-all duration-300 ${active ? 'text-system-blue' : 'text-slate-600 hover:text-slate-400'}`}
  >
    <div className={`transition-transform duration-300 ${active ? 'scale-110 drop-shadow-[0_0_5px_rgba(59,130,246,0.8)]' : ''}`}>
      {icon}
    </div>
    <span className="text-[9px] sm:text-[10px] font-bold tracking-wider font-garet">{label}</span>
    {active && <span className="absolute bottom-0 w-8 h-0.5 bg-system-blue rounded-t-full shadow-[0_0_8px_#3b82f6] animate-pulse"></span>}
  </button>
);

export default App;
