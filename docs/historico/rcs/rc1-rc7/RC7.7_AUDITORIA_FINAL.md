# RC7.7 — Auditoria Final Enterprise

**Versão:** CDS Sistemas V1.0  
**Modo:** AUDITORIA FINAL (somente leitura — **sem implementação**)  
**Data:** 2026-07-19  
**Escopo:** Central de Entradas (backend + UX + telemetria + evidências RC7.6)  
**Base de evidência operacional:** `docs/RC7.6_HOMOLOGACAO_OPERACIONAL.md` + código em `backend/motores/central-entradas/`

---

## Parecer Final (síntese)

A Central de Entradas apresenta **arquitetura enterprise coerente** (Orchestrator + mutex DistDFe + Gate SEFAZ + XmlWait + máquina de estados + pipeline Parser→MIIP→Compras), com **observabilidade e resiliência operacionais** (656/593, cooldown, histórico circular, eventos/logs).

**Não** se declara versão congelada 1.0 de produção contínua: NSU inconsistente em campo, buraco Gate/mutex em consulta por chave, fila RES estagnada e lacunas de homologação (upload/manual/593/notas recentes) impedem go-live pleno.

**Veredito:** **APROVADA PARA OPERAÇÃO CONTROLADA**, com lista de riscos P0/P1 e itens fiscais **congelados**.

**Confidence Score global: 0,78 (78%).**

---

## 1. Arquitetura

### 1.1 Visão em camadas

```
Rotas HTTP ──► CentralEntradasService (facade)
                 │
                 ▼
         CentralEntradasOrchestrator (coordenação)
                 │
     ┌───────────┼───────────────┬────────────────┐
     ▼           ▼               ▼                ▼
 SyncExecução  Manifestação   Processamento   Upload/Compras
 (Gate+Mutex)  (210210+ciclo) (Parser→MIIP)   (bridge)
     │               │
     ▼               ▼
 DistDFe/SOAP ◄── XmlWait Scheduler + Background Sync
     │
     ▼
 Fiscal Runtime → UrlResolver → Registry → SoapTransport
```

### 1.2 Pipeline documental

| Etapa | Responsável | Status típico |
|-------|-------------|----------------|
| DistDFe / Upload | Sync / Upload / Persistência | RES → `AGUARDANDO_XML_COMPLETO`; PROC → `SINCRONIZADA` |
| Ciência 210210 | `CentralManifestacaoDfeService` | Eventos `CIENCIA_*` / `MANIFESTACAO_*` |
| Espera XML | `CentralXmlWaitScheduler` | Reconsulta DistDFe com backoff |
| Atualização RES→PROC | `CentralDocumentoAtualizacaoService` (RC6.3) | Mesmo `id` |
| Parser + MIIP | `CentralProcessamentoService` | `AGUARDANDO_REVISAO` / `PRONTA_PARA_COMPRA` |
| Compra | `CentralComprasBridgeService` | `EM_COMPRA` → `GRAVADA` |

### 1.3 Princípios (validação)

| Critério | Avaliação | Evidência |
|----------|-----------|-----------|
| **SOLID** | **Bom / parcial** | SRP forte em services (Gate, Nsu, XmlWait, Persistência); Orchestrator concentra DI (violação leve OCP/SRP); DIP via repos/`IRepository` |
| **Clean Code** | **Bom** | Nomes claros, DTOs, comentários de contrato RC; alguns arquivos longos (Orchestrator, Gate, Manifestação, `central-entradas.js`) |
| **Arquitetura** | **Boa** | Camadas core/services/repos/contracts; flags; máquina de estados |
| **Acoplamento** | **Médio–alto** | Singletons cruzados; DistDFe fiscal importa persistência Central; Gate+XmlWait compartilham KV `xml_wait_scheduler_state` |
| **Coesão** | **Alta** por serviço | Cada serviço tem domínio claro |
| **Escalabilidade** | **Adequada single-node** | Mutex in-process; não multi-instância |
| **Observabilidade** | **Boa** | Eventos DB, `centralLog`, Gate painel, FiscalSoapTelemetry, dashboard |
| **Resiliência** | **Boa** | Gate 656 progressivo, 593 CONFIG_ERROR, NSU hardening, backoff XmlWait, claim Ciência |

### 1.4 Componentes auditados (checklist)

| Componente | Status arquitetural | Notas |
|------------|---------------------|-------|
| Orchestrator | OK | God-object controlado; ponto único de entrada |
| Background | OK | `setTimeout` encadeado + `_cicloEmExecucao` |
| Scheduler / XML Wait | OK | Tick 60s, locks por doc, backoff 5→120 min |
| Gate Operacional | OK | Único Gate; circuit breaker NORMAL…CONFIG_ERROR |
| Dashboard | OK | `CentralDashboardService` + DTO SEFAZ operacional |
| UX | OK | RC7.5 (`central-entradas-ux.js`) desacoplada da regra |
| Telemetria / Logs | OK | Histórico Gate capped 100; canais `SEFAZ_GATE_*` / `XML_WAIT_*` |
| SOAP / DistDFe / Manifestação | Congelado | Entrada via runtime fiscal; Registry/UrlResolver |
| Parser / MIIP / Compras | Congelado | Hooks via Processamento / Bridge |
| Banco | OK | Tabelas `central_entradas_*` + KV config |

