# RELATÓRIO RC9.0.1 — AUDITORIA E PREPARAÇÃO DO WORKSPACE

**Modo:** READ-ONLY (análise)  
**Data da auditoria:** 2026-07-25  
**Repositório:** `CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE`  
**Confidence:** 1.00  

**Escopo cumprido:** nenhuma linha de código alterada; nenhum arquivo removido; nenhum documento movido; nenhum banco modificado; nenhum `.cursorignore` alterado; nenhum commit.  
**Única entrega desta sprint:** este relatório.

---

## 1. Resumo Executivo

O workspace físico totaliza **≈ 4,36 GB** (**19.892 arquivos**, **3.391 pastas**; sem `.git`: **≈ 4,42 GB**, **18.771 arquivos**, **3.106 pastas**).

A carga é dominada por artefatos **recriáveis** e **não necessários ao Agent**:

| Bloco | Tamanho | % do total (sem .git) |
|-------|---------|------------------------|
| Builds (`dist/`, `dist-Antigo/`, `dist20-07/`) | **3.624,92 MB** | **≈ 82,1%** |
| Dependências (`node_modules/`) | **730,20 MB** | **≈ 16,5%** |
| Backup solto (`CDS COPIA.zip`) | **26,09 MB** | **≈ 0,6%** |
| Código + testes + assets + docs operacionais | **≈ 40–45 MB** | **≈ 1%** |

O `.cursorignore` **já cobre** a maior parte do volume pesado (`node_modules/`, `dist*`, `logs/`, `*.db`, `backups/`, `*.zip`, `dados/`, `storage/` fiscal, etc.).  
Mesmo assim, ainda restam candidatos relevantes à redução de indexação e/ou saída física do workspace:

1. **`backend/schemas/`** — **1.399 arquivos / 26,34 MB** (normas/schemas SEFAZ + docs de terceiros embutidos) — **ainda não ignorado**.
2. **`docs/assets/`** — **4,14 MB** (PNGs de UX) — pouco valor para o Agent.
3. **Documentação histórica na raiz** (relatórios/auditorias/sprints) — baixo MB, alto ruído de contexto.
4. **Cópias físicas de build antigas** (`dist-Antigo/`, `dist20-07/`) — já ignoráveis pelo Cursor, mas ocupam disco e poluem o workspace.
5. **Bancos locais no repo** — cópias/stubs; banco oficial em `ProgramData\MercantilFiscal\dados\mercadao.db`.

**Estimativa de redução de indexação (workspace físico vs footprint ativo de desenvolvimento):**  
Footprint ativo estimado (**backend/frontend/tests/scripts/build/assets/config/docs sem assets+auditoria + JS/JSON raiz**) ≈ **39,85 MB** → redução potencial vs total sem `.git` ≈ **99,1%**.  
Considerando apenas o que ainda **não** está no `.cursorignore` (schemas + docs assets + docs históricas + ruído), a redução **adicional** tipicamente obtida na RC9.0.2 fica na faixa **≈ 30–35 MB / milhares de arquivos de schemas**, com impacto alto em qualidade de contexto mesmo com baixo percentual absoluto.

---

## 2. Ranking das Maiores Pastas

| # | Pasta | Arquivos | Tamanho | Última modificação (arquivo mais recente) |
|---|-------|----------|---------|-------------------------------------------|
| 1 | `dist/` | 1.106 | **2.247,00 MB** | 2026-07-22 |
| 2 | `dist-Antigo/` | 1.106 | **917,58 MB** | 2026-07-11 |
| 3 | `node_modules/` | 13.230 | **730,20 MB** | 2026-06-21 |
| 4 | `dist20-07/` | 553 | **460,05 MB** | 2026-07-20 |
| 5 | `.git/` | — | **33,77 MB** | — |
| 6 | `backend/` | 2.193 | **31,38 MB** | 2026-07-25 |
| 7 | `CDS COPIA.zip` (arquivo) | 1 | **26,09 MB** | 2026-07-25 |
| 8 | `docs/` | 96 | **4,70 MB** | 2026-07-25 |
| 9 | `frontend/` | 195 | **3,89 MB** | 2026-07-25 |
| 10 | `assets/` | 12 | **2,18 MB** | 2026-07-24 |
| 11 | `storage/` | 21 | **1,94 MB** | 2026-06-23 |
| 12 | `tests/` | 189 | **1,32 MB** | 2026-07-25 |

