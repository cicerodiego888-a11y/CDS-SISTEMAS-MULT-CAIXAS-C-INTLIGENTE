# RC4.31.7 — Relatório de Integridade Electron

**Status: APROVADO**  
**Data:** 2026-08-01T14:49:05.644Z  
**Versão:** 1.0.3  
**Commit:** 51caa1f  

---

## Divergências encontradas (pré-rebuild)

| Arquivo | Hash esperado (repo) | Hash encontrado (asar antigo) | Motivo |
|---------|---------------------|-------------------------------|--------|
| `backend/database.js` | `9c5d585b…` | `5d36e872…` | RC4.31.6 — `aplicarCertificacaoSql` não empacotado |
| `backend/rotas/compras.js` | `7a6d4b6f…` | `0e5b6cd5…` | RC4.31.4 — correção INSERT 48 colunas |
| `electron-integrity.js` | `9e567349…` | `3e451773…` | RC4.31.7 — novas funções de certificação |

**Ausentes no asar antigo (6):**
- `backend/lib/validateInsertAlignment.js`
- `backend/lib/scanInsertAlignmentInSource.js`
- `backend/lib/scanSqlCertificationInSource.js`
- `backend/lib/sqlCertification/index.js`
- `backend/lib/sqlCertification/common.js`
- `backend/lib/sqlCertification/logger.js`

---

## Pós-rebuild — Certificação

| Métrica | Valor |
|---------|-------|
| Resultado | **APROVADO** |
| Hash app.asar | `489673ad2dd1bba946a654d61ec5a7902a43103469a056fafb4adb58a70a2dde` |
| Arquivos empacotados | 2559 |
| Divergências | 0 |
| Ausentes no asar | 0 |

### Por camada
- Frontend: 207/207 OK
- Backend: 2327/2327 OK
- Electron: 14/14 OK
- Recursos: 11/11 OK

### Smoke test (módulos validados no asar)
- erp_core, database, sql_cert, compras, produtos, financeiro, nfce, nfe, muc

### Instalador
- `dist/erp/CDS-ERP-Setup-1.0.3.exe` gerado com sucesso

---

## Manifesto da build

Ver `electron-build-manifest.json` na raiz do repositório.

---

## Garantia técnica

O `app.asar` empacotado é **byte-a-byte idêntico** ao código-fonte homologado pelos testes `test:muc-certificacao`. Qualquer divergência futura será bloqueada automaticamente pelo `afterPack` e pelo pipeline `build:erp`.
