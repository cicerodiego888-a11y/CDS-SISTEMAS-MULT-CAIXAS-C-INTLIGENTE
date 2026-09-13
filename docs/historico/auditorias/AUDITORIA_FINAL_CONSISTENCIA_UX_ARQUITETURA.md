# AUDITORIA FINAL — Consistência Visual e Arquitetural

**Data:** 2026-07-15  
**Escopo:** somente leitura · sem alteração de código · sem implementação  
**Contexto:** Plataforma Fiscal RC1.1 + Central Inteligente RC4.3 concluídas

---

## Resumo Executivo

O núcleo **fiscal / Central / Centro de Configurações** está arquiteturalmente alinhado à fonte única (RC3.1 / RC4.3), com atalhos de Manifestação e Ambiente corretos.

A experiência visual **não é uniforme em todo o CDS**: há vários “micro Design Systems” (cds-cfg, central-ux1, cc-dashboard, central-diag, central-hom, miip, financeiro, pdv-themes) com tokens, heróis e badges distintos. Cadastros e Financeiro ainda dependem fortemente de Bootstrap ad-hoc.

**Veredito de homologação (escopo fiscal/Central):**  
**PARCIALMENTE CONSISTENTE** — apto à homologação SEFAZ/Central com ressalvas UX; **não** se pode afirmar consistência visual de **todo** o CDS Sistemas.

**Confidence Score:** **72 / 100**

---

## Resposta obrigatória

### O CDS Sistemas está visualmente e arquiteturalmente consistente para homologação?

**NÃO de forma plena (todo o produto).**  
**SIM com ressalvas** para o perímetro **Centro de Configurações + Central Inteligente + Plataforma Fiscal + Monitor DF-e**.

**Justificativa técnica:**

| Dimensão | Avaliação |
|----------|-----------|
| Arquitetura fiscal (fonte única Ambiente/Cert/CSC/Manifestação) | Consistente (RC3.1/RC4.3) |
| UX de descoberta Manifestação / deep-link | Consistente pós-RC4.3 |
| Design System único em todas as telas ERP/PDV | **Não** — múltiplos sistemas locais |
| Endpoints editáveis na Central (consulta chave) | **Divergência arquitetural** vs docs oficiais |
| Homologação SEFAZ do ciclo DF-e | Não bloqueada por inconsistência visual de Cadastros/Financeiro |

---

## Parte 1 — Telas principais × Design System

| Tela | Design System dominante | Mesmo padrão CDS? |
|------|-------------------------|-------------------|
| Centro de Configurações | `cds-cfg-*` | Parcial (próximo do institucional) |
| Central Inteligente | `central-ux1-*` + `central-cfg-*` | Parcial |
| Dashboard | `cc-*` (dashboard-command) | Parcial (tokens próprios) |
| Diagnóstico | Bootstrap + `central-diag-*` | Não (sem hero CDS) |
| Monitor DF-e | `central-hom-*` | Não (chips/emoji/timeline próprios) |
| Central de Compras | Bootstrap + `miip-compras` | Não |
| MIIP | `miip-*` (índigo/roxo) | Não |
| Financeiro | `financeiro-*` legado | Não |
| Cadastros | Bootstrap genérico | Não |
| PDV | `pdv-themes` tokenizado | Isolado (não compartilhado com ERP) |

**Todas seguem o mesmo Design System?** **NÃO.**

---

## Parte 2 — Elementos visuais (divergências)

