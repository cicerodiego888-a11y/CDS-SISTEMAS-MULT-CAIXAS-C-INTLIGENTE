# MRT-50.72 — Resultado dos testes

## Execução

```
node tests/tef/mrt-50-72-transacao-tipo-cartao-encoding.test.js
```

| Item | Valor |
|---|---|
| Resultado | **8 ok / 0 falhas** |
| Gate durante execução | `0` |
| DLL / NativeHost / TX | Não usados |
| Artefato JSON | `matriz-encoding-resultado.json` |

## Casos

| # | Caso | Resultado |
|---|---|---|
| 1 | `ENCODING_DESTAXA` = latin1 | OK |
| 2 | Constante CDS = `Débito` (docs/06) | OK |
| 3 | `mapearTipoCartaoCrt('cartao_debito')` → `Débito` | OK |
| 4 | `buildCrtInput` produção = string 77 bytes com `0xE9` | OK |
| 5 | Literal `Debito` fora da allowlist → campo omitido | OK |
| 6 | UTF-8 ≠ latin1 só para `Débito` | OK |
| 7 | CRT `Débito`/`Debito`: mesmo len latin1; hex distinto | OK |
| 8 | Exemplo docs/06 Credito `tamanho_entrada=81` | OK |

## Critérios de aceitação da sprint

| Critério | Status |
|---|---|
| Testes unitários isolados aprovados | Cumprido |
| Comparação de bytes reproduzível | Cumprido |
| Contrato DLL documentado | Cumprido (`INVESTIGACAO.md`) |
| Origem do `05` investigada | Cumprido (Client `retorno:5` + política UNKNOWN) |
| Nenhuma chamada nativa | Cumprido |
| Nenhuma TX | Cumprido |
| Gate OFF | Cumprido |
| UNKNOWN preservado | Cumprido |
| Sem alteração fiscal/financeira/protocolo | Cumprido |

## Correção

**Não implementada** nesta sprint (restrito). Proposta mínima em `MRT-50.72-INVESTIGACAO.md` §8.

## Classificação final

### `INCOMPATIBILIDADE PROVÁVEL`

Próximo passo (apenas com aprovação): sprint de correção mínima alinhando o literal aos examples (`Debito`) **ou** confirmação escrita Destaxa de que `Débito` é canônico e o Client de homologação está incorreto — depois, CRT nova e independente.
