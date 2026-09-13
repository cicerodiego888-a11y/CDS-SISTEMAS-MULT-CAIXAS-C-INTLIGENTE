# RC14.15.9 — Remoção definitiva do campo “Código MGV6”

**Status:** IMPLEMENTADO  

## Resumo

O campo artificial **Código MGV6** (RC14.15.5) foi removido da interface e da resolução operacional do Bridge MGV6.

> O campo Código MGV6 foi removido da interface porque não faz parte da identidade operacional comprovada do MGV6. O código utilizado pelo TXITENS é o PLU/código do item da balança.

## Regra oficial

```
PLU / Código do item da balança → TXITENS.TXT → MGV6 → Balança
```

Exemplo: Milho Grão Kg · interno 012841 · PLU 39 → CCCCCC `000039` · bloco `000000039`

## Alterações

| Área | Ação |
|------|------|
| UI `produtos.js` | Removidos label/input/validação/payload `codigo_mgv6` |
| `MGV6IdentityResolver` | Resolve **somente PLU** (ignora `tipo=MGV6` / `codigo_mgv6`) |
| Sync / Builder / Validator | Sem dependência operacional de `codigo_mgv6` |
| Banco | **Sem alteração** — registros `tipo=MGV6` preservados |
| TXITENS layout | **Inalterado** |
| TCP | **0 alterações** |

## Critérios

| Item | Status |
|------|--------|
| Campo Código MGV6 da UI | **REMOVIDO** |
| Dependência operacional de codigo_mgv6 | **REMOVIDA** |
| PLU | **MANTIDO** |
| TXITENS | **INALTERADO** |
| Banco | **SEM ALTERAÇÃO** |
| Migration | **NÃO** |
| Dados legados | **PRESERVADOS** |
| TCP | **0 alterações** |
| Caso PLU 39 | **PASS** |
| Caso PLU 12746 | **PASS** |
| Sem PLU / EAN / interno | **PASS** (PLU_REQUIRED) |
| Testes MGV6 | **PASS** |
| Testes TCP | **PASS** |

## Entrega

**RC14.15.9 — CONCLUÍDA**
