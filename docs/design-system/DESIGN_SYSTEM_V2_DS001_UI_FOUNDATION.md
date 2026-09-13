# CDS Design System V2 — Sprint DS-001

**CDS UI Foundation**  
**Status:** Entregue  
**Não inicia:** Monitoring M5 (Workflow)

---

## Resumo Executivo

A **CDS UI Foundation** é a única fundação visual oficial do CDS Sistemas. Novos módulos (Produção, CRM, Indústria, Logística, Portal, Mobile) devem nascer sobre tokens + componentes `cds-ui-*`, sem CSS isolado.

Monitoring Engine foi migrado **apenas na apresentação** (Hero, KPI, Badge, Empty, Grid, Notification). Lógica/API intactas. Adaptive Labels estão incorporados via `useAdaptiveLabel` e `CDS.UI.labels`.

---

## Arquivos criados

| Área | Caminho |
|------|---------|
| Tokens | `frontend/shared/design-system/tokens/*.tokens.js` (7) |
| Foundation | `frontend/shared/design-system/foundation/*.js` (16) |
| Components | `frontend/shared/design-system/components/*.js` (30+) |
| Hooks | `frontend/shared/design-system/hooks/*.js` (5) |
| Utils | `frontend/shared/design-system/utils/*.js` (4) |
| CSS | `frontend/shared/design-system/cds-ui-foundation.css` |
| Bundle | `frontend/shared/design-system/cds-ui-foundation.bundle.js` |
| Bootstrap | `frontend/shared/design-system/index.js` |
| Manifest | `frontend/shared/design-system/script-manifest.js` |
| Docs | este arquivo + `docs/DS001_AUDITORIA_COMPONENTES_DUPLICADOS.md` |
| Testes | `tests/design-system/cds-ui-foundation-ds001.test.js` |
| Scripts | `scripts/generate-cds-ui-foundation*.js`, `build-cds-ui-bundle.js` |

## Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `frontend/erp/index.html` | CSS + bundle Foundation |
| `frontend/erp/js/cds-monitoring-engine.js` | Consome CDSHero/CDSKPI/CDSBadge/CDSEmptyState/CDSGrid/CDSNotification |
| `package.json` | `test:cds-ui-ds001` |

**Não alterados:** Fiscal, Central, motores, banco, APIs, Monitoring backend, Workflow, regras de negócio.

---

## Mapa da Foundation

```
CDS.UI
├── tokens        color · spacing · radius · typography · shadow · motion · zindex
├── foundation    colors · typography · spacing · radius · shadows · elevation
│                 animations · motion · breakpoints · zindex · icons · transitions
│                 opacity · layout · grid · theme
├── components    CDSHero · CDSCard · CDSWidget · CDSKPI · CDSBadge · …
├── hooks         useAdaptiveLabel · useBreakpoint · useTheme · useNotification · useHealth
├── utils         IconResolver · ColorResolver · MotionResolver · ThemeResolver
└── labels        AdaptiveLabelService (oficial)
```

## Mapa dos Tokens

| Token | Uso |
|-------|-----|
| color | ink, muted, brand, status tones |
| spacing | card/hero/kpi padding, grid gap |
| radius | card 10px, hero 12px, badge pill |
| typography | hero/card/kpi scales |
| shadow | card/hero/kpi/focus |
| motion | fade/slide/scale durations |
| zindex | toast/overlay/modal |

## Mapa dos Componentes

Hero · Card · Widget · Panel · KPI · Badge · Button(+Group) · Input · Select · Tabs · Accordion · Grid · Section · Divider · Timeline · Alert · Recommendation · Health · Notification · Loader · EmptyState · StatusChip · Progress · Metric · QuickAction · PageHeader · Breadcrumb · Toolbar

## Mapa dos Hooks

`useAdaptiveLabel` · `useBreakpoint` · `useTheme` · `useNotification` · `useHealth`

