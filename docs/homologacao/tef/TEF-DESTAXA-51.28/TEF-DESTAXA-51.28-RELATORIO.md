# TEF-DESTAXA-51.28 — Relatório

**Sprint:** Preparação operacional e validação do ambiente Destaxa  
**Data:** 2026-11-10 (America/Sao_Paulo)  
**Workspace:** `C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE`  
**Classificação:** **PARCIALMENTE PREPARADO**  
**Homologação operacional CRT:** **não declarada**

---

## 0. Horários

| Evento | Horário (UTC−3) | UTC |
| --- | --- | --- |
| Início auditoria passiva | ≈13:58 | 16:58Z |
| PDV Electron iniciado | ≈13:59 | 16:59:40Z |
| HTTP LISTENING :3001 | ≈14:00 | ~17:00Z |
| Testes direcionados | ≈14:00 | 17:00:37Z |
| Snapshot final banco/portas | ≈14:00 | 17:00:51Z |

---

## 1. Diagnóstico PDV

| Item | Resultado |
| --- | --- |
| Comando | `.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local` |
| Processo | Electron PID **7696** (+ GPU/utility) |
| Electron | **22.3.27** |
| Node no Electron | 16.17.1 (Chromium 108.0.5359.215) |
| Origem do código | **workspace** — `rodandoDeAsar: false`, `dirname` = workspace |
| `execPath` | `...\node_modules\electron\dist\electron.exe` |
| Modo | `Modo local forçado via argumento --cds-forcar-local` |
| Janela | **Login — CDS Sistemas** (aberta; sem tela de pagamento/venda) |
| Manifesto integridade | `ERRO` em desenvolvimento (hashes divergentes esperados pós-sprints TEF; **não aborta**) |

**OK:** PDV aberto pelo workspace, Electron 22.3.27 confirmado.

---

## 2. Diagnóstico backend

| Item | Resultado |
| --- | --- |
| Porta | **3001** LISTENING (PID 7696) |
| HTTP | `GET http://127.0.0.1:3001/` → **200** |
| Boot log | `SERVER RODANDO DE: C:\CDS-SISTEMAS-MULT-CAIXAS C-INTLIGENTE` |
| Arquivo | `backend\server.js` |
| DB dir | `C:\ProgramData\MercantilFiscal\dados` |

**OK:** Backend HTTP respondendo na porta 3001 a partir do workspace.

---

## 3. Diagnóstico V$Pague

| Item | Resultado |
| --- | --- |
| Processo | **UP** — `VSPagueClient` PID **18472** (mesmo PID do recheck 51.26) |
| Listener | **60906** LISTENING |
| Instalação | `C:\VBI\V$Pague\Client` |
| JAR / EXE | `V$PagueClient.jar` / `C:\VBI\Java\bin\VSPagueClient.exe` |
| Config | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (atualizado 09/11/2026) |
| App título / versão (log) | Destaxa / V$PagueClient **5.0.0** |
| TLS Destaxa | `app-partner.destaxa.cloud:60410` — `Test-NetConnection` **True** (129.148.36.0); log: SSL conectado com sucesso |
| Sessão log | `vspg-id-9bbc584a` (boot 13:29:41) |
| Erro crítico no boot | **`[00151] Terminal não cadastrado ou desabilitado`** |
| TLI 020 / tabela expirada | **não observados** nos logs atuais/arquivados inspecionados |
| Modo | Background; listener local após identificação |

**Conclusão V$Pague:** processo e comunicação TLS **identificados**, porém **integração funcional incompleta** por **00151**. Existência do processo **não** basta para GO de CRT.

**Não iniciado automaticamente** (já estava ativo).

---

## 4. Diagnóstico DLL

| Item | Resultado |
| --- | --- |
| Caminho x64 | `resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` |
| PE | **x64** / AMD64 |
| FileVersion | **1.83 64bit** |
| ProductName | Biblioteca de integracao TEF |
| `resolverDll()` | sucesso → mesmo caminho (`origem: recursos_aplicacao`) |
| ia32 presente | sim (x86), não usada neste host x64 |

**OK:** DLL Destaxa **1.83 x64** confirmada. **Nenhuma chamada** à DLL nesta sprint.

---

## 5. Diagnóstico PinPad

| Item | Resultado |
| --- | --- |
| Equipamento | **Gertec PPC-920/930** |
| Porta | **COM4** |
| Status PnP | **OK** |
| VID/PID | `VID_1753` / `PID_C902` |
| Driver / FriendlyName | PPC-920/930 CDC USB-to-Serial Port (COM4) |
| Outros | COM3 (mesmo VID/PID, Status Unknown); COM7 USB serial |

**OK:** presença física identificada. **COM4 não aberta**; sem comandos seriais.

---

## 6. Auditoria NativeHost (estática apenas)

