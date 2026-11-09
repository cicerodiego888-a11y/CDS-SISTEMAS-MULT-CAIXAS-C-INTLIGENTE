# TEF-DESTAXA-51.21 — Pré-homologação operacional pós-correção

**Status:** CONCLUÍDA (somente verificação passiva)  
**Coleta:** 2026-11-09 ~18:08–18:11 America/Sao_Paulo  
**Classificação de prontidão:** **PARTIAL**  
**Operação financeira:** **NÃO EXECUTADA**  
**Esta sprint NÃO autoriza CRT.**

Artefatos: `ambiente-passivo.json`, `db-readonly-id1.json`, `ledger-readonly.json`, `check-readonly.js`

---

## Resumo executivo

O workspace contém a correção **51.20** com hash esperado. O **PDV não está em execução**, portanto o código efetivamente carregado em runtime **não pôde ser comprovado nesta sprint**. O build ASAR do PDV (`dist/pdv`, 2026-11-07) **não** contém o marcador 51.20. Dependências passivas (V$Pague PID 10256, TCP **60906**, COM4 OK, logs/conf) estão presentes. A linha `tef_transacoes.id=1` permanece **pendente**; gate OFF; auths 51.03/51.10 **CONSUMED**.

---

## 1. Hashes do código corrigido

| Artefato | SHA256 | Resultado |
| --- | --- | --- |
| Esperado (51.20) | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` | referência |
| Workspace `backend/services/tef/TefManager.js` | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` | **MATCH** |
| `dist/pdv/.../app.asar` (pacote) | `2CE3DEC66A7679F9E79CF3A28DA2B21B54C1B5F70724498385A7536600CB7F1C` | pacote 07/11 |
| Conteúdo ASAR (scan UTF-8) | sem `intentCicloAutomaticoContinue` / sem `TEF-DESTAXA-51.20` | **STALE vs 51.20** |
| Conteúdo ASAR | contém gate legado `continuidadeAtiva && ['TX_CONTINUE','TX_FINALIZE']` | pré-correção |

Marcadores no workspace: `intentCicloAutomaticoContinue`, comentário `TEF-DESTAXA-51.20`, intent automático `['TX_START','TX_CONTINUE','TX_FINALIZE']` (L943), path PDV `['TX_CONTINUE','TX_FINALIZE']` (L2376).

**Não** houve alteração artificial de arquivos para forçar coincidência de hashes.

---

## 2. Origem do código efetivamente carregado

| Pergunta | Evidência |
| --- | --- |
| PDV em execução agora? | **Não** — nenhum `electron.exe` / `electron-pdv`; HTTP `:3001` unreachable |
| Processo antigo com código pré-51.20? | **Não observado** (PDV ausente) |
| Homologação histórica (51.14/51.15) | Workspace: `electron.exe electron-pdv.js --cds-forcar-local` (PID 18236 na época) — **não ASAR** |
| ASAR empacotado | Existe em `dist/pdv/win-unpacked`, mtime **2026-11-07**, **sem** patch 51.20 |

**Conclusão:** o código corrigido está no **workspace**. O runtime efetivo do PDV **não foi verificado** porque o PDV não está carregado. Qualquer futura homologação deve lançar o PDV a partir do workspace (como 51.15), **não** pelo ASAR de 07/11, salvo rebuild explícito.

---

## 3. Estado dos processos existentes

| Componente | Estado |
| --- | --- |
| PDV / Electron | **ausente** |
| V$Pague Client | **PID 10256** — `V$PagueClient.jar` → `app-partner.destaxa.cloud:60410` TLS |
| TCP **60906** | **Listen** (owner 10256) |
| NativeHost real Destaxa | **não iniciado** nesta sprint |
| Cursor/node auxiliares | presentes (IDE) — irrelevantes ao PDV |

---

## 4. Estado passivo das dependências

