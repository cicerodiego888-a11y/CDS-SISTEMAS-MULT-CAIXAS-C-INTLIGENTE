# RC14.12.1 — Unificação do Diagnóstico

## Resultado

Um único pipeline oficial: **Toledo Diagnostics V2** + **painel `#centralEqDiagPainel`**.

| Entrada | Comportamento |
|---------|----------------|
| Toolbar Diagnóstico | Abre painel → `GET .../driver/toledo/diagnostics` → render |
| Ícone 🩺 na linha | Localiza host/porta → abre **mesmo painel** → `POST .../central-equipamentos/:id/diagnostico` (delega Toledo) → render |

## Backend

- `CentralEquipamentosService.diagnosticar` só localiza equipamento e chama `ToledoDiagnostics.diagnostics`
- Sem ping/EthernetTransport próprio na Central
- `POST /api/central-equipamentos/:id/diagnostico` devolve o payload Toledo (não descarta)

## Front

- `centralEqDiagRenderizar` preenche todos os campos; nulos → **Não informado**
- Offline → alerta com Status OFFLINE + Motivo
- Toast apenas secundário

## Testes

```bash
npm run test:diagnostics-unification
```

13/13 aprovados. Certificação V2: 10/10.
