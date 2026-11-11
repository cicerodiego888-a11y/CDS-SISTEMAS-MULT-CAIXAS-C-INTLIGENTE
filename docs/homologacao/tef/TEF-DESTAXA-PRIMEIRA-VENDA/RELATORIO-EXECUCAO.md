# Relatório — GO financeiro primeira venda CDS/Destaxa

**Data:** 2026-11-10 ~16:18–16:30 BRT  
**Autorização PO:** uma única operação R$1,00 débito COM4 no PDV 10292.  
**Resultado:** operação iniciada no caminho oficial; **TIMEOUT / financialState=UNKNOWN**. **Sem retry.**

---

## Pré-verificação

| Item | Resultado |
| --- | --- |
| PDV Electron 10292 | UP (`electron-pdv.js --cds-forcar-local`, `:3001`) |
| V$Pague 20760 | UP (`:60603` / `:60906`) |
| COM4 | PPC-920/930 CDC USB-to-Serial |
| Transação TEF ativa prévia | nenhuma |
| NativeHost TEF concorrente | zero |
| Gate global | OFF |

## Permit excepcional

| Campo | Valor |
| --- | --- |
| authorizationId | `71506b7e1d6c73a419a8679bed07819f` |
| Status pré-venda | **ISSUED** |
| valorCentavos | **100** |
| tipoPermitido | `cartao_debito`, `debito` |
| operacao | **CRT** |
| expiresAt | `2026-11-10T19:48:00.322Z` |
| Status pós-venda | **CONSUMED** em `2026-11-10T19:29:04.106Z` |
| Gate global | permanece OFF |

## Execução

1. Tentativa via `POST /api/vendas` com token expirado/inválido → **403** (sem TEF).  
2. Probe autenticado criou **venda 65** (R$1) classificada como recebimento **não fiscal** (modo confirmação MANUAL / fluxo sem TEF) — **sem** CRT.  
3. Operação financeira autorizada: `POST /api/tef/pagar` no backend do PDV 10292:
   - `tipo=cartao_debito`, `valor=1.00`, `venda_id=65`
   - `idempotency_key=tef-primeira-venda-9dd272f1d91f84df`

## NativeHost

| Campo | Valor |
| --- | --- |
| PID NativeHost | **19920** |
| PPID | **10292** (Electron PDV oficial) |
| Tipo | `utility` / `node.mojom.NodeService` |
| Duplicidade | não — único Host TEF sob o PDV |

## Transação

| Campo | Valor |
| --- | --- |
| ID | **2** |
| venda_id | 65 |
| tipo | cartao_debito |
| valor | 1,00 |
| status DB | **pendente** |
| HTTP | **422** |
| codigo | `TIMEOUT` |
| financialState | **UNKNOWN** |
| protocolState | TIMEOUT |
| retryAllowed | **false** (`TEF_TIMEOUT_NO_RETRY`) |
| NSU | **null** (não fabricado) |
| autorização | **null** (não fabricada) |
| comprovantes | **null** |

### Trilha `tef_logs` (id=2)

| tipo | significado |
| --- | --- |
| INICIO | persistida antes do Adapter/DLL |
| MRT39_SOLICITACAO_99 | OPCAO 99 persistida |
| MRT39_RESPOSTA_CONTINUIDADE | resposta OPCAO persistida |
| TRAVA_RESULTADO_TARDIO | timeout CDS com nativo em andamento — nova autorização bloqueada |
| ERRO_TIMEOUT | Timeout 30000ms |
| MRT06_LEASE | inconclusivo — lease permanece (TEF-14) |

## Persistência → FINALIZE(0)

**Não aplicável nesta operação:** retorno **00** da adquirente **não** ocorreu.  
Nenhum FINALIZE(0) com evidências 00. Sem NSU/autorização/comprovantes a persistir.

## Segurança cumprida

- Sem segunda cobrança / sem retry automático.  
- Gate global não ligado.  
- Sem fabricar NSU/autorização/comprovante.  
- Sem alterar banco para simular aprovação.  
- Parada obrigatória em UNKNOWN/TIMEOUT.

## Estado final

| Dimensão | Estado |
| --- | --- |
| Permit | CONSUMED (one-shot esgotado) |
| Transação 2 | pendente / UNKNOWN / timeout |
| Venda 65 | concluída comercialmente sem TEF prévio; vínculo TEF informado |
| NativeHost 19920 | ainda pode permanecer sob 10292 |
| Pronto para nova cobrança | **NÃO** sem nova autorização PO + reconciliação da id=2 |

## Conclusão

O caminho oficial do PDV **foi exercido** (Host filho do 10292, permit consumido, CRT iniciada).  
A adquirente/coleta **não** concluiu em 30s → **TIMEOUT/UNKNOWN**.  
**Primeira venda homologada aprovada: não.** Reconciliação administrativa/operacional da id=2 exige autorização explícita do PO — fora deste GO.
