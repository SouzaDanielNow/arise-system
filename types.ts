

export enum HunterRank {
  E = 'E',
  D = 'D',
  C = 'C',
  B = 'B',
  A = 'A',
  S = 'S'
}

export enum DungeonPart {
  ONE = 'Part I: General Navigation',
  TWO = 'Part II: Aircraft Instruments',
  THREE = 'Part III: Radio Navigation',
  BOSS = 'S-Rank Gate: DGCA Final Exam'
}

export interface Stats {
  intelligence: number; // INT: Radio Nav
  perception: number;   // PER: General Nav
  vitality: number;     // VIT: Streak/Endurance
  agility: number;      // AGI: Instruments
}

export interface HunterProfile {
  name: string;
  rank: HunterRank;
  level: number;
  currentXp: number;
  requiredXp: number;
  stats: Stats;
  streakDays: number;
  lastLoginDate: string;
  gold: number;
  weeklyGymProgress: boolean[]; // Array of 7 booleans (Mon-Sun)
}

export interface Chapter {
  id: string;
  title: string;
  part: string; // Changed from DungeonPart to string to allow custom parts
  isCleared: boolean;
  masteryLevel: number; // 0-100%
  timeSpentMinutes: number;
  unlocked: boolean;
}

export interface Quest {
  id: string;
  description: string;
  target: number;
  current: number;
  isCompleted: boolean;
  rewardXp: number;
  rewardStat: keyof Stats;
}

export interface RewardItem {
  id: string;
  name: string;
  cost: number;
  description: string;
  icon: string; // Emoji or Icon name
}

export interface Habit {
  id: string;
  title: string;
  type: 'good' | 'bad'; // 'good' = buff (do it), 'bad' = debuff (avoid it)
  isCompleted: boolean; // For good: done? For bad: done (failed)?
  streak: number;
}

export interface AnalyticsData {
  day: string;
  xp: number;
  focusMinutes: number;
}

export interface SystemQuote {
  text: string;
  author: string; // usually 'The System' or 'Shadow Monarch'
}

export type ViewState = 'DASHBOARD' | 'DUNGEON_MAP' | 'ACTIVE_DUNGEON' | 'SHADOW_ARMY' | 'SHADOW_REVIEW' | 'SHOP' | 'LIFESTYLE';