# CLAUDE.md — ARISE SYSTEM v1.4

## Stack
React 19 + TypeScript + Vite + TailwindCSS + Recharts + Lucide React + Google Gemini Live API + Supabase

## Rodar localmente
```
npm install
npm run dev   # http://localhost:3000 (porta padrão atual)
```
Requer `GEMINI_API_KEY` no arquivo `.env.local`.

## Git & Deploy
- Repositório: https://github.com/SouzaDanielNow/arise-system.git (branch `main`)
- Deploy automático via **Vercel** — basta `git push origin main` para publicar
- Não commitar: `node_modules`, `.env.local`, arquivos de build (`dist/`)
- Convenção de commit: `feat: descrição` ou `fix: descrição`
- Sempre rodar `npx tsc --noEmit` antes de commitar

## Tipografia (v1.3)
- **Garet** (`font-garet`) — tudo que é título, label uppercase, nav tabs, cabeçalhos de seção, botões de ação, badges de status, nomes de personagem, overlays de animação. Self-hosted em `/public/fonts/garet-400.woff2` e `garet-700.woff2`
- **Roboto Mono** (`font-mono`) — texto descritivo, valores numéricos, body text, conteúdo de formulários, timestamps, dados técnicos. Self-hosted em `/public/fonts/roboto-mono-400.woff2` e `roboto-mono-700.woff2`
- **Inter** (`font-sans`) — texto UI geral (descrições longas, subtítulos). Google Fonts CDN
- **Playfair Display** (`font-serif`) — quote do sistema (itálico). Google Fonts CDN
- `@font-face` declarados em `index.html` dentro de `<style>` (antes do Tailwind config)
- **Regra prática**: se o texto está em MAIÚSCULAS ou é um label/botão de interface → `font-garet`. Se é dado/valor/descrição → `font-mono`.

