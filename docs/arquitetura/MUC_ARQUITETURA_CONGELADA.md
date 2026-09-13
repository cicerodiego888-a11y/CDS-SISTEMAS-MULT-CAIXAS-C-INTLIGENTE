# MUC — Arquitetura Congelada (RC2.1)

**Tag Git:** `MUC_RC2.1_ENTERPRISE`  
**Data de congelamento:** 2026-07-31  
**Sprint:** MUC-27 — Governança e Contrato Público  
**Status:** ARQUITETURA CONGELADA  

---

## Declaração

A partir de **RC2.1**, a fronteira arquitetural do Motor Universal de Conversão está oficialmente congelada. Módulos externos devem consumir exclusivamente a API pública documentada em [`docs/contratos/MUC_PUBLIC_API.md`](../contratos/MUC_PUBLIC_API.md).

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│              MÓDULOS EXTERNOS (compras, produtos…)       │
│         require('motores/muc') → obterMuc(db)            │
└───────────────────────────┬─────────────────────────────┘
                            │ API PÚBLICA (7 métodos)
┌───────────────────────────▼─────────────────────────────┐
│              MotorUniversalConversao (Facade)              │
└───────────────────────────┬─────────────────────────────┘
                            │ INTERNO (protegido)
┌───────────────────────────▼─────────────────────────────┐
│  PipelineMuc → Parser → Validação → Normalização →       │
│  Inferência → Conversão → Auditoria → ResultadoConversaoDTO│
└─────────────────────────────────────────────────────────┘
```

---

## Pipeline (interno — congelado estruturalmente)

1. `MotorParser`
2. `MotorValidacao`
3. `MotorNormalizacao`
4. `MotorInferenciaEtapa`
5. `MotorConversaoCalculo`
6. `MotorAuditoriaEtapa`
7. `ResultadoConversaoDTO`

Orquestração: `pipeline/PipelineMuc.js`

---

## Contratos Públicos

| Artefato | Versão |
|----------|--------|
| API pública | RC2.1 |
| Contrato DTO | 1.0.0 |
| Eventos | 1.0.0 |

### DTOs

- `ConversaoDTO`
- `ResultadoConversaoDTO`
- `ProdutoApresentacaoDTO`
- `RegraConversaoDTO`

### Facade — métodos públicos

1. `converter()`
2. `processarItemCompra()`
3. `simular()`
4. `buscarApresentacao()`
5. `aprender()`
6. `exportarMetricas()`
7. `obterVersao()`

---

## Eventos (v1.0.0)

- `MUC_CONVERSAO_EXECUTADA`
- `MUC_CONVERSAO_CONFIRMADA`
- `MUC_CONVERSAO_MANUAL`
- `MUC_APRESENTACAO_APRENDIDA`
- `MUC_ERRO`
- `MUC_INFERENCIA_FALHOU`

---

## Versionamento

| Versão | Sprint | Marco |
|--------|--------|-------|
| RC1 | MUC-25 | Motor funcional unificado |
| RC2 | MUC-26 | Pipeline enterprise |
| **RC2.1** | **MUC-27** | **Governança + congelamento** |
| RC2.2+ | — | Minor (novos métodos públicos) |
| RC3.0 | — | Major (breaking changes DTO/API) |

Política completa: [`MUC_PUBLIC_API.md`](../contratos/MUC_PUBLIC_API.md) §10.

---

## Políticas

1. **Importação:** somente `obterMuc()` e factories de DTO públicos.
2. **Conversão:** proibida lógica paralela fora do MUC.
3. **Evolução interna:** permitida sem bump de versão pública.
4. **Evolução pública:** exige RFC + atualização de contrato + testes.

Checklist PR: [`docs/governanca/MUC_PR_CHECKLIST.md`](../governanca/MUC_PR_CHECKLIST.md)

---

## Certificação

```bash
node tests/muc/muc-rc1-certificacao.test.js      # compat funcional
node tests/muc/muc-rc2-certificacao.test.js      # arquitetura pipeline
node tests/muc/muc-public-contract.test.js       # contrato público RC2.1
```

---

## Histórico

| Data | Versão | Evento |
|------|--------|--------|
| 2026-07 | RC1 | Motor Universal de Conversão — primeira versão oficial |
| 2026-07 | RC2 | Pipeline desacoplado, eventos, métricas, cache |
| 2026-07-31 | RC2.1 | Contrato público formalizado, arquitetura congelada |

---

## Assinatura da Arquitetura

```
Motor:     MUC RC2.1
Contrato:  1.0.0
Eventos:   1.0.0
Tag:       MUC_RC2.1_ENTERPRISE
Status:    ARQUITETURA CONGELADA
```

**CDS Sistemas — Plataforma Mult-Caixas Inteligente**
