# MRT-50.64 — Confirmação da porta COM persistida e pré-voo Destaxa

**Status: CONCLUÍDA**

Gerado em 2026-11-07T20:04:16Z. Diagnóstico **somente leitura**. **Sem cobrança. Gate OFF. Sem NativeHost. Sem `iniciaClientDestaxa`. Sem `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`. Sem gravação no banco. Sem alteração de código/config/perfil/chave. Sem SEFAZ.**

Diretório: `docs/homologacao/tef/MRT-50.64-20261107T200416Z`

A autorização única de débito R$ 1,00 **permanece reservada**.

---

## 1. Resultado da consulta (somente leitura)

| Item | Valor |
| --- | --- |
| Banco | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |
| Modo | URI `mode=ro` + `PRAGMA query_only=ON` |
| Gravação | **Não** (nenhum UPDATE/INSERT/DELETE; sem cópia/SQLite alternativo) |
| LastWriteTimeUtc do arquivo | `2026-11-07T19:51:31Z` (anterior à consulta ~20:04Z) |
| SHA-256 após consulta | `A59AD4727B2F8111F57FCF5A1F081FDACB2A110FFC6174C1485F39A6409AAFA2` |

Tabela `tef_pinpads`: **1 registro** — identificação inequívoca do terminal Destaxa/Gertec sem ambiguidade.

---

## 2. Registro consultado

| Campo | Valor |
| --- | --- |
| `tef_pinpads.id` | `1` |
| `tef_configuracao_id` | `1` |
| `codigo` | `GERTEC_PPC930` |
| `nome` | `Gertec PPC930` |
| `fabricante` / `modelo` | `Gertec` / `PPC930` |
| `tipo_conexao` | `usb` |
| `habilitado` | `1` |
| `status` | `desconhecido` |
| Config `provedor` | `destaxa` |
| Config `ambiente` | `homologacao` |
| `empresa_codigo` / `loja_codigo` | `null` / `null` |

Critério de identificação: único pinpad; `codigo=GERTEC_PPC930`; configuração vinculada com `provedor=destaxa`.

---

## 3. `porta_com` × COM4

| Fonte | Porta |
| --- | --- |
| Persistida (`tef_pinpads.porta_com`) | **COM4** |
| Windows Serial/PnP | **COM4** — `PPC-920/930 CDC USB-to-Serial Port (COM4)` |
| VID / PID | `1753` / `C902` |
| Status Windows | **OK** |

**Comparação: coincidem (`porta_com = COM4`).** Nenhuma correção automática aplicada (desnecessária).

---

## 4. Pré-voo ambiental (sem NativeHost / sem LOAD DLL)

### Gate `DESTAXA_REAL_TRANSACTION_ENABLED`

| Escopo | Valor |
| --- | --- |
| Process | `0` |
| User | *(vazio)* |
| Machine | *(vazio)* |
| Conclusão | **OFF** |

### V$Pague

| Item | Valor |
| --- | --- |
| Processo | `VSPagueClient.exe` |
| PID | `44484` |
| Caminho | `C:\VBI\Java\bin\VSPagueClient.exe` |
| TCP 60603 | LISTENING (PID 44484) |
| TCP 60906 | LISTENING (PID 44484) |

Nota: presença do processo e portas LISTEN **não** prova handshake ou comunicação com o PinPad.

### DLL

| Item | Valor |
| --- | --- |
| Caminho | `C:\Program Files\CDS ERP\resources\app.asar.unpacked\resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` |
| Existe | Sim |
| SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |
| Match referência | **Sim** |
| Carregada nesta sprint | **Não** |

### NativeHost

Nenhum processo `DestaxaNativeHost.js` ativo; **não iniciado** nesta sprint.

---

## 5. Confirmações explícitas

- **Não houve gravação no banco.**
- **Não houve chamada nativa ou financeira** (`iniciaClientDestaxa` / TX / CONTINUE / FINALIZE).
- **Não houve alteração de código, config TEF, perfil Electron ou chave.**
- **Não foi autorizado** NativeHost, init Client ou débito R$ 1,00.

---

## 6. Artefatos

- `MRT-50.64-CONFIRMACAO-PORTA-PERSISTIDA.md` (este)
- `mrt-50.64-resultado.json`
- `consulta-tef-pinpads.json`
- `preflight.json`
- `observability.jsonl`
- `_consulta_ro.py` (script auxiliar somente leitura usado na consulta)

---

## 7. Classificação final

**CONCLUÍDA**

Pré-condições desta sprint atendidas: registro Destaxa/PPC-930 identificado; `porta_com=COM4` confirmado contra Windows COM4; gate OFF; V$Pague/TCP/DLL registrados; zero mutações e zero chamadas nativas/financeiras.

**Encerrar.** A etapa de NativeHost / Client / débito R$ 1,00 permanece separada e exige confirmação explícita imediatamente antes da operação.
