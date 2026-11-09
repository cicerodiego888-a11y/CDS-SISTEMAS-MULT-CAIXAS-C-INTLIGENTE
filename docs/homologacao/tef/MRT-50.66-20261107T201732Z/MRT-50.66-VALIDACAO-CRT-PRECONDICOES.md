# MRT-50.66 — Validação do contrato CRT e pré-condições da operação de débito

**Status: CONCLUÍDA**

Gerado em 2026-11-07T20:17:32Z. Auditoria **estática / somente leitura**. **Sem NativeHost. Sem LOAD DLL. Sem `iniciaClientDestaxa`. Sem `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`. Gate OFF. Sem cobrança. Sem alteração de código, banco, config, perfil ou chave. Sem SEFAZ. Estados UNKNOWN históricos MRT-24/36/42 não tocados.**

Diretório: `docs/homologacao/tef/MRT-50.66-20261107T201732Z`

A autorização única de R$ 1,00 em débito **permanece reservada**. Esta sprint **não autoriza cobrança**.

---

## 1. Arquivos e funções inspecionados

| Área | Arquivos |
| --- | --- |
| Protocolo CRT | `destaxaProtocolo.js` — `buildCrtInput`, `mapearTipoCartaoCrt`, `mapearFormaPagamentoCrt`, `formatarValorDestaxa`, `classificarCodigoTransacao` |
| Adapter | `DestaxaRealAdapter.js` — `prepararAutorizacao`, `autorizarPagamento`, `_resolverValorCentavos`, `_resolverOperacao`, `_mapearResultadoCrt` |
| Bridge / Host | `DestaxaHostBridge.js`, `DestaxaNativeHostClient.js`, `DestaxaNativeBridge.js` — `habilitarTransacaoReal` |
| Ciclo CRT | `destaxaCrtCicloOrquestracao.js` — `executarCicloCrt` |
| Orquestrador | `destaxaTransacaoOrquestrador.js` |
| Constantes / gate | `destaxaConstantes.js` — `transacaoRealHabilitada`, `VALOR_HOMOLOGACAO_CENTAVOS` |
| TefManager | `TefManager.js` — `autorizar`, idempotência, `_continuidadeCrt`, `_autorizacaoEmCurso`, timeout |
| Segurança | `tefFinancialSafetyPolicy.js`, `tefRetryService.js` (`autorizarComRetry` = 1 tentativa), `tefPersistenciaObrigatoria.js` (`classificarIdempotencia`) |
| PDV tipo | `tefFluxoPagamento` via `normalizarTipoTef` em `TefManager.autorizar` |

---

## 2. Caminho do fluxo CRT

```
PDV (tipo=cartao_debito, valor)
  → TefManager.autorizar
       normalizarTipoTef → dados.tipo
       identidade (operation_id / idempotency_key / fingerprint)
       idempotência / pendências / continuidade / lock
       DestaxaRealAdapter.prepararAutorizacao
         valor === 100 centavos; operacao CRT; pinpad/porta; (pode LOAD/INIT)
         buildCrtInput({ tipoPdv, valorCentavos, parcelas })
         se gate OFF → bloqueio DESTAXA_REAL_TRANSACTION_DISABLED (sem TX)
       persistência obrigatória
       DestaxaRealAdapter.autorizarPagamento
         habilitarTransacaoReal()  ← exige DESTAXA_REAL_TRANSACTION_ENABLED=1
         executarCicloCrt
           TX_START → iniciaTransacaoDestaxa(CRT, entrada)
           (99 → TX_CONTINUE)*
           TX_FINALIZE(0) se 00
  → DestaxaHostBridge → DestaxaNativeHostClient → DestaxaNativeHost
  → DestaxaNativeBridge → koffi → DLL
```

**Classificação da modalidade:** PDV → `dados.tipo` → adapter `tipoPdv` → `mapearTipoCartaoCrt` / `mapearFormaPagamentoCrt` → campos CRT. Não há reclassificação débito→crédito no adapter. Coleta `99` permanece disponível para demais campos (senha etc.); modalidade explícita **não** é descartada em favor de coleta genérica de tipo.

---

## 3. Entrada CRT de débito comprovada

Esperado (Destaxa 1.83 docs/06):

```
transacao_valor=1.00;transacao_tipo_cartao=Débito;transacao_pagamento=A vista
```

Evidência estática (`crt-static-assembly.json`): **`debitoOk=true`**.

| Campo | Valor |
| --- | --- |
| Centavos | `100` (`VALOR_HOMOLOGACAO_CENTAVOS`) |
| Formatado | `1.00` (ponto, 2 casas; sem arredondamento indevido) |
| Tipo PDV | `cartao_debito` → `Débito` |
| Forma | `A vista` |
| `operacao=CRT` | parâmetro separado da DLL (não entra na string `entrada`) |

Sem `tipoPdv`, `buildCrtInput` gera só `transacao_valor=1.00` (compatível com coleta 99). Com `cartao_debito`, modalidade é preservada na entrada.

---

## 4. Matriz de cenários de resposta

Ver `matriz-resposta.json`. Síntese:

| # | Cenário | Estado | Venda indevida | Retry |
| --- | --- | --- | --- | --- |
| 1 | Sucesso 00 | CONFIRMED_SUCCESS | não | não |
| 2 | Recusa 03/04/09 | CONFIRMED_DENIED | não | não |
| 3 | Comunicação | UNKNOWN | não | não |
| 4 | Timeout | UNKNOWN/PENDENTE; **≠ cancel** | não | não |
| 5 | Host morto | HOST_ENCERRADO/UNKNOWN | não | não |
| 6 | Resposta ausente | continuidade sem fila | não | não |
| 7 | Duplicada | idempotência | não | não |
| 8 | UNKNOWN | preservar; BLOQUEAR_REENVIAR | não | não |
| 9 | Erro CONTINUE | inconclusivo; sem novo TX_START | não | não |
| 10 | Erro FINALIZE | UNKNOWN conservador | não (sem sucesso limpo) | não |

