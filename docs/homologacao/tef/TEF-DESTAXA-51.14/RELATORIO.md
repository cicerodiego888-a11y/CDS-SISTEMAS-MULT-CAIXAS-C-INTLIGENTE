# TEF-DESTAXA-51.14 — Inicialização controlada do PDV

**Status:** CONCLUÍDA  
**Start controlado:** 2026-11-09 **16:35:47** America/Sao_Paulo (`2026-11-09T19:35:47Z`)  
**Revalidação passiva:** 2026-11-09 **16:52:00** America/Sao_Paulo (`2026-11-09T19:52:00Z`)  
**Operação financeira:** **NÃO EXECUTADA / NÃO AUTORIZADA**  
**Resultado geral:** **GO PARA NOVA AVALIAÇÃO**

Base: 51.13 (NO-GO — PDV ausente) · 51.12 (rota TefManager) · 51.10 UNKNOWN preservado

Artefatos: `precheck.json`, `start-meta.json`, `boot-snapshot.json`, `security-integrity.json`, `revalidacao-51-14.json`, `pdv-stdout.log`, `pdv-stderr.log`

---

## Resumo executivo

PDV iniciado com segurança no workspace obrigatório às 16:35. Na revalidação 16:52 a **mesma** instância válida permanecia viva — **não** foi iniciada segunda instância. **PID 18236**, Responding, título **CDS Sistemas - PDV**, `dirname`/`app-path` = workspace, `rodandoDeAsar: false`, backend HTTP **3001** (HTTP 200). Boot **não** executou CRT/TX/DLL/NativeHost. Gate OFF. Ledger inalterado (auths CONSUMED). `tx-5110-2dbbb6922eb64990` permanece **UNKNOWN**. Hashes TEF estáveis vs 51.13; divergências vs manifesto documentadas (não corrigidas).

**GO = ambiente apto para avaliar autorização futura. Não autoriza CRT, pagamento nem emissão de auth excepcional.**

---

## 0. Revalidação 16:52 (regra: instância válida existente)

| Item | Resultado |
| --- | --- |
| Ação | **Não reiniciar** — instância workspace correta já viva |
| Main PID | **18236** (inalterado desde 16:35) |
| CommandLine | `electron.exe electron-pdv.js --cds-forcar-local` no workspace |
| Backend 3001 | LISTEN PID 18236 · `GET /login?modulo=pdv` → **200** |
| Conflito outro workspace | **Ausente** |
| NativeHost / runner 51.10 | **0** processos |
| Obs TEF novas | **0** (mtime obs permanece 15:54:48 -03) |
| Gate | OFF (`0`) |
| Ledger SHA | `EF6865C4…7727A5E8` (igual 51.13; mtime 18:54:48Z) |

---

## 1. Data, hora e workspace

| Campo | Valor |
| --- | --- |
| Start UTC | 2026-11-09T19:35:47.363Z |
| Revalidação UTC | 2026-11-09T19:52:00.453Z |
| Workspace | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| Entrada | `electron-pdv.js` |
| Modo | `--cds-forcar-local` |

---

## 2. Pré-verificação (Etapa 1)

| Item | Resultado | Classificação |
| --- | --- | --- |
| Electron/PDV já em execução | Ausente (antes do start) | **OK** |
| Outra instância PDV | Ausente | **OK** |
| CWD | Workspace obrigatório | **OK** |
| `electron-pdv.js` | Presente | **OK** |
| `node_modules\.bin\electron.cmd` | Presente | **OK** |
| Env harness CRT/NativeHost (`DESTAXA_REAL_HARNESS*`, `DESTAXA_CRT_PATH_CHECK*`, `DESTAXA_NATIVE_HOST_CHECK*`, `TEF_DESTAXA_REAL_TEST`) | Todos vazios | **OK** |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | `0` | **OK** |
| Auto TEF no boot | `electron-pdv.js` → `electron-common` sem TEF; `electron.js` só entra em harness se env=1 | **OK** — inicialização segura permitida |
| Encerrar processos existentes | **Não** | **OK** |

**Decisão pré-start:** seguir com inicialização (sem NO-GO de risco automático de CRT/TX/DLL).

---

## 3. Comando executado (Etapa 2)

```text
.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local
```

| Campo | Valor |
| --- | --- |
| WorkingDirectory | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| Wrapper / cli | PID **8276** (`electron.cmd`) → node cli PID **4620** |
| Logs | `pdv-stdout.log` / `pdv-stderr.log` |
| Runner 51.10 | **Não** executado |
| V$Pague start/restart | **Não** |
| COM4 / NativeHost / DLL | **Não** abertos/invocados manualmente |

