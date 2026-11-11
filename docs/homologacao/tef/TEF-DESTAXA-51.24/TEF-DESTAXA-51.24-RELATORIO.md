# TEF-DESTAXA-51.24 — Auditoria do fluxo oficial Destaxa

**Status:** CONCLUÍDA (somente leitura / testes isolados)  
**Coleta:** 2026-11-10 America/Sao_Paulo  
**Tipo:** Auditoria técnica e conformidade de integração  
**Operação financeira:** **NÃO EXECUTADA**  
**Código de produção:** **NÃO ALTERADO**  
**Homologação operacional:** **NÃO DECLARADA**

---

## 1. Resumo executivo

O pacote oficial Destaxa **1.83** foi localizado em `C:\Users\cicer\Desktop\DLL DESTAXA\1_83-...` (docs + examples clang/dotnet/java). O contrato oficial reconstruído é:

`iniciaClientDestaxa` → `iniciaTransacaoDestaxa` → (`continuaTransacaoDestaxa` enquanto `99`) → dados/`00` (NSU, autorização, comprovantes) → `finalizaTransacaoDestaxa(0|9)`.

O CDS implementa a sequência no ciclo CRT (`destaxaCrtCicloOrquestracao.js`) e preserva a correção **51.20** (`intentCicloAutomaticoContinue`; hash `TefManager.js` = `F9697473…A427C`). Há **confirmação automática** com `confirmacao=0` após `00`.

**Classificação final: PARCIALMENTE CONFORME.**

Etapas estruturais (START → CONTINUE* → FINALIZE(0)) estão alinhadas aos exemplos/docs. Divergências comprovadas: (a) comprovante/NSU/autorização parseados mas **não promovidos** ao contrato de persistência; (b) mapeamento de sucesso usa `resultadoUltimo` (FINALIZE), não `resultadoInicio` (saída `00` com comprovante); (c) retorno `A1` é classificado como `BLOCKED`, mas **não** dispara `finalizaTransacao` como nos exemplos oficiais de `iniciaClientDestaxa`; (d) histórico id=1 permanece UNKNOWN por bloqueio pré-DLL de CONTINUE (pré-51.20), sem confirmação/desfazimento.

---

## 2. Arquivos oficiais encontrados

### 2.1 Instalação empacotada CDS ERP

| Caminho | Conteúdo |
| --- | --- |
| `C:\Program Files\CDS ERP\resources\app.asar.unpacked\resources\tef\destaxa\win-x64\` | **Somente** `libdll-integracao-tef.dll` (136782 bytes) |
| Exemplos / docs neste diretório | **AUSENTES** |

### 2.2 Pacote oficial Destaxa 1.83 (Desktop)

Raiz: `C:\Users\cicer\Desktop\DLL DESTAXA\`

| Item | Caminho |
| --- | --- |
| Pacote 1.83 | `1_83-20260831T165940Z-1-001\1_83\` |
| Docs | `1_83\docs\00` … `10` + `dll-integracao-tef.html` |
| Exemplos C | `1_83\examples\clang\src\main.c`, `destaxa_api.c/h` |
| Exemplos .NET | `1_83\examples\dotnet\Program.cs`, `Destaxa.cs`, `DestaxaApi.cs` |
| Exemplos Java | `1_83\examples\java\...\App.java`, `Destaxa.java` |
| DLLs build | `1_83\build64\libdll-integracao-tef.dll` (+ build32) |
| leia-me | `DLL DESTAXA\leia-me.txt` |

**Não executados.** Apenas lidos.

---

## 3. Referências dos exemplos da DLL

| Fonte | Trecho relevante |
| --- | --- |
| `docs/01-usando-a-dll-fluxo-simples.md` | Após `iniciaTransacao`, chamar `continuaTransacao` enquanto necessário até comprovante/negação; ao final `finalizaTransacao`. |
| `docs/06-api-iniciatransacaodestaxa.md` | `00` → saída com `transacao_nsu`, `transacao_autorizacao`, `transacao_comprovante_1via/2via`; `99` → ações. |
| `docs/07-api-continuatransacaodestaxa.md` | Loop `99`; DISPLAY (`mensagem`); COLETA (`tipo`); OPÇÃO (`opcao`); entrada `informacao=` ou vazia. |
| `docs/08-api-finalizatransacaodestaxa.md` | `confirmacao=0` confirma; `confirmacao=9` cancela/desfaz; após impressão dos comprovantes. |
| `docs/09-tabela-codigos-de-retorno.md` | `00`,`99`,`08`,`A0`,`A1`, denials `03/04/09`, erros `FF/F0/…`. |
| `docs/02-usando-a-dll-fluxo-multi-transacao.md` | Sem multi-transação, nova TX exige confirmação da anterior. |
| `examples/clang/src/main.c` | `while (99) continua…`; em `00` imprime NSU/1via; `ask_and_do_confirmation()` → `finaliza(0\|9)`; **`A1` em `iniciaClientDestaxa`** → confirmação/finalização. |
| `examples/dotnet/Program.cs` / Java `App.java` | Mesmo padrão; `ConfirmTransactionCode=0`, `CancelTransactionCode=9`. |
| `destaxa_api.h` | `#define TRANSACTION_CONFIRM_CODE 0` / `CANCEL_CODE 9`. |