| Item | Resultado |
| --- | --- |
| Runtime | `backend/services/tef/destaxa/DestaxaNativeHost.js` |
| Cliente | `DestaxaNativeHostClient.js` — `utilityProcess.fork` (Electron) / `child_process.fork` (Node) |
| Bridge | `DestaxaNativeBridge.js` (hash 51.25 OK) |
| Protocolo | `destaxaNativeHostProtocolo.js` — permits, bootstrap de segurança, gates |
| Carga DLL | via `destaxaDllResolver` → win-x64 `libdll-integracao-tef.dll` |
| Contrato V$Pague | indireto via DLL 1.83 (ciclo inicia/continua/finaliza); Client escuta **60906** |
| Observabilidade | `destaxaLogger` / evidências operacionais (`00151` já tipado) |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED` literal `1` apenas; atual **OFF** |
| Processo NativeHost | **não inicializado** (proibido nesta sprint) |

**OK:** auditoria estática concluída. Init operacional **exige autorização posterior**.

---

## 7. Hashes (SHA-256) — conferência 51.20 / 51.25

| Arquivo | Esperado | Obtido | Status |
| --- | --- | --- | --- |
| `TefManager.js` | `F9697473…A427C` | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` | **OK** |
| `DestaxaRealAdapter.js` | `8D3B60EC…892A9` | `8D3B60ECCBCBB18EACB6D84785BF15ABC786F8BC7C2117E043851FCE846892A9` | **OK** |
| `destaxaCrtCicloOrquestracao.js` | `EF42EEF0…0ABC6` | `EF42EEF025625F148CD48C209714A84E715EAAE2FBB3448B6DAB47A79540ABC6` | **OK** |
| `destaxaProtocolo.js` | `084F846A…B2804` | `084F846AD8D9844C37CDB5BAFD17586E70A535E45274030F86370329EDBB2804` | **OK** |
| `DestaxaNativeBridge.js` | `989E8C08…4FE78` | `989E8C08BB893CB2C7BF4626ACFA8A38E0B0AF867F98D2F90AEF7F1E2494FE78` | **OK** |

Sem divergência nos artefatos TEF exigidos. Nenhuma sobrescrita.

Ambiente host: Node **v24.19.0**, npm 11.17.0, electron-pkg **22.3.27**.

---

## 8. Estado do banco

| Item | Valor |
| --- | --- |
| `id=1` status | **`nao_realizada`** (inalterado desde 51.27) |
| financial/admin | INEXISTENT (log admin id=15) |
| NSU / autorização / venda | **null / null / null** |
| Pendências `pendente` | **0** |
| `atualizado_em` id=1 | `2026-11-10 16:46:48` (não modificado nesta sprint) |

**OK:** reconciliação 51.27 intacta; exclusividade livre.

---

## 9. Estado do gate / segurança financeira

| Controle | Status |
| --- | --- |
| `DESTAXA_REAL_TRANSACTION_ENABLED` | **OFF** (unset) |
| `transacaoRealHabilitada()` | `false` |
| Correção 51.20 (`intentCicloAutomaticoContinue`) | preservada (hash + teste 51.19) |
| Persistência pré-FINALIZE 51.25 | preservada (teste 51.25) |
| A1 sem finalização automática | confirmado (teste 51.25 #14/#15) |
| UNKNOWN sem retry automático | preservado (policy + testes) |
| `criarTransacaoExclusiva` | só bloqueia `status='pendente'`; `nao_realizada` não bloqueia |

Gate **não** modificado.

---

## 10. Testes

| Suite | Resultado |
| --- | --- |
| `tef-destaxa-51-25-persistencia-confirmacao.test.js` | **18 ok / 0 falha** |
| `tef-destaxa-51-27-reconciliacao-inexistente.test.js` | **17 ok / 0 falha** |
| `tef-destaxa-51-19-host-security-continue.test.js` | **16 ok / 0 falha** |

Sem CRT, sem DLL real, sem NativeHost init, sem abertura COM4.

---

## 11. Matriz de conclusão

| Componente | Critério | Status |
| --- | --- | --- |
| PDV | Aberto pelo workspace | **OK** |
| Backend | Porta 3001 respondendo | **OK** |
| TefManager | Hash 51.20 confirmado | **OK** |
| Adapter / orquestração / protocolo / bridge | Hashes 51.25 confirmados | **OK** |
| V$Pague | Processo e comunicação identificados | **PARCIAL** (UP + TLS OK; **00151**) |
| DLL | Versão e arquitetura confirmadas | **OK** (1.83 x64) |
| PinPad | Presença física identificada | **OK** (COM4) |
| NativeHost | Auditoria estática concluída | **OK** (não iniciado) |
| Banco | id=1 reconciliada e intacta | **OK** |
| Gate | OFF | **OK** |
| Testes | Aprovados | **OK** |

---

## 12. Bloqueios

1. **V$Pague `[00151]`** — terminal não cadastrado ou desabilitado (boot 13:29:41). Impede considerar integração Destaxa pronta para CRT.  
2. **NativeHost não inicializado** — aguarda autorização específica.  
3. **Gate financeiro OFF** — correto para esta sprint; CRT real exige autorização futura de gate/CRT.  
4. Manifesto Electron com hashes divergentes no workspace (informativo; não aborta em modo desenvolvimento).

---

## 13. Próximas autorizações necessárias

1. Destaxa / operação: **resolver cadastro do terminal (00151)** e revalidar log sem esse erro.  
2. Autorização expressa para **inicialização operacional do NativeHost**.  
3. Autorização expressa para **CRT real** (débito homologação), incluindo eventual liberação controlada do gate `DESTAXA_REAL_TRANSACTION_ENABLED=1`.  
4. Autorização para comunicação serial PinPad / ciclo financeiro (COM4), se exigida na sprint de CRT.

---

## 14. Proibições cumpridas

Não executado: CRT, débito/crédito/PIX, `TX_START`/`TX_CONTINUE`/`TX_FINALIZE(0|9)`, `iniciaClientDestaxa` / `inicia|continua|finalizaTransacaoDestaxa`, NativeHost init, abertura COM4, alteração de `id=1`, vendas artificiais, eventos fiscais, Motor Fiscal, PDV Universal, ligar gate.

---

**Classificação final: PARCIALMENTE PREPARADO.**  
Motivo sintético: ambiente CDS (PDV/backend/código/DLL/PinPad/banco/gate/testes) pronto; V$Pague UP com TLS, porém **00151** e NativeHost ainda fora do ciclo operacional autorizado.

**Não declarar homologação operacional.**

FIM DO RELATÓRIO TEF-DESTAXA-51.28.
