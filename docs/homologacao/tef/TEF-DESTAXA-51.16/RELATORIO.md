# TEF-DESTAXA-51.16 — Homologação CRT real pelo PDV vivo

**Status:** CONCLUÍDA (interrupção no preflight)  
**Coleta:** 2026-11-09 **17:11–17:13** America/Sao_Paulo  
**Autorização financeira do usuário:** EXPRESSA (1× débito R$ 1,00)  
**Resultado geral:** **NO-GO — BLOQUEADO ANTES DA EMISSÃO / CRT**  
**Tentativa financeira 51.16:** **NÃO INICIADA**

Base: 51.15 GO avaliação · 51.14 PDV vivo · 51.12 rota TefManager · 51.10/51.03 UNKNOWN preservados

Artefatos: `preflight.json`, `pendentes.json`, `vspague-tail-pre.txt`, `check-pendentes.js`

---

## Resumo executivo

A autorização expressa **não foi usada**. O preflight encontrou **transação `tef_transacoes.id=1` em status `pendente`** (Destaxa, R$ 1,00 débito, criada `2026-11-09 16:58:43`, atualizada `16:59:12` — alinhada ao consumo da auth 51.03 `5aed71f2…`). O contrato `criarTransacaoExclusiva` **impede novo INSERT** enquanto existir qualquer `pendente`. Resolver essa linha exigiria cancelamento/FINALIZE/reconciliação — **proibidos** para UNKNOWN históricos nesta sprint.

**CRT não executada. Auth excepcional 51.16 não emitida. Gate permanece OFF. UNKNOWN 51.10 e autorizações CONSUMED preservados.**

---

## 1. Autorização excepcional 51.16

| Campo | Valor |
| --- | --- |
| Emitida | **Não** |
| authorizationId | N/A |
| Motivo | Preflight essencial falhou (§2.10 / §3) |

Uso único: **não aplicável** (nada emitido).

---

## 2. Preflight (antes da emissão)

### 2.1 Ambiente vivo

| Item | Resultado | Classificação |
| --- | --- | --- |
| PID 18236 | Vivo, Responding, título **CDS Sistemas - PDV** | **OK** |
| Workspace / CommandLine | `...\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE\...\electron.exe electron-pdv.js --cds-forcar-local` | **OK** |
| Backend HTTP 3001 | LISTEN PID 18236 · HTTP **200** | **OK** |
| TefManager (51.14/15) | Carregado no boot / caminho auditado | **OK** |
| Segunda main PDV | 1 | **OK** |
| V$Pague PID 10256 | Responding; start 12:24:10 | **OK** |
| TCP 60906 | LISTEN → 10256 | **OK** |
| COM4 / PPC-920/930 | Status **OK** | **OK** |
| NativeHost / runner 51.10 | 0 | **OK** |
| Gate global | OFF (`0` / vazio / vazio) | **OK** |
| Ledger | SHA `EF6865C4…`; só CONSUMED (`5aed71f2…`, `ba08c88e…`); ISSUED=0 | **OK** |
| `tx-5110-…` | UNKNOWN preservado | **OK** |
| Reinício de processos | **Não** | **OK** |

### 2.2 Logs V$Pague (passivo)

Última atividade: **15:57:53** (encerramento 51.10). Sem atividade nova.

| Keyword | Achado | Classificação |
| --- | --- | --- |
| `TABELA EXPIRADA` | Histórico **13:59:11** | **ATENÇÃO** |
| `00151` | Histórico **11:47:48** | **ATENÇÃO** |
| Timeouts / Connection breaked / ERROR PinPad | Históricos 51.10 | **ATENÇÃO** |

Não bloqueantes sozinhos nesta coleta; o bloqueio determinante é o §2.3.

### 2.3 Transação pendente — **BLOQUEIO ESSENCIAL**

Consulta **somente leitura** (`node:sqlite` readonly) em `C:\ProgramData\MercantilFiscal\dados\mercadao.db`:

| Campo | Valor |
| --- | --- |
| id (PK / lastID) | **1** |
| status | **pendente** |
| valor | 1.00 |
| tipo | cartao_debito |
| provedor | destaxa |
| idempotency_key | `tef-fp-90b41858f0aff5d47c573e5c3d86bc62` |
| venda_id | null |
| criado_em | 2026-11-09 16:58:43 |
| atualizado_em | 2026-11-09 16:59:12 |

Correlação: auth `5aed71f2…` CONSUMED em `2026-11-09T16:58:43.030Z` (51.03). Linha UNIQUE pendente no banco.

**Efeito no fluxo 51.12/TefManager:**

```sql
INSERT … WHERE NOT EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')
```

→ `changes = 0` → `transacaoId == null` → **Adapter/DLL não chamados**; nova CRT **impossível** sem remover/alterar o pendente.

| Ação possível | Permitida nesta sprint? |
| --- | --- |
| Cancelar / FINALIZE / reconciliar id=1 | **Não** (UNKNOWN histórico / sem retry-recuperação) |
| UPDATE artificial status | **Não** |
| Segunda CRT “por cima” | **Não** (INSERT exclusivo) |
| Emitir auth 51.16 mesmo assim | **Não** (§3: interromper se requisito falhar) |

**Classificação:** **BLOQUEADO**

---

## 3. Execução CRT

| Etapa | Status |
| --- | --- |
| Emissão auth excepcional | **Não** |
| `TefManager.autorizar` | **Não** |
| INSERT / lastID novo | **Não** |
| Adapter / CRT / 99 / CONTINUE | **Não** |
| Runner 51.10 | **Não** |
| Segunda tentativa | **Não** |

---

## 4. Resultado financeiro 51.16

| Campo | Valor |
| --- | --- |
| Classificação | **N/A — operação não iniciada** |
| NSU / autorização / comprovantes | Ausentes (não inventados) |
| Auth excepcional 51.16 | Não emitida → **não reutilizável** (inexistente) |

---

## 5. Preservação histórica

| Item | Estado |
| --- | --- |
| `tx-5110-2dbbb6922eb64990` | UNKNOWN intacto |
| `ba08c88e…` / `5aed71f2…` | CONSUMED intactas |
| `tef_transacoes.id=1` pendente | **Não alterado** (leitura apenas) |
| Ledger mtime | 2026-11-09T18:54:48.282Z (inalterado nesta sprint) |

---

## 6. Resultado geral

# **NO-GO**

**Motivo:** pendência exclusiva `tef_transacoes.id=1` (status `pendente`) bloqueia `criarTransacaoExclusiva` / novo lastID. Interrupção **antes** da emissão da autorização excepcional e **antes** de qualquer CRT.

### Próximo passo (exige autorização expressa **nova** e específica)

Tratar o destino seguro de `id=1` em sprint dedicada (política UNKNOWN / reconciliação controlada / desfecho sem nova cobrança), **sem** reutilizar a autorização financeira verbal da 51.16 para uma segunda CRT. Somente após o caminho de INSERT exclusivo estar livre, reavaliar emissão one-shot + CRT PDV.

---

## 7. Escopo respeitado

| Restrição | Cumprida |
| --- | --- |
| Sem CRT / TX_* / pagamento / cartão | Sim |
| Sem emissão/consumo auth 51.16 | Sim |
| Sem gate ON | Sim |
| Sem runner sintético | Sim |
| Sem retry/recuperação/FINALIZE do pendente | Sim |
| Sem alteração fiscal / fluxo produção | Sim |
| UNKNOWN históricos preservados | Sim |

**A autorização expressa desta 51.16 não foi consumida e não pode ser reutilizada como se a CRT tivesse ocorrido.** Nova operação financeira exige nova autorização expressa do usuário.