---

## 4. Processo Electron (Etapa 3)

| Papel | PID | Responding | Evidência |
| --- | --- | --- | --- |
| Main | **18236** | **True** | Título **CDS Sistemas - PDV** |
| GPU | 856 | True | filho de 18236 |
| Network | 17584 | True | filho de 18236 |
| Renderer | 8608 | True | `--app-path="C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE"` |

**CommandLine (main):**

```text
"...\node_modules\electron\dist\electron.exe" electron-pdv.js --cds-forcar-local
```

Exe: `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE\node_modules\electron\dist\electron.exe`

| Item | Resultado | Classificação |
| --- | --- | --- |
| Workspace na CommandLine | Sim | **OK** |
| `electron-pdv.js` entrada efetiva | Sim | **OK** |
| `rodandoDeAsar` | **false** (audit boot) | **OK** |
| `app.asar` no workspace | Ausente (modo filesystem) | **OK** |
| Segunda instância PDV | Não (1 main + filhos) | **OK** |
| Erro fatal de boot | Não (janela + HTTP 3001) | **OK** |

### Backend

| Campo | Valor | Classificação |
| --- | --- | --- |
| HTTP LISTENING | porta **3001**, ~623 ms, PID **18236** | **OK** |
| `GET http://127.0.0.1:3001/login?modulo=pdv` | **200** | **OK** |
| `SERVER RODANDO DE` | workspace | **OK** |
| `loadURL` | `http://127.0.0.1:3001/login?modulo=pdv&...` | **OK** |

---

## 5. Evidências TefManager (Etapa 4 — passivo)

**Não** chamado `autorizar`. **Não** INSERT. **Não** Adapter.

### 5.1 Distinção obrigatória

| Camada | O que foi comprovado | Classificação |
| --- | --- | --- |
| **Disco** | Arquivos presentes; `autorizar`, `criarTransacaoExclusiva`, `preparacaoComPersistencia`, `registrarSolicitacao99` no fonte; `adapter.autorizarPagamento(` **após** `preparacaoComPersistencia` (offset 41249 → 41971); `lastID` em `tefRepository.js` | **OK** |
| **Carregado pela instância** | Boot RC3.16.6 **leu e hasheou** `TefManager.js`, `DestaxaRealAdapter.js`, `destaxaCrtCicloOrquestracao.js`, bridges Destaxa e `pdvTefContinuidade.js` a partir de `dirname` = workspace (`rodandoDeAsar: false`) | **OK** |
| **Operacionalmente disponível** | Provisionamento TEF no boot: `[TEF] Chave original recuperada pelo armazenamento protegido` (módulo `pdv`); backend da mesma instância responde em 3001 | **OK** (caminho pronto, **sem** invocar `autorizar`) |
| Runtime object dump sem chamada | Introspecção IPC do singleton dentro do Electron | **NÃO VERIFICÁVEL** — não bloqueia GO |

### 5.2 Cadeia operacional identificada (sem execução)

`TefManager.autorizar` → `criarTransacaoExclusiva` / `lastID` → `preparacaoComPersistencia` (`persistenciaConfirmada: true` só pós-INSERT) → `adapter.autorizarPagamento` → continuidade 99 (`registrarSolicitacao99` / `_persistirAntesContinue`).

Probe Node externo (fora do Electron) reportou aviso `TEF_RECONCILIACAO_SEGREDO_AUSENTE_OU_INVALIDO` — **não** aplica ao PDV vivo (que recuperou chave do armazenamento protegido). Esse probe **não** é evidência da instância.

---

## 6. V$Pague / COM4 / NativeHost

| Item | Valor | Classificação |
| --- | --- | --- |
| V$Pague | PID **10256**, Responding, StartTime 12:24:10 (inalterado) | **OK** |
| TCP 60906 | LISTEN → 10256 | **OK** |
| COM4 PnP | PPC-920/930 Status **OK** | **OK** |
| NativeHost processo | **0** | **OK** |
| Obs NativeHost novas após 19:35Z | **0** (mtime permanece 15:54:48 -03) | **OK** |

---

## 7. Segurança (Etapa 5)