---

## 4. Fluxo oficial reconstruído

```text
iniciaClientDestaxa(entrada)
  ├─ 00 → Client OK
  └─ A1 → finalizaTransacaoDestaxa(0|9)  [exemplos oficiais]

iniciaTransacaoDestaxa(operacao, entrada)
  └─ enquanto resultado == 99:
        AC executa DISPLAY / COLETA / OPCAO
        continuaTransacaoDestaxa(entrada)
  ├─ 00 → saída contém NSU, autorização, comprovantes
  │         → (doc) imprimir comprovantes
  │         → finalizaTransacaoDestaxa(0)  // confirmar
  │            ou finalizaTransacaoDestaxa(9) // cancelar
  ├─ 03/04/09 → negação / cancelamento pelo Client/operador/cliente
  ├─ 08 → timeout
  ├─ A0 → não confirmada corretamente
  └─ A1 → pendência: confirmar/cancelar antes de nova TX
         (resposta verbal Destaxa + tabela 09; exemplos tratam A1 no Client init)

Bloqueio DLL: próxima requisição só após confirmação/desfazimento (modo simples).
```

Códigos de finalização **comprovados** nos docs/exemplos: **`0` = confirmar**, **`9` = cancelar/desfazer**.

---

## 5. Fluxo atual do CDS reconstruído

```text
TefManager.autorizar
  → criarTransacaoExclusiva (bloqueia se já houver pendente)
  → bootstrap segurança (intent TX_START+TX_CONTINUE+TX_FINALIZE)
  → DestaxaRealAdapter.autorizarPagamento
       → gate DESTAXA_REAL_TRANSACTION_ENABLED==1 OU autorização excepcional
       → executarCicloCrt:
            TX_START
            while 99: resolver DISPLAY/PinPad/fila → persistir → TX_CONTINUE
            se 00: TX_FINALIZE(0) automático
            se 03/04/09: retorna NEGADO sem FINALIZE
            se 08/UNKNOWN/A1 residual: inconclusivo, sem FINALIZE
  → TefManager persiste nsu/autorizacao/comprovantes do retorno do adapter
```

Arquivos-chave:

| Arquivo | Papel |
| --- | --- |
| `backend/services/tef/TefManager.js` | Orquestra persistência, bootstrap 51.20, bloqueio de pendência |
| `backend/services/tef/adapters/DestaxaRealAdapter.js` | CRT real + mapeamento de saída |
| `backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js` | Ciclo START/CONTINUE/FINALIZE |
| `backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js` | Chamadas DLL via driver |
| `backend/services/tef/destaxa/DestaxaNativeBridge.js` / `DestaxaNativeHost.js` / `DestaxaHostBridge.js` | Bridge/Host |
| `backend/services/tef/destaxa/destaxaProtocolo.js` | Parse saída / classificação códigos |
| `backend/services/tef/destaxa/destaxaConstantes.js` | Constantes alinhadas à doc 1.83 |
| `backend/services/tef/tefFinancialSafetyPolicy.js` | Política financeira (A1 BLOCKED, sem retry) |
| `backend/services/tef/tefRepository.js` | Persistência `tef_transacoes` |

**Hash `TefManager.js`:** `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` — **MATCH** com referência 51.20. Marcador `intentCicloAutomaticoContinue` presente.

---

## 6. Comparação etapa por etapa

