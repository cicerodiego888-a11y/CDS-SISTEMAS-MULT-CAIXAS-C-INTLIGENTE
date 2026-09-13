# Marco oficial — RC5 Hardening Comercial / MTS / Reservas

| Campo | Valor |
|---|---|
| **Nome** | RC5 — Hardening Motor Comercial × MTS × Reservas |
| **Versão** | 5.0 FINAL |
| **Status** | **CERTIFICADA / CONGELADA** |
| **Data** | 2026-07-27 |
| **Escopo** | Blindagem MTS, tokens supervisor, reconciliação e reparo de reservas |

---

## Declaração

A partir desta data, a RC5 é considerada **versão estável e certificada**.

Fluxo canônico protegido:

```
Pedido → Motor Comercial → (Supervisor Token) → MTS → Reserva Fiscal (F×NF)
                ↓
        Reconciliação (READ-ONLY)
                ↓
        Plano de Correção (simulação)
                ↓
        ReservaRepairService (DRY_RUN padrão / handlers reais)
```

### Congelado (não alterar sem nova RC)

- Blindagem interna `MtsService.transferirSaldo` (`contextoAutorizacao`)
- Recálculo do plano sob `BEGIN IMMEDIATE` (anti race)
- Token supervisor: `jti` (uso único) + escopo (`pedido_id`, `produtos`, `quantidades`)
- Reconciliação READ-ONLY com evidências e `plano_correcao`
- Executor `ReservaRepairService` com `dryRun` padrão `true`
- Handlers reais: `LIBERAR_RESERVA`, `REMOVER_RESERVA`, `CRIAR_RESERVA`, `AJUSTAR_RESERVA`

### Proibido sem nova RC

- Expor reparo automático em produção sem gate operacional / aprovação
- Remover DRY_RUN como default do executor
- Contornar `contextoAutorizacao` no MTS
- Acoplar Pedido diretamente a F×NF / MTS (bypass Motor Comercial)

---

## Módulos implementados

| Módulo | Caminho | Papel |
|---|---|---|
| Motor Comercial | `backend/motores/comercial/MotorComercialService.js` | Orquestração Pedido → MTS → Reserva; recálculo pós-lock; escopo do token |
| MTS | `backend/motores/mts/MtsService.js` | Transferência de saldos; exige contexto de autorização |
| Auth Supervisor | `backend/rotas/auth.js` | Emissão/validação com `jti` + claims de escopo |
| Reconciliação | `backend/motores/comercial/ReservaReconciliationService.js` | Detecção READ-ONLY + evidências + plano simulado |
| Reparo | `backend/motores/comercial/ReservaRepairService.js` | Executor DRY_RUN + handlers reais |
| Auditoria | `backend/motores/comercial/PedidoEstoqueAuditoria.js` | Eventos `REPARO_*` |
| Fachada | `backend/motores/comercial/index.js` | Export público interno |

### Handlers ReservaRepairService

| Ação | Status | Auditoria |
|---|---|---|
| `LIBERAR_RESERVA` | Implementado | `REPARO_LIBERAR_RESERVA` |
| `REMOVER_RESERVA` | Implementado | `REPARO_REMOVER_RESERVA` |
| `CRIAR_RESERVA` | Implementado | `REPARO_CRIAR_RESERVA` |
| `AJUSTAR_RESERVA` | Implementado | `REPARO_AJUSTAR_RESERVA` |
| `ANALISE_MANUAL` | **Não implementado** (proposital) | — |

---

## Rotas

| Superfície | Situação |
|---|---|
| `POST /api/auth/supervisor/authorize` | Pública (auth); emite token com `jti` + escopo do body |
| Pedido → Motor Comercial | Interno via serviços (`PedidoService` / `PedidoOperacionalService`) |
| `reconciliarReservas` / `executarPlanoCorrecao` | **Somente API de módulo** (fachada comercial) — sem rota HTTP pública nesta RC |

---

## Migrações / schema

Não houve migração SQL dedicada na RC5.

Tabelas garantidas por `CREATE TABLE IF NOT EXISTS` em `backend/database.js` e schemas locais dos motores:

- `movimentos_transferencia_saldos`
- `pedido_estoque_reservas`
- `auditoria_pedido_estoque_fiscal`

Nenhuma alteração destrutiva de schema.

---

## Cobertura de testes (certificação 2026-07-27)

| Suíte | Resultado |
|---|---|
| `tests/mts/mts-v1.test.js` | **9/9** |
| `tests/faturamento/rc3161-pedido-motor-comercial-mts.test.js` | **9/9** |
| `tests/faturamento/rc514-token-uso-unico.test.js` | **5/5** |
| `tests/faturamento/rc515-token-escopo.test.js` | **5/5** |
| `tests/faturamento/rc521-reserva-reconciliation.test.js` | **11/11** |
| `tests/faturamento/rc531-reserva-repair.test.js` | **29/29** |
| **Total RC5** | **68/68 OK** |

Validação cruzada: Pedido ↔ Motor Comercial ↔ MTS ↔ Reconciliação ↔ Repair — exercitada pelas suítes acima.

---

## Riscos conhecidos

1. **Frontend sem escopo no authorize** — ERP/PDV ainda podem emitir token sem `pedido_id`/`produtos`/`quantidades`; o Motor Comercial rejeita com `TOKEN_FORA_DO_ESCOPO` até o cliente enviar o escopo.
2. **Store de `jti` em memória** — reinício do processo esvazia o registro de uso; tokens não expirados poderiam ser reutilizados uma vez após restart.
3. **Reparo sem rota HTTP / UI** — handlers prontos, mas operação ainda é programática; risco operacional se expostos sem autenticação/aprovação.
4. **`ANALISE_MANUAL` sem handler** — inconsistências de estoque negativo / produto inexistente exigem intervenção humana.
5. **`JWT_SECRET` de desenvolvimento** — ambiente de teste emite warning; produção deve definir segredo forte.

---

## Pendências (pós-RC5)

- [ ] Frontend: enviar escopo no `POST /auth/supervisor/authorize`
- [ ] Rota administrativa opcional para reconciliação/reparo (com RBAC + confirmação)
- [ ] Persistência de `jti` consumidos (ou blacklist) se multi-instância for necessária
- [ ] Handler/UX para `ANALISE_MANUAL` (somente registro/ticket)
- [ ] Job agendado de reconciliação (READ-ONLY) em produção

---

## Recomendação para produção

**APROVADO para produção** nos seguintes termos:

1. Manter `dryRun: true` como default em qualquer chamada automática de reparo.
2. Habilitar execução real (`dryRun: false`) apenas sob operação assistida / aprovação explícita.
3. Completar o envio de escopo no frontend **antes** de depender do fluxo supervisor em massa.
4. Garantir `JWT_SECRET` definido no ambiente de produção.
5. Monitorar auditoria `REPARO_*` e inconsistências da reconciliação.

---

## Aprovações de certificação (checklist)

- [x] Suíte RC5 completa (68 testes)
- [x] Validação cruzada Motor Comercial × MTS × Reconciliação × Repair
- [x] Cobertura dos handlers reais (4/5; ANALISE_MANUAL intencional)
- [x] Revisão de rotas públicas e superfícies internas
- [x] Validação de schema (sem migração destrutiva)
- [x] Documentação técnica publicada

---

**Assinatura do marco:** CDS Sistemas — RC5 Hardening Comercial/MTS/Reservas — **CERTIFICADA** — 2026-07-27.
