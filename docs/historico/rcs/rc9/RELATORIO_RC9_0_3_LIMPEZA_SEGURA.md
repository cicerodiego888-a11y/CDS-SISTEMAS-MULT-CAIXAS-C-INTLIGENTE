# RELATORIO RC9.0.3 — LIMPEZA FISICA SEGURA DO WORKSPACE (PLANO)

**Data:** 2026-07-26  
**Modo:** READ-ONLY (nenhuma exclusao executada)  
**Confidence:** 1.00  

**Garantias desta sprint:** nenhum arquivo removido; nenhum codigo alterado; nenhum documento movido; nenhum banco oficial modificado.

---

## 1. Resumo executivo

Inventario e plano definitivo de limpeza fisica com criterio **risco zero / regeneravel ou historico sem dependencia operacional**.

| Plano | Espaco recuperavel | Arquivos | Pastas | Risco |
|-------|--------------------|----------|--------|-------|
| **A — Risco zero (recomendado agora)** | **≈ 943,68 MB** | **1.110** | **220** | Zero / baixo* |
| **B — Opcional (debug regeneravel)** | **+ ≈ 0,11 MB** | **+38** | **+4** | Zero |
| **C — Condicional (exige ajuste de testes)** | **+ ≈ 460,05 MB** (`dist20-07/`) | **+553** | **+110** | Medio — **NAO incluir** na exclusao risco-zero |

\* `CDS COPIA.zip` e historico (nao regeneravel via `npm run build`). Risco funcional zero; risco de perda de backup **baixo** se existir copia externa.

**Nada foi apagado nesta RC.** A exclusao definitiva depende de **confirmacao explicita** do usuario.

---

## 2. Lista completa dos candidatos

### 2.1 Tabela de inventario (Fase 1)

