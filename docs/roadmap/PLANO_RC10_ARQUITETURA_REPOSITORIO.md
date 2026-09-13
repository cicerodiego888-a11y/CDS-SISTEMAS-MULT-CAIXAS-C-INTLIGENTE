# PLANO RC10 — REORGANIZACAO ARQUITETURAL DO REPOSITORIO

**Sprint:** RC10.0.1 (READ-ONLY)  
**Data:** 2026-07-26  
**Confidence:** 1.00  

**Garantias:** nenhum arquivo movido, apagado ou alterado; `.cursorignore`, codigo e banco intactos. Este documento e a unica entrega.

---

## 1. Resumo executivo

A raiz do repositorio contem **51 arquivos** (apos limpeza RC9.0.4), dos quais **31 sao documentacao Markdown** — a maioria historica (relatorios de sprint, resumos, correcoes, auditorias antigas). Os itens essenciais (Electron, builders, package.json) sao apenas ~20.

Proposta: consolidar TODA a documentacao sob `docs/` com separacao **oficial vs historico**, esvaziar a raiz para o minimo operacional e preparar convencoes de nomenclatura para os proximos ciclos.

Impacto esperado:
- Raiz: **51 -> ~20 arquivos** (so essenciais)
- Navegacao e onboarding mais simples
- `.cursorignore` mais simples e robusto (ignora `docs/historico/` inteiro em vez de padroes por prefixo)
- Reducao de ruido no contexto do Cursor Agent

Referencias criticas encontradas (mover exige ajuste de codigo — **fora do escopo desta RC**):
1. `PROTOCOLO_TOLEDO.md` — referenciado por `backend/motores/equipamentos/engenharia-reversa/paths.js`, `ProtocolDocumentation.js` e `tests/motor-equipamentos/engenharia-reversa-sprint13.test.js`
2. `README.md` — referenciado por `package.json`, `electron-builder-erp.json`, `electron-builder-pdv.json` (files list) e rotas backend

---

## 2. FASE 1 — Auditoria da raiz (inventario e classificacao)

### 2.1 Arquivos

| Item | Classe | Nota |
|------|--------|------|
| `package.json`, `package-lock.json` | **Essencial** | NAO mover |
| `.gitignore`, `.gitattributes`, `.cursorignore` | **Essencial** | NAO mover |
| `README.md` | **Essencial** | Referenciado por builders — NAO mover |
| `electron.js`, `electron-erp.js`, `electron-pdv.js`, `preload.js` | **Essencial** (entrypoints) | NAO mover |
| `electron-common.js`, `electron-integrity.js`, `electron-diagnostico.js`, `electron-auditoria-rc3164.js`, `electron-rede-cliente.js`, `electron-rede-recuperacao.js`, `electron-sessao-rede.js` | **Essencial** (runtime Electron) | Movimentacao exigiria refactor de requires — manter |
| `electron-builder-erp.json`, `electron-builder-pdv.json` | **Essencial** (build config) | NAO mover |
| `electron-manifest.json` | **Build** (artefato) | Ja ignorado; regeneravel |
| `Logo.jpeg` | **Temporario/Asset solto** | Duplicado conceitual de `assets/branding` |
| `ARQUITETURA_PAGAMENTOS.md` | **Doc Oficial** | Mover p/ `docs/arquitetura/` |
| `PROTOCOLO_TOLEDO.md` | **Doc Tecnica com dependencia de codigo** | Mover SOMENTE com ajuste de paths (fase futura) |
| `MODULO_PROMOCOES_INTELIGENTES.md`, `GUIA_USO_PROMOCOES.md`, `GUIA_ENCERRAMENTO_AUTOMATICO_PROMOCOES.md` | **Doc Tecnica** | `docs/modulos/promocoes/` |
| `INSTRUCOES_UPLOAD_CERTIFICADO.md`, `HOMOLOGACAO_CE_PASSO_A_PASSO.md`, `CHECKLIST_HOMOLOGACAO_TOLEDO.md` | **Doc Homologacao** | `docs/homologacao/` |
| `CHECKLIST_ENTREGA.md`, `CHECKLIST_TECNICO.md` | **Doc Historica** (entrega jun/2026) | `docs/historico/checklists/` |
| `AUDITORIA_MOTOR_BALANCAS.md`, `RELATORIO_AUDITORIA_FINAL_MOTOR_EQUIPAMENTOS.md`, `RELATORIO_AUDITORIA_INTEGRIDADE.md` | **Doc Historica (auditorias)** | `docs/historico/auditorias/` |
| `RELATORIO_SPRINT_11A.md`, `RELATORIO_SPRINT_12.md`, `RELATORIO_SPRINT_13.md`, `RELATORIO_ETAPA_10.md`, `RELATORIO_REFATORACAO_ERP_PDV.md`, `RELATORIO_CORRECAO_COMPLETO.md` | **Doc Historica (sprints)** | `docs/historico/sprints/` |
| `RELATORIO_RC9_0_1..4*.md` | **Doc Historica (RC governanca)** | `docs/historico/rcs/rc9/` |
| `RESUMO_*.md` (4), `SUMARIO_FINAL.md`, `CORRECAO_*.md` (2) | **Doc Historica** | `docs/historico/resumos/` |
| `PLANO_RC10_ARQUITETURA_REPOSITORIO.md` (este) | **Doc de planejamento ativo** | `docs/roadmap/` apos execucao |