| Etapa | Oficial | CDS | Resultado |
| --- | --- | --- | --- |
| `iniciaTransacao` | CRT + entrada chave=valor | `iniciarTransacaoDestaxa` / TX_START | **CONFORME** (estrutura) |
| Continuidade `99` | `continuaTransacao` até ≠99 | loop TX_CONTINUE (DISPLAY ack / PinPad / fila) + permit 51.20 | **CONFORME** no código atual; histórico id=1 foi **DIVERGENTE** pré-51.20 |
| Identificação comprovante | campos `transacao_*` na saída `00` | `parseParametrosDestaxa` reconhece campos | **PARCIAL** |
| Persistência NSU/auth/via | AC deve obter dados antes de finalizar | Adapter mapeia só `nsu`; não promove autorização/comprovantes; sucesso mapeia `resultadoUltimo` (FINALIZE), não `resultadoInicio` | **DIVERGENTE** |
| Confirmação | `finaliza(0)` após comprovante | auto `FINALIZACAO_CONFIRMAR=0` após `00` | **CONFORME** à orientação verbal de automação; exemplos oficiais pedem confirmação interativa |
| Ordem impressão→confirma | Doc 08: finalizar após impressão | FINALIZE antes de TefManager persistir/imprimir | **DIVERGENTE** (ordem) |
| Desfazimento | `finaliza(9)` | `FINALIZACAO_CANCELAR=9` + política TEF-17; ciclo CRT não chama 9 no path automático de sucesso | **CONFORME** nos parâmetros; uso operacional **NÃO COMPROVADO** em CRT |
| `A1` | confirmar/cancelar pendência | classifica BLOCKED, sem retry; **sem** auto-finalize | **DIVERGENTE** vs exemplos Client |
| Nova TX com pendência | DLL bloqueia; CDS também | `criarTransacaoExclusiva` + trava memória | **CONFORME** (camada CDS) |
| Timeout / crash | estado inconclusivo | `fecharInconclusivo`, UNKNOWN, sem retry | **CONFORME** (política CDS) |

---

## 7. Tratamento do comprovante

**Oficial:** em `resultado=00`, `saida` traz `transacao_nsu`, `transacao_autorizacao`, `transacao_comprovante_1via`, `transacao_comprovante_2via`, etc. (`docs/06`).

**CDS:**

1. `parseParametrosDestaxa` extrai esses campos.
2. `DestaxaRealAdapter._mapearResultadoCrt` define `nsu: parametros.transacao_nsu`, mas **não** preenche `autorizacao`, `comprovanteCliente`, `comprovanteLoja` a partir de `parametros`.
3. No sucesso do ciclo, `_mapearSaidaCiclo` usa `ciclo.resultadoUltimo` (retorno de **FINALIZE**). O objeto `resultadoInicio` (saída `00` com comprovante) é emitido pelo orquestrador **mas não é consumido** no mapeamento.
4. `TefManager` persiste `nsu`/`autorizacao`/`comprovantes` do retorno do adapter — que tendem a ficar `null` mesmo após `00` bem-sucedido.

Evidência: teste isolado 51.24 #8–#9; grep estático `resultadoInicio` só em `destaxaCrtCicloOrquestracao.js`.

---

## 8. Tratamento da confirmação automática

| Item | Achado |
| --- | --- |
| Existe? | **Sim** — `prosseguirCicloAposResultado` após `ehSucessoConclusivo` |
| Evento disparador | Código/classificação de sucesso (`00` / SUCCESS) após loop de `99` |
| Código | `FINALIZACAO_CONFIRMAR = 0` |
| Vinculação | Mesmo `transactionId` / bridge do ciclo |
| Duplicidade | Orquestrador bloqueia nova TX se contexto ativo/UNKNOWN; finalize one-shot no ciclo |
| Falha na confirmação | `fecharInconclusivo` → reconciliacaoObrigatoria; não marca aprovado silencioso se host/inconclusive |
| Gap | FINALIZE ocorre **antes** da promoção/persistência dos campos de comprovante |

Alinha-se à resposta verbal Destaxa (“enviar automaticamente a confirmação” após dados/comprovante). Exemplos oficiais usam prompt interativo `(s/n)`.

---

## 9. Tratamento do desfazimento

| Fonte | Comportamento |
| --- | --- |
| Oficial | `finalizaTransacaoDestaxa(9)` cancela corrente / pendentes (modo multi: todas) |
| CDS constantes | `FINALIZACAO_CANCELAR = 9` |
| CDS ciclo CRT | Path negado **não** chama finalize; path sucesso chama só `0` |
| TEF-17 | Distingue abort (`9`) de estorno comercial `EST` (bloqueado sem campos oficiais) |
| UNKNOWN | Orquestrador recusa finalize/continue se `financialState` UNKNOWN — protege id=1 de finalização indevida pelo orquestrador |