| Item | Evidência | Classificação |
| --- | --- | --- |
| Gate process/user/machine | `0` / vazio / vazio | **OK** |
| Ledger SHA256 | `EF6865C4…7727A5E8` (igual 51.13) | **OK** |
| Ledger mtime | 2026-11-09T18:54:48.282Z | **OK** (sem escrita nesta sprint) |
| `5aed71f2…` | CONSUMED | **OK** |
| `ba08c88e…` | CONSUMED | **OK** |
| ISSUED nova | Ausente | **OK** |
| `tx-5110-2dbbb6922eb64990` | UNKNOWN / financialState UNKNOWN | **OK** |
| TX_START / CONTINUE / autorizarPagamento / iniciaClientDestaxa nos logs de boot | **Ausentes** | **OK** |
| Pendentes `tef_transacoes` | sqlite3 CLI ausente; sem require/INSERT | **NÃO VERIFICÁVEL** |
| Criação de pendente nesta sprint | Sem sinais (obs/logs/TCP) | **OK** (indireto) |

---

## 8. Integridade / hashes

Hashes atuais vs referência **51.13**:

| Arquivo | SHA256 | vs 51.13 |
| --- | --- | --- |
| `TefManager.js` | `96E9A34B…ECC889A4` | **IGUAL** |
| `destaxaCrtCicloOrquestracao.js` | `CE0BC016…07B3FD62` | **IGUAL** |
| `DestaxaRealAdapter.js` | `6AAB1212…F54063FA` | **IGUAL** |
| `destaxaContinuidadePersistencia.js` | `0AE061CC…E300F0` | **IGUAL** |
| `tefRepository.js` | `D28B6B83…DC41234` | **IGUAL** |
| `destaxaContinuidadeEstados.js` | `CF4060F8…2FD25437` | sem ref 51.13 |
| `electron-manifest.json` | `9E5ED43C…AAF85DDB` | sem ref 51.13 |

Boot RC3.16.6: `integridade: false` / status **ERRO** — divergências TEF + `OrquestradorPagamento.js` + `pdvTefContinuidade.js` (mesmo padrão 51.08; manifesto não republicado). **ATENÇÃO**. Manifesto **não** atualizado nesta sprint.

---

## 9. Logs de inicialização (trechos)

- `[RC3.16.4][ELECTRON-AUDIT] startup` — `rodandoDeAsar: false`, `dirname` = workspace, `modulo: pdv`
- `[RC3.16.6][INTEGRIDADE] diagnostico` — status ERRO (hashes divergentes TEF)
- `Modo local forçado via argumento --cds-forcar-local`
- `[TEF] Chave original recuperada pelo armazenamento protegido`
- `{"tag":"BOOT","evento":"HTTP LISTENING","ms":623,"port":3001}`
- `[RC3.16.4] loadURL ... http://127.0.0.1:3001/login?modulo=pdv...`

Stderr: aviso cosmético `clearCodeCaches`; manifesto inconsistente **não aborta**; alters FechamentoFiscal duplicate column (ruído conhecido).

---

## 10. Ausência de operação financeira

| Proibição | Cumprida |
| --- | --- |
| CRT / TX_* / pagamento / cartão | Sim |
| Auth excepcional emit/consume/restore | Sim |
| DLL Destaxa / NativeHost operacional | Sim |
| COM4 comunicação | Sim |
| Runner 51.10 | Sim |
| Retry/recuperação 51.10 | Sim |
| Alteração ledger / gate / fluxo financeiro / Motor Fiscal / `informacao=` | Sim |
| SQLite temporário / registro artificial | Sim |

---

## 11. Classificação consolidada

### OK
PDV vivo workspace; backend 3001; boot seguro; V$Pague/COM4/gate/ledger/UNKNOWN; runner não usado; TefManager lido no boot.

### ATENÇÃO
Integridade RC3.16.6 ERRO (hashes TEF vs manifesto); Central Entradas HEALTH_* históricos no stdout (não TEF).

### NÃO VERIFICÁVEL
Introspecção runtime do objeto `TefManager` dentro do Electron sem chamada; COUNT pendente em `tef_transacoes`.

### BLOQUEADO
Nenhum bloqueio essencial desta sprint.

---

## 12. Critérios GO (checklist)

| Critério | Atendido |
| --- | --- |
| PDV vivo | Sim (PID 18236) |
| Workspace correto | Sim |
| Backend disponível | Sim (3001 / HTTP 200) |
| Instância respondendo | Sim |
| TefManager efetivamente carregado | Sim (hash boot RC3.16.6) |
| Caminho operacional identificado | Sim (sem chamar `autorizar`) |
| Sem conflito de instância | Sim |
| Gate OFF | Sim |
| Nenhuma operação financeira | Sim |

---

## 13. Resultado geral

# **GO PARA NOVA AVALIAÇÃO**

PDV vivo, workspace correto e inicialização segura comprovados (start 16:35; revalidação 16:52 sem segundo start).  
**Não** autoriza CRT, pagamento ou emissão de autorização excepcional.

**Aguardando autorização expressa para qualquer operação financeira.**
