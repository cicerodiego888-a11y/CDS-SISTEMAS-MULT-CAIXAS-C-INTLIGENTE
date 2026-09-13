# RC5.0 — Integração Corporativa do Motor de Equipamentos

## Status

**Motor de Equipamentos V1.0.0 — CONGELADO.**  
Toda evolução desta RC ocorre **somente** em `backend/services/equipamentos-integracao/`.

## Arquitetura

```text
ERP (PDV | Compras | Fiscal | TEF | Central Inteligente)
        │
        ▼
EquipamentosIntegrationService  ← fachada oficial RC5
        │
        ├── EquipmentEventBus
        ├── EquipamentosAuditoria
        ├── EquipamentosPermissoes
        │
        ▼ (somente APIs públicas do Motor)
Motor V1 — Discovery | MIE | Central | Heartbeat | Drivers | Transport
```

**Regra:** nenhum módulo acessa Drivers, Discovery ou Heartbeat diretamente.

## Serviços

| Serviço | Função |
|---------|--------|
| `EquipamentosIntegrationService` | Consultas, diagnóstico, sync, PDV/Fiscal/TEF |
| `EquipmentEventBus` | Eventos corporativos |
| `EquipamentosAuditoria` | Quem / quando / módulo / resultado / tempo |
| `EquipamentosPermissoes` | Matriz PDV/Compras/Fiscal/TEF/Admin |
| `modulos/*` | Adaptadores por domínio |

## API — `/api/integracao-equipamentos`

| Método | Rota | Função |
|--------|------|--------|
| GET | `/status` | Status Motor + Central + Heartbeat |
| GET | `/equipamentos` | Lista via Central |
| POST | `/diagnostico/:id` | Diagnóstico |
| POST | `/sincronizacao` | Sync produtos/PLU/dept/config |
| GET | `/eventos` | Histórico EventBus |
| GET | `/auditoria` | Trilha de auditoria |
| GET | `/permissoes` | Catálogo de permissões |
| POST | `/pdv/verificar` | Abertura de caixa |
| POST | `/pdv/:id/reconectar` | Reconexão PDV |
| POST | `/fiscal/validar` | Pré-emissão |
| POST | `/tef/descobrir` | Discovery PinPad via Motor |

Header opcional: `x-cds-modulo: PDV|COMPRAS|FISCAL|TEF|ADMIN`

## Eventos oficiais

- `EquipmentDiscovered`
- `EquipmentOnline` / `EquipmentOffline`
- `EquipmentIdentityChanged` / `EquipmentFirmwareChanged`
- `EquipmentHealthChanged`
- `EquipmentSyncStarted` / `EquipmentSyncFinished`
- `EquipmentDiagnosticGenerated`
- `EquipmentConfigurationChanged`
- Aliases: `HeartbeatFalhou`, `DiagnosticoGerado`, `SincronizacaoConcluida`

## Módulos integrados

| Módulo | Integração |
|--------|------------|
| **PDV** | Verificação na abertura do caixa; status/reconexão na venda |
| **Compras** | Sync produtos/PLU/dept/config via IntegrationService |
| **Fiscal** | Pré-check em `emissor.js` (env `FISCAL_EQUIPAMENTOS_OBRIGATORIOS`) |
| **TEF** | `POST /api/tef/equipamentos/descobrir` → Discovery do Motor |
| **Central Inteligente** | Consome EventBus (não consulta Heartbeat direto) |

## Permissões

| Módulo | Ações |
|--------|-------|
| PDV | consultar, reconectar, eventos |
| Compras | consultar, sincronizar, eventos |
| Fiscal | consultar, eventos |
| TEF | consultar, descobrir, eventos |
| Admin | controle total |

## Testes

```bash
npm run test:equipamentos-integracao-rc5
```

## Limitações conhecidas

- Bloqueio de emissão fiscal por equipamento só com `FISCAL_BLOQUEAR_SEM_EQUIPAMENTO=1`.
- Obrigatórios PDV via `PDV_EQUIPAMENTOS_OBRIGATORIOS` (IDs separados por vírgula).
- SDK TEF legado (`sdkDetector`) permanece para DLLs; descoberta de hardware migra para o Motor.
- EventBus em memória (histórico limitado); persistência longa via auditoria + eventos do Motor.