| Caminho | Tipo | Tamanho | Arquivos | Pastas | Pode ser recriado? | Risco |
|---------|------|---------|----------|--------|--------------------|-------|
| `dist-Antigo/` | Build Electron historico (erp+pdv) | **917,58 MB** | 1.106 | 220 | **SIM** (`npm run build:erp` / `build:pdv` / `build:all`) | **Zero** |
| `CDS COPIA.zip` | Backup zip historico na raiz | **26,09 MB** | 1 | 0 | **NAO** via pipeline; so se houver outra copia | **Baixo*** |
| `tmp-brace-check.js` | Artefato temporario | ~0 MB | 1 | 0 | N/A (lixo) | **Zero** |
| `backend/mercadao.db` | Stub SQLite **0 bytes** | 0 | 1 | 0 | N/A (vazio) | **Zero** |
| `storage/mercadao.db` | Stub SQLite **0 bytes** | 0 | 1 | 0 | N/A (vazio) | **Zero** |
| `logs/` | Logs NFe / XML enviados | 0,04 MB | 7 | 3 | **SIM** (runtime) | **Zero** (opcional) |
| `storage/xml/debug-assinatura/` | Captura debug assinatura | 0,03 MB | 12 | 0 | **SIM** | **Zero** (opcional) |
| `backend/services/fiscal/debug/` | Debug fiscal legado | 0,03 MB | 13 | 0 | **SIM** | **Zero** (opcional) |
| `dados/fiscal/debug/` + `dados/fiscal/xml/debug-assinatura/` | Debug local | ~0,01 MB | 6 | 1 | **SIM** | **Zero** (opcional) |
| `dist20-07/` | Build snapshot 20/07 | **460,05 MB** | 553 | 110 | **SIM** como build, mas **congelado como evidencia** de teste | **Medio — NAO risco-zero** |
| `electron-manifest.json` | Manifesto de integridade | 0,28 MB | 1 | 0 | **SIM** (`npm run manifest:electron`) | **NAO REMOVER** (usado) |
| `dist/` | Build atual | 2.247 MB | 1.106 | — | SIM | **NAO REMOVER** (build vigente) |
| `node_modules/` | Dependencias | 730 MB | — | — | SIM (`npm install`) | **NAO REMOVER** |
| `dados/mercadao.db` | Copia local DB | 0,21 MB | 1 | — | Fixture local | **NAO REMOVER** nesta sprint |
| `backend/banco/mercadao.db` | Snapshot antigo | 1,27 MB | — | — | Historico | **NAO risco-zero** sem validacao extra |
| Banco oficial `%PROGRAMDATA%\MercantilFiscal\dados\` | Runtime | fora do repo | — | — | — | **NUNCA tocar** |

\* Confirmar backup externo antes de apagar o zip.

---

## 3. Fase 2 — Validacao de referencias

Para cada candidato do plano A:

| Item | Scripts | package.json | Electron | Testes | Resultado |
|------|---------|--------------|----------|--------|-----------|
| `dist-Antigo/` | Nenhuma referencia em `.js/.json` | Sem match | Sem uso | Sem uso | **OK remover** |
| `CDS COPIA.zip` | Nenhuma | Sem match | Sem uso | Sem uso | **OK remover** (apos backup externo) |
| `tmp-brace-check.js` | Nenhuma | Sem match | Sem uso | Sem uso | **OK remover** |
| `backend/mercadao.db` (0B) | Nenhuma no codigo | Sem match | Sem uso | Sem uso | **OK remover** |
| `storage/mercadao.db` (0B) | Nenhuma no codigo | Sem match | Sem uso | Sem uso | **OK remover** |

### Itens que **falharam** o criterio risco-zero

| Item | Evidencia | Decisao |
|------|-----------|---------|
| `dist20-07/` | Referenciado por `tests/faturamento/rc3164-auditoria-electron.test.js`, `scripts/rc3164-auditar-asar.js`, `scripts/rc3164-auditar-index.js` — teste **exige** `dist20-07/.../app.asar` como evidencia historica de divergencia ASAR vs disco | **NAO apagar** sem sprint de retarget/arquivamento de evidencia |
| `electron-manifest.json` | `electron-integrity.js` (`MANIFEST_REL`), `npm run verify-build` / `manifest:electron` | **NAO apagar** |

Unicas mencoes a `dist-Antigo` / `CDS COPIA` / stubs em documentacao de auditoria RC9.0.1 — nao sao dependencia de runtime.

---

## 4. Espaco total recuperavel

### Plano A — exclusao risco zero (apos confirmacao)

| Metrica | Valor |
|---------|-------|
| Espaco | **≈ 943,68 MB** (~0,92 GB) |
| Arquivos | **1.110** |
| Pastas | **220** (+ pastas raiz dos itens) |
| Classificacao de risco | **Zero / baixo (zip)** |

### Plano A + B (opcional debug)

| Metrica | Valor |
|---------|-------|
| Espaco | **≈ 943,78 MB** |
| Arquivos | **1.148** |
| Pastas | **224** |
| Ganho extra | irrelevante (~0,11 MB) |

### Plano C (futuro — nao executar agora)

| Item | Espaco extra | Condicao |
|------|--------------|----------|
| `dist20-07/` | +460,05 MB | Atualizar/remover testes RC3.16.4 ou mover ASAR de evidencia para pasta dedicada fora do workspace |

---

## 5. Itens regeneraveis

| Item | Como regenerar |
|------|----------------|
| `dist-Antigo/` | `npm run build:erp` e/ou `npm run build:pdv` (ou `build:all`) — gera artefatos em `dist/` |
| Logs / debug fiscal | Uso normal do sistema / homologacao |
| `electron-manifest.json` | `npm run manifest:electron` (**nao apagar** nesta limpeza) |

---

## 6. Itens historicos

| Item | Nota |
|------|------|
| `dist-Antigo/` | Snapshot de build antigo (11/07/2026); substituido operacionalmente por `dist/` |
| `CDS COPIA.zip` | Copia compactada (25/07/2026); nao faz parte do pipeline |
| `dist20-07/` | Historico **com dependencia de teste de evidencia** — manter |
| Stubs `mercadao.db` 0B | Residuos; banco oficial em ProgramData |

---

## 7. Itens que NAO devem ser removidos

1. **Codigo-fonte** (`backend/`, `frontend/`, `electron*.js`, `preload.js`, `tests/`, `scripts/` ativos)
2. **`package.json` / `package-lock.json`**
3. **`dist/`** (build vigente)
4. **`dist20-07/`** (evidencia RC3.16.4)
5. **`node_modules/`**
6. **`electron-manifest.json`**
7. **`dados/mercadao.db`** e **`backend/banco/mercadao.db`** (ate sprint especifica)
8. **Banco oficial** em `%PROGRAMDATA%\MercantilFiscal\dados\`
9. **Documentacao oficial** em `docs/` (arquitetura, changelog, etc.)
10. **Configuracoes fiscais / schemas XSD** necessarios ao runtime

---

## 8. Plano de exclusao (NAO EXECUTADO)

### Ordem proposta (somente apos "SIM, pode apagar")

1. Confirmar backup externo de `CDS COPIA.zip` (ou aceitar perda consciente).
2. Remover `dist-Antigo/` (maior ganho: ~917,58 MB).
3. Remover `CDS COPIA.zip` (~26,09 MB).
4. Remover `tmp-brace-check.js`.
5. Remover stubs `backend/mercadao.db` e `storage/mercadao.db` (0B).
6. (Opcional) Limpar pastas de debug/logs listadas no Plano B.
7. **Nao tocar** em `dist20-07/`, `dist/`, `electron-manifest.json`, codigo, DBs oficiais.

### Comandos sugeridos (futuro — NAO rodar agora)

```powershell
# APENAS APOS CONFIRMACAO EXPLICITA DO USUARIO
$root = "C:\projetos\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE"
Remove-Item -LiteralPath "$root\dist-Antigo" -Recurse -Force
Remove-Item -LiteralPath "$root\CDS COPIA.zip" -Force
Remove-Item -LiteralPath "$root\tmp-brace-check.js" -Force
Remove-Item -LiteralPath "$root\backend\mercadao.db" -Force
Remove-Item -LiteralPath "$root\storage\mercadao.db" -Force
```

### Confirmacao exigida

Antes da exclusao definitiva, responder explicitamente, por exemplo:

> **SIM — autorizo a exclusao do Plano A (dist-Antigo, CDS COPIA.zip, tmp-brace-check.js, stubs 0B).**

Ou autorizar subset (ex.: so `dist-Antigo/`).

---

## 9. Criterio de sucesso desta sprint

| Criterio | Status |
|----------|--------|
| Nenhum arquivo removido | **CUMPRIDO** |
| Nenhum codigo alterado | **CUMPRIDO** |
| Nenhum documento movido | **CUMPRIDO** |
| Inventario + validacao + plano gerados | **CUMPRIDO** |
| Espaco a liberar informado | **≈ 943,68 MB (Plano A)** |

---

*Fim do RELATORIO_RC9_0_3_LIMPEZA_SEGURA.md — aguardando confirmacao para exclusao.*