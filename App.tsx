import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, type Blob as GenAIBlob } from '@google/genai';
import type { Session } from '@supabase/supabase-js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
  Shield, Map as MapIcon, Sword, User, Zap, Trophy,
  Brain, Activity, Ghost, RotateCw, Crown,
  ShoppingBag, Dumbbell, Coins, Edit3, Check, Plus, Upload,
  Loader, Mic, MicOff, Heart, Skull, BarChart2, Globe, Quote, Settings, Trash2,
  Target, Calendar, LogOut
} from 'lucide-react';
import {
  HunterProfile, Chapter, Quest, ViewState, HunterRank, DungeonPart,
  CustomStat, RewardItem, Habit, SystemQuote, RepeatType,
  BossFight, BossSubTask, BossHistoryEntry, GameState,
  Shadow, ShadowRank, ShadowRole, ShadowStatus, ShadowMission
} from './types';
import {
  INITIAL_CHAPTERS, DAILY_QUESTS, RANK_THRESHOLDS, INITIAL_REWARDS,
  GYM_TARGET_DAYS, INITIAL_HABITS, MOCK_WEEKLY_DATA, getNextRank, getXpProgress,
  STAT_COLOR_PALETTE, RANK_COLORS, SHADOW_RANK_COLORS, extractShadow, generateDailyMissions
} from './constants';
import StatRadar from './components/StatRadar';
import SystemNotification, { NotificationType } from './components/SystemNotification';
import { useLanguage } from './i18n/LanguageContext';
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import DevPanel from './components/DevPanel';
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

  let newStreakDays = gs.profile.streakDays;
  let hadStreakBreak = false;
  if (daysDiff > 1 && newStreakDays > 0) {
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

  const resetQuests = gs.quests.map(q =>
    (q.id === 'dq-1' || q.id === 'dq-2')
      ? { ...q, isCompleted: false, current: 0 }
      : q
  );

  return {
    state: {
      ...gs,
      profile: { ...gs.profile, streakDays: newStreakDays, lastLoginDate: new Date().toISOString() },
      habits: resetHabits,
      quests: resetQuests,
    },
    hadStreakBreak,
    retainedDays: newStreakDays,
  };
}

// --- Level Up Overlay ---
const PARTICLE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

