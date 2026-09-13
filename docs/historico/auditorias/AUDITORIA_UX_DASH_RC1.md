# AUDITORIA UX-DASH RC1 — Centro de Comando do CDS Sistemas

**Produto:** CDS Sistemas V1.0  
**Escopo:** Dashboard principal do ERP (`frontend/erp/pages/dashboard.html` + `dashboard.js`)  
**Data:** 2026-07-11  
**Tipo:** Auditoria — **sem implementação**, sem alteração de backend/APIs/SQL/regras  
**Referência:** Arquitetura Oficial V1.0 · Auditoria UX Navegação V2

---

## 1. Resumo executivo

O Dashboard atual é uma **parede de KPIs** (19 métricas + 8 listas = **27 cards**), **sem gráficos**, com **um único atalho** (Equipamentos) e **zero presença** da Central de Entradas / NFC-e — apesar de serem pilares da plataforma pós-V1.

| Dimensão | Nota (0–100) |
|---|---|
| Hierarquia visual | 28 |
| Relevância estratégica | 40 |
| Densidade / ruído | 25 |
| Decisão em 5 segundos | 30 |
| Alinhamento arquitetura V1 | 22 |
| Responsividade / espaço | 35 |
| **Nota atual (Centro de Comando)** | **≈ 32** |
| **Nota estimada pós-redesign** | **≈ 82** |

**Parecer:** o Dashboard **não opera como Centro de Comando**. É um dump operacional cruzado. Redesign de UX é **Crítico**.

---

## 2. Inventário atual

### 2.1 Header e filtros

| Elemento | Situação |
|---|---|
| Título | “Dashboard” genérico |
| Subtítulo | Período + modo fiscal |
| Filtro | 7 / Hoje / 30 / Personalizado |
| Problema | Filtro **não afeta** bloco Hoje, Equipamentos, Sync, AR/AP, auditoria, backups, alertas → sensação de filtro “pela metade” |
| Boas-vindas | Ausente |
| Atalhos de módulos | Ausente (exceto Equipamentos) |

### 2.2 Contagem

| Tipo | Qtd |
|---|---|
| Seções nomeadas | 4 (+ listas soltas) |
| Cards KPI | 19 |
| Cards lista | 8 |
| Gráficos | **0** |
| CTAs para módulos | **1** |
| **Total de componentes de superfície** | **27** |

### 2.3 Classificação de todos os cards

| # | Card | Classificação | Pertence ao Dashboard? | Ajuda decisão? |
|---|---|---|---|---|
| 1 | Vendas de hoje | **Obrigatório** | Sim | Sim |
| 2 | Faturamento de hoje | **Obrigatório** | Sim | Sim |
| 3 | Lucro estimado (hoje) | **Importante** | Sim (com cuidado) | Parcial |
| 4 | Ticket médio (hoje) | **Secundário** | Sim | Baixo |
| 5 | Equipamentos cadastrados | **Secundário** | Saúde / Admin | Baixo como KPI |
| 6 | Equipamentos Online | **Importante** | Saúde | Sim se hardware crítico |
| 7 | Equipamentos Offline | **Importante** | Alertas | Sim se > 0 |
| 8 | Equipamentos Pendentes | **Desnecessário** | — | Duplica Sync Pendentes |
| 9 | Sync Pendentes | **Secundário** | Saúde | Médio |
| 10 | Sync Concluídas | **Oculto** | Equipamentos | Não (total vitalício) |
| 11 | Sync Erros | **Importante** | Alertas | Sim se > 0 |
| 12 | Faturamento (período) | **Obrigatório** | KPIs estratégicos | Sim |
| 13 | Vendas (período) | **Obrigatório** | KPIs estratégicos | Sim |
| 14 | Ticket médio (período) | **Secundário** | Comercial | Baixo |
| 15 | Produtos vendidos | **Secundário** | Comercial | Médio |
| 16 | Lucro estimado (período) | **Importante** | KPIs | Parcial |
| 17 | Ações (últimos 7 dias) | **Oculto** | Auditoria | Não para gestor |
| 18 | Contas a receber | **Obrigatório** | Financeiro (resumo) | Sim |
| 19 | Contas a pagar | **Obrigatório** | Financeiro (resumo) | Sim |
| 20 | Mais vendidos | **Importante** | Operação / Comercial | Médio (só 3 itens) |
| 21 | Menos vendidos | **Secundário** | Relatórios | Baixo |
| 22 | Estoque baixo | **Obrigatório** | Alertas | Sim |
| 23 | Formas de pagamento | **Importante** | Comercial (gráfico) | Sim |
| 24 | Próximos do vencimento | **Obrigatório** | Alertas | Sim |
| 25 | Produtos vencidos | **Obrigatório** | Alertas | Sim |
| 26 | Backups recentes | **Secundário** | Admin / Saúde | Baixo para operador |
| 27 | Alertas de auditoria | **Importante** | Alertas (filtrado) | Sim se crítico |

