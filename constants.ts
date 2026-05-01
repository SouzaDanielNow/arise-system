import { Chapter, DungeonPart, HunterRank, Quest, RewardItem, Habit, AnalyticsData, SystemQuote, Shadow, ShadowRank, ShadowRole, ShadowMission } from './types';

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

export const RANK_THRESHOLDS = {
  [HunterRank.E]: 0,
  [HunterRank.D]: 750,
  [HunterRank.C]: 2250,
  [HunterRank.B]: 5250,
  [HunterRank.A]: 7000,
  [HunterRank.S]: 15000,
  [HunterRank.SS]: 30000,
  [HunterRank.SSS]: 60000,
  [HunterRank.NACIONAL]: 120000,
  [HunterRank.MONARCA]: 250000,
};

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

export const MOCK_WEEKLY_DATA: AnalyticsData[] = [
  { day: 'MON', xp: 150, focusMinutes: 45 },
  { day: 'TUE', xp: 300, focusMinutes: 90 },
  { day: 'WED', xp: 100, focusMinutes: 30 },
  { day: 'THU', xp: 450, focusMinutes: 120 },
  { day: 'FRI', xp: 200, focusMinutes: 60 },
  { day: 'SAT', xp: 600, focusMinutes: 180 },
  { day: 'SUN', xp: 0, focusMinutes: 0 },
];

export const INITIAL_CHAPTERS: Chapter[] = [
  { id: '1-1', title: 'The Solar System', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: true },
  { id: '1-2', title: 'The Earth', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-3', title: 'Projections', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-4', title: 'Convergency', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-5', title: 'Time', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-6', title: 'Compass and Directions', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-7', title: 'Distances on Earth Surface', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-8', title: 'Magnetism and Compasses', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-9', title: 'Dead Reckoning Navigation (DR)', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-10', title: 'Measurement of DR Elements (Pressure)', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-11', title: 'Determination of Temperature', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-12', title: 'Measurement of Elements', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-13', title: 'In-flight Navigation', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-14', title: 'Mass and Balance', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-15', title: 'Performance', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '1-16', title: 'Flight Planning and Monitoring', part: DungeonPart.ONE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-1', title: 'Air Data Systems', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-2', title: 'Altimeter', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-3', title: 'Air Speed Indicator (ASI)', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-4', title: 'Vertical Speed Indicator (VSI)', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-5', title: 'Gyroscopes', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-6', title: 'Inertial Navigation', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-7', title: 'Radio/Radar Altimeter', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-8', title: 'Power Plant & Monitoring', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '2-9', title: 'Electronic Displays', part: DungeonPart.TWO, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-1', title: 'Basic Radio Theory', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-2', title: 'ADF / NDB', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-3', title: 'Track and Drift', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-4', title: 'VOR', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-5', title: 'VOR / RMI / ADF Related', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-6', title: 'Holding & Intercepts', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-7', title: 'ILS (Instrument Landing System)', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-8', title: 'Radar', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-9', title: 'GNSS / GPS', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: '3-10', title: 'Nav Aids Summary', part: DungeonPart.THREE, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
  { id: 'BOSS-1', title: 'DGCA MOCK EXAM', part: DungeonPart.BOSS, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
];

export const DAILY_QUESTS: Quest[] = [
  { id: 'dq-1', description: 'Complete 1 Dungeon Run', target: 1, current: 0, isCompleted: false, rewardXp: 100, rewardStat: '1' },
  { id: 'dq-2', description: 'Review a Shadow (Cleared Chapter)', target: 1, current: 0, isCompleted: false, rewardXp: 50, rewardStat: '2' }
];

export const getNextRank = (xp: number): HunterRank => {
  if (xp >= RANK_THRESHOLDS[HunterRank.MONARCA]) return HunterRank.MONARCA;
  if (xp >= RANK_THRESHOLDS[HunterRank.NACIONAL]) return HunterRank.NACIONAL;
  if (xp >= RANK_THRESHOLDS[HunterRank.SSS]) return HunterRank.SSS;
  if (xp >= RANK_THRESHOLDS[HunterRank.SS]) return HunterRank.SS;
  if (xp >= RANK_THRESHOLDS[HunterRank.S]) return HunterRank.S;
  if (xp >= RANK_THRESHOLDS[HunterRank.A]) return HunterRank.A;
  if (xp >= RANK_THRESHOLDS[HunterRank.B]) return HunterRank.B;
  if (xp >= RANK_THRESHOLDS[HunterRank.C]) return HunterRank.C;
  if (xp >= RANK_THRESHOLDS[HunterRank.D]) return HunterRank.D;
  return HunterRank.E;
};

export const getNextRankXp = (rank: HunterRank): number | null => {
  const ranks = Object.values(HunterRank);
  const idx = ranks.indexOf(rank);
  if (idx >= ranks.length - 1) return null;
  return RANK_THRESHOLDS[ranks[idx + 1]];
};

export const getXpProgress = (currentXp: number, rank: HunterRank): number => {
  const currentThreshold = RANK_THRESHOLDS[rank];
  const ranks = Object.values(HunterRank);
  const currentIndex = ranks.indexOf(rank);
  if (currentIndex >= ranks.length - 1) return 100;
  const nextThreshold = RANK_THRESHOLDS[ranks[currentIndex + 1]];
  const denominator = nextThreshold - currentThreshold;
  if (denominator <= 0) return 100;
  return Math.min(100, Math.max(0, ((currentXp - currentThreshold) / denominator) * 100));
};

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
