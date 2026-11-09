# MRT-50.61 — Preparação da homologação TEF com PinPad PPC-930

**Status: CONCLUÍDA**

Gerado em 2026-11-07T19:43:25Z. Somente revisão estática e pré-voo ambiental. **Nenhuma transação financeira. Gate OFF. Nenhuma chamada a `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`. Sem comandos ao PinPad. Sem abertura do banco oficial. Sem SQLite temporário. Sem SEFAZ.**

A autorização de uma única tentativa de R$ 1,00 em débito **permanece reservada** e **não foi usada**.

Diretório: `docs/homologacao/tef/MRT-50.61-20261107T194325Z`

## 1. Arquivos inspecionados

### Código CDS
- `backend/services/tef/destaxa/DestaxaNativeBridge.js`
- `backend/services/tef/destaxa/DestaxaNativeHostClient.js`
- `backend/services/tef/destaxa/DestaxaNativeHost.js`
- `backend/services/tef/destaxa/DestaxaHostBridge.js`
- `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js`
- `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js`
- `backend/services/tef/destaxa/destaxaProtocolo.js`
- `backend/services/tef/destaxa/destaxaConstantes.js`
- `backend/services/tef/destaxa/destaxaKoffiLoader.js`
- `backend/services/tef/adapters/DestaxaRealAdapter.js`
- `backend/services/tef/TefManager.js`
- `backend/services/tef/tefRetryService.js`
- `backend/services/tef/tefFinancialSafetyPolicy.js`
- `backend/services/tef/pinpads/GertecPPC930.js`

### Documentação oficial Destaxa 1.83
- `...\1_83\docs\04-interface-dll-ac.md`
- `...\1_83\docs\05-api-iniciaclientdestaxa.md`
- `...\1_83\docs\06-api-iniciatransacaodestaxa.md`
- `...\1_83\docs\07-api-continuatransacaodestaxa.md`
- `...\1_83\docs\08-api-finalizatransacaodestaxa.md`
- `...\1_83\docs\09-tabela-codigos-de-retorno.md`

### Observação sobre PaymentTerminalManager
Não existe classe/arquivo `PaymentTerminalManager` no repositório. O caminho operacional real é **TefManager → DestaxaRealAdapter → DestaxaHostBridge → DestaxaNativeHostClient → DestaxaNativeHost → DestaxaNativeBridge → koffi → DLL**.

## 2. Fluxo real da integração

```
1. TefManager.autorizar
   ├─ idempotência / pendências / continuidade CRT / autorização em curso
   ├─ DestaxaRealAdapter.prepararAutorizacao (gate ainda OFF → não TX)
   ├─ persistência obrigatória da identidade (operation_id / transactionId / fingerprint)
   └─ DestaxaRealAdapter.autorizarPagamento
2. bridge.habilitarTransacaoReal()  → exige DESTAXA_REAL_TRANSACTION_ENABLED=1
3. LOAD DLL (se necessário) + INIT_CLIENT (se Client não inicializado na sessão)
4. destaxaCrtCicloOrquestracao.executarCicloCrt
   ├─ TX_START → iniciaTransacaoDestaxa(operacao, entrada, …)
   ├─ se resultado 99 → TX_CONTINUE → continuaTransacaoDestaxa (PinPad via Client/V$Pague)
   └─ se 00 conclusivo → TX_FINALIZE(0) → finalizaTransacaoDestaxa
5. Comunicação PinPad: mediada pelo V$Pague Client Background (não há API de PinPad na DLL)
6. Timeout operacional no TefManager: responde UNKNOWN/PENDING ao chamador; não cancela a DLL
7. Encerramento NativeHost: adiado se operação nativa em voo; STOPPED só com evidência limpa
```

## 3. Assinatura oficial e parâmetros (débito R$ 1,00)

### `iniciaTransacaoDestaxa` (docs/06)

```
void iniciaTransacaoDestaxa(
  char *resultado,
  const char *operacao,
  char *entrada,
  int tamanho_entrada,
  char *saida,
  int *tamanho_saida);
```

| Campo | Valor documentado para a tentativa autorizada |
| --- | --- |
| `operacao` | `CRT` (compra com cartão) |
| Modalidade débito | `transacao_tipo_cartao=Débito` (entrada) |
| Forma de pagamento | `transacao_pagamento=A vista` (entrada; documentado) |
| Valor | `transacao_valor=1.00` (exemplo oficial usa ponto e 2 casas; 100 centavos → `1.00` no CDS) |

Entrada mínima montada hoje por `buildCrtInput`:

```
transacao_valor=1.00
```

Comentário explícito em `destaxaProtocolo.js`: tipo de cartão e forma de pagamento são deixados para o Client solicitar via retorno `99`. Isso é **compatível** com a doc (entrada opcional), mas **não força débito** na primeira chamada.

