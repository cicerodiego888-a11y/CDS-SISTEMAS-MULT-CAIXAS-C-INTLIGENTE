# Central Inteligente de Entradas — Arquitetura RC4

**Versão:** `1.0.0-rc4` (evolução RC1–RC3)  
**Módulo:** `backend/motores/central-entradas/`

## Visão geral

A Central Inteligente de Entradas (CIE) é a **única porta oficial** de documentos fiscais de entrada no CDS Sistemas.

Padrão: **Facade → Orchestrator → Services → Repositories**

## Camadas

```
HTTP (rotas/central-entradas.js | compras.js → Orchestrator)
        ↓
CentralEntradasService          ← Fachada HTTP
        ↓
CentralEntradasOrchestrator     ← Orquestrador único (RC1–RC4)
        ↓
Services especializados
        ↓
Repositories (SQLite)
```

## Configuração Enterprise (RC4 + RC3.1)

Ponto único operacional: **`CentralConfiguracaoService`**.

### Fonte fiscal única (RC3.1)

**Existe apenas uma configuração fiscal do sistema.**

```
Configurações Avançadas → Fiscal
        ↓
getFiscalConfig()  (fiscal_ambiente, UF, CNPJ, certificado, CSC)
        ↓
CentralConfiguracaoService (somente leitura de Ambiente/UF)
        ↓
obterContextoOperacional() → Sync DF-e / Diagnóstico / Manifestação
        ↓
Plataforma Fiscal (UrlResolver) + Emissão NFC-e
```

| Campo | Fonte | Central grava? |
|---|---|---|
| Ambiente Prod/Hom (`fiscal_ambiente`) | Configurações Avançadas | **Não** — somente leitura |
| UF emitente | Configurações Avançadas | **Não** — somente leitura |
| Certificado / CNPJ / CSC | Configurações Avançadas | **Não** — visão/adapter |
| Timeouts / retries / sync / proxy | `central_entradas_config` | **Sim** |
| Endpoints DF-e SOAP | UrlResolver (Plataforma) | **Não** |
| Endpoints Consulta / Manifestação | UrlResolver (Plataforma) — RO na Central (RC4.3.1) | **Não** |

Chaves legadas `central_ambiente` / `central_uf` / `central_codigo_uf` **não são mais semeadas nem gravadas**. Se existirem no banco, são **ignoradas**.

```
Tela Configuração (6 abas)
        ↓
GET/PUT /api/central-entradas/configuracao
        ↓
CentralConfiguracaoController
        ↓
CentralConfiguracaoService
        ↓
└─ Ambiente/UF ← getFiscalConfig (oficial)
└─ Timeouts/sync ← CentralConfiguracaoRepository (central_entradas_config)
        ↓
CentralSincronizacao → SOAP DF-e (contextoCentral)
```

| Módulo | Conteúdo |
|---|---|
| Ambiente | Produção/Homologação, UF — **somente leitura** (fonte oficial) |
| SEFAZ | Timeouts/retries operacionais; URLs SOAP via UrlResolver (somente leitura) |
| Certificado | Visão (nome, CNPJ, validade, status) — path/senha via adapter fiscal |
| Sincronização | Auto, ao abrir, intervalo, janelas, max docs |
| Diagnóstico | Health, testes, versões, tempos |
| Avançado | HTTP timeout/retry, proxy (estrutura), debug |

**Regra:** nenhum serviço da Central hardcoda URL SEFAZ. Ambiente/UF/certificado/CNPJ vêm da configuração fiscal oficial via `obterContextoOperacional()`. Timeouts e sync permanecem na config operacional da Central.

Rotas: `GET|PUT /configuracao`, `POST .../testar-sefaz|testar-certificado|health|limpar-cache|restaurar`.

Sync HTTP: **nunca 502** — 200 / 422 (config) / 503 (SEFAZ) + `mensagemAmigavel`.

## Certificação — unicidade

| Pergunta | Resposta |
|---|---|
| Existe apenas um pipeline? | **Sim** — `CentralProcessamentoService` (Parser → MIIP → Status) |
| Existe apenas um orchestrator? | **Sim** — `CentralEntradasOrchestrator` (singleton) |
| Existe apenas uma máquina de estados? | **Sim** — `MaquinaEstadosDocumento` + `DocumentoTransitionService` |
| Existe apenas uma forma de importar? | **Sim** — `CentralDfePersistenciaService` (upload / DF-e / chave) |
| Existe apenas uma integração MIIP? | **Sim** — via `CentralProcessamentoService` |
| Existe apenas uma forma de criar compras? | **Sim** — Bridge → Compras; vínculo via Orchestrator |
| Existe apenas um fluxo de processamento? | **Sim** — `processar` / `processarDocumentosPendentes` |
| Existe apenas um serviço de configuração? | **Sim** — `CentralConfiguracaoService` (ops) + fonte fiscal única `getFiscalConfig` (RC3.1) |
| Existe apenas uma configuração de ambiente SEFAZ? | **Sim** — `fiscal_ambiente` (Configurações Avançadas); Central só consome |

## Fluxo oficial unificado