### 2.2 Pastas

| Pasta | Classe | Destino proposto |
|-------|--------|------------------|
| `backend/`, `frontend/` | **Essencial (codigo)** | Manter |
| `build/` | **Desenvolvimento** (scripts de build) | Manter |
| `scripts/` | **Desenvolvimento** | Manter (subpastas por dominio — opcional) |
| `tests/` | **Testes** | Manter |
| `assets/` | **Essencial (branding)** | Manter; absorver `Logo.jpeg` e `imagem/` |
| `config/` | **Essencial** | Manter |
| `docs/` | **Documentacao** | Reorganizar internamente (arvore abaixo) |
| `dist/`, `dist20-07/` | **Build** | Manter (`dist20-07` = evidencia RC3.16.4) |
| `node_modules/` | **Dependencias** | Manter |
| `dados/`, `storage/`, `logs/`, `backups/` | **Runtime local** | Manter (ja ignorados) |
| `imagem/` | **Temporario/Asset solto** | Consolidar em `assets/` (fase futura) |
| `.git/` | **Essencial** | Manter |

---

## 3. FASE 2 — Nova arvore recomendada

```
CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE/
│
├── package.json / package-lock.json
├── README.md
├── .gitignore / .gitattributes / .cursorignore
├── electron*.js / preload.js                  # entrypoints + runtime Electron
├── electron-builder-erp.json / -pdv.json
│
├── backend/                                   # codigo (inalterado)
├── frontend/                                  # codigo (inalterado)
├── build/                                     # scripts de empacotamento
├── scripts/                                   # utilitarios de dev
├── tests/                                     # suites de teste
├── assets/                                    # branding + imagens (absorve Logo.jpeg, imagem/)
├── config/
│
├── docs/
│   ├── arquitetura/                           # ARQUITETURA_OFICIAL_CDS_V1, NUCLEO_TRANSACIONAL, V4, MIIP, pagamentos...
│   ├── oficial/                               # RELEASE_V1, BRANDING, CERTIFICADO_V1, principios
│   ├── motores/
│   │   ├── miip/                              # MIIP_*.md, MIP_*.md, CHANGELOG_MIP
│   │   ├── equipamentos/                      # DISCOVERY_ENGINE, INTEGRACAO_EQUIPAMENTOS, PROTOCOLO_TOLEDO*
│   │   └── monitoring/                        # MONITORING_ENGINE_M1..M4
│   ├── fiscal/                                # FISCAL_PLATFORM, CENTRAL_ENTRADAS_*
│   ├── design-system/                         # DESIGN_SYSTEM_V2_*, UX_*
│   ├── modulos/
│   │   └── promocoes/                         # MODULO_PROMOCOES + GUIAs
│   ├── homologacao/                           # INSTRUCOES_UPLOAD_CERTIFICADO, HOMOLOGACAO_CE, CHECKLIST_HOMOLOGACAO_TOLEDO
│   ├── roadmap/                               # CHANGELOG_ARQUITETURAL (ativo), planos RC futuros
│   ├── assets/                                # PNGs (ja ignorado)
│   └── historico/                             # TUDO ignorado pelo Cursor
│       ├── auditorias/                        # AUDITORIA_*, RELATORIO_AUDITORIA_*, docs/auditoria/*
│       ├── relatorios/                        # RELATORIO_CORRECAO, ETAPA, REFATORACAO
│       ├── rcs/
│       │   ├── rc1-rc7/                       # docs/RC*.md concluidas
│       │   └── rc9/                           # RELATORIO_RC9_0_1..4
│       ├── sprints/                           # RELATORIO_SPRINT_*
│       ├── resumos/                           # RESUMO_*, SUMARIO_FINAL, CORRECAO_*
│       └── checklists/                        # CHECKLIST_ENTREGA, CHECKLIST_TECNICO
│
├── dist/                                      # build vigente (ignorado)
├── dist20-07/                                 # evidencia RC3.16.4 (ignorado) — futura realocacao p/ ferramentas/evidencias/
├── dados/ storage/ logs/ backups/             # runtime local (ignorados)
└── node_modules/
```