---

## 2. Performance

### 2.1 Evidência operacional (RC7.6)

| Métrica | Valor |
|---------|------:|
| Sync médio | 920 ms (n=10) |
| Parser médio | 6 ms (n=6) |
| MIIP médio | 34 ms (n=6) |
| Manifestação média | 474 ms (n=22) |
| SOAP Gate contadas | 5 |
| SOAP evitadas Gate | 1 |
| Bloqueio 656 | 600.000 ms (1ª ocorrência) |

**Conclusão performance:** gargalo é **SEFAZ / espera PROC**, não CPU de Parser/MIIP.

### 2.2 Recursos de processo

| Item | Achado |
|------|--------|
| **Memória** | Sem medição contínua em produção nesta auditoria. Em memória: Maps XmlWait bound ao inventário; Gate histórico capped; risco baixo de leak estrutural; `contagemCStat` dinâmico pode crescer por chaves novas (baixo). Cache diagnóstico **sem TTL**. |
| **CPU** | Workload I/O-bound (SOAP/SQLite). Frontend: tickers 1s/20s/30s/45s/60s só com tela aberta. |
| **Threads** | Node single-thread + libuv; sem pools dedicados na Central. |
| **Locks** | Mutex DistDFe in-process (`comLockDistDfe`); locks XmlWait por documento; `_emExecucao` manifesto; **sem** lock distribuído. |
| **Deadlocks** | Não evidenciado. Padrão async + `finally` liberando locks. Risco teórico se persistência Gate/XmlWait cruzar awaits longos no mesmo KV — mitigado por flags `_persistindo`. |

---

## 3. Escalabilidade

| Dimensão | Capacidade atual | Limite |
|----------|------------------|--------|
| Documentos inbox | Adequado PME / single loja | Fila XmlWait sem hard cap global (scan 50/tick) |
| Consultas DistDFe | 1 por vez (mutex) | Correto para SEFAZ; não escala horizontalmente |
| Multi-instância Node | **Não suportado** | Dois processos → double DistDFe |
| Multi-CNPJ | Controle NSU por CNPJ+ambiente | OK se ambiente alinhado |
| Carga UI | Polling local | Aceitável; não DistDFe |

**Parecer:** escalável para **um processo Node por base**; não é cluster-ready sem redisenho de lock.

---

## 4. Riscos

### 4.1 Críticos (P0)

| ID | Risco | Impacto | Evidência |
|----|-------|---------|-----------|
| R1 | **NSU zerado / inconsistente** após sync com docs NSU 011–027 | Novo 656 / reprocessamento | RC7.6 — `central_entradas_nsu.ult_nsu=0` |
| R2 | **Ambiente NSU=2 vs `fiscal_ambiente=1`** | Endpoint/controle errado | RC7.6 |
| R3 | **`buscarPorChave` / consChNFe fora do Gate e do mutex DistDFe** | Consulta paralela / 656 | `CentralSincronizacaoService.buscarPorChave` |

### 4.2 Altos (P1)

| ID | Risco | Impacto |
|----|-------|---------|
| R4 | Fila **25 RES** em XmlWait sem recuperação | Operação “travada” visualmente |
| R5 | Manifestação **596** em notas &gt; 10 dias no scheduler | Ruído SOAP + rejeições |
| R6 | Janela de **consultas duplicadas** antes do Gate estabilizar | Observado em RC7.6 (vários 656 em sequência) |
| R7 | Acoplamento **fiscal DistDFe → persistência Central** | Mudança SOAP pode quebrar inbox |

### 4.3 Médios (P2)

| ID | Risco | Notas |
|----|-------|-------|
| R8 | Race Background × XmlWait × sync manual | Mitigado por mutex; retries `SYNC_EM_ANDAMENTO` |
| R9 | Claim Ciência órfão se falha parcial | Até limpeza/evento |
| R10 | Cache diagnóstico sem TTL | Stale panel |
| R11 | Frontend monolítico (`central-entradas.js`) | Manutenção UX |
| R12 | Homologação incompleta (upload, download manual, 593 real) | RC7.6 |

### 4.4 Checklist de defeitos estruturais

| Tema | Resultado |
|------|-----------|
| Loop infinito | **Não encontrado** (timers reentrantes com flags) |
| Memory leak estrutural | **Baixo risco** (bounds na maioria das estruturas) |
| Deadlock | **Não evidenciado** |
| Race condition | **Presente** (R3, R8) — parcialmente mitigada |
| Duplicidade de documento | **Mitigada** (upsert por chave; atualização RES→PROC no mesmo id) |
| Consulta DistDFe duplicada | **Mitigada** por mutex; **exceção** consChNFe (R3) |

