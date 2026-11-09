# TEF-DESTAXA-51.17 — Investigação e classificação segura da transação pendente id=1

**Status:** CONCLUÍDA (somente leitura)  
**Coleta:** 2026-11-09 ~17:17–17:20 America/Sao_Paulo  
**Operação financeira:** **NÃO EXECUTADA**  
**Linha id=1:** **intacta** (sem UPDATE/DELETE)  
**Classificação financeira:** **UNKNOWN**  
**Classificação operacional:** **PENDING_WITH_EVIDENCE**

Artefatos: `dump-id1.json`, `dump-id1-readonly.js`, `decrypt-payload-id1.js`, `payload-id1.json`, `tef-logs-id1.json`, `log-files.json`

---

## Resumo executivo

A linha `tef_transacoes.id=1` foi criada pelo fluxo **TefManager** na tentativa **51.03** (auth `5aed71f2…` consumida em `16:58:43.030Z`). Há evidência conclusiva de **INSERT pré-DLL**, **TX_START**, resposta **99** (coleta PinPad) e tentativa de **TX_CONTINUE** (ack de DISPLAY) que retornou **`HOST_SECURITY_OPERATION_BLOCKED`**. O CDS registrou ciclo **inconclusivo**, `financialState: UNKNOWN`, **NSU/autorização nulos**, `retryAllowed: false`. No V$Pague, após timeout de 120 s aguardando a AC, houve leitura de cartão e tentativa de fluxo local, encerrada como **“Transação cancelada pela Aplicação Comercial”** (`resposta:78`) — **sem** NSU/aprovação Destaxa comprovada nos logs CDS/banco.

**Não** há evidência financeira positiva ou negativa conclusiva no CDS. A linha permanece `pendente` e continua a bloquear `criarTransacaoExclusiva`. **Não** se recomenda UPDATE/DELETE artificial.

---

## 1. Identificação completa da linha (readonly)

**Banco:** `C:\ProgramData\MercantilFiscal\dados\mercadao.db` (SHA256 arquivo no dump: `c5726b14…710517`)

| Campo | Valor |
| --- | --- |
| id | **1** |
| status | **pendente** |
| valor | 1.00 |
| tipo | cartao_debito |
| parcelas | 1 |
| provedor | destaxa |
| venda_id | **NULL** |
| idempotency_key | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| codigo_transacao | `1` (= operation_id/PK string no ciclo) |
| nsu | **NULL** |
| autorizacao | **NULL** |
| codigo_resposta | **NULL** |
| mensagem_resposta | **NULL** |
| adquirente / bandeira | **NULL** |
| comprovantes | **NULL** |
| criado_em | 2026-11-09 16:58:43 |
| atualizado_em | 2026-11-09 16:59:12 |
| reversao_executada | 0 |
| Outras pendentes | **somente esta** |

`payload_retorno`: blob criptografado (~3073 chars). Descriptografia nesta sprint: **falhou** (`Chave TEF indisponível` fora do processo PDV) → conteúdo do payload classificado **NÃO VERIFICÁVEL** aqui; evidência principal veio de `tef_logs`.

---

## 2. Evidências do banco — `tef_logs` (transacao_id=1)

| id | tipo | criado_em | Evidência-chave |
| --- | --- | --- | --- |
| 4 | INICIO | 16:58:43 | “persistida antes do Adapter/DLL”; `operation_id=op_ef2ed65b9230_744378e59797f9a7`; `_fingerprint=90b41858f0aff5d47c573e5c3d86bc62`; `persistidoAntesDll: true`; `estadoFinanceiroInicial: UNKNOWN` |
| 5 | MRT39_SOLICITACAO_99 | 16:59:12 | Solicitação 99/OPCAO persistida |
| 6 | MRT39_RESPOSTA_CONTINUIDADE | 16:59:12 | Resposta `displayAck`; `continueCount:1`; `txStartCount:1` |
| 7 | CICLO_CRT | 16:59:12 | Passos: TX_START → TX_START_RESULT **99** → TX_CONTINUE (DISPLAY/`display_ack`) → TX_CONTINUE_RESULT **`HOST_SECURITY_OPERATION_BLOCKED`**; `inconclusivo: true`; `retryAllowed: false` |
| 8 | RETORNO | 16:59:12 | `codigo: DESTAXA_CICLO_INCONCLUSIVO`; `financialState: UNKNOWN`; **nsu: null**; **autorizacao: null** |
| 9 | DECISAO_RETRY | 16:59:12 | `retryAllowed: false`; reason `HOST_SECURITY_OPERATION_BLOCKED` |
| 10 | MRT06_LEASE | 16:59:12 | Lease marcado **INCONCLUSIVO** (`lease_94f8eeedd1bbebbe`) |
| 11–13 | TEF_RESULTADO_PENDENTE_RECUPERADO | 18:30:12 / 19:01:43 / 19:35:51 | Reboots PDV: “nova autorização bloqueada”; estado `RECONCILIACAO_PENDENTE` |