*Opcional (fase 2 futura):* pasta `ferramentas/evidencias/rc3164/` para receber somente o `app.asar` do `dist20-07`, liberando ~460 MB.

---

## 4. FASE 3 — Classificacao documental e destinos

| Grupo | Conteudo | Destino |
|-------|----------|---------|
| **A — Oficial** | ARQUITETURA_OFICIAL_CDS_V1, ARQUITETURA_COMERCIAL_FISCAL_V4(+CONGELAMENTO), NUCLEO_TRANSACIONAL_VENDA_V1, PRINCIPIO_COMUNICACAO_ENTRE_MOTORES_V1, RELEASE_V1, BRANDING_1.0, CERTIFICADO_V1, ARQUITETURA_PAGAMENTOS (raiz) | `docs/arquitetura/` + `docs/oficial/` |
| **B — Tecnica** | MIIP_*/MIP_*, MONITORING_ENGINE_M1..M4, DISCOVERY_ENGINE_RC1, INTEGRACAO_EQUIPAMENTOS_RC5, DESIGN_SYSTEM_*, UX_*, CENTRAL_ENTRADAS_*, FISCAL_PLATFORM, MODULO_PROMOCOES + GUIAs, PROTOCOLO_TOLEDO** | `docs/motores/…`, `docs/design-system/`, `docs/fiscal/`, `docs/modulos/promocoes/` |
| **C — Homologacao** | INSTRUCOES_UPLOAD_CERTIFICADO, HOMOLOGACAO_CE_PASSO_A_PASSO, CHECKLIST_HOMOLOGACAO_TOLEDO, RC7.x homologacao (parte viva, se houver) | `docs/homologacao/` |
| **D — Auditorias** | AUDITORIA_MOTOR_BALANCAS, RELATORIO_AUDITORIA_FINAL_MOTOR_EQUIPAMENTOS, RELATORIO_AUDITORIA_INTEGRIDADE, docs/AUDITORIA_*, docs/auditoria/rc710x | `docs/historico/auditorias/` |
| **E — Relatorios** | RELATORIO_CORRECAO_COMPLETO, RELATORIO_ETAPA_10, RELATORIO_REFATORACAO_ERP_PDV, MIIP_READINESS/RELEASE reports | `docs/historico/relatorios/` |
| **F — RC concluidas** | docs/RC1…RC7.7*.md, RELATORIO_RC9_0_1..4 | `docs/historico/rcs/` |
| **G — Historico geral** | RELATORIO_SPRINT_*, RESUMO_*, SUMARIO_FINAL, CORRECAO_*, CHECKLIST_ENTREGA/TECNICO | `docs/historico/{sprints,resumos,checklists}/` |

\** `PROTOCOLO_TOLEDO.md` so migra junto com atualizacao de `paths.js`/`ProtocolDocumentation.js`/teste sprint13 (RC dedicada).

---

## 5. FASE 4 — Convencoes de padronizacao

### Nomes de arquivos (documentos)
- Formato: `TIPO_ASSUNTO_VERSAO.md` em SCREAMING_SNAKE_CASE (padrao ja dominante)
- Tipos canonicos: `ARQUITETURA_`, `GUIA_`, `HOMOLOGACAO_`, `CHECKLIST_`, `AUDITORIA_`, `RELATORIO_`, `PLANO_`, `CHANGELOG_`, `RC<numero>_`
- Proibido criar novos documentos soltos na raiz (excecao unica: `README.md`)

### Nomes de pastas
- minusculas, sem espacos/acentos, singular por dominio (`docs/fiscal/`, nao `Docs Fiscais/`)
- historico SEMPRE sob `docs/historico/<categoria>/`

### Versionamento
- Sufixo `_V1`, `_V2`… no nome; versao anterior migra para `docs/historico/` quando substituida
- `CHANGELOG_ARQUITETURAL.md` permanece o unico changelog vivo em `docs/roadmap/`
- RCs: documentacao nasce em `docs/roadmap/rcs/rc<versao>/` e migra para `docs/historico/rcs/` no encerramento

### Documentos oficiais
- Vivem fora de `docs/historico/`; sao os unicos indexaveis pelo Agent
- Um documento e "oficial" se descreve o estado ATUAL do sistema

