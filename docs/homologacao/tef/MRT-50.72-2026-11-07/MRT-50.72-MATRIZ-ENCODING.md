# MRT-50.72 — Matriz de encoding (`transacao_tipo_cartao`)

Testes **puros** de representação. Não comprovam aceitação pelo V$Pague.

Fonte executável: `tests/tef/mrt-50-72-transacao-tipo-cartao-encoding.test.js`  
JSON: `matriz-encoding-resultado.json`

Encoding de contrato CDS: **`latin1`**.

---

## Valores analisados

| Rótulo | Texto | Origem |
|---|---|---|
| docs06_accent | `Débito` | docs/06 + CDS produção |
| examples_ascii | `Debito` | examples java/dotnet + docs/07 `opcao` |
| upper_ascii | `DEBITO` | variante não documentada como aceita |
| docs06_credito | `Credito` | docs/06 + examples (controle) |

---

## Code points e bytes

| Valor | Unicode | UTF-8 hex | UTF-8 len | Latin-1 hex | Latin-1 len | UTF-8 ≠ latin1 |
|---|---|---|---|---|---|---|
| `Débito` | D U+0044; **é U+00E9**; b i t o | `44c3a96269746f` | 7 | `44e96269746f` | 6 | **Sim** |
| `Debito` | D U+0044; **e U+0065**; b i t o | `44656269746f` | 6 | `44656269746f` | 6 | Não |
| `DEBITO` | D E B I T O (ASCII) | `44454249544f` | 6 | idem | 6 | Não |
| `Credito` | ASCII | — | 7 | idem | 7 | Não |

---

## Serialização CRT homologação (valor=1.00, pagamento=A vista)

Formato: `transacao_valor=1.00;transacao_tipo_cartao=<VAL>;transacao_pagamento=A vista`

| Valor do tipo | Bytes latin1 (`tamanho_entrada`) | Bytes UTF-8 | Byte crítico | Buffer+NUL |
|---|---|---|---|---|
| `Débito` (CDS atual) | **77** | 78 | `é` = `0xE9` | 78 |
| `Debito` (examples) | **77** | 77 | `e` = `0x65` | 78 |
| `DEBITO` | 77 | 77 | ASCII | 78 |

**Nota:** em latin1, `Débito` e `Debito` têm o **mesmo** comprimento; a divergência é o byte do segundo caractere (`E9` vs `65`), não o `tamanho_entrada`.

Hex latin1 CRT atual (trecho tipo): `...3d` **`44e96269746f`** `3b...` (`=Débito;`)  
Hex latin1 CRT examples: `...3d` **`44656269746f`** `3b...` (`=Debito;`)

---

## Compatibilidade com contrato documentado

| Critério | `Débito` | `Debito` | `DEBITO` |
|---|---|---|---|
| Texto docs/06 | Alinhado | **Divergente** do texto 06 | Divergente |
| Examples java/dotnet | Divergente | Alinhado | Divergente |
| docs/07 opção | Divergente | Alinhado ao token `Debito` | Divergente |
| Allowlist CDS atual | Aceito | **Rejeitado** (campo omitido) | Rejeitado |
| Encoding latin1 CDS | Representável | Representável | Representável |
| Aceitação V$Pague | Rejeitado na 50.69 (conteúdo) | **Não testado** | Não testado |

---

## Produção CDS (sem alteração nesta sprint)

```
transacao_valor=1.00;transacao_tipo_cartao=Débito;transacao_pagamento=A vista
```

`mapearTipoCartaoCrt('cartao_debito')` → `Débito`.
