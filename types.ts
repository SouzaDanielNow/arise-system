export enum HunterRank {
  E = 'E',
  D = 'D',
  C = 'C',
  B = 'B',
  A = 'A',
  S = 'S',
  SS = 'SS',
  SSS = 'SSS',
  NACIONAL = 'NACIONAL',
  MONARCA = 'MONARCA',
}


export interface CustomStat {
  id: string;
  name: string;
  emoji: string;
  color: string;
  value: number;
}

export interface HunterProfile {
  name: string;
  rank: HunterRank;
  currentXp: number;
  customStats: CustomStat[];
  streakDays: number;
  lastLoginDate: string;
  gold: number;
  weeklyGymProgress: boolean[];
  shadows: Shadow[];
  avatarUrl?: string;
  availableStatPoints?: number;
  lastCompletionDate?: string;
  weeklyHistory?: { date: string; completed: number }[];
}


export interface Quest {
  id: string;
  description: string;
  target: number;
  current: number;
  isCompleted: boolean;
  rewardXp: number;
  rewardStat: string;
  questType?: 'daily' | 'oneTime';
}

export interface BossSubTask {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
}

export interface BossHistoryEntry {
  id: string;
  timestamp: string;
  action: 'started' | 'completed' | 'uncompleted';
  subTaskTitle?: string;
}

export interface BossFight {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  goldReward: number;
  startDate: string;
  dueDate: string;
  progress: number;
  subTasks: BossSubTask[];
  history: BossHistoryEntry[];
  status: 'active' | 'completed' | 'failed';
  failPenalty: 'loseStreak';
}

export interface RewardItem {
  id: string;
  name: string;
  cost: number;
  description: string;
  icon: string;
}

export type ShadowRank = 'Infantaria' | 'Elite' | 'Cavaleiro' | 'Comandante';
export type ShadowRole = 'Tank' | 'Guerreiro' | 'Assassino' | 'Mago';
export type ShadowStatus = 'Pronta' | 'Em Missão' | 'Treinando' | 'Regenerando';

export interface Shadow {
  id: string;
  name: string;
  level: number;
  xp: number;
  rank: ShadowRank;
  role: ShadowRole;
  basePower: number;
  status: ShadowStatus;
  returnTime?: number;
  missionChance?: number;
  missionRewardXP?: number;
  missionRewardGold?: number;
}

export interface ShadowMission {
  id: string;
  title: string;
  requiredPower: number;
  recommendedRole: ShadowRole;
  durationHours: number;
  rewardGold: number;
  rewardXP: number;
}

export type RepeatType = 'daily' | 'weekdays' | 'custom' | 'oneTime';

export interface Habit {
  id: string;
  title: string;
  isCompleted: boolean;
  streak: number;
  repeatType: RepeatType;
  repeatDays?: number[];
}

export interface AnalyticsData {
  day: string;
  xp: number;
  focusMinutes: number;
}

export interface SystemQuote {
  text: string;
  author: string;
}

export type ViewState = 'DASHBOARD' | 'SHADOW_ARMY' | 'SHOP' | 'SETTINGS' | 'MISSIONS' | 'IDENTITY';

export interface BonusMission {
  id: string;
  title: string;
  description: string;
  rewardXp: number;
  rewardGold: number;
  isCompleted: boolean;
  generatedDate: string;
}

export interface GameState {
  profile: HunterProfile;
  habits: Habit[];
  bossFights: BossFight[];
  bonusMissions?: BonusMission[];
  quests?: Quest[];
}