### Classificação geral (Fase 1)

| Classe | Estimativa | Observação |
|--------|------------|------------|
| **Build** | ≈ 3.625 MB / 2.766 arquivos | `dist*`, `electron-manifest.json` |
| **Dependências** | ≈ 730 MB / 13.230 arquivos | `node_modules/` |
| **Backup** | ≈ 26 MB | `CDS COPIA.zip`; `backups/` quase vazio (`.gitkeep`) |
| **Código** | ≈ 35–40 MB | `backend` (sem contar schemas como “app”), `frontend`, electron, `tests`, `scripts`, `build`, `assets` |
| **Documentação** | ≈ 5 MB (CDS) + 26 MB (schemas/docs SEFAZ embutidos) + ~7 MB docs em `node_modules` | Ver Fase 6 |
| **Banco** | ≈ 1,51 MB / 5 arquivos | cópias locais; runtime oficial fora do repo |
| **Logs** | ≈ 0,04 MB em `logs/` + debug fiscal espalhado | baixo volume, alto ruído se indexado |
| **Temporários** | residual | `tmp-brace-check.js`; pastas `tmp/temp/.cache` ausentes |

**Totais:** 19.892 arquivos · 3.391 pastas · **4.461,64 MB** (com `.git`).

---

## 3. Ranking das Maiores Documentações

### 3.1 Por localização (documentação própria + embutida, fora `node_modules`/`dist`)

| # | Item | Tamanho | Tipo |
|---|------|---------|------|
| 1 | `backend/schemas/` (pacote SEFAZ + docs MakePL etc.) | **26,34 MB** / 1.399 arquivos | Normas / terceiros embutidos |
| 2 | `docs/assets/*.png` | **4,14 MB** / 3 | Evidências UX |
| 3 | `docs/*.md` + subpastas textuais | ≈ **0,55 MB** / 86 md/txt | Oficial + RC + auditorias |
| 4 | MD na raiz do projeto | ≈ **0,25 MB** / 27 | Mistura oficial/histórico |
| 5 | READMEs técnicos em `backend/motores/**` | ≈ **0,08 MB** | Oficial operacional |
| 6 | PDF SEFAZ | `backend/schemas/.../NT2023.002_v1.01 - Emitente CPF - NFCe.pdf` | **445,87 KB** |

### 3.2 Top arquivos documentais (texto/PDF)

| # | Arquivo | Tamanho |
|---|---------|---------|
| 1 | `backend/schemas/.../NT2023.002_v1.01 - Emitente CPF - NFCe.pdf` | 445,9 KB |
| 2 | `backend/schemas/.../docs/MakePL010.md` | 125,2 KB |
| 3 | `backend/schemas/.../docs/cStat.md` | 84,7 KB |
| 4 | `AUDITORIA_MOTOR_BALANCAS.md` (raiz) | 46,3 KB |
| 5 | `RELATORIO_AUDITORIA_FINAL_MOTOR_EQUIPAMENTOS.md` (raiz) | 42,0 KB |
| 6 | `docs/ARQUITETURA_OFICIAL_CDS_V1.md` | 28,6 KB |
| 7 | `docs/NUCLEO_TRANSACIONAL_VENDA_V1.md` | 28,2 KB |
| 8 | `docs/MIIP_BANCO_DADOS.md` | 24,8 KB |
| 9 | `docs/CHANGELOG_ARQUITETURAL.md` | 21,2 KB |

**Docs em `node_modules`:** ≈ **1.063** arquivos md/txt/pdf · ≈ **6,87 MB** (já cobertos por `node_modules/` no `.cursorignore`).

---

## 4. Ranking dos Maiores Bancos

