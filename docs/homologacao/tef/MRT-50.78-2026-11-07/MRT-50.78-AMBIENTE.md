# MRT-50.78 — Ambiente local (somente leitura)

---

## V$Pague (sem iniciar/reiniciar)

| Item | Evidência |
|---|---|
| Processo | `VSPagueClient.exe` PID **44484** (já em execução) |
| Args | `-h app-partner.destaxa.cloud -p 60410 -atv server -tls` |
| Listen | TCP **60906** e **60603** (PID 44484) |
| Versão (histórica 50.76) | Client **5.0.0** |
| `.conf` | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` presente |
| Identificar / restart | **Não** executados nesta sprint |

---

## CDS (RO)

| Campo | Valor |
|---|---|
| provedor | `destaxa` |
| ambiente | `homologacao` |
| pinpad | `GERTEC_PPC930` / COM4 / ativo |
| empresa/loja/terminal | null (opcionais — 50.77) |
| pendências `tef_transacoes` | nenhuma |

---

## Logs preservados

| Origem | Status |
|---|---|
| `C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log` | Presente |
| `C:\VBI\V$Pague\Client\logs\vspague-client.log` | Presente (~22 KB) |
| Arquivos `archived\` V$Pague | Presentes (incl. 05/11 e anteriores) |
| Pastas MRT-50.69 … 50.77 | **Preservadas** (listadas em `ambiente-extra.json`) |

---

## Gate / NativeHost

| Item | Valor |
|---|---|
| `DESTAXA_REAL_TRANSACTION_ENABLED` | `0` |
| DestaxaNativeHost.js | **0** instâncias |

---

## Host

| Item | Valor |
|---|---|
| Hostname | `DESKTOP-4B8AMM3` |
| Identidade operacional | `Destaxa-LojaACB-TACB0120` (evidência 50.76) |

---

## O que NÃO foi feito

- Abrir COM4 para I/O PinPad  
- Enviar Identificar  
- Reiniciar V$Pague  
- Carregar DLL / NativeHost / CRT  
