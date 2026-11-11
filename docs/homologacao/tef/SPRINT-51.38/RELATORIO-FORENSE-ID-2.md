# SPRINT-51.38 — Relatório forense TEF `tef_transacoes.id=2`

**Data da investigação:** 2026-11-10  
**Escopo:** somente leitura. Sem CRT/TX/DLL/COM4/permit/gate/alteração de banco/lease/reinícios.  
**Banco oficial:** `C:\ProgramData\MercantilFiscal\dados\mercadao.db`

---

## 1. Resumo executivo

A tentativa `id=2` **chegou à automação financeira Destaxa/V$Pague** (serviço `executar`, transação `[Cartao Vender]`, débito R$ 1,00) e abriu o PinPad **COM4** (Gertec PPC-930).

Sequência comprovada:

1. CDS cronometrou **TIMEOUT 30s** e classificou temporariamente **UNKNOWN** (HTTP 422).
2. Em paralelo, o NativeHost **19920** (PPID **10292**) ainda executava `TX_CONTINUE`.
3. O V$Pague aguardou cartão no PinPad por **60s**, expirou a leitura (`CKE`), encerrou com **resposta 078** (“Transacao cancelada pelo operador”).
4. O CDS registrou **resultado tardio** Destaxa **09** → `financialState=CONFIRMED_DENIED` e status atual **`negado`**.

**Não há NSU, autorização nem comprovantes.**  
**Não há evidência de aprovação.**

### Classificação: **B — evidência formal de operação recusada/não realizada**

Fundamento: retorno Destaxa **09** (Host + `tef_logs`), V$Pague **078** sem NSU, status CDS **`negado`**, mensagem de cancelamento.  
A classificação **UNKNOWN** do timeout CDS de 30s foi **supersedida** pelo resultado tardio; o UNKNOWN intermediário permanece relevante apenas como trava operacional (`TRAVA_RESULTADO_TARDIO` / lease inconclusivo no momento do timeout).

---

## 2. Identificação da transação

| Campo | Valor (SELECT read-only) |
| --- | --- |
| id | **2** |
| status atual | **`negado`** |
| valor / tipo | **1,00** / **`cartao_debito`** |
| venda_id | **65** |
| provedor | destaxa |
| idempotency_key | `tef-primeira-venda-9dd272f1d91f84df` |
| operation_id (INICIO) | `op_be24a55bc6bf_36b2d28a2c6ad925` |
| nsu / autorização | **null** / **null** |
| comprovantes | **null** |
| criado_em | `2026-11-10 19:29:04` (UTC gravado no SQLite) |
| atualizado_em | `2026-11-10 19:30:33` |
| lease (INICIO) | `lease_1ddd7a48f3655670` · terminal `singleton:instalacao` · `liberado=false` no timeout |

**Venda 65 (contexto):** `concluida` / `quitada` / `tef_transacao_id=null`; recebimento id=78 **não fiscal** `cartao_debito` (prévio à CRT; fora do mérito de aprovação TEF).

---

## 3. Linha do tempo (horários)

Horários CDS/NativeHost em **UTC**; V$Pague em **BRT (UTC−3)**. Equivalência: `19:29:04Z` ≈ `16:29:04` BRT.

