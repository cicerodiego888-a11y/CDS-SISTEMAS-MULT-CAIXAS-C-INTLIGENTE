# RC15.6 — Auditoria da Origem da Sessão no Upload PLU

## Problema

Diagnóstico reportava **Conexão OK**, mas o Upload falhava com `Connection Manager: não conectado` — sessão obtida por chaves diferentes (`eq:N` vs `hp:host:porta`).

## Correção

1. **ConnectionPool.get** resolve aliases (`eq` ↔ `hp`).
2. **SessionOriginAudit** instrumenta Diagnóstico e Upload com os mesmos campos.
3. Diagnóstico e Upload passam **equipamentoId + host + porta**.
4. Se divergir → `UPLOAD_USANDO_SESSAO_DIFERENTE`.

## Log

```
===== UPLOAD SESSION =====
Equipamento:
1
Host:
10.0.0.170
Porta:
9000
Session Key:
eq:1
Connected:
true
Persistent:
true
Manager Instance:
0x001A
=========================
```

Idêntico no Diagnóstico (`===== DIAGNOSTIC SESSION =====`).

## Critério

Diagnóstico → EquipmentSession → Upload = **mesmo objeto**, mesma referência, estado `CONNECTED`.

## Teste

```
npm run test:upload-session-origin
```
