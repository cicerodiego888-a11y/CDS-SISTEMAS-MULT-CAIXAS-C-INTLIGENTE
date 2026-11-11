# SPRINT 51.63 — Validação final FIRST_INSTALL TEF

**Data:** 2026-11-11  
**Tipo:** Auditoria somente leitura (sem alteração de código de produto nesta sprint)  
**Classificação:** `FIRST_INSTALL_CRYPTO_CONTEXT_PERSISTENCE_CONFIRMED`

---

## 1. Método e escopo

Esta estação de homologação já possui perfil **MIGRATION** em `%APPDATA%\cds-sistemas-erp` (marcador MRT-50.38, hash Local State `26052081…`).  
Para comprovar FIRST_INSTALL **sem teste destrutivo** no perfil real, a 1ª/2ª abertura foi executada em **AppData + DB_DIR isolados** sob `%TEMP%\cds-5163-fi-*`, forçando `app.setPath('appData'/'userData')` e abortando se o userData resolvido não estiver sob o isolamento.

Artefatos: `pass1-first-open.json`, `pass2-reopen.json`, `resultado-isolamento.json`.  
Harness (apenas evidência): `tef-51-63-first-install-probe.js`, `_run-probe-isolamento.js`.

**Não** executados: CRT, TX_*, NativeHost Destaxa operacional, PinPad/maquineta, one-shot, SEFAZ.

---

## 2. Primeira abertura (isolamento = cliente novo)

| Verificação | Resultado |
| --- | --- |
| Abertura via Electron + provisioner oficial | **OK** |
| `TEF_CONTEXTO_ORIGEM_AUSENTE` | **Não ocorreu** (`tevContextoOrigemAusente=false`) |
| Roteamento | `FIRST_INSTALL` |
| Marcador FIRST_INSTALL no userData definitivo isolado | **OK** (`modo=FIRST_INSTALL`) |
| `userData` | `...\Temp\cds-5163-fi-t8L1Yn\AppData\cds-sistemas-erp` |
| Local State SHA-256 | `A2C428F452148D7193567E63257CBC59E8E504340016656173B1FD9EB0781EBB` |
| Marcador ↔ Local State | **Coincide** |
| Chave | origem `gerada` (bootstrap oficial `provisionarChaveTef`) |
| Fingerprint (key bytes, 16 hex) | `f12b7ce2c703e6c1` |
| Fingerprint público (16 hex) | `ff755a609ba8a093` |
| Gate | **OFF** (`0`) |
| NativeHost / TefManager carregados | **Não** |

---

## 3. Segunda abertura (mesmo isolamento)

| Verificação | Resultado |
| --- | --- |
| Mesmo `userData` | **Sim** |
| Mesmo modo | **FIRST_INSTALL** |
| Mesmo Local State SHA-256 | **Sim** |
| Mesmo fingerprint key bytes | **Sim** (`f12b7ce2c703e6c1`) |
| Mesmo fingerprint público | **Sim** (`ff755a609ba8a093`) |
| Origem da chave | `armazenamento-protegido` |
| Nova chave gerada | **Não** |
| mtime do store | **Inalterado** entre pass1 e pass2 |
| Cópia de Local State de outra instalação | **Não** (sem `CDS_TEF_LOCAL_STATE_SOURCE`; hash ≠ MRT `26052081…`) |
| `TEF_CONTEXTO_ORIGEM_AUSENTE` | **Não** |

---

## 4. Proteção de migração (testes isolados)

Comando: `node --test tests/tef/hotfix-first-install-contexto-tef.test.js` → **7/7 PASS**.

| Cenário | Resultado |
| --- | --- |
| Instalação nova sem origem | FIRST_INSTALL (sem ORIGEM_AUSENTE) |
| Reabertura FIRST_INSTALL | Mesmo contexto |
| Migração com origem MRT | Preserva hash esperado |
| Migração sem origem | Bloqueia `TEF_CONTEXTO_ORIGEM_AUSENTE` (não gera chave substituta nesse caminho) |
| Perfil corrompido/não vazio sem marcador | `TEF_CONTEXTO_PERFIL_NAO_VAZIO` (não sobrescreve) |
| Pending marker FIRST_INSTALL | Finaliza sem copiar contexto estrangeiro |
| Contexto migrado existente | `permitirGeracaoChave=false` |

Nenhum teste destrutivo no perfil real do cliente/homologação.

---

## 5. Integridade TEF (não financeira)

| Item | Resultado |
| --- | --- |
| `DestaxaNativeHostClient.js` | Sem diff nesta auditoria |
| `DestaxaHostBridge.js` | Sem diff |
| `TefManager.js` | Sem diff |
| NativeHost IPC / `DestaxaNativeHost.js` | Sem diff |
| V$Pague / DLL Destaxa | Não alterados / não exercitados |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **OFF** |
| One-shot ISSUED | **Nenhuma** (ledger sem ISSUED ativa) |
| CRT / TX_* / maquineta | **Não executados** |
| Probe | NativeHost/TefManager **não** carregados |

Observação: o hotfix FIRST_INSTALL (sprint anterior) alterou apenas `tefCryptoProfileProvisioner.js` e o roteamento em `electron-common.js` — fora do patrimônio Destaxa/NativeHost/CRT congelado.

---

## 6. Perfil real desta estação (somente inspeção)

No início da sprint, o marcador real em `%APPDATA%\cds-sistemas-erp` estava em modo **migração legada** (hash MRT `26052081…`, sem campo `modo`).  
Por isso a prova FIRST_INSTALL foi feita em isolamento, equivalente a computador novo, sem sobrescrever esse contexto.

Store de chave de produção em `C:\ProgramData\MercantilFiscal\dados\.tef-signing-key.v1`: **existe** (conteúdo não lido nesta auditoria).

---

## 7. Estado final

| Campo | Valor |
| --- | --- |
| Classificação | **`FIRST_INSTALL_CRYPTO_CONTEXT_PERSISTENCE_CONFIRMED`** |
| Fingerprint persistente | `f12b7ce2c703e6c1` |
| userData validado | isolado `...\cds-5163-fi-t8L1Yn\AppData\cds-sistemas-erp` |
| Código de produto nesta sprint | **Não modificado** |