## Mapa dos Utilities

`IconResolver` · `ColorResolver` · `MotionResolver` · `ThemeResolver`

## Mapa de Responsividade

| Nome | Min width |
|------|-----------|
| mobile | 0 |
| tablet | 768 |
| notebook | 1024 |
| desktop | 1280 |
| wide | 1440 |

CSS oficial em `cds-ui-foundation.css` (@media) — sem breakpoints por módulo.

## Mapa de Motion

Fade · Slide · Scale · Collapse · Expand (`CDSMotion` / `MotionResolver`)

## Mapa de Ícones

Biblioteca oficial: **Font Awesome** (`CDSIcons`). Emoji **proibido** como ícone de UI (apenas texto explicativo).

## Fluxograma

```
Novo módulo
  → tokens/theme
  → CDS.UI.components.*
  → useAdaptiveLabel (nomenclatura)
  → cds-ui-foundation.css
  ✗ sem CSS próprio
```

---

## Checklists

### Arquitetural
- [x] Uma Foundation oficial (`CDS.UI`)
- [x] Tokens únicos
- [x] Adaptive Labels na Foundation
- [x] Zero alteração em regras/APIs/motores

### UX
- [x] Card/KPI/Hero padronizados (radius/shadow/padding)
- [x] Badges e status oficiais
- [x] Empty / Loader / Notification oficiais
- [x] Ícones FA

### Design System
- [x] Componentes documentados
- [x] Proibição de CSS isolado para novos módulos
- [x] Bundle + CSS no ERP

### Não regressão
- [x] Monitoring lógica intacta
- [x] Compat `cds-cfg-*` mantida (alias visual)
- [x] M5 não iniciada

### Readiness Final
| Item | Status |
|------|--------|
| Foundation pronta para novos módulos | Sim |
| Migração legado completa | Não (plano P0–P2) |
| M5 Workflow | Não iniciada |

---

## Respostas obrigatórias

1. **Componente visual duplicado após a Foundation?**  
   **No catálogo oficial, não** — um Hero/Card/KPI/Badge. **No legado, sim** (`cc-*`, `central-*-kpi`, etc.) — ver auditoria P0–P2. Novos módulos não devem duplicar.

2. **Módulo ainda cria Hero próprio?**  
   **Legado sim** (dashboard `cc-hero`, central-diagnostico). **Monitoring não** — usa `CDSHero`.

3. **KPIs próprios?**  
   **Legado sim** (dashboard `cc-kpi`, central-entradas). **Monitoring não** — usa `CDSKPI`.

4. **Notificações fora do CDSNotification?**  
   **Sim no legado** (~57 `alert()`, `showNotification` Bootstrap). Monitoring passou a preferir `CDSNotification` (fallback `showNotification`). Migração gradual oficial.

5. **CSS legado removível?**  
   **Sim, gradualmente** — `central-configuracao.css` (duplicata), depois `dashboard-command.css` / entradas UX1. Não remover agora (regra de não regressão).

6. **Pronto para Produção/CRM/Indústria/Logística/Mobile/Portal sem novos componentes-base?**  
   **Sim para base visual** (tokens + componentes + hooks + labels). Domínios de negócio novos usam `registerDomain` + composição dos componentes existentes.

7. **Adaptive Labels incorporados?**  
   **Sim.** `useAdaptiveLabel`, `CDS.UI.labels`, `CDS.UI.AdaptiveLabels` / DesignSystem bridge no `index.js`.

---

## Uso rápido

```js
CDS.UI.components.CDSHero.render({ title: '…', subtitle: '…', icon: 'fa-chart-pie' })
CDS.UI.hooks.useAdaptiveLabel().getLabel('vendas')
CDS.UI.notify('Salvo', 'success')
```

```bash
npm run test:cds-ui-ds001
node scripts/build-cds-ui-bundle.js   # regenerar bundle após editar fontes
```
