import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, type Blob as GenAIBlob } from "@google/genai";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { 
  Shield, 
  Map as MapIcon, 
  Sword, 
  BookOpen, 
  User, 
  Zap, 
  Menu, 
  Trophy,
  Brain,
  Activity,
  Eye,
  Wind,
  Ghost,
  AlertTriangle,
  RotateCw,
  Crown,
  ShoppingBag,
  Dumbbell,
  Coins,
  Edit3,
  Check,
  Plus,
  Upload,
  FileText,
  Loader,
  Mic,
  MicOff,
  Heart,
  Skull,
  BarChart2,
  Globe,
  Quote
} from 'lucide-react';
import { 
  HunterProfile, 
  Chapter, 
  Quest, 
  ViewState, 
  HunterRank, 
  DungeonPart, 
  Stats,
  RewardItem,
  Habit,
  SystemQuote,
  AnalyticsData
} from './types';
import { 
  INITIAL_CHAPTERS, 
  DAILY_QUESTS, 
  INITIAL_STATS, 
  RANK_THRESHOLDS, 
  INITIAL_REWARDS,
  GYM_TARGET_DAYS,
  INITIAL_HABITS,
  SYSTEM_QUOTES,
  MOCK_WEEKLY_DATA,
  getNextRank, 
  getXpProgress 
} from './constants';
import StatRadar from './components/StatRadar';
import SystemNotification, { NotificationType } from './components/SystemNotification';

