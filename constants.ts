import { HunterRank, RewardItem, Habit, SystemQuote, Shadow, ShadowRank, ShadowRole, ShadowMission, InventoryItem } from './types';

export const RANK_COLORS: Record<HunterRank, string> = {
  [HunterRank.E]: '#9ca3af',
  [HunterRank.D]: '#10b981',
  [HunterRank.C]: '#3b82f6',
  [HunterRank.B]: '#8b5cf6',
  [HunterRank.A]: '#ec4899',
  [HunterRank.S]: '#facc15',
  [HunterRank.SS]: '#f97316',
  [HunterRank.SSS]: '#ef4444',
  [HunterRank.NACIONAL]: '#c084fc',
  [HunterRank.MONARCA]: '#e2e8f0',
};

export const STAT_COLOR_PALETTE = [
  '#ff6b6b', '#4ecdc4', '#ffd93d', '#9b59b6',
  '#3b82f6', '#10b981', '#f97316', '#ec4899',
];

// ── Nível → Rank (cada rank abrange 20 níveis) ───────────────────────────────
export const RANK_LEVEL_THRESHOLDS: Record<HunterRank, number> = {
  [HunterRank.E]:        1,
  [HunterRank.D]:       20,
  [HunterRank.C]:       40,
  [HunterRank.B]:       60,
  [HunterRank.A]:       80,
  [HunterRank.S]:      100,
  [HunterRank.SS]:     120,
  [HunterRank.SSS]:    140,
  [HunterRank.NACIONAL]:160,
  [HunterRank.MONARCA]: 180,
};

// ── XP necessário para avançar do nível `lv` para o próximo ─────────────────
export const xpForLevel = (lv: number): number =>
  Math.floor(200 + Math.pow(lv, 2) * 3);

// ── Decompõe XP total em { level, xpIntoLevel, xpForNextLevel } ─────────────
export function getLevelFromXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNextLevel: number } {
  let level = 1;
  let remaining = totalXp;
  while (true) {
    const needed = xpForLevel(level);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: xpForLevel(level) };
}

// ── XP total acumulado necessário para CHEGAR ao nível `targetLevel` ─────────
export function getXpForLevel(targetLevel: number): number {
  let total = 0;
  for (let l = 1; l < targetLevel; l++) total += xpForLevel(l);
  return total;
}

// ── Rank derivado do nível ────────────────────────────────────────────────────
export function getRankFromLevel(level: number): HunterRank {
  if (level >= 180) return HunterRank.MONARCA;
  if (level >= 160) return HunterRank.NACIONAL;
  if (level >= 140) return HunterRank.SSS;
  if (level >= 120) return HunterRank.SS;
  if (level >= 100) return HunterRank.S;
  if (level >= 80)  return HunterRank.A;
  if (level >= 60)  return HunterRank.B;
  if (level >= 40)  return HunterRank.C;
  if (level >= 20)  return HunterRank.D;
  return HunterRank.E;
}

// ── Multiplicador de recompensa por rank (preparação Etapa 2) ─────────────────
export const RANK_MULTIPLIERS: Record<HunterRank, number> = {
  [HunterRank.E]:        1.0,
  [HunterRank.D]:        1.2,
  [HunterRank.C]:        1.5,
  [HunterRank.B]:        2.0,
  [HunterRank.A]:        3.0,
  [HunterRank.S]:        5.0,
  [HunterRank.SS]:       7.0,
  [HunterRank.SSS]:     10.0,
  [HunterRank.NACIONAL]:15.0,
  [HunterRank.MONARCA]: 25.0,
};

export function getRankMultiplier(rank: HunterRank): number {
  return RANK_MULTIPLIERS[rank];
}

export const GYM_TARGET_DAYS = [0, 1, 2, 4, 5];

export const INITIAL_REWARDS: RewardItem[] = [
  { id: 'r-1', name: 'Diet Coke', cost: 50, description: 'A refreshing zero-sugar boost.', icon: '🥤' },
  { id: 'r-2', name: 'Protein Bar', cost: 100, description: 'Restore stamina after a workout.', icon: '🍫' },
  { id: 'r-3', name: '1 Hour Gaming', cost: 200, description: 'Mental recovery time.', icon: '🎮' },
  { id: 'r-4', name: 'Cheat Meal', cost: 500, description: 'A reward for a week of hard work.', icon: '🍔' },
  { id: 'r-5', name: 'New Book', cost: 800, description: 'Expand your knowledge.', icon: '📚' },
  { id: 'r-6', name: 'Movie Night', cost: 1000, description: 'Complete relaxation.', icon: '🎬' }
];

