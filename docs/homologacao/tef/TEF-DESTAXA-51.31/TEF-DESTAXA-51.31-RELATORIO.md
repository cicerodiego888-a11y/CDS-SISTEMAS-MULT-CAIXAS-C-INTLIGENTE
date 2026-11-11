# TEF-DESTAXA-51.31 — Preparação operacional para homologação real

**Data:** 2026-11-10  
**Escopo:** auditoria estática + snapshot operacional **sem** CRT, sem NativeHost init, sem abertura COM4, sem `TX_*`, sem alteração de gate/MAC/.conf/`id=1`/`TefManager.js`.  
**Objetivo:** declarar o que está pronto e o que ainda impede o primeiro teste assistido com PinPad físico.

---

## 1. Snapshot do ambiente (15:29–15:30 BRT)

| Item | Evidência | Observação |
| --- | --- | --- |
| V$PagueClient | PID **21144**, StartTime **10/11/2026 15:03:58**, v **5.0.0** | Único processo |
| Listener automação | **60906** LISTENING (IPv4/IPv6) | Sem sessão ESTABLISHED (CDS não conectou) |
| Porta gráfica | **60603** LISTENING | Mesmo PID |
| TLS Partner | `app-partner.destaxa.cloud:60410` **TcpTestSucceeded=True**; log: Connected successful | Identificar em seguida |
| Identificar | **`[00151] Terminal não cadastrado ou desabilitado`** | Após TLS; Client ainda sobe Background + 60906 |
| Identidade MAC (log) | `HostMacAddressGet(): 00:15:5D:53:C5:2C` | Consistente com 51.30 (primário Hyper-V) |
| `.conf` | `V$PagueClient_Destaxa_LojaACB_TACB0120.conf` (89271 B, 09/11 12:24) | Ativação histórica preservada |
| HTTP backend | `http://127.0.0.1:3001/` → **ERR** | Backend/PDV **fora** |
| Electron / PDV | nenhum `electron.exe` com `electron-pdv` / `--cds-forcar-local` | PDV **fora** |
| PinPad | COM4 **OK** — PPC-920/930 CDC USB-to-Serial | COM3 Unknown (não usado); **COM4 não aberta** |
| DLL | `resources\tef\destaxa\win-x64\libdll-integracao-tef.dll` **1.83 64bit** | `resolverDll` → sucesso x64 |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED` **unset**; `habilitado=false` | Gate **OFF** (não alterado) |
| Banco oficial | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` | id=1 `nao_realizada`; **0** pendentes |

### Hashes congelados (confirmados)

