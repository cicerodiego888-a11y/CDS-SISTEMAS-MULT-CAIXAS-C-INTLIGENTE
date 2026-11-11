# TEF-DESTAXA-51.27 — Relatório

**Sprint:** Reconciliação administrativa da operação histórica `tef_transacoes.id=1`  
**Data de execução:** 2026-11-10 (America/Sao_Paulo)  
**Classificação final:** **RECONCILIADO ADMINISTRATIVAMENTE**  
**Homologação operacional CRT:** **não declarada** (fora de escopo; gate OFF)

---

## 1. Estado anterior da operação

| Campo | Valor |
| --- | --- |
| Banco | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |
| `id` | **1** |
| `status` | **`pendente`** |
| `valor` | R$ 1,00 |
| `tipo` / modalidade | `cartao_debito` |
| `provedor` | `destaxa` |
| `idempotency_key` | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| `operation_id` | `op_ef2ed65b9230_744378e59797f9a7` |
| `requestId` | `d3cd929385f4281e` |
| `nsu` | `null` |
| `autorizacao` | `null` |
| `venda_id` | `null` |
| `criado_em` | `2026-11-09 16:58:43` (UTC storage) |
| `atualizado_em` | `2026-11-09 16:59:12` |
| Pendências ativas | **1** (`id=1`) |
| Bloqueio `criarTransacaoExclusiva` | **ATIVO** |

Auditoria pré-alteração (somente leitura) confirmou identidade, timestamps e ausência de NSU/autorização/venda **antes** de qualquer UPDATE.

---

## 2. Evidências Destaxa utilizadas

Resposta direta da Integração Destaxa ao Product Owner (WhatsApp):

> Pelo que está mencionando a automação que está bloqueando, ou seja, não está chamando o continuaTransacao, se você não aproximou a transação não foi aprovada pela adquirente, portanto não existe nada pendente.

Interpretação funcional autorizada nesta sprint: operação **não realizada / inexistente** na adquirente (`INEXISTENT`), **sem** inventar execução de `FINALIZE(9)`.

---

## 3. Evidências de logs utilizadas

| Fonte | Conteúdo relevante |
| --- | --- |
| CDS / NativeHost (51.17) | INSERT pré-DLL → `TX_START` → retorno **99** → `TX_CONTINUE` bloqueado por `HOST_SECURITY_OPERATION_BLOCKED` (pré-51.20) → ciclo inconclusivo |
| `vspague-client.log` | Timeout aguardando resposta da aplicação comercial; encerramento operacional com resposta **78** |
| Registro local | Sem NSU / autorização / comprovante / venda |

---

## 4. Arquivos alterados

| Arquivo | Papel |
| --- | --- |
| `backend/services/tef/tefReconciliacaoAdministrativaInexistente.js` | **Novo** — procedimento auditável INEXISTENT (escopo id=1) |
| `backend/services/tef/tefContrato.js` | Status administrativo `nao_realizada` |
| `backend/services/tef/tefFinancialSafetyPolicy.js` | `FINANCIAL_STATES.INEXISTENT` (+ `CANCELLED` explícito; sem mapear INEXISTENT→CANCELLED) |
| `backend/services/tef/tefRepository.js` | `listarTransacoesFinalizadas` inclui `nao_realizada` |
| `backend/services/tef/tefPendenciasService.js` | Documenta `INEXISTENT` fora de `reconciliarResultadoTardio` |
| `backend/services/tef/tefPersistenciaObrigatoria.js` | Preserva identidade `nao_realizada` / INEXISTENT (sem reenvio) |
| `scripts/tef/aplicar-reconciliacao-51-27-inexistente.js` | **Novo** — aplicação local auditável |
| `tests/tef/tef-destaxa-51-27-reconciliacao-inexistente.test.js` | **Novo** — testes obrigatórios |
| `docs/homologacao/tef/TEF-DESTAXA-51.27/TEF-DESTAXA-51.27-RELATORIO.md` | Este relatório |

**Não alterado:** `TefManager.js` (hash 51.20 preservado).

---

## 5. Migração

**Não necessária.** `tef_transacoes.status` é `TEXT` sem `CHECK` constraint; o valor administrativo `nao_realizada` é compatível com o schema atual. Nenhuma migração DDL foi aplicada.

---

## 6. Estado administrativo escolhido

| Dimensão | Valor |
| --- | --- |
| Cenário documental | **INEXISTENT** / não realizada na adquirente |
| `financialState` | `INEXISTENT` |
| `status` local | **`nao_realizada`** |
| Distinção | **≠** `CANCELLED` / `cancelado` · **≠** aprovação · **≠** recusa financeira |

`reconciliarResultadoTardio` permanece restrito a `CONFIRMED_SUCCESS` | `CONFIRMED_DENIED` | `CANCELLED`. O caminho INEXISTENT é o módulo administrativo dedicado.

---

## 7. Transição efetivamente aplicada

