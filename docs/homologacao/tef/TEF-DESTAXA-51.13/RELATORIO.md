# TEF-DESTAXA-51.13 — Preflight operacional do PDV vivo

**Status:** CONCLUÍDA (somente verificações passivas)  
**Coleta:** 2026-11-09 **16:21** America/Sao_Paulo (`2026-11-09T19:21:23Z`)  
**Operação financeira:** **NÃO EXECUTADA / NÃO AUTORIZADA**  
**Resultado geral:** **NO-GO**

Base: 51.12 (rota TefManager) · 51.11 (causa runner) · 51.10 (UNKNOWN preservado)

Artefatos brutos: `preflight-raw.json`, `preflight-integridade.json`, `preflight-logs.json`, `preflight-hash-cmp.json`, `ledger-snapshot-readonly.json`

---

## Resumo executivo

O ambiente **não** está apto para avaliação de homologação CRT via PDV + TefManager: **não há processo Electron/PDV em execução**. V$Pague (PID 10256) + listener **60906**, COM4/PinPad e gate OFF estão OK em inspeção passiva. Runner 51.10 permanece desativado. Auth `ba08c88e…` e 51.03 `5aed71f2…` estão **CONSUMED**. Transação `tx-5110-2dbbb6922eb64990` permanece **UNKNOWN**. Nenhuma CRT/TX/DLL/NativeHost/auth foi acionada nesta sprint.

**GO** nesta sprint significaria apenas aptidão para avaliar autorização futura — **não** foi obtido.

---

## 1. Data e hora da coleta

| Campo | Valor |
| --- | --- |
| Local | 2026-11-09 16:21:23 -03:00 |
| UTC | 2026-11-09T19:21:23.686Z |
| Workspace esperado | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |

---

## 2. PDV / workspace / backend

| Item | Evidência | Classificação |
| --- | --- | --- |
| Processo Electron PDV | **0** processos `electron.exe`; nenhuma janela CDS/PDV | **BLOQUEADO** |
| PID vivo (ex.: 6464 da 51.09) | Ausente | **BLOQUEADO** |
| Responding | N/A (sem processo) | **BLOQUEADO** |
| CommandLine / workspace carregado | Não observável sem processo | **NÃO VERIFICÁVEL** |
| `electron-pdv.js` no disco | Presente no workspace | **OK** (arquivo; não prova carga) |
| Backend local em execução | Sem PDV/Electron; nodes observados = TypeScript do Cursor | **BLOQUEADO** (backend PDV) |
| Reinício automático | **Não** realizado | **OK** (escopo) |

**Conclusão PDV:** requisito essencial falhou. Sem PDV vivo não há caminho `TefManager.autorizar` operacional.

---

## 3. Evidências do caminho TefManager (código no workspace)

Verificação **estática** (disco), não “código carregado pelo PDV” (PDV ausente):

| Marcador | Presente |
| --- | --- |
| `TefManager.js` → `criarTransacaoExclusiva` | Sim |
| `TefManager.js` → `preparacaoComPersistencia` | Sim |
| `TefManager.js` → `persistenciaConfirmada: true` pós-INSERT | Sim |
| `TefManager.js` → `autorizarPagamento` | Sim |
| `tefRepository.js` → `lastID` / INSERT exclusivo | Sim (arquivo presente) |

| Item | Classificação |
| --- | --- |
| Arquivos do fluxo no workspace | **OK** |
| Código **carregado** pela instância viva | **NÃO VERIFICÁVEL** (sem PDV; sem boot RC3.16.6 nesta coleta) |

---

## 4. Runner 51.10

| Item | Evidência | Classificação |
| --- | --- | --- |
| `tef-51-10-runner.js` desativado | Contém `RUNNER_OPERACIONAL_DESATIVADO`; sem `autorizarPagamento` / flag sintética | **OK** |
| Histórico inequivalente | `tef-51-10-runner.HISTORICO-INEQ-51.10.js` presente; **não** executado | **OK** |
| Processo rodando o runner | Nenhum | **OK** |

SHA256 (coleta):

| Arquivo | SHA256 |
| --- | --- |
| `tef-51-10-runner.js` (desativado) | `DE51637E6735C91A0ABFF5B24568DEBFE0445A3A9E188FA9113EDD5CBBAFC76E` |
| `tef-51-10-runner.HISTORICO-INEQ-51.10.js` | `674A73FD1BB038F900BCBD86D90946BE2605739745C03207E642B031EB05D01E` |

---

## 5. V$Pague e listener

| Campo | Valor | Classificação |
| --- | --- | --- |
| Processo | `VSPagueClient.exe` **PID 10256** | **OK** |
| Responding | True | **OK** |
| StartTime | 2026-11-09 12:24:10 -03 (mesmo da 51.09; **não** reiniciado nesta sprint) | **OK** |
| Exe | `C:\VBI\Java\bin\VSPagueClient.exe` | **OK** |
| Cmd | `… -jar C:\VBI\V$Pague\Client\V$PagueClient.jar -h app-partner.destaxa.cloud -p 60410 -atv server -tls` | **OK** |
| Listener TCP 60906 | `Listen` em `::` / PID **10256** | **OK** |
| Sessão ESTABLISHED CDS↔60906 | **Ausente** | **OK** (sem TX em voo observável) |
| Reinício/start/stop nesta sprint | **Não** | **OK** |

