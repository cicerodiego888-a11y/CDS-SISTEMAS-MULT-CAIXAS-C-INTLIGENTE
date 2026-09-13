# RC14.13.2 — Unificação do Contrato de Drivers (SDK ↔ ERP)

## Problema

API SDK devolvia `nomeExibicao` / `codigo: toledo-prix4`; o ERP lia `nome_exibicao` / `TOLEDO_PRIX4_UNO` → combo com value e **texto vazio**.

## Solução

Adapter oficial: `backend/motores/equipamentos/sdk/DriverAdapter.js`

```
SDK Device Profile  →  paraContratoErp()  →  Contrato ERP
```

Contrato ERP (exemplo Toledo):

```json
{
  "codigo": "TOLEDO_PRIX4_UNO",
  "codigo_sdk": "toledo-prix4",
  "nome_exibicao": "Toledo Prix IV Uno",
  "transporte": "ethernet",
  "transportes": ["ethernet", "serial"],
  "ativo": true,
  "status": "homologado"
}
```

## Alterações

| Arquivo | Mudança |
|---------|---------|
| `sdk/DriverAdapter.js` | **Novo** |
| `sdk/DriverSdkController.js` | `/drivers` e `/drivers/:id` passam pelo adapter |
| `sdk/index.js` | `listarDrivers` / `obterDriver` retornam contrato ERP |
| Front `equipamentos.js` | **Sem alteração** |

## Evidências

```text
npm run test:driver-adapter  →  8/8
npm run test:device-sdk      →  11/11
```

Combo Nova balança: `nome_exibicao` + `value=TOLEDO_PRIX4_UNO` (após reload do ERP).