### 2.4 Respostas-chave (por família)

| Família | Precisa ao abrir? | Decisão? | Onde deveria viver |
|---|---|---|---|
| Hoje (vendas/faturamento) | Sim | Sim | Dashboard — hero |
| Período (duplica Hoje) | Só se ≠ Hoje | Sim | KPIs estratégicos |
| Equipamentos + Sync | Só status/alerta | Condicional | Bloco Saúde / Alertas |
| AR / AP | Sim (resumo) | Sim | Bloco Financeiro + CTA |
| Rankings / formas pgto | Útil | Médio | Operação / gráfico |
| Estoque / validade | Sim (alerta) | Sim | Alertas Inteligentes |
| Auditoria / backups | Admin | Baixo | Administração / Saúde |
| Central / Fiscal | **Ausente hoje** | Alto | Blocos dedicados |

---

## 3. Problemas encontrados

### Críticos
1. **Não é Centro de Comando** — falta narrativa (boas-vindas → o que exige ação → resumo).
2. **Ausência total** de Central de Entradas e NFC-e (arquitetura V1).
3. **0 gráficos** — Chart.js já está no ERP; Financeiro usa, Dashboard não.
4. **Redundância Hoje × Período** quando filtro = Hoje.
5. **Duplicata Pendentes** (Equipamentos = Sync, mesma fila).

### Altos
6. Hierarquia fraca: 19 números antes de qualquer insight.
7. Filtro de período inconsistente.
8. Espaço desperdiçado (linhas `col-md-4` incompletas).
9. Jargão: Ticket, Lucro estimado, Ações, Fiscal/NF, Sync.
10. Um único CTA; cards financeiros sem “Ver Financeiro”.
11. Conflito CSS `.card-dashboard` (Produtos × Dashboard).

### Médios
12. Emojis nos títulos das listas.
13. “Menos vendidos” não mostra zeros reais.
14. Backups + alerta de backup duplicados.
15. Listas limitadas a 3–10 itens sem drill-down.

### Baixos
16. Hover/sombra genérica de “card wall”.
17. Permissão `dashboard → relatorios` desalinhada (já notado na UX V2).

---

## 4. Nova arquitetura proposta — Centro de Comando

```
┌──────────────────────────────────────────────────────────┐
│  BOAS-VINDAS + RESUMO DO DIA                             │
│  “Bom dia, {nome}” · data · status operacional           │
│  [Filtro período]  [Atualizar]                           │
├──────────────────────────────────────────────────────────┤
│  KPIs ESTRATÉGICOS (máx. 4–5)                            │
│  Faturamento · Vendas · Lucro · Ticket · Δ vs ontem      │
│  + sparkline / mini gráfico de tendência                 │
├──────────────────────────────────────────────────────────┤
│  OPERAÇÃO HOJE                                           │
│  Pulse: vendas agora · ticket · formas (mini pizza)      │
│  Top 5 produtos · CTA Histórico de Vendas                │
├──────────────────────────────────────────────────────────┤
│  ALERTAS INTELIGENTES (só o que exige ação)              │
│  Estoque baixo · Vencidos · Offline · Sync erro ·        │
│  Docs Central pendentes · NFC-e rejeitadas               │
├───────────────────────┬──────────────────────────────────┤
│  FINANCEIRO (resumo)  │  FISCAL                          │
│  Receber · Pagar      │  NFC-e hoje · rejeições          │
│  CTA → Financeiro     │  CTA → NFC-e Emitidas            │
├───────────────────────┴──────────────────────────────────┤
│  CENTRAL DE ENTRADAS                                     │
│  Aguardando XML · Em revisão · Prontas · Erros           │
│  CTA → Central de Entradas                               │
├──────────────────────────────────────────────────────────┤
│  SAÚDE / EQUIPAMENTOS (compacto)                         │
│  Online/Offline · Erros sync · Backup OK?                │
│  CTA → Lab / Equipamentos (admin)                        │
├──────────────────────────────────────────────────────────┤
│  ATIVIDADE RECENTE (timeline)                            │
│  Últimas vendas · docs recebidos · alertas resolvidos    │
└──────────────────────────────────────────────────────────┘
```

### Wireframe textual (viewport 1366+)