| UTC | BRT | Evento | Evidência |
| --- | --- | --- | --- |
| 19:29:01.592 | 16:29:01 | HTTP `POST /api/tef/pagar` inicia | `venda-http-inicio.json` / `venda-http-resultado.json` |
| 19:29:01.649 | 16:29:01 | Lease `lease_1ddd7a48f3655670` adquirido | `tef_logs` id=16 payload |
| 19:29:01.708→01.990 | 16:29:01 | NativeHost sobe; **pidHost=19920**, **ppid=10292**, `host.ready` | observability L727–L732 |
| 19:29:02.074→02.133 | 16:29:02 | **LOAD** enviado/recebido/ok | observability (`operation":"LOAD"`) |
| 19:29:02.170→02.224 | 16:29:02 | **INIT_CLIENT** → `iniciaClientDestaxa` **00** | observability L764–L767 (`native.call.*`) |
| 19:29:04.078 | 16:29:04 | INSERT `tef_transacoes` id=2 (antes da DLL financeira) | `tef_logs` id=16 |
| 19:29:04.109 | 16:29:04 | Permit excepcional **CONSUMED** | observability `autorizacao.excepcional.consumida` |
| 19:29:04.131→04.193 | 16:29:04 | **ENABLE_REAL** IPC ok | observability |
| 19:29:04.254→04.267 | 16:29:04 | **TX_START** preparado → IPC enviado → Host recebe → `nativa.inicio` | observability |
| 16:29:04.606–04.683 | — | V$Pague: `iniciar` + `executar` **Cartao Vender / Debito / 1.00**; “transacao iniciada” | `vspague-client.log` L212–L216 |
| 16:29:05.814–06.xxx | — | PinPad **COM4** aberto; Gertec **PPC-930** | L218–L236 |
| 16:29:08–32 | — | Carga de tabelas; várias **`TABELA EXPIRADA` (TLI 020)**; reconexão cloud Destaxa | L280+, L505–L523 |
| 19:29:33.104→33.127 | 16:29:33 | **TX_START** retorna Destaxa **99** (~28,8s) | observability + `tef_logs` CICLO_CRT |
| 16:29:33.074 | — | V$Pague coleta: “Aguarde passagem/inserção/aproximação do cartão” | L524 |
| 19:29:33.216→33.261 | 16:29:33 | **TX_CONTINUE** (DISPLAY/`display_ack`) enviado; Host inicia nativa | observability + `tef_logs` id=17/18 |
| 19:29:34.097 | 16:29:34 | CDS **TIMEOUT 30000ms** → HTTP UNKNOWN; `TRAVA_RESULTADO_TARDIO`; lease **MARCAR_INCONCLUSIVO** | `tef_logs` id=19–21; `venda-http-resultado.json` |
| 16:30:33.633 | — | V$Pague: **timeout 60s** aguardando PinPad (`CKE`); “Erro de leitura do cartão” | L529–L530 |
| 16:30:34.719 | — | V$Pague final: **resposta 078**, “Transacao cancelada pelo operador” | L541–L542 |
| 19:30:33.697→33.730 | 16:30:33 | **TX_CONTINUE** retorna Destaxa **09** | observability |
| 19:30:33.735–33.746 | 16:30:33 | CDS `CICLO_CRT` **NEGADO**; `RESULTADO_TARDIO` **CONFIRMED_DENIED** | `tef_logs` id=22–23 |
| pós | — | status DB **`negado`**; NSU/autorização permanecem null | SELECT id=2 |

**NativeHost ao fim da investigação (observação de processo, sem intervenção):** PID **19920** ainda listado com PPID **10292**.

---

## 4. Evidências por arquivo

### 4.1 Banco — `tef_transacoes` / `tef_logs`

- Status final **`negado`**; `nsu`/`autorizacao`/comprovantes **null**.
- `tef_logs` id=16…23 (INICIO → 99 → continuidade → TIMEOUT/trava/lease → CICLO_CRT → RESULTADO_TARDIO).
- `CICLO_CRT` passos: `TX_START` → `TX_START_RESULT(99)` → `TX_CONTINUE` → `TX_CONTINUE_RESULT(09)` → `NEGADO`; **`finalizado:false`** (sem passo `TX_FINALIZE` no payload).

### 4.2 NativeHost — `%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl`

- Spawn/ready: **pid=19920**, **ppid=10292**.
- LOAD / INIT_CLIENT / `iniciaClientDestaxa` → **00**.
- ENABLE_REAL ok.
- TX_START IPC + `nativa.inicio/fim` → **resultCode 99**.
- TX_CONTINUE IPC + `nativa.inicio/fim` → **resultCode 09**.
- **Não há** linhas `native.call.enter/return` com `functionName=iniciaTransacaoDestaxa` ou `continuaTransacaoDestaxa` nesta janela (apenas `iniciaClientDestaxa`). A execução financeira é evidenciada pela combinação Host `TX_*` + V$Pague `executar`.

### 4.3 V$Pague — `C:\VBI\V$Pague\Client\logs\vspague-client.log`

| Linha | Conteúdo relevante |
| --- | --- |
| 214 | `servico:executar, transacao:[Cartao Vender], ... tipoCartao:Debito, valor:1.00` |
| 216–222 | transação iniciada; COM4; PinPad conectado |
| 280+ | `TABELA EXPIRADA` (TLI 020) durante carga |
| 524 | coleta: aguardar cartão no PIN-Pad |
| 529–530 | timeout 60s PinPad; erro de leitura/cartão inválido |
| 541 | **`resposta:078`**, “Transacao cancelada pelo operador.” |
| 542 | “transacao finalizada” |

**NSU / autorização:** não aparecem no intervalo.

### 4.4 Artefato HTTP CDS

`docs/homologacao/tef/TEF-DESTAXA-PRIMEIRA-VENDA/venda-http-resultado.json`: statusCode **422**, `financialState=UNKNOWN`, `retryAllowed=false` em **19:29:34Z** — resposta **antes** do resultado Destaxa 09.

---

## 5. Último comando comprovadamente enviado à DLL / Host

