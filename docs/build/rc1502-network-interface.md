# RC15.0.2 — Diagnóstico de Interface de Rede (Ethernet / WLAN)

## Problema

O Diagnóstico Enterprise exibia **Transporte: ethernet** (caminho CDS TCP) mesmo quando a balança operava via **WLAN**, induzindo o operador a achar que havia cabo físico.

## Correção

| Campo | Significado |
|-------|-------------|
| **Protocolo** | `TCP/IP` (comunicação) |
| **Interface** | `ETHERNET` \| `WLAN` \| `UNKNOWN` (meio físico na balança) |

- Driver: `ToledoPrixIVDriver.getNetworkInterface()`
- Helpers: `ToledoNetworkInfo` (`montarNetwork`, `normalizarInterface`)
- Diagnóstico JSON: bloco `network` (substitui o uso de `transport` no painel)
- Painel: Protocolo / Interface / IP / Porta separados

## Regra

Nunca assumir Ethernet como padrão. Se o firmware/cadastro não informar → **Não informado pelo equipamento** (`UNKNOWN`).

## Compatibilidade

Não altera ConnectionManager, DriverRegistry, Operation Engine nem o protocolo TCP/IP.

## Testes

```bash
npm run test:network-interface
npm run test:diagnostics-panel-v1
npm run test:diagnostics-unification
npm run test:tcp-connect-audit
```
