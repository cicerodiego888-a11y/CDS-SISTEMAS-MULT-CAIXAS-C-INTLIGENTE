# TEF-DESTAXA-51.35 — LOAD + INIT_CLIENT Destaxa

**Data:** 2026-11-10 ~15:51–15:53 BRT  
**Autorização PO:** LOAD + exclusivamente `INIT_CLIENT` / `iniciaClientDestaxa`; sem TX/CRT/gate.  
**Evidências:** `evidencias-51-35.json`, runner `tef-51-35-runner.js`, flag `keep-alive-ready.flag`

---

## 1. Pré-condições

| Item | Resultado |
| --- | --- |
| PDV Electron | **UP** PID **10292** |
| Backend `:3001` | `GET /login` → **200** |
| V$PagueClient | PID **20760** (15:36:59) |
| 60603 / 60906 | LISTENING → **20760** |
| NativeHost prévio | **NONE** |
| DLL | `resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` — **1.83 64bit**, arch processo **x64** |
| Gate | **OFF** (`unset`; runner força `'0'` no processo) |

---

## 2. Execução

| Passo | Evidência |
| --- | --- |
| Fluxo | `inicializarNativeHostIsolado` + `permitirInicializacaoClientDestaxa: true` |
| NativeHost | PID **2176** (`utilityProcess` / Electron NodeService), PPID **15164** (runner) |
| hostSessionId | `f345d40989ecb15cf1c54c58ffb2bb9d` |
| Bootstrap | `SECURITY_BOOTSTRAP_VALIDATED` rev 1 (~177 ms) |
| **LOAD** | **sucesso**; `dllLoaded=true`, `exportsValid=true`, `dllLoads=1`, path win-x64 |
| **INIT_CLIENT** | requestId **`efd35c9a67e295f5`** → resultCode **`00`** |
| Retorno automação | código **00**, `CLIENT_INITIALIZED`, msg “Client Destaxa inicializado”, ~**7,7 ms** nativo / **324 ms** etapa |
| **STATUS** final | `dllLoaded=true`, `clientInitialized=true`, `clientResultCode=00`, `gateReal=false`, `operacaoAtiva=null` |
| Keep-alive | **Sim** — Host mantido para inspeção (sem TX) |

### Correlação (observability)

| Evento | requestId | resultCode | UTC |
| --- | --- | --- | --- |
| `client.init.start` | efd35c9a67e295f5 | — | 18:52:37.711Z |
| `native.call.enter` `iniciaClientDestaxa` | efd35c9a67e295f5 | — | 18:52:37.715Z |
| `native.call.return` | efd35c9a67e295f5 | **00** | 18:52:37.726Z |
| `client.init.result` | efd35c9a67e295f5 | **00** | 18:52:37.729Z |

Log: `C:\Users\cicer\AppData\Local\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl`

### Comunicação V$Pague (60906)

| Evidência | Resultado |
| --- | --- |
| Listener 60906 | Continua LISTENING no PID **20760** |
| Retorno protocolar INIT_CLIENT | **00** / `CLIENT_INITIALIZED` (prova contratual CDS↔DLL↔Client) |
| Sessão TCP ESTABLISHED em 60906 no instante da inspeção pós-init | **Não observada** (conexão pode ser efêmera no init; não invalida retorno 00) |
| V$Pague reiniciado? | **Não** (PID 20760 preservado) |

---

## 3. Segurança / proibições

| Controle | Status |
| --- | --- |
| Sem `TX_*` / inicia\|continua\|finalizaTransacao | Confirmado (`operacaoAtiva=null`) |
| Sem CRT / PIX / débito / crédito | Não executados |
| Sem ENABLE_REAL / gate global | `gateReal=false`; env processo `'0'` |
| Sem abertura COM4 para pagamento | Não executada |
| Sem alteração de banco / fiscal | Não executada |
| Sem TX automática pós-INIT | Confirmado |

---

## 4. Estado pós-sprint (inspeção)

| Processo | PID | Papel |
| --- | --- | --- |
| PDV | 10292 | CDS UI/backend :3001 |
| Runner 51.35 | 15164 | Mantém Host vivo |
| NativeHost utility | **2176** | DLL carregada + Client init |
| V$PagueClient | 20760 | Background 60603/60906 |

Para encerrar a sessão de inspeção: fechar o Electron do runner 51.35 (encerra o utilityProcess 2176). **Não** matar o V$Pague nem o PDV de homologação sem decisão explícita.

---

## 5. Classificação

| Critério | Atendido? |
| --- | --- |
| DLL carregada comprovadamente | **Sim** |
| INIT_CLIENT executado e retorno documentado | **Sim (00)** |
| Comunicação funcional com V$Pague (protocolar) | **Sim** |
| STATUS consistente | **Sim** |
| Nenhuma operação financeira | **Sim** |

### **Classificação final: READY**

Integração Destaxa inicializada de forma real pelo CDS (LOAD + INIT_CLIENT 00), gate OFF, sem escopo financeiro ampliado.

FIM DO RELATÓRIO TEF-DESTAXA-51.35.