| Elemento | Divergência |
|----------|-------------|
| Cabeçalhos / Hero | Centro/Central/Dashboard: heroes gradient distintos; Diagnóstico/Financeiro/Cadastros: sem hero institucional |
| Cards / KPIs | Raios, sombras e grids diferentes (ux1 vs cc vs cds-cfg vs Bootstrap) |
| Tipografia | Sem família tipográfica única documentada no ERP |
| Espaçamento | Tokens `--cc-gap` / `--ux1-*` / `--cds-cfg-*` não unificados |
| Ícones | Font Awesome dominante; Compras usa emoji em atalho |
| Badges | Vocabulários distintos: `ok/warn/error` vs `verde/amarelo` vs Bootstrap `bg-*` vs emoji health |
| Botões | Bootstrap misturado em todos; PDV tem painel próprio |
| Cores | Navy CDS vs azul Dashboard vs índigo MIIP vs #007bff Financeiro |
| Grid | Bootstrap 12-col vs grids CSS custom |
| Responsividade | Presente nos shells novos; legado irregular |

---

## Parte 3 — Arquitetura de configuração

| Pergunta | Resposta |
|----------|----------|
| Tela editando o que deveria ser RO? | **SIM (parcial):** Central ainda edita **Consulta chave** Prod/Hom (`cfgUrlConsulta*`) e persiste via PUT — diverge de “endpoints via UrlResolver” |
| Duplicidade de UI fiscal Ambiente/Cert/CSC? | **Não** — edição oficial no Centro → Fiscal |
| Manifestação fora do Centro? | **Não** (pós-RC4.3) — Central só leitura |
| Config operacional fora do Centro? | **SIM, intencional:** sync/timeouts/retries na Central (documentado) |

---

## Parte 4 — Atalhos

| Atalho | Destino | Correto? |
|--------|---------|----------|
| Abrir Configuração Fiscal (Central Ambiente) | `configuracoes-avancadas` + tab Fiscal | SIM |
| Abrir Configuração Fiscal (Manifestação) | tab Fiscal + anchor `#cdsCfgCardManifestacao` | SIM |
| Abrir Configuração Fiscal (dentro do Centro) | scroll área Fiscal | SIM |
| Diagnóstico (Central) | `central-diagnostico` | SIM |
| Monitor DF-e | view interna `ciclo-dfe` | SIM (não é `data-page` global) |
| Abrir Central (Centro) | `central-entradas` | SIM |

---

## Parte 5 — Mensagens

**Não seguem o mesmo padrão.**

- Padrão dominante: `showNotification` (`core.js`)
- Ainda há: `alert()`, `prompt()`, HTML inline, toast MIIP próprio
- Homologação chama `mostrarToastCentral` **sem definição encontrada** → fallback `alert()`
- Diagnóstico usa tom `'error'` (Bootstrap espera `danger` em alguns caminhos)

---

## Parte 6 — Badges conflitantes

- Par **Integrada + Desativada**: **não encontrado** no código atual (corrigido na RC4.1/RC4.3).
- Inconsistências remanescentes:
  - KPI Centro marca Central como `ok` mesmo com “Scheduler off”
  - Vocabulário Cooldown “Ativo/Não” vs “Ativo até/Inativo”
  - Classes `central-hom-health--*` declaradas no JS sem CSS correspondente

---

## Parte 7 — Nomenclatura

| Nome | Uso | Consistente? |
|------|-----|--------------|
| Central Inteligente (de Entradas) | UI / shell | Predominante |
| Central Entradas | paths/API/logs | Técnico OK, confunde usuário |
| Centro de Configurações | título UI | SIM |
| Configurações Avançadas | `data-page`, docs, labels RO | Alias legado — confunde |
| Manifestação / Monitor DF-e / Plataforma Fiscal | docs RC | SIM no perímetro novo |

---

## Parte 8 — Documentação

| Doc | Status |
|-----|--------|
| ARQUITETURA_OFICIAL / CENTRAL_ENTRADAS / CHANGELOG | Alinhados RC3.1–RC4.3 no essencial |
| RC4.3 | Atual |
| RC4.2 | Contém texto histórico “UI na Central” + nota RC4.3 no rodapé — **ambíguo** se lido fora de ordem |
| Capturas | Mocks de sprint (RC4.1/RC4.3) ≠ screenshots de produto real |

---

## Parte 9 — Divergências doc × implementação