| Artefato | SHA-256 |
| --- | --- |
| `TefManager.js` | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` |
| `DestaxaRealAdapter.js` | `8D3B60ECCBCBB18EACB6D84785BF15ABC786F8BC7C2117E043851FCE846892A9` |
| `destaxaCrtCicloOrquestracao.js` | `EF42EEF025625F148CD48C209714A84E715EAAE2FBB3448B6DAB47A79540ABC6` |
| `DestaxaNativeBridge.js` | `989E8C08BB893CB2C7BF4626ACFA8A38E0B0AF867F98D2F90AEF7F1E2494FE78` |
| `destaxaNativeHostProtocolo.js` | `760B76DDA05A4DC1845F8A6138CDA31083D884EB57A74942A29FA9D58AB5BFBB` |

---

## 2. Atividade 1 — Disponibilidade do V$PagueClient

| Critério | Resultado |
| --- | --- |
| Processo UP | Sim (PID 21144) |
| TLS cloud | Sim |
| Listener 60906 | Sim (Background) |
| Identificar | **00151** |
| Duplicidade PID/porta | Não observada |

**Classificação: PRONTO** (serviço local + listener + TLS).  
**Resíduo:** Identificar/licenciamento continua com **00151** (ver §7). Destaxa já esclareceu que o filtro de MAC é de licenciamento; **não** haverá novas consultas MAC. O Client **não** depende de Identificar OK para expor 60906 (comportamento comprovado em 51.28/51.29).

---

## 3. Atividade 2 — Comunicação CDS ↔ Client (sem transação financeira)

| Camada | Estado |
| --- | --- |
| Client listen 60906 | Disponível |
| PDV Electron | **AUSENTE** |
| Backend :3001 | **AUSENTE** |
| NativeHost | **Não iniciado** (restrito nesta sprint) |
| Sessão ESTABLISHED em 60906 | Nenhuma |

Prova **ao vivo** CDS→DLL→Client **não** foi executada (violaria “Não iniciar NativeHost” / “Não chamar TX_*”). Auditoria estática: Adapter/Bridge apontam `iniciaClientDestaxa` + ciclo via Host; contrato de porta 60906 mantido.

**Classificação: BLOQUEADO** para verificação operacional ao vivo (PDV/backend off + NativeHost não autorizado).  
**Dependência futura:** subir PDV `--cds-forcar-local` + autorização de NativeHost **sem** gate/CRT (somente handshake/init, se autorizado em sprint dedicada).

---

## 4. Atividade 3 — Adapter Destaxa (carga / disponibilidade)

| Item | Evidência |
| --- | --- |
| DLL no workspace | 1.83 x64 presente |
| `resolverDll` | sucesso → path win-x64 |
| Adapter hash | 51.25 preservado |
| Código de load/init | `DestaxaNativeBridge` / `prepararAutorizacao` (pode LOAD/INIT; **não** chamado) |
| Gate antes de TX | `transacaoRealHabilitada()` = false |

**Classificação: PRONTO** (artefato + resolução + contrato estático).  
Carga efetiva da DLL / `iniciaClientDestaxa`: **DEPENDENTE DE AUTORIZAÇÃO FINANCEIRA** (e autorização operacional de NativeHost), não executada aqui.

---

## 5. Atividade 4 — Fluxo TX_START → TX_CONTINUE → TX_FINALIZE

Auditoria **estática** em `destaxaCrtCicloOrquestracao.js` + `TefManager.js` (hash 51.20):

| Etapa | Proteção observada |
| --- | --- |
| TX_START | Gate OFF → `TX_START_BLOQUEADO`; exige identity persistida; sem retry automático |
| TX_CONTINUE | Exige permit/bootstrap; persistência pré-CONTINUE; sem regenerar TX_START |
| TX_FINALIZE(0) | Só após evidências 00 + `CONFIRMAR_PERSISTENCIA`; sem inventar FINALIZE(9)/NSU |
| Ciclo automático | Intent 51.20 permite CONTINUE no ciclo; FINALIZE **não** herda atalho |

Testes: `tef-destaxa-51-25` **18 ok**; `tef-destaxa-51-19` **16 ok**.

**Classificação: PRONTO** (código/orquestração).  
Execução real: **DEPENDENTE DE AUTORIZAÇÃO FINANCEIRA** (+ PinPad para coletas).

---

## 6. Atividade 5 — Proteções NativeHost

| Proteção | Estado |
| --- | --- |
| Bootstrap de segurança obrigatório | Presente (`HOST_SECURITY_BOOTSTRAP_*`) |
| Permit one-shot por operação | Presente; consumo único |
| TX_CONTINUE sem intent/permit | Bloqueado (testes 51.19) |
| TX_FINALIZE fora do atalho automático | Confirmado |
| Arquivos Host/Client/Protocolo/Bridge | Presentes |

NativeHost **não** foi iniciado.

**Classificação: PRONTO** (estático + testes). Runtime: **DEPENDENTE DE AUTORIZAÇÃO FINANCEIRA** / autorização operacional.

---

## 7. Atividade 6 — Persistência NSU / autorização / comprovantes

| Controle | Evidência |
| --- | --- |
| Pré-FINALIZE(0) | `CONFIRMAR_PERSISTENCIA` + NSU obrigatório |
| Falha/parcial de persistência | FINALIZE(0) **não** executa |
| A1 | Bloqueio sem finalização automática |
| Banco id=1 | `status=nao_realizada`; `nsu`/`autorizacao`/`venda_id` = null |
| Pendências ativas | **0** |

Testes 51.25 **18 ok**; 51.27 **17 ok**.

**Classificação: PRONTO.**

---

## 8. Atividade 7 — Bloqueios relacionados ao 00151

| Aspecto | Avaliação |
| --- | --- |
| Sintoma atual | Identificar → **00151** no boot 15:03:59 |
| Listener 60906 | Sobe **mesmo assim** |
| Posição Destaxa (contexto 51.30+) | Filtro MAC = **licenciamento**; sem novas consultas MAC |
| Impacto CDS↔Client local | Não comprovado bloqueio do listener; risco residual em serviços cloud pós-Identificar |
| Cadastro/ativação | Terminal teve Ativar em **09/11**; identidade `mac0` mudou (51.30) |

**Classificação do canal Identificar/licença cloud: BLOQUEADO (00151).**  
**Classificação do listener local 60906: PRONTO** (disponível).  
Para o **primeiro CRT real**, tratar 00151 como **risco residual de homologação** — se o Partner rejeitar sessão financeira, o teste aborta sem inventar bypass local (MAC/.conf/WSL **proibidos**).

---

## 9. Matriz de classificação (entrega)

| Componente | Classificação |
| --- | --- |
| V$PagueClient (processo + TLS + 60906) | **PRONTO** |
| Identificar / cadastro Partner (00151) | **BLOQUEADO** |
| PDV Electron + backend :3001 | **BLOQUEADO** (offline agora) |
| Comunicação CDS↔Client ao vivo | **BLOQUEADO** (sem PDV/NativeHost) |
| DLL Destaxa 1.83 x64 + resolução | **PRONTO** |
| Adapter / orquestração / hashes | **PRONTO** |
| Fluxo TX_* (código) | **PRONTO** |
| Execução TX_* / CRT | **DEPENDENTE DE AUTORIZAÇÃO FINANCEIRA** |
| NativeHost (proteções estáticas) | **PRONTO** |
| NativeHost (init runtime) | **DEPENDENTE DE AUTORIZAÇÃO FINANCEIRA** |
| Persistência NSU/autorização/comprovantes | **PRONTO** |
| Gate financeiro | **PRONTO** (OFF correto) |
| PinPad COM4 (presença) | **PRONTO** |
| Uso serial PinPad / coletas | **DEPENDENTE DO PINPAD** |
| Banco id=1 / sem pendências | **PRONTO** |
| Testes 51.19 / 51.25 / 51.27 | **PRONTO** |

---

## 10. O que está pronto × o que impede o primeiro teste

### Pronto

- Client UP com TLS e listener 60906.  
- DLL 1.83 x64 e hashes TEF congelados.  
- Gate OFF; políticas de Host/persistência/continuidade validadas por teste.  
- PinPad físico presente em COM4.  
- Banco limpo de pendência ativa (`id=1` = `nao_realizada`).

### Impede / falta antes do 1º teste real

1. **PDV + backend :3001** precisam estar UP (`electron-pdv.js --cds-forcar-local`).  
2. **Autorização** para NativeHost init + (se aplicável) handshake Client **sem** CRT.  
3. **Autorização financeira** explícita: `DESTAXA_REAL_TRANSACTION_ENABLED=1` **somente** no momento do teste + débito R$1,00.  
4. **00151** residual no Identificar — monitorar; sem alteração MAC/.conf.  
5. Operador no PinPad (COM4) para coletas do ciclo.

---

## 11. Roteiro operacional — execução assistida no cliente

> **Este roteiro documenta passos futuros.** Nesta sprint **nenhum** passo de CRT/NativeHost/COM4/gate foi executado.

### Pré-cheque (antes de autorizar CRT)

1. Confirmar V$Pague único: `Get-Process VSPagueClient`; `netstat` → **60906** LISTENING.  
2. Tail do log: TLS OK; anotar se **00151** ainda aparece (informativo).  
3. Confirmar PinPad COM4 **OK** (Device Manager / PnP). **Não** abrir porta manualmente.  
4. Subir PDV do workspace:  
   `.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local`  
5. Confirmar `http://127.0.0.1:3001/` responde.  
6. Confirmar gate ainda **OFF** até autorização verbal/escrita do PO.  
7. Confirmar `id=1` permanece `nao_realizada` e **0** pendentes.

