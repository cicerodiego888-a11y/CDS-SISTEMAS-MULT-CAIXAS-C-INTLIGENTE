# Health Monitor — Central de Entradas (RC3.4.6)

Monitoramento contínuo **somente local** (banco, timeline, estado MIRX, status).

## Regras

- Não consulta SEFAZ
- Não altera MIRX / MIIP / Plataforma Fiscal
- Auto-recuperação: apenas `processarDocumentosPendentes` (Parser interno)

## Componentes

| Arquivo | Função |
|---------|--------|
| `HealthMonitor` | Fachada + auto-recuperação interna |
| `HealthRules` | Regras de anomalia |
| `HealthAnalyzer` | Varredura |
| `HealthScheduler` | Tick periódico (5 min) |
| `HealthNotifier` | Logs HEALTH_* |
| `HealthRepository` | Scan SQL + persistência |

## API

- `GET /api/central-entradas/saude`
- `GET /api/central-entradas/saude/alertas`
- `GET /api/central-entradas/saude/documento/:id`
- `POST /api/central-entradas/saude/analisar`
