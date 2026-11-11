# SPRINT 51.49 — Validação da inicialização Destaxa após recuperação

**Data:** 2026-11-10  
**Classificação:** `INIT_OK`  
**Contexto:** pós SPRINT 51.47 (FINALIZE 00) / 51.48 (verificação)

---

## 1. Veredito

Após a recuperação protocolar da TX 3, o Client Destaxa inicializa com **INIT_CLIENT = 00** / **CLIENT_INITIALIZED**, **sem A1/F0**, sem operação financeira e sem nova TEF.

| Critério | Resultado |
| --- | --- |
| INIT_CLIENT | **00** (requestId `0c53e72df667ac84`) |
| CLIENT_INITIALIZED | **Sim** |
| A1 / F0 | **Ausentes** nesta validação |
| V$Pague único | PID **20760**, `:60906` Listen |
| PDV operacional | Aberto pelo ERP (`Caixa Aberto`) |
| Gate global | **OFF** (`DESTAXA_REAL_TRANSACTION_ENABLED=0`) |
| Permit financeiro | **Não emitido** |
| Nova TEF / CRT / TX_* | **Não** (`max id` = 3) |
| TX 2 / TX 3 / venda 66 | Inalteradas |

---

## 2. Pré-checagens

| Item | Evidência |
| --- | --- |
| Operação TEF em andamento / UNKNOWN | Nenhuma (`pendentes=[]`; status 1/2/3 sem UNKNOWN operacional) |
| TX 2 | `negado` |
| TX 3 | `aprovado`, NSU 2338, auth 211139 |
| Venda 66 | `tef_transacao_id=3` |
| V$Pague | 1 instância (PID 20760); não reiniciada |

---

## 3. Fluxo ERP → PDV

| Passo | Detalhe |
| --- | --- |
| 1 | `electron.cmd electron-erp.js --cds-forcar-local` (gate env forçado `0`) |
| 2 | ERP Electron PID **14792** (wrapper shell 21364 → cmd 10084 → node 5032) |
| 3 | Login já autenticado (Diego / SUPER ADMIN) |
| 4 | Menu **Comercial → Abrir PDV** |
| 5 | PDV: janela *CDS SISTEMAS - PDV - Frente de Caixa Fiscal NFC-e*, **Caixa Aberto**, carrinho vazio |

Observação: o PDV oficial abriu como janela do mesmo processo ERP de desenvolvimento (não como `electron-pdv.js` separado nesta sessão).

---

## 4. Validação INIT_CLIENT (sem cobrança)

### Por que não `/tef/pagar`

No `TefManager.autorizar`, após `prepararAutorizacao` com INIT **00**, o fluxo **persiste** `tef_transacoes` **antes** do gate/CRT. Usar o pagamento do PDV para provar INIT=00 criaria TEF id≥4 — **proibido** nesta sprint.

### Método usado

Probe Electron `tef-51-49-validar-init-client.js`: mesmo caminho nativo de `prepararAutorizacao` até `iniciaClientDestaxa` (LOAD + **um** INIT_CLIENT), **sem** ENABLE_REAL, TX_*, CRT, permit ou `/tef/pagar`.

| Campo | Valor |
| --- | --- |
| NativeHost PID | **14256** (PPID probe **16508**) |
| hostSessionId | `ecef111f043a10471c4f1d126f02985f` |
| INIT requestId | `0c53e72df667ac84` |
| Código | **00** |
| STATUS pós | `clientInitialized=true`, `clientResultCode=00`, `operacaoAtiva=null`, `gateReal=false` |
| Artefato | `evidencias-init.json` |

---

## 5. Evidências NativeHost / V$Pague / gate / permits

| Fonte | Achado |
| --- | --- |
| Observability | INIT_CLIENT `resultCode=00` @ `2026-11-10T23:43:07Z` (Host 14256) |
| Operações financeiras na probe | Nenhuma (sem ENABLE_REAL / TX_START / TX_CONTINUE / TX_FINALIZE) |
| V$Pague | PID 20760 único; porta 60906 |
| Gate | OFF antes e depois |
| Permit | Não emitido |

---

## 6. Estado final do banco (readonly)

| Entidade | Estado |
| --- | --- |
| TX 3 | `aprovado` / NSU **2338** / auth **211139** |
| Comprovantes | cliente 1057 / estabelecimento 1057 |
| Venda 66 | `concluida` / `quitada` / vínculo TEF **3** |
| TX 2 | `negado` (inalterada) |
| `MAX(id)` TEF | **3** |
| Pendentes | nenhum |

---

## 7. Critérios de sucesso — checklist

- [x] INIT_CLIENT = 00  
- [x] CLIENT_INITIALIZED  
- [x] Sem A1 e sem F0  
- [x] V$Pague único e ativo  
- [x] PDV operacional (Caixa Aberto)  
- [x] Gate OFF  
- [x] Sem nova TEF  
- [x] TX 2, TX 3 e venda 66 inalteradas  

---

## 8. Restrições cumpridas

Não executados: CRT, TX_START, TX_CONTINUE, TX_FINALIZE, FINALIZE(9), nova cobrança, permit financeiro, gate ON, reinício de V$Pague, escrita no banco oficial, alteração da recuperação TX 3.

Nenhuma nova sprint iniciada automaticamente.