| # | Caminho | Tamanho | Última alteração | Utilização | Backup? | Ignorar no Cursor? |
|---|---------|---------|------------------|------------|---------|---------------------|
| 1 | `backend/banco/mercadao.db` | **1,27 MB** | 2026-05-26 | Cópia antiga; **não** é o path oficial de runtime | Possível snapshot legado | **SIM** (já em `*.db`) |
| 2 | `dados/mercadao.db` | **0,21 MB** | 2026-07-23 | Cópia local de desenvolvimento; oficial = `ProgramData\MercantilFiscal\dados` | Pode servir de fixture/local | **SIM** (já em `*.db` + `dados/`) |
| 3 | `backend/banco/mercadao.db-shm` | 32 KB | 2026-05-26 | Sidecar SQLite | Não | **SIM** |
| 4 | `backend/mercadao.db` | **0 B** | 2026-06-30 | Stub/vazio | Não | **SIM** |
| 5 | `storage/mercadao.db` | **0 B** | 2026-06-23 | Stub/vazio | Não | **SIM** |

**Fonte de verdade (código):** `backend/database.js` → `DB_DIR` = `process.env.DB_DIR` **ou** `%PROGRAMDATA%\MercantilFiscal\dados\mercadao.db`.

**Risco de remoção dos `.db` do repo:** médio-baixo para runtime (oficial fora do repo); baixo-médio se algum script/teste assume path relativo — validar na RC9.0.2 antes de limpeza física.

---

## 5. Ranking dos Maiores Logs / Debug / Capturas

| # | Local | Arquivos | Tamanho | Necessário p/ desenvolvimento? | Risco de remoção |
|---|-------|----------|---------|--------------------------------|------------------|
| 1 | `logs/nfe/` (trace + xml-enviado) | 7 | ≈ 0,04 MB | Útil só em debug fiscal ativo | **Baixo** (regeneráveis) |
| 2 | `storage/xml/debug-assinatura/` | 12 | ≈ 0,04 MB | Evidência antiga (2026-06-12) | **Baixo** |
| 3 | `backend/services/fiscal/debug/` | 13 | ≈ 0,03 MB | Debug legado | **Baixo** |
| 4 | `dados/fiscal/debug/` + `dados/fiscal/xml/debug-assinatura/` | 5 | residual | Debug recente (jul/2026) | **Baixo** (regenerável) |
| 5 | `docs/auditoria/rc7103*` / `rc7104*` (XML/JSON evidência) | 10 | ≈ 0,04 MB | Histórico de homologação | **Médio** se precisar auditar RC7.10.x |

Pastas `trace/`, `debug/`, `runtime/` na raiz: **não existem** como pastas top-level.

---

## 6. Ranking das Maiores Dependências

| # | Pasta | Arquivos | Tamanho | Em uso? | Fora do workspace? | `.cursorignore`? |
|---|-------|----------|---------|---------|--------------------|------------------|
| 1 | `node_modules/` | 13.230 | **730,20 MB** | **SIM** (`npm start`, electron, testes) | Pode viver no disco do projeto, mas **não** precisa ser indexado | **SIM — já está** |
| — | `vendor/` | — | — | Não existe | — | — |
| — | `bower_components/` | — | — | Não existe | — | — |

**Conclusão:** manter `node_modules` instalado localmente; mantê-lo **fora do contexto do Agent** (já feito). Não remover sem `npm install` posterior.

---

## 7. Ranking das Maiores Builds

| # | Caminho | Arquivos | Tamanho | Última modificação | Pode ser recriada? |
|---|---------|----------|---------|--------------------|--------------------|
| 1 | `dist/` (`erp/` + `pdv/`) | 1.106 | **2.247,00 MB** | 2026-07-22 | **SIM** (`npm run build:erp` / `build:pdv` / `build:all`) |
| 2 | `dist-Antigo/` | 1.106 | **917,58 MB** | 2026-07-11 | **SIM** (cópia histórica de build) |
| 3 | `dist20-07/` (`erp/`) | 553 | **460,05 MB** | 2026-07-20 | **SIM** |
| — | `release/` | — | — | — | Ausente |
| — | `out/` | — | — | — | Ausente |
| — | `coverage/` | — | — | — | Ausente |
| — | `dist30-06/` | — | — | — | Ausente (citado no `.gitignore`) |

**Scripts de regeneração confirmados em `package.json`:** `build`, `build:erp`, `build:pdv`, `build:all`, `verify-build`, `manifest:electron`.

