# RC14.12.4 — Alinhamento da suíte de testes do Driver Toledo

## Objetivo

Eliminar falsos negativos: testes e documentação passam a refletir as capabilities reais do Driver homologado (`ToledoCapabilities` / V2.0).

**Sem alteração de comportamento do Driver.**

## Fonte de verdade

`backend/motores/equipamentos/drivers/toledo/ToledoCapabilities.js`

| Capability | Valor |
|------------|-------|
| handshake, ping, uploadPLU, downloadPLU, syncPLU | `true` |
| readWeight, monitor, downloadConfig, writeConfig | `true` |
| writeLabel, firmwareUpdate, autoReconnect | `false` |

## Alterações

| Artefato | Ajuste |
|----------|--------|
| `tests/.../driver-toledo-prix-iv-v1.test.js` | Asserts de capabilities + timeout de handshake (aceita `TimeoutError` 90AX) |
| `tests/.../toledo-certification-v2.test.js` | Matriz completa de capabilities + checagem na doc |
| `frontend/erp/js/central-equipamentos.js` | Fallback de caps alinhado (só quando API falha) |
| `docs/equipamentos/toledo-prix-iv-uno-homologacao-v2.md` | Seção 4.1 Capabilities |

## Consistência

Driver × Front (fallback) × Doc × Testes — mesma matriz.

## Evidências

```text
npm run test:driver-toledo-v1     → pass
npm run test:certification-v2     → 10/10
npm run test:equipamentos-14x     → exit 0
```