---

## 5. Proteção contra duplicidade / UNKNOWN

| Mecanismo | Evidência |
| --- | --- |
| Identidade única | `operation_id`, `idempotency_key`, `fingerprint`, `transactionId` |
| RequestId | JSONL NativeHost / logger (por chamada nativa) |
| Idempotência | `classificarIdempotencia` → UNKNOWN/PENDENTE ⇒ `BLOQUEAR_REENVIAR` |
| Lock | `tefLockService.comLock` + `_autorizacaoEmCurso` |
| Continuidade CRT | `_continuidadeCrt` bloqueia segunda cobrança |
| Pendências | `_pendencias` / `TRAVADO_RESULTADO_TARDIO` |
| Ciclo | sem retry de `TX_START`; `retryAllowed: false` |
| Retry service | `autorizarComRetry` = **uma** execução |
| UNKNOWN histórico | MRT-24/36/42 **não processados** nesta sprint |

**Regra:** operação UNKNOWN **não** é reenviada automaticamente nem substituída por nova cobrança.

---

## 6. Gate financeiro

| Item | Achado |
| --- | --- |
| Consulta | `transacaoRealHabilitada()` → `process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '1'` |
| Bloqueio TX | `prepararAutorizacao` retorna `DESTAXA_REAL_TRANSACTION_DISABLED` se gate OFF; `autorizarPagamento` chama `habilitarTransacaoReal()` antes do ciclo |
| Antes de `iniciaTransacaoDestaxa` | **Sim** |
| UI / DB / fallback | Gate **não** é ligado por config persistida; só env |
| NativeHost spawn | Força `'1'` ou `'0'` a partir do ambiente do processo pai |
| User / Machine | Não lidos diretamente pela função; só se herdados no Process |
| Alternativa que ignore gate | Orquestrador/bridge também checam; harnesses de prep exigem gate OFF |

**Ambiente nesta sprint:** Process=`0`, User/Machine vazios → OFF. Gate **não** habilitado.

**Nuance documentada:** `prepararAutorizacao` *pode* carregar DLL e chamar `iniciaClientDestaxa` antes do bloqueio do gate (comentário no próprio adapter). O gate impede as funções **financeiras** (`inicia`/`continua`/`finalizaTransacaoDestaxa`).

---

## 7. Limite da autorização (R$ 1,00 débito, 1 tentativa)

| Restrição | Imposição arquitetural |
| --- | --- |
| Valor R$ 1,00 | `valorCentavos !== 100` → bloqueio |
| Operação CRT | somente CRT em `OPERACOES_REAIS_PERMITIDAS` |
| Ambiente | somente `homologacao` |
| Gate | OFF bloqueia TX |
| Sem retry | `autorizarComRetry` 1×; `retryAllowed=false` |
| Débito / cartão pessoal | **Modalidade** montada se PDV enviar `cartao_debito`; adapter **aceita** também crédito se `tipo` for crédito — limite “somente débito” é **operacional** na sprint de cobrança |
| Sem 2ª tentativa UNKNOWN | idempotência + pendências |

---

## 8. Testes executados (seguros)

| Teste | Resultado | Nativo/financeiro |
| --- | --- | --- |
| Montagem CRT Node (`crt-static-assembly.json`) | **OK** débito | nenhum |
| `tef-destaxa-03-crt-protocolo.test.js` | 22 ok, **3 falhou** | mocks apenas |
| `tef-destaxa-05-financial-safety.test.js` | **15 ok, 0 falhou** | mocks apenas |

Falhas em `tef-destaxa-03` (não corrigidas nesta sprint):

1. CENÁRIO 2 — 99 DISPLAY → continua → 00  
2. CENÁRIO 3 — COLETA → OPÇÃO → 00  
3. continuar sem contexto  

Impacto: caminho mock `adapter.continuarTransacao` / `iniciarTransacao`, **não** a montagem `buildCrtInput` de débito nem o gate. Lacuna registrada; sem correção automática.

---

## 9. Lacunas

1. Três falhas pré-existentes/observadas no suite 03 de continuidade mock.  
2. Gate lê só `process.env`.  
3. `prepararAutorizacao` pode INIT_CLIENT com gate OFF.  
4. Sem hard-block de `cartao_credito` no adapter real (disciplina operacional na cobrança).  
5. Testes legados ainda chamam `buildCrtInput({ valorCentavos: 100 })` sem `tipoPdv` — compatível, mas não cobrem modalidade; cobertura de débito nesta sprint = inspeção + script estático.

---

## 10. Confirmações explícitas

- **Zero** chamadas nativas e financeiras nesta sprint.  
- **Zero** alterações de código, banco, config, perfil ou chave.  
- **Zero** NativeHost / LOAD DLL / SEFAZ.  
- Autorização R$ 1,00 débito **não utilizada**.

---

## 11. Classificação final

**CONCLUÍDA**

Fluxo de débito rastreado; montagem CRT comprovada; contrato de resposta, UNKNOWN, duplicidade e gate documentados; limite de homologação preservado com lacunas explícitas; nenhuma cobrança.

**Parar.** Não iniciar MRT-50.67 automaticamente. Cobrança depende de análise deste relatório e de confirmação explícita imediatamente antes da operação.