### Documentos historicos
- Imutaveis apos arquivamento; nunca editados, apenas consultados
- Sempre ignorados pelo Cursor

### Arquivos temporarios
- Prefixo `tmp-` obrigatorio; nunca commitados (`tmp-*` no `.gitignore` — ajuste futuro)
- Dumps de debug somente em `logs/` ou `dados/` (ja ignorados)

---

## 6. FASE 5 — Plano de migracao (NAO EXECUTAR)

### Etapa 1 — Permanecem na raiz (20 itens)
`package.json`, `package-lock.json`, `README.md`, `.gitignore`, `.gitattributes`, `.cursorignore`, `electron.js`, `electron-erp.js`, `electron-pdv.js`, `preload.js`, `electron-common.js`, `electron-integrity.js`, `electron-diagnostico.js`, `electron-auditoria-rc3164.js`, `electron-rede-cliente.js`, `electron-rede-recuperacao.js`, `electron-sessao-rede.js`, `electron-builder-erp.json`, `electron-builder-pdv.json`, `electron-manifest.json` (artefato regeneravel)  
*Excecao temporaria:* `PROTOCOLO_TOLEDO.md` permanece ate RC de refactor de paths.

### Etapa 2 — Mapa origem -> destino (movimentos)

| Origem (raiz) | Destino |
|---------------|---------|
| `ARQUITETURA_PAGAMENTOS.md` | `docs/arquitetura/` |
| `MODULO_PROMOCOES_INTELIGENTES.md`, `GUIA_USO_PROMOCOES.md`, `GUIA_ENCERRAMENTO_AUTOMATICO_PROMOCOES.md` | `docs/modulos/promocoes/` |
| `INSTRUCOES_UPLOAD_CERTIFICADO.md`, `HOMOLOGACAO_CE_PASSO_A_PASSO.md`, `CHECKLIST_HOMOLOGACAO_TOLEDO.md` | `docs/homologacao/` |
| `AUDITORIA_MOTOR_BALANCAS.md`, `RELATORIO_AUDITORIA_FINAL_MOTOR_EQUIPAMENTOS.md`, `RELATORIO_AUDITORIA_INTEGRIDADE.md` | `docs/historico/auditorias/` |
| `RELATORIO_SPRINT_11A/12/13.md` | `docs/historico/sprints/` |
| `RELATORIO_ETAPA_10.md`, `RELATORIO_REFATORACAO_ERP_PDV.md`, `RELATORIO_CORRECAO_COMPLETO.md` | `docs/historico/relatorios/` |
| `RELATORIO_RC9_0_1..4*.md` | `docs/historico/rcs/rc9/` |
| `RESUMO_CORRECAO_PAGAMENTO.md`, `RESUMO_ENCERRAMENTO_AUTOMATICO.md`, `RESUMO_IMPLEMENTACAO.md`, `RESUMO_MUDANCAS.md`, `SUMARIO_FINAL.md` | `docs/historico/resumos/` |
| `CORRECAO_PAGAMENTO_PRAZO.md`, `CORRECAO_PROMOCOES_EXPIRADAS.md` | `docs/historico/resumos/` |
| `CHECKLIST_ENTREGA.md`, `CHECKLIST_TECNICO.md` | `docs/historico/checklists/` |
| `Logo.jpeg` | `assets/branding/` (verificar duplicidade antes) |
| `PLANO_RC10_ARQUITETURA_REPOSITORIO.md` | `docs/roadmap/` (apos execucao) |

**Dentro de `docs/`:**

| Origem | Destino |
|--------|---------|
| `docs/RC1…RC7.7*.md` (26 arqs) | `docs/historico/rcs/rc1-rc7/` |
| `docs/AUDITORIA_*.md`, `docs/DS001_AUDITORIA*.md` | `docs/historico/auditorias/` |
| `docs/auditoria/rc7103*, rc7104*` | `docs/historico/auditorias/` (manter subpastas) |
| `docs/MIIP_*` + `docs/MIP_*` + `docs/CHANGELOG_MIP.md` | `docs/motores/miip/` |
| `docs/MONITORING_ENGINE_M*.md` | `docs/motores/monitoring/` |
| `docs/DISCOVERY_ENGINE_RC1.md`, `docs/INTEGRACAO_EQUIPAMENTOS_RC5.md` | `docs/motores/equipamentos/` |
| `docs/DESIGN_SYSTEM_*`, `docs/UX_*` | `docs/design-system/` |
| `docs/CENTRAL_ENTRADAS_*`, `docs/FISCAL_PLATFORM.md`, `docs/CERTIFICACAO_CENTRAL_ENTRADAS*` | `docs/fiscal/` |
| `docs/ARQUITETURA_*`, `docs/NUCLEO_*`, `docs/PRINCIPIO_*` | `docs/arquitetura/` |
| `docs/RELEASE_V1.md`, `docs/BRANDING_1.0.md`, `docs/CERTIFICADO_V1.md` | `docs/oficial/` |
| `docs/CHANGELOG_ARQUITETURAL.md` | `docs/roadmap/` |
| MIIP readiness/release reports | `docs/historico/relatorios/` |

