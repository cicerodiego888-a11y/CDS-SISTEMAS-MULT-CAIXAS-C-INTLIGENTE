# TEF-DESTAXA-51.04 — Diagnóstico do travamento do PDV após TEF

**Status:** CONCLUÍDA (diagnóstico somente leitura)  
**Data:** 2026-11-09  
**Autorização:** `5aed71f2b6e19f7f14303f69242c6796`  
**Nova TX / retry / emissão / kill / reinício:** nenhum

---

## Classificação obrigatória

| Dimensão | Classificação |
| --- | --- |
| **A. PDV** | **NOT_RESPONDING** |
| **B. TEF técnico** | **TIMEOUT** (ciclo incompleto após 99) |
| **C. Financeiro** | **NÃO COMPROVADO** |
| **D. Autorização** | **CONSUMED** |

Gate global permanece **OFF** (User/Machine vazios; process diagnóstico `0`).

---

## 1. Último evento confirmado da tentativa (CDS)

Último evento CDS na observabilidade nativa:

| Campo | Valor |
| --- | --- |
| Horário | 2026-11-09T16:59:12.872Z (~13:59:12 local) |
| requestId | `d3cd929385f4281e` |
| Operação | **TX_START** |
| resultCode | **99** |
| Duração | ~29717 ms |
| Próximo TX_CONTINUE | **Ausente** (nenhum registro) |

Último evento V$Pague (lado fornecedor):

| Campo | Valor |
| --- | --- |
| Horário | 2026-11-09 14:06:11 |
| Mensagem | `Transação cancelada pela Aplicação Comercial` — retorno **9**, resposta **78** |
| Encerramento PinPad | `CLO` OK → `transacao finalizada` |

Último evento DLL:

| Campo | Valor |
| --- | --- |
| Horário | 2026-11-09 13:59:12 |
| Conteúdo | Resposta 99 / coleta `transacao_cartao_numero` (“Aguarde passagem/inserção/aproximação do cartão”) |
| Após isso | **Sem novas linhas** (DLL não registrou CONTINUE/FINALIZE nesta tentativa) |

---

## 2. Ponto do travamento

**Ponto CDS (alto):** após receber **TX_START → 99 (COLETA cartão)**, o fluxo **não emitiu TX_CONTINUE**. O processo principal Electron (**PID 14012**) ficou `Responding=False` (“Não está respondendo”). O NativeHost utility (**PID 15584**) permanece vivo com TCP **ESTABLISHED** `127.0.0.1:63411 ↔ 60906` (V$Pague).

**Ponto V$Pague (confirmado):** após enviar a coleta à aplicação comercial, **aguardou 120 s** sem resposta → timeouts repetidos → cancelamento atribuído à aplicação comercial.

Não há evidência de callback de conclusão financeira (00/aprovação) retornando ao PDV.

---

## 3. Evidências — processos PDV (sem interferência)

| PID | Papel | Responding | Notas |
| --- | --- | --- | --- |
| **14012** | Main `electron-pdv.js --cds-forcar-local` | **False** | Janela “CDS Sistemas - PDV”; 30 threads em Wait |
| 7020 | Renderer | True | UI process viva, main não |
| 7252 | GPU | True | — |
| 4188 | Network utility | True | — |
| **15584** | NodeService / NativeHost | True | Spawn ~13:58:40; socket TEF ativo |
| 10256 | VSPagueClient | True | Desde 12:24:10 |

CPU do main estável baixa (~17,6) — hang de espera, não loop CPU intenso.

---

## 4. Evidências — timeline correlacionada

Horários locais (UTC−3). CDS observability em UTC (+3h).

| Local | Componente | Evento |
| --- | --- | --- |
| 13:54:10 | Ledger/obs | Auth **emitida** ISSUED |
| 13:58:40 | NativeHost 15584 | Spawn + LOAD + **INIT_CLIENT 00** |
| 13:58:43 | Ledger/obs | Auth **CONSUMED** (`cartao_debito`, 100) |
| 13:58:43 | obs | **ENABLE_REAL** ok (`14deb6776a128915`) |
| 13:58:43 | obs/DLL/V$Pague | **TX_START** / `iniciar` + `executar` Cartão Vender / Débito / **1.00** |
| 13:58:44–13:59:11 | V$Pague/PinPad | COM4 OK; carga tabelas; vários **TABELA EXPIRADA** (TLI 020) |
| 13:59:12 | DLL + obs | Retorno **99** coleta cartão → TX_START fim (resultCode 99) |
| **13:59:12+** | CDS | **Sem TX_CONTINUE** |
| 14:01:12 | V$Pague | Timeout 120s “aguardar resposta da aplicação comercial” (seq 1) |
| 14:02:06–08 | PinPad | Cartão processado (CKE/GCR); **VISA ELECTRON**; “Processando...” |
| 14:02:10 | V$Pague | Coleta **AGUARDE A SENHA** à aplicação comercial (seq 2) |
| 14:04:10 | V$Pague | Timeout 120s novamente; cancelamento comercial (9/78) |
| 14:04:10–14:06:10 | PinPad | GOC chip / “Processando...” → novo timeout 120s |
| 14:06:11 | V$Pague | Mensagem final cancelamento; **CLO**; transação finalizada |

---

## 5. Estado do ledger

Arquivo: `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`  
**Não alterado** nesta sprint.

