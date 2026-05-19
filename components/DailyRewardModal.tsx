import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HunterRank } from '../types';
import {
  LootEntry, rollLoot, RARITY_COLORS, RARITY_LABELS,
  getRankMultiplier, PHYSICAL_ITEMS,
} from '../constants';

interface Props {
  rank: HunterRank;
  onClaim: (loot: LootEntry) => void;
}

function getDisplayDesc(entry: LootEntry, rank: HunterRank): string {
  if (entry.kind.tag === 'gold') return `+${entry.kind.amount} Gold`;
  if (entry.kind.tag === 'xp') {
    const xp = Math.floor(entry.kind.base * getRankMultiplier(rank));
    return `+${xp} XP`;
  }
  if (entry.kind.tag === 'physical') {
    const itemId = entry.kind.itemId;
    return PHYSICAL_ITEMS.find(p => p.id === itemId)?.effect ?? 'Item de Cofre';
  }
  return '';
}

const DailyRewardModal: React.FC<Props> = ({ rank, onClaim }) => {
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  // Pre-roll 3 items on mount — stable for the lifetime of the modal
  const [rolledItems] = useState<LootEntry[]>(() => [rollLoot(), rollLoot(), rollLoot()]);

  const handleCardClick = (index: number) => {
    if (revealedIndex !== null) return;
    setRevealedIndex(index);
  };

  const selectedLoot = revealedIndex !== null ? rolledItems[revealedIndex] : null;

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
          const loot = rolledItems[i];
          const rarityColor = isRevealed ? RARITY_COLORS[loot.rarity] : undefined;
          const isBlocked = revealedIndex !== null && !isRevealed;

          return (
            <motion.div
              key={i}
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: isBlocked ? 0.3 : 1 }}
              transition={{ delay: 0.2 + i * 0.12, duration: 0.5 }}
              onClick={() => handleCardClick(i)}
              className="relative w-28 h-48 rounded-xl overflow-hidden select-none"
              style={{
                border: isRevealed
                  ? `2px solid ${rarityColor}`
                  : '1px solid rgba(250,204,21,0.2)',
                boxShadow: isRevealed
                  ? `0 0 35px ${rarityColor}55, 0 0 60px ${rarityColor}22`
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
                    {/* Corner accents */}
                    {[['top-1.5 left-1.5', true, false, true, false], ['top-1.5 right-1.5', true, false, false, true], ['bottom-1.5 left-1.5', false, true, true, false], ['bottom-1.5 right-1.5', false, true, false, true]].map(([pos, bT, bB, bL, bR], ci) => (
                      <div key={ci} className={`absolute ${pos} w-2.5 h-2.5 pointer-events-none`} style={{ borderTop: bT ? '1px solid rgba(250,204,21,0.3)' : undefined, borderBottom: bB ? '1px solid rgba(250,204,21,0.3)' : undefined, borderLeft: bL ? '1px solid rgba(250,204,21,0.3)' : undefined, borderRight: bR ? '1px solid rgba(250,204,21,0.3)' : undefined }} />
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="front"
                    className="absolute inset-0 flex flex-col items-center justify-center p-2.5 text-center gap-1.5"
                    style={{ background: `linear-gradient(160deg, ${rarityColor}20 0%, rgba(3,6,22,0.99) 100%)` }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.35, ease: 'backOut' }}
                  >
                    {/* Rarity badge */}
                    <p
                      className="text-[7px] font-garet tracking-widest border rounded-sm px-1.5 py-0.5"
                      style={{ color: rarityColor, borderColor: `${rarityColor}60` }}
                    >
                      {RARITY_LABELS[loot.rarity]}
                    </p>

                    {/* Icon */}
                    <motion.div
                      className="my-0.5"
                      animate={{ scale: [1, 1.12, 1] }}
                      transition={{ duration: 0.6, repeat: 2 }}
                    >
                      <img src={loot.icon} alt={loot.name} className="w-12 h-12 object-contain" />
                    </motion.div>

                    {/* Name */}
                    <p className="text-[7.5px] font-garet tracking-wide leading-tight" style={{ color: rarityColor }}>
                      {loot.name}
                    </p>

                    {/* Desc */}
                    <p className="text-[8px] font-mono text-slate-300 leading-snug">
                      {getDisplayDesc(loot, rank)}
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
          {selectedLoot && (
            <motion.button
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: 'backOut' }}
              onClick={() => onClaim(selectedLoot)}
              className="px-10 py-3 rounded border-2 font-garet text-sm tracking-[0.3em] font-bold transition-colors"
              style={{
                borderColor: RARITY_COLORS[selectedLoot.rarity],
                color: RARITY_COLORS[selectedLoot.rarity],
                background: `${RARITY_COLORS[selectedLoot.rarity]}15`,
                boxShadow: `0 0 25px ${RARITY_COLORS[selectedLoot.rarity]}40`,
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