---

## 8. Lista de Candidatos ao `.cursorignore`

> **Nesta sprint: NÃO alterar `.cursorignore`.** Lista apenas proposital.

### Já presentes (confirmar manutenção)

- `node_modules/`
- `dist/`, `dist-*/`, `dist20-07/`, `dist-Antigo/`, `release/`, `out/`
- `coverage/`
- `logs/`, `*.log`
- `backups/`
- `tmp/`, `temp/`, `.cache/`, `.tmp/`, `*.tmp`
- `uploads/`
- `*.db`, `*.sqlite`, `*.sqlite3`, sidecars
- `*.zip`, `*.rar`
- `.git/`
- `dados/`, `storage/`, XMLs/certificados/debug fiscal

### Candidatos **novos** (prioridade)

| Prioridade | Candidato | Motivo | Risco |
|------------|-----------|--------|-------|
| **P0** | `backend/schemas/` **ou** `backend/schemas/**/temp-nfe/docs/` | 26 MB / 1.399 arquivos; normas SEFAZ raramente consultadas pelo Agent | Médio se Agent precisar de XSD específico — preferir ignore seletivo de `**/docs/**` e `*.pdf` dentro de schemas |
| **P1** | `docs/assets/` | PNGs grandes, zero valor semântico para código | Baixo |
| **P1** | `docs/auditoria/` | Evidências XML/JSON de RC históricas | Baixo–médio |
| **P2** | `*.md` na raiz com padrão `RELATORIO_*`, `RESUMO_*`, `SUMARIO_*`, `AUDITORIA_*`, `CORRECAO_*`, `CHECKLIST_*` | Ruído histórico | Baixo (se docs oficiais forem só em `docs/`) |
| **P2** | `CDS COPIA.zip` | Já coberto por `*.zip`; garantir | Nulo |
| **P3** | `imagem/`, logos duplicados em `storage/logos/` | Binários | Baixo |

---

## 9. Lista de Candidatos ao Arquivamento

> Arquivar = mover para pasta/histórico **fora do contexto diário** (ex.: `docs/historico/` ou repositório externo). **Não executar nesta sprint.**

| Candidato | Motivo | Risco |
|-----------|--------|-------|
| `dist-Antigo/` | Build antiga recriável | Baixo |
| `dist20-07/` | Snapshot de 20/07; recriável | Baixo |
| `CDS COPIA.zip` | Backup solto na raiz | Médio se for único backup |
| MD históricos na raiz (`RELATORIO_SPRINT_*`, `RESUMO_*`, `CORRECAO_*`, `SUMARIO_FINAL.md`, etc.) | Sprints concluídas | Baixo |
| `docs/RC3.*` … `docs/RC7.*` (exceto se RC vigente) | Release notes já encerradas | Médio — conservar `CHANGELOG_ARQUITETURAL.md` |
| `docs/auditoria/rc7103*`, `rc7104*` | Pacotes de evidência | Baixo–médio |
| `AUDITORIA_MOTOR_BALANCAS.md`, `RELATORIO_AUDITORIA_*` na raiz | Auditorias pontuais | Baixo |
| `storage/xml/debug-assinatura/`, `backend/services/fiscal/debug/` | Capturas antigas | Baixo |
| Bancos stub `0 B` (`backend/mercadao.db`, `storage/mercadao.db`) | Sem conteúdo | Baixo |
| `backend/banco/mercadao.db` (mai/2026) | Snapshot legado | Médio |

---

## 10. Lista de Candidatos à Limpeza

> Limpeza = exclusão física **após aprovação**. **Não executar nesta sprint.**

| Candidato | Tipo | Risco | Pré-condição |
|-----------|------|-------|--------------|
| `dist-Antigo/` | Build | Baixo | Confirmar que `dist/` ou pipeline regenera instaladores |
| Conteúdo regenerável em `logs/nfe/` | Log | Baixo | Nenhuma investigação fiscal aberta |
| XML/TXT de debug-assinatura duplicados (`storage/`, `dados/`, `backend/services/fiscal/debug/`) | Debug | Baixo | Homologação fiscal estável |
| `tmp-brace-check.js` | Temp | Baixo | Confirmar não referenciado |
| Stubs `.db` vazios | Banco | Baixo | Confirmar nenhum script aponta para eles |
| `CDS COPIA.zip` | Backup | Médio | Garantir cópia externa |

