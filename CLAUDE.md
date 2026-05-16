# CLAUDE.md — ARISE SYSTEM v1.4.2

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
- Convenção de commit: `feat(vX.Y.Z): descrição` ou `fix: descrição`
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
App.tsx               ← componente único principal (~3600+ linhas)
types.ts              ← todas as interfaces TypeScript (incl. GameState)
constants.ts          ← motor de progressão, dados iniciais, funções utilitárias
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
- Mensagem: `feat(vX.Y.Z): descrição breve` ou `fix: descrição`.

---

## Motor de Progressão — v1.4.1+

### Nível (Level)
- Campo `level` **não existe mais** no `HunterProfile` — é calculado on-the-fly.
- `getLevelFromXp(totalXp)` → `{ level, xpIntoLevel, xpForNextLevel }` — única fonte da verdade.
- Curva polinomial quadrática: `xpForNextLevel = Math.floor(200 + level² × 3)`
  - Nível 1 → 203 XP | Nível 10 → 500 XP | Nível 50 → 7.700 XP | Nível 100 → 30.200 XP
- `getXpForLevel(targetLevel)` → XP acumulado total necessário para chegar a um nível.

### Rank (derivado do Nível)
- Rank é calculado via `getRankFromLevel(level)` — **não mais por XP threshold**.
- `RANK_LEVEL_THRESHOLDS`: E=1, D=20, C=40, B=60, A=80, S=100, SS=120, SSS=140, NACIONAL=160, MONARCA=180
- Cada rank abrange 20 níveis. No MONARCA (Nv180+) o rank estabiliza mas o nível continua subindo.
- Cores: E=#9ca3af D=#10b981 C=#3b82f6 B=#8b5cf6 A=#ec4899 S=#facc15 SS=#f97316 SSS=#ef4444 NACIONAL=#c084fc MONARCA=#e2e8f0
- CSS custom property `--rank-color` em `:root`, atualizado via `useEffect` quando `profile.rank` muda.

### Multiplicadores de Rank (`getRankMultiplier`)
| Rank | Mult | Rank | Mult |
|---|---|---|---|
| E | 1.0 | S | 5.0 |
| D | 1.2 | SS | 7.0 |
| C | 1.5 | SSS | 10.0 |
| B | 2.0 | NACIONAL | 15.0 |
| A | 3.0 | MONARCA | 25.0 |

### `addXp(amount, statId?)`
- Detecta level up (nível anterior vs novo) e rank up (rank anterior vs novo).
- **Rank up** → dispara `LevelUpOverlay` + notificação de rank.
- **Level up sem rank up** → dispara notificação `NÍVEL X! +4 Pontos de Atributo desbloqueados`.
- A cada level up: `availableStatPoints += 4`.

### HunterProfile — campos removidos
- `level: number` — **removido** (era zumbi, calculado de `currentXp`).
- `requiredXp: number` — **removido** (era zumbi, hardcoded 500).
- Salvo no Supabase: apenas `currentXp`. Nível e rank são sempre derivados.

### Barras de progresso (Dashboard + Identidade)
- **Barra de Rank**: progresso dentro dos 20 níveis do rank atual → `(level - rankMinLevel) / 20 × 100%`.
- **Barra de Nível**: `xpIntoLevel / xpForNextLevel × 100%` — progresso até o próximo nível.

---

## Sistemas de Recompensa — v1.4.2

### Hábitos (Habit)
- Campo `type` NÃO existe. Todas as missões são produtivas.
- `repeatType: 'daily' | 'weekdays' | 'custom' | 'oneTime'`
- `isTodayActive(habit)` — verifica se o hábito é para hoje.
- **XP ao completar**: `Math.floor(30 × streakBonus × getRankMultiplier(rank))`
  - `streakBonus = Math.min(2.0, 1 + streak × 0.05)` — +5% por dia, cap 2×
  - Streak 0 + Rank E = 30 XP | Streak 20 + Rank S = 300 XP | Streak 20 + Rank MONARCA = 1.500 XP
- Gold ao completar: +20 (fixo).

### Chefões (BossFight) — v1.4.2
- Criados diretamente na aba MISSÕES.
- **XP híbrida (mérito + RNG)**:
  - `baseXp = (diasDePrazo × random(5–10)) + (nSubTarefas × random(40–60)) + random(50–199)`
  - `xpReward = Math.floor(baseXp × getRankMultiplier(rank))`
  - Boss de 7 dias + 3 subtarefas + Rank E ≈ 250–450 XP
  - Mesmo boss + Rank S ≈ 1.250–2.250 XP