// --- Audio Helper Functions for Gemini Live API ---
function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  const uint8 = new Uint8Array(int16.buffer);
  
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);

  return {
    data: base64,
    mimeType: 'audio/pcm;rate=16000',
  };
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  // --- State ---
  const [view, setView] = useState<ViewState>('DASHBOARD');
  const [chapters, setChapters] = useState<Chapter[]>(INITIAL_CHAPTERS);
  const [quests, setQuests] = useState<Quest[]>(DAILY_QUESTS);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [habits, setHabits] = useState<Habit[]>(INITIAL_HABITS);
  
  // Hunter Profile State
  const [profile, setProfile] = useState<HunterProfile>({
    name: 'Jin-Woo',
    rank: HunterRank.E,
    level: 1,
    currentXp: 0,
    requiredXp: 500,
    stats: INITIAL_STATS,
    streakDays: 5, 
    lastLoginDate: new Date().toISOString(),
    gold: 0,
    weeklyGymProgress: [false, false, false, false, false, false, false] // Mon-Sun
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(profile.name);
  const [newHabitTitle, setNewHabitTitle] = useState('');

  // Daily Quote State
  const [dailyQuote, setDailyQuote] = useState<SystemQuote>(SYSTEM_QUOTES[0]);

  // Report Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTab, setReportTab] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');

  // Upload/System Architect State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);

  // System Notification
  const [notification, setNotification] = useState<{msg: string, sub?: string, type?: NotificationType} | null>(null);

  // --- Gemini Live API State ---
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [isVoiceConnecting, setIsVoiceConnecting] = useState(false);
  const nextStartTime = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null); // To store the session object (simplified)
  
  // --- Effects ---
  useEffect(() => {
    // Select a random quote on mount
    const randomQuote = SYSTEM_QUOTES[Math.floor(Math.random() * SYSTEM_QUOTES.length)];
    setDailyQuote(randomQuote);
  }, []);

  // --- Logic Helpers ---

  const showNotification = (msg: string, sub?: string, type: NotificationType = 'info') => {
    setNotification({ msg, sub, type });
  };

  const addXp = (amount: number, statBonus?: keyof Stats) => {
    setProfile(prev => {
      let newXp = prev.currentXp + amount;
      let newRank = getNextRank(newXp);
      let didLevelUp = newRank !== prev.rank;
      
      const newStats = { ...prev.stats };
      if (statBonus) {
        newStats[statBonus] += 1;
      }

      if (didLevelUp) {
        setTimeout(() => {
          showNotification(
            `RANK UP: ${newRank}-RANK`, 
            "Your abilities have transcended their limits.",
            'levelup'
          );
        }, 500);
      }

      return {
        ...prev,
        currentXp: newXp,
        rank: newRank,
        stats: newStats
      };
    });
  };

  const addGold = (amount: number) => {
    setProfile(prev => ({ ...prev, gold: prev.gold + amount }));
  };

  // --- Voice / Live API Logic ---
  const connectToSystem = async () => {
    if (isVoiceConnected) {
      // Disconnect
      sessionRef.current?.close();
      audioContextRef.current?.close();
      inputAudioContextRef.current?.close();
      setIsVoiceConnected(false);
      return;
    }

    try {
      setIsVoiceConnecting(true);
      
      // Initialize Audio Contexts
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
          systemInstruction: `You are 'The System', an advanced AI interface for a Hunter (the user) who is training for the DGCA Navigation Exam. Your tone is calm, precise, and slightly game-like, similar to the System in Solo Leveling. Address the user as 'Player' or 'Hunter'. Encourage them to maintain their streak, complete dungeons (chapters), and stick to their protocols. Current Hunter Rank: ${profile.rank}.`,
        },
        callbacks: {
          onopen: () => {
            setIsVoiceConnected(true);
            setIsVoiceConnecting(false);
            showNotification("SYSTEM LINK ESTABLISHED", "Voice Interface Online.", 'info');

            // Setup Input Stream
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
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
              
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.start(nextStartTime.current);
              nextStartTime.current += buffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }
          },
          onclose: () => {
            setIsVoiceConnected(false);
            setIsVoiceConnecting(false);
          },
          onerror: (e) => {
            console.error(e);
            setIsVoiceConnected(false);
            setIsVoiceConnecting(false);
            showNotification("SYSTEM LINK FAILED", "Connection error.", 'warning');
          }
        }
      });
      
      // Store session logic if needed to close later
      sessionRef.current = {
        close: () => {
          // Since the SDK doesn't expose a clean close on the promise result easily in this pattern without await,
          // we rely on browser cleanup. In a full implementation, we'd handle the resolved session object.
          // For now, we just stop audio contexts to kill the stream effectively from user side.
          inputCtx.close();
          outputCtx.close();
          stream.getTracks().forEach(t => t.stop());
        }
      };

    } catch (e) {
      console.error(e);
      setIsVoiceConnecting(false);
      showNotification("ACCESS DENIED", "Microphone permission required for System Link.", 'warning');
    }
  };

  const completeQuest = (questId: string) => {
    setQuests(prev => prev.map(q => {
      if (q.id === questId && !q.isCompleted) {
        addXp(q.rewardXp, q.rewardStat);
        addGold(50); // Daily quests give gold
        setTimeout(() => showNotification("DAILY QUEST COMPLETE", `${q.description} (+50 Gold)`, 'quest'), 200);
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
          if (c.id === activeChapterId) {
            return { ...c, isCleared: true, masteryLevel: Math.min(100, c.masteryLevel + 25), unlocked: true };
          }
          return c;
        });

        const currentIdx = prev.findIndex(c => c.id === activeChapterId);
        if (currentIdx < prev.length - 1) {
           updated[currentIdx + 1].unlocked = true;
        }
        
        if (activeChapterId.startsWith('BOSS')) {
          showNotification("S-RANK GATE CLEARED", "You have conquered the System. You are now the Monarch of Navigation.", 'levelup');
        }

        return updated;
      });

      const chapter = chapters.find(c => c.id === activeChapterId);
      
      let statToBuff: keyof Stats = 'vitality';
      if (chapter?.part === DungeonPart.ONE) statToBuff = 'perception';
      if (chapter?.part === DungeonPart.TWO) statToBuff = 'agility';
      if (chapter?.part === DungeonPart.THREE) statToBuff = 'intelligence';

      addXp(chapter?.part === DungeonPart.BOSS ? 5000 : 150, statToBuff);
      addGold(chapter?.part === DungeonPart.BOSS ? 2000 : 100);
      
      setQuests(prev => prev.map(q => {
        if (q.id === 'dq-1' && !q.isCompleted) {
           return { ...q, current: q.current + 1 };
        }
        return q;
      }));
      
      const quest = quests.find(q => q.id === 'dq-1');
      if (quest && !quest.isCompleted && quest.current + 1 >= quest.target) {
        completeQuest('dq-1');
      }

      if (!activeChapterId.startsWith('BOSS')) {
        showNotification("DUNGEON CLEARED", "Rewards: XP, Stat Boost, Gold. Shadow Extracted.", 'quest');
      }
    } else {
      showNotification("ESCAPED DUNGEON", "You fled safely, but gained no rewards.");
    }
    
    setView('DUNGEON_MAP');
    setActiveChapterId(null);
  };

  const summonShadow = (chapterId: string) => {
    setActiveChapterId(chapterId);
    setView('SHADOW_REVIEW');
  };

  const completeShadowReview = () => {
    addXp(10);
    addGold(20);
    setQuests(prev => prev.map(q => {
      if (q.id === 'dq-2' && !q.isCompleted) {
         return { ...q, current: q.current + 1 };
      }
      return q;
    }));
    const quest = quests.find(q => q.id === 'dq-2');
    if (quest && !quest.isCompleted && quest.current + 1 >= quest.target) {
      completeQuest('dq-2');
    }
    
    showNotification("SHADOW REVIEW COMPLETE", "Knowledge reinforced. +20 Gold", 'info');
    setView('SHADOW_ARMY');
    setActiveChapterId(null);
  };

  // --- Gym Mechanics ---
  const toggleGymDay = (dayIndex: number) => {
    if (profile.weeklyGymProgress[dayIndex]) return;

    setProfile(prev => {
      const newProgress = [...prev.weeklyGymProgress];
      newProgress[dayIndex] = true;
      return { ...prev, weeklyGymProgress: newProgress };
    });

    addXp(50, 'vitality'); 
    addGold(75);
    showNotification("DAILY TRAINING COMPLETE", "Strength +1. Gold +75.", 'shield');
  };

  // --- Shop Mechanics ---
  const buyItem = (item: RewardItem) => {
    if (profile.gold >= item.cost) {
      setProfile(prev => ({ ...prev, gold: prev.gold - item.cost }));
      showNotification("ITEM PURCHASED", `You acquired ${item.name}. Enjoy your reward.`, 'quest');
    } else {
      showNotification("INSUFFICIENT FUNDS", "You need more Gold to purchase this item.", 'warning');
    }
  };

  // --- Habit / Lifestyle Mechanics ---
  const toggleHabit = (id: string) => {
    setHabits(prev => prev.map(h => {
      if (h.id === id && !h.isCompleted) {
        // Complete the habit
        const isGood = h.type === 'good';
        addXp(isGood ? 30 : 0);
        addGold(isGood ? 20 : -50); // Lose gold if you do a bad habit? 
        // Logic: Bad habit is 'Procrastination'. If you check it, you DID IT (failed).
        
        if (isGood) {
           showNotification("PROTOCOL ADHERED", `${h.title} (+30 XP)`, 'shield');
        } else {
           showNotification("PROTOCOL BREACHED", `${h.title} detected. Penalty applied.`, 'warning');
        }
        
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
      type: 'good',
      isCompleted: false,
      streak: 0
    };
    setHabits([...habits, newHabit]);
    setNewHabitTitle('');
    showNotification("NEW PROTOCOL ADDED", "System updated.", 'info');
  };

  // --- Vitality Mechanics ---
  const simulateStreakBreak = () => {
    const vitality = profile.stats.vitality;
    const retentionRate = Math.min(100, vitality) / 100;
    const currentStreak = profile.streakDays;
    
    if (currentStreak === 0) {
      showNotification("NO STREAK", "There is no streak to break.", 'info');
      return;
    }

    const retainedDays = Math.floor(currentStreak * retentionRate);
    const lostDays = currentStreak - retainedDays;

    setProfile(prev => ({
      ...prev,
      streakDays: retainedDays
    }));

    if (retainedDays > 0) {
      showNotification(
        "PASSIVE ACTIVATED: UNDYING WILL",
        `Missed a day? Vitality (Lvl ${vitality}) saved ${retainedDays} days.`,
        'shield'
      );
    } else {
      showNotification(
        "STREAK BROKEN",
        `Vitality too low to preserve streak. Progress reset to 0.`,
        'warning'
      );
    }
  };

  // --- Name Editing ---
  const saveName = () => {
    if (tempName.trim()) {
      setProfile(prev => ({ ...prev, name: tempName.trim() }));
    }
    setIsEditingName(false);
  };

  // --- System Architect / Upload ---
  const handleUpload = () => {
    if (!uploadTitle.trim()) return;
    
    setIsProcessingUpload(true);
    showNotification("SYSTEM ANALYSIS INITIATED", "Analyzing source material...", 'processing');

    setTimeout(() => {
      // Simulate creating a new dungeon
      const partName = `PART IV: ${uploadTitle.toUpperCase()}`;
      const newChapters: Chapter[] = [
        { id: `c-${Date.now()}-1`, title: `${uploadTitle} - Fundamentals`, part: partName, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: true },
        { id: `c-${Date.now()}-2`, title: `${uploadTitle} - Advanced Concepts`, part: partName, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
        { id: `c-${Date.now()}-3`, title: `${uploadTitle} - Practical Application`, part: partName, isCleared: false, masteryLevel: 0, timeSpentMinutes: 0, unlocked: false },
      ];

      setChapters(prev => [...prev.filter(c => c.part !== DungeonPart.BOSS), ...newChapters, ...prev.filter(c => c.part === DungeonPart.BOSS)]);
      setIsProcessingUpload(false);
      setShowUploadModal(false);
      setUploadTitle('');
      setUploadFile(null);
      setView('DUNGEON_MAP');
      showNotification("NEW DUNGEON GENERATED", `The System has created a plan for "${uploadTitle}".`, 'levelup');
    }, 2500);
  };

  // --- Helper: World Rank Logic ---
  const getGlobalStanding = (rank: HunterRank) => {
    switch(rank) {
      case HunterRank.E: return { percentile: 'Top 90%', msg: 'You are just a Commoner.' };
      case HunterRank.D: return { percentile: 'Top 60%', msg: 'You have potential.' };
      case HunterRank.C: return { percentile: 'Top 35%', msg: 'You are surpassing the masses.' };
      case HunterRank.B: return { percentile: 'Top 10%', msg: 'You are an Elite Hunter.' };
      case HunterRank.A: return { percentile: 'Top 1%', msg: 'You are a National Authority.' };
      case HunterRank.S: return { percentile: 'Top 0.01%', msg: 'You are a Monarch.' };
      default: return { percentile: 'Unknown', msg: 'System Error.' };
    }
  };

  // --- Render Modals ---
  const renderUploadModal = () => {
    if (!showUploadModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in">
        <div className="bg-system-panel border border-system-blue w-full max-w-lg p-6 rounded-lg shadow-[0_0_50px_rgba(59,130,246,0.3)] relative overflow-hidden">
          {/* Decorative scanline */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-system-blue to-transparent animate-slide-in-right"></div>

          <h2 className="text-2xl font-bold font-mono text-system-blue mb-6 flex items-center gap-2">
            <Brain size={24} /> SYSTEM ARCHITECT
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-slate-400 font-mono text-sm mb-1">GOAL / SKILL NAME</label>
              <input 
                type="text" 
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g., Master Python, Lose Weight, Read 'Atomic Habits'"
                className="w-full bg-slate-900 border border-slate-700 p-3 rounded text-white font-bold focus:border-system-blue outline-none transition-colors"
                autoFocus
              />
            </div>

            <div>
               <label className="block text-slate-400 font-mono text-sm mb-1">SOURCE MATERIAL (Optional)</label>
               <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 flex flex-col items-center justify-center text-slate-500 hover:border-system-blue/50 hover:bg-system-blue/5 transition-all cursor-pointer relative">
                 <input 
                   type="file" 
                   className="absolute inset-0 opacity-0 cursor-pointer"
                   onChange={(e) => setUploadFile(e.target.files ? e.target.files[0] : null)}
                 />
                 <Upload size={32} className="mb-2" />
                 <span className="text-xs font-mono">{uploadFile ? uploadFile.name : "DRAG FILE OR CLICK TO UPLOAD"}</span>
               </div>
            </div>

            <div className="bg-blue-900/20 p-3 rounded border border-blue-900/50 text-xs text-blue-200 font-mono">
              <p>{`> The System will analyze the input.`}</p>
              <p>{`> A custom learning path (Dungeon) will be generated.`}</p>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
             <button 
               onClick={() => setShowUploadModal(false)}
               className="flex-1 py-3 border border-slate-700 text-slate-400 hover:text-white rounded font-mono font-bold"
             >
               CANCEL
             </button>
             <button 
               onClick={handleUpload}
               disabled={!uploadTitle || isProcessingUpload}
               className={`flex-1 py-3 bg-system-blue text-black font-bold rounded font-mono flex items-center justify-center gap-2 hover:shadow-[0_0_20px_#3b82f6] transition-all
                 ${isProcessingUpload ? 'opacity-50 cursor-wait' : ''}
               `}
             >
               {isProcessingUpload ? <Loader className="animate-spin" /> : 'INITIALIZE'}
             </button>
          </div>
        </div>
      </div>
    );
  };

  const renderReportModal = () => {
    if (!showReportModal) return null;

    // Determine predicted days to S-Rank
    const xpPerDay = 150; // Simple estimate
    const xpNeeded = RANK_THRESHOLDS[HunterRank.S] - profile.currentXp;
    const daysRemaining = Math.max(0, Math.ceil(xpNeeded / xpPerDay));

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in p-4">
        <div className="bg-system-panel border border-slate-600 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg shadow-[0_0_50px_rgba(255,255,255,0.1)] relative">
          
          <button 
            onClick={() => setShowReportModal(false)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white"
          >
            <Check size={24} />
          </button>

          <div className="p-6">
            <h2 className="text-2xl font-bold font-mono text-system-blue mb-1 flex items-center gap-2">
              <BarChart2 size={24} /> SYSTEM ANALYTICS
            </h2>
            <p className="text-slate-400 text-sm mb-6 font-mono">Performance Evaluation Report</p>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-slate-800 pb-2">
              {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setReportTab(tab)}
                  className={`px-4 py-2 font-mono text-sm font-bold transition-all ${reportTab === tab ? 'text-system-blue border-b-2 border-system-blue' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               {/* Graph */}
               <div className="lg:col-span-2 bg-slate-900/50 p-4 rounded border border-slate-800">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 font-mono">XP GROWTH TRAJECTORY</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={MOCK_WEEKLY_DATA}>
                        <XAxis dataKey="day" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                          cursor={{ fill: 'rgba(59, 130, 246, 0.1)' }}
                        />
                        <Bar dataKey="xp" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                           {MOCK_WEEKLY_DATA.map((entry, index) => (
                             <Cell key={`cell-${index}`} fill={entry.xp > 400 ? '#60a5fa' : '#1e3a8a'} />
                           ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
               </div>

               {/* Predictions Side Panel */}
               <div className="space-y-4">
                  <div className="bg-slate-900/50 p-4 rounded border border-slate-800">
                    <h3 className="text-sm font-bold text-green-400 mb-2 font-mono flex items-center gap-2">
                      <Activity size={14} /> PREDICTION
                    </h3>
                    <div className="text-3xl font-bold text-white mb-1">{daysRemaining} DAYS</div>
                    <p className="text-xs text-slate-400">Estimated time to reach S-Rank at current velocity.</p>
                  </div>

                  <div className="bg-slate-900/50 p-4 rounded border border-slate-800">
                    <h3 className="text-sm font-bold text-yellow-400 mb-2 font-mono flex items-center gap-2">
                       <Crown size={14} /> STATUS
                    </h3>
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-slate-300 text-xs">Global Rank</span>
                      <span className="text-white font-bold">{getGlobalStanding(profile.rank).percentile}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                       <div className="h-full bg-yellow-500 w-[85%]"></div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                      "You are currently outperforming 85% of active Hunters."
                    </p>
                  </div>
               </div>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // --- Views ---

  const renderDashboard = () => (
    <div className="space-y-6 animate-slide-up">
      
      {/* Daily Quote / System Message */}
      <div className="bg-gradient-to-r from-slate-900 to-system-panel border border-system-blue/30 rounded-lg p-4 relative overflow-hidden shadow-lg group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
          <Quote size={64} />
        </div>
        <div className="flex items-start gap-3 relative z-10">
          <div className="bg-system-blue/20 p-2 rounded-full text-system-blue">
            <Quote size={20} />
          </div>
          <div>
            <h3 className="text-system-blue font-mono font-bold text-xs uppercase tracking-widest mb-1">System Message</h3>
            <p className="text-white font-serif italic text-lg leading-relaxed">"{dailyQuote.text}"</p>
            <p className="text-slate-500 text-xs font-mono mt-2 text-right">- {dailyQuote.author}</p>
          </div>
        </div>
      </div>

      {/* Header Card */}
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
                  <h2 className="text-xl font-bold font-mono tracking-wider">HUNTER {profile.name.toUpperCase()}</h2>
                  <Edit3 size={14} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
             )}
            <p className="text-sm text-slate-400">The Navigator's System</p>
          </div>
          <div className="flex items-center gap-1 text-yellow-400 font-mono bg-yellow-900/20 px-3 py-1 rounded-full border border-yellow-700/50">
            <Coins size={16} />
            <span>{profile.gold}</span>
          </div>
        </div>

        {/* XP Bar */}
        <div className="mt-2">
          <div className="flex justify-between text-xs text-system-blue font-mono mb-1">
            <span>XP</span>
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

      {/* Global Standing & Report Buttons */}
      <div className="grid grid-cols-2 gap-4">
         <div className="bg-system-panel border border-slate-700 p-4 rounded-lg flex flex-col justify-between">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-mono mb-2">
              <Globe size={14} /> WORLD RANKING
            </div>
            <div>
              <div className="text-xl font-bold text-white">{getGlobalStanding(profile.rank).percentile}</div>
              <div className="text-[10px] text-slate-500 mt-1">{getGlobalStanding(profile.rank).msg}</div>
            </div>
         </div>
         <button 
           onClick={() => setShowReportModal(true)}
           className="bg-system-panel border border-slate-700 hover:border-system-blue hover:bg-system-blue/10 p-4 rounded-lg flex flex-col justify-between transition-all group text-left"
         >
            <div className="flex items-center gap-2 text-slate-400 text-xs font-mono mb-2 group-hover:text-system-blue">
              <BarChart2 size={14} /> ANALYTICS
            </div>
            <div>
              <div className="text-sm font-bold text-white group-hover:text-system-blue">VIEW SYSTEM REPORT</div>
              <div className="text-[10px] text-slate-500 mt-1">Detailed performance analysis.</div>
            </div>
         </button>
      </div>

      {/* Initialize System Button */}
      <button 
        onClick={() => setShowUploadModal(true)}
        className="w-full py-4 border-2 border-dashed border-system-blue/50 rounded-lg flex items-center justify-center gap-2 text-system-blue hover:bg-system-blue/10 hover:border-system-blue transition-all group font-mono font-bold"
      >
        <Plus size={20} className="group-hover:rotate-90 transition-transform" />
        INITIALIZE NEW SYSTEM PLAN
      </button>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Radar Chart */}
        <div className="bg-system-panel border border-system-border p-4 rounded-lg hover:border-system-blue/30 transition-colors">
          <h3 className="text-system-blue font-mono text-sm mb-4 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Activity size={16} /> PARAMETERS
          </h3>
          <StatRadar stats={profile.stats} />
        </div>

        {/* Numeric Stats */}
        <div className="bg-system-panel border border-system-border p-4 rounded-lg flex flex-col justify-center space-y-4">
           <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-slate-800 hover:bg-slate-800 transition-colors">
             <span className="flex items-center gap-2 text-yellow-500 font-mono"><Brain size={16}/> INT (Radio)</span>
             <span className="text-xl font-bold">{profile.stats.intelligence}</span>
           </div>
           
           <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-slate-800 hover:bg-slate-800 transition-colors">
             <span className="flex items-center gap-2 text-green-500 font-mono"><Eye size={16}/> PER (General)</span>
             <span className="text-xl font-bold">{profile.stats.perception}</span>
           </div>
           
           <div className="relative group overflow-hidden bg-slate-900/50 rounded border border-red-900/30 p-2 transition-all hover:border-red-500/50 hover:bg-red-900/10 cursor-help" title="Higher Vitality reduces streak loss when you miss a day.">
             <div className="flex items-center justify-between relative z-10">
               <span className="flex items-center gap-2 text-red-500 font-mono"><Zap size={16}/> VIT (Endurance)</span>
               <span className="text-xl font-bold">{profile.stats.vitality}</span>
             </div>
             <div className="mt-2 pt-2 border-t border-red-900/30 text-[10px] font-mono text-red-300 flex justify-between items-center relative z-10">
                <span className="flex items-center gap-1"><Shield size={10} /> STREAK GUARD</span>
                <span>{Math.min(100, profile.stats.vitality)}% RETENTION</span>
             </div>
           </div>
           
           <div className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-slate-800 hover:bg-slate-800 transition-colors">
             <span className="flex items-center gap-2 text-blue-500 font-mono"><Wind size={16}/> AGI (Instr.)</span>
             <span className="text-xl font-bold">{profile.stats.agility}</span>
           </div>
        </div>
      </div>

      {/* Gym Tracker - Daily Training */}
      <div className="bg-system-panel border border-system-border p-4 rounded-lg">
        <h3 className="text-orange-500 font-mono text-sm mb-4 border-b border-orange-900/30 pb-2 flex items-center gap-2">
           <Dumbbell size={16} /> PHYSICAL TRAINING
        </h3>
        <p className="text-xs text-slate-400 mb-3">Goal: Complete training on M, T, W, F, S.</p>
        <div className="flex justify-between items-center">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => {
            const isTarget = GYM_TARGET_DAYS.includes(idx);
            const isDone = profile.weeklyGymProgress[idx];
            return (
              <div key={idx} className="flex flex-col items-center gap-1">
                <span className={`text-[10px] font-mono font-bold ${isTarget ? 'text-orange-400' : 'text-slate-600'}`}>{day}</span>
                <button 
                  onClick={() => toggleGymDay(idx)}
                  disabled={isDone}
                  className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300
                    ${isDone 
                      ? 'bg-orange-500 border-orange-400 text-black shadow-[0_0_10px_#f97316]' 
                      : isTarget 
                        ? 'bg-slate-900 border-orange-900/50 hover:border-orange-500 cursor-pointer' 
                        : 'bg-slate-950 border-slate-800 opacity-30'}
                  `}
                >
                  {isDone && <Check size={14} strokeWidth={4} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily Quest */}
      <div className="bg-system-panel border border-system-border p-4 rounded-lg">
        <h3 className="text-red-500 font-mono text-sm mb-4 border-b border-red-900/30 pb-2 flex items-center gap-2 animate-pulse">
           <Trophy size={16} /> DAILY QUESTS
        </h3>
        <div className="space-y-3">
          {quests.map(q => (
            <div key={q.id} className={`p-3 border rounded flex justify-between items-center transition-colors duration-300 ${q.isCompleted ? 'bg-green-900/20 border-green-800' : 'bg-slate-900 border-slate-800 hover:bg-slate-800'}`}>
              <div>
                <p className="font-bold text-sm">{q.description}</p>
                <div className="text-xs text-slate-500 font-mono mt-1">
                  Rewards: {q.rewardXp} XP, +1 {q.rewardStat.toUpperCase()}
                </div>
              </div>
              <div className="text-right">
                <span className={`text-sm font-mono ${q.isCompleted ? 'text-green-500' : 'text-slate-400'}`}>
                  {q.current}/{q.target}
                </span>
                {q.isCompleted && <CheckMark />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderDungeonMap = () => {
    // Group chapters by part
    const groupedChapters: { [key: string]: Chapter[] } = {};
    chapters.forEach(c => {
      if (!groupedChapters[c.part]) groupedChapters[c.part] = [];
      groupedChapters[c.part].push(c);
    });

    return (
      <div className="space-y-8 animate-slide-in-right">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold font-mono text-system-blue tracking-widest">DUNGEON SELECT</h2>
          <p className="text-slate-400 text-sm">Choose a gate to enter.</p>
        </div>

        {Object.entries(groupedChapters)
          .filter(([part]) => part !== DungeonPart.BOSS)
          .map(([part, partChapters]) => (
            <div key={part} className="space-y-3">
              <h3 className="text-lg font-bold text-white border-l-4 border-system-blue pl-3 sticky top-16 bg-system-dark/90 backdrop-blur z-20 py-2 shadow-lg">{part}</h3>
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
                        {chapter.isCleared ? 'STATUS: CLEARED (SHADOW EXTRACTED)' : chapter.unlocked ? 'STATUS: GATE OPEN' : 'STATUS: LOCKED'}
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
              <h3 className="text-2xl font-bold text-red-500 font-mono tracking-[0.2em] mb-4">S-RANK GATE</h3>
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
                   {boss.unlocked ? boss.title : 'LOCKED - CLEAR ALL GATES'}
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
            {isBoss ? '⚠️ BOSS RAID IN PROGRESS ⚠️' : 'WARNING: MONSTERS DETECTED'}
          </span>
          <h2 className="text-3xl font-bold text-white max-w-xs mx-auto leading-tight">{chapter.title.toUpperCase()}</h2>
          <p className="text-system-blue font-mono">{chapter.part}</p>
        </div>

        <div className={`w-64 h-64 border-4 rounded-full flex items-center justify-center relative overflow-hidden bg-slate-900 transition-all duration-500
          ${isBoss ? 'border-red-600 shadow-[0_0_50px_#dc2626]' : 'border-red-500/30 hover:border-red-500/60'}
        `}>
          <div className={`absolute inset-0 bg-red-500/10 ${isBoss ? 'animate-ping opacity-20' : 'animate-pulse-glow'}`}></div>
          {isBoss ? <Crown size={80} className="text-red-600 relative z-10" /> : <Sword size={64} className="text-red-500 relative z-10" />}
        </div>

        <div className="text-center text-slate-400 text-sm max-w-sm">
          <p>{isBoss ? "Final Exam Simulation." : "Study Timer Active..."}</p>
          <p>Read the materials. Complete the quiz to {isBoss ? "conquer the system." : "clear the dungeon."}</p>
        </div>

        <div className="flex gap-4 w-full max-w-sm">
          <button 
            onClick={() => finishDungeon(false)}
            className="flex-1 py-3 border border-slate-600 text-slate-400 hover:bg-slate-800 hover:text-white rounded font-mono uppercase font-bold transition-all duration-200 active:scale-95"
          >
            Retreat
          </button>
          <button 
            onClick={() => finishDungeon(true)}
            className={`flex-1 py-3 text-black hover:opacity-90 rounded font-mono uppercase font-bold shadow-[0_0_15px_currentColor] transition-all duration-200 active:scale-95
              ${isBoss ? 'bg-red-600 text-white shadow-red-600 hover:shadow-red-500' : 'bg-system-blue shadow-blue-500 hover:shadow-blue-400'}
            `}
          >
            {isBoss ? 'Slay Boss' : 'Clear Dungeon'}
          </button>
        </div>
      </div>
    );
  };

  const renderShadowArmy = () => (
    <div className="space-y-6 animate-fade-in">
       <div className="text-center mb-6">
        <h2 className="text-2xl font-bold font-mono text-shadow-purple tracking-widest">SHADOW ARMY</h2>
        <p className="text-slate-400 text-sm">Review extracted knowledge to maintain mastery.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {chapters.filter(c => c.isCleared && c.part !== DungeonPart.BOSS).length === 0 ? (
          <div className="text-center py-20 text-slate-600 border border-dashed border-slate-800 rounded-lg">
            <Ghost size={48} className="mx-auto mb-4 opacity-20" />
            <p>No Shadows extracted yet.</p>
            <p className="text-sm">Clear dungeons to build your army.</p>
          </div>
        ) : (
          chapters.filter(c => c.isCleared && c.part !== DungeonPart.BOSS).map(chapter => (
            <div key={chapter.id} className="bg-slate-900 border border-shadow-purple/30 p-4 rounded-lg flex items-center gap-4 hover:bg-shadow-purple/10 hover:border-shadow-purple/60 transition-all duration-300 cursor-pointer active:scale-[0.99] group" onClick={() => summonShadow(chapter.id)}>
               <div className="bg-shadow-purple/20 p-2 rounded-full group-hover:bg-shadow-purple/40 transition-colors shrink-0">
                  <Ghost size={20} className="text-shadow-purple" />
               </div>
               
               <div className="flex-1 min-w-0">
                 <div className="flex justify-between items-center mb-1">
                   <h4 className="font-bold text-slate-200 group-hover:text-white truncate text-sm">{chapter.title}</h4>
                   <span className="text-[10px] text-shadow-purple font-mono font-bold">{chapter.masteryLevel}%</span>
                 </div>
                 <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                   <div 
                     className="h-full bg-gradient-to-r from-shadow-purple to-cyan-400 shadow-[0_0_8px_rgba(139,92,246,0.4)] transition-all duration-500"
                     style={{ width: `${chapter.masteryLevel}%` }}
                   />
                 </div>
               </div>

              <button className="shrink-0 text-xs bg-slate-800 px-3 py-1 rounded border border-slate-700 hover:border-shadow-purple hover:text-shadow-purple hover:bg-shadow-purple/20 font-mono transition-all">
                SUMMON
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderShadowReview = () => {
    const chapter = chapters.find(c => c.id === activeChapterId);
    if (!chapter) return null;

    return (
      <div className="h-[calc(100vh-140px)] flex flex-col items-center justify-center space-y-6 animate-fade-in">
        <div className="w-full max-w-md bg-slate-900 border border-shadow-purple p-8 rounded-lg shadow-[0_0_30px_rgba(139,92,246,0.2)] text-center relative hover:shadow-[0_0_40px_rgba(139,92,246,0.3)] transition-shadow duration-500">
           <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-shadow-purple text-black font-bold px-4 py-1 rounded-full text-sm font-mono animate-bounce">
             REVIEW MODE
           </div>
           
           <Ghost size={48} className="mx-auto mb-4 text-shadow-purple" />
           
           <h3 className="text-xl font-bold mb-2">{chapter.title}</h3>
           <p className="text-slate-400 text-sm mb-6">
             "To navigate is to survive. Remember the core principles of {chapter.part.split(':')[1]?.trim() || chapter.part}."
           </p>

           <div className="bg-black/30 p-4 rounded text-left mb-6 font-mono text-xs text-green-400">
              {`> Accessing System Database...`} <br/>
              {`> Retrieving flashcards...`} <br/>
              {`> Topic: ${chapter.title}`} <br/>
              {`> Status: Extracted`}
           </div>

           <button 
             onClick={completeShadowReview}
             className="w-full py-3 bg-shadow-purple text-white font-bold rounded hover:bg-purple-600 hover:shadow-[0_0_20px_rgba(147,51,234,0.5)] transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
           >
             <RotateCw size={18} /> COMPLETE REVIEW
           </button>
           
           <button 
             onClick={() => { setView('SHADOW_ARMY'); setActiveChapterId(null); }}
             className="mt-4 text-slate-500 hover:text-white text-sm transition-colors"
           >
             Dismiss Shadow
           </button>
        </div>
      </div>
    );
  };

  const renderShop = () => (
    <div className="space-y-6 animate-slide-up">
       <div className="text-center mb-6">
        <h2 className="text-2xl font-bold font-mono text-yellow-500 tracking-widest">HUNTER STORE</h2>
        <div className="flex items-center justify-center gap-2 mt-2">
           <span className="text-slate-400 text-sm">Exchange Gold for Real-World Rewards.</span>
           <div className="flex items-center gap-1 text-yellow-400 font-mono bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-700/50 text-xs">
              <Coins size={12} />
              <span>{profile.gold}</span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {INITIAL_REWARDS.map(item => (
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
        <h2 className="text-2xl font-bold font-mono text-green-500 tracking-widest">LIFESTYLE CONTROL</h2>
        <p className="text-slate-400 text-sm">Maintain protocols for optimal performance.</p>
      </div>

      <div className="bg-system-panel border border-slate-700 p-4 rounded-lg">
        <div className="flex gap-2 mb-4">
          <input 
            type="text" 
            value={newHabitTitle}
            onChange={(e) => setNewHabitTitle(e.target.value)}
            placeholder="Add new protocol..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-green-500 font-mono text-sm"
            onKeyDown={(e) => e.key === 'Enter' && addNewHabit()}
          />
          <button 
            onClick={addNewHabit}
            className="bg-green-600 hover:bg-green-500 text-white px-3 rounded"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {habits.map(habit => (
            <div key={habit.id} className={`p-4 border rounded-lg flex items-center justify-between transition-all group
              ${habit.isCompleted 
                ? 'bg-slate-900/50 border-slate-800 opacity-60' 
                : 'bg-slate-900 border-slate-700 hover:border-green-500/50'}
            `}>
              <div className="flex items-center gap-3">
                 <div className={`p-2 rounded-full ${habit.type === 'good' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                   {habit.type === 'good' ? <Heart size={16} /> : <Skull size={16} />}
                 </div>
                 <div>
                   <h4 className={`font-bold ${habit.isCompleted ? 'line-through text-slate-500' : 'text-white'}`}>{habit.title}</h4>
                   <p className="text-[10px] text-slate-500 font-mono">Streak: {habit.streak} Days</p>
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

  return (
    <div className="min-h-screen bg-system-dark text-slate-200 pb-20 font-sans selection:bg-system-blue selection:text-black">
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
          <div className="text-system-blue font-bold font-mono tracking-tighter text-lg animate-pulse">SYS_NAV</div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Voice System Link */}
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
             {isVoiceConnecting ? (
               <Loader size={12} className="animate-spin" />
             ) : isVoiceConnected ? (
               <Mic size={12} />
             ) : (
               <MicOff size={12} />
             )}
             <span className="hidden sm:inline">{isVoiceConnected ? "SYSTEM LINK: ONLINE" : "SYSTEM LINK: OFFLINE"}</span>
          </button>

          <button 
            onClick={simulateStreakBreak}
            className="flex items-center gap-1 text-yellow-500 font-mono text-sm hover:text-red-500 transition-colors hover:scale-105 active:scale-95"
            title="Click to Simulate Missing a Day (Test Vitality Protection)"
          >
             <Zap size={14} fill="currentColor"/> 
             <span>{profile.streakDays} DAYS</span>
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
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-system-panel border-t border-slate-800 pb-safe z-40">
        <div className="flex justify-around items-center h-16 max-w-2xl mx-auto px-1">
          <NavButton 
            active={view === 'DASHBOARD'} 
            onClick={() => setView('DASHBOARD')} 
            icon={<User size={18} />} 
            label="STATUS" 
          />
          <NavButton 
            active={view === 'DUNGEON_MAP' || view === 'ACTIVE_DUNGEON'} 
            onClick={() => setView('DUNGEON_MAP')} 
            icon={<MapIcon size={18} />} 
            label="DUNGEON" 
          />
          <NavButton 
            active={view === 'SHOP'} 
            onClick={() => setView('SHOP')} 
            icon={<ShoppingBag size={18} />} 
            label="STORE" 
          />
          <NavButton 
            active={view === 'LIFESTYLE'} 
            onClick={() => setView('LIFESTYLE')} 
            icon={<Activity size={18} />} 
            label="PROTOCOLS" 
          />
          <NavButton 
            active={view === 'SHADOW_ARMY' || view === 'SHADOW_REVIEW'} 
            onClick={() => setView('SHADOW_ARMY')} 
            icon={<Ghost size={18} />} 
            label="SHADOWS" 
          />
        </div>
      </nav>
    </div>
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