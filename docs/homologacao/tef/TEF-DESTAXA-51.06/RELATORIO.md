# TEF-DESTAXA-51.06 — Diagnóstico estático do fluxo TX_CONTINUE

**Status:** CONCLUÍDA (diagnóstico somente leitura; sem operação financeira)  
**Data:** 2026-11-09  
**Base:** correção 51.05 + evidências 51.03/51.04  
**Restrições:** sem TX operacional, sem emitir/consumir auth, sem DLL/NativeHost/V$Pague/CRT, sem alteração de gate/config/PDV/fiscal

---

## 1. Envio de `TX_CONTINUE` — arquivo e função

| Camada | Arquivo | Função / ponto |
| --- | --- | --- |
| Resolução do ack PinPad | `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | `resolverRespostaContinuidade` → `{ informacao: '' }`, origem `pinpad_ack_vazio` |
| Emissão no ciclo CRT | mesmo arquivo | loop de `executarCicloCrt` / `continuarCicloCrt` → `bridge.continuarTransacaoDestaxa(resolucao.resposta, { transactionId })` após `persistirRespostaAntesContinue` + `setImmediate` |
| Adapter produção | `backend/services/tef/adapters/DestaxaRealAdapter.js` | ciclo CRT / `continuarPagamento` → `this.bridge` |
| IPC (produção padrão) | `backend/services/tef/destaxa/DestaxaHostBridge.js` | `continuarTransacaoDestaxa` → operação host `TX_CONTINUE` com `{ resposta: sanitizar(respostaEntrada) }` |
| Native Host | `backend/services/tef/destaxa/DestaxaNativeHost.js` | case `TX_CONTINUE` → `bridge.continuarTransacaoDestaxa(payload.resposta \|\| {})` |
| Bridge nativo | `backend/services/tef/destaxa/DestaxaNativeBridge.js` | `continuarTransacaoDestaxa` → orquestrador |
| Orquestrador DLL | `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js` | `continuarTransacao` → `buildContinuaInput` → `driver.continuaTransacaoDestaxa(entrada.texto)` |
| Serialização Destaxa | `backend/services/tef/destaxa/destaxaProtocolo.js` | `buildContinuaInput` / `buildTransactionInput` |

Correção 51.05 (localização exata): `resolverRespostaContinuidade` + `ehColetaDelegadaAoPinPad` (`destaxaContinuidadeEstados.js`) + liberação `_emExecucao` (`TefManager._liberarSlotExecucaoParaContinuidade`) + `solicitadaEm` (`tef/index.js`) + `setImmediate` antes de TX.

Produção usa **HostBridge/NativeHost** por padrão (`DestaxaRealAdapter.usaHostNativo` = true quando não há loader/resolver injetado).

---

## 2. Evidência do payload vazio até o destino

### 2.1 Preservação no caminho IPC (comprovado estaticamente)

`sanitizar` (`destaxaNativeHostProtocolo.js`) usa `JSON.parse(JSON.stringify(...))`.

Verificação local (somente `require` de protocolo, sem DLL/host):

| Entrada | Após `sanitizar` | `buildContinuaInput` → `texto` DLL |
| --- | --- | --- |
| `{ informacao: '' }` | `{ informacao: "" }` | `""` (chave omitida) |
| `{ displayAck: true }` | — | `""` |

**Conclusão parcial:** o campo `informacao: ''` **não** vira `null`/`undefined` no IPC e **não** é omitido do objeto `resposta` no HostBridge. Chega ao orquestrador como string vazia.

### 2.2 Fronteira DLL (comprovado estaticamente; efeito semântico PENDENTE)

`buildTransactionInput` descarta valores cujo `String(valor).trim()` é vazio:

```js
if (!texto || texto === 'undefined' || texto === 'null') continue;
```

Portanto `{ informacao: '' }` **não** gera `informacao=` na string Destaxa; gera **entrada vazia** (igual ao ack de DISPLAY). Isso coincide com o padrão MRT-50.74 (`resposta = { informacao: '' }` → mesma serialização).

**PENDENTE (não inventado):** se a documentação Destaxa exigir literalmente o par `informacao=` com valor vazio, a serialização atual **não** o produz. Não há evidência operacional nesta sprint que prove ou refute essa exigência.

### 2.3 Destino V$Pague na sessão 09/11 (comprovado por log)

Na tentativa correlacionada (pré-51.05 / sessão 51.03), **não há** qualquer `servico` de continuidade da aplicação comercial após a coleta 99. O V$Pague registra apenas:

- saída de coleta para a AC;
- timeout 120 s “aguardar resposta da aplicação comercial”;
- cancelamento atribuído à AC.

Ou seja: o payload vazio **não chegou** ao V$Pague naquela sessão porque o **TX_CONTINUE não foi emitido** (confirmado em 51.04). A correção 51.05 ataca exatamente esse gap no código CDS; **não** há prova pós-fix de que o CONTINUE chegou à DLL/V$Pague.

---

## 3. Análise do fluxo operacional (estático)

```
PDV → OrquestradorPagamento → TefManager.iniciarPagamento
    → DestaxaRealAdapter (ciclo CRT)
    → DestaxaHostBridge.TX_START
    → NativeHost → DestaxaNativeBridge → DLL iniciaTransacaoDestaxa
    → 99 COLETA (ex.: transacao_cartao_numero)
    → [51.05] resolverRespostaContinuidade → pinpad_ack_vazio
    → persistirRespostaAntesContinue (obrigatório)
    → HostBridge.TX_CONTINUE { resposta: { informacao: '' } }
    → DLL continuaTransacaoDestaxa("")
    → retorno propagado TX_CONTINUE_RESULT → ciclo / TefManager / PDV
```

Pontos de bloqueio que impedem CONTINUE mesmo com 51.05 no fonte:

1. `persistirRespostaAntesContinue` falha / ausente → CONTINUE bloqueado (`TX_CONTINUE bloqueado: persistência…`).
2. Identidade/`solicitadaEm` divergente no hand-off PDV.
3. `_emExecucao` (mitigado em 51.05 se o binário em execução contém o patch).
4. Gate real / permit excepcional ausente no host nativo.
5. Electron main `NOT_RESPONDING` (51.03) — pode impedir o event loop de despachar o CONTINUE mesmo com código correto.

Propagação do retorno V$Pague/DLL: o orquestrador monta a resposta (`_montarRespostaDll`) e o HostBridge devolve `output` ao adapter/ciclo (`TX_CONTINUE_RESULT`). **Caminho de código ok;** na sessão 13:58–14:06 **não houve** CONTINUE para propagar.

---

## 4. Diferenças testes × produção

| Aspecto | Testes 51.05 | Produção (PDV real) |
| --- | --- | --- |
| Bridge | Mock em memória; captura `continues[]` | `DestaxaHostBridge` → NativeHost → DLL |
| `buildContinuaInput` / string DLL | **Não exercitado** pelo mock | Exercitado no orquestrador nativo |
| Persistência antes do CONTINUE | `mockPersistirAntesContinue` sempre ok | SQLite / reserva durável real |
| TefManager `_emExecucao` / IPC Express | Parcial (`solicitadaEm` no index) | Processo Electron + NativeHost |
| V$Pague / PinPad / 120 s | Ausentes | Presentes |
| Cobertura assert | `bridge.continues[0] === { informacao: '' }` | Sem assert operacional pós-51.05 |

**Gap principal:** os testes comprovam que o **ciclo** decide enviar `{ informacao: '' }`; **não** comprovam IPC→DLL→V$Pague nem a serialização final `texto === ''`.

Teste seguro executado nesta sprint: `node tests/tef/tef-destaxa-51-05-continuidade-99.test.js` → **13 ok / 0 falhas** (sem DLL/host/V$Pague).

---

## 5. Timeouts — causa comprovada e hipóteses

### 5.1 Fonte do log

Arquivo nomeado `vspague-client(4).log` **não encontrado** no workspace nem em Downloads/Desktop com esse nome. A timeline pedida bate integralmente com:

`C:\VBI\V$Pague\Client\logs\vspague-client.log`  
(sessão `vspg-id-66c550a0`, 2026-11-09 — **somente leitura**, sem alteração)

### 5.2 Correlação de horários (local UTC−3)

| Horário | Evento (log) |
| --- | --- |
| 13:58:43 | AC `CDS Sistemas` → `iniciar` + `executar` Cartão Vender / Débito / **1.00** |
| 13:58:44–13:59:11 | PinPad COM4; vários **TABELA EXPIRADA** (TLI 020) |
| 13:59:12 | Coleta à AC: `transacao_cartao_numero` — “Aguarde passagem/inserção/aproximação…” (`coletaRetorno:0`) |
| **14:01:12** | **Timeout 120 s** — “aguardar resposta da aplicação comercial”; `coletaRetorno:8` |
| 14:02:06–08 | Cartão processado (CKE/GCR); **VISA ELECTRON** |
| 14:02:10 | Coleta à AC: **AGUARDE A SENHA** (`coletaSequencial:2`) |
| **14:04:10** | **Timeout 120 s** novamente; depois `Transação cancelada pela Aplicação Comercial` (`retorno:9`, `resposta:78`) |
| **14:06:10** | Novo timeout 120 s (`coletaSequencial:4`); novo cancelamento 9/78; `CLO`; transação finalizada |

Nota: o brief da sprint citou “primeiro timeout” em 14:04:10 (fluxo senha). O log contém **também** timeout anterior em **14:01:12** (coleta cartão), alinhado a 13:59:12 + 120 s.

### 5.3 Cancelamento: CDS ou V$Pague?

**Comprovado:** o cancelamento é **gerado/atribuído pelo V$Pague** após timeout interno de 120 s sem resposta da aplicação comercial. Mensagens:

- `Tempo excedido ao aguardar resposta da aplicação comercial (120 segundos)`
- `Transação cancelada pela Aplicação Comercial` / `coletaTransacaoResposta:78`

**Não há** evidência de comando CDS explícito de cancelamento (CRT cancel / `TX_FINALIZE` negativo) nessa janela. A formulação “pela Aplicação Comercial” é a **classificação do V$Pague** para silêncio da AC — coerente com ausência de CONTINUE (51.04).

### 5.4 O timeout de 120 s pode ser causado por resposta não enviada pelo CDS?

**SIM — COMPROVADO** para a sessão 13:58–14:06: V$Pague enviou coleta(s) à AC e não recebeu resposta a tempo → timeout → cancelamento.

### 5.5 Hipóteses ainda não comprovadas (pós-51.05)

| ID | Hipótese | Status |
| --- | --- | --- |
| H1 | Código 51.05 no fonte elimina a ausência de CONTINUE para COLETA PinPad no próximo run | Plausível pelo código; **não homologado operacionalmente** |
| H2 | Processo PDV ainda `NOT_RESPONDING` (PID da 51.03) impede despacho do CONTINUE mesmo com patch | **PENDENTE** (requer inspeção de processo na retomada; não feita aqui) |
| H3 | Persistência durável real falha e bloqueia CONTINUE | **PENDENTE** |
| H4 | Destaxa exige `informacao=` literal e entrada `""` é rejeitada | **PENDENTE** (sem evidência a favor/contra) |
| H5 | TABELA EXPIRADA contribui para atraso, mas **não** explica sozinha o silêncio de 120 s após o 99 | Atraso ~30 s no TX_START **comprovado**; silêncio pós-99 é outro mecanismo |

---

## 6. Integração da correção 51.05

**Classificação: PARCIALMENTE INTEGRADA**

| Critério | Resultado |
| --- | --- |
| Presente no fonte operacional (ciclo, estados, contrato, TefManager, index, PDV continuidade) | Sim |
| Ligada ao caminho HostBridge → NativeHost → orquestrador → DLL | Sim (por composição de módulos) |
| Coberta por testes mock do ciclo | Sim (13/13) |
| Validada com CRT/V$Pague após o patch | **Não** (51.05 e 51.06 sem TX operacional) |
| Sessão de log 13:58–14:06 | **Pré-correção** (diagnóstico 51.04: CONTINUE ausente) |

Não se afirma “integrada em produção homologada” nem “não integrada no código”.

---

## 7. Menor correção necessária (sem implementar nesta sprint)

1. **Se o próximo critério for só comprovar o patch:** homologação operacional controlada **após** processo PDV saudável + auth excepcional expressa — **sem** mudança de código adicional, se CONTINUE for observado no log CDS e o V$Pague deixar de timeoutar na coleta PinPad.
2. **Se H4 for confirmada** (Destaxa exigir `informacao=`): menor fix em `buildTransactionInput` / `buildContinuaInput` para preservar string vazia como `informacao=` — **PENDENTE de confirmação documental/protocolar**.
3. **Não alterar** gate, fiscal, F12, V$Pague, tabelas EMV nesta linha sem sprint própria.

Nenhuma correção foi implementada em 51.06.

---

## 8. Resumo executivo

| # | Entrega | Resultado |
| --- | --- | --- |
| 1 | Arquivo/função de TX_CONTINUE | `destaxaCrtCicloOrquestracao.js` (`resolverRespostaContinuidade` + `bridge.continuarTransacaoDestaxa`); produção via `DestaxaHostBridge` → NativeHost → `destaxaTransacaoOrquestrador.continuarTransacao` |
| 2 | Payload vazio | Preservado no IPC; na DLL vira `texto ""` (não `null`); **não** chegou ao V$Pague na sessão analisada |
| 3 | Fluxo operacional | Cadeia completa rastreada; bloqueios de persistência/identidade/Electron documentados |
| 4 | Testes × produção | Mock para no HostBridge/DLL/V$Pague/persistência real |
| 5 | Timeouts | **Comprovado:** silêncio da AC → 120 s V$Pague → cancel 9/78; cancel atribuído pelo V$Pague |
| 6 | Integração 51.05 | **Parcial** (código sim; homologação operacional não) |
| 7 | Menor correção | Homologar CONTINUE pós-patch; só então considerar serialização `informacao=` se H4 confirmar |

**STATUS FINAL:** diagnóstico estático concluído; sem operação financeira; sem comunicação operacional Destaxa/V$Pague; causa do timeout da sessão 09/11 **comprovada** (falta de resposta da AC); eficácia da 51.05 em produção permanece **PENDENTE** de prova operacional.
