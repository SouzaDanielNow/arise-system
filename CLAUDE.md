# CLAUDE.md — Solo Leveling App

## Stack
React 19 + TypeScript + Vite + TailwindCSS + Recharts + Lucide React + Google Gemini Live API

## Rodar localmente
```
npm install
npm run dev   # http://localhost:5173
```
Requer `GEMINI_API_KEY` no arquivo `.env.local`.

## Estrutura de arquivos
```
App.tsx               ← componente único principal (~1900 linhas)
types.ts              ← todas as interfaces TypeScript
constants.ts          ← dados iniciais (hábitos, quests, capítulos, recompensas)
i18n/
  translations.ts     ← strings PT-BR e EN (objeto 'en' é o tipo-base)
  LanguageContext.tsx  ← context + hook useLanguage()
components/
  StatRadar.tsx        ← gráfico radar (Recharts) — recebe customStats[]
  SystemNotification.tsx ← overlay de notificação animada
```

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
- Ranks: E(0) D(500) C(1500) B(3500) A(7000) S(15000)
- `addXp(amount, statId?)` — incrementa XP e opcionalmente +1 no stat vinculado
- `addGold(amount)` — incrementa Gold
- **Total Power** = `profile.customStats.reduce((s,c) => s + c.value, 0)` — protege streak

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

### Missões Especiais (ProcrastinationItem)
- `status: 'open' | 'active' | 'completed'`
- Status 'active' = Boss Fight ativado (glow roxo no card)
- Ordenação: prioridade (high→low) depois dueDate (mais próximo primeiro)

### Boss Fight
- Criado em `confirmActivateBoss(item)` a partir de uma ProcrastinationItem
- `xpReward` = random 150–300, `goldReward` = random 60–100 (gerado na ativação, não editável)
- `progress` = % automático de subTasks.completed — nunca manual
- `history: BossHistoryEntry[]` — inicia com `action:'started'` na criação
- `toggleBossSubTask` adiciona entrada no histórico com timestamp
- Edit inline de sub-tarefa: `editingSubTaskId` formato `"bossId::subTaskId"`
- Drag & drop nativo HTML5: `dragState: {bossId, subTaskId} | null`
- Penalidade por expiração: -7 dias de streak

### Quests do sistema (inline, opcionais)
- dq-1: "Complete 1 Dungeon Run" (+100 XP, vinculada ao stat '1')
- dq-2: "Review a Shadow" (+50 XP, vinculada ao stat '2')
- Aparecem no final da aba MISSIONS com badge OPCIONAL (âmbar)
- NÃO penalizam streak

## O que NÃO fazer
- Não adicionar campo `type: 'good' | 'bad'` em Habit — foi removido intencionalmente
- Não criar seção separada "Missões do Sistema" — quests ficam inline no final
- Não tornar XP/Gold de Boss Fight editável pelo usuário
- Não usar `setNewTaskType` — estado removido
- Não commitar `node_modules`, `.env.local` ou arquivos de build
