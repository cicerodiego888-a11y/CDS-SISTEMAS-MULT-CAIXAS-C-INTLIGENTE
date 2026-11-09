# MRT-50.73 — Correção controlada do literal CRT Debito

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Alteração | `transacao_tipo_cartao`: `Débito` → **`Debito`** |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED=0` |
| NativeHost / DLL / TX / V$Pague | **Não executados** |
| Banco / PDV / financeiro / UNKNOWN | **Não alterados** |
| MRT-50.69 | Preservada (registros históricos intactos) |

---

## Classificação final

### `CORREÇÃO IMPLEMENTADA`

Contrato local CDS alinhado aos examples Java/.NET e ao token de `docs/07`.  
**Não** declara homologação nem aceitação operacional do V$Pague para `Debito`.

---

## Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `backend/services/tef/destaxa/destaxaProtocolo.js` | `TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO = 'Debito'` |
| `backend/services/tef/destaxa/destaxaConstantes.js` | `CAMPOS_ENTRADA_CRT_DOCUMENTADOS.transacao_tipo_cartao = 'Debito \| Credito'` |
| `tests/tef/mrt-50-73-crt-literal-debito.test.js` | **Novo** — critérios da sprint |
| `tests/tef/mrt-50-72-transacao-tipo-cartao-encoding.test.js` | Expectativas de produção → `Debito` |
| `tests/tef/mrt-50-67-homologacao-debito-gate.test.js` | String CRT esperada |
| `docs/homologacao/tef/MRT-50.62-…/validate-crt-input.js` | String CRT + require relativo |

`Credito`, encoding `latin1`, montagem de buffer e classificação financeira **inalterados**.

Hashes SHA-256: `hashes-arquivos.json`.

---

## Resultado funcional

```
transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista
```

- Bytes do tipo: ASCII `44656269746f` (`Debito`); sem `0xE9` / `C3 A9`.
- `tamanho_entrada` latin1: **77** (inalterado vs string anterior).
- Allowlist: aceita `Debito` / `Credito`; rejeita `Débito`, `DEBITO`, `Voucher`.

---

## Testes executados (somente unitários isolados)

| Suite | Resultado |
|---|---|
| `mrt-50-73-crt-literal-debito.test.js` | **9 ok / 0 falhas** |
| `mrt-50-72-transacao-tipo-cartao-encoding.test.js` | **8 ok / 0 falhas** |
| `mrt-50-67-homologacao-debito-gate.test.js` | **13 ok / 0 falhas** |
| `tef-destaxa-03-crt-protocolo.test.js` | **25 ok / 0 falhas** |
| `MRT-50.62/validate-crt-input.js` | **ok** |

Critérios 1–8 da sprint: cobertos por `mrt-50-73` (+ regressão 03/67/72).

---

## Restrições cumpridas

Gate OFF; zero nativo; zero TX; zero DB; UNKNOWN preservado; sem eventos fiscais.

---

## Próximo passo (fora desta sprint)

Eventual CRT de homologação **nova e independente**, somente com autorização explícita — não reutilizar MRT-50.69.
