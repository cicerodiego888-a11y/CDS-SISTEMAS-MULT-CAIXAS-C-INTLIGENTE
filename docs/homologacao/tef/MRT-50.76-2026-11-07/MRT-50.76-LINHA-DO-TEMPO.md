# MRT-50.76 — Linha do tempo única

Fuso dos logs V$Pague: **America/Recife** (GMT-03).  
Sem nova execução de TX nesta sprint.

---

## A. Janelas Partner Cloud / Identificar (mesmo padrão)

### 00:21 — boot Client (`vspg-id-d0ad7260`)

| Horário | Evento |
|---|---|
| 00:21:42 | Client start; `HOST_NAME=desktop-4b8amm3`; `HostMacAddressGet=00:15:5D:D0:2D:3E` |
| 00:21:43.658 | TLS Connected → `app-partner.destaxa.cloud:60410` |
| 00:21:43.661 | **Identificar** enviado |
| 00:21:43.661 | **Connection breaked** `129.148.36.0` |
| 00:21:43.953 | Reconnect TLS OK |
| 00:21:43.956 | Connection breaked novamente |
| 00:21:53.958 | **Timeout** (~10 s) |
| 00:22:04 | Mesmo assim: `iniciando Destaxa-LojaACB-TACB0120` + modo Background |

**Diferença:** timeout na subida; **sem** CRT AC. Identidade local carregada após o timeout.

### 15:20 — reboot Client (`vspg-id-263dc52d`)

| Horário | Evento |
|---|---|
| 15:20:34 | Client start; `HostMacAddressGet=00:15:5D:65:9B:C4` |
| 15:20:35.871 | TLS Connected |
| 15:20:35.877 | **Identificar** |
| 15:20:35.879+ | Breaked + **3** ciclos reconnect/break |
| 15:20:36.488 | **Problema de conexão!** |
| 15:20:46 | `iniciando Destaxa-LojaACB-TACB0120` + Background |

**Diferença:** mais reconexões; mensagem “Problema de conexão”; MAC Get diferente (Hyper-V). Mesma identidade LojaACB.

### 19:23 — MRT-50.74 CRT Debito (mesmo `vspg-id-263dc52d`)

| Horário | Evento |
|---|---|
| 19:23:38.089 | AC local `:60906` |
| 19:23:38.232 | `iniciar` seq=1 |
| 19:23:38.277 | **Sequencial inválido** → pede seq=3 |
| 19:23:38.289 | `iniciar` seq=3 OK |
| 19:23:38.299 | `executar` **`tipoCartao:Debito`** aceito |
| 19:23:38.829 | **Identificar** (durante CRT) |
| 19:23:39.643 | TLS Connected |
| 19:23:39.649 | **Connection breaked** `129.148.36.0` (~6 ms) |
| 19:23:50 | Timeout → `coletaRetorno:9` → Destaxa **`09`** |
| 19:23:50 | `finalizar` |

**Diferença:** ocorre **no meio da CRT** após parse Debito; retorno AC `09` / `CONFIRMED_DENIED`. Sequencial inválido recuperado **antes** do Identificar.

---

## B. CRT e contrato (eixo CDS)

| Quando (UTC aprox.) | MRT | Evento |
|---|---|---|
| 18:01 local / ~21:01Z | **50.69** | CRT `Débito` → tag inválida → **`05`** / UNKNOWN |
| Auditoria estática | **50.70–50.71** | Códigos null; COM4 CDS=Windows; Identity LojaACB documentada |
| Encoding/docs | **50.72** | Divergência `Débito` vs `Debito` |
| Código | **50.73** | Correção CDS → **`Debito`** |
| 19:23 local / ~22:23Z | **50.74** | CRT `Debito` aceito → Identificar break → **`09`** |
| Diagnóstico | **50.75** | DNS/TCP/TLS OK; fechamento pós-TLS comprovado |
| Pacote | **50.76** | Este consolidado |

---

## C. Comparativo das três falhas Identificar

| Aspecto | 00:21 | 15:20 | 19:23 |
|---|---|---|---|
| TLS sobe | Sim | Sim | Sim |
| Identificar | Sim | Sim | Sim |
| Break peer `129.148.36.0` | Sim | Sim | Sim |
| Reconnects | 1+ | 3 | sob demanda |
| Mensagem local | Timeout | Problema de conexão | Timeout + retorno 9 |
| CRT AC | Não | Não | Sim (`Debito`) |
| Identidade LojaACB após | Sim (00:22) | Sim (15:20:46) | N/A (finalizar CRT) |
| Códigos erro além do break | Timeout genérico | Conexão | `coletaRetorno:9` / Destaxa 09 |

**Conclusão temporal:** o padrão Identificar→break é **independente** da CRT; a 50.74 apenas o **exposição** durante venda.