---

## 5. Melhorias futuras

*(fora do escopo RC7.7 — apenas recomendações)*

1. **Auditoria/correção NSU + alinhamento ambiente** (P0) — sem alterar regra fiscal DistDFe; apenas persistência/controle.  
2. **Incluir `buscarPorChave` no Gate + `comLockDistDfe`**.  
3. **Priorização XmlWait** por idade (&lt; 10 dias) para reduzir 596.  
4. **Hard cap / aging** da fila XmlWait + métrica de estagnação no dashboard.  
5. **TTL no cache de diagnóstico**.  
6. **Instrumentação mem/CPU** do processo Node no painel Diagnóstico.  
7. **Completar matriz RC7.6** (upload, download manual, nota recente, 593 real).  
8. **Extrair módulos** do Orchestrator / frontend inbox (manutenibilidade).  
9. Se multi-loja/cluster: **lock DistDFe distribuído** (DB lease).

---

## 6. Itens congelados

Não alterar nestas camadas sem sprint fiscal explícito e regressão SEFAZ:

| Item | Motivo do congelamento |
|------|------------------------|
| DistDFe / `distribuicaoDfeRuntime` | Contrato SEFAZ |
| Manifestação 210210 / runtime | Contrato evento |
| Parser oficial NFe | Integridade fiscal do XML |
| MIIP | Decisões de matching comerciais |
| Compras / `saveCompra` bridge fiscal | Integridade estoque/financeiro |
| Registry / UrlResolver | Resolução oficial de endpoints |
| SOAP Transport | Transporte e telemetria fiscal base |
| Máquina de estados documento | Transições legais do domínio |
| Schema/migrations centrais sem sprint | Estabilidade de banco |
| Gate (regras 656/593/cooldown) | Já auditado RC7.4.3 — evoluir só com evidência |
| XmlWait backoff oficial | Já auditado RC7.4 — evitar regressão SEFAZ |

**Permitido sob governança (não é “feature nova fiscal”):** correção de bug NSU/ambiente, observabilidade, UX, inclusão de `buscarPorChave` no Gate, testes e documentação.

---

## 7. Banco de dados

| Artefato | Uso |
|----------|-----|
| `central_entradas_documentos` | Inbox / status / tipo RES\|PROC |
| `central_entradas_historico` | Timeline de status |
| `central_entradas_eventos` | Auditoria operacional |
| `central_entradas_nsu` | Controle ultNSU/maxNSU (**ponto frágil R1/R2**) |
| `central_entradas_config` | KV sync + **`xml_wait_scheduler_state`** (Gate+Wait) |
| `central_entradas_notificacoes` | Alertas UI |
| Cruzamento `compras` | Duplicidade / vínculo |

Hardening NSU no código (`CentralNsuService`): não regredir NSU; 656 preserva NSU; só atualiza em 137/138 com tags. **A anomalia RC7.6 sugere caminho de escrita/ambiente fora do esperado ou controle criado no ambiente errado** — investigação P0 recomendada.

---

## 8. Confidence Score

| Dimensão | Score | Justificativa |
|----------|------:|---------------|
| Arquitetura / SOLID | 0,82 | Camadas claras; Orchestrator denso |
| Pipeline completo | 0,80 | Código ponta a ponta; 1 PROC real |
| Resiliência SEFAZ | 0,85 | Gate + XmlWait + evidência 656 |
| Observabilidade | 0,84 | Eventos, logs, telemetria, dashboard |
| Consistência de estado | 0,55 | NSU/ambiente |
| Exclusão mútua DistDFe | 0,72 | Mutex OK; buraco consChNFe |
| Performance | 0,80 | Tempos bons; mem/CPU prod não medidos |
| Escalabilidade | 0,65 | Single-node only |
| Homologação operacional | 0,72 | RC7.6 parcial |
| Congelamento fiscal | 0,90 | Fronteiras bem definidas |

**Confidence Score global: 0,78 (78%).**

---

## 9. Parecer Final

### Aprovado
- Arquitetura enterprise da Central (Orchestrator, Gate único, XmlWait, Background, Dashboard/UX).  
- Separação razoável de domínio fiscal congelado vs camada operacional.  
- Resiliência a Consumo Indevido e observabilidade suficientes para operação **assistida**.  
- Performance interna (Parser/MIIP) adequada.

### Condicionado
- Correção/auditoria de **NSU e ambiente** antes de sync agressivo em produção.  
- Fechar buraco **consulta por chave** no Gate/mutex.  
- Completar casos RC7.6 faltantes antes de declarar “homologação enterprise plena”.

### Não aprovado (ainda)
- **Congelamento CDS Central Inteligente V1.0 como produção contínua sem supervisão.**  
- Cluster multi-processo DistDFe.  
- Declaração de zero risco de 656 por consulta duplicada.

---

*Documento gerado em modo AUDITORIA FINAL — nenhuma funcionalidade foi implementada nesta sprint.*