Separação 0 vs 9: **inequívoca** no código. Finalização automática de UNKNOWN: **não** observada no fluxo CRT.

---

## 10. Tratamento do retorno A1

| Camada | Comportamento |
| --- | --- |
| Oficial (tabela 09) | Existem transações não confirmadas; confirmar ou cancelar antes de novas |
| Exemplos | Em **`iniciaClientDestaxa`**, se `A1` → `ask_and_do_confirmation()` → `finaliza(0\|9)` |
| Resposta verbal Destaxa | Nova `iniciaTransacao` pode retornar `A1`; então finalizar com código correspondente |
| CDS `destaxaProtocolo` | `A1` → classificação `BLOCKED`, estado `BLOCKED` |
| CDS `tefFinancialSafetyPolicy` | `BLOCKED`, `TEF_A1_BLOCKED_NO_RETRY` |
| CDS ciclo CRT | Sem branch `A1`; cai em inconclusivo se não for 99/00/negado |
| CDS `iniciaClientDestaxa` | Retorna erro de init se ≠00; **não** chama `finalizaTransacaoDestaxa` em A1 |

**Gap:** reconhecimento de pendência existe; **liberação via finalize após A1 não está implementada** como nos exemplos.

---

## 11. Matriz de conformidade

| Cenário | Esperado (oficial) | Encontrado no CDS | Arquivo/função | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- |
| Início normal | `iniciaTransacaoDestaxa` | TX_START via bridge/orquestrador | `executarCicloCrt`, `iniciarTransacao` | **CONFORME** | código + docs/06 |
| Continuidade normal | `continuaTransacao` após 99 | TX_CONTINUE + permit 51.20 | `prosseguirCicloAposResultado`, bootstrap | **CONFORME** (código atual) | 51.20 hash + testes 51.19/51.05 |
| Recebimento comprovante | extrair NSU/auth/vias | parse OK; promoção incompleta | `_mapearResultadoCrt` | **DIVERGENTE** | teste 51.24 #9 |
| Confirmação normal | `finaliza(0)` | auto FINALIZE(0) após 00 | `prosseguirCicloAposResultado` | **CONFORME** (automação) | docs/08 + código |
| Falha na confirmação | pendência permanece | inconclusivo / reconciliacao | `fecharInconclusivo` | **CONFORME** | código |
| Retorno A1 | finalize 0/9 | classifica BLOCKED; sem finalize | protocolo + ciclo | **DIVERGENTE** | exemplos main.c vs CDS |
| Desfazimento | `finaliza(9)` | constante 9; path CRT não auto-desfaz | `FINALIZACAO_CANCELAR`, TEF-17 | **NÃO COMPROVADO** (CRT) | docs/08 |
| Timeout | inconclusivo | UNKNOWN, sem retry, sem cancel implícito | `ehInconclusivo`, policy | **CONFORME** | testes 51.05/51.23 |
| Encerramento inesperado | recuperação segura | pendente + trava + reconciliação explícita | `TefManager` / 51.23 | **CONFORME** (política) | relatório 51.23 |
| Nova req com pendência | bloqueio | `criarTransacaoExclusiva` + trava | `tefRepository`, `TefManager` | **CONFORME** | teste 51.24 #12; readonly id=1 |

---

## 12. Testes executados e resultados

