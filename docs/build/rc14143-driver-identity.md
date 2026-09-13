# RC14.14.3 — Consolidação Final da Arquitetura Oficial Toledo V3.0

## Objetivo

Uma identidade oficial ERP: **`TOLEDO_PRIX4_UNO`**, com aliases resolvidos automaticamente.

## Identidade

| Papel | Valor |
|-------|--------|
| Código oficial ERP | `TOLEDO_PRIX4_UNO` |
| ID SDK (compat) | `toledo-prix4` |
| Alias runtime legado | `TOLEDO_PRIX4` |
| Nome exibição | Toledo Prix IV Uno |
| Runtime 90AX | `ToledoPrixIVDriver` |
| Plugin Discovery | `ToledoPrix4UnoDriver` (BaseDriver) |

## Pipeline oficial

```
ERP
  → DriverIdentityResolver
  → OfficialDriverLoader
  → DriverRegistry (SDK + Plugin + aliases)
  → ToledoPrixIVDriver (ops / connect / diagnóstico)
  → Operation Engine
  → ConnectionManager
  → TcpConnection
  → ToledoFrameBuilder
  → Socket TCP
  → ToledoRxBuffer
  → ToledoFrameParser
  → ToledoAckRouter
  → Resultado
```

## Componentes novos

| Arquivo | Função |
|---------|--------|
| `sdk/DriverIdentityResolver.js` | Canonicaliza aliases |
| `sdk/OfficialDriverLoader.js` | Load único + aliases |
| `sdk/DriverIdentityAudit.js` | Auditoria estrutural |

## Compatibilidade

Entradas aceitas: `TOLEDO_PRIX4` | `TOLEDO_PRIX4_UNO` | `toledo-prix4`  
Persistência / APIs ERP: sempre `TOLEDO_PRIX4_UNO`  
SDK preserva `codigo_sdk: toledo-prix4`

## Testes

```bash
npm run test:driver-identity
npm run test:device-sdk
npm run test:certification-v2
npm run test:connection-unification
npm run test:protocol-unification
npm run test:equipamentos-14x
```

## Encerramento

Esta RC encerra a consolidação do Motor Universal de Equipamentos V1.0 (conexão RC14.14.1 + protocolo RC14.14.2 + identidade RC14.14.3).