Parâmetros de estabelecimento/loja/terminal: opcionais em `iniciaClientDestaxa` (docs/05); não são parâmetros de `iniciaTransacaoDestaxa`. Operador CDS não aparece na API Destaxa 1.83 inspecionada.

### Continuação e finalização
- `continuaTransacaoDestaxa` enquanto `resultado=99` (ações Display/Coleta/Opção; senha no PinPad via Client).
- `finalizaTransacaoDestaxa(resultado, confirmacao)` com `0` confirmar / `9` cancelar (docs/08).

### Códigos de retorno relevantes (docs/09)
`00` sucesso · `99` ação · `03`/`04`/`09` cancelamentos · `08` timeout · `F0` sequência inválida · `F1` comunicação Client · `A0`/`A1` não confirmadas.

## 4. Timeout, UNKNOWN e anti-duplicidade

| Controle | Evidência | Avaliação |
| --- | --- | --- |
| Identificador único | `transactionId` (orquestrador/TefManager) + `operation_id` / `idempotency_key` / `fingerprint` | Presente |
| Bloqueio 2ª tentativa | Idempotência; pendências; `_continuidadeCrt`; `_autorizacaoEmCurso`; identidades UNKNOWN bloqueadas no Host | Presente |
| Operação em andamento | `_emVoo` / `HOST_BUSY` no Client; `_operacaoAtiva` no Host; `ESTADOS_BLOQUEIAM_NOVA` no orquestrador | Presente |
| JSONL / logs | `destaxaLogger` + instrumentação MRT-50.56 | Presente |
| Timeout | APIs transacionais **sem** timeout IPC padrão (`DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO`); TefManager usa timeout operacional → UNKNOWN sem cancelar DLL | Presente / documentado |
| UNKNOWN preservado | `financialState=UNKNOWN`, reconciliação pendente, `retryAllowed=false` | Presente |
| Retry automático financeiro | `tefRetryService.autorizarComRetry` executa **uma** vez; Destaxa retorna `retryAllowed: false`; ciclo CRT não repete `TX_START` | Presente |
| Encerramento NativeHost | Adiado com nativa em voo; não mata chamada | Presente |

## 5. Pré-condições ambientais (sem pagamento)

| Item | Estado observado |
| --- | --- |
| PPC-930 | COM4 — `PPC-920/930 CDC USB-to-Serial Port (COM4)`, OK |
| V$Pague | `VSPagueClient.exe` PID `44484`; 60603/60906 LISTENING |
| DLL SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |
| Gate | Process=`0`, User/Machine vazios → **OFF** |
| NativeHost prévio | nenhum |
| Local State / chave | hashes iguais à baseline MRT-50.58/59 |
| Banco oficial | **não aberto** nesta sprint |

## 6. Lacunas impeditivas para a *próxima* execução (não desta sprint)

1. **Gate OFF por design** — a cobrança exige etapa futura com confirmação explícita e `DESTAXA_REAL_TRANSACTION_ENABLED=1` apenas durante aquela execução.
2. **Débito não fixado na entrada CRT atual** — `buildCrtInput` envia só `transacao_valor=1.00`. Para a tentativa autorizada em débito, a etapa de execução deve decidir se inclui `transacao_tipo_cartao=Débito` (campo oficial) ou aceita coleta via `99` no PinPad.
3. **Porta configurada vs Windows** — MRT-50.60/61 veem COM4; evidência histórica TEF-PPC930-05 tinha `porta_com=COM3`. A config persistida **não foi lida** (banco oficial proibido aqui); deve ser confirmada antes da cobrança.
4. **Sessão NativeHost nova** — o Host da MRT-50.59 encerrou em `STOPPED`; a execução exigirá novo bootstrap + Client init naquela sessão (sem reutilizar processo morto).
5. **`PaymentTerminalManager` inexistente** — usar o caminho TefManager/adapter documentado acima.

## 7. Testes executados

- Revisão estática do código e da documentação 1.83.
- Pré-voo ambiental (hash DLL, gate, V$Pague, COM4, NativeHost ausente, hashes do perfil/chave).
- Nenhuma chamada de pagamento, nenhuma simulação liquidável, nenhum teste de unidade alterado.

## 8. Evidências

- `MRT-50.61-PREPARACAO-HOMOLOGACAO.md`
- `mrt-50.61-resultado.json`
- `preflight-ambiente.json`
- `observability.jsonl`

## 9. Próxima etapa

**Parar.** Aguardar decisão do usuário.

A execução da única tentativa de R$ 1,00 em débito deve ser sprint separada, com confirmação explícita imediatamente antes da chamada financeira.
