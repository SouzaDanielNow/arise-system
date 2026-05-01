# CLAUDE.md — ARISE SYSTEM v1.1

## Stack
React 19 + TypeScript + Vite + TailwindCSS + Recharts + Lucide React + Google Gemini Live API + Supabase

## Rodar localmente
```
npm install
npm run dev   # http://localhost:5173
```
Requer `GEMINI_API_KEY` no arquivo `.env.local`.

## Estrutura de arquivos
```
App.tsx               ← componente único principal (~2200 linhas)
types.ts              ← todas as interfaces TypeScript (incl. GameState)
constants.ts          ← dados iniciais (hábitos, quests, capítulos, recompensas)
lib/
  supabase.ts         ← client Supabase (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
i18n/
  translations.ts     ← strings PT-BR e EN (objeto 'en' é o tipo-base)
  LanguageContext.tsx  ← context + hook useLanguage()
components/
  AuthScreen.tsx       ← tela de login/registro (estilo ARISE)
  StatRadar.tsx        ← gráfico radar (Recharts) — recebe customStats[]
  SystemNotification.tsx ← overlay de notificação animada
  DevPanel.tsx         ← painel God Mode (admin only: dany_ops@hotmail.com)
```

## Supabase
- Tabela: `profiles` — colunas `id` (uuid = auth user id) e `profile_data` (jsonb)
- `GameState` (types.ts) é o shape salvo em `profile_data`
- Auto-save: debounce 2s em qualquer mudança de estado (profile, habits, quests, chapters, bossFights)
- Credenciais em `.env.local` (não commitado): `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- Tsconfig inclui `"vite/client"` para `import.meta.env`

## Convenções do projeto

### TypeScript
- Zero erros de TypeScript são obrigatórios. Sempre rode `npx tsc --noEmit` após mudanças.
- Todos os tipos ficam em `types.ts`. Nunca inline em App.tsx.

### Traduções (i18n)
- Toda string visível ao usuário DEVE existir em `translations.ts` — nas seções `en` E `ptBR`.
- O tipo `Translations` é inferido de `en`. O objeto `ptBR` deve satisfazer `Translations`.
- Strings com parâmetros são funções: `(name: string) => \`...\``.
- Acesse via `const { t } = useLanguage()` e use `t.secao.chave`.
- Nunca hardcode texto PT-BR ou EN diretamente no JSX.

### Estado e lógica
- Todo o estado vive em `App.tsx` (sem Context API para dados do jogo).
- Funções de mutação seguem o padrão `setX(prev => prev.map(...))`.
- Notificações: `showNotification(msg, sub?, type?)` — types: `'info' | 'quest' | 'levelup' | 'shield' | 'warning' | 'processing'`.

### Commits
- Sempre commite antes de iniciar uma nova feature grande.
- Mensagem: `feat: descrição breve` ou `fix: descrição`.

## Sistemas principais

### Perfil e progressão
- `profile.currentXp` → rank calculado por `getNextRank(xp)` em `constants.ts`
- Ranks: E(0) D(750) C(2250) B(5250) A(7000) S(15000) SS(30000) SSS(60000) NACIONAL(120000) MONARCA(250000)
- `addXp(amount, statId?)` — incrementa XP e opcionalmente +1 no stat vinculado
- `addGold(amount)` — incrementa Gold
- **Total Power** = `profile.customStats.reduce((s,c) => s + c.value, 0)` — protege streak

### Ranks
- 10 ranks: E, D, C, B, A, S, SS, SSS, NACIONAL, MONARCA
- Cores: E=#9ca3af D=#10b981 C=#3b82f6 B=#8b5cf6 A=#ec4899 S=#facc15 SS=#f97316 SSS=#ef4444 NACIONAL=#c084fc MONARCA=#e2e8f0
- CSS custom property `--rank-color` em `:root`, atualizado via `useEffect` quando `profile.rank` muda
- `@property --rank-color` em `index.html` para suporte a CSS transition suave

### Stats customizáveis
- `profile.customStats: CustomStat[]` — criados/deletados pelo usuário em Settings
- Defaults: Físico💪, Intelectual🧠, Profissional💼, Espiritual🧘 (IDs: '1','2','3','4')
- Mínimo 1 stat obrigatório
- `STAT_COLOR_PALETTE` em `constants.ts` atribui cores automaticamente

### Hábitos (Habit)
- Campo `type` NÃO existe. Todas as missões são produtivas.
- `repeatType: 'daily' | 'weekdays' | 'custom' | 'oneTime'`
- `isTodayActive(habit)` — verifica se o hábito é para hoje
- Completar: +30 XP, +20 Gold, streak++

### Chefões (BossFight) — v1.1
- Criados diretamente na aba MISSÕES (sem camada de ProcrastinationItem)
- Formulário: título + descrição + prazo + sub-tarefas opcionais
- `xpReward` = random 150–300, `goldReward` = random 60–100 (gerado na criação)
- `progress` = % automático de subTasks.completed — nunca manual
- `allDone = boss.subTasks.length === 0 || boss.subTasks.every(s => s.completed)` — boss sem sub-tarefas pode ser completado
- Chefões completados (`status: 'completed'`) ficam no estado e aparecem no Activity Log
- `history: BossHistoryEntry[]` — inicia com `action:'started'` na criação
- `toggleBossSubTask` adiciona entrada no histórico com timestamp
- Edit inline de sub-tarefa: `editingSubTaskId` formato `"bossId::subTaskId"`
- Drag & drop nativo HTML5: `dragState: {bossId, subTaskId} | null`
- Penalidade por expiração: -7 dias de streak

### Passiva Undying Will — v1.1
- `protection = Math.min(50, totalPower)` — máximo de 50% de retenção
- `retainedDays = Math.floor(currentStreak * (protection / 100))`
- Com 50+ Total Power → retém 50% do streak. Menos que isso → retenção proporcional.
- Aplicada em `applyDailyReset` (login) e `simulateStreakBreak` (botão streak no header)

### Quests do sistema (inline, opcionais)
- dq-1: "Complete 1 Dungeon Run" (+100 XP, vinculada ao stat '1')
- dq-2: "Review a Shadow" (+50 XP, vinculada ao stat '2')
- Aparecem no final da aba MISSIONS com badge OPCIONAL (âmbar)
- NÃO penalizam streak

### Activity Log — v1.1
- Seção no final da aba MISSÕES
- Mostra: hábitos com `isCompleted: true` + `bossFights.filter(b => b.status === 'completed')`

## Aba STATUS (Dashboard)
Contém: Daily Quote, Profile Card (XP bar, nome, gold), Initialize Plan button, Stats Grid (radar + valores), Total Power.
**Removidos na v1.1**: World Ranking card, Analytics/View Report button, Gym Tracker, Daily Quests.

## O que NÃO fazer
- Não adicionar campo `type: 'good' | 'bad'` em Habit — foi removido intencionalmente
- Não criar sistema de ProcrastinationItem — foi substituído por criação direta de Chefões
- Não recriar as seções removidas do Dashboard (World Ranking, Gym Tracker, Daily Quests)
- Não tornar XP/Gold de Boss Fight editável pelo usuário
- Não usar `setNewTaskType` — estado removido
- Não commitar `node_modules`, `.env.local` ou arquivos de build
- Não tornar a retenção do Undying Will superior a 50% (cap intencional de balanceamento)
