# DS-001 — Relatório de Componentes Duplicados + Plano de Migração

**Gerado:** Sprint DS-001  
**Escopo:** `frontend/**`  
**Foundation alvo:** `cds-ui-*` + `CDS.UI`

---

## Relatório por prioridade

### P0 — Obrigatório (próximas sprints de migração visual)

| Item | Onde | Ação |
|------|------|------|
| KPI paralelo `cc-kpi` | `dashboard.html`, `dashboard-command.css` | → `CDSKPI` / `cds-ui-kpi` |
| Hero paralelo `cc-hero` | idem | → `CDSHero` |
| KPI Central Entradas (`central-*-kpi`) | `central-entradas.js` + CSS | → `CDSKPI` |
| Badges `central-cfg-badge` / `central-ux1-badge` | central config / entradas | → `CDSBadge` |
| `alert()` (~57) | financeiro-receber/pagar, usuarios… | → `CDSNotification` / `useNotification` |
| CSS duplicado `central-configuracao.css` vs `cds-cfg` | `frontend/css/` | consolidar tokens → Foundation; deprecar arquivo |

### P1 — Recomendado

| Item | Onde | Ação |
|------|------|------|
| Cards `central-ux1-card` / `dashboard-card` | entradas, financeiro | → `CDSCard` |
| Empty states ad-hoc | 15+ módulos | → `CDSEmptyState` |
| `showNotification` Bootstrap skin | `core.js` | skin `cds-ui-toast` via `CDSNotification` |
| `cds-page-shell` parcial | vários ERP JS | alinhar PageHeader/Toolbar Foundation |
| `miip-badge-*` | MIIP CSS | mapear tones → Badge (sem tocar regra MIIP) |

### P2 — Cosmético / escopo isolado

| Item | Onde | Nota |
|------|------|------|
| PDV themes / `pdv-card` | pdv CSS | manter isolado até sprint PDV DS |
| Login/splash hero | login-experience | fora do ERP shell |
| Homologação chips | central-homologacao | overlap baixo |

---

## Plano oficial de migração do legado

1. **Freeze visual novos módulos** — só `CDS.UI` + Adaptive Labels.  
2. **P0 Dashboard** — Hero/KPI/Badge → Foundation (sem mudar dados).  
3. **P0 Notificações** — eliminar `alert()` financeiro.  
4. **P0 CSS** — deprecar `central-configuracao.css` após swap de classes.  
5. **P1 Central Entradas** — KPI/Card/Empty (UX only).  
6. **P1 Toast unificado** — `showNotification` delega a `CDSNotification`.  
7. **P2 PDV/Login** — quando houver sprint dedicada.

**Já migrado (referência):** Monitoring Engine (apresentação), Centro de Configurações (`cds-cfg-*` alias da Foundation).

---

## Proibições (oficiais)

- Criar CSS específico quando existir componente oficial.  
- Duplicar Hero, Card, Badge, KPI, Widget, Notification, Empty, Timeline, Grid, Breakpoints, Motion.  
- Usar emoji como ícone principal de UI.