| Camada | Último comando | Evidência |
| --- | --- | --- |
| IPC CDS→Host | **`TX_CONTINUE`** (`requestId=b26da9c674734d32`), ~19:29:33.254Z | observability `ipc.message.sent` / Host `ipc.message.received` |
| Host nativo | operação **`TX_CONTINUE`** `nativa.inicio` ~19:29:33.261Z | observability |
| Automação V$Pague (efeito da CRT) | após START: coleta cartão; após timeout: **`servico:finalizar`** (L535) | `vspague-client.log` |

**Não comprovado nesta sprint:** chamada `finalizaTransacaoDestaxa` / `TX_FINALIZE` no ciclo CDS (`finalizado:false` no `CICLO_CRT`).

---

## 6. Última resposta comprovadamente recebida

| Camada | Resposta | Evidência |
| --- | --- | --- |
| Destaxa via Host | **`resultCode=09`** em `TX_CONTINUE` (~19:30:33.730Z) | observability |
| V$Pague → automação | **`resposta:078`**, mensagem cancelamento operador (~16:30:34.719) | L541 |
| CDS persistido | `RESULTADO_TARDIO` · `resultCode=09` · `financialState=CONFIRMED_DENIED` · resolution `FINAL_DENIED` | `tef_logs` id=23 |

---

## 7. Situação financeira

| Pergunta | Conclusão baseada em evidência |
| --- | --- |
| Houve aprovação / NSU / autorização? | **Não** (null no banco; ausentes no V$Pague) |
| A solicitação chegou ao processamento financeiro? | **Sim** — V$Pague iniciou **Cartao Vender** débito R$1,00 e operou PinPad COM4 |
| Cartão foi lido com sucesso? | **Não comprovado** — timeout 60s em `CKE`; erro de leitura |
| Estado CDS atual | **`negado`** após resultado tardio 09 |
| UNKNOWN intermediário | Sim (timeout CDS 30s), **depois supersedido** por DENIED |

**Classificação final: B** (recusada/não realizada com códigos formais 09/078).  
Não A. Não C (chegou à etapa financeira/PinPad). UNKNOWN puro (D) não descreve o estado **atual** pós-resultado tardio.

---

## 8. Estado atual do bloqueio / lease

| Item | Estado evidenciado |
| --- | --- |
| `tef_locks` (tabela) | **vazia** (sem linhas) |
| Lease em memória (log id=21 @ timeout) | `lease_1ddd7a48f3655670`, `resultadoFinanceiroInconclusivo=true`, **`liberado=false`** |
| `TRAVA_RESULTADO_TARDIO` | registrada @ 19:29:34 — “nova autorização bloqueada” |
| `retryAllowed` | **false** (timeout e resultado tardio) |
| NativeHost 19920 | ainda presente sob PDV 10292 (observação; **não** encerrado nesta sprint) |

Não foi possível, em modo read-only, ler o heap do processo para afirmar se o lease em memória já foi liberado após o `CONFIRMED_DENIED`. O que está **provado** é o registro de inconclusivo no timeout e a trava de resultado tardio.

---

## 9. Recomendação para o próximo passo

1. **Não iniciar novo pagamento** até o PO autorizar explicitamente nova sprint operacional.  
2. Antes de qualquer nova CRT: confirmar com o PO se a trava/`lease` em memória do PDV 10292 ainda bloqueia autorização (diagnóstico read-only ou procedimento autorizado de liberação — **fora** desta sprint).  
3. Tratar `id=2` como **não aprovada / sem NSU**, alinhada a Destaxa **09** e V$Pague **078**; se o PO exigir certeza mercantil adicional, consultar portal/adquirente Destaxa **sem** nova cobrança local.  
4. Investigar operacionalmente (sprint futura autorizada): timeout CDS **30s** vs espera PinPad **60s**; carga **TABELA EXPIRADA**; alinhamento modo confirmação fiscal MANUAL vs TEF na venda 65.  
5. **Não** fabricar FINALIZE(9)/NSU; **não** reutilizar o permit já CONSUMED.

---

## Apêndice — distinção preparada / enviada / recebida / resposta

| Etapa | Preparada | Enviada (IPC/automação) | Recebida pelo Host/V$Pague | Resposta |
| --- | --- | --- | --- | --- |
| LOAD | sim | sim | sim (Host) | ok |
| INIT_CLIENT | sim | sim | sim | **00** (`iniciaClientDestaxa`) |
| ENABLE_REAL | sim | sim | sim | ok |
| TX_START / CRT | sim (CICLO) | sim (IPC TX_START) | sim (Host + V$Pague `executar`) | **99** |
| TX_CONTINUE | sim | sim | sim | **09** / V$Pague **078** |
| TX_FINALIZE | não evidenciado | não | — | — |

---

**SPRINT-51.38: read-only concluída. Sem alteração de estado da operação.**