Somente isolados / mocks. **Sem** DLL operacional, NativeHost real, V$Pague, COM4, PinPad ou CRT.

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-24-auditoria-fluxo.test.js` | **14/14 OK** |
| `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` | **16/16 OK** |
| `tests/tef/tef-destaxa-51-05-continuidade-99.test.js` | **13/13 OK** |
| `tests/tef/tef-destaxa-51-23-reconciliacao-matriz.test.js` | **12/12 OK** |

Gate verificado via `inspecionarGateFinanceiro()`: **OFF**.

---

## 13. Divergências identificadas

1. **Promoção incompleta de comprovante/autorização** no adapter após `00`.
2. **`resultadoInicio` ignorado** no mapeamento de sucesso (risco de perder NSU/vias após FINALIZE).
3. **Ordem doc 08**: CDS confirma na DLL antes de persistir/imprimir comprovantes na aplicação.
4. **`A1` sem fluxo de finalização** equivalente aos exemplos (`iniciaClient` / orientação verbal).
5. **Path negado (03/04/09)** não chama `finalizaTransacao` — comportamento dos exemplos também retorna erro sem finalize; classificação **NÃO COMPROVADO** se a DLL exige finalize após negação.
6. **Histórico id=1**: CONTINUE bloqueado por segurança pré-51.20 → sem comprovante, sem finalize → UNKNOWN residual (não é bug do código atual, mas evidência do gap operacional).

---

## 14. Riscos técnicos e financeiros

| Risco | Impacto |
| --- | --- |
| TX aprovada na Destaxa sem FINALIZE no CDS | Pendência DLL / `A1` / bloqueio de novas TX |
| FINALIZE(0) sem NSU/comprovante persistidos | Conciliação fiscal/local impossível; venda sem evidência |
| Auto-confirm sem dados no DB | Confirmação financeira sem espelho documental local |
| Tratamento A1 incompleto | Loop operacional: Client recusa novas TX até intervenção manual |
| Operação id=1 UNKNOWN | Risco financeiro residual até resposta formal Destaxa + sprint autorizada |
| Retry indevido | Mitigado: policy `retryAllowed=false` para 00/99/08/A0/A1 |

---

## 15. Correções recomendadas (futura sprint — **não implementar agora**)

1. Em `_mapearResultadoCrt` / `_mapearSaidaCiclo`: promover `transacao_autorizacao`, `transacao_comprovante_1via/2via` (e preferir `resultadoInicio`/`saida` do `00`) **antes** de considerar sucesso persistível.
2. Persistir NSU/autorização/comprovantes **antes** de `TX_FINALIZE(0)`, ou garantir que a saída `00` seja preservada através do FINALIZE.
3. Implementar tratamento explícito de `A1` (Client init e/ou TX_START) alinhado aos exemplos: identificar pendência → UI/reconciliação → `finaliza(0|9)` **somente com autorização de escopo** (nunca para id=1 sem decisão formal).
4. Definir se path `03/04/09` exige `finaliza(9)` — consultar Destaxa se docs/exemplos forem ambíguos.
5. Teste de integração mock: sequência START(99)→CONTINUE→00→persistência→FINALIZE(0) com asserts de campos.
6. Manter gate OFF até autorização explícita de nova sprint de correção/homologação.

---

## 16. Confirmação: nenhuma operação financeira executada

- Não houve CRT, débito, crédito ou PIX reais.
- Não houve chamada a `iniciaTransacao` / `continuaTransacao` / `finalizaTransacao` contra ambiente real.
- NativeHost / DLL / V$Pague / COM4 / PinPad **não** inicializados por esta sprint.
- Exemplos oficiais **não** executados.

---

## 17. Confirmação: operação `id=1` intacta e UNKNOWN

Leitura **readonly** em `C:\ProgramData\MercantilFiscal\dados\mercadao.db` (2026-11-10):

| Campo | Valor |
| --- | --- |
| id | 1 |
| status | `pendente` |
| valor | 1 |
| tipo | `cartao_debito` |
| provedor | `destaxa` |
| nsu | **null** |
| autorizacao | **null** |
| idempotency_key | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| venda_id | **null** |
| criado_em / atualizado_em | `2026-11-09 16:58:43` / `2026-11-09 16:59:12` (inalterados) |
| pendentesCount | 1 (somente id=1) |

Classificação financeira documental: **UNKNOWN** (sem NSU/autorização; sem confirmação/desfazimento).  
**Nenhuma** confirmação, desfazimento, cancelamento, reconciliação, retry ou liberação executada nesta sprint.

---

## 18. Confirmação: gate permanece OFF

```json
{
  "env": "DESTAXA_REAL_TRANSACTION_ENABLED",
  "raw": null,
  "normalizado": "",
  "habilitado": false,
  "ambiguo": false
}
```

Process / User / Machine env vazios. `transacaoRealHabilitada() === false`.

---

## Classificação final

### **PARCIALMENTE CONFORME**

- **Conforme:** sequência START → CONTINUE* → FINALIZE(0); códigos 0/9; classificação 99/00/08/A1; bloqueio de nova TX com pendência CDS; preservação 51.20; política sem retry.
- **Divergente:** promoção/persistência de comprovante; uso de `resultadoUltimo` vs saída `00`; tratamento A1 sem finalize; ordem confirmação vs impressão/persistência.
- **Não declarar homologação operacional.**

**FIM DA SPRINT 51.24.**