**Não limpar sem aprovação explícita:** `node_modules/`, `dados/mercadao.db` (se usado em smoke local), `docs/` oficiais, código-fonte.

---

## 11. Estimativa Percentual de Redução do Workspace

| Cenário | O que sai do contexto / disco | Redução estimada |
|---------|--------------------------------|------------------|
| **A — Já coberto pelo `.cursorignore` atual** | builds + deps + logs + dbs + zips + dados/storage | **≈ 98–99%** do volume físico já fora do Agent |
| **B — RC9.0.2: ignore adicional (schemas docs + docs/assets + docs/auditoria + MD raiz históricos)** | ≈ 30–35 MB + milhares de arquivos de schema/docs | **≈ +0,7–0,8%** do disco; **alto ganho de qualidade de contexto** |
| **C — Saída física de builds antigas + zip** | `dist-Antigo` + `dist20-07` + zip ≈ **1.404 MB** | **≈ 31,8%** do workspace em disco |
| **D — Ideal combinado (B + C + manutenção de ignore)** | Agent vê só código/docs ativos (~40 MB) | **≈ 99%** vs total; disco −≈ **32%** se builds antigas saírem |

**Resposta direta (Fase 8):** percentual estimado de redução de **indexação** para o Cursor Agent, partindo do estado físico bruto → footprint ativo: **≈ 99%**.  
Percentual estimado de redução **adicional** ainda disponível (gaps do ignore + arquivamento documental): **≈ 0,7–1%** em bytes, porém **material** em número de arquivos (`backend/schemas`).

---

## 12. Plano Recomendado para a RC9.0.2

1. **Congelar inventário** deste relatório como baseline.
2. **Propor (com aprovação)** extensão mínima do `.cursorignore`:
   - `docs/assets/`
   - `docs/auditoria/`
   - seletivo em `backend/schemas/**/temp-nfe/docs/` e `*.pdf` de schemas
3. **Propor arquivamento** (mover, não apagar) dos MD históricos da raiz → `docs/historico/sprints/` e RCs encerradas → `docs/historico/rcs/`.
4. **Propor saída física do workspace** (para pasta externa de artefatos): `dist-Antigo/`, `dist20-07/`, `CDS COPIA.zip`.
5. **Validar** que testes (`npm run test:*`) e builds (`build:erp` / `build:pdv`) permanecem verdes após qualquer mudança de ignore (ignore não quebra runtime).
6. **Não tocar** em código, banco oficial (`ProgramData`), APIs ou regras de negócio.
7. Entregar na RC9.0.2 um `RELATORIO_RC9_0_2_APLICACAO_IGNORE_E_ARQUIVO.md` com diff do `.cursorignore` e lista do que foi movido.

---

# ANEXOS — FASES 1–8 (DETALHE)

## A. Fase 2 — Builds (detalhe)

| Caminho | Tamanho | Arquivos | Última mod. | Recriável |
|---------|---------|----------|-------------|-----------|
| `dist/erp` | 1.123,52 MB | 553 | 2026-07-22 | SIM |
| `dist/pdv` | 1.123,48 MB | 553 | 2026-07-22 | SIM |
| `dist-Antigo/erp` | 458,79 MB | 553 | 2026-07-11 | SIM |
| `dist-Antigo/pdv` | 458,79 MB | 553 | 2026-07-11 | SIM |
| `dist20-07/erp` | 460,05 MB | 553 | 2026-07-20 | SIM |

## B. Fase 6 — Documentação por grupos

