# TEF-DESTAXA-51.03 — Etapa 1: diagnóstico passivo do ledger e preparação

**Status:** CONCLUÍDA (somente leitura)  
**Data:** 2026-11-09  
**Transação financeira:** nenhuma  
**Emissão / consumo de autorização:** nenhum  
**Chamada nativa (INIT/DLL/NativeHost/CRT/TX):** nenhuma nesta sprint

## 1. Estado do ledger

| Item | Valor |
| --- | --- |
| Caminho | `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json` |
| Existe | **Não** |
| Diretório `...\CDS-SISTEMAS\tef` | **Não existe** |
| Quantidade de autorizações | **0** |
| Inconsistências / duplicidades | N/A (arquivo ausente) |

Conteúdo do ledger **não** foi criado nem alterado. Eventos `autorizacao.excepcional.*` em `destaxa-nativehost-observability.jsonl` referem-se a **ledgers temporários de testes unitários** (51.02), não ao ledger operacional.

## 2. Estado da autorização excepcional

| Campo | Situação |
| --- | --- |
| ISSUED operacional | **Ausente** |
| CONSUMED / EXPIRED / REJECTED operacional | **Ausente** |
| Valor / modalidade / validade / id | N/A |

Conclusão: **não há autorização excepcional válida emitida** para a próxima etapa de homologação. A Sprint 51.02 implementou o mecanismo e proibiu emissão no boot; emissão operacional ainda não ocorreu (conforme restrição).

## 3. Situação do V$Pague

| Item | Valor |
| --- | --- |
| Processo | `VSPagueClient.exe` |
| PID | **10256** |
| StartTime | 2026-11-09 **12:24:10** |
| Responding | True |
| Versão (log) | 5.0.0 / `5.0.0-1-e094d4f-1084-release` |
| Cloud TLS | `app-partner.destaxa.cloud:60410` — Connected successful (12:24:12) |
| Identificar (sessão atual) | recebido; **sem 00151** neste boot |
| Ativar | `Destaxa-LojaACB-TACB0120` → **Terminal ativado** (12:24:13) |
| Conf recebida | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (versão arquivo `20261109120020`) |

**00151 histórico (boots anteriores do mesmo dia, não desta sessão):** 10:38, 11:43 (×2), 11:47 — “Terminal não cadastrado ou desabilitado”. Sessão atual (12:24) superou esse estado cadastral no log.

Processo em execução **não** prova comunicação operacional com o PinPad.

## 4. Situação das portas

| Porta | Estado | PID |
| --- | --- | --- |
| **60906** | LISTENING (`0.0.0.0` e `[::]`) | **10256** (VSPagueClient) |
| **60603** | LISTENING (`0.0.0.0` e `[::]`) | **10256** (VSPagueClient) |

Nenhuma conexão nativa aberta por esta sprint.

## 5. Situação da COM4

| Item | Valor |
| --- | --- |
| DeviceID | COM4 |
| Nome | PPC-920/930 CDC USB-to-Serial Port (COM4) |
| Status PnP | **OK** |
| PNPDeviceID | `USB\VID_1753&PID_C902\...` |

Somente inventário PnP/serial — **sem** teste de I/O com o terminal.

## 6. Último estado conhecido do terminal (logs, sem limpeza)

### `C:\VBI\V$Pague\Client\logs\vspague-client.log`
- Último start: **12:24:11**
- Último estado cadastral no log: **Terminal ativado** + modo Background
- Listen 60906 iniciado após Ativar

### `C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log`
- Últimos `api_destaxa_start_client` (INIT_CLIENT histórico): **11:04:25** e **12:29:58** (2026-11-09)
- Sem `start_transaction` / CRT nesta data após esses INIT
- Última TX problemática antiga: 2026-11-07 19:23 (timeout / finalizar) — preservada

### `%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl`
- Eventos recentes = auditoria de **testes mock** 51.02 (emit/consume em ledger temp)
- Sem evidência de CRT/TX_START operacional nesta sprint

## 7. Situação do gate global

| Escopo | `DESTAXA_REAL_TRANSACTION_ENABLED` |
| --- | --- |
| User | vazio |
| Machine | vazio |
| Process (shell diagnóstico) | vazio |

Gate = **OFF** (`transacaoRealHabilitada()` exige literal `"1"`). Variáveis **não** alteradas nesta sprint.

## 8. Testes (somente mocks)

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-02-autorizacao-excepcional.test.js` | **14 ok / 0 falhas** |
| `tests/tef/mrt-50-67-homologacao-debito-gate.test.js` | **13 ok / 0 falhas** |

Sem DLL, NativeHost, V$Pague, PinPad ou banco temporário oficial. Ledger operacional permanece ausente após os testes.

## 9. Pendências

1. **Emissão explícita** de uma autorização excepcional ISSUED (R$1,00 débito) — **não** feita nesta etapa; depende de autorização do responsável.
2. Execução da única CRT R$1,00 — **fora** desta sprint.
3. Comunicação PinPad (COM4) ainda **não** validada por I/O nesta etapa (apenas presença do dispositivo).
4. HTTP 404 (URL ausente) permanece pendência independente da 51.02.
5. 00151 histórico documentado; sessão atual sem 00151 — monitorar se reaparece em boots futuros.

## 10. Preparado para a próxima etapa?

| Critério | Status |
| --- | --- |
| Mecanismo one-shot (código 51.02) | Pronto |
| Gate global OFF (esperado) | Sim |
| V$Pague up + 60906/60603 | Sim |
| Terminal ativado no log atual | Sim (cloud) |
| COM4 presente | Sim (PnP) |
| Autorização ISSUED operacional | **Não** — bloqueia avanço financeiro |
| Pronto para emitir + CRT R$1 | **Não ainda** — aguarda autorização explícita do responsável para emitir e, em etapa posterior, executar a TX |

**Ambiente de infraestrutura:** favorável para preparação da homologação.  
**Ambiente de autorização excepcional:** incompleto até emissão manual autorizada.

## Restrições respeitadas

Sem CRT/TX/CONTINUE/FINALIZE, sem INIT_CLIENT/DLL/NativeHost nesta sprint, sem reinício V$Pague, sem alteração de env/gate/config/PDV/fiscal, sem emissão/consumo operacional, sem retry, UNKNOWN históricos preservados.
