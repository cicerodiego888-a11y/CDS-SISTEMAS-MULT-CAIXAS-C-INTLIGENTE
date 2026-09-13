# RC14.12.2 — Painel de Diagnóstico Enterprise V1.0

## Resultado

Painel UX em **7 cards** na Central de Equipamentos, reutilizando `ToledoDiagnostics` e o endpoint existente:

`GET /api/equipamentos/driver/toledo/diagnostics`

| Card | Conteúdo |
|------|----------|
| Identificação | Fabricante, modelo, firmware, driver, série, protocolo, transporte, modo, status |
| Conexão | IP, porta, online, heartbeat, latência, health + 🟢/🟡/🔴 |
| Capacidades | Checklist Discovery…Diagnóstico |
| Homologação | Checklist + percentual |
| Histórico Recente | Últimas 20 ops (`operations/history`) |
| Eventos Recentes | Logs derivados do diagnóstico + histórico |
| Diagnóstico Geral | Resumo executivo / problema + recomendação |

## Ações

- **Atualizar Diagnóstico** → GET Toledo diagnostics
- **Exportar Diagnóstico** → JSON / TXT (PDF futuro)

## Restrições respeitadas

- Sem alteração estrutural no Driver Toledo
- Sem endpoint novo
- Campos nulos → **Não informado**

## Testes

```bash
npm run test:diagnostics-panel-v1
```
