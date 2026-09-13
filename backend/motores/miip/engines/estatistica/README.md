# engines/estatistica/

Motor de **estatísticas e padrões** de identificação.

**Sprint 1.1:** pasta reservada — sem implementação.

## Responsabilidade

- Consultar `miip_estatisticas` para ajustar pesos dinâmicos
- Priorizar motores com maior taxa de acerto por contexto (origem, fornecedor)
- Motor meta — influencia ranking, não identifica sozinho

## Repository

`MiipEstatisticasRepository`

## Integração

`metrics/` — coleta em tempo real alimenta este motor
