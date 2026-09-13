# HOTFIX FISCAL-4.0.2 — Desconto total × pagamento fiscal

## Problema

Ao aplicar desconto no total da venda, o operador pagava o **valor líquido**, mas a validação do Orquestrador/MIDP podia exigir o **valor fiscal bruto**, resultando em:

> Pagamento fiscal insuficiente

## Fluxo auditado

```
Subtotal (itens)
  → Desconto / Acréscimo comercial
  → Total líquido da venda
  → Motor F×NF (máximo bruto)
  → Valor Fiscal Líquido + Valor Não Fiscal Líquido   ← fonte da verdade
  → Valor Fiscal Efetivo (MIDP / preservar dinheiro)  ← agora no eixo líquido
  → Pagamentos
  → Validação Orquestrador (saldoFiscal)
  → NFC-e / Financeiro
```

## Fonte da verdade (validação)

| Campo | Uso |
|---|---|
| `resultadoMotor.valorFiscalLiquido` | **Obrigatório** na validação de pagamento |
| `resultadoMotor.valorNaoFiscalLiquido` | Par NF da validação |
| `totalFiscal` / `totalNaoFiscal` no Orquestrador | Alias do líquido (contrato MIDP) |
| Subtotal / `valor_fiscal` bruto | **Nunca** na validação de pagamento |

Variáveis descartadas para validar pagamento: `subtotal`, `valorFiscalBruto`, `valor_fiscal` do body do PDV.

## Divergência corrigida

1. **Ordem errada:** `calcularValorFiscalEfetivo` rodava sobre o **total bruto** enquanto os pagamentos já eram **líquidos**. Em `somarPagamentosNaoDinheiro`, `totalBruto − dinheiro` inventava “eletrônico fantasma” igual ao valor do desconto.
2. **Fallback de pagamentos vazios** criava pagamento com `valor: 0`, gerando falso “insuficiente”.
3. Validação usava `saldoFiscal > 0` sem tolerância de centavo.

## Correção (somente inconsistência desconto × pagamento)

1. `distribuirItensVendaComValorFiscalEfetivo`: aplica **Valor Fiscal Líquido antes** do efetivo/MIDP.
2. `somarPagamentosNaoDinheiro`: capacidade comercial = soma dos pagamentos informados (líquida).
3. `OrquestradorPagamento`: valida líquido; fallback de pagamento = F+NF; tolerância `0.009`; log debug.
4. `VendaPagamentoService`: `resolverTotaisFiscaisLiquidosMotor` + propaga desconto/subtotal ao Orquestrador.
5. Pré-cálculo responde `liquido_aplicado_backend: true`.

**Não alterado:** regras tributárias, emissão NFC-e, TEF, motor de estoque F/NF (faixas min/max).

## Logs debug

Ativar apenas em diagnóstico:

```bash
set CDS_DEBUG_DESCONTO_FISCAL=1
```

Emite `[DEBUG_DESCONTO_FISCAL]` com subtotal, desconto, totais F/NF, pagamentos, esperado/recebido e motivo de rejeição.

## Testes

```bash
npm run test:desconto-fiscal
```

Cobertura: % e valor, fiscal/NF/misto, PIX/dinheiro/cartão/múltiplos, troco, identidade NFC-e (vProd−vDesc), rejeição legítima, cancelamento (helper presente).

## Critérios de aceitação

- [x] Pagamento que cobre o fiscal líquido não gera “Pagamento fiscal insuficiente”
- [x] UI/backend alinhados ao líquido do Motor
- [x] Troco sobre total líquido
- [x] Identidade fiscal vProd − vDesc = vNF preservada no rateio
- [x] Suite automatizada aprovada
