# TEF-DESTAXA-51.01 — Teste controlado INIT_CLIENT

**Status:** CONCLUÍDA (uma chamada; sem retry; sem CRT)  
**Horário local da chamada:** 2026-11-09 11:04:25 -03:00  
**UTC:** 2026-11-09T14:04:25.128Z → 14:04:25.285Z

## Pré-condições

| # | Condição | Resultado |
| --- | --- | --- |
| 1 | VSPagueClient.exe ativo | SIM — PID **76484**, Responding=True |
| 2 | PID atual (não presumir anterior) | **76484** (início 09/11/2026 10:38:28) |
| 3 | COM4 Windows | SIM — `PPC-920/930 CDC USB-to-Serial Port (COM4)`, Status OK |
| 4 | Horário Destaxa (seg–sex 8h–22h) | SIM — segunda 11:02–11:04 |
| 5 | `DESTAXA_REAL_TRANSACTION_ENABLED` ≠ 1 | SIM — Process/User/Machine vazios; runner forçou `0` só no processo |
| 6 | Sem nativa em andamento | SIM — nenhum NativeHost Destaxa ativo no pré-voo |
| 7 | Logs preservados | SIM — cópias em `preserve-*-20261109T110404.*` |
| 8 | `testarConexao()` sem TX | SIM — só `bridge.iniciarClient` → `iniciaClientDestaxa` |

## Execução

- Método: `DestaxaRealAdapter.testarConexao()`
- Modo: `executionMode: 'in-process'` (NativeHost não necessário para a chamada autorizada)
- Entrada (código existente, sem `aplicacao_tela`):  
  `versao=1.0.3;aplicacao=CDS Sistemas;diretorio_trabalho=C:\CDS-SISTEMAS\logs\destaxa;nivel_log=1;nome_arquivo_log=destaxa-dll.log;tam_max_log=10;total_bkp_log=5`
- DLL: `resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` (1.83 x64)
- Chamadas: **1** `iniciaClientDestaxa` — **0** TX_START/CONTINUE/FINALIZE/CRT/CPF/CST/PIX

## Resultado da única chamada

| Campo | Valor |
| --- | --- |
| Sucesso API | `true` |
| Código Destaxa | **`00`** |
| Estado | `CLIENT_INITIALIZED` |
| Duração nativa | **12,0715 ms** |
| Duração wall `testarConexao` | 60,93 ms |
| PID processo (in-process) | 76144 |
| PID NativeHost | `null` |
| Exceção | nenhuma |
| Gate efetivo | `0` |

RequestId observabilidade: `da029f02-a813-493d-a278-91d060e8b04a`

## Linha do tempo

| Local | Evento |
| --- | --- |
| 10:38:28 | VSPagueClient PID 76484 inicia |
| 10:38:30 | TLS OK `app-partner.destaxa.cloud:60410` |
| 10:38:30.888 | Identificar enviado |
| 10:38:31.012 | Identificar recebido pelo Server |
| 10:38:31.013 | **`[00151] Terminal não cadastrado ou desabilitado`** |
| 10:38:41 | Client sobe `Destaxa-LojaACB-TACB0120`, listen `:60906`, Background |
| 11:04:25.128Z | Runner TEF-51.01 inicia (gate 0) |
| 11:04:25.251Z | `client.init.start` |
| 11:04:25.257Z | `native.call.enter` `iniciaClientDestaxa` |
| 11:04:25 | DLL log: banner integração Destaxa 1.83 64bit |
| 11:04:25.273Z | `native.call.return` **00** (12,07 ms) |
| 11:04:25.285Z | Fim; unload; exit 0 — **sem retry** |

## Evidências dos três logs

### Observabilidade NativeHost / CDS
`%LOCALAPPDATA%\CDS-SISTEMAS\logs\destaxa-nativehost-observability.jsonl`  
Cresceu 8039 → 9460. Eventos `client.init.start` / `native.call.enter` / `native.call.return` / `client.init.result` com código **00**.

### Log DLL
`C:\CDS-SISTEMAS\logs\destaxa\destaxa-dll.log`  
Cresceu 10461 → 10670; mtime 11:04:25. Delta (208 bytes):

```
2026-11-09 11:04:25 INFO  api_destaxa_start_client.c:94: **** Biblioteca de integracao com o client Destaxa ****
2026-11-09 11:04:25 INFO  api_destaxa_start_client.c:95: Versão: 1.83 64bit - Windows 64-bit
```

### Log V$PagueClient
`C:\VBI\V$Pague\Client\logs\vspague-client.log`  
**Não cresceu** nesta chamada (4534 bytes; mtime permanece 10:43:07).  
Nenhuma linha nova de `127.0.0.1`/`60906`/`Identificar` em 11:04:25.

## Classificação (critérios §6)

| # | Item | Classificação |
| --- | --- | --- |
| 1 | NativeHost iniciado | **NÃO** (in-process) |
| 2 | DLL carregada | **SIM** |
| 3 | INIT_CLIENT executado | **SIM** |
| 4 | Retorno da DLL | **`00`** |
| 5 | Comunicação local com V$Pague | **NÃO CONFIRMADA** (sem evidência correlacionada em 60906 nesta janela; `00` isolado não basta) |
| 6 | Identificar durante a execução | **NÃO OBSERVADO** |
| 7 | Comunicação Partner Cloud | **NÃO CONFIRMADA** nesta chamada |
| 8 | PinPad operacional | **NÃO COMPROVADO** |

## Problemas encontrados

1. **`00` sem rastro no log do Client** no instante da chamada — não prova TCP local nesta janela.
2. No startup do Client de hoje (10:38), Identificar obteve resposta e em seguida **`00151` Terminal não cadastrado ou desabilitado** — pendência cadastral/fornecedor, anterior a esta sprint.
3. NativeHost não foi usado nesta execução; a prova nativa ocorreu no processo Electron 76144.

## Próxima ação recomendada

1. Tratar com Destaxa o **00151** (terminal não cadastrado/desabilitado) visto no Identificar de 10:38.
2. Se for necessário prova explícita de TCP `127.0.0.1→60906`, pedir ao fornecedor o nível de log do Client/DLL que registre o accept local, ou autorizar sprint com NativeHost + correlação de netstat em tempo real.
3. **Não** autorizar CRT enquanto o cadastro/Identificar permanecer com 00151.
4. Nenhuma correção de código nesta sprint.

## Artefatos

- `resultado-chamada.json`
- `runner-stdout.jsonl`
- `pre-call-log-snapshot.json` + `preserve-*`
- `delta-destaxa-dll.txt`
- `tef-51-01-runner.js` (harness de evidência; sem alteração de produto)
