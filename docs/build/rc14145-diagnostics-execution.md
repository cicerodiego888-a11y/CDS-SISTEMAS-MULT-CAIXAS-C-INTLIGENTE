# RC14.14.5 — Correção do Diagnóstico Enterprise (Execução Real)

## Problema

O botão **Atualizar Diagnóstico** montava relatório estático com:

- etapas `NAO_INICIADO`
- `probe: null`
- `connection_trace: null`
- `equipamento.ip` / `network.ip` nulos

mesmo com a balança online (ping e porta 9000 OK).

Causa: o pipeline não recebia IP (só lia `equipamento.ip`, ignorando `ultimo_ip` / identidade) e o probe ativo não era disparado.

## Correção

| Item | Detalhe |
|------|---------|
| Resolução de alvo | `resolverAlvoDiagnostico()` — host/porta via query, `ip`, `ultimo_ip`, `ip_atual` |
| Central | `diagnosticar()` enriquece com identidade e força `probe: true` |
| Probe | Connect → Handshake → Health → Read (ping) |
| Sem IP | TCP = `TCP_CONNECT_IP_MISSING`; demais = **Não executado** (nunca `NAO_INICIADO`) |
| JSON | `probe` e `connection_trace` sempre populados quando diagnóstico é solicitado |
| Front | Atualizar prefere POST `/{id}/diagnostico`; GET com `probe=1` + host obrigatório |

## Aceite

- Comunicação real ao atualizar diagnóstico
- `connection_trace` e `probe` ≠ null
- IP preenchido quando conhecido
- Etapas refletem falha real
- Arquitetura do Motor Universal inalterada

## Testes

```bash
npm run test:diagnostics-execution
npm run test:tcp-connect-audit
npm run test:diagnostics-unification
npm run test:diagnostics-panel-v1
```
