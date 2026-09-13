# Observabilidade — Sprint 15.8

Telemetria, métricas, alertas, performance e certificação automática de drivers.

## API

| Método | Rota |
|--------|------|
| GET | `/api/equipamentos/telemetry` |
| GET | `/api/equipamentos/metrics` |
| GET | `/api/equipamentos/events` |
| GET | `/api/equipamentos/alerts` |
| GET | `/api/equipamentos/performance` |
| POST | `/api/equipamentos/certification/run` |
| GET | `/api/equipamentos/certification/report` |

## Banco

- `equipamentos_metrics`
- `equipamentos_events`
- `equipamentos_alerts`
- `equipamentos_certification`

## Certificação

Itens: Discovery · Connection · Protocol · Identification · Diagnostics · Synchronization · Scheduler · Telemetry · Rollback · SDK

```bash
npm run test:observability
```
