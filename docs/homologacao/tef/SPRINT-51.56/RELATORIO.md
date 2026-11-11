# SPRINT 51.56 — Segunda cobrança real de homologação

**Data:** 2026-11-11  
**Classificação:** `BLOCKED_WITH_EVIDENCE`  
**Cobrança / CRT / one-shot:** **não executados**

---

## 1. Veredito

A execução foi **interrompida no precheck**, antes de emitir autorização one-shot e antes de qualquer CRT.

| Bloqueio | Evidência |
| --- | --- |
| **ERP ausente** | Nenhum processo `electron-erp.js` em execução |
| **Sessão INIT diferente** | Evidência 51.49: NativeHost PID **14256** / session `ecef111f…` — processo **inexistente** agora |
| **V$Pague reiniciado** | PID atual **22380** (antes 20760 na 51.49–51.55) — sessão Destaxa não é a mesma |
| **Novo INIT_CLIENT** | Necessário para qualquer CRT no PDV — **exige autorização específica do PO** (regra §7 do sprint) |

Gate global permanece **OFF** (`DESTAXA_REAL_TRANSACTION_ENABLED=0`).

---

## 2. Precheck (readonly)

| Item | Status | Detalhe |
| --- | --- | --- |
| Gate global | OK OFF | `0` |
| V$Pague | 1 instância | PID **22380**, ativo |
| ERP / PDV oficial | **FALHA** | **ausente** |
| Gertec PPC930 COM4 | OK | PnP `PPC-920/930 … (COM4)` Status OK; DB `GERTEC_PPC930` / COM4 / habilitado |
| Pendente / UNKNOWN | OK | nenhum |
| TX 2 | OK | `negado` |
| TX 3 | OK | `aprovado` NSU 2338 / aut 211139 / venda 66 |
| TX 4 | OK | `aprovado` NSU 2348 / aut 211139 / venda 67 |
| Venda 67 | OK | `concluida` / `quitada` / `tef_transacao_id=4` |
| MAX TEF id | OK | **4** |
| One-shot ISSUED | OK | nenhuma (não emitida nesta sprint) |
| INIT 51.49 reutilizável | **NÃO** | Host 14256 morto; ERP reiniciado desde 51.51; V$Pague PID mudou |

Artefato: `precheck.json`.

---

## 3. O que **não** foi feito (conforme regras)

- Não emitiu one-shot.
- Não executou `/api/tef/pagar`, CRT, TX_START / CONTINUE / FINALIZE.
- Não reiniciou ERP nem V$Pague (ERP já estava parado; subir ERP implicaria novo INIT no caminho TEF).
- Não alterou TX2/3/4, venda 67, financeiro ou gate.
- Não transmitiu NFC-e.

---

## 4. Solicitação ao Product Owner

Para retomar a Sprint 51.56 (única cobrança R$ 1,00 débito Destaxa / Gertec COM4 / PDV oficial), autorizar **explicitamente**:

1. **Subir o ERP** (`electron-erp.js --cds-forcar-local`) com gate OFF.  
2. **Um INIT_CLIENT** na nova sessão (LOAD + iniciaClientDestaxa), sem cobrança, para obter INIT=00.  
3. Em seguida, **emissão one-shot** + **uma CRT** no PDV oficial conforme o escopo já autorizado.

Sem esses itens, a regra do sprint impede avançar.

---

## 5. Estado final

| Campo | Valor |
| --- | --- |
| Gate | **OFF** |
| One-shot | não emitida |
| Nova TEF | não criada (`MAX(id)=4`) |
| Cobrança | não executada |
| Classificação | **`BLOCKED_WITH_EVIDENCE`** |
