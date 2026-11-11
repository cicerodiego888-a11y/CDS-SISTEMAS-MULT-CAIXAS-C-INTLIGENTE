# TEF-DESTAXA-51.34 — Inicialização controlada do NativeHost

**Data:** 2026-11-10 ~15:46–15:49 BRT  
**Autorização PO:** NativeHost + comunicação CDS↔NativeHost + evidências; **sem** transação financeira.  
**Evidência JSON:** `docs/homologacao/tef/TEF-DESTAXA-51.34/evidencias-51-34.json`  
**Runner:** `tef-51-34-runner.js` (bootstrap isolado oficial, `permitirInicializacaoClientDestaxa: false`)

---

## 1. Pré-verificação

| Item | Resultado |
| --- | --- |
| Electron/PDV | **UP** PID **10292** (`electron-pdv.js --cds-forcar-local`) |
| Backend `:3001` | `GET /login` → **200** |
| V$PagueClient | PID **20760** (StartTime 15:36:59) |
| Portas 60603 / 60906 | LISTENING → **20760** |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED` **unset/OFF** |
| NativeHost inicial | **NONE** |

### Análise de efeitos colaterais do `iniciar()` (condição de parada)

| Ação no spawn `DestaxaNativeHost` / `client.iniciar()` | Automático? |
| --- | --- |
| `HOST_READY` + IPC | Sim |
| `SECURITY_BOOTSTRAP` | Sim (obrigatório) |
| `LOAD` / carga DLL Destaxa | **Não** |
| `INIT_CLIENT` / `iniciaClientDestaxa` | **Não** |
| `TX_*` / ENABLE_REAL | **Não** |
| Abertura COM4 | **Não** |

**Conclusão pré-voo:** inicialização **compatível** com o escopo autorizado → execução liberada **somente** até STATUS/PING.  
Handshake Destaxa em **60906** no protocolo CDS = `LOAD` + `INIT_CLIENT` (`iniciaClientDestaxa`) → **proibido** nesta sprint → **não executado** (sem TCP isolado como substituto).

---

## 2. Execução autorizada

| Passo | Resultado |
| --- | --- |
| Fluxo | `inicializarNativeHostIsolado` (contrato oficial isolado) via Electron runner 51.34 |
| Spawn | `utilityProcess` — serviceName CDS TEF Native Host |
| Processo pai | PID **11292** (Electron do runner) |
| NativeHost PID | **19016** |
| Início | `2026-11-10T18:48:50.877Z` |
| `HOST_READY` | Recebido (~18:48:51.031Z) |
| `SECURITY_BOOTSTRAP` | `SECURITY_BOOTSTRAP_VALIDATED` rev **1** |
| `STATUS` (bootstrap) | `dllLoaded=false`, `dllLoads=0`, `gateReal=false`, `operacaoAtiva=null` |
| `PING` | **OK** — `pong:true`, pid 19016, **20 ms**, requestId `7617349968ebdc9f` |
| `STATUS` pós-PING | **OK** — **31 ms**; DLL ainda não carregada; client não inicializado |
| Encerramento | `SHUTDOWN` → `STOPPED` / `ENCERRAMENTO_CONTROLADO` (code 0) |
| Fim | `2026-11-10T18:48:51.164Z` |

### Canal e correlação

| Campo | Valor |
| --- | --- |
| Protocolo | `cds-tef-native-host/1` |
| Canal | Electron **utilityProcess** IPC |
| hostSessionId | `3245bf4e9363df5b4e71ab2d7c46073d` |
| Handshake CDS↔NativeHost | **Comprovado** (`HOST_READY` + bootstrap + PING/STATUS com resposta) |
| Handshake Destaxa `:60906` | **Não executado** (exigiria `iniciaClientDestaxa`) |

---

## 3. Confirmações de segurança

| Controle | Evidência |
| --- | --- |
| Sem `iniciaClientDestaxa` | `clientInitialized=false`; flag runner `false`; sem `LOAD` |
| Sem `TX_*` / CRT / COM4 | Não chamados; `operacaoAtiva=null` |
| Gate OFF | `gateReal=false`; env unset antes e depois |
| Sem operação financeira | Escopo limitado a PING/STATUS/SHUTDOWN |
| V$Pague preservado | PID **20760** intacto pós-teste |
| PDV/backend preservados | login **200**; PDV **10292** |
| NativeHost ao final | **NONE** (encerrado de forma controlada) |

---

## 4. Bloqueios / limites de escopo

1. **Handshake funcional com listener Destaxa 60906** não pode ser comprovado sem `INIT_CLIENT`/`iniciaClientDestaxa`, explicitamente proibido.  
2. Conexão TCP crua a 60906 **não** foi usada como prova (vedado pelo enunciado).  
3. Para READY completo Destaxa↔automação: **nova autorização PO** cobrindo `LOAD` + `iniciaClientDestaxa` (ainda sem CRT/TX).

---

## 5. Classificação final

| Dimensão | Status |
| --- | --- |
| NativeHost iniciado | Sim (PID 19016) |
| Comunicação CDS ↔ NativeHost | **Validada** (PING/STATUS) |
| Handshake Destaxa 60906 | **Não validado** (proibição `iniciaClientDestaxa`) |
| Operação financeira | Nenhuma |
| Gate | OFF |

### **Classificação: PARTIAL**

NativeHost iniciado e handshake IPC CDS↔NativeHost comprovado, sem operação financeira; handshake com a automação Destaxa (60906) permanece pendente de autorização específica para `iniciaClientDestaxa`.

---

## 6. Proibições cumpridas

Não executado: `iniciaClientDestaxa`; inicia/continua/finalizaTransacao; `TX_*`; CRT; PIX/débito/crédito; COM4/PinPad pagamento; alteração de banco; eventos fiscais/SEFAZ; habilitar gate; PDV Universal; reinício/encerramento do V$PagueClient.

FIM DO RELATÓRIO TEF-DESTAXA-51.34.
