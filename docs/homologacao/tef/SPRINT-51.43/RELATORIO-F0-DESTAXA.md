# SPRINT 51.43 — Diagnóstico F0 na inicialização Destaxa

**Data:** 2026-11-10  
**Natureza:** somente leitura — **sem correção**, sem CRT/DLL/NativeHost/reinício V$Pague, sem novo permit, sem escrita em TX 2/3 ou venda 66.  
**Mensagem observada no PDV:** `iniciaClientDestaxa não retornou 00/CLIENT_INITIALIZED: F0`

---

## 1. Veredito

| Dimensão | Conclusão |
| --- | --- |
| **Causa raiz comprovada (1ª tentativa)** | `iniciaClientDestaxa` retornou **`A1`** — Destaxa: *existem transações não confirmadas* |
| **F0 observado (2ª/3ª tentativas)** | Rechamadas de `INIT_CLIENT` após A1 → Destaxa **`F0`** (*chamada de API inválida / sequência errada*) |
| **Transação financeira nova** | **Não criada** (`tef_transacoes` max id permanece **3**) |
| **TX_START / CRT** | **Não executados** nesta janela |
| **NSU / autorização novos** | **Não** |
| **Classificação** | Falha **confirmada de inicialização** (`FALHA_CONFIRMADA` no lease) — **não** UNKNOWN de cobrança |

O texto de UI com **F0** corresponde às tentativas **21:45:55Z** e **21:46:37Z**. A primeira falha da série (**21:44:57Z**) foi **A1**, evidência mais precisa do estado Destaxa.

---

## 2. Significado contratual de F0 / A1

Fonte CDS: `backend/services/tef/destaxa/destaxaConstantes.js` (tabela Destaxa 1.83 / `docs/09-tabela-codigos-de-retorno.md`).

| Código | Descrição oficial no CDS | Classificação CDS |
| --- | --- | --- |
| **A1** | Existem transações não confirmadas. É necessário confirmar ou cancelar antes de iniciar novas. | `BLOCKED` |
| **F0** | A chamada à API é inválida. Pode ocorrer ao chamar alguma API na sequência errada. | `ERROR` |
| **00** | API executada com sucesso / `CLIENT_INITIALIZED` | sucesso |

Tratamento no código:

- `DestaxaNativeBridge.iniciarClient` → chama export `iniciaClientDestaxa`, interpreta código, marca `CLIENT_ERROR` se ≠ 00.
- `DestaxaRealAdapter` (pré-condição): se `clientInitializationCode !== 00`, bloqueia com a mensagem vista no PDV:  
  `iniciaClientDestaxa não retornou 00/CLIENT_INITIALIZED: ${codigo}`.

---

## 3. Contexto da chamada e timeline

**Último INIT_CLIENT bem-sucedido:** `2026-11-10T20:26:06.562Z` → **00** (Host PID **9260**, PPID **5700**) — sessão da CRT TX 3.

**ERP atual:** Electron PPID **12832** desde ~18:43 local; NativeHost utility **PID 14688**.  
**V$PagueClient:** PID **20760** desde 15:36:59; listener **`:60906`** ativo.

| UTC | Local≈ | Evento | Código |
| --- | --- | --- | --- |
| 21:44:57 | 18:44 | LOAD + `INIT_CLIENT` / `iniciaClientDestaxa` | **A1** |
| 21:44:57 | 18:44 | Lease `lease_85cf…` liberado `FALHA_CONFIRMADA` | `tef_logs.id=40` (`transacao_id=null`) |
| 21:45:55 | 18:45 | `INIT_CLIENT` / `iniciaClientDestaxa` | **F0** |
| 21:45:55 | 18:45 | Lease `lease_445b…` `FALHA_CONFIRMADA` | `tef_logs.id=41` |
| 21:46:37 | 18:46 | `INIT_CLIENT` / `iniciaClientDestaxa` | **F0** |
| 21:46:37 | 18:46 | Lease `lease_9291…` `FALHA_CONFIRMADA` | `tef_logs.id=42` |

RequestIds F0: `4c74eeeece0e5e98`, `1487ed54e5eff4c1`.  
RequestId A1: `1a83ad933cc4fb7b`.

Não há `native.call` de `iniciaTransacaoDestaxa` / `TX_START` nesta janela (apenas blocos de diagnóstico de `iniciaClientDestaxa`).

---

## 4. Ligação com a TX 3 (evidência histórica)

