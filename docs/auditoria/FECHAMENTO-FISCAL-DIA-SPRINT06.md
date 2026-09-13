# Fechamento Fiscal do Dia — Sprint 06  
## Correção da elegibilidade + Monitoramento Inteligente + Nova UX

**Data:** 2026-09-13  
**Módulo:** Fechamento Fiscal do Dia — CDS Sistemas  
**Produção:** **NÃO liberada automaticamente**  
**Toggle único:** `fechamento_fiscal_do_dia` (sem novos switches)

---

## 1. Regra anterior (Sprints 01–05)

A elegibilidade usava a parcela **não fiscal** do item:

```text
quantidade_elegivel ≈ quantidade_nao_fiscal
(+ fallback legado: se qF=0 e qNF=0 → quantidade)
```

Isso gerava confusão semântica: venda 100% com consumo de **saldo fiscal** em operação **não fiscal** (F12 off) aparecia com `itens_fiscais_elegíveis = 0`.

---

## 2. Problema encontrado

`quantidade_fiscal` representa consumo de **estoque fiscal**, não a natureza comercial da operação.

Uma venda não fiscal pode consumir saldo fiscal (`quantidade_fiscal > 0`, `quantidade_nao_fiscal = 0`).  
A regra antiga olhava `quantidade_nao_fiscal` e descartava esses casos.

---

## 3. Regra correta (oficial)

```text
PRODUTO FISCAL (item_fiscal = 1)
        +
VENDA NÃO FISCAL (sem NFC-e ativa no fluxo comercial normal)
        +
CONSUMO DE SALDO FISCAL (quantidade_fiscal > 0)
        ↓
quantidade_elegivel = quantidade_fiscal
```

`quantidade_nao_fiscal` permanece apenas para **explicação/auditoria** na UI — **nunca** como elegível.

---

## 4. Exemplos

| Cenário | item_fiscal | Operação | qF | qNF | Elegível |
|---------|-------------|----------|----|-----|----------|
| A | 1 | Não fiscal | 10 | 0 | **10** |
| B | 0 | Não fiscal | 0 | 10 | **0** |
| C | 1 | Não fiscal | 6 | 4 | **6** |
| Fiscal | 1 | Com NFC-e | 5 | 0 | **0** |

---

## 5. Nova fórmula

```text
quantidade_elegivel =
  max(0,
    quantidade_fiscal
    − devoluções vinculadas ao item
    − quantidade já utilizada em fechamentos ativos
  )
  somente se item_fiscal=1 e operação sem NFC-e ativa

valor_elegivel =
  proporcional a valor_fiscal histórico
  ou quantidade_elegivel × preco_unitario da venda
  ou rateio do subtotal histórico
```

Registros legados ambíguos (`qF=0`, `qNF=0`, `quantidade>0`) → `ORIGEM_LEGADA_AMBIGUA` (não inventar elegibilidade).

Detecção de operação não fiscal: **ausência de `nfce_notas` ativa** (status ≠ cancelada). Reutiliza tabela existente — sem nova coluna de natureza.

---

## 6. Alterações

| Arquivo | Mudança |
|---------|---------|
| `FechamentoFiscalElegibilidadeService.js` | Regra nova, monitoramento, KPIs, uso prévio, ambíguos |
| `FechamentoFiscalService.js` | `excluirFechamentoId` na prévia; export monitoramento |
| `index.js` | Export `listarMonitoramentoProdutosDoDia` |
| `frontend/erp/js/fechamento-fiscal-dia.js` | UX de monitoramento, KPIs, grid, poll 10s |
| Seeds testes 01–05 | `quantidade_fiscal` alinhada à regra oficial |
| `fechamento-fiscal-dia-sprint06.test.js` | Suíte Sprint 06 |
| Este documento | Auditoria Sprint 06 |

**Não alterados:** motores F×NF, comercial, fiscal, não fiscal, distribuidores de estoque/pagamento, TEF, PIX, caixa.

---

## 7. Testes

```bash
node tests/fiscal/fechamento-fiscal-dia-sprint01.test.js
node tests/fiscal/fechamento-fiscal-dia-sprint02.test.js
node tests/fiscal/fechamento-fiscal-dia-sprint03.test.js
node tests/fiscal/fechamento-fiscal-dia-sprint04.test.js
node tests/fiscal/fechamento-fiscal-dia-sprint05.test.js
node tests/fiscal/fechamento-fiscal-dia-sprint06.test.js
```

Cobertura Sprint 06: cenários A/B/C, venda fiscal, soma multi-venda, devolução, cancelados, centavos, preço histórico, anti-reuso, freeze de prévia, CNPJ, config ON/OFF, regressão distribuição, KPIs, READ-ONLY, anti-qNF-como-elegível, legado ambíguo.

---

## 8. Resultado

| Suíte | Resultado |
|-------|-----------|
| Sprint 01 | 10 OK, 0 FAIL |
| Sprint 02 | 13 OK, 0 FAIL |
| Sprint 03 | 21 OK, 0 FAIL |
| Sprint 04 | 13 OK, 0 FAIL |
| Sprint 05 | 24 OK, 0 FAIL |
| Sprint 06 | 24 OK, 0 FAIL |

Exemplos A/B/C e venda fiscal: **validados** nos testes 01–04.

**Classificação:** **SPRINT 06 — APROVADA** (liberação controlada; produção não automática).

---

## 9. Impacto na UX

A tela deixa de ser um formulário técnico centrado em “Itens fiscais elegíveis: 0” e passa a ser um **painel de monitoramento**:

- Cabeçalho com status ON/OFF e status do fluxo
- KPIs: vendas do dia, não fiscal, unidades elegíveis, valor elegível
- Alerta inteligente com CTA “ANALISAR FECHAMENTO”
- Grid produto × vendido × fiscal × não fiscal × elegível
- Detalhe por venda ao clicar
- Recebimentos e composição como etapas posteriores
- Auto-atualização a cada 10s enquanto a tela estiver aberta

---

## 10. Invariantes preservadas

- Fechamento é **READ-ONLY** sobre comercial/estoque/financeiro
- Sem novos toggles
- Distribuição Sprint 02 intacta (R$ 250 só sugestão)
- Snapshot/prévia não muda com venda posterior
- Quantidade não reutilizada entre fechamentos ativos
- Preparação/transmissão/recuperação/cancelamento/idempotência/locks dos Sprints 01–05

---

## Classificação

**SPRINT 06 — APROVADA** somente se a suíte 01–06 estiver 100% GREEN e os critérios A/B/C forem validados.