const LevelUpOverlay: React.FC<{ rank: HunterRank; onDone: () => void }> = ({ rank, onDone }) => {
  const color = RANK_COLORS[rank];

  useEffect(() => {
    const timer = setTimeout(onDone, 3500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Radial glow background */}
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse at center, ${color}55 0%, transparent 70%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.7, 0] }}
        transition={{ duration: 3.5, times: [0, 0.15, 0.6, 1] }}
      />

      {/* Particles */}
      {PARTICLE_ANGLES.map((angle, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}`, left: '50%', top: '50%', marginLeft: -4, marginTop: -4 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1.5 }}
          animate={{
            x: Math.cos((angle * Math.PI) / 180) * 260,
            y: Math.sin((angle * Math.PI) / 180) * 260,
            opacity: 0,
            scale: 0,
          }}
          transition={{ duration: 1.8, delay: 0.15, ease: 'easeOut' }}
        />
      ))}

      {/* Main text */}
      <motion.div
        className="text-center relative z-10 select-none"
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: [0.2, 1.3, 1, 1, 1], opacity: [0, 1, 1, 1, 0] }}
        transition={{ duration: 3.5, times: [0, 0.2, 0.35, 0.7, 1] }}
      >
        <div className="text-xs font-mono tracking-[0.5em] mb-3" style={{ color }}>
          ⚔ RANK UP ⚔
        </div>
        <div
          className="text-8xl font-black font-mono"
          style={{ color, textShadow: `0 0 40px ${color}, 0 0 80px ${color}88` }}
        >
          {rank}
        </div>
        <div className="text-white font-mono text-sm tracking-[0.4em] mt-3 opacity-70">
          RANK ACHIEVED
        </div>
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
        <div className="text-[9px] font-mono tracking-[0.5em] text-slate-500 mb-3">⚔ SOMBRA EXTRAÍDA ⚔</div>
        <div
          className="text-3xl font-black font-mono mb-3"
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
  const [chapters, setChapters] = useState<Chapter[]>(INITIAL_CHAPTERS);
  const [quests, setQuests] = useState<Quest[]>(() => [
    { ...DAILY_QUESTS[0], description: t.quests.dq1 },
    { ...DAILY_QUESTS[1], description: t.quests.dq2 },
  ]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [habits, setHabits] = useState<Habit[]>(() =>
    INITIAL_HABITS.map((h, i) => ({ ...h, title: t.initialHabits[i].title }))
  );

  const [profile, setProfile] = useState<HunterProfile>({
    name: 'Jin-Woo',
    rank: HunterRank.E,
    level: 1,
    currentXp: 0,
    requiredXp: 500,
    customStats: t.defaultStats,
    streakDays: 5,
    lastLoginDate: new Date().toISOString(),
    gold: 0,
    weeklyGymProgress: [false, false, false, false, false, false, false],
    shadows: [],
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(profile.name);
  const [newHabitTitle, setNewHabitTitle] = useState('');
  const [dailyQuote, setDailyQuote] = useState<SystemQuote>(t.quotes[0]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTab, setReportTab] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
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
  const [editingSubTaskId, setEditingSubTaskId] = useState<string | null>(null);
  const [editingSubTaskText, setEditingSubTaskText] = useState('');
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

  // Shadow missions + inspection state
  const [shadowMissions] = useState<ShadowMission[]>(() => generateDailyMissions());
  const [missionModal, setMissionModal] = useState<{ mission: ShadowMission; selectedIds: string[] } | null>(null);
  const [inspectedShadow, setInspectedShadow] = useState<Shadow | null>(null);

  // Visual effects state
  const [levelUpRank, setLevelUpRank] = useState<HunterRank | null>(null);
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
        setChapters(gs.chapters);
        setQuests(gs.quests);
        setHabits(gs.habits);
        setBossFights(gs.bossFights ?? []);
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
          chapters,
          quests,
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

  // Auto-save with 2s debounce
  useEffect(() => {
    if (!session || !isDataLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const gameState: GameState = { profile, habits, quests, chapters, bossFights };
      await supabase.from('profiles').upsert({ id: session.user.id, profile_data: gameState });
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [profile, habits, quests, chapters, bossFights]);

  // Dynamic rank color CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--rank-color', RANK_COLORS[profile.rank]);
  }, [profile.rank]);

  // Keep profileRef in sync for the time engine
  useEffect(() => { profileRef.current = profile; }, [profile]);

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
              const xpR = 50; const goldR = 60;
              resolutions.push({ type: 'victory', name: s.name, xp: xpR, gold: goldR });
              addedXp += xpR; addedGold += goldR;
              return { ...s, xp: s.xp + 30, returnTime: undefined, missionChance: undefined, status: 'Pronta' as ShadowStatus };
            } else {
              resolutions.push({ type: 'defeat', name: s.name });
              return { ...s, returnTime: now + 7200000, missionChance: undefined, status: 'Regenerando' as ShadowStatus };
            }
          }

          if (s.status === 'Regenerando') {
            resolutions.push({ type: 'regen', name: s.name });
            return { ...s, returnTime: undefined, status: 'Pronta' as ShadowStatus };
          }

          return s;
        });

        const newXp = p.currentXp + addedXp;
        const newGold = p.gold + addedGold;
        const newRank = getNextRank(newXp);
        const didLevelUp = newRank !== p.rank;
        if (didLevelUp) setTimeout(() => setLevelUpRank(newRank), 500);

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

  const translatePart = (part: string): string => t.dungeonParts[part] || part;

  const getGlobalStanding = (rank: HunterRank) => t.standing[rank];

  const localizedRewards: RewardItem[] = INITIAL_REWARDS.map((item, i) => ({
    ...item,
    name: t.initialRewards[i].name,
    description: t.initialRewards[i].description,
  }));

  const addXp = (amount: number, statId?: string) => {
    setProfile(prev => {
      const newXp = prev.currentXp + amount;
      const newRank = getNextRank(newXp);
      const didLevelUp = newRank !== prev.rank;
      const newCustomStats = prev.customStats.map(s =>
        statId && s.id === statId ? { ...s, value: s.value + 1 } : s
      );

      if (didLevelUp) {
        setTimeout(() => {
          showNotification(t.notifications.rankUp(newRank), t.notifications.rankUpSub, 'levelup');
          setLevelUpRank(newRank);
        }, 500);
      }

      return { ...prev, currentXp: newXp, rank: newRank, customStats: newCustomStats };
    });
  };

  const addGold = (amount: number) => {
    setProfile(prev => ({ ...prev, gold: prev.gold + amount }));
  };

  // --- Admin / Dev Panel ---
  const isAdmin = session?.user?.email === 'dany_ops@hotmail.com';

  const handleForceRank = (rank: HunterRank) => {
    const xp = RANK_THRESHOLDS[rank];
    setProfile(prev => ({ ...prev, rank, currentXp: xp }));
  };

  const handleSetStatValue = (statId: string, value: number) => {
    setProfile(prev => ({
      ...prev,
      customStats: prev.customStats.map(s => s.id === statId ? { ...s, value } : s),
    }));
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

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are 'The System', an advanced AI interface for a Hunter (the user). Your tone is calm, precise, and slightly game-like, similar to the System in Solo Leveling. Address the user as 'Player' or 'Hunter'. Current Hunter Rank: ${profile.rank}.`,
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
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
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

  const completeQuest = (questId: string) => {
    setQuests(prev => prev.map(q => {
      if (q.id === questId && !q.isCompleted) {
        addXp(q.rewardXp, q.rewardStat);
        addGold(50);
        setTimeout(() => showNotification(t.notifications.questComplete, `${q.description} (+50 Gold)`, 'quest'), 200);
        return { ...q, isCompleted: true, current: q.target };
      }
      return q;
    }));
  };

  const startDungeon = (chapterId: string) => {
    setActiveChapterId(chapterId);
    setView('ACTIVE_DUNGEON');
  };

  const finishDungeon = (success: boolean) => {
    if (!activeChapterId) return;

    if (success) {
      setChapters(prev => {
        const updated = prev.map(c => {
          if (c.id === activeChapterId)
            return { ...c, isCleared: true, masteryLevel: Math.min(100, c.masteryLevel + 25), unlocked: true };
          return c;
        });
        const currentIdx = prev.findIndex(c => c.id === activeChapterId);
        if (currentIdx < prev.length - 1) updated[currentIdx + 1].unlocked = true;
        if (activeChapterId.startsWith('BOSS')) {
          showNotification(t.notifications.sRankCleared, t.notifications.sRankClearedSub, 'levelup');
        }
        return updated;
      });

      const chapter = chapters.find(c => c.id === activeChapterId);
      const partIndex = [DungeonPart.ONE, DungeonPart.TWO, DungeonPart.THREE].indexOf(chapter?.part as DungeonPart);
      const statId = partIndex >= 0 ? profile.customStats[partIndex]?.id : undefined;

      addXp(chapter?.part === DungeonPart.BOSS ? 5000 : 150, statId);
      addGold(chapter?.part === DungeonPart.BOSS ? 2000 : 100);

      setQuests(prev => prev.map(q => {
        if (q.id === 'dq-1' && !q.isCompleted) return { ...q, current: q.current + 1 };
        return q;
      }));

      const quest = quests.find(q => q.id === 'dq-1');
      if (quest && !quest.isCompleted && quest.current + 1 >= quest.target) completeQuest('dq-1');

      if (!activeChapterId.startsWith('BOSS')) {
        showNotification(t.notifications.dungeonCleared, t.notifications.dungeonClearedSub, 'quest');
      }
    } else {
      showNotification(t.notifications.escapedDungeon, t.notifications.escapedDungeonSub);
    }

    setView('DUNGEON_MAP');
    setActiveChapterId(null);
  };

  const summonShadow = (chapterId: string) => {
    setActiveChapterId(chapterId);
    setView('SHADOW_REVIEW');
  };

  const completeShadowReview = () => {
    addXp(10, profile.customStats[1]?.id);
    addGold(20);
    setQuests(prev => prev.map(q => {
      if (q.id === 'dq-2' && !q.isCompleted) return { ...q, current: q.current + 1 };
      return q;
    }));
    const quest = quests.find(q => q.id === 'dq-2');
    if (quest && !quest.isCompleted && quest.current + 1 >= quest.target) completeQuest('dq-2');
    showNotification(t.notifications.shadowReviewComplete, t.notifications.shadowReviewSub, 'info');
    setView('SHADOW_ARMY');
    setActiveChapterId(null);
  };

  const toggleGymDay = (dayIndex: number) => {
    if (profile.weeklyGymProgress[dayIndex]) return;
    setProfile(prev => {
      const newProgress = [...prev.weeklyGymProgress];
      newProgress[dayIndex] = true;
      return { ...prev, weeklyGymProgress: newProgress };
    });
    addXp(50, profile.customStats[0]?.id);
    addGold(75);
    showNotification(t.notifications.trainingComplete, t.notifications.trainingCompleteSub, 'shield');
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
    setHabits(prev => prev.map(h => {
      if (h.id === id && !h.isCompleted) {
        addXp(30);
        addGold(20);
        showNotification(t.notifications.protocolAdhered, `${h.title} (+30 XP)`, 'shield');
        // Monarch's Blessing — reduce all active shadow timers by 30 minutes
        const BLESSING_MS = 1800000;
        setProfile(pp => {
          const activeShadows = (pp.shadows ?? []).filter(
            s => s.returnTime && (s.status === 'Em Missão' || s.status === 'Treinando' || s.status === 'Regenerando')
          );
          if (activeShadows.length === 0) return pp;
          setTimeout(() => showNotification(t.notifications.monarchBlessing, t.notifications.monarchBlessingSub, 'shield'), 300);
          return {
            ...pp,
            shadows: (pp.shadows ?? []).map(s =>
              s.returnTime && (s.status === 'Em Missão' || s.status === 'Treinando' || s.status === 'Regenerando')
                ? { ...s, returnTime: Math.max(Date.now(), s.returnTime - BLESSING_MS) }
                : s
            ),
          };
        });
        return { ...h, isCompleted: true, streak: h.streak + 1 };
      }
      return h;
    }));
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
    setQuests(prev => prev.map(q => q.rewardStat === id ? { ...q, rewardStat: fallbackId } : q));
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
    return Math.floor((new Date(dateString).getTime() - Date.now()) / 86400000);
  };

  const addNewBossSubTask = () => {
    if (!newBossSubInput.trim()) return;
    setNewBossSubTasks(prev => [...prev, { id: `bst-${Date.now()}`, title: newBossSubInput.trim(), completed: false }]);
    setNewBossSubInput('');
  };

  const createBoss = () => {
    if (!newBossTitle.trim()) return;
    const xpReward = Math.floor(Math.random() * 151) + 150;
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
    setProfile(prev => ({ ...prev, shadows: [...(prev.shadows ?? []), newShadow] }));
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
          ? { ...s, status: 'Em Missão' as ShadowStatus, returnTime, missionChance: chance }
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

  const handleUpload = () => {
    if (!uploadTitle.trim()) return;
    setIsProcessingUpload(true);
    showNotification(t.notifications.analysisInitiated, t.notifications.analysisSub, 'processing');

    setTimeout(() => {
      const partName = `${t.upload.partPrefix} ${uploadTitle.toUpperCase()}`;
      const newChapters: Chapter[] = [
        { id: `c-${Date.now()}-1`, title: `${uploadTitle} - ${t.upload.fundamentals}`, part: partName, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: true },
        { id: `c-${Date.now()}-2`, title: `${uploadTitle} - ${t.upload.advanced}`, part: partName, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
        { id: `c-${Date.now()}-3`, title: `${uploadTitle} - ${t.upload.practical}`, part: partName, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
      ];
      setChapters(prev => [...prev.filter(c => c.part !== DungeonPart.BOSS), ...newChapters, ...prev.filter(c => c.part === DungeonPart.BOSS)]);
      setIsProcessingUpload(false);
      setShowUploadModal(false);
      setUploadTitle('');
      setUploadFile(null);
      setView('DUNGEON_MAP');
      showNotification(t.notifications.dungeonGeneratedTitle, t.notifications.dungeonGeneratedSub(uploadTitle), 'levelup');
    }, 2500);
  };

  // --- Render Modals ---
  const renderUploadModal = () => {
    if (!showUploadModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in">
        <div className="bg-system-panel border border-system-blue w-full max-w-lg p-6 rounded-lg shadow-[0_0_50px_rgba(59,130,246,0.3)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-system-blue to-transparent animate-slide-in-right"></div>

          <h2 className="text-2xl font-bold font-mono text-system-blue mb-6 flex items-center gap-2">
            <Brain size={24} /> {t.upload.title}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-slate-400 font-mono text-sm mb-1">{t.upload.goalLabel}</label>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder={t.upload.goalPlaceholder}
                className="w-full bg-slate-900 border border-slate-700 p-3 rounded text-white font-bold focus:border-system-blue outline-none transition-colors"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-slate-400 font-mono text-sm mb-1">{t.upload.materialLabel}</label>
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 flex flex-col items-center justify-center text-slate-500 hover:border-system-blue/50 hover:bg-system-blue/5 transition-all cursor-pointer relative">
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                />
                <Upload size={32} className="mb-2" />
                <span className="text-xs font-mono">{uploadFile ? uploadFile.name : t.upload.dragFile}</span>
              </div>
            </div>

            <div className="bg-blue-900/20 p-3 rounded border border-blue-900/50 text-xs text-blue-200 font-mono">
              <p>{t.upload.hint1}</p>
              <p>{t.upload.hint2}</p>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <button onClick={() => setShowUploadModal(false)} className="flex-1 py-3 border border-slate-700 text-slate-400 hover:text-white rounded font-mono font-bold">
              {t.upload.cancel}
            </button>
            <button
              onClick={handleUpload}
              disabled={!uploadTitle || isProcessingUpload}
              className={`flex-1 py-3 bg-system-blue text-black font-bold rounded font-mono flex items-center justify-center gap-2 hover:shadow-[0_0_20px_#3b82f6] transition-all ${isProcessingUpload ? 'opacity-50 cursor-wait' : ''}`}
            >
              {isProcessingUpload ? <Loader className="animate-spin" /> : t.upload.initialize}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderReportModal = () => {
    if (!showReportModal) return null;
    const xpNeeded = RANK_THRESHOLDS[HunterRank.S] - profile.currentXp;
    const daysRemaining = Math.max(0, Math.ceil(xpNeeded / 150));
    const standing = getGlobalStanding(profile.rank);

    const reportTabs: { key: 'DAILY' | 'WEEKLY' | 'MONTHLY'; label: string }[] = [
      { key: 'DAILY', label: t.analytics.daily },
      { key: 'WEEKLY', label: t.analytics.weekly },
      { key: 'MONTHLY', label: t.analytics.monthly },
    ];

    const weeklyDataLocalized = MOCK_WEEKLY_DATA.map((d, i) => ({ ...d, day: t.weeklyDays[i] }));

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in p-4">
        <div className="bg-system-panel border border-slate-600 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg shadow-[0_0_50px_rgba(255,255,255,0.1)] relative">
          <button onClick={() => setShowReportModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <Check size={24} />
          </button>

          <div className="p-6">
            <h2 className="text-2xl font-bold font-mono text-system-blue mb-1 flex items-center gap-2">
              <BarChart2 size={24} /> {t.analytics.title}
            </h2>
            <p className="text-slate-400 text-sm mb-6 font-mono">{t.analytics.subtitle}</p>

            <div className="flex gap-2 mb-6 border-b border-slate-800 pb-2">
              {reportTabs.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setReportTab(key)}
                  className={`px-4 py-2 font-mono text-sm font-bold transition-all ${reportTab === key ? 'text-system-blue border-b-2 border-system-blue' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-slate-900/50 p-4 rounded border border-slate-800">
                <h3 className="text-sm font-bold text-slate-300 mb-4 font-mono">{t.analytics.xpChart}</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyDataLocalized}>
                      <XAxis dataKey="day" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }} cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }} />
                      <Bar dataKey="xp" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                        {weeklyDataLocalized.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.xp > 400 ? '#60a5fa' : '#1e3a8a'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-900/50 p-4 rounded border border-slate-800">
                  <h3 className="text-sm font-bold text-green-400 mb-2 font-mono flex items-center gap-2">
                    <Activity size={14} /> {t.analytics.prediction}
                  </h3>
                  <div className="text-3xl font-bold text-white mb-1">{daysRemaining} {t.analytics.daysUnit}</div>
                  <p className="text-xs text-slate-400">{t.analytics.estimatedTime}</p>
                </div>

                <div className="bg-slate-900/50 p-4 rounded border border-slate-800">
                  <h3 className="text-sm font-bold text-yellow-400 mb-2 font-mono flex items-center gap-2">
                    <Crown size={14} /> {t.analytics.status}
                  </h3>
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-slate-300 text-xs">{t.analytics.globalRank}</span>
                    <span className="text-white font-bold">{standing.percentile}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-500 w-[85%]"></div>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 italic">{t.analytics.outperforming}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Views ---
  const renderDashboard = () => (
    <div className="space-y-6 animate-slide-up">
      {/* Daily Quote */}
      <div className="bg-gradient-to-r from-slate-900 to-system-panel border border-system-blue/30 rounded-lg p-4 relative overflow-hidden shadow-lg group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <Quote size={64} />
        </div>
        <div className="flex items-start gap-3 relative z-10">
          <div className="bg-system-blue/20 p-2 rounded-full text-system-blue">
            <Quote size={20} />
          </div>
          <div>
            <h3 className="text-system-blue font-mono font-bold text-xs uppercase tracking-widest mb-1">{t.dashboard.systemMessage}</h3>
            <p className="text-white font-serif italic text-lg leading-relaxed">"{dailyQuote.text}"</p>
            <p className="text-slate-500 text-xs font-mono mt-2 text-right">- {dailyQuote.author}</p>
          </div>
        </div>
      </div>

      {/* Profile Card */}
      <div className="bg-system-panel border border-system-border p-6 rounded-lg relative overflow-hidden shadow-lg transform transition-all hover:scale-[1.01]">
        <div className="absolute top-0 right-0 p-2 opacity-20">
          <Shield size={100} />
        </div>
        <div className="flex items-center space-x-4 mb-4">
          <div className="w-16 h-16 bg-system-blue rounded-full flex items-center justify-center text-black font-bold text-3xl ring-4 ring-system-blue/30 animate-pulse-glow">
            {profile.rank}
          </div>
          <div className="flex-1">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  className="bg-slate-800 text-white font-mono font-bold text-lg px-2 py-1 rounded border border-system-blue outline-none w-full"
                  autoFocus
                  onBlur={saveName}
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                />
                <button onClick={saveName} className="text-green-500"><Check size={20} /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group cursor-pointer" onClick={() => { setTempName(profile.name); setIsEditingName(true); }}>
                <h2 className="text-xl font-bold font-mono tracking-wider">{t.dashboard.hunter} {profile.name.toUpperCase()}</h2>
                <Edit3 size={14} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
            <p className="text-sm text-slate-400">{t.dashboard.navigatorSystem}</p>
          </div>
          <div className="flex items-center gap-1 text-yellow-400 font-mono bg-yellow-900/20 px-3 py-1 rounded-full border border-yellow-700/50">
            <Coins size={16} />
            <span>{profile.gold}</span>
          </div>
        </div>

        <div className="mt-2">
          <div className="flex justify-between text-xs text-system-blue font-mono mb-1">
            <span>{t.dashboard.xp}</span>
            <span>{profile.currentXp} / {RANK_THRESHOLDS[getNextRank(profile.currentXp + 100)]}</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-system-blue shadow-[0_0_10px_#3b82f6] transition-all duration-1000 ease-out"
              style={{ width: `${getXpProgress(profile.currentXp, profile.rank)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Initialize Plan */}
      <button
        onClick={() => setShowUploadModal(true)}
        className="w-full py-4 border-2 border-dashed border-system-blue/50 rounded-lg flex items-center justify-center gap-2 text-system-blue hover:bg-system-blue/10 hover:border-system-blue transition-all group font-mono font-bold"
      >
        <Plus size={20} className="group-hover:rotate-90 transition-transform" />
        {t.dashboard.initPlan}
      </button>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-system-panel border border-system-border p-4 rounded-lg hover:border-system-blue/30 transition-colors">
          <h3 className="text-system-blue font-mono text-sm mb-4 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Activity size={16} /> {t.dashboard.parameters}
          </h3>
          <StatRadar customStats={profile.customStats} />
        </div>

        <div className="bg-system-panel border border-system-border p-4 rounded-lg flex flex-col justify-between">
          <div className="space-y-2 flex-1">
            {profile.customStats.map(stat => (
              <div key={stat.id} className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-slate-800 hover:bg-slate-800 transition-colors">
                <span className="flex items-center gap-2 font-mono text-sm" style={{ color: stat.color }}>
                  {stat.emoji} {stat.name}
                </span>
                <span className="text-xl font-bold">{stat.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
              <Zap size={12} /> {t.dashboard.totalPower}
            </span>
            <span className="text-lg font-bold text-system-blue">
              {profile.customStats.reduce((sum, s) => sum + s.value, 0)}
            </span>
          </div>
        </div>
      </div>

    </div>
  );

  const renderDungeonMap = () => {
    const groupedChapters: { [key: string]: Chapter[] } = {};
    chapters.forEach(c => {
      if (!groupedChapters[c.part]) groupedChapters[c.part] = [];
      groupedChapters[c.part].push(c);
    });

    return (
      <div className="space-y-8 animate-slide-in-right">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold font-mono text-system-blue tracking-widest">{t.dungeon.title}</h2>
          <p className="text-slate-400 text-sm">{t.dungeon.subtitle}</p>
        </div>

        {Object.entries(groupedChapters)
          .filter(([part]) => part !== DungeonPart.BOSS)
          .map(([part, partChapters]) => (
            <div key={part} className="space-y-3">
              <h3 className="text-lg font-bold text-white border-l-4 border-system-blue pl-3 sticky top-16 bg-system-dark/90 backdrop-blur z-20 py-2 shadow-lg">{translatePart(part)}</h3>
              <div className="grid gap-3">
                {partChapters.map(chapter => (
                  <button
                    key={chapter.id}
                    disabled={!chapter.unlocked}
                    onClick={() => startDungeon(chapter.id)}
                    className={`w-full text-left p-4 rounded-lg border flex justify-between items-center transition-all duration-200 group transform active:scale-[0.99]
                      ${chapter.isCleared
                        ? 'bg-shadow-dark border-shadow-purple/50 text-shadow-purple hover:bg-shadow-purple/20 hover:shadow-[0_0_15px_rgba(139,92,246,0.3)]'
                        : chapter.unlocked
                          ? 'bg-slate-900 border-red-900/50 hover:border-red-500 hover:bg-red-900/10 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                          : 'bg-slate-950 border-slate-800 opacity-50 cursor-not-allowed'}
                    `}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs opacity-50">CH {chapter.id}</span>
                        <h4 className="font-bold">{chapter.title}</h4>
                      </div>
                      <div className="text-xs mt-1 font-mono">
                        {chapter.isCleared ? t.dungeon.statusCleared : chapter.unlocked ? t.dungeon.statusOpen : t.dungeon.statusLocked}
                      </div>
                    </div>
                    <div>
                      {chapter.isCleared ? <Ghost className="text-shadow-purple" /> : <Sword className={`${chapter.unlocked ? 'text-red-500 group-hover:scale-110 transition-transform duration-300' : 'text-slate-700'}`} />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

        <div className="mt-12 mb-20 border-t border-slate-800 pt-8">
          <div className={`p-1 rounded-xl bg-gradient-to-r transition-all duration-500 ${chapters.some(c => c.part === DungeonPart.BOSS && c.unlocked) ? 'from-red-500 via-purple-600 to-red-500 animate-pulse-glow shadow-[0_0_30px_rgba(220,38,38,0.4)]' : 'from-slate-800 to-slate-900'}`}>
            <div className="bg-black rounded-lg p-6 text-center">
              <h3 className="text-2xl font-bold text-red-500 font-mono tracking-[0.2em] mb-4">{t.dungeon.sRankGate}</h3>
              {chapters.filter(c => c.part === DungeonPart.BOSS).map(boss => (
                <button
                  key={boss.id}
                  disabled={!boss.unlocked}
                  onClick={() => startDungeon(boss.id)}
                  className={`w-full py-4 border-2 font-bold text-lg rounded uppercase tracking-widest transition-all duration-300 active:scale-95
                    ${boss.unlocked
                      ? 'border-red-500 bg-red-900/20 text-red-500 hover:bg-red-500 hover:text-white hover:shadow-[0_0_30px_#ef4444]'
                      : 'border-slate-800 text-slate-600 cursor-not-allowed'}
                  `}
                >
                  {boss.unlocked ? boss.title : t.dungeon.lockedMsg}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderActiveDungeon = () => {
    const chapter = chapters.find(c => c.id === activeChapterId);
    if (!chapter) return null;
    const isBoss = chapter.part === DungeonPart.BOSS;

    return (
      <div className="h-[calc(100vh-140px)] flex flex-col items-center justify-center space-y-8 animate-zoom-in">
        <div className="text-center space-y-2">
          <span className={`font-mono animate-pulse ${isBoss ? 'text-red-500 font-bold text-xl' : 'text-red-500'}`}>
            {isBoss ? t.dungeon.bossRaid : t.dungeon.monstersDetected}
          </span>
          <h2 className="text-3xl font-bold text-white max-w-xs mx-auto leading-tight">{chapter.title.toUpperCase()}</h2>
          <p className="text-system-blue font-mono">{translatePart(chapter.part)}</p>
        </div>

        <div className={`w-64 h-64 border-4 rounded-full flex items-center justify-center relative overflow-hidden bg-slate-900 transition-all duration-500
          ${isBoss ? 'border-red-600 shadow-[0_0_50px_#dc2626]' : 'border-red-500/30 hover:border-red-500/60'}
        `}>
          <div className={`absolute inset-0 bg-red-500/10 ${isBoss ? 'animate-ping opacity-20' : 'animate-pulse-glow'}`}></div>
          {isBoss ? <Crown size={80} className="text-red-600 relative z-10" /> : <Sword size={64} className="text-red-500 relative z-10" />}
        </div>

        <div className="text-center text-slate-400 text-sm max-w-sm">
          <p>{isBoss ? t.dungeon.finalExam : t.dungeon.studyTimer}</p>
          <p>{isBoss ? t.dungeon.conquerSystem : t.dungeon.readMaterials}</p>
        </div>

        <div className="flex gap-4 w-full max-w-sm">
          <button
            onClick={() => finishDungeon(false)}
            className="flex-1 py-3 border border-slate-600 text-slate-400 hover:bg-slate-800 hover:text-white rounded font-mono uppercase font-bold transition-all duration-200 active:scale-95"
          >
            {t.dungeon.retreat}
          </button>
          <button
            onClick={() => finishDungeon(true)}
            className={`flex-1 py-3 text-black hover:opacity-90 rounded font-mono uppercase font-bold shadow-[0_0_15px_currentColor] transition-all duration-200 active:scale-95
              ${isBoss ? 'bg-red-600 text-white shadow-red-600 hover:shadow-red-500' : 'bg-system-blue shadow-blue-500 hover:shadow-blue-400'}
            `}
          >
            {isBoss ? t.dungeon.slayBoss : t.dungeon.clearDungeon}
          </button>
        </div>
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
          <h2 className="text-2xl font-bold font-mono text-shadow-purple tracking-widest">{t.shadows.title}</h2>
          <p className="text-slate-400 text-sm">{t.shadows.subtitle}</p>
        </div>

        {/* ── Mission Board ── */}
        <section>
          <h3 className="text-xs font-mono tracking-[0.35em] text-slate-500 mb-4 flex items-center gap-2">
            <Target size={12} className="text-yellow-500" />
            {t.shadows.missionBoardTitle}
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {shadowMissions.map(mission => (
              <div
                key={mission.id}
                className="bg-slate-900 border border-yellow-500/20 rounded-lg p-4 hover:border-yellow-500/40 transition-all"
              >
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
              </div>
            ))}
          </div>
        </section>

        {/* ── Shadow Soldiers (compact grid) ── */}
        <section>
          <h3 className="text-xs font-mono tracking-[0.35em] text-slate-500 mb-4 flex items-center gap-2">
            <Ghost size={12} className="text-shadow-purple" />
            {t.shadows.soldiersTitle}
            <span className="ml-auto text-shadow-purple font-bold">{soldiers.length}</span>
          </h3>
          {soldiers.length === 0 ? (
            <div className="text-center py-14 text-slate-600 border border-dashed border-slate-800 rounded-lg">
              <Ghost size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{t.shadows.soldiersEmpty}</p>
              <p className="text-xs mt-1 text-slate-700">{t.shadows.soldiersEmptyHint}</p>
            </div>
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
                <p className="text-xs font-mono tracking-[0.3em] text-yellow-500 mb-1">{t.shadows.missionSelectTitle}</p>
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

  const renderShadowReview = () => {
    const chapter = chapters.find(c => c.id === activeChapterId);
    if (!chapter) return null;
    const partLabel = translatePart(chapter.part).split(':')[1]?.trim() || translatePart(chapter.part);

    return (
      <div className="h-[calc(100vh-140px)] flex flex-col items-center justify-center space-y-6 animate-fade-in">
        <div className="w-full max-w-md bg-slate-900 border border-shadow-purple p-8 rounded-lg shadow-[0_0_30px_rgba(139,92,246,0.2)] text-center relative hover:shadow-[0_0_40px_rgba(139,92,246,0.3)] transition-shadow duration-500">
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-shadow-purple text-black font-bold px-4 py-1 rounded-full text-sm font-mono animate-bounce">
            {t.shadows.reviewMode}
          </div>
          <Ghost size={48} className="mx-auto mb-4 text-shadow-purple" />
          <h3 className="text-xl font-bold mb-2">{chapter.title}</h3>
          <p className="text-slate-400 text-sm mb-6">"{t.shadows.reviewQuote} {partLabel}."</p>

          <div className="bg-black/30 p-4 rounded text-left mb-6 font-mono text-xs text-green-400">
            {t.shadows.dbAccess}<br />
            {t.shadows.dbRetrieve}<br />
            {t.shadows.dbTopic} {chapter.title}<br />
            {t.shadows.dbStatus}
          </div>

          <button
            onClick={completeShadowReview}
            className="w-full py-3 bg-shadow-purple text-white font-bold rounded hover:bg-purple-600 hover:shadow-[0_0_20px_rgba(147,51,234,0.5)] transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
          >
            <RotateCw size={18} /> {t.shadows.completeReview}
          </button>
          <button
            onClick={() => { setView('SHADOW_ARMY'); setActiveChapterId(null); }}
            className="mt-4 text-slate-500 hover:text-white text-sm transition-colors"
          >
            {t.shadows.dismiss}
          </button>
        </div>
      </div>
    );
  };

  const renderShop = () => (
    <div className="space-y-6 animate-slide-up">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold font-mono text-yellow-500 tracking-widest">{t.shop.title}</h2>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-slate-400 text-sm">{t.shop.subtitle}</span>
          <div className="flex items-center gap-1 text-yellow-400 font-mono bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-700/50 text-xs">
            <Coins size={12} />
            <span>{profile.gold}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {localizedRewards.map(item => (
          <div key={item.id} className="bg-slate-900 border border-slate-700 p-4 rounded-lg flex flex-col justify-between hover:border-yellow-500/50 hover:shadow-[0_0_15px_rgba(234,179,8,0.2)] transition-all group">
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
          </div>
        ))}
      </div>
    </div>
  );

  const renderLifestyleControl = () => (
    <div className="space-y-6 animate-slide-up">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold font-mono text-green-500 tracking-widest">{t.lifestyle.title}</h2>
        <p className="text-slate-400 text-sm">{t.lifestyle.subtitle}</p>
      </div>

      <div className="bg-system-panel border border-slate-700 p-4 rounded-lg">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newHabitTitle}
            onChange={(e) => setNewHabitTitle(e.target.value)}
            placeholder={t.lifestyle.addPlaceholder}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-green-500 font-mono text-sm"
            onKeyDown={(e) => e.key === 'Enter' && addNewHabit()}
          />
          <button onClick={addNewHabit} className="bg-green-600 hover:bg-green-500 text-white px-3 rounded">
            <Plus size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {habits.map(habit => (
            <div
              key={habit.id}
              className={`p-4 border rounded-lg flex items-center justify-between transition-all group
                ${habit.isCompleted ? 'bg-slate-900/50 border-slate-800 opacity-60' : 'bg-slate-900 border-slate-700 hover:border-green-500/50'}
              `}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-blue-500/20 text-blue-400">
                  <Sword size={16} />
                </div>
                <div>
                  <h4 className={`font-bold ${habit.isCompleted ? 'line-through text-slate-500' : 'text-white'}`}>{habit.title}</h4>
                  <p className="text-[10px] text-slate-500 font-mono">{t.lifestyle.streakLabel} {habit.streak} {t.lifestyle.streakUnit}</p>
                </div>
              </div>
              <button
                onClick={() => toggleHabit(habit.id)}
                disabled={habit.isCompleted}
                className={`w-10 h-10 rounded border flex items-center justify-center transition-all
                  ${habit.isCompleted
                    ? 'bg-slate-800 border-slate-700 text-slate-500'
                    : 'bg-slate-950 border-slate-600 hover:bg-green-500/20 hover:border-green-500 hover:text-green-500 text-slate-400'}
                `}
              >
                {habit.isCompleted ? <Check size={20} /> : <div className="w-3 h-3 rounded-sm border border-current"></div>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMissions = () => {
    const activeBosses = bossFights.filter(b => b.status === 'active');
    const completedBosses = bossFights.filter(b => b.status === 'completed');
    const completedHabits = habits.filter(h => h.isCompleted);

    return (
      <div className="space-y-8 animate-slide-up">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold font-mono text-white tracking-widest">{t.missions.title}</h2>
        </div>

        {/* ── CHEFÕES ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-purple-900/50 pb-2">
            <h3 className="text-purple-400 font-mono text-sm font-bold flex items-center gap-2">
              ⚔️ {t.missions.bossHeader}
            </h3>
            <button
              onClick={() => setShowAddBossForm(v => !v)}
              className="flex items-center gap-1 text-xs font-mono text-purple-400 hover:text-white border border-purple-500/50 hover:border-purple-400 px-2 py-1 rounded transition-all"
            >
              <Plus size={12} /> {t.missions.newBoss}
            </button>
          </div>

          {/* New boss form */}
          {showAddBossForm && (
            <div className="bg-slate-900/80 border border-purple-500/30 rounded-lg p-4 space-y-3 animate-fade-in">
              <p className="text-[10px] font-mono text-purple-400 font-bold tracking-widest">⚔️ {t.missions.bossFormTitle}</p>
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
                const isExpired = !!boss.dueDate && new Date(boss.dueDate) < new Date(new Date().toDateString());
                const daysLeft = boss.dueDate ? getDaysUntil(boss.dueDate) : null;
                const allDone = boss.subTasks.length === 0 || boss.subTasks.every(s => s.completed);
                return (
                  <div key={boss.id} className="relative border-2 border-purple-500/60 rounded-lg bg-purple-950/20 shadow-[0_0_24px_rgba(168,85,247,0.18)] overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-purple-500 to-transparent" />

                    <div className="p-4 space-y-4">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-purple-200 font-mono font-bold text-sm leading-snug">
                            ⚔️ BOSS FIGHT: {boss.title.toUpperCase()}
                          </h4>
                          {boss.description && <p className="text-slate-400 text-xs mt-1">{boss.description}</p>}
                        </div>
                        {isExpired ? (
                          <span className="text-[9px] font-mono font-bold px-2 py-1 bg-red-500/20 border border-red-500 text-red-400 rounded shrink-0 animate-pulse">
                            ⚠️ {t.missions.bossExpired}
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono px-2 py-1 bg-purple-500/15 border border-purple-500/40 text-purple-300 rounded shrink-0">
                            {t.missions.bossActive}
                          </span>
                        )}
                      </div>

                      {/* Deadline */}
                      {boss.dueDate && (
                        <p className={`text-xs font-mono font-bold ${isExpired ? 'text-red-400' : daysLeft !== null && daysLeft <= 3 ? 'text-yellow-400' : 'text-slate-400'}`}>
                          {isExpired
                            ? `⚠️ Prazo expirou há ${Math.abs(daysLeft!)}d`
                            : `📅 ${boss.dueDate} (${daysLeft}d restantes)`}
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
                          <p className="text-[10px] font-mono text-slate-500 font-bold tracking-wider">📋 {t.missions.bossHistoryTitle}</p>
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
                    </div>
                  </div>
                );
              })}
          </div>
        </section>

        {/* ── TAREFAS ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-green-900/40 pb-2">
            <h3 className="text-system-blue font-mono text-sm font-bold flex items-center gap-2">
              <Sword size={15} /> {t.missions.tasksHeader}
            </h3>
            <button
              onClick={() => setShowAddTaskForm(v => !v)}
              className="flex items-center gap-1 text-xs font-mono text-system-blue hover:text-white border border-system-blue/50 hover:border-system-blue px-2 py-1 rounded transition-all"
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

              {/* Repeat pattern */}
              <div className="flex gap-1.5 flex-wrap">
                {(['daily', 'weekdays', 'custom', 'oneTime'] as RepeatType[]).map(r => {
                  const labels: Record<RepeatType, string> = {
                    daily: `🔄 ${t.missions.repeatDaily}`,
                    weekdays: `📅 ${t.missions.repeatWeekdays}`,
                    custom: `🗓️ ${t.missions.repeatCustom}`,
                    oneTime: `⭐ ${t.missions.repeatOneTime}`,
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
                    className={`p-3 border rounded-lg flex items-center gap-3 transition-all duration-200
                      ${!active
                        ? 'opacity-40 bg-slate-950 border-slate-800'
                        : habit.isCompleted
                          ? 'bg-system-blue/5 border-system-blue/30'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700'}
                    `}
                  >
                    {/* Mission icon */}
                    <div className="p-1.5 rounded-full shrink-0 bg-system-blue/15 text-system-blue">
                      <Sword size={13} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-sm leading-tight ${habit.isCompleted ? 'line-through text-slate-500' : 'text-white'}`}>
                        {habit.title}
                      </p>
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
                        onClick={() => !habit.isCompleted && toggleHabit(habit.id)}
                        disabled={habit.isCompleted}
                        className={`w-8 h-8 rounded border flex items-center justify-center transition-all
                          ${habit.isCompleted
                            ? 'bg-system-blue/20 border-system-blue/50 text-system-blue'
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

          {/* System quests inline — amber/optional */}
          <div className="space-y-2 pt-1">
            {quests.map(q => {
              const linkedStat = profile.customStats.find(s => s.id === q.rewardStat);
              return (
                <div
                  key={q.id}
                  className={`p-3 border rounded-lg flex items-center gap-3 transition-colors duration-300
                    ${q.isCompleted ? 'bg-yellow-900/10 border-yellow-900/30 opacity-60' : 'bg-amber-900/10 border-amber-700/40 hover:border-amber-600/60'}
                  `}
                >
                  {/* System icon */}
                  <div className="p-1.5 rounded-full shrink-0 bg-amber-500/15 text-amber-400">
                    <Trophy size={13} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-bold text-sm ${q.isCompleted ? 'line-through text-slate-500' : 'text-white'}`}>{q.description}</p>
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/40 text-amber-400 rounded">
                        {t.missions.systemOptional}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {t.dashboard.rewards} {q.rewardXp} XP
                      {linkedStat && <span style={{ color: linkedStat.color }}> +1 {linkedStat.emoji} {linkedStat.name}</span>}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="text-right shrink-0">
                    <span className={`text-sm font-mono ${q.isCompleted ? 'text-green-500' : 'text-amber-400'}`}>
                      {q.current}/{q.target}
                    </span>
                    {q.isCompleted && <CheckMark />}
                  </div>
                </div>
              );
            })}
          </div>

        {/* ── ACTIVITY LOG ── */}
        {(completedHabits.length > 0 || completedBosses.length > 0) && (
          <section className="space-y-3">
            <h3 className="text-slate-500 font-mono text-sm font-bold flex items-center gap-2 border-b border-slate-800 pb-2">
              📋 {t.missions.activityHeader}
            </h3>

            {completedHabits.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-slate-600 mb-2 tracking-wider">{t.missions.activityHabitsTitle}</p>
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
                <p className="text-[10px] font-mono text-slate-600 mb-2 tracking-wider">{t.missions.activityBossTitle}</p>
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
        <h2 className="text-2xl font-bold font-mono text-system-blue tracking-widest">{t.settings.title}</h2>
        <p className="text-slate-400 text-sm">{t.settings.subtitle}</p>
      </div>

      {/* Custom Stats CRUD */}
      <div className="bg-system-panel border border-slate-700 p-4 rounded-lg">
        <h3 className="text-system-blue font-mono text-sm mb-2 border-b border-slate-800 pb-2 flex items-center gap-2">
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
      </div>

      {/* Language */}
      <div className="bg-system-panel border border-slate-700 p-4 rounded-lg">
        <h3 className="text-system-blue font-mono text-sm mb-2 border-b border-slate-800 pb-2 flex items-center gap-2">
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
      </div>

      {/* Dev Panel — admin only */}
      {isAdmin && (
        <DevPanel
          profile={profile}
          onAddXp={(amt) => addXp(amt)}
          onResetXp={() => setProfile(prev => ({ ...prev, currentXp: 0, rank: HunterRank.E }))}
          onAddGold={addGold}
          onForceRank={handleForceRank}
          onSetStatValue={handleSetStatValue}
        />
      )}

      {/* Account */}
      {session && (
        <div className="bg-system-panel border border-slate-700 p-4 rounded-lg">
          <h3 className="text-system-blue font-mono text-sm mb-3 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Shield size={16} /> {t.settings.accountSection}
          </h3>
          <p className="text-slate-500 text-xs mb-4 font-mono">{session.user.email}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-2 px-4 py-2 rounded border border-red-800 bg-red-900/10 text-red-400 font-mono text-sm hover:bg-red-900/30 hover:border-red-600 transition-all"
          >
            <LogOut size={14} /> {t.settings.signOut}
          </button>
        </div>
      )}
    </div>
  );

  if (isLoadingAuth || isLoadingData) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="text-blue-400 text-4xl font-bold tracking-widest mb-4 drop-shadow-[0_0_15px_rgba(59,130,246,0.6)]">ARISE</div>
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

      {/* Level Up overlay */}
      <AnimatePresence>
        {levelUpRank && (
          <LevelUpOverlay rank={levelUpRank} onDone={() => setLevelUpRank(null)} />
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

      {renderUploadModal()}
      {renderReportModal()}

      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-system-dark/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-2">
          <div className="text-system-blue font-bold font-mono tracking-tighter text-lg animate-pulse">{t.header.title}</div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={connectToSystem}
            className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono transition-all duration-300
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

          <button
            onClick={simulateStreakBreak}
            className="flex items-center gap-1 text-yellow-500 font-mono text-sm hover:text-red-500 transition-colors hover:scale-105 active:scale-95"
            title="Click to Simulate Missing a Day"
          >
            <Zap size={14} fill="currentColor" />
            <span>{profile.streakDays} {t.header.days}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto max-w-2xl p-4">
        {view === 'DASHBOARD' && renderDashboard()}
        {view === 'DUNGEON_MAP' && renderDungeonMap()}
        {view === 'ACTIVE_DUNGEON' && renderActiveDungeon()}
        {view === 'SHADOW_ARMY' && renderShadowArmy()}
        {view === 'SHADOW_REVIEW' && renderShadowReview()}
        {view === 'SHOP' && renderShop()}
        {view === 'LIFESTYLE' && renderLifestyleControl()}
        {view === 'MISSIONS' && renderMissions()}
        {view === 'SETTINGS' && renderSettings()}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-system-panel border-t border-slate-800 pb-safe z-40">
        <div className="flex justify-around items-center h-16 max-w-2xl mx-auto px-1">
          <NavButton active={view === 'DASHBOARD'} onClick={() => setView('DASHBOARD')} icon={<User size={18} />} label={t.nav.status} />
          <NavButton active={view === 'MISSIONS'} onClick={() => setView('MISSIONS')} icon={<Target size={18} />} label={t.nav.missions} />
          <NavButton active={view === 'DUNGEON_MAP' || view === 'ACTIVE_DUNGEON'} onClick={() => setView('DUNGEON_MAP')} icon={<MapIcon size={18} />} label={t.nav.dungeon} />
          <NavButton active={view === 'SHOP'} onClick={() => setView('SHOP')} icon={<ShoppingBag size={18} />} label={t.nav.store} />
          <NavButton active={view === 'SHADOW_ARMY' || view === 'SHADOW_REVIEW'} onClick={() => setView('SHADOW_ARMY')} icon={<Ghost size={18} />} label={t.nav.shadows} />
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
    <span className="text-[9px] sm:text-[10px] font-bold tracking-wider font-mono">{label}</span>
    {active && <span className="absolute bottom-0 w-8 h-0.5 bg-system-blue rounded-t-full shadow-[0_0_8px_#3b82f6] animate-pulse"></span>}
  </button>
);

const CheckMark = () => (
  <svg className="w-4 h-4 text-green-500 inline-block ml-1 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
  </svg>
);

export default App;
