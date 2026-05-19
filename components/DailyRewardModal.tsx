import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HunterRank } from '../types';
import { getRankMultiplier } from '../constants';

export type DailyRewardType = 'stat' | 'mana' | 'chest';

interface Props {
  rank: HunterRank;
  onClaim: (type: DailyRewardType) => void;
}

const DailyRewardModal: React.FC<Props> = ({ rank, onClaim }) => {
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  const [rewardType, setRewardType] = useState<DailyRewardType | null>(null);
  const multiplier = getRankMultiplier(rank);

  const REWARDS: Record<DailyRewardType, { icon: string; title: string; desc: string; color: string }> = {
    stat:  { icon: '⚡', title: 'BÊNÇÃO DO SISTEMA', desc: `+1 Ponto de Status\n+100 Gold`,                      color: '#8b5cf6' },
    mana:  { icon: '💠', title: 'INJEÇÃO DE MANA',   desc: `+${Math.floor(multiplier * 100)} XP\n+50 Gold`,     color: '#3b82f6' },
    chest: { icon: '👑', title: 'BAÚ DO MONARCA',    desc: `+${Math.floor(multiplier * 50)} Gold`,               color: '#facc15' },
  };

  const TYPES: DailyRewardType[] = ['stat', 'mana', 'chest'];

  const handleCardClick = (index: number) => {
    if (revealedIndex !== null) return;
    const picked = TYPES[Math.floor(Math.random() * 3)];
    setRevealedIndex(index);
    setRewardType(picked);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-black/88 backdrop-blur-md p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Ambient glow */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, rgba(250,204,21,0.07) 0%, transparent 65%)' }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3, repeat: Infinity }}
      />

      {/* Header */}
      <motion.div
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="text-center mb-10 relative z-10"
      >
        <motion.p
          className="text-[10px] font-garet tracking-[0.5em] text-yellow-400/60 mb-2"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          ✦ MISSÃO DIÁRIA CONCLUÍDA ✦
        </motion.p>
        <h2
          className="text-2xl font-black font-garet tracking-widest text-white"
          style={{ textShadow: '0 0 40px rgba(250,204,21,0.5), 0 0 80px rgba(250,204,21,0.2)' }}
        >
          ESCOLHA SUA RECOMPENSA
        </h2>
        <p className="text-xs font-mono text-slate-500 mt-2 tracking-widest">
          Selecione uma carta — apenas uma pode ser aberta
        </p>
      </motion.div>

      {/* 3 Cards */}
      <div className="flex gap-4 mb-10 relative z-10">
        {[0, 1, 2].map(i => {
          const isRevealed = revealedIndex === i;
          const reward = isRevealed && rewardType ? REWARDS[rewardType] : null;
          const isBlocked = revealedIndex !== null && !isRevealed;

          return (
            <motion.div
              key={i}
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: isBlocked ? 0.3 : 1 }}
              transition={{ delay: 0.2 + i * 0.12, duration: 0.5 }}
              onClick={() => handleCardClick(i)}
              className="relative w-28 h-44 rounded-xl overflow-hidden select-none"
              style={{
                border: isRevealed
                  ? `2px solid ${reward?.color}`
                  : '1px solid rgba(250,204,21,0.2)',
                boxShadow: isRevealed
                  ? `0 0 35px ${reward?.color}55, 0 0 60px ${reward?.color}22`
                  : '0 0 12px rgba(250,204,21,0.06)',
                cursor: revealedIndex === null ? 'pointer' : 'default',
              }}
              whileHover={revealedIndex === null ? { scale: 1.06, y: -6 } : {}}
              whileTap={revealedIndex === null ? { scale: 0.97 } : {}}
            >
              <AnimatePresence mode="wait">
                {!isRevealed ? (
                  <motion.div
                    key="back"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                    style={{ background: 'linear-gradient(160deg, rgba(12,6,50,0.99) 0%, rgba(6,3,28,0.99) 100%)' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <motion.div
                      className="text-3xl"
                      animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.95, 1.05, 0.95] }}
                      transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.4 }}
                    >
                      ✦
                    </motion.div>
                    <p className="text-[8px] font-garet tracking-[0.35em] text-yellow-400/40">TOQUE</p>
                    {/* corner accents */}
                    {[['top-1.5 left-1.5',true,false,true,false],['top-1.5 right-1.5',true,false,false,true],['bottom-1.5 left-1.5',false,true,true,false],['bottom-1.5 right-1.5',false,true,false,true]].map(([pos,bT,bB,bL,bR],ci) => (
                      <div key={ci} className={`absolute ${pos} w-2.5 h-2.5 pointer-events-none`} style={{ borderTop: bT ? '1px solid rgba(250,204,21,0.3)' : undefined, borderBottom: bB ? '1px solid rgba(250,204,21,0.3)' : undefined, borderLeft: bL ? '1px solid rgba(250,204,21,0.3)' : undefined, borderRight: bR ? '1px solid rgba(250,204,21,0.3)' : undefined }} />
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="front"
                    className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center gap-2"
                    style={{ background: `linear-gradient(160deg, ${reward?.color}20 0%, rgba(3,6,22,0.99) 100%)` }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.35, ease: 'backOut' }}
                  >
                    <motion.div
                      className="text-4xl"
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 0.6, repeat: 2 }}
                    >
                      {reward?.icon}
                    </motion.div>
                    <p className="text-[8px] font-garet tracking-widest leading-tight" style={{ color: reward?.color }}>
                      {reward?.title}
                    </p>
                    <p className="text-[8px] font-mono text-slate-300 whitespace-pre-line leading-relaxed">
                      {reward?.desc}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Claim button */}
      <div className="relative z-10 h-12 flex items-center">
        <AnimatePresence>
          {rewardType && (
            <motion.button
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: 'backOut' }}
              onClick={() => onClaim(rewardType)}
              className="px-10 py-3 rounded border-2 font-garet text-sm tracking-[0.3em] font-bold transition-colors"
              style={{
                borderColor: REWARDS[rewardType].color,
                color: REWARDS[rewardType].color,
                background: `${REWARDS[rewardType].color}15`,
                boxShadow: `0 0 25px ${REWARDS[rewardType].color}40`,
              }}
            >
              REIVINDICAR
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default DailyRewardModal;