Sem vínculo em `venda_recebimentos` / `vendas` para `tef_transacao_id=1`.

---

## 3. Linha do tempo (evidências cruzadas)

Horários locais = UTC−3.

| UTC | Local | Evento |
| --- | --- | --- |
| 16:54:10Z | 13:54 | Auth `5aed71f2…` **ISSUED** (51.03) |
| 16:58:40Z | 13:58:40 | NativeHost START; LOAD; INIT_CLIENT OK (obs + DLL) |
| 16:58:43.030Z | 13:58:43 | Auth **CONSUMED** |
| 16:58:43 | 13:58:43 | INSERT `tef_transacoes` id=1 + log INICIO |
| 16:58:43Z | 13:58:43 | **TX_START** requestId `d3cd929385f4281e` (CRT Débito 1.00) |
| 13:58:43–13:59:12 | | V$Pague: PinPad COM4; **TABELA EXPIRADA** (TLI 020); depois coleta cartão |
| 16:59:12Z | 13:59:12 | TX_START_RESULT **99**; solicitação 99 + displayAck; **TX_CONTINUE** → **HOST_SECURITY_OPERATION_BLOCKED** |
| 14:01:12 | | V$Pague: timeout 120 s aguardando AC (coleta cartão) |
| 14:02:06–14:02:10 | | V$Pague: cartão lido (VISA ELECTRON BIN 496068); TLS Destaxa “Configura Transacao” |
| 14:02:10 | | Coleta senha → timeout AC 14:04:10 |
| 14:04:10 / 14:06:10 | | “Transação cancelada pela Aplicação Comercial” (resposta 78); erro envio server; **transacao finalizada** no V$Pague |
| — | | CDS: status DB permanece **pendente**; sem NSU |

---

## 4. Correlação com autorização 51.03

| Campo | Valor |
| --- | --- |
| authorizationId | `5aed71f2b6e19f7f14303f69242c6796` |
| Emitida | 2026-11-09T16:54:10.595Z — motivo `TEF-DESTAXA-51.03-ETAPA2-homologacao-debito-r1` |
| Consumida | 2026-11-09T16:58:43.030Z — valor 100 / cartao_debito / CRT |
| Status ledger agora | **CONSUMED** (inalterado nesta sprint) |
| Ligação com id=1 | Mesmo segundo do INSERT + TX_START; fingerprint/`tef-fp-90b41858…` nos logs INICIO |

Auth **51.10** `ba08c88e…` e UNKNOWN `tx-5110-…`: **fora** desta linha; permanecem preservados.

---

## 5. Correlação dos logs externos

### Observability NativeHost
- TX_START `d3cd929…` → resultCode **99** em 16:59:12.872Z.  
- **Sem** TX_CONTINUE/TX_FINALIZE bem-sucedidos para esse requestId após o bloqueio.  
- Eventos `continuidade.tx_continue` de 18:08Z são da sprint **51.05** (ids `tx-5105-*`), **não** da id=1.

### DLL `destaxa-dll.log`
- 13:58:40 INIT; 13:58:43 connect 60906; executar Débito 1.00; 13:59:12 coleta `transacao_cartao_numero`.  
- Próxima sessão DLL: **15:54** (51.10) — não altera id=1.

### V$Pague
- Sessão `vspg-id-66c550a0`: coleta → timeout AC → depois leitura de cartão / cloud / senha / cancelamento pela AC.  
- Mensagens finais: cancelamento pela aplicação comercial; **não** comprovam aprovação financeira Destaxa no CDS.

---

## 6. Análise estática do código (sem execução)

| Pergunta | Resposta baseada em evidência + código |
| --- | --- |
| Etapa de criação de id=1 | `TefManager.autorizar` → `criarTransacaoExclusiva` **antes** do Adapter (log INICIO) |
| Chegou ao Adapter/DLL? | **Sim** (TX_START nativo + DLL/V$Pague) |
| TX_START? | **Sim** |
| 99 iniciado? | **Sim** (`registrarSolicitacao99` / MRT39 + TX_START_RESULT 99) |
| CONTINUE? | **Tentado** (DISPLAY ack) → bloqueado `HOST_SECURITY_OPERATION_BLOCKED` |
| Recuperação automática que fecha a linha? | Logs `TEF_RESULTADO_PENDENTE_RECUPERADO` **bloqueiam nova autorização**; **não** alteram status para aprovado/cancelado |
| Rotina que altera sem autorização? | Não evidenciada nesta investigação; status permanece `pendente` |

`criarTransacaoExclusiva` continua impedindo novo INSERT enquanto `status='pendente'` existir.

---

## 7. Respostas obrigatórias

1. **Comprovado:** INSERT pré-DLL; auth 51.03 consumida; TX_START; 99; CONTINUE bloqueado por HOST_SECURITY; retorno CDS UNKNOWN sem NSU; V$Pague encerrou com cancelamento pela AC após timeouts; linha ainda pendente.  
2. **Provável, não comprovado financeiramente:** não houve liquidação aprovada na Destaxa (cancelamento local V$Pague + erro de envio); **não** equivale a DECLINED emissor.  
3. **Não determinável:** conteúdo completo do `payload_retorno` criptografado sem chave TEF nesta sessão; eventual registro remoto Destaxa sem espelho local.  
4. **Resposta financeira conclusiva?** **Não.**  
5. **NSU?** **Não** (NULL).  
6. **Código de autorização?** **Não** (NULL).  
7. **Aprovação / recusa / cancelamento conclusivos no CDS?** **Não.** V$Pague registra cancelamento pela AC — evidência operacional parcial, não classificação financeira CDS.  
8. **O que mantém pendente?** Status DB nunca avançou após ciclo inconclusivo + política TEF-14 / lease inconclusivo / recuperação que só bloqueia nova auth.  
9. **Procedimento seguro recomendado:**  
   - Preservar id=1.  
   - Abrir sprint dedicada de **reconciliação controlada** / consulta formal Destaxa com: id=1, `op_ef2ed65b9230_744378e59797f9a7`, `tef-fp-90b41858…`, horários 13:58–14:06, requestId `d3cd929…`, auth `5aed71f2…`.  
   - **Não** UPDATE/DELETE para “liberar” INSERT.  
   - Só após desfecho seguro documentado, reavaliar CRT (nova auth expressa).  
10. **Ações que exigem autorização expressa adicional:** qualquer FINALIZE/CANCEL/reconciliação com efeito; emissão de nova auth; nova CRT; alteração de status; suporte Destaxa se envolver operação.

---

## 8. Classificação final

| Dimensão | Classificação | Justificativa |
| --- | --- | --- |
| **Financeiro** | **UNKNOWN** | Sem NSU/autorização/aprovação ou recusa emissor conclusiva no CDS; ciclo `DESTAXA_CICLO_INCONCLUSIVO` / `financialState: UNKNOWN` |
| **Operacional** | **PENDING_WITH_EVIDENCE** | Status `pendente` + trilha rica (START/99/CONTINUE bloqueado/V$Pague) |

**PENDING_WITH_EVIDENCE não autoriza liberar outra operação financeira.**

---

## 9. Limitações

- Payload criptografado não lido (chave TEF indisponível fora do PDV).  
- Sem consulta à API Destaxa (proibida / efeito potencial).  
- Cancelamento V$Pague ≠ DECLINED bancário comprovado.  
- Campo `continues:0` no resumo CICLO_CRT coexiste com passo TX_CONTINUE n=1 no mesmo payload — documentado; CONTINUE **ocorreu e falhou**.

---

## 10. Ações expressamente **não** executadas

CRT · TX_* · retry · cancel/update/delete id=1 · reconciliação automática · emissão/consumo/restauração de auth · gate ON · runner · NativeHost/DLL/COM4 · reinício PDV/V$Pague · alteração fiscal/produção · SQLite temp · escrita no ledger.

Auth 51.03 **CONSUMED** preservada · Auth 51.10 **CONSUMED** preservada · UNKNOWN `tx-5110-…` **inalterado**.

---

## 11. Conclusão da sprint

Investigação readonly documentada; evidências correlacionadas; classificação justificada; incertezas explícitas; id=1 intacta; nenhuma operação financeira iniciada.

**Aguardando nova decisão expressa do usuário** antes de qualquer reconciliação ou nova CRT.
