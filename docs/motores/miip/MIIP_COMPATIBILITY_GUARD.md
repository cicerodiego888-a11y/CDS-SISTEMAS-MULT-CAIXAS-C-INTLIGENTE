# MIIP — Compatibility Guard

> **Similaridade não implica equivalência.**

## Fluxo oficial

```
IDENTIDADE (GTIN / Associação / código / PLU)
  → CANDIDATOS (MUBC — busca ampla)
  → COMPATIBILIDADE (ProductCompatibilityGuard)
  → SIMILARIDADE (MotorSimilarity)
  → DECISÃO (DecisionEngine)
```

Candidato incompatível é **removido** da coleção (não recebe score 0).
Não entra em Top candidatos, gap, confiança nem DecisionEngine.

## Módulo

`backend/motores/miip/utils/ProductCompatibilityGuard.js`

- Sem SQL / sem banco
- Não cria associação
- Não decide o produto final
- Responde: `COMPATIVEL` | `SUSPEITO` | `INCOMPATIVEL`

## Hard blocks

| Regra | Efeito |
|-------|--------|
| Tipos comerciais diferentes e confiáveis | BLOQUEIA |
| NCM de capítulos distintos + tipo incompatível | reforça BLOQUEIO |
| Medidas com famílias de unidade distintas + tipo incompatível | reforça BLOQUEIO |
| Material genérico compartilhado (AÇO, METAL…) | **não** reabilita |
| GTIN parcial | **não** isenta |
| GTIN exato / código fornecedor / código interno / PLU | **preserva** (não bloqueia) |

## AttributeParser

- `tiposCompostos` (ex.: `PASSA FIO`)
- Tipos simples: `FACA`, `TORNEIRA`, `MANGUEIRA`, …
- Componentes (`CABO`, `ALMA`) não viram tipo quando há tipo comercial explícito

## Caso de aceite

XML `FACA … NCM 82014000` × CDS `PASSA FIO … NCM 39173900` → **BLOQUEADO**.

## Testes

```
npm run test:miip-compatibility
node tests/miip/faca-passa-fio-compatibility.test.js
npm run test:miip-attribute
npm run test:miip-mubc
npm run test:miip-similarity
npm run test:miip-pipeline
```
