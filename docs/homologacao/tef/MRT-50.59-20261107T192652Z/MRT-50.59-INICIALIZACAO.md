# MRT-50.59 — Inicialização controlada Destaxa com nova baseline

**Classificação: `RETURNED_SUCCESS`**

Gerado em 2026-11-07T19:29:09Z. Uma única chamada a `iniciaClientDestaxa()`. Sem venda, débito, crédito, PIX, PinPad, reconciliação, gate financeiro, banco oficial, retry ou MRT-50.57. Estados UNKNOWN das MRT-24/36/42 não foram alterados. Nenhuma sprint seguinte foi iniciada.

Diretório: `docs/homologacao/tef/MRT-50.59-20261107T192652Z`

## Referências usadas

| Item | Valor |
| --- | --- |
| Baseline | MRT-50.58 |
| Perfil ERP | `cds-sistemas` / módulo `erp` |
| Electron | `22.3.27` |
| NativeHost | bootstrap isolado MRT-50.53 + init MRT-50.54 |
| Instrumentação | JSONL MRT-50.56 (`DESTAXA_OBSERVABILITY_LOG_PATH`) |
| DLL | `C:\Program Files\CDS ERP\resources\app.asar.unpacked\resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` |
| SHA-256 DLL | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` |

## Pré-voo

Todas as condições passaram antes da carga da DLL:

- `VSPagueClient.exe` PID `44484`, portas `60603` e `60906` em LISTENING
- DLL com hash exatamente igual ao da MRT-50.58
- Perfil ERP e chave originais validados
- Chave recuperável (fingerprint `1c6d56245ac4e501`) sem NativeHost/DLL
- Nenhum NativeHost anterior
- Gate financeiro OFF em Process (`0`), User e Machine (ausentes)
- JSONL persistente operacional (`observability.jsonl`)

## Execução única

Raiz isolada nova: `...\MRT-50.59-20261107T192652Z\isolated-root` (recusada se já existisse).

| Campo | Valor |
| --- | --- |
| PID NativeHost | `76504` |
| RequestId `iniciaClientDestaxa` | `bd73b723a5ddcd8e` |
| `native.call.enter` | confirmado |
| `native.call.return` | `resultCode=00`, `durationMs=7.1287` |
| Código Destaxa | `00` — API executada com sucesso |
| Estado client | `CLIENT_INITIALIZED` |
| `dllLoads` | `1` |
| Chamadas `iniciaClientDestaxa` | `1` enter / `1` return |
| Funções de pagamento | `0` |

## Comunicação com V$Pague

Durante e após a execução, `VSPagueClient.exe` permaneceu no PID `44484` com listeners em `60603` e `60906`. A inicialização do Client retornou `00` em ~7 ms, compatível com Client Background já ativo. Nenhuma configuração do V$Pague foi alterada.

## Encerramento

| Campo | Valor |
| --- | --- |
| Estado | `STOPPED` |
| `encerrado` | `true` |
| `adiado` | `false` |
| `forcado` | `false` |
| `stoppedConfirmed` | `true` |
| Classificação de saída | `ENCERRAMENTO_CONTROLADO` |

## Gate financeiro

`DESTAXA_REAL_TRANSACTION_ENABLED`: Process=`0`, User vazio, Machine vazio → **OFF**. `gateReal=false` no status pós-init.

## Ausência de transações

Nenhum evento JSONL de `iniciaTransacaoDestaxa`, `continuaTransacaoDestaxa` ou `finalizaTransacaoDestaxa`. Banco oficial não foi aberto pelo bootstrap (`isolated-root\no-database`). Hash da chave e do Local State originais inalterados.

## Integridade dos originais

| Arquivo | Pré | Pós | Igual |
| --- | --- | --- | --- |
| Local State | `26052081177AE4A83BD43FE0AB2C435330D8A252D03EF7595BD3C66C1AC86040` | idem | sim |
| Marcador | `AE1854015EE634865EFA93FD774DDC4A6E1EC491089BF22CCFDD30A61467388C` | idem | sim |
| `.tef-signing-key.v1` | `875ECF8ADDF7A0ADDCCA778A7FADC157A275D8F81C66B68805A2DCED95459167` | idem | sim |
| DLL candidata | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` | idem | sim |

## Artefatos

- `preflight.json`
- `key-probe-result.json`
- `hashes-pre.json` / `hashes-pos.json` / `hashes-final.json`
- `runner-result.json`
- `runner-stdout.jsonl`
- `observability.jsonl`
- `mrt-50-59-runner.js` (cópia controlada do bootstrap; em timeout em voo não mata o host)

## Observação

A autorização anterior para uma transação de R$ 1,00 **não** foi usada. Nenhuma operação financeira ocorreu nesta sprint. Aguardar análise antes de qualquer próxima execução.
