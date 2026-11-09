# TEF-DESTAXA-51.23 — Preparação da reconciliação controlada da operação id=1

**Status:** CONCLUÍDA (preparação técnica; **sem** alteração financeira/banco)  
**Coleta:** 2026-11-09 ~18:27–18:30 America/Sao_Paulo  
**Base:** 51.17–51.22  
**Operação financeira:** **NÃO EXECUTADA**  
**`tef_transacoes.id=1`:** **intacta**  
**PDV PID 18324 / V$Pague PID 10256:** **intactos** (confirmados Responding)

Artefato de teste: `tests/tef/tef-destaxa-51-23-reconciliacao-matriz.test.js` (**12/12 OK**)

---

## Resumo executivo

O CDS já possui reconciliação **explícita** (`reconciliarResultadoTardio` → `reconciliarNativeHost`) com confirmação de operador, estados finais `CONFIRMED_SUCCESS` / `CONFIRMED_DENIED` / `CANCELLED`, e bloqueio global enquanto houver linha `pendente`. **Não** existe caminho que encerre `UNKNOWN` automaticamente a partir de timeout, resposta 78, código 99, ausência de NSU ou “não localizada”. A matriz A–F está documentada; lacunas (inexistente sem estado nativo; NSU não gravado no fluxo atual de reconciliação) exigem sprint futura **após** resposta formal Destaxa + decisão expressa.

---

## 1. Arquivos e funções investigados

| Arquivo | Funções / pontos |
| --- | --- |
| `backend/services/tef/TefManager.js` | `STATUS_POR_RECONCILIACAO`, `validarRegistroReconciliacao`, `garantirRecuperacao`, `recarregarPendencias`, `_bloquearNovaAutorizacaoSePendente`, `reconciliarResultadoTardio`, `reconciliarNativeHost`, `_registrarResultadoTardio` |
| `backend/services/tef/tefRepository.js` | `criarTransacaoExclusiva`, `listarTransacoesPendentes`, `atualizarTransacao` |
| `backend/services/tef/tefPendenciasService.js` | `classificarPendencia`, `listarPendenciasOperacionais`, `tentarLiberarInconclusiva`, `reconciliarExplicita`, `ESTADOS_FINANCEIROS_RECONCILIACAO` |
| `backend/services/tef/tefFinancialSafetyPolicy.js` | `FINANCIAL_STATES`, `classificarCodigoFinanceiro` (99/08/00/03…) |
| `backend/services/tef/tefReconciliationEvidence.js` | evidências assinadas RELEASE/COMMIT |
| `backend/services/tef/destaxa/destaxaNativeHostProtocolo.js` | estados finais de reconcile no Host |
| Evidências 51.17 / consulta 51.18 | identidade e horários id=1 |

**Produção não alterada nesta sprint.**

---

## 2. Arquitetura atual de reconciliação

```text
tef_transacoes.status='pendente'
        │
        ├─► criarTransacaoExclusiva  → INSERT bloqueado (NOT EXISTS pendente)
        ├─► recarregarPendencias     → trava memória RECONCILIACAO_PENDENTE
        │                              + log TEF_RESULTADO_PENDENTE_RECUPERADO
        │                              + bootstrap bloqueia novas TX
        │
        └─► reconciliação EXPLÍCITA (operador)
              1) reconciliarResultadoTardio
                 · exige trava RECONCILIACAO_PENDENTE
                 · financialState ∈ {CONFIRMED_SUCCESS, CONFIRMED_DENIED, CANCELLED}
                 · usuario + observacao + confirmacao_explicita===true
                 · grava payload.reconciliacao; status permanece pendente neste passo
                 · travaLiberada: false
              2) reconciliarNativeHost
                 · valida resultado + identidade
                 · autorização release/commit assinada no Host
                 · atualiza status final (aprovado|negado|cancelado)
                 · evidências TEF_RECONCILIACAO_* 
                 · remove trava / atualiza bootstrap
```

`tefPendenciasService.tentarLiberarInconclusiva()` → sempre **`TEF_LIBERACAO_INCONCLUSIVA_PROIBIDA`**.

Não há cliente CDS de “consulta Destaxa” que altere status; a consulta 51.18 é **externa/manual**.

---

## 3. Estados financeiros e operacionais

### Financeiros (`tefFinancialSafetyPolicy` / reconciliação)

| Estado | Uso na reconciliação explícita |
| --- | --- |
| `CONFIRMED_SUCCESS` | → status `aprovado` |
| `CONFIRMED_DENIED` | → status `negado` |
| `CANCELLED` | → status `cancelado` |
| `UNKNOWN` / `PENDING` / `UNCONFIRMED` / … | **não** aceitos em `STATUS_POR_RECONCILIACAO` |

### Operacionais (travas / pendências)

| Estado | Significado |
| --- | --- |
| `AGUARDANDO_RESULTADO_TARDIO` | chamada nativa ainda em curso |
| `RECONCILIACAO_PENDENTE` | desfecho inconclusivo; permite reconciliação explícita |
| `PENDENTE_SEM_TRAVA_MEMORIA` | linha DB pendente sem trava (até recuperação) |
| `ORFA_SEM_VENDA` | `venda_id` null (caso id=1) |
| `PENDING_WITH_EVIDENCE` (51.17) | classificação operacional documental |

id=1 (51.17): financeiro **UNKNOWN**, operacional **PENDING_WITH_EVIDENCE**, NSU/autorização **NULL**.

---

## 4–5. Matriz de decisão (cenários A–F)

Identificadores a citar em qualquer procedimento futuro:  
`id=1`, `op_ef2ed65b9230_744378e59797f9a7`, `d3cd929385f4281e`, `tef-fp-90b41858…`, auth `5aed71f2…` CONSUMED, janela 2026-11-09 13:58–14:06 (UTC−3).