### Conexão Destaxa (passivo)

| Evidência | Achado | Classificação |
| --- | --- | --- |
| TLS em log | `Connected successfull` / `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384` a `app-partner.destaxa.cloud:60410` (histórico do dia) | **OK** (histórico) |
| Estado TLS **agora** | Sem probe ativo (proibido) | **NÃO VERIFICÁVEL** (instante atual) |

### Logs V$Pague

Arquivo: `C:\VBI\V$Pague\Client\logs\vspague-client.log`  
mtime: **2026-11-09 15:57:53** -03 · última atividade = encerramento da tentativa 51.10.

| Keyword | Achado | Classificação |
| --- | --- | --- |
| `00151` | Histórico **11:47:48** — “Terminal não cadastrado ou desabilitado” | **ATENÇÃO** (histórico; não atividade atual) |
| `TABELA EXPIRADA` | Histórico **13:59:11** (sessão anterior) | **ATENÇÃO** |
| TLS | Sucesso documentado no dia | **OK** / **ATENÇÃO** (não revalidado agora) |
| `Connection breaked` 60906 | **15:54:51** (51.10) | **ATENÇÃO** (histórico) |
| Timeout AC 120s / PinPad | **15:56:51–15:57:53** (51.10) | **ATENÇÃO** (histórico) |
| Erros novos após 15:57:53 | Nenhum (log parado) | **OK** |

NativeHost / DestaxaNativeHost em execução: **ausente** (**OK** para “sem TX em voo”).

---

## 6. PinPad / COM4 (passivo)

| Campo | Valor | Classificação |
| --- | --- | --- |
| Dispositivo PnP | `PPC-920/930 CDC USB-to-Serial Port (COM4)` Status **OK** | **OK** |
| SerialPort WMI | COM4 Status **OK** · Gertec VID_1753/PID_C902 | **OK** |
| COM3 | **Ausente** (porta fantasma descartada) | **OK** |
| Abertura serial / comandos | **Nenhuma** nesta sprint | **OK** (escopo) |
| Disponibilidade operacional “livre agora” | Não aberta; não testada | **NÃO VERIFICÁVEL** além do PnP OK |

---

## 7. Integridade / hashes / manifesto

Manifesto em disco: `electron-manifest.json` (schema `cds-electron-manifest/v2`, versao app `1.0.3`, build `2026-11-07T03:50:36Z`, commit `ecbcdf0`).  
Label literal “RC3.16.6” **não** lida nesta coleta do JSON; a divergência documentada na **51.08** (boot PDV vs manifesto congelado pós-51.05) permanece a referência operacional.

Comparação passiva disco × manifesto (SHA256):

| Arquivo | Disco = manifesto? |
| --- | --- |
| `TefManager.js` | **Não** (divergente) |
| `destaxaCrtCicloOrquestracao.js` | **Não** (divergente) |
| `DestaxaRealAdapter.js` | **Não** (divergente) |
| `destaxaContinuidadePersistencia.js` | **Sim** |
| `tefRepository.js` | **Sim** |
| `destaxaContinuidadeEstados.js` | **Ausente** do manifesto |

| Item | Classificação |
| --- | --- |
| Divergências restritas a módulos TEF/Destaxa já citados na 51.08 (+ adapter) | **ATENÇÃO** (esperado sem republicar manifesto) |
| Manifesto/hashes atualizados nesta sprint | **Não** (proibido) |
| Integridade do runner desativado / histórico | **OK** (hashes registrados) |

Hashes completos dos arquivos TEF amostrados: ver `preflight-integridade.json`.

---

## 8. Gate e ledger (somente leitura)

### Gate `DESTAXA_REAL_TRANSACTION_ENABLED`

| Escopo | Valor |
| --- | --- |
| Process (shell da coleta) | `0` |
| User | vazio/null |
| Machine | vazio/null |

**OFF.** Classificação: **OK**. Não alterado.

### Ledger excepcional

Path: `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`  
SHA256: `EF6865C4F70B3551B19612A9C6E93B65C0ADCAD2219AE29CBD265BDD7727A5E8`  
mtime UTC: `2026-11-09T18:54:48.282Z` (consumo 51.10)  
`atualizadoEm`: `2026-11-09T18:54:48.281Z`

| authorizationId | status | consumidoEm | Classificação |
| --- | --- | --- | --- |
| `5aed71f2b6e19f7f14303f69242c6796` (51.03) | **CONSUMED** | 2026-11-09T16:58:43.030Z | **OK** (não reutilizável) |
| `ba08c88e8e67410f3048bac5e10c4046` (51.10) | **CONSUMED** | 2026-11-09T18:54:48.281Z | **OK** (não reutilizável) |