```
[ Bom dia, Maria · Sex 11/07 ]          [ Hoje ▾ ] [ Filtrar ]

┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│Fat.│ │Vend│ │Lucr│ │Tick│ │ Δ% │   ← KPIs (uma linha)
└────┘ └────┘ └────┘ └────┘ └────┘
[======== gráfico tendência 7d ========]

OPERAÇÃO HOJE          ALERTAS (3)
┌──────────────┐       ┌─────────────────┐
│ pizza pgto   │       │ ⚠ 4 estoque     │
│ top 5 lista  │       │ ⚠ 2 vencidos    │
└──────────────┘       │ ⚠ 1 sync erro   │
                       └─────────────────┘

FINANCEIRO     FISCAL          CENTRAL
┌────────┐    ┌────────┐      ┌────────────┐
│Receber │    │NFC-e 12│      │Aguard. XML │
│Pagar   │    │Rejeit 0│      │Revisão  3  │
│[abrir] │    │[abrir] │      │[abrir]     │
└────────┘    └────────┘      └────────────┘

SAÚDE: ● 8 online · 1 offline · Backup OK
ATIVIDADE: timeline compacta (5 eventos)
```

### Hierarquia visual

1. **Primário:** Boas-vindas + KPIs + Alertas  
2. **Secundário:** Operação / Financeiro / Fiscal / Central  
3. **Terciário:** Saúde / Atividade  
4. **Fora do Dashboard:** Auditoria detalhada, Lab, rankings longos, Sync concluídas

---

## 5. Mapa de componentes (manter / reorganizar / remover)

| Ação | Qtd | Itens |
|---|---|---|
| **Manter** (no Dashboard, forma similar) | **10** | Vendas hoje, Fat. hoje, Fat. período, Vendas período, Lucro (1x), Receber, Pagar, Estoque baixo, Vencidos, Próximo vencimento |
| **Reorganizar** (outro bloco / formato) | **11** | Ticket, Formas pgto → gráfico; Mais vendidos → top 5; Online/Offline/Erros → Saúde/Alertas; Sync pendentes → Saúde; Lucro período fundido; Alertas auditoria filtrados; Backups → Saúde |
| **Remover da superfície** (ou ocultar) | **6** | Equip. cadastrados (KPI), Equip. Pendentes (dup), Sync Concluídas, Ações 7 dias, Menos vendidos, (redundância Hoje quando filtro=Hoje) |
| **Adicionar (só UX — dados já existentes ou de módulos)** | **+6 blocos** | Boas-vindas, tendência, Alertas unificados, Fiscal resumo, Central resumo, Timeline |

> Adições futuras usam dados já disponíveis em APIs de módulo; **esta auditoria não implementa nem altera SQL**.

---

## 6. Propostas de visualização

| Em vez de… | Preferir… |
|---|---|
| 19 cards numéricos | 4–5 KPIs + sparkline |
| Formas de pagamento (lista) | Mini pizza / barras |
| Faturamento só número | Linha 7 dias |
| Alertas espalhados | Inbox de alertas com severidade |
| Rankings 3 itens | Top 5 + “Ver mais” |
| Sync 3 cards | 1 chip de saúde |
| Backups lista | Status “Backup OK / atrasado” |

---

## 7. Prioridades e plano

### Crítica
1. Redesenhar como Centro de Comando (blocos §4).  
2. Incluir **Central** e **Fiscal** no primeiro viewport.  
3. Unificar **Alertas Inteligentes**.  
4. Eliminar duplicatas (Pendentes, Hoje×Período).

### Alta
5. Introduzir 1–2 gráficos (tendência + formas).  
6. CTAs para Financeiro, Central, NFC-e, Histórico.  
7. Consertar hierarquia: hero → alertas → módulos.  
8. Filtro de período coerente (ou rotular “Hoje” como fixo).

### Média
9. Timeline de atividade.  
10. Saúde compacta (equipamentos + backup).  
11. Remover jargão / emojis.  
12. Isolar CSS do Dashboard.

### Baixa
13. Personalização por perfil (operador × admin).  
14. Heatmap de vendas por hora (futuro).  
15. Alinhar permissão `dashboard`.

### Sprints sugeridas (somente UI)

| Sprint | Foco |
|---|---|
| **DASH-A** | Wireframe + shell de blocos + remover duplicatas visuais |
| **DASH-B** | KPIs estratégicos + gráfico tendência + alertas unificados |
| **DASH-C** | Blocos Financeiro / Fiscal / Central + CTAs |
| **DASH-D** | Saúde + timeline + polish responsivo |

---

## 8. Números finais

| Métrica | Valor |
|---|---|
| Nota atual | **32 / 100** |
| Nota estimada pós-redesign | **82 / 100** |
| Componentes mantidos | **10** |
| Reorganizados | **11** |
| Removidos / ocultos da superfície | **6** |
| Blocos novos (arquitetura UX) | **6** |
| Gráficos atuais | **0** → propostos **2–3** |

---

## 9. Confirmação

**Nenhuma funcionalidade, API, SQL, banco ou regra de negócio foi alterada.**  
Entrega: auditoria + wireframe + mapa + prioridades + plano.

**Parecer:** Dashboard atual **reprovado** como Centro de Comando; redesign UX **recomendado** antes de novas features de painel.