| Grupo | Qtd (aprox.) | Tamanho | Importância | Permanecer no workspace? | `.cursorignore`? | Arquivar? |
|-------|--------------|---------|-------------|---------------------------|------------------|-----------|
| **A — Oficial CDS** | ≈ 90 | ≈ 381 KB (+ assets 4,14 MB) | Alta | **SIM** (texto); assets opcionais | Assets: SIM | Não (exceto versões supersedidas V1 quando houver V2 única) |
| **B — Terceiros** | ≈ 1.063 em `node_modules` | ≈ 6,87 MB | Nula p/ Agent | SIM em disco | **Já ignorado** | Não necessário |
| **C — Normas SEFAZ** | 85 md/txt/pdf (+ XSDs no pacote 1.399 arq / 26,34 MB) | 1,15 MB docs · 26 MB pacote | Alta p/ fiscal humano; baixa p/ Agent diário | SIM em disco | **Candidato seletivo** | Docs MakePL: arquivar/ignorar |
| **D — Histórico** | ≈ 5+ dezenas na prática (raiz + sprints) | ≈ 35 KB+ | Baixa | Opcional | **SIM** | **SIM** |
| **E — Auditorias** | ≈ 19 | ≈ 228 KB | Média (rastreio) | Opcional | **SIM** (`docs/auditoria/` + MD raiz) | **SIM** |
| **F — Relatórios** | ≈ 22 | ≈ 136 KB | Baixa–média | Opcional | **SIM** | **SIM** |
| **G — Roadmaps / RC** | ≈ 23–26 | ≈ 106 KB | Média (histórico de release) | Manter `CHANGELOG_ARQUITETURAL.md` ativo | RC antigas: SIM | **SIM** (RCs concluídas) |

## C. Fase 7 — Auditoria dos RC (documentos em `docs/RC*.md`)

| RC | Status | Última alteração | Ainda utilizado? | Pode arquivar? | Risco |
|----|--------|------------------|------------------|----------------|-------|
| RC1 | Encerrado (relatório final) | 2026-07-21 | Testes `rc1-*` existem; doc é histórico | SIM | Baixo |
| RC3.2 | Encerrado | 2026-07-15 | Testes relacionados | SIM | Baixo |
| RC3.3.3 | Encerrado | 2026-07-15 | `rc333-hardening.test.js` | SIM | Baixo |
| RC3.4 | Encerrado | 2026-07-15 | `rc34-homologacao-assistida.test.js` | SIM | Baixo |
| RC4.1 | Encerrado | 2026-07-15 | `rc41-endpoints-ux.test.js` | SIM | Baixo |
| RC4.2 | Encerrado (auditoria) | 2026-07-15 | Histórico | SIM | Baixo |
| RC4.3 | Encerrado | 2026-07-15 | `rc43-*.test.js` | SIM | Baixo |
| RC4.3.1 | Encerrado (hotfix) | 2026-07-15 | `rc431-*.test.js` | SIM | Baixo |
| RC5 | Encerrado (parecer + inventário) | 2026-07-10 | Equipamentos RC5 tem testes | SIM doc | Baixo |
| RC6.4 | Encerrado | 2026-07-15 | `rc6.4-homologacao-e2e.test.js` | SIM | Baixo |
| RC6.6 | Encerrado | 2026-07-16 | `fiscal-telemetria-rc6.6.test.js` | SIM | Baixo |
| RC6.9 | Encerrado | 2026-07-18 | Código/fiscal; doc histórico | SIM | Baixo–médio |
| RC7.0 | Encerrado (homologação) | 2026-07-18 | Histórico operacional | SIM | Baixo |
| RC7.1 | Encerrado | 2026-07-18 | Histórico | SIM | Baixo |
| RC7.3 | Encerrado (auditoria) | 2026-07-18 | Histórico | SIM | Baixo |
| RC7.3.1 | Encerrado | 2026-07-18 | `rc731-background-smoke.test.js` | SIM | Baixo |
| RC7.4 | Encerrado | 2026-07-18 | `rc74-*.test.js` | SIM | Baixo |
| RC7.4.1 | Encerrado | 2026-07-18 | `rc741-*.test.js` | SIM | Baixo |
| RC7.4.2 | Encerrado | 2026-07-18 | `rc742-*.test.js` | SIM | Baixo |
| RC7.4.3 | Encerrado (gate + auditoria) | 2026-07-18 | `rc743-*.test.js` | SIM | Baixo |
| RC7.5 | Encerrado | 2026-07-18 | `rc75-ux.test.js` | SIM | Baixo |
| RC7.6 | Encerrado | 2026-07-18 | snapshot `rc76-*` | SIM | Baixo |
| RC7.7 | Encerrado (auditoria final) | 2026-07-18 | Histórico de fechamento | SIM | Baixo |
| RC7.10.3 / RC7.10.4 | Encerrado (pasta `docs/auditoria/`) | 2026-07-22 | Evidências + testes `rc710*` | Arquivar evidências; manter testes | Médio se reabrir NFCe |