```
pendente  →  nao_realizada
UNKNOWN (operacional)  →  INEXISTENT (administrativo)
```

Condições do UPDATE: `id=1`, `status='pendente'`, `idempotency_key` esperada, `nsu IS NULL`, `autorizacao IS NULL`, `venda_id IS NULL`.  
Auditoria gravada em `tef_logs` tipo `RECONCILIACAO_ADMINISTRATIVA_INEXISTENTE` (id log **15**).  
`payload_retorno` histórico **preservado** (não reescrito).

---

## 8. Antes / depois

| Campo | Antes | Depois |
| --- | --- | --- |
| `status` | `pendente` | `nao_realizada` |
| `nsu` | `null` | `null` |
| `autorizacao` | `null` | `null` |
| `venda_id` | `null` | `null` |
| `criado_em` | `2026-11-09 16:58:43` | `2026-11-09 16:58:43` (inalterado) |
| `atualizado_em` | `2026-11-09 16:59:12` | `2026-11-10 16:46:48` |
| `mensagem_resposta` | `null` | texto administrativo INEXISTENT 51.27 |
| Pendentes | 1 | **0** |
| Exclusividade livre | não | **sim** |

Reexecução do script: **idempotente** (`alterado: false`).

---

## 9. Verificação NSU e autorização

- `nsu` permanece **`null`**
- `autorizacao` permanece **`null`**
- Nenhum comprovante criado

---

## 10. Ausência de lançamento financeiro / fiscal

- Sem venda vinculada (`venda_id` null)
- Sem estorno / baixa de estoque
- Sem evento fiscal gerado por esta sprint
- Auditoria registra `semLancamentoFinanceiro` / `semEventoFiscal`

---

## 11. Verificação do desbloqueio

- `criarTransacaoExclusiva` bloqueia apenas `WHERE status = 'pendente'`
- Após a transição, **não há** linhas `pendente` → exclusividade **livre**
- `nao_realizada` **não** conta como pendência ativa
- Outra operação `pendente` (UNKNOWN) **continua** bloqueando (teste 51.27 + lógica intacta)
- Desbloqueio por transição administrativa formal — **não** por DELETE da linha

---

## 12. Testes e regressões

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-27-reconciliacao-inexistente.test.js` | **17 ok / 0 falha** |
| `tests/tef/tef-destaxa-51-23-reconciliacao-matriz.test.js` | **12 ok / 0 falha** |
| `tests/tef/tef-destaxa-51-25-persistencia-confirmacao.test.js` | **18 ok / 0 falha** |

CRT real: **não executado**.

---

## 13. Hashes (SHA-256)

| Arquivo | Hash |
| --- | --- |
| `TefManager.js` (51.20) | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` |
| `tefReconciliacaoAdministrativaInexistente.js` | `972ADA2DFE6D2F39E0C30187385BC24B7991162FB56421A05455636E182834A7` |
| `tefContrato.js` | `FD6A5F5EE703578F5ED08463E78AFDF02BF87692AA528089BC9103DC16E8B04F` |
| `tefFinancialSafetyPolicy.js` | `6992705799AAFE00F261B6F9B1355524F13CC08BF2803DE3FA44188CC8344465` |
| `tefRepository.js` | `4F36F5BC9CB87286D9EF48A1C5DBD47AE4398E089E9C15688EC77E00A54AB9D4` |
| `tefPendenciasService.js` | `09BBD1370AEC522F2AC6DDFB397C442652E72867ADD8C4A8A423C40FB1ECF7DB` |
| `tefPersistenciaObrigatoria.js` | `73D53F7BAF23829D997960FB572DCC22D39AA8534C085CD9FF8C5CD86A5B2E79` |

---

## 14. Confirmação: sem chamada à DLL

Não houve `TX_START`, `TX_CONTINUE`, `TX_FINALIZE(0)`, `TX_FINALIZE(9)`, `iniciaClientDestaxa` nem `finalizaTransacaoDestaxa`.

---

## 15. Confirmação: sem CRT

Nenhuma CRT real foi executada nesta sprint.

---

## 16. Confirmação: gate OFF

`DESTAXA_REAL_TRANSACTION_ENABLED` permanece **unset/OFF**. Gate financeiro **não** ligado.

---

## Critério de conclusão

| Critério | Status |
| --- | --- |
| Transição administrativa auditável em `id=1` | **OK** |
| Registro não representa aprovação/cancelamento financeiro Destaxa | **OK** |
| Tentativa histórica rastreável (`criado_em` + log admin) | **OK** |
| Bloqueio local removido de forma específica | **OK** |
| Outras UNKNOWN continuam protegidas | **OK** |
| Sem operação financeira/fiscal | **OK** |

**Classificação:** RECONCILIADO ADMINISTRATIVAMENTE.

**Não declarar homologação operacional nesta sprint.**

FIM DO RELATÓRIO TEF-DESTAXA-51.27.
