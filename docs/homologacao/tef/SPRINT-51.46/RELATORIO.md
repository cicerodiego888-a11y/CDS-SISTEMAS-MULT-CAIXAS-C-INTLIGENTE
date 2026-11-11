# SPRINT 51.46 — Runner controlado de recuperação TX 3

**Data:** 2026-11-10  
**Path:** `RECUPERACAO_PROTOCOLAR_TX3` (Sprint 51.45)  
**Execução Destaxa nesta sprint:** **nenhuma** (dry-run apenas)

---

## 1. Entrega

| Item | Status |
| --- | --- |
| Runner específico TX CDS id=3 | Implementado |
| Revalidação NSU 2338 / auth 211139 / venda 66 / V$Pague 10100017275707 | Sim |
| Validação de estado de sessão Destaxa (A1 declarado; sem leitura nativa) | Sim |
| Exclusividade da pendência obrigatória | Sim |
| GO explícito do PO (`GO-PO-RECUPERACAO-TX3-FINALIZE-0`) antes do permit | Sim |
| Permit excepcional only pós-pré-validações (dry-run / memória) | Sim — **ledger não escrito** |
| Somente FINALIZE(0); bloqueio START/CONTINUE/CRT/FINALIZE(9) | Sim |
| Execução única; sem retry automático | Sim |
| Hard-block de chamada nativa nesta sprint | Sim |
| Gate global OFF | Preservado |
| Auditoria de fases | Sim |

---

## 2. Arquivos

| Arquivo | Papel |
| --- | --- |
| `backend/services/tef/destaxa/tefRunnerRecuperacaoProtocolarTx3.js` | Runner controlado (fases, GO PO, abortos, dry-run) |
| `docs/homologacao/tef/SPRINT-51.46/tef-51-46-runner-recuperacao-tx3.js` | CLI dry-run (DB readonly) |
| `docs/homologacao/tef/SPRINT-51.46/dry-run-resultado.json` | Artefato do dry-run |
| `tests/tef/tef-destaxa-51-46-runner-recuperacao-tx3.test.js` | 15 testes |
| este relatório | Entrega + procedimento |

Path base inalterado: `tefRecuperacaoProtocolarTx3.js` (51.45).

---

## 3. Fases do runner

```text
PRECHECK_IDENTIDADE → PRECHECK_SESSAO → EXCLUSIVIDADE
  → AUTORIZACAO_PO → PERMIT (dry-run) → GATE_NATIVO (não chama)
  → AUDITORIA → CONCLUIDO
```

Qualquer falha → `ABORTADO` sem DLL / NativeHost / V$Pague / permit ledger.

---

## 4. Condições de interrupção (implementadas)

| Condição | Código / efeito |
| --- | --- |
| INIT 00 em vez de A1 | `TEF_RUNNER_TX3_INIT_00` |
| INIT F0 | `TEF_RUNNER_TX3_INIT_F0` |
| Timeout de sessão | `TEF_RUNNER_TX3_TIMEOUT_SESSAO` |
| Pendência sem exclusividade / múltiplas | códigos `TEF_RECUP_TX3_*` do path |
| Permit rejeitado | `TEF_RUNNER_TX3_PERMIT_REJEITADO` |
| Divergência de identificadores | `TEF_RUNNER_TX3_DIVERGENCIA_IDENTIFICADORES` |
| Token GO PO ausente/inválido | `TEF_RUNNER_TX3_TOKEN_GO_INVALIDO` |
| FINALIZE(9) / START / CONTINUE / CRT | bloqueio dedicado |
| Retry automático | `TEF_RUNNER_TX3_RETRY_PROIBIDO` |
| Pedido de execução nativa nesta sprint | `TEF_RUNNER_TX3_SPRINT_51_46_SEM_EXECUCAO_NATIVA` |

---

## 5. Testes

`node --test tests/tef/tef-destaxa-51-46-runner-recuperacao-tx3.test.js` → **15/15 OK**

Regressão 51.45: **12/12 OK**.

| Caso | Resultado |
| --- | --- |
| Dry-run elegível sem nativo | OK |
| TX ≠ 3 / NSU / auth / vespague | bloqueados |
| FINALIZE(9), START, CONTINUE, CRT | bloqueados |
| INIT 00 / F0 / timeout | abortam antes do permit |
| Sem exclusividade / múltiplas pendências | bloqueados |
| Sem token GO PO | aborta antes do permit |
| Permit rejeitado | aborta sem nativo |
| Execução real nesta sprint | hard-block |
| Retry automático | proibido |
| Path 51.45 intacto | OK |

---

## 6. Dry-run (banco oficial, somente leitura)

CLI: `node docs/homologacao/tef/SPRINT-51.46/tef-51-46-runner-recuperacao-tx3.js`

| Campo | Valor |
| --- | --- |
| `ok` / `elegivel` | **true** |
| `dryRun` | **true** |
| `dllChamada` / `nativeHostChamado` / `vespagueChamado` | **false** |
| `permitLedgerEscrito` | **false** |
| `gateGlobal` | **OFF** |
| Permit | `TX_FINALIZE` / id=3 / confirmacao=0 / purpose path / dry-run |

TX 2/3 e venda 66 **não alteradas**.

---

## 7. Procedimento de execução (futuro — fora desta sprint)

Somente após **GO específico do PO** em sprint de execução nomeada, com token `GO-PO-RECUPERACAO-TX3-FINALIZE-0`:

1. Revalidar readonly CDS: id=3, NSU 2338, auth 211139, venda 66, vespague 10100017275707.  
2. Confirmar exclusividade A1 (fonte NativeHost) + confirmação PO de pendência única.  
3. Emitir permit one-shot excepcional `TX_FINALIZE` + `transactionId=3` + `confirmacao=0` (ledger).  
4. `SECURITY_BOOTSTRAP` + `LOAD` (sem CRT / START / CONTINUE).  
5. `INIT_CLIENT`: seguir **somente** se A1; abortar se 00 ou F0; **sem retry**.  
6. **Uma** chamada `finalizaTransacaoDestaxa(0)` via path `RECUPERACAO_PROTOCOLAR_TX3`.  
7. `INIT_CLIENT` pós: esperar **00**; se A1 persistir ou ≠00 → parar e escalar.  
8. Auditoria `tef_logs`; não alterar TX2/TX3/venda66; gate permanece OFF.

Nesta sprint `EXECUCAO_NATIVA_HABILITADA_NESTA_SPRINT = false`.

---

## 8. Confirmação de não-execução

Nesta sprint **não** foram executados:

- `iniciaClientDestaxa` / `finalizaTransacaoDestaxa`  
- DLL / NativeHost / V$Pague  
- Emissão real de permit (ledger)  
- Habilitação de gate  
- CRT / TX_START / TX_CONTINUE / FINALIZE real  
- Alteração de TX 2, TX 3, venda 66, recebimentos ou fiscal  

**Aguardando GO específico do Product Owner** para sprint de execução real.