- Válido para boss manual e boss criado por IA (usa `suggestion.dueDays` e `suggestion.subTasks.length`).
- `goldReward` = random 60–100 (ainda fixo).
- `progress` = % automático de subTasks.completed — nunca manual.
- `allDone = boss.subTasks.length === 0 || boss.subTasks.every(s => s.completed)`
- Chefões completados aparecem no Activity Log.
- Penalidade por expiração: -7 dias de streak.
- Cards colapsáveis por padrão. Ordenados por prazo mais próximo.
- `formatBRDate(dateStr)` converte `yyyy-mm-dd` → `dd/mm/yyyy`.

### Sombras — Dízimo das Sombras (v1.4.2)
- `Shadow` agora guarda `missionRewardXP?` e `missionRewardGold?` ao ser enviada em missão.
- No retorno com sucesso:
  - **Hunter**: `Math.floor(missionRewardXP × getRankMultiplier(rank))` XP + `missionRewardGold` Gold.
  - **Sombra**: `missionRewardXP` XP para seu nível interno (não escala com rank do caçador).
- `randomBetween(min, max)` — utilitário definido em App.tsx (módulo-level).

### Passiva Undying Will
- `protection = Math.min(50, totalPower)` — máximo de 50% de retenção.
- `retainedDays = Math.floor(currentStreak × (protection / 100))`.
- Aplicada em `applyDailyReset` (login) e `simulateStreakBreak` (botão streak no header).

### Quests do sistema (inline, opcionais)
- dq-1: "Complete 1 Dungeon Run" (+100 XP) | dq-2: "Review a Shadow" (+50 XP)
- NÃO penalizam streak. Aparecem na aba MISSIONS com badge OPCIONAL (âmbar).

---

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

### Background padrão dark gradient
- Azul: `linear-gradient(160deg, rgba(6,12,40,0.99) 0%, rgba(3,6,22,0.99) 100%)`
- Roxo (chefões/Undying Will): `linear-gradient(160deg, rgba(10,4,40,0.99) 0%, rgba(6,3,28,0.99) 100%)`
- Vermelho (Conta): `linear-gradient(160deg, rgba(20,4,4,0.99) 0%, rgba(10,3,3,0.99) 100%)`

---

## Aba PAINEL (Dashboard)
1. **Saudação dinâmica** — "Saudação, CAÇADOR [Nome]" com variação por hora
2. **Card de perfil neon** — avatar, badge rank hexagonal, nome editável, gold, 2 barras XP (rank + nível)
3. **Missões de Hoje** — barra de progresso + lista de hábitos clicáveis (Ambient Glow Pulse)
4. **Rastreio Semanal** — `AreaChart` com gradient fill. Eixo Y em % (`completed / habits.length × 100`)
5. **Fidelidade com Hábitos** — PieChart donut neon. `ResponsiveContainer 140×140`, `outerRadius=48`, `innerRadius=30`
6. **Radar + Atributos** — StatRadar + lista de stats + Total Power (Shimmer)
7. **Mensagem do Sistema** — quote diária aleatória (Ambient Glow Pulse)

---

## O que NÃO fazer
- Não usar `profile.level` ou `profile.requiredXp` — campos removidos. Usar `getLevelFromXp(profile.currentXp)`.
- Não usar `getNextRank`, `getXpProgress`, `getNextRankXp`, `RANK_THRESHOLDS` — removidos em v1.4.1.
- Não tornar XP/Gold de Boss Fight fixo ou editável pelo usuário — é híbrido (mérito + RNG × rank).
- Não aplicar o mesmo efeito neon em dois cards adjacentes — sempre variar.
- Não usar `overflow: hidden` em cards com `drop-shadow` — o glow é cortado.
- Não usar `drop-shadow` em `Cell` do Recharts sem aumentar container e adicionar `margin` ao `PieChart`.
- Não usar `LineChart`/`Line` para Rastreio Semanal — substituído por `AreaChart`/`Area` (v1.4).
- Não adicionar campo `type: 'good' | 'bad'` em Habit — removido intencionalmente.
- Não criar sistema de ProcrastinationItem — substituído por criação direta de Chefões.
- Não recriar seções removidas do Dashboard (World Ranking, Gym Tracker, Daily Quests).
- Não recriar sistema de Dungeon / capítulos — removido em v1.2, será reimplementado do zero.
- Não tornar a retenção do Undying Will superior a 50% (cap intencional de balanceamento).
- Não usar `font-mono` em labels uppercase, títulos, botões — usar `font-garet` (v1.3).
- Não usar JetBrains Mono — removida em v1.3.
- `ViewState` não inclui 'DUNGEON_MAP', 'ACTIVE_DUNGEON', 'LIFESTYLE', 'SHADOW_REVIEW'.
