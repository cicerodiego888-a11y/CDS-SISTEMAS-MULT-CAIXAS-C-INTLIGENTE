# MRT-50.68 — Pré-voo final da homologação Destaxa

**Status: CONCLUÍDA** · **Parecer: APTO COM RESSALVAS**

Gerado em 2026-11-07T20:39:05Z. Pré-voo técnico e de segurança **sem cobrança**. Gate OFF. Uma inicialização de Client. NativeHost encerrado. **Zero** `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`. Sem alteração de banco (exceto leitura), config, perfil ou chave. Sem SEFAZ. UNKNOWN históricos MRT-24/36/42 intactos.

Diretório: `docs/homologacao/tef/MRT-50.68-20261107T203905Z`

A autorização única de R$ 1,00 em débito **permanece reservada e não utilizada**. Esta sprint **não autoriza** a cobrança.

---

## 1. Resultado por verificação

| # | Verificação | Resultado |
| --- | --- | --- |
| 1 | Integridade arquivos MRT-50.67 | **OK** — 7/7 presentes; marcadores de correção confirmados |
| 2 | DLL Destaxa + SHA-256 | **OK** — `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |
| 3 | PPC-930 Windows COM4 | **OK** — `PPC-920/930 CDC USB-to-Serial Port (COM4)`, Status OK, VID 1753 / PID C902 |
| 4 | `tef_pinpads.porta_com` | **OK** — `COM4` (id=1, GERTEC_PPC930, provedor destaxa); leitura `mode=ro`, sem gravação |
| 5 | V$Pague | **OK** — PID `44484`, `C:\VBI\Java\bin\VSPagueClient.exe`; 60603/60906 LISTENING |
| 6 | `iniciaClientDestaxa` (1×) | **OK** — `00` / `CLIENT_INITIALIZED` |
| 7 | Encerramento NativeHost | **OK** — `STOPPED`, `stoppedConfirmed`, residual 0 |

---

## 2. Integridade MRT-50.67 (hashes SHA-256)

| Arquivo | SHA-256 (prefixo) | Markers |
| --- | --- | --- |
| `DestaxaRealAdapter.js` | `C032B4F1…` | continuar + homolog |
| `destaxaConstantes.js` | `37037C6E…` | modalidade + inspecionarGate |
| `destaxaHomologacaoDebitoPolitica.js` | `AD913A87…` | validar |
| `destaxaCrtCicloOrquestracao.js` | `F58A92ED…` | gateCiclo |
| `DestaxaNativeBridge.js` | (presente) | — |
| `DestaxaNativeHostClient.js` | (presente) | — |
| `mrt-50-67-homologacao-debito-gate.test.js` | (presente) | — |

Detalhe completo: `preflight.json`.

---

## 3. Inicialização do Client

| Campo | Valor |
| --- | --- |
| Classificação | `RETURNED_SUCCESS` |
| NativeHost PID | `76672` |
| Parent PID | `76860` |
| RequestId | `030eff038fd8bb5c` |
| Código | **`00`** |
| Estado | **`CLIENT_INITIALIZED`** |
| `iniciaClientDestaxa` enter/return | 1 / 1 |
| Chamadas financeiras nativas | **0** |
| Shutdown | `STOPPED` / não forçado / não adiado |
| Exit parent | `0` |

Gate antes e depois: Process=`0`, User/Machine vazios → **OFF**.  
Integridade Local State / chave / DLL: **inalterados** (`hashes-pre` = `hashes-pos`).

---

## 4. Política financeira (sem cobrança)

Validação estática + suite `mrt-50-67-homologacao-debito-gate` → **13/13**.

| Regra | Evidência |
| --- | --- |
| Somente `cartao_debito` | `validarContextoHomologacaoDebito` OK |
| Valor R$ 1,00 | 100 centavos; CRT `transacao_valor=1.00;…Débito;…A vista` |
| Ambiente homologação | exigido pela política |
| Crédito bloqueado | `DESTAXA_MODALIDADE_NAO_PERMITIDA` |
| Outros valores bloqueados | `DESTAXA_VALOR_NAO_PERMITIDO` |
| Modalidade ausente/genérica | bloqueada |
| Gate OFF | `habilitado=false`; `habilitarTransacaoReal` recusa |
| TX_START / CONTINUE / FINALIZE | **não chamados** (JSONL: 0 `native.call.enter` financeiros) |

Artefatos: `politica-estatica.json`, `politica-testes.log`.

---

## 5. Segurança

| Controle | Estado |
| --- | --- |
| Duplicidade / idempotência UNKNOWN | Preservado (`BLOQUEAR_REENVIAR`) — coberto no teste 50.67 |
| Retry financeiro | Uma tentativa / `retryAllowed=false` |
| Históricos MRT-24/36/42 | **Não tocados** |
| Perfil / chave | Hashes estáveis |
| SEFAZ / fiscal | Não executado |
| Banco | Somente leitura `porta_com` |

---

## 6. Comunicação com a PinPad (investigação)

| Evidência | Observado | Prova de handshake PinPad? |
| --- | --- | --- |
| Windows reconhece PPC-930 COM4 OK | Sim | **Não** |
| Cadastro CDS `porta_com=COM4` | Sim | **Não** |
| V$Pague processo + TCP 60603/60906 | Sim | **Não** |
| `iniciaClientDestaxa` → 00 | Sim | **Não** |
| Coleta/Display 99 no terminal / log PinPad | **Não obtido** | — |

**Lacuna formal:** não há evidência de comunicação efetiva com a PinPad nesta sprint. Processo ativo, porta TCP e init da DLL **não** equivalem a handshake PinPad (alinhado à MRT-50.60: Destaxa 1.83 sem API não financeira de PinPad).

**Próximo diagnóstico (sem TX nesta sprint):** na sprint de cobrança **explicitamente autorizada**, observar no JSONL/retorno a interação PinPad (DISPLAY/COLETA `99`) durante o único CRT débito R$ 1,00. **Não** iniciar TX apenas para descobrir conectividade.

---

## 7. Testes executados

| Teste | Resultado | Nativo/financeiro |
| --- | --- | --- |
| Pré-voo ambiente + DB RO | OK | nenhum |
| `mrt-50-67-homologacao-debito-gate` | 13/13 | mocks apenas |
| Montagem CRT estática | OK | nenhum |
| Init Client NativeHost 1× | `00` + STOPPED | só `iniciaClientDestaxa` |

---

## 8. Pendências técnicas

1. **Ressalva PinPad:** comunicação efetiva não comprovada sem interação CRT.  
2. Cobrança R$ 1,00 exige **confirmação explícita** imediata + gate ON **somente** na sprint de execução.  
3. Nova sessão NativeHost será necessária na sprint de cobrança (esta encerrou em STOPPED).

---

## 9. Parecer final

**APTO COM RESSALVAS**

Apto sob o ponto de vista de integridade 50.67, DLL, COM4 (Windows + cadastro), V$Pague, política de débito R$ 1,00, gate OFF, init Client `00` e shutdown limpo, **sem** operação financeira.

Ressalva: ausência de prova de comunicação efetiva com a PinPad (não sanável sem TX/coleta, proibida aqui).

**Parar.** Não iniciar cobrança automaticamente. A autorização única previamente reservada permanece não utilizada.
