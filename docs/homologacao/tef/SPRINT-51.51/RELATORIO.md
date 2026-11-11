# SPRINT 51.51 — Liberação controlada one-shot (pós-recuperação TX 3)

**Data:** 2026-11-10  
**Classificação:** `LIBERACAO_ONESHOT_EMITIDA` — **aguardando confirmação de prontidão no PDV**  
**Cobrança nesta sprint:** **não executada**

---

## 1. Veredito

Liberação financeira **controlada** preparada **sem** ligar `DESTAXA_REAL_TRANSACTION_ENABLED`.

| Item | Estado |
| --- | --- |
| Gate global | **OFF** (`0`) antes e depois da emissão |
| Autorização one-shot | **ISSUED** — id `7528947cd63e0ccfcf2831cff56663bb` |
| TTL | até `2026-11-11T00:30:27.005Z` (~30 min a partir da emissão) |
| Vínculo | Destaxa + Gertec `GERTEC_PPC930` + **COM4** + canal `pdv_oficial` |
| Valor / modalidade / op | R$ 1,00 / débito / CRT |
| Cobrança / CRT / TX_* | **Não** |
| Retry / PIX / crédito / cancel / estorno | Bloqueados pela política one-shot |
| ERP | Reiniciado com gate OFF para carregar adapter 51.51 (PID Electron **19772**) |

**Próximo passo humano:** no PDV oficial, confirmar que a mensagem deixou de ser *“bloqueada pelo gate financeiro”* e passou a indicar prontidão para a operação autorizada — **sem** concluir a venda até GO explícito se ainda houver trava operacional.

---

## 2. O que foi implementado

### 2.1 Código

| Arquivo | Mudança |
| --- | --- |
| `destaxaConstantes.js` | Erros `…_DUPLICADA` e `…_GATE_GLOBAL` |
| `destaxaAutorizacaoExcepcional.js` | Vínculo operacional; anti-duplicidade ISSUED; recusa emissão com gate ON; `retryAllowed=false`; ops proibidas |
| `DestaxaRealAdapter.js` | Find/consumo exigem vínculo Destaxa + COM + pinpad + `pdv_oficial` |
| `tests/tef/tef-destaxa-51-51-liberacao-controlada.test.js` | 6 testes (todos OK) |
| `docs/.../SPRINT-51.51/emitir-auth-oneshot-5151.js` | Emissor com precheck |

Regressão 51.02: **14/14 OK**.

### 2.2 Regras da liberação

1. **Não** altera `DESTAXA_REAL_TRANSACTION_ENABLED` para `1`.
2. Autorização de **uso único** no ledger local (`destaxa-autorizacao-excepcional.json`).
3. Somente **R$ 1,00**, **débito**, **Destaxa**, **Gertec PPC930 / COM4**, canal **PDV oficial**.
4. Consumo atômico **ISSUED→CONSUMED**; segundo ISSUED / segundo consumo → bloqueio.
5. Sem retry, segunda cobrança, PIX, crédito, cancelamento ou estorno via esta capability.
6. UNKNOWN/timeout: `retryAllowed=false` — interromper e preservar evidências.
7. Gate global permanece **OFF**.

---

## 3. Evidência da emissão

Artefato: `docs/homologacao/tef/SPRINT-51.51/emissao-autorizacao.json`

| Campo | Valor |
| --- | --- |
| `authorizationId` | `7528947cd63e0ccfcf2831cff56663bb` |
| `status` | `ISSUED` |
| `valorCentavos` | `100` |
| `operacao` | `CRT` |
| `vinculo.portaCom` | `COM4` |
| `vinculo.pinpadCodigo` | `GERTEC_PPC930` |
| `gateProcess` | `0` |
| `cobrancaExecutada` | `false` |
| Precheck `MAX(id)` TEF | **3** |
| Precheck pendentes | nenhum |

---

## 4. Instruções operacionais (PDV)

Dentro do TTL:

1. PDV oficial (ERP Electron reiniciado) — **Caixa Aberto**.
2. Preparar venda de homologação **R$ 1,00** em **débito** (ainda **não** cobrar até confirmação de prontidão / GO).
3. Esperado: caminho CRT real **sem** bloqueio `DESTAXA_REAL_TRANSACTION_DISABLED` (auth ISSUED compatível).
4. **Uma** tentativa apenas. Se UNKNOWN, timeout ou falha de confirmação → **parar**, preservar logs/ledger/comprovantes, **não** retry.
5. Após a operação (ou aborto): confirmar `DESTAXA_REAL_TRANSACTION_ENABLED` continua ≠ `1`.

---

## 5. Restrições cumpridas nesta sprint

| Restrição | Status |
| --- | --- |
| Gate global não ligado | Sim |
| Sem cobrança automática | Sim |
| Sem TX_START / CONTINUE / FINALIZE | Sim |
| Sem `/api/tef/pagar` | Sim |
| TX 2 / TX 3 / venda 66 intocados | Sim (max id=3 no precheck) |

---

## 6. Estado de espera

**`AGUARDANDO_CONFIRMACAO_PRONTIDAO_PDV`**

ERP Electron reiniciado (PID **19772**) com gate OFF para carregar o adapter 51.51; V$Pague permanece PID **20760**. Sessão de desktop ficou na tela de bloqueio do Windows durante a tentativa de abrir o PDV — confirmação visual da prontidão fica a cargo do operador.

Não avançar para a cobrança real sem confirmação no PDV de que a liberação one-shot foi reconhecida (fim da mensagem *“transação bloqueada pelo gate financeiro”*).
