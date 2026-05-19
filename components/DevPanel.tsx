import React, { useState } from 'react';
import { HunterRank, HunterProfile } from '../types';
import { RANK_COLORS, RANK_LEVEL_THRESHOLDS } from '../constants';

interface DevPanelProps {
  profile: HunterProfile;
  onAddXp: (amount: number) => void;
  onResetXp: () => void;
  onAddGold: (amount: number) => void;
  onAddStreak: (days: number) => void;
  onAddStatPoints: (points: number) => void;
  onForceRank: (rank: HunterRank) => void;
  onSetStatValue: (statId: string, value: number) => void;
}

const RANKS = Object.values(HunterRank);

function NumInput({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (v: string) => void;
  color: string;
}) {
  return (
    <input
      type="number"
      min={1}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-24 bg-slate-950 border rounded px-2 py-1.5 font-mono text-xs text-white text-center outline-none focus:border-opacity-100 transition-colors"
      style={{ borderColor: `${color}55` }}
      onFocus={e => (e.target.style.borderColor = color)}
      onBlur={e => (e.target.style.borderColor = `${color}55`)}
    />
  );
}

const DevPanel: React.FC<DevPanelProps> = ({
  profile,
  onAddXp,
  onResetXp,
  onAddGold,
  onAddStreak,
  onAddStatPoints,
  onForceRank,
  onSetStatValue,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [xpAmt, setXpAmt] = useState('1000');
  const [goldAmt, setGoldAmt] = useState('500');
  const [streakAmt, setStreakAmt] = useState('1');
  const [spAmt, setSpAmt] = useState('5');

  const rankColor = RANK_COLORS[profile.rank];

  const btn = (label: string, onClick: () => void, color = rankColor) => (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded border font-mono text-xs font-bold transition-all hover:opacity-75 active:scale-95"
      style={{ borderColor: color, color, backgroundColor: `${color}18` }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{ border: `2px dashed ${rankColor}55` }}
    >
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between font-mono text-sm transition-colors hover:bg-slate-900/40"
      >
        <span className="flex items-center gap-2" style={{ color: rankColor }}>
          <span
            className="text-[10px] px-2 py-0.5 rounded border font-bold tracking-widest"
            style={{ borderColor: rankColor }}
          >
            DEV
          </span>
          GOD MODE PANEL
        </span>
        <span className="text-[10px] text-slate-500 font-mono tracking-wider">
          {expanded ? '▲ COLLAPSE' : '▼ EXPAND'}
        </span>
      </button>

      {expanded && (
        <div
          className="px-4 pb-5 space-y-5 border-t"
          style={{ borderColor: `${rankColor}33` }}
        >
          {/* ── XP ── */}
          <section className="pt-4">
            <p className="text-[10px] font-mono text-slate-500 tracking-[0.3em] mb-2">— XP CONTROL —</p>
            <p className="text-xs font-mono mb-3" style={{ color: rankColor }}>
              Current XP: <span className="font-bold">{profile.currentXp.toLocaleString()}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NumInput value={xpAmt} onChange={setXpAmt} color={rankColor} />
              {btn(`+${Number(xpAmt).toLocaleString()} XP`, () => onAddXp(Math.max(1, parseInt(xpAmt) || 0)))}
              {[100, 1000, 5000].map(amt =>
                btn(`+${amt.toLocaleString()}`, () => onAddXp(amt))
              )}
              <button
                onClick={onResetXp}
                className="px-3 py-1.5 rounded border border-red-700 text-red-400 bg-red-900/10 font-mono text-xs font-bold transition-all hover:bg-red-900/25 active:scale-95"
              >
                RESET XP
              </button>
            </div>
          </section>

          {/* ── Gold ── */}
          <section>
            <p className="text-[10px] font-mono text-slate-500 tracking-[0.3em] mb-2">— GOLD CONTROL —</p>
            <p className="text-xs font-mono mb-3 text-yellow-400">
              Current Gold: <span className="font-bold">{profile.gold.toLocaleString()}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NumInput value={goldAmt} onChange={setGoldAmt} color="#ca8a04" />
              {btn(`+${Number(goldAmt).toLocaleString()} 🪙`, () => onAddGold(Math.max(1, parseInt(goldAmt) || 0)), '#ca8a04')}
              {[500, 1000, 5000].map(amt =>
                btn(`+${amt.toLocaleString()}`, () => onAddGold(amt), '#ca8a04')
              )}
            </div>
          </section>

          {/* ── Streak ── */}
          <section>
            <p className="text-[10px] font-mono text-slate-500 tracking-[0.3em] mb-2">— STREAK CONTROL —</p>
            <p className="text-xs font-mono mb-3 text-orange-400">
              Current Streak: <span className="font-bold">{profile.streakDays} days</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NumInput value={streakAmt} onChange={setStreakAmt} color="#f97316" />
              {btn(`+${streakAmt} dias`, () => onAddStreak(Math.max(1, parseInt(streakAmt) || 0)), '#f97316')}
              {[7, 30, 100].map(amt =>
                btn(`+${amt}d`, () => onAddStreak(amt), '#f97316')
              )}
              <button
                onClick={() => onAddStreak(-profile.streakDays)}
                className="px-3 py-1.5 rounded border border-red-700 text-red-400 bg-red-900/10 font-mono text-xs font-bold transition-all hover:bg-red-900/25 active:scale-95"
              >
                RESET
              </button>
            </div>
          </section>

          {/* ── Stat Points ── */}
          <section>
            <p className="text-[10px] font-mono text-slate-500 tracking-[0.3em] mb-2">— STAT POINTS —</p>
            <p className="text-xs font-mono mb-3 text-purple-400">
              Available Points: <span className="font-bold">{profile.availableStatPoints ?? 0}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NumInput value={spAmt} onChange={setSpAmt} color="#a855f7" />
              {btn(`+${spAmt} pts`, () => onAddStatPoints(Math.max(1, parseInt(spAmt) || 0)), '#a855f7')}
              {[5, 20, 100].map(amt =>
                btn(`+${amt}`, () => onAddStatPoints(amt), '#a855f7')
              )}
            </div>
          </section>

          {/* ── Force Rank ── */}
          <section>
            <p className="text-[10px] font-mono text-slate-500 tracking-[0.3em] mb-2">— FORCE RANK —</p>
            <div className="flex flex-wrap gap-2">
              {RANKS.map(rank => {
                const color = RANK_COLORS[rank];
                const isActive = profile.rank === rank;
                return (
                  <button
                    key={rank}
                    onClick={() => onForceRank(rank)}
                    className="px-3 py-1.5 rounded border font-mono text-xs font-bold transition-all hover:opacity-80 active:scale-95"
                    style={{
                      borderColor: color,
                      color: isActive ? '#000' : color,
                      backgroundColor: isActive ? color : `${color}18`,
                      boxShadow: isActive ? `0 0 12px ${color}88` : 'none',
                    }}
                  >
                    {rank}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-600 font-mono mt-2">
              E=Nv1 D=Nv20 C=Nv40 B=Nv60 A=Nv80 S=Nv100 SS=Nv120 SSS=Nv140 NAC=Nv160 MON=Nv180
            </p>
          </section>

          {/* ── Custom Stats ── */}
          <section>
            <p className="text-[10px] font-mono text-slate-500 tracking-[0.3em] mb-3">— CUSTOM STATS —</p>
            <div className="space-y-2">
              {profile.customStats.map(stat => (
                <div key={stat.id} className="flex items-center gap-3">
                  <span className="text-base w-6 text-center">{stat.emoji}</span>
                  <span className="flex-1 font-mono text-xs font-bold" style={{ color: stat.color }}>
                    {stat.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onSetStatValue(stat.id, Math.max(0, stat.value - 1))}
                      className="w-6 h-6 rounded border border-slate-700 text-slate-400 font-mono text-xs hover:border-slate-500 hover:text-white transition-colors"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={stat.value}
                      onChange={e => onSetStatValue(stat.id, Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-xs text-center outline-none focus:border-system-blue"
                    />
                    <button
                      onClick={() => onSetStatValue(stat.id, Math.min(999, stat.value + 1))}
                      className="w-6 h-6 rounded border border-slate-700 text-slate-400 font-mono text-xs hover:border-slate-500 hover:text-white transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default DevPanel;