| Item | Classificação |
| --- | --- |
| ISSUED disponível | **Não** → **OK** para “sem auth viva acidental”; **BLOQUEADO** se o critério futuro exigir ISSUED já emitida (**não** exigido nesta sprint) |
| Ledger alterado nesta sprint | **Não** |
| Emissão/consumo/restauração | **Não** |

---

## 9. Preservação do UNKNOWN 51.10

| Campo | Valor |
| --- | --- |
| transactionId | `tx-5110-2dbbb6922eb64990` |
| `resultado-crt.json` classificacao | **UNKNOWN** |
| `resposta.financialState` | **UNKNOWN** |
| SHA256 evidência | `0B90B30D474C8E0951BC71C63E6C61F8C395A68A6A335D843BA5120A0E2F9210` |
| Retry / recuperação / FINALIZE / reconciliação | **Não** |

Classificação: **OK** (preservado).

---

## 10. Transações pendentes / TX em voo

| Sinal passivo | Achado | Classificação |
| --- | --- | --- |
| PDV / NativeHost | Ausentes | **OK** (sem cliente TEF vivo) |
| TCP ESTABLISHED 60906 | Ausente | **OK** |
| Última obs NativeHost | 51.10 (~18:54Z); sem eventos novos | **OK** |
| SELECT `tef_transacoes` pendente | Caminho SQLite operacional **não** localizado nesta coleta; consulta não feita | **NÃO VERIFICÁVEL** |

UNKNOWN históricos: sem alteração.

---

## 11. Quadro consolidado

### OK

- Workspace em disco com `electron-pdv.js` + fluxo TefManager estático  
- Runner 51.10 desativado; histórico não executado  
- V$Pague 10256 + 60906 LISTEN  
- COM4 / PPC-920/930 PnP OK; COM3 ausente  
- Gate OFF  
- Ledger somente leitura; auths CONSUMED; sem ISSUED  
- UNKNOWN 51.10 preservado  
- Sem NativeHost / sem sessão 60906 ativa  
- Sem operação financeira nesta sprint  

### BLOQUEADO (essenciais)

- **PDV Electron não está em execução**  
- **Backend local do PDV não disponível** (sem processo)  

### ATENÇÃO

- Hashes TEF divergentes vs `electron-manifest.json` (pós-51.05; manifesto não republicado)  
- `destaxaContinuidadeEstados.js` fora do manifesto  
- Histórico V$Pague: `00151`, `TABELA EXPIRADA`, timeouts/connection break da 51.10  
- TLS Destaxa só comprovado em log histórico do dia  

### NÃO VERIFICÁVEL

- Código efetivamente carregado pela instância PDV (exige boot)  
- Integridade RC3.16.6 reportada no boot atual  
- TLS Destaxa no instante atual (sem probe)  
- “COM4 livre” além do status PnP  
- Pendências em `tef_transacoes` (DB não localizado/consultado)  

---

## 12. Resultado geral

# **NO-GO**

Motivo determinante: **ausência do PDV vivo**, requisito essencial da rota `PDV → TefManager → INSERT → …` definida na 51.12.

Itens de periferia (V$Pague, COM4, gate, runner, ledger) **não** compensam a falta do PDV.

**Próximo passo (fora desta sprint, sob autorização expressa):** subir/abrir o PDV workspace (`electron-pdv.js --cds-forcar-local`), **sem** CRT automática, e repetir preflight passivo. Só então avaliar emissão de autorização excepcional.

---

## 13. Evidência de ausência de operação financeira

| Ação | Status |
| --- | --- |
| CRT / TX_START / CONTINUE / FINALIZE / CANCEL | Não executados |
| DLL Destaxa / NativeHost | Não carregados/iniciados |
| V$Pague start/stop/restart | Não |
| COM4 aberta / comandos PinPad | Não |
| Runner 51.10 / histórico | Não executados |
| Cartão / cobrança | Não |
| Auth excepcional emit/consume/restore | Não |
| Ledger escrito | Não (mtime permanece 18:54:48Z) |
| INSERT artificial / SQLite temp | Não |
| Motor Fiscal / F/NF / F12 / SEFAZ / `informacao=` | Não alterados |
| Fluxo financeiro de produção | Não modificado |

---

## Critério de conclusão da sprint

| Critério | Cumprido |
| --- | --- |
| Preflight passivo documentado | Sim |
| Bloqueios/divergências identificados | Sim (PDV ausente = NO-GO) |
| Nenhuma operação financeira | Sim |
| Nenhuma autorização emitida/consumida | Sim |
| 51.10 UNKNOWN | Sim |
| Sem alteração fluxo financeiro produção | Sim |

**Aguardando autorização expressa para qualquer próxima etapa** (inclui apenas subir o PDV, se for o caso).