A CRT da TX **id=3** (venda 66) obteve Destaxa **00** (NSU 2338 / auth 211139), mas o CDS **não concluiu `TX_FINALIZE(0)`** (bootstrap/permit — SPRINT 51.41). A TX 3 foi regularizada **administrativamente** no CDS (51.42 → `aprovado`), **sem** chamada Destaxa de confirmação/desfazimento.

Hipótese **fortemente suportada** pelos logs:

1. Do ponto de vista Destaxa/V$Pague, permanece pendência de **confirmação** da operação aprovada → **A1** na 1ª `iniciaClientDestaxa` após novo Host.
2. Retentativas de `INIT_CLIENT` com o Client já em estado de erro/bloqueio → **F0** (sequência inválida).
3. CDS aborta em pré-condição → **não** abre CRT / **não** grava nova `tef_transacoes`.

---

## 5. Logs consultados

| Fonte | Achado |
| --- | --- |
| `%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl` | Sequência LOAD→INIT; A1 depois F0; Host 14688 / pai 12832 |
| `C:\VBI\V$Pague\Client\logs\vspague-client.log` | Sem ciclo financeiro novo às 18:44–18:46; às **18:42:32** *Connection breaked* em `:60906`; às **18:46:29** tentativa de 2º Client: *Application already running / Address already in use* (porta 60603) |
| `tef_logs` id 40–42 | Apenas leases `FALHA_CONFIRMADA`, `transacao_id=null` |

---

## 6. Tentativa vs banco oficial (readonly)

| Checagem | Resultado |
| --- | --- |
| `MAX(tef_transacoes.id)` | **3** (inalterado) |
| Nova linha TEF | **Não** |
| Novos `tef_logs` de INICIO/CICLO_CRT/RETORNO financeiro | **Não** (só MRT06_LEASE 40–42) |
| NSU/autorização novos | **Não** |
| TX 2 | `negado` — intacta |
| TX 3 | `aprovado` / NSU 2338 / auth 211139 — intacta (`atualizado_em` 20:39:53) |
| Venda 66 | `concluida`/`quitada` / `tef_transacao_id=3` — intacta |
| Recebimentos/pagamentos 66 | inalterados |

**Não** classificar esta ocorrência como UNKNOWN, negado ou inexistente de cobrança: **não houve cobrança nesta tentativa**.

---

## 7. Ambiente (somente leitura)

| Item | Estado |
| --- | --- |
| NativeHost | utility Electron **14688**, pai ERP **12832** |
| V$PagueClient | **20760**, `:60906` LISTENING |
| COM4 (PPC-920/930) | presente, Status **OK** (sem abrir dispositivo) |
| `.conf` inventariado | `C:\VBI\V$Pague\Client\V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (binário serializado Java; mtime 18:37Z) |
| Gate global `DESTAXA_REAL_TRANSACTION_ENABLED` | não definido no shell de diagnóstico (`null` ≠ `1`) |
| Ledger permits | último `cff48150…` **CONSUMED** em 20:26:08Z — **nenhum permit novo** nesta janela |
| `tef_ativo` (config DB) | `false` (flag legada; fluxo Destaxa real usa gate/permit) |

`INIT_CLIENT` ocorre na **pré-condição** (`prepararAutorizacao` / readiness) **antes** do consumo de permit/CRT — por isso a falha aparece sem nova linha financeira e sem novo permit.

---

## 8. Correção mínima recomendada (não implementada)

Aguardar avaliação do PO. Sugestão mínima, **sem nova cobrança**:

1. **Tratar A1 como bloqueio distinto** na UI/pré-condição (não reapresentar só como F0 de retry).
2. **Não retentar `iniciaClientDestaxa`** automaticamente após A1/F0 na mesma sessão Host.
3. **Reconciliar a pendência Destaxa** da operação aprovada sem FINALIZE da TX 3 (confirmação/desfazimento conforme procedimento Destaxa oficial — fora desta sprint; **não** repetir CRT).
4. Evitar segundo start do V$Pague enquanto PID 20760 / `:60906` estiverem ativos.
5. Só após Destaxa sair de A1 e INIT_CLIENT voltar **00**, autorizar nova operação financeira (com permit/gate conforme política).

---

## 9. Artefatos de coleta

- `docs/homologacao/tef/SPRINT-51.43/diag-f0-readonly.json`
- `docs/homologacao/tef/SPRINT-51.43/diag-f0-detalhe.json`
- `docs/homologacao/tef/SPRINT-51.43/diag-f0-sequencia.json`
- `docs/homologacao/tef/SPRINT-51.43/diag-f0-config.json`

**Nenhuma correção de código nesta etapa. Nenhuma operação financeira iniciada.**