export const INITIAL_HABITS: Habit[] = [
  { id: 'h-1', title: 'Wake up at 5 AM', isCompleted: false, streak: 0, repeatType: 'daily' },
  { id: 'h-2', title: 'Deep Work (2 Hours)', isCompleted: false, streak: 0, repeatType: 'weekdays' },
  { id: 'h-3', title: 'No Sugar', isCompleted: false, streak: 0, repeatType: 'daily' },
];

export const SYSTEM_QUOTES: SystemQuote[] = [
  { text: "A hunter does not choose their battlefield. They conquer it.", author: "The System" },
  { text: "Fear is not a wall. It is a gate. Open it.", author: "Shadow Monarch" },
  { text: "The weak make excuses. The strong make history.", author: "The System" },
  { text: "Only those who are prepared to die are fit to kill.", author: "Unknown Hunter" },
  { text: "Your limit is an illusion created by your weakness.", author: "The System" },
  { text: "To lead the shadows, you must first become the light.", author: "Shadow Monarch" },
  { text: "Do not pray for an easy life. Pray for the strength to endure a difficult one.", author: "The System" },
  { text: "Rank is not given. It is taken.", author: "S-Rank Hunter" }
];



// ── Shadow Army ──────────────────────────────────────────────────────────────

export const SHADOW_RANK_COLORS: Record<ShadowRank, string> = {
  Infantaria: '#64748b',
  Elite:      '#10b981',
  Cavaleiro:  '#3b82f6',
  Comandante: '#f59e0b',
};

const SHADOW_NAMES: Record<ShadowRank, string[]> = {
  Infantaria: ['Soldado Orc', 'Goblin Guerreiro', 'Espectro Menor', 'Zumbi Orc', 'Lobo das Trevas', 'Esqueleto Armado', 'Verme das Sombras'],
  Elite:      ['Lobo das Sombras', 'Cavaleiro Morto', 'Espectro Élite', 'Gargoyle Negro', 'Golem de Sombra', 'Arqueiro Espectral'],
  Cavaleiro:  ['Cavaleiro das Sombras', 'Lich Menor', 'Berserker Espectral', 'Dragão das Sombras', 'Guardião Negro'],
  Comandante: ['Igris', 'Beru', 'Iron', 'Bellion', 'Greed', 'Kaisel', 'Tusk'],
};

const SHADOW_ROLES: ShadowRole[] = ['Tank', 'Guerreiro', 'Assassino', 'Mago'];

const SHADOW_POWER_RANGES: Record<ShadowRank, [number, number]> = {
  Infantaria: [5, 10],
  Elite:      [15, 30],
  Cavaleiro:  [40, 70],
  Comandante: [100, 150],
};