| Campo | Valor |
| --- | --- |
| authorizationId | `5aed71f2b6e19f7f14303f69242c6796` |
| status | **CONSUMED** |
| emitidoEm | 2026-11-09T16:54:10.595Z |
| consumidoEm | 2026-11-09T16:58:43.030Z |
| valor / tipo | 100 / cartao_debito |
| RequestId TX | `d3cd929385f4281e` (TX_START; não há requestId de CONTINUE) |

Consumo ocorreu **antes** de TX_START (política 51.02). Autorização **não** é reutilizável.

---

## 6. Estado técnico da operação

- CRT / TX_START: **sim** (iniciada e retornou 99).
- TX_CONTINUE / FINALIZE CDS: **não registrados**.
- DLL: enviou executar; recebeu 99; **sem** evidência de CONTINUE na DLL.
- NativeHost: respondeu TX_START; ficou com sessão TCP aberta; **sem** CONTINUE.
- V$Pague: concluiu fluxo local com **cancelamento por timeout da aplicação comercial** (não por código adquirente 05/09 documentado).
- Callback PDV de sucesso: **não comprovado**.

Classificação B: **TIMEOUT** (com fase prévia INICIADO + RETORNO 99 parcial).

---

## 7. Estado financeiro comprovável

- **Não há** NSU/autorização adquirente / código 00 de aprovação nos logs CDS/DLL/V$Pague desta tentativa.
- V$Pague: cancelamento “pela Aplicação Comercial” (retorno 9 / resposta 78), falha ao enviar ao V$PagueServer.
- Saldo bancário aparentemente inalterado: **compatível**, mas **não** usado como prova única.

Classificação C: **NÃO COMPROVADO** (não APROVADO; não tratar como cancelamento líquido só pelo saldo).

UNKNOWN histórico da política TEF: preservar — tentativa inconclusiva do ponto de vista CDS (ciclo sem CONTINUE/FINALIZE).

---

## 8. Hipótese de causa raiz

**Hipótese principal (confiança: alta):**  
Após `TX_START→99` com ação de **COLETA** (`transacao_cartao_numero`), o CDS **não avançou o protocolo com TX_CONTINUE** dentro da janela de 120 s exigida pelo V$Pague para resposta da aplicação comercial. O main Electron (14012) ficou não responsivo; o ciclo ficou incompleto do lado CDS. O V$Pague, sem CONTINUE, expirou a espera, cancelou e fechou o PinPad.

**Fatores contribuintes (confiança: média):**

1. Contrato MRT-42: 99/COLETA exige continuidade explícita (`POST /tef/continuar` / fila `respostasContinuidade`); auto-CONTINUE não inventa coleta.
2. Possível bloqueio do processo principal (Promise/IPC/persistência 99) impedindo o PDV de enviar a continuidade a tempo.
3. **TABELA EXPIRADA** no PinPad atrasou ~30 s o primeiro 99 (já dentro do TX_START).
4. Leitura de cartão/senha no PinPad ocorreu **depois** do primeiro timeout de automação — desalinhamento entre UI PinPad e protocolo de automação CDS↔V$Pague.

**Descartes (com evidência):**

- Não foi falha de gate (auth consumida + ENABLE_REAL ok).
- Não foi ausência de V$Pague/COM4 (ambos OK).
- Não foi “aprovado só porque DLL/V$Pague estavam ativos”.

---

## 9. Componentes envolvidos

PDV Electron (main 14012) → Orquestrador/TefManager → DestaxaRealAdapter → DestaxaHostBridge → NativeHost (15584) → DLL → V$Pague (10256) → PinPad Gertec PPC-930 COM4 → (falha de retorno ao CDS na continuidade).

---

## 10. Correção recomendada (NÃO implementar nesta sprint)

1. Garantir que, após `TX_START→99` COLETA/DISPLAY, o caminho PDV/TefManager **sempre** emita `TX_CONTINUE` (ou devolva UI de continuidade sem bloquear o main) **antes** do timeout de 120 s do V$Pague.
2. Evitar bloquear o process main do Electron em espera síncrona/IPC longa durante CRT; manter UI “respondendo” e continuidade assíncrona.
3. Instrumentar explicitamente `TX_CONTINUE` / `CONTINUIDADE_SEM_RESPOSTA` / timeout de continuidade no observability (já há lacuna: após 99 não há evento de bloqueio de continuidade nesta tentativa).
4. Tratar **TABELA EXPIRADA** como pré-condição de homologação (carga de tabelas PinPad) em sprint operacional futura — sem reinício automático aqui.
5. Política: tentativa atual = **reconciliação obrigatória / sem retry automático**; nova CRT só com **nova** autorização excepcional explícita.

---

## 11. Pendências para retomada

1. Decisão operacional sobre o processo PDV **ainda NOT_RESPONDING** (14012) — **não** reiniciado nesta sprint.
2. Reconciliação financeira/manual da tentativa (sem assumir liquidação).
3. Nova autorização excepcional **somente** com autorização expressa do responsável (a atual está CONSUMED).
4. Validar fluxo de continuidade 99 no PDV antes da próxima homologação.
5. Revisar estado de tabelas EMV do PinPad (TABELA EXPIRADA).

---

## 12. Testes

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-02-autorizacao-excepcional.test.js` | **14 ok / 0 falhas** (mocks; ledger operacional intacto) |

Sem DLL/NativeHost/V$Pague/TX nesta sprint de teste.

---

## Restrições respeitadas

Sem nova TX, retry, emissão, reconsumo, CRT/CONTINUE/FINALIZE executados, sem kill/restart PDV ou V$Pague, sem alteração de gate/config/logs, UNKNOWN preservado, sem correção de código.
