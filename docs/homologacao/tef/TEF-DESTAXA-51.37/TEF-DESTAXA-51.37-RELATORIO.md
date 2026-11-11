# TEF-DESTAXA-51.37 — NativeHost no processo oficial do PDV

**Data:** 2026-11-10 ~16:04–16:07 BRT  
**Objetivo:** eliminar NativeHost de inspeção (51.35) e inicializar Destaxa sob o Electron PDV **10292**.  
**Proibições:** sem TX/CRT/pagamento/COM4/gate/banco/SEFAZ; sem reinício de 10292/20760; sem runner auxiliar simulando o PDV.

---

## 1. Fase 1 — Encerramento controlado

| Item | Resultado |
| --- | --- |
| Vínculo prévio | PID **2176** PPID **15164** (confirmado) |
| SHUTDOWN IPC `cds-tef-native-host/1` | **Não invocável de fora** — keep-alive 51.35 não expôs `encerrar()`/listener externo |
| `CloseMainWindow(15164)` | Sem efeito (processo sem janela útil / ignorou) |
| Encerramento | `Stop-Process -Id 15164` (**somente** o runner) |
| NativeHost 2176 | **DOWN** (filho encerrou com o pai) |
| Runner 15164 | **DOWN** |
| PDV 10292 | **UP** (preservado) |
| V$Pague 20760 | **UP** (preservado) |
| `taskkill` indiscriminado | **Não** utilizado |

**Fase 1: concluída** (inspeção 51.35 eliminada; CDS Destaxa Client preservado).

---

## 2. Fase 2 — Inicialização no PDV 10292

### Ponto oficial identificado

| Camada | Local |
| --- | --- |
| Processo | Electron **10292** (`electron-pdv.js --cds-forcar-local`) embute `backend/server.js` |
| Singleton | `obterClienteCompartilhado()` em `DestaxaNativeHostClient.js` — **um Host por processo** |
| Adapter | `DestaxaRealAdapter` → `DestaxaHostBridge` (executionMode nativo padrão) |
| Spawn | `utilityProcess.fork(DestaxaNativeHost.js)` com **PPID = processo pai Electron** |
| LOAD / INIT | `bridge.load()` / `bridge.iniciarClient()` → ops `LOAD` / `INIT_CLIENT` |
| Caminho venda | `TefManager.autorizar` → `prepararAutorizacao` (LOAD+INIT antes de TX) |

### Por que LOAD+INIT **não** foram executados nesta sprint

| Restrição | Efeito |
| --- | --- |
| Sem runner auxiliar simulando PDV | Impede repetir o padrão 51.35 (Electron filho ≠ 10292) |
| Sem reinício do PDV 10292 | Impede carregar rota/código novo em processo já em memória |
| API `/api/tef/*` | Todo o mount exige `verificarToken` (401 sem sessão) |
| `GET /diagnostico-completo` | Oficial, mas **propositadamente não** chama `INIT_CLIENT` (TEF-PPC930-04); só `diagnosticar()` → LOAD |
| `POST /tef/testar` (config) | Teste de **cadastro**, não `iniciaClientDestaxa` |
| `POST /tef/pagar` | Passaria por `prepararAutorizacao` (INIT), porém segue para **INSERT** em banco — proibido nesta sprint |
| Injeção GUI/DevTools | Tentativa de foco no PDV bloqueada por política de automação; sem token operacional fornecido |

**Conclusão Fase 2:** o fluxo oficial está mapeado; **não há entrypoint HTTP já carregado no 10292** que execute **somente** LOAD+INIT_CLIENT sem TX e sem alterar o banco, respeitando as proibições. Executar INIT no PPID 10292 nesta janela ficaria **BLOCKED** sem nova autorização (ex.: endpoint homologatório one-shot + reinício controlado do PDV, ou credencial + UI assistida).

---

## 3. Fase 3 — Validação (estado atual)

| Critério | Resultado |
| --- | --- |
| Apenas um NativeHost TEF ativo | **Sim (zero)** — nenhum Host TEF residual |
| NativeHost filho do PDV 10292 | **Não** — filhos atuais: gpu / network / renderer apenas |
| DLL carregada no Host do PDV | **Não comprovado** (Host ausente) |
| INIT_CLIENT 00 | **Não executado** |
| clientInitialized / gateReal / operacaoAtiva | N/A (sem Host) |
| V$Pague 20760 | **Preservado**; 60603/60906 LISTENING |
| PDV + backend | **UP**; `/login` **200**; gate **OFF** |

---

## 4. Bloqueios remanescentes para READY_FOR_PDV_NATIVEHOST

1. Necessidade de **entrypoint no processo 10292** que faça LOAD+INIT sem TX/INSERT.  
2. Ou **autorização** para reinício controlado do PDV após expor tal entrypoint.  
3. Ou operação assistida autenticada na UI do PDV (SUPER ADMIN já logado visualmente) com ferramenta que chame o caminho oficial sem venda.

---

## 5. Classificação

| Fase | Status |
| --- | --- |
| 1 — Encerrar inspeção 51.35 | **OK** |
| 2 — LOAD+INIT sob PDV 10292 | **Não executado (bloqueado por entrypoint)** |
| 3 — READY_FOR_PDV_NATIVEHOST | **Não atingido** |

### **Classificação final: PARTIAL**

Inspeção 51.35 removida com PDV/V$Pague intactos; NativeHost **ainda não** pertence ao processo oficial do PDV com LOAD/INIT confirmados.

**READY_FOR_PDV_NATIVEHOST: não.**

FIM DO RELATÓRIO TEF-DESTAXA-51.37.