export function extractShadow(): Shadow {
  const roll = Math.random() * 100;
  const rank: ShadowRank =
    roll < 70  ? 'Infantaria' :
    roll < 90  ? 'Elite'      :
    roll < 99  ? 'Cavaleiro'  : 'Comandante';

  const role = SHADOW_ROLES[Math.floor(Math.random() * 4)];
  const [min, max] = SHADOW_POWER_RANGES[rank];
  const basePower = Math.floor(Math.random() * (max - min + 1)) + min;
  const names = SHADOW_NAMES[rank];
  const name = names[Math.floor(Math.random() * names.length)];

  return {
    id: `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    level: 1,
    xp: 0,
    rank,
    role,
    basePower,
    status: 'Pronta',
  };
}

// ── Shadow Missions ───────────────────────────────────────────────────────────

const SHADOW_MISSION_POOL: Omit<ShadowMission, 'id'>[] = [
  { title: 'Patrulhar o Portão Sombrio',         requiredPower: 15,  recommendedRole: 'Tank',      durationHours: 1,   rewardGold: 40,  rewardXP: 25  },
  { title: 'Emboscar Batedores Demoníacos',      requiredPower: 30,  recommendedRole: 'Assassino', durationHours: 2,   rewardGold: 70,  rewardXP: 50  },
  { title: 'Defender o Reino das Sombras',       requiredPower: 50,  recommendedRole: 'Tank',      durationHours: 3,   rewardGold: 100, rewardXP: 75  },
  { title: 'Caçar o Mago Renegado',              requiredPower: 40,  recommendedRole: 'Mago',      durationHours: 2,   rewardGold: 80,  rewardXP: 60  },
  { title: 'Escolta do Comboio das Sombras',     requiredPower: 20,  recommendedRole: 'Guerreiro', durationHours: 1.5, rewardGold: 55,  rewardXP: 35  },
  { title: 'Infiltrar a Torre do Lich',          requiredPower: 60,  recommendedRole: 'Assassino', durationHours: 4,   rewardGold: 130, rewardXP: 100 },
  { title: 'Coletar Cristais de Mana',           requiredPower: 12,  recommendedRole: 'Mago',      durationHours: 1,   rewardGold: 35,  rewardXP: 20  },
  { title: 'Suprimir a Rebelião dos Mortos-Vivos', requiredPower: 45, recommendedRole: 'Guerreiro', durationHours: 3,  rewardGold: 90,  rewardXP: 65  },
  { title: 'Limpar as Catacumbas Amaldiçoadas',  requiredPower: 35,  recommendedRole: 'Tank',      durationHours: 2.5, rewardGold: 75,  rewardXP: 55  },
  { title: 'Rastrear o Assassino Fantasma',      requiredPower: 55,  recommendedRole: 'Assassino', durationHours: 3.5, rewardGold: 115, rewardXP: 85  },
  { title: 'Invasão ao Acampamento Orc',         requiredPower: 25,  recommendedRole: 'Guerreiro', durationHours: 1.5, rewardGold: 60,  rewardXP: 40  },
  { title: 'Exploração da Masmorra de Classe C', requiredPower: 38,  recommendedRole: 'Mago',      durationHours: 2.5, rewardGold: 85,  rewardXP: 58  },
  { title: 'Eliminar o Espectro Corrompido',     requiredPower: 22,  recommendedRole: 'Assassino', durationHours: 1.5, rewardGold: 55,  rewardXP: 38  },
  { title: 'Recuperar Artefato Perdido',         requiredPower: 18,  recommendedRole: 'Mago',      durationHours: 1,   rewardGold: 45,  rewardXP: 30  },
  { title: 'Conter Avanço dos Servos das Trevas', requiredPower: 65, recommendedRole: 'Tank',      durationHours: 4,   rewardGold: 140, rewardXP: 105 },
];

export function generateDailyMissions(): ShadowMission[] {
  const shuffled = [...SHADOW_MISSION_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((m, i) => ({
    ...m,
    id: `sm-${Date.now()}-${i}`,
  }));
}

// ── Rarity ────────────────────────────────────────────────────────────────────

export const RARITY_COLORS: Record<InventoryItem['rarity'], string> = {
  common:    '#9ca3af',
  rare:      '#3b82f6',
  epic:      '#8b5cf6',
  legendary: '#f59e0b',
};

export const RARITY_LABELS: Record<InventoryItem['rarity'], string> = {
  common:    'COMUM',
  rare:      'RARO',
  epic:      'ÉPICO',
  legendary: 'LENDÁRIO',
};

// ── Catálogo de Itens Físicos (vai para o Cofre) ──────────────────────────────

type PhysicalTemplate = Omit<InventoryItem, 'quantity'>;

export const PHYSICAL_ITEMS: PhysicalTemplate[] = [
  { id: 'potion-vitality',  name: 'Poção de Vitalidade das Sombras', icon: '🧪', type: 'consumable', rarity: 'common',    effect: 'Recupera energia das sombras.' },
  { id: 'scroll-prosperity',name: 'Pergaminho da Prosperidade',       icon: '📜', type: 'consumable', rarity: 'rare',      effect: 'Aumenta recompensas temporariamente.', maxStack: 3 },
  { id: 'key-dungeon',      name: 'Chave de Masmorra Dimensional',    icon: '🗝️', type: 'consumable', rarity: 'rare',      effect: 'Abre portais de masmorra especial.', maxStack: 2 },
  { id: 'stone-offense',    name: 'Pedra de Proteção da Ofensiva',    icon: '💎', type: 'passive',    rarity: 'epic',      effect: 'Escudo que converte dano em força.', maxStack: 1 },
  { id: 'elixir-ascension', name: 'Elixir da Ascensão',               icon: '⚗️', type: 'consumable', rarity: 'epic',      effect: 'Acelera drasticamente a progressão.', maxStack: 1 },
  { id: 'crown-shadows',    name: 'Coroa das Sombras',                icon: '👑', type: 'passive',    rarity: 'legendary', effect: 'O símbolo do Monarca. Poder incomparável.', maxStack: 1 },
];

// ── Loot Pool (cartas diárias) ────────────────────────────────────────────────

export type LootKind =
  | { tag: 'gold';     amount: number }
  | { tag: 'xp';       base: number   }
  | { tag: 'physical'; itemId: string };

export interface LootEntry {
  id: string;
  name: string;
  icon: string;
  rarity: InventoryItem['rarity'];
  weight: number;
  kind: LootKind;
  desc: string;
}

export const LOOT_POOL: LootEntry[] = [
  // Auto-consumível: Gold (sem multiplicador)
  { id: 'coins-bag',       name: 'Saco de Moedas',                    icon: '💰', rarity: 'common',    weight: 200, kind: { tag: 'gold', amount:  30  }, desc: '+30 Gold'  },
  { id: 'gold-nugget',     name: 'Pepita de Ouro',                    icon: '🪙', rarity: 'common',    weight: 150, kind: { tag: 'gold', amount:  60  }, desc: '+60 Gold'  },
  { id: 'gold-bar',        name: 'Barra de Ouro',                     icon: '🏅', rarity: 'rare',      weight:  80, kind: { tag: 'gold', amount: 120  }, desc: '+120 Gold' },
  { id: 'treasure-chest',  name: 'Baú do Tesouro',                    icon: '🎁', rarity: 'rare',      weight:  30, kind: { tag: 'gold', amount: 250  }, desc: '+250 Gold' },
  // Auto-consumível: XP (com multiplicador de rank)
  { id: 'mana-pill',       name: 'Pílula de Mana',                    icon: '💊', rarity: 'common',    weight: 180, kind: { tag: 'xp',   base:   30  }, desc: '30 XP × rank' },
  { id: 'essence-crystal', name: 'Cristal de Essência',               icon: '🔮', rarity: 'common',    weight: 130, kind: { tag: 'xp',   base:   60  }, desc: '60 XP × rank' },
  { id: 'star-fragment',   name: 'Fragmento de Estrela',              icon: '⭐', rarity: 'epic',      weight:  60, kind: { tag: 'xp',   base:  120  }, desc: '120 XP × rank' },
  { id: 'boss-core',       name: 'Núcleo de Vida do Boss',            icon: '💠', rarity: 'legendary', weight:  15, kind: { tag: 'xp',   base:  250  }, desc: '250 XP × rank' },
  // Físico (vai para o Cofre)
  { id: 'item-potion',     name: 'Poção de Vitalidade das Sombras',   icon: '🧪', rarity: 'common',    weight:  70, kind: { tag: 'physical', itemId: 'potion-vitality'   }, desc: 'Item de Cofre' },
  { id: 'item-scroll',     name: 'Pergaminho da Prosperidade',        icon: '📜', rarity: 'rare',      weight:  40, kind: { tag: 'physical', itemId: 'scroll-prosperity'  }, desc: 'Item de Cofre' },
  { id: 'item-key',        name: 'Chave de Masmorra Dimensional',     icon: '🗝️', rarity: 'rare',      weight:  30, kind: { tag: 'physical', itemId: 'key-dungeon'        }, desc: 'Item de Cofre' },
  { id: 'item-stone',      name: 'Pedra de Proteção da Ofensiva',     icon: '💎', rarity: 'epic',      weight:   8, kind: { tag: 'physical', itemId: 'stone-offense'      }, desc: 'Item de Cofre' },
  { id: 'item-elixir',     name: 'Elixir da Ascensão',                icon: '⚗️', rarity: 'epic',      weight:   5, kind: { tag: 'physical', itemId: 'elixir-ascension'   }, desc: 'Item de Cofre' },
  { id: 'item-crown',      name: 'Coroa das Sombras',                 icon: '👑', rarity: 'legendary', weight:   2, kind: { tag: 'physical', itemId: 'crown-shadows'      }, desc: 'Item de Cofre' },
];

export function rollLoot(): LootEntry {
  const total = LOOT_POOL.reduce((sum, e) => sum + e.weight, 0);
  let rand = Math.random() * total;
  for (const entry of LOOT_POOL) {
    rand -= entry.weight;
    if (rand <= 0) return entry;
  }
  return LOOT_POOL[0];
}

// ── Boss Rank Calculator ──────────────────────────────────────────────────────

export const RANK_ORDER: HunterRank[] = [
  HunterRank.E, HunterRank.D, HunterRank.C, HunterRank.B, HunterRank.A,
  HunterRank.S, HunterRank.SS, HunterRank.SSS, HunterRank.NACIONAL, HunterRank.MONARCA,
];

export function calculateBossRank(
  playerRankIndex: number,
  daysDeadline: number,
  subtaskCount: number,
): HunterRank {
  const maxIndex = RANK_ORDER.length - 1;
  if (daysDeadline >= 60 && subtaskCount >= 1) return RANK_ORDER[Math.min(playerRankIndex + 2, maxIndex)];
  if (daysDeadline >= 21 && subtaskCount >= 1) return RANK_ORDER[Math.min(playerRankIndex + 1, maxIndex)];
  return RANK_ORDER[Math.min(playerRankIndex, maxIndex)];
}