### Janela autorizada (somente com PO)

8. Autorizar NativeHost init (sprint dedicada se necessário).  
9. Ligar gate **apenas** na sessão: `DESTAXA_REAL_TRANSACTION_ENABLED=1` (e desligar ao terminar).  
10. Operador no PinPad; valor **R$1,00**; modalidade **débito** homologação.  
11. Observar eventos: `TX_START` → `99`/`CONTINUE` → `00` → `CONFIRMAR_PERSISTENCIA` → `TX_FINALIZE(0)`.  
12. Abortar se: A1, timeout inconclusivo, 00151 em serviço financeiro, ou persistência incompleta — **não** forçar FINALIZE(9)/NSU inventado.

### Pós-teste

13. Desligar gate (`unset` / remover env).  
14. Encerrar NativeHost se autorizado a subir.  
15. Registrar NSU/autorização/comprovantes no relatório da sprint de CRT.  
16. Não alterar MAC, WSL, Hyper-V, `.conf`, nem `TefManager.js`.

### Critérios de sucesso do 1º teste

- Aprovação `00` com NSU + autorização + vias persistidas **antes** do FINALIZE(0).  
- Sem pendência UNKNOWN órfã.  
- Gate OFF ao final.

### Critérios de abort

- Qualquer código que exija inventar evidência.  
- Host security / permit inválido.  
- PinPad ausente/COM4 falha.  
- Partner rejeitando após 00151 de forma que impossibilite a sessão.

---

## 12. Testes executados nesta sprint

| Suite | Resultado |
| --- | --- |
| `tests/tef/tef-destaxa-51-25-persistencia-confirmacao.test.js` | **18 ok / 0 falha** |
| `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` | **16 ok / 0 falha** |
| `tests/tef/tef-destaxa-51-27-reconciliacao-inexistente.test.js` | **17 ok / 0 falha** |

Sem CRT, sem DLL TX, sem NativeHost init, sem COM4, sem alteração de env/MAC/.conf/`id=1`.

---

## 13. Proibições cumpridas

Não executado: CRT; PIX/débito/crédito; `TX_START`/`TX_CONTINUE`/`TX_FINALIZE`; NativeHost init; abertura COM4; alteração de `DESTAXA_REAL_TRANSACTION_ENABLED`; alteração de `TefManager.js`/arquitetura; alteração de `id=1`/registros financeiros; eventos fiscais; alteração de MAC/WSL/Hyper-V/`.conf`.

---

## 14. Conclusão

**Classificação final: PARCIALMENTE PREPARADO — tecnicamente pronto no eixo Client/DLL/código/PinPad/banco/gate; operacionalmente bloqueado para o 1º teste ao vivo por PDV/backend off, NativeHost não autorizado e gate OFF (correto), com 00151 residual no Identificar.**

O ambiente **pode** receber o roteiro assistido assim que PDV subir e houver autorização financeira + NativeHost. **Não declarar homologação operacional.**

FIM DO RELATÓRIO TEF-DESTAXA-51.31.