### Etapa 3 — Pastas novas
`docs/arquitetura/`, `docs/oficial/`, `docs/motores/{miip,equipamentos,monitoring}/`, `docs/fiscal/`, `docs/design-system/`, `docs/modulos/promocoes/`, `docs/homologacao/`, `docs/roadmap/`, `docs/historico/{auditorias,relatorios,rcs/rc1-rc7,rcs/rc9,sprints,resumos,checklists}/`

### Etapa 4 — Atualizacoes futuras no `.cursorignore` (NAO aplicar agora)
```
# Substituir padroes por prefixo por bloco unico:
docs/historico/

# Podem ser removidos apos a migracao (ficam redundantes):
# RELATORIO_*.md / AUDITORIA_*.md / RESUMO_*.md / SUMARIO_*.md / CHECKLIST_*.md / CORRECAO_*.md
# docs/auditoria/  (absorvida por docs/historico/)
```
Atencao: remover os padroes por prefixo SOMENTE depois que nenhum arquivo com esses nomes existir fora de `docs/historico/`.

### Etapa 5 — Validacao pos-migracao
1. `git status` — apenas renames (`R`), nenhum delete
2. `node --check` nos entrypoints; `npm run verify-build` sem NOVAS falhas
3. Testes-ancora: `test:equipamentos-contracts`, `test:nfe-parser`, `test:cds-ui-ds001`, `test:mip-sprint01`, `engenharia-reversa-sprint13` (valida PROTOCOLO_TOLEDO se movido)
4. Grep global por nomes movidos — zero referencias quebradas
5. Reindexacao do Cursor e conferencia do embed (novos caminhos `docs/historico/` fora do indice)

---

## 7. Beneficios

- Raiz 60% menor (51 -> ~20 arquivos), so operacional
- Separacao fisica oficial x historico -> ignore por pasta (robusto) em vez de padrao por nome (fragil)
- Localizacao previsivel por dominio (motores, fiscal, design-system)
- Base de convencoes para RCs futuras (nascem em roadmap, morrem em historico)
- Menos ruido de retrieval para o Agent; menos falsos positivos em buscas

## 8. Riscos

| Risco | Nivel | Mitigacao |
|-------|-------|-----------|
| Quebrar `PROTOCOLO_TOLEDO.md` (paths hardcoded) | **Alto se movido sem refactor** | Mante-lo na raiz nesta fase; migrar em RC dedicada com ajuste de `paths.js` + teste sprint13 |
| Links markdown internos entre docs quebrarem | Medio | Grep pos-migracao + correcao de links (conteudo inalterado, so links) |
| `.gitignore` excecao `!docs/CERTIFICADO_V1.md` apontando para caminho antigo | Baixo | Atualizar excecao para `docs/oficial/CERTIFICADO_V1.md` na execucao |
| Historico do Git (blame/log) fragmentado por renames | Baixo | Usar `git mv` (rename tracking) |
| Padroes `RELATORIO_*` etc. do `.cursorignore` ignorarem docs novos legitimos | Baixo | Apos migracao, trocar por `docs/historico/` |

## 9. Criterios de validacao (para aprovar execucao futura)

- [ ] Nenhum arquivo deletado (somente `git mv`)
- [ ] Zero referencias quebradas (grep por todos os nomes movidos)
- [ ] Testes-ancora verdes (mesmos resultados pre-migracao)
- [ ] `verify-build` sem regressao NOVA
- [ ] Raiz contem apenas a lista da Etapa 1
- [ ] `.cursorignore` simplificado e reindexacao confirmada

---

## 10. Criterio de sucesso desta sprint (RC10.0.1)

| Criterio | Status |
|----------|--------|
| Nenhum arquivo alterado | **CUMPRIDO** |
| Nenhum arquivo movido | **CUMPRIDO** |
| Nenhum arquivo removido | **CUMPRIDO** |
| Plano arquitetural completo gerado | **CUMPRIDO** (este documento) |

*Execucao da migracao (RC10.0.2) somente com aprovacao explicita.*