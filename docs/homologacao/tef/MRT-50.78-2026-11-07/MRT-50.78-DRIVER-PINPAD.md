# MRT-50.78 — Driver e PinPad Gertec PPC-930

Gate OFF. Sem NativeHost/DLL/TX/Identificar. Sem alteração de driver.

---

## PnP / Windows

| Item | Evidência |
|---|---|
| Dispositivo ativo | **OK** — `PPC-920/930 CDC USB-to-Serial Port (COM4)` |
| Hardware ID | `USB\VID_1753&PID_C902` (Gertec) |
| InstanceId ativo | `USB\VID_1753&PID_C902\5&1587D4E6&0&4` |
| `Win32_SerialPort` | `COM4` Status **OK** |
| Entrada fantasma | `PPC-920/930 … (COM3)` Status **Unknown** / `CM_PROB_PHANTOM` |

CDS cadastra `porta_com=COM4` / `GERTEC_PPC930` — **coincide** com o dispositivo PnP OK.

---

## Driver oficial Gertec

| Campo | Valor |
|---|---|
| Provider | **Gertec Brasil Ltda** |
| DeviceName | PPC-920/930 CDC USB-to-Serial Port |
| DriverVer (INF) | `06/08/2021,5.1.2600.0` |
| DriverVersion (WMI) | `5.1.2600.0` |
| DriverDate (WMI) | 2021-08-05 |
| INF | `oem13.inf` → DriverStore `gertec_usb_cdc_plus.inf_amd64_…` |
| Catalog | `gertec_usb_cdc_plus.cat` (citado no INF) |
| Stack | `usbser.sys` (CDC ACM Gertec) |
| `IsSigned` (WMI) | `False` (relato WMI; INF/catálogo Gertec presentes — **não** alterado) |

Conclusão driver: instalação Gertec CDC Plus **presente** e associada ao PPC VID_1753; versão **5.1.2600.0** (2021). Não foi reinstalado nesta sprint.

---

## COM4 — associação e conflito

| Verificação | Resultado |
|---|---|
| Associação PPC → COM4 | **Comprovada** (PnP + SerialPort) |
| CDS `tef_pinpads.porta_com` | `COM4` |
| `mode COM4` | Dispositivo responde (baud/status consultáveis) |
| NativeHost na COM | **0** processos DestaxaNativeHost |
| Outros processos “PinPad/Gertec” | Nenhum além do V$Pague Client |
| Lock exclusivo comprovado | **NÃO VERIFICÁVEL** sem abrir a porta (proibido — seria comunicação PinPad) |

**Nota:** COM3 fantasma pode confundir seleção manual no V$Pague; não prova conflito ativo em COM4.

---

## Dependência manual (operador)

1. Confirmar cabo USB firme e PinPad ligado/alimentado.
2. Na UI V$Pague: porta do PinPad = **COM4** (não COM3).
3. Não testar comunicação PinPad nesta sprint.