**Nota:** “Ainda utilizado?” distingue **código/testes** (permanecem) de **documentos RC** (arquiváveis). Arquivar o `.md` **não** implica remover o teste.

Há também RCs mais novas referenciadas só em testes/scripts (ex.: RC3.16.x, RC8.0.x, RC4.00 faturamento) **sem** pacote `docs/RC*.md` correspondente nesta auditoria.

## D. Fase 8 — Workspace (respostas exatas)

### Quais pastas realmente precisam ser abertas pelo Cursor?

- `backend/` (código da aplicação; idealmente **sem** indexar massa de docs SEFAZ em `schemas/**/docs`)
- `frontend/`
- `tests/`
- `scripts/`
- `build/` (scripts de empacotamento, não `dist/`)
- `assets/` (branding ativo)
- `config/`
- `docs/` **oficiais vigentes** (`ARQUITETURA_*`, `NUCLEO_*`, `CENTRAL_ENTRADAS_V1_OFICIAL.md`, `CHANGELOG_ARQUITETURAL.md`, motores MIIP/MIP, design system)
- Arquivos electron na raiz (`electron*.js`, `preload.js`, `package.json`, builders)

### Quais podem ser ignoradas?

- `node_modules/`, `dist/`, `dist-Antigo/`, `dist20-07/`
- `logs/`, `dados/`, `storage/`, `backups/`
- `docs/assets/`, `docs/auditoria/`
- Bancos `*.db*`
- Zips / cópias
- Docs históricos na raiz
- Docs de terceiros SEFAZ sob `backend/schemas/**/temp-nfe/docs` (candidato)

### Quais devem entrar no `.cursorignore`?

Ver **seção 8**. Prioridade: `backend/schemas` (seletivo), `docs/assets/`, `docs/auditoria/`, padrões de MD históricos na raiz.

### Quais podem sair completamente do workspace?

- `dist-Antigo/`
- `dist20-07/` (ou mover para `D:\artefatos-cds\` etc.)
- `CDS COPIA.zip` (após backup externo)
- Opcional: pacote histórico de docs já arquivado

### Qual o percentual estimado de redução de indexação?

**≈ 99%** do volume físico bruto em relação ao footprint ativo de desenvolvimento; **≈ 0,7–1% adicional** ainda disponível via gaps do ignore (principalmente `backend/schemas` + assets/docs históricas).

---

## E. Matriz de risco dos candidatos (síntese)

| Candidato | Ação futura | Risco |
|-----------|-------------|-------|
| Ignore `node_modules` / `dist*` | Manter | Nulo |
| Ignore `docs/assets` | Adicionar | Baixo |
| Ignore `docs/auditoria` | Adicionar | Baixo–médio |
| Ignore seletivo schemas docs/PDF | Adicionar | Médio |
| Arquivar MD RC 3–7 | Mover | Baixo |
| Remover `dist-Antigo` / `dist20-07` | Limpar disco | Baixo |
| Remover `CDS COPIA.zip` | Limpar | Médio |
| Remover `.db` do repo | Limpar | Médio |
| Remover `dados/` debug | Limpar | Baixo |

---

## F. Critério de sucesso desta sprint

| Critério | Status |
|----------|--------|
| Nenhuma linha de código alterada | **CUMPRIDO** |
| Nenhum arquivo removido | **CUMPRIDO** |
| Nenhum documento movido | **CUMPRIDO** |
| Nenhum banco modificado | **CUMPRIDO** |
| `.cursorignore` não modificado | **CUMPRIDO** |
| Relatório completo com candidatos classificados por risco | **CUMPRIDO** (este arquivo) |

---

*Fim do RELATORIO_RC9_0_1_AUDITORIA_WORKSPACE.md — aguardar aprovação explícita para RC9.0.2.*