| Item | Resultado |
| --- | --- |
| Conf V$Pague | `C:\VBI\V$Pague\Client\V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (existe) |
| JAR V$Pague | existe |
| Log DLL Destaxa | existe; mtime 15:54 (sessão 51.10) — **não** reaberto/escrito por esta sprint |
| Log V$Pague | existe; mtime 15:57 |
| Observability NativeHost | existe; mtime ~17:58 (atividade de testes unitários MRT/51.20 no host in-process — **não** equivale a NativeHost de produção do PDV) |
| COM4 | PnP/Serial **OK** (`PPC-920/930`); **porta não aberta** |
| Integridade ASAR vs workspace | **divergente** (ASAR antigo) |

---

## 5. Verificação estática do bootstrap 51.20

Somente leitura de código (sem iniciar NativeHost):

| Checagem | Resultado |
| --- | --- |
| Emissão de permit específico TX_CONTINUE (atalho ciclo) | **Sim** — `intentCicloAutomaticoContinue` em `TefManager._criarBootstrapSeguranca` |
| Intent automático contém TX_START + TX_CONTINUE | **Sim** (autorizar) |
| TX_FINALIZE fora do atalho | **Sim** — FINALIZE só via `continuidadeAtiva` |
| Path PDV (`continuarAutorizacao`) exige `_continuidadeCrt` | **Sim** — intent sem TX_START não usa atalho |
| Permit individual / `transactionId` / one-shot | **Preservado** — Host `_autorizarOperacaoTransacional` consome `permitId`; Client exige `permitAuthorized` |
| Bloqueio ausente/divergente/consumido | **Preservado** — `HOST_SECURITY_OPERATION_BLOCKED` |
| `DestaxaHostBridge.continuarTransacaoDestaxa` | Encaminha `TX_CONTINUE` com `transactionId` |

---

## 6. Situação da transação id=1 (readonly)

Banco: `C:\ProgramData\MercantilFiscal\dados\mercadao.db` (`node:sqlite` readOnly).

| Campo | Valor |
| --- | --- |
| id | 1 |
| status | **pendente** |
| valor | 1.00 |
| tipo | cartao_debito |
| provedor | destaxa |
| nsu / autorizacao | **NULL** |
| idempotency_key | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| criado_em / atualizado_em | 16:58:43 / 16:59:12 |
| Outras pendentes | **somente esta** |

Evidências 51.17 permanecem a referência documental. **Nenhuma escrita** nesta sprint.

**Impedimento operacional herdado:** `criarTransacaoExclusiva` continua bloqueado enquanto id=1 estiver `pendente`. Isso **não** foi alterado.

---

## 7. Gate

| Item | Valor |
| --- | --- |
| `DESTAXA_REAL_TRANSACTION_ENABLED` (env processo atual) | **`0` / OFF** |
| Ativação nesta sprint | **Não** |

---

## 8. Autorizações existentes (ledger readonly)

Arquivo: `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`

| authorizationId | status | motivo |
| --- | --- | --- |
| `5aed71f2b6e19f7f14303f69242c6796` | **CONSUMED** | 51.03 |
| `ba08c88e8e67410f3048bac5e10c4046` | **CONSUMED** | 51.10 |

Sem novas autorizações ISSUED. UNKNOWN `tx-5110-2dbbb6922eb64990` permanece fora do banco operacional (histórico 51.10) — **não** alterado.

---

## 9. Divergências encontradas

1. **PDV não carregado** → hash “efetivamente utilizado pelo PDV” = **NÃO VERIFICÁVEL** nesta sprint.  
2. **ASAR `dist/pdv` (07/11) sem 51.20** → risco se a homologação futura usar o empacotado em vez do workspace.  
3. **id=1 pendente** → bloqueia novo INSERT exclusivo até reconciliação autorizada.  
4. Logs DLL/V$Pague sem atividade nova após 15:57 (esperado — sem TX).

---

## 10. Classificação final de prontidão

### **PARTIAL**

| Dimensão | Nota |
| --- | --- |
| Código workspace 51.20 | OK (hash match) |
| Runtime PDV com 51.20 | **não comprovado** (PDV off) |
| Dependências passivas V$Pague/60906/COM4 | OK (presentes) |
| Gate / ledger | OK (OFF / CONSUMED) |
| Bloqueio financeiro id=1 | permanece — esperado |

**READY_FOR_REVIEW** seria aplicável apenas após o PDV workspace estar em execução e o hash/código 51.20 ser reconfirmado no processo vivo — **fora** do escopo executado aqui.

**BLOCKED** não se aplica ao conjunto das verificações passivas possíveis; o único bloqueio crítico para CRT futura é a pendência id=1 + ausência de auth nova, ambos já conhecidos e **não** resolvidos nesta sprint.

---

## 11. Confirmação: nenhuma operação financeira

Não executados: CRT · TX_* real · DLL · NativeHost real · COM4 open · restart PDV/V$Pague · UPDATE/DELETE id=1 · emissão/consumo de auth · gate ON · reconciliação com efeito.

---

## 12. Próximos passos (exigem nova decisão expressa)

1. Iniciar PDV a partir do **workspace** (`electron-pdv.js --cds-forcar-local`) e revalidar código carregado.  
2. Tratar id=1 via resposta Destaxa / sprint de reconciliação autorizada.  
3. Somente então: emissão de auth excepcional + CRT controlada — **autorização específica futura**.

**Esta sprint não autoriza nenhuma transação.**