## Estrutura de arquivos
```
App.tsx               ← componente único principal (~3500 linhas)
types.ts              ← todas as interfaces TypeScript (incl. GameState)
constants.ts          ← dados iniciais (hábitos, recompensas — sem dungeons)
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

### Chefões (BossFight) — v1.3
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
- **Cards colapsáveis**: estado `expandedBossIds: Set<string>` — vazio por padrão (todos colapsados ao abrir o app)
- **Ordenação**: por prazo mais próximo (`a.dueDate.localeCompare(b.dueDate)`) — urgência em primeiro
- **Data em formato BR**: `formatBRDate(dateStr)` converte `yyyy-mm-dd` → `dd/mm/yyyy`

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

## Efeitos visuais neon — v1.4

Sete efeitos distintos aplicados por tipo de card. **Nunca repetir o mesmo efeito em dois cards adjacentes.**

| # | Efeito | Como funciona | Onde está |
|---|---|---|---|
| 1 | **Scan Line** | `motion.div` descendo top→bottom, gradiente vertical | Card Hunter Profile (Identidade) |
| 2 | **Data Beam** | `motion.div` varrendo left→right (`left:['-5%','105%']`), faixa vertical | Rastreio Semanal (Painel), Análise de Atributos (Identidade), Stats (Config), Mission Board (Sombras) |
| 3 | **Pulsing Border Glow** | `animate boxShadow` com `0 0 0 1px` + `inset` — borda "acendendo" | Cards Loja, Mission Board Sombras, Idioma e Notificações (Config) |
| 4 | **Sequential Corner Pulse** | 4 divs em L nos cantos com `opacity:[0.2,1,0.2]` e `delay: i*0.5` | Seção Radar (Painel), Hunter Profile (Identidade) |
| 5 | **Neon Inset Border** | `box-shadow: inset 3px 0 0 ${cor}` — borda esquerda colorida por stat/estado | Lista de Atributos (Painel), itens de hábito/tarefa (Missões) |
| 6 | **Shimmer de Texto** | `animate textShadow` entre intensidades — texto pulsante | Total Power (Painel) |
| 7 | **Ambient Glow Pulse** | `animate boxShadow` spread largo (20–45px), sem borda forte, sem `inset` — card "respirando" | Missões de Hoje (Painel), Undying Will (Identidade), Conta (Config), estado vazio Sombras |

### Corner accents estáticos
4 divs em L (`absolute w-2.5 h-2.5 border-{lado}`) aplicados como decoração base em vários cards. Presentes em: Hunter Profile, boss fight cards (Missões), cards da Loja.

### Background padrão dark gradient
Todos os cards neon usam:
- Azul: `linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)`
- Roxo (chefões/Undying Will): `linear-gradient(160deg, rgba(10,4,40,0.99) 0%, rgba(6,3,28,0.99) 100%)`
- Vermelho (Conta): `linear-gradient(160deg, rgba(20,4,4,0.99) 0%, rgba(10,3,3,0.99) 100%)`

## Aba PAINEL (Dashboard) — v1.2/v1.4
Ordem das seções:
1. **Saudação dinâmica** — "Saudação, CAÇADOR [Nome]" com palavra de saudação variando por hora (Bom dia/Boa tarde/Boa noite)
2. **Card de perfil neon** — avatar clicável, badge rank hexagonal, nome editável, gold, 2 barras XP (rank + nível). Estética: fundo dark gradient, borda neon na cor do rank, corner accents, scan line animada, glitch periódico.
3. **Missões de Hoje** — barra de progresso + contador (X/Y) + lista de hábitos clicáveis (marca como completo direto daqui)
4. **Rastreio Semanal** — LineChart Seg→Dom. Dados em `profile.weeklyHistory[]` (atualizado em `toggleHabit`; mantém últimos 7 dias)
5. **Fidelidade com Hábitos** — PieChart donut com cores neon. Calcula % por streak de cada hábito. Estética tech igual ao popup de missão bônus.
6. **Radar + Atributos** — StatRadar lado a lado com lista de stats + Total Power
7. **Mensagem do Sistema** — quote diária aleatória

**Nível**: derivado de `Math.floor(profile.currentXp / 100) + 1` (não salvo, calculado on-the-fly)
**Removidos na v1.1**: World Ranking card, Analytics/View Report button, Gym Tracker, Daily Quests.

### Rastreio Semanal — v1.4
- Usa `AreaChart` + `Area` (não mais `LineChart` + `Line`) com gradient fill via `<defs><linearGradient id="weeklyGradient">`
- Eixo Y fixo `domain={[0, 100]}` — escala em percentual
- `chartData` retorna `{ day, pct }` onde `pct = Math.min(100, Math.round((completed / habits.length) * 100))`
- Tooltip mostra `${v}%`

### Fidelidade com Hábitos — v1.4
- `ResponsiveContainer width={140} height={140}` com `PieChart margin={{ top:10, right:10, bottom:10, left:10 }}`
- `outerRadius={48}` e `innerRadius={30}` — reduzido para o `drop-shadow` não ser cortado pelo viewport SVG

## O que NÃO fazer — efeitos visuais
- Não aplicar o mesmo efeito em dois cards adjacentes — sempre variar
- Não usar `overflow: hidden` em cards com `drop-shadow` — o glow é cortado
- Não usar `drop-shadow` em `Cell` do Recharts sem aumentar o container e adicionar `margin` ao `PieChart`
- Não usar `LineChart`/`Line` para o Rastreio Semanal — foi substituído por `AreaChart`/`Area` (v1.4)

## O que NÃO fazer
- Não adicionar campo `type: 'good' | 'bad'` em Habit — foi removido intencionalmente
- Não criar sistema de ProcrastinationItem — foi substituído por criação direta de Chefões
- Não recriar as seções removidas do Dashboard (World Ranking, Gym Tracker, Daily Quests)
- Não tornar XP/Gold de Boss Fight editável pelo usuário
- Não usar `setNewTaskType` — estado removido
- Não commitar `node_modules`, `.env.local` ou arquivos de build
- Não tornar a retenção do Undying Will superior a 50% (cap intencional de balanceamento)
- Não recriar sistema de Dungeon / capítulos — removido intencionalmente (v1.2). Será reimplementado do zero no futuro
- Não recriar `renderLifestyleControl`, `renderShadowReview`, `renderReportModal`, `renderUploadModal` — todos removidos em v1.2
- `ViewState` não inclui mais 'DUNGEON_MAP', 'ACTIVE_DUNGEON', 'LIFESTYLE', 'SHADOW_REVIEW'
- Não usar `font-mono` em labels uppercase, títulos, botões de interface — usar `font-garet` (v1.3)
- Não usar JetBrains Mono — removida em v1.3 (substituída por Garet + Roboto Mono, ambas self-hosted)
