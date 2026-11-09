# MRT-50.78 — Diagnóstico operacional do ambiente Destaxa

| Campo | Valor |
|---|---|
| Data | 2026-11-07 |
| Gate | `0` (OFF) |
| NativeHost / DLL / Identificar / CRT | **Não** |
| V$Pague iniciado/reiniciado | **Não** |
| Driver/COM/banco alterados | **Não** |

---

## Parecer final

### `APTO`

Ambiente **físico e configuração local** apresentam evidências de prontidão para uma **futura** verificação operacional: driver Gertec CDC no PPC-930, COM4 OK alinhada ao CDS, V$Pague Client em execução com listen 60906/60603, logs preservados, gate OFF.

Isso **não** certifica Identificar/Partner Cloud nem autoriza CRT. Pendências manuais (UI COM4 vs COM3 fantasma) e externas (break pós-TLS) permanecem documentadas.

---

## Resumo das verificações

| # | Tarefa | Resultado |
|---|---|---|
| 1 | Driver Gertec | **Presente** `5.1.2600.0` / Gertec Brasil / `gertec_usb_cdc_plus` |
| 2 | PnP PPC-930 | **OK** em COM4 (`VID_1753&PID_C902`) |
| 3 | Associação COM4 | **Comprovada** (PnP + Serial + CDS) |
| 4 | Conflito COM4 | Sem processo concorrente óbvio; lock exclusivo **N/V** |
| 5 | Processos V$Pague | PID 44484 ativo; NH=0; listen 60906/60603 |
| 6 | Logs anteriores | Destaxa + V$Pague + MRT-50.69…77 **preservados** |
| 7 | Homologação local | CDS `homologacao` / destaxa / PPC930-COM4 (RO) |
| 8 | Manual | Listado em `MRT-50.78-PENDENCIAS.md` |

---

## Artefatos

| Arquivo | Conteúdo |
|---|---|
| `MRT-50.78-DRIVER-PINPAD.md` | Driver + COM |
| `MRT-50.78-AMBIENTE.md` | V$Pague / CDS / logs / gate |
| `MRT-50.78-PENDENCIAS.md` | Manual + externas |
| `ambiente-snapshot.json` | PnP/drivers/procs |
| `ambiente-extra.json` | INF/logs/MRT dirs |
| `consulta-cds-ro.json` | Cadastro RO |

---

## Critério de aceitação

Evidências suficientes para classificar prontidão **local/física** para verificação operacional futura: **sim (`APTO`)**.  
Sem testes financeiros e sem comunicação ativa com Destaxa (Identificar/CRT).