### A — Destaxa confirma operação **inexistente**

| Item | Conteúdo |
| --- | --- |
| Evidências mínimas | Protocolo escrito Destaxa com IDs/horários; declaração de inexistência no ambiente; referência ao ticket 51.18 |
| Procedimento interno possível (futuro) | Avaliar reconciliação explícita como `CANCELLED` **somente** se Product Owner mapear “inexistente” → cancelamento documental — **ou** sprint que introduza estado/procedimento dedicado |
| Lacuna | **Não há** `financialState` nativo “INEXISTENTE”; gate rejeita estados fora do mapa |
| Nesta sprint | **Não executar** |

### B — Destaxa confirma operação **recusada**

| Item | Conteúdo |
| --- | --- |
| Evidências | Protocolo com recusa emissor/adquirente; IDs; sem NSU de aprovação |
| Mapeamento CDS | `CONFIRMED_DENIED` → `negado` via `reconciliarResultadoTardio` + `reconciliarNativeHost` |
| Requisitos | `usuario`, `observacao` (citando protocolo), `confirmacao_explicita: true`, trava `RECONCILIACAO_PENDENTE` |
| Nesta sprint | **Não alterar status** |

### C — Destaxa confirma operação **cancelada**

| Item | Conteúdo |
| --- | --- |
| Evidências | Protocolo de cancelamento remoto (não basta V$Pague “resposta 78”) |
| Mapeamento CDS | `CANCELLED` → `cancelado` |
| Preservar | logs 51.17, payload, IDs, protocolo Destaxa anexado na `observacao`/auditoria |
| Nesta sprint | **Não executar cancelamento** |

### D — Destaxa confirma operação **aprovada**

| Item | Conteúdo |
| --- | --- |
| Evidências | **NSU**, **código de autorização**, valor R$ 1,00, data/hora, captura/liquidação se houver |
| Mapeamento CDS | `CONFIRMED_SUCCESS` → `aprovado` |
| Lacuna | `reconciliarNativeHost` atualiza **status**, mas **não** grava automaticamente `nsu`/`autorizacao` a partir do protocolo Destaxa — sprint futura deve definir persistência desses campos + política de **não** criar venda/baixa sem auth fiscal |
| Nesta sprint | **Não finalizar**, **não** vincular venda, **não** baixar |

### E — Destaxa confirma **pendente/inconclusiva**

| Item | Conteúdo |
| --- | --- |
| Ação | Manter **UNKNOWN** / `pendente`; continuar bloqueio de nova CRT |
| Gate | `financialState: UNKNOWN` → `TEF_RECONCILIACAO_INVALIDA` |
| Nesta sprint | **Sem retry / sem nova operação** |

### F — Destaxa **não localiza** a operação

| Item | Conteúdo |
| --- | --- |
| Ação | Manter **UNKNOWN** até evidência suficiente |
| Regra | Não localizar **≠** prova de inexistência financeira |
| Nesta sprint | **Sem encerramento** |

### Sinais fracos (proibidos como desfecho)

Timeout · resposta **78** · código **99** · ausência de NSU local · verbal sem protocolo · `status=pendente` sozinho → **nunca** encerram UNKNOWN automaticamente (testes 51.23).

---

## 6. Lacunas identificadas

1. Sem integração CDS→API Destaxa de consulta (apenas consulta manual 51.18).  
2. Sem `financialState` para “inexistente” (cenário A).  
3. Reconciliação de sucesso não persiste NSU/autorização Destaxa no fluxo atual.  
4. id=1 exige trava `RECONCILIACAO_PENDENTE` recuperada; PDV vivo (51.22) reconstrói pendências no boot — **não** verificado operacionalmente nesta sprint (proibido tocar runtime financeiro).  
5. Liberar `criarTransacaoExclusiva` só após status deixar de ser `pendente` por caminho formal.

---

## 7. Testes executados

```text
node tests/tef/tef-destaxa-51-23-reconciliacao-matriz.test.js
→ 12 ok, 0 falhou
```

Cobertura: fontes STATUS/pendências/política; cenários A–F; sinais fracos; bloqueio INSERT exclusivo; preservação do mock id=1.

Sem banco operacional de escrita · sem SQLite temp · sem NativeHost/DLL.

---

## 8. Arquivos modificados

| Arquivo | Ação |
| --- | --- |
| `tests/tef/tef-destaxa-51-23-reconciliacao-matriz.test.js` | **Criado** |
| `docs/homologacao/tef/TEF-DESTAXA-51.23/RELATORIO.md` | **Criado** |
| Código de produção | **Nenhuma alteração** |

SHA256 teste: `78456462EDE788216910BBC3B54C839406437BD7A020F8E8E9AF582A04959299`

---

## 9–10. Confirmações

- Nenhuma CRT / TX_* / gate ON / auth excepcional / UPDATE-DELETE id=1.  
- id=1 permanece conforme 51.17/51.21 (não reescrita).  
- PDV **18324** e V$Pague **10256** Responding após a sprint.

---

## Critério de conclusão

| Critério | Status |
| --- | --- |
| Fluxo de reconciliação documentado | **OK** |
| Seis cenários analisados | **OK** |
| Limites de segurança comprovados (testes) | **OK** |
| UNKNOWN não encerrado automaticamente | **OK** |
| Sem alteração financeira/persistência operacional | **OK** |

**Próximo passo:** aguardar resposta formal Destaxa + **nova decisão expressa** do usuário para sprint de encerramento seguro do cenário aplicável. **Não autoriza CRT.**
