# Fechamento de Caixa V2 — campos e compatibilidade

## Conceitos

| Campo | Significado |
|---|---|
| `total_vendido` | Valor oficial das vendas da sessão (`vendas.total`) |
| `total_recebido` | Soma dos recebimentos confirmados |
| `total_pendente` | Vendido − recebido (parcial/prazo/entrega) |
| `saldo_fisico` / `caixa_fisico.dinheiro_esperado` | Gaveta: abertura + dinheiro + suprimento − sangria |
| `saldo_geral` | **Legado.** Continua existindo, mas não representa a gaveta |
| `total_informado` / `dinheiro_conferido` | Dinheiro contado |
| `retirada_fechamento` | Valor retirado depois da conferência |
| `valor_fechamento` (caixa / sessão) | **Saldo final deixado no caixa** (contado − retirada) |
| `resumo_json` | Snapshot imutável da reconciliação |

## Identidade oficial da venda

`vendas.total` é a fonte oficial.

Quando `valor_fiscal` e/ou `valor_nao_fiscal` existem:

`total = valor_fiscal + valor_nao_fiscal` em centavos exatos.

Histórico sem distribuição (ambos zerados): usa `vendas.total`. Não reescreve registros legados.

## Status por venda

`OK` · `PARCIALMENTE_RECEBIDA` · `PENDENTE` · `INCONSISTENTE` · `EXCEDENTE`

- Parcial e pendente **não** bloqueiam o fechamento.
- Inconsistente (identidade ou quitada que não fecha) e excedente bloqueiam.
- Prazo/fiado sem recebimento confirmado = recebido 0.

## Conferência ≠ retirada

1. Calcula dinheiro esperado.
2. Operador informa dinheiro contado.
3. Diferença = contado − esperado.
4. Só então aplica retirada (`retirada_fechamento`).
5. Saldo final = contado − retirada.
6. Próxima abertura sugere o saldo final (`caixa.valor_fechamento`).

## Política de bloqueio

- Integridade financeira real: operador e admin bloqueados.
- Diferença física: operador bloqueado; admin/autorizado pode `fechar_com_divergencia` com justificativa.

## APIs preservadas

`GET /caixa/aberto`, `POST /caixa/fechar` (`valor_informado` ainda aceito),
`total_vendido`, `diferenca`, `saldo_esperado`, `total_sangrias`, `total_suprimentos`, `resumo_json`.

Novos campos compatíveis no POST `/caixa/fechar`:

- `dinheiro_conferido`
- `retirada_fechamento`
- `modo_retirada` (`nenhuma` | `total` | `valor`)
- `fechar_com_divergencia`
- `justificativa_divergencia`

## Migração

Índice único `idx_caixa_fechamentos_sessao_unica` só é criado se o diagnóstico não encontrar `sessao_id` duplicado. Duplicados históricos não são apagados.