```mermaid
flowchart TB
    subgraph Entrada
        DFE[Sync DF-e SEFAZ]
        UPLOAD[Upload XML]
        CHAVE[Consulta por chave]
    end

    subgraph Persistencia
        PERS[CentralDfePersistenciaService]
        SINCRONIZADA[Status: SINCRONIZADA]
    end

    subgraph Orchestrator
        ORCH[CentralEntradasOrchestrator]
        AUTO[processarDocumentosPendentes]
    end

    subgraph Pipeline
        PROC[CentralProcessamentoService]
        PARSE[Parser Oficial]
        MIIP[enriquecerParseComMiip]
        STATUS{Pendências MIIP?}
    end

    subgraph Saida
        REV[EM_REVISAO — revisão se necessária]
        FIN[finalizarEntrada]
        PRONTA[PRONTA_IMPORTACAO — estado interno]
        IMPORT[EM_IMPORTACAO — abre Compras]
        COMPRAS[Conferência + Salvar Compra → IMPORTADA]
    end

    DFE --> PERS
    UPLOAD --> PERS
    CHAVE --> PERS
    PERS --> SINCRONIZADA
    SINCRONIZADA --> ORCH
    ORCH --> AUTO
    AUTO --> PROC
    PROC --> PARSE --> MIIP --> STATUS
    STATUS -->|sim| REV
    STATUS -->|não| FIN
    REV --> FIN
    FIN --> PRONTA
    PRONTA --> IMPORT
    IMPORT --> COMPRAS
```

### Fluxo operacional (UX)

```
XML/DF-e → Parser → MIIP
  → Revisão quando necessária
  → Finalizar Entrada (POST /:id/finalizar-entrada)
  → Compras abre automaticamente (formulário preenchido)
  → Usuário confere e Salva Compra
  → Vínculo Central ↔ Compra → IMPORTADA
```

**Importante:** `PRONTA_IMPORTACAO` continua existindo na máquina de estados, mas **não é etapa operacional** que exige segundo clique. É transição interna do `finalizarEntrada`.

`FINALIZAR ENTRADA` ≠ `SALVAR COMPRA`. A automação termina em abrir Compras; o Motor de Compras permanece soberano sobre a gravação.

## Máquina de estados

```
RECEBIDA (reservado)
  → SINCRONIZADA | DUPLICADA | ERRO

SINCRONIZADA
  → EM_PROCESSAMENTO | DESCARTADA | DUPLICADA | ERRO

EM_PROCESSAMENTO
  → AGUARDANDO_REVISAO | PRONTA_PARA_COMPRA | ERRO

AGUARDANDO_REVISAO
  → REVISADA | DESCARTADA | ERRO

REVISADA
  → PRONTA_PARA_COMPRA | EM_COMPRA | DESCARTADA

PRONTA_PARA_COMPRA
  → EM_COMPRA | DESCARTADA

EM_COMPRA
  → GRAVADA | PRONTA_PARA_COMPRA

ERRO → SINCRONIZADA
GRAVADA / DESCARTADA / DUPLICADA → (terminais)
```

Atualizações de status (exceto insert inicial) passam por `DocumentoTransitionService`.

## Eventos

Campos: `tipo`, `origem`, `descricao`, `resultado`, `sucesso`, `documentoId`, `usuarioId` (em detalhe), `duracaoMs` (tempo), `timestamp` (`created_at`).

Emissão única via `centralEventosEmitter.emitirEvento` (inclui sync).

Origens: `background`, `manual`, `api`, `sistema`, `abrir_central`, `diagnostico`, `upload`, `compras`.

## Notificações

Padrão único: `CentralNotificacoesService.criarPadrao`.

- Sync: **uma** notificação consolidada (`NOVAS_NOTAS` | `SYNC_CONCLUIDA` | `SYNC_ERRO`)
- Documento pronto / compra: notificações por documento (canais distintos, documentados)

## Indicadores

`GET /api/central-entradas/inteligencia` — calcula **alertas uma vez** e deriva operacional, pendências, atenção e alertas.

Endpoints legados (`/operacional`, `/alertas`, `/pendencias`, `/atencao`) permanecem.

## Logs

```
[Central Entradas][<AREA>] <ISO8601> | Campo: valor
```

## Integração Compras

`rotas/compras.js` → `CentralEntradasOrchestrator.vincularCompra` (singleton DI).

## Exceções documentadas

| Item | Motivo |
|---|---|
| Certificado path/senha | Fonte fiscal (cadastro); Central lê só via `CentralConfiguracaoService` |
| Insert inicial sem TransitionService | Persistência de inbox (SINCRONIZADA/DUPLICADA) |
| RECEBIDA | Estado reservado / default de `inserir` |
| Manifestação / Proxy / multi-CNPJ | Estrutura RC4 — não funcional |
| `CentralConfigService` | Adapter interno de sync (RC5) — provider oficial é `CentralConfiguracaoService` |

## Testes

```bash
npm run test:central-integridade
npm run test:central-entradas-rc4
```

Inclui estados, sprints 2–10, RC1–RC4.

## Performance (observações)

| Fluxo | Observação |
|---|---|
| Inteligência UX | 1× alertas (antes 3–4×) |
| Sync DF-e | Dominado por SEFAZ / SoapTransport; config via Central |
| Upload / Parser / MIIP | Pipeline único; reuso de `parseJson` |
| Dashboard | Contadores por status — OK |
