# MRT-50.65 — Inicialização controlada do NativeHost e Client Destaxa

**Status: CONCLUÍDA** · **Classificação: `RETURNED_SUCCESS`**

Gerado em 2026-11-07T20:07:46Z. Uma sessão NativeHost · uma carga de DLL · **uma** chamada a `iniciaClientDestaxa()`. **Sem cobrança. Gate OFF o tempo todo. Sem `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`. Sem alteração de banco/config/perfil/chave. Sem SEFAZ. Sem retry.**

Diretório: `docs/homologacao/tef/MRT-50.65-20261107T200746Z`

A autorização única de R$ 1,00 em débito **permanece reservada e não foi utilizada**.

---

## 1. Pré-voo

| Critério | Resultado |
| --- | --- |
| NativeHost residual | **0** |
| Gate OFF (Process/User/Machine) | Process=`0`, User/Machine vazios → **OFF** |
| V$Pague | PID `44484` · `C:\VBI\Java\bin\VSPagueClient.exe` |
| TCP 60603 / 60906 | LISTENING |
| PPC-930 Windows | **COM4** OK (VID `1753` / PID `C902`) |
| `porta_com` (MRT-50.64) | **COM4** (registro `tef_pinpads.id=1`, `GERTEC_PPC930`) |
| DLL SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |

**Pré-voo aprovado** antes de carregar a DLL.

---

## 2. Execução

### Etapa A — NativeHost

| Campo | Valor |
| --- | --- |
| Parent Electron PID | `63396` |
| NativeHost PID | `73852` |
| Tipo | `utilityProcess` |
| Instâncias | **1** |
| IPC | `HOST_READY` + bootstrap `SECURITY_BOOTSTRAP` OK |

### Etapa B — DLL

| Campo | Valor |
| --- | --- |
| Caminho | `...\destaxa\win-x64\libdll-integracao-tef.dll` |
| Arch | x64 |
| Hash | match referência |
| `dllLoads` | **1** |
| LOAD requestId | `22be1d3357851f5f` (~33 ms, ok) |

### Etapa C — `iniciaClientDestaxa()` (única)

| Campo | Valor |
| --- | --- |
| RequestId | `7d7d1b3e8aa253ad` |
| `native.call.enter` | 2026-11-07T20:08:38.642Z |
| `native.call.return` | 2026-11-07T20:08:38.645Z |
| `resultCode` | **`00`** |
| `durationMs` | **0.414** |
| Estado | **`CLIENT_INITIALIZED`** |
| Retry / timeout | **não** |
| `gateReal` | `false` |

### Etapa D — Encerramento

| Campo | Valor |
| --- | --- |
| Shutdown request | IPC `SHUTDOWN` (`d3c9ad11faa0d5ca`) |
| Estado final | **`STOPPED`** |
| `encerrado` / `stoppedConfirmed` | `true` / `true` |
| `adiado` / `forcado` | `false` / `false` |
| Classificação saída | `ENCERRAMENTO_CONTROLADO` |
| Parent exit code | `0` |
| NativeHost residual | **0** |

---

## 3. Gate (antes × depois)

| Escopo | Antes | Depois |
| --- | --- | --- |
| Process | `0` | `0` |
| User | vazio | vazio |
| Machine | vazio | vazio |

Gate **nunca** habilitado (nem temporariamente).

---

## 4. Ausência de transação financeira

| Função | `native.call.enter` | `native.call.return` |
| --- | --- | --- |
| `iniciaClientDestaxa` | 1 | 1 |
| `iniciaTransacaoDestaxa` | **0** | **0** |
| `continuaTransacaoDestaxa` | **0** | **0** |
| `finalizaTransacaoDestaxa` | **0** | **0** |

---

## 5. Integridade dos originais

| Arquivo | Pré = Pós |
| --- | --- |
| Local State | sim |
| Marcador crypto | sim |
| `.tef-signing-key.v1` | sim |
| DLL candidata | sim |

Raiz isolada: `isolated-root\` (sem banco oficial; `no-database`).

---

## 6. Artefatos

- `MRT-50.65-INICIALIZACAO.md` (este)
- `mrt-50.65-resultado.json`
- `preflight.json`
- `observability.jsonl`
- `runner-result.json` / `runner-stdout.jsonl` / `runner-status.txt`
- `hashes-pre.json` / `hashes-pos.json` / `hashes-final.json`
- `mrt-50-65-runner.js` / `run-init.js` / `runner-app/package.json`

---

## 7. Encerramento

**Parar.**

Não avançar para cobrança. Não habilitar gate. Não executar função financeira sem nova autorização explícita e pontual imediatamente antes da operação.