1. **Consulta chave editável na Central** vs arquitetura “endpoints SEFAZ via UrlResolver / sem edição na Central”.  
2. **RC4.2** corpo vs rodapé RC4.3 (estado temporal mal sinalizado).  
3. Alias **Configurações Avançadas** vs **Centro de Configurações**.  
4. Monitor homologação: feedback toast incompleto (`mostrarToastCentral` ausente).

---

## Parte 10 — Classificação de melhorias

### Obrigatórias (antes de tratar o CDS como “visualmente único”)
1. ~~Remover ou tornar RO as URLs **Consulta chave** na Central~~ — **corrigido em RC4.3.1**
2. Esclarecer RC4.2 (marcar seções como pré-RC4.3) para evitar erro operacional.
3. ~~Corrigir feedback do Monitor (`mostrarToastCentral`)~~ — **corrigido em RC4.3.1** (alias de `showNotification`)

### Recomendadas
1. Unificar tokens visuais (hero, badge, KPI) entre `cds-cfg`, `central-ux1`, `cc-*`, `central-diag`.  
2. Renomear labels “Configurações Avançadas” → “Centro de Configurações” na Central.  
3. Alinhar Diagnóstico ao hero/shell CDS.  
4. Substituir emoji health do Monitor por badges do Design System.  
5. Remover CSS legado paralelo `central-entradas.css` se UX1 for canônico.

### Cosméticas
1. Harmonizar raios/sombras/grids.  
2. Padronizar tom Bootstrap `danger` vs `error`.  
3. Remover emoji do atalho Compras → Central.  
4. Capturas reais de produto na documentação.

---

## Mapas

### Mapa das telas

```
ERP Shell
├── Dashboard (cc-*)
├── Centro Config (cds-cfg-*) ← edição fiscal oficial
├── Central Inteligente (ux1 + cfg + hom)
│   ├── Inbox / Config RO / Log
│   └── Monitor DF-e (central-hom)
├── Diagnóstico (diag + Bootstrap)
├── Compras / MIIP (miip-*)
├── Financeiro (legado)
└── Cadastros (Bootstrap)
PDV ── pdv-themes (isolado)
```

### Mapa arquitetural (config)

```
Centro Fiscal ──edita──► fiscal_* (getFiscalConfig)
Centro Fiscal ──edita──► manifestacao_destinatario_politica (central_entradas_config)
Central ──consome RO──► Ambiente / Manifestação / DF-e URLs
Central ──AINDA edita──► sefaz_url_consulta_chave_*  ← ressalva
Plataforma Fiscal ──resolve──► endpoints SOAP (Registry/UrlResolver)
```

---

## Checklists

### UX
- [x] Deep-link Manifestação  
- [x] Central RO Manifestação/Ambiente  
- [ ] Design System único em todas as telas  
- [ ] Feedback/toast único  
- [ ] Nomenclatura Centro vs Avançadas unificada na UI  

### Arquitetural
- [x] Fonte única Ambiente/Cert/CSC  
- [x] Fonte única política Manifestação  
- [ ] Central sem endpoints SEFAZ editáveis (consulta chave)  
- [x] Sem duplicidade Ambiente no módulo Fiscal  

### Visual
- [ ] Tokens compartilhados ERP  
- [ ] Badges com vocabulário único  
- [ ] Hero padrão Diagnóstico/Financeiro/Cadastros  
- [x] Perímetro Central/Centro visualmente próximo  

---

## Readiness Final

| Perímetro | Readiness |
|-----------|-----------|
| Homologação SEFAZ / ciclo DF-e / Manifestação | **APTO com ressalvas** |
| Consistência visual “todo CDS” | **NÃO pronto** (dívida UX multi-módulo) |
| Consistência arquitetural fiscal oficial | **APTO** (exceto consulta chave editável) |

**Confidence Score: 72/100**  
(Arquitetura fiscal alta; Design System global e endpoints consulta chave reduzem o score.)
