# TEF-DESTAXA-51.22 — Inicialização controlada do PDV pelo workspace

**Status:** CONCLUÍDA  
**Coleta:** 2026-11-09 ~18:20–18:22 America/Sao_Paulo  
**Classificação:** **READY_FOR_REVIEW**  
**Operação financeira:** **NÃO EXECUTADA**  
**CRT / TX_*:** **não autorizados nesta sprint**

Artefatos: `start-meta.json`, `pdv-stdout.log`, `pdv-stderr.log`, `boot-snapshot.json`, `security-checks.json`, `collect-boot.js`

---

## Resumo executivo

PDV iniciado **somente** pelo workspace com `electron-pdv.js --cds-forcar-local`. Processo principal **PID 18324**, título **CDS Sistemas - PDV**, `rodandoDeAsar: false`, `dirname` = workspace. O boot RC3.16.6 **leu** `backend/services/tef/TefManager.js` do workspace (listado como hash divergente vs manifesto empacotado de 07/11 — esperado pós-51.20). Hash em disco do mesmo arquivo = **`F9697473…A427C`** (51.20) com marcador `intentCicloAutomaticoContinue`. Backend HTTP **3001** respondeu. Sem CRT/TX. V$Pague **não** reiniciado (PID 10256 preservado). ASAR `dist/pdv` **não** utilizado.

---

## 1. Pré-check

| Item | Resultado |
| --- | --- |
| CWD | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| Hash `TefManager.js` pré-start | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` = esperado 51.20 |
| Marcador 51.20 | presente |
| PDV pré-existente | **ausente** |
| Gate env | `DESTAXA_REAL_TRANSACTION_ENABLED=0` |

---

## 2. Inicialização

| Campo | Valor |
| --- | --- |
| Comando | `.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local` |
| Início UTC | `2026-11-09T21:20:12.580Z` |
| Wrapper / cadeia | cmd 16832 → node cli 18276 → **electron.exe 18324** |
| WorkingDirectory | workspace |
| V$Pague | **não** iniciado/reiniciado |
| DLL / NativeHost manual | **não** |
| COM4 | **não** aberta por esta sprint |

---

## 3. Runtime comprovado

| Evidência | Valor |
| --- | --- |
| PID Electron principal | **18324** |
| Responding / título | True / **CDS Sistemas - PDV** |
| StartTime local | 2026-11-09 **18:20:12** (coincide com start-meta) |
| CommandLine | `"...\node_modules\electron\dist\electron.exe" electron-pdv.js --cds-forcar-local` |
| HTTP `:3001` | **302** (alive) |
| `process.versions.electron` (audit) | **22.3.27** |
| `process.resourcesPath` | `...\node_modules\electron\dist\resources` |
| `dirname` (audit) | `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| `rodandoDeAsar` | **false** |
| `modulo` | `pdv` |
| `dbDir` | `C:\ProgramData\MercantilFiscal\dados` |

Fonte: `[RC3.16.4][ELECTRON-AUDIT] startup` em `pdv-stdout.log`.

### Código 51.20 efetivamente associado ao processo

Não se usou apenas o hash pré-start isolado. Cadeia de prova:

1. Processo vivo com **app-path/dirname = workspace** e **`rodandoDeAsar: false`** → módulos TEF resolvem pelo filesystem do workspace, não pelo ASAR de `dist/pdv`.  
2. Boot **RC3.16.6** calculou integridade e reportou **`hash divergente: backend/services/tef/TefManager.js`** — prova de **leitura do arquivo atual** do workspace (divergente do manifesto empacotado 07/11).  
3. Hash SHA256 do mesmo path em disco, imediatamente após o boot = **`F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C`**.  
4. Conteúdo contém **`intentCicloAutomaticoContinue`** (atalho 51.20).  
5. ASAR `dist/pdv` (verificado na 51.21) **não** contém esse marcador — e **não** foi o caminho de execução.

---

## 4. Verificação de integridade (segurança 51.20)

| Checagem | Resultado |
| --- | --- |
| Atalho TX_CONTINUE automático (`intentCicloAutomaticoContinue`) | **presente** |
| TX_FINALIZE fora do atalho (exige `continuidadeAtiva`) | **preservado** |
| Intent `autorizar`: TX_START+TX_CONTINUE+TX_FINALIZE | **OK** |
| Intent `continuarAutorizacao`: só CONTINUE+FINALIZE | **OK** (path PDV protegido) |
| Permits individuais / one-shot (Host/Client) | **inalterados** (código estático; sem execução TX) |
| Gate financeiro | **OFF** (`0`) |

Manifesto RC3.16.6 em modo desenvolvimento: **inconsistente** (hashes divergentes esperados vs build 07/11) — **não aborta** o boot local; documentado, não “corrigido” artificialmente.

---

## 5. Preservação financeira

Nos logs de boot **não** há `TX_START` / `TX_CONTINUE` operacional, `autorizarPagamento` financeiro nem `iniciaTransacaoDestaxa`.

Não executados: CRT · TX_* · emissão/consumo de auth · escrita em id=1 · liberação de `criarTransacaoExclusiva` · reinício V$Pague · abertura COM4.

V$Pague permanece **PID 10256**.

---

## 6. Classificação

### **READY_FOR_REVIEW**

PDV vivo pelo workspace, `rodandoDeAsar:false`, leitura boot de `TefManager.js` workspace + hash/marcador 51.20 comprovados, backend 3001 up, sem operação financeira.

**Isto não autoriza CRT.** Qualquer movimentação financeira exige nova decisão expressa (e tratamento da pendência id=1).

---

## 7. Pendências conhecidas (fora do escopo)

- `tef_transacoes.id=1` continua `pendente` (bloqueia novo INSERT exclusivo).  
- Auths 51.03 / 51.10 permanecem CONSUMED.  
- ASAR `dist/pdv` continua stale (não usar nesta homologação).
