# core/

Contratos e tipos de domínio do MIIP.

**Sprint 1.1:** `MiipEvidence`, `MiipCandidate` e auditoria em `MiipResult`.

## Arquivos

| Arquivo | Tipo | Responsabilidade |
|---------|------|------------------|
| `IMotorIdentificacao.js` | Classe abstrata | Contrato para engines plugáveis |
| `MotorRegistry.js` | Registry | Registro, metadados e toggle ativo/inativo |
| `MiipAction.js` | Enum + helpers | Ações recomendadas (`auto_vincular`, `sugerir`, etc.) |
| `MiipConfidence.js` | Enum + helpers | Níveis de confiança (`ALTA`, `MEDIA`, `BAIXA`, `NENHUMA`) |
| `MiipContext.js` | Value object | Metadados da operação (origem, usuário, sessão) |
| `MiipResult.js` | Value object | Resultado consolidado + auditoria de execução |
| `MiipScore.js` | Value object | Score de identificação (valor, gap, engines concordantes) |
| `MiipEvidence.js` | Value object | Evidência produzida por um motor |
| `MiipCandidate.js` | Value object | Candidato consolidado para o Orchestrator |
| `SemanticProduct.js` | Value object | Produto semanticamente estruturado (Sprint 7.2) |
| `SemanticAttribute.js` | Value object | Atributo semântico individual |
| `SemanticAttributeType.js` | Enum | Tipos oficiais de atributo |
| `SemanticMetadata.js` | Value object | Metadados de entidades semânticas |
| `SemanticExtractionReport.js` | Value object | Relatório de extração de atributos (Sprint 8) |
| `SynonymMatch.js` | Value object | Sinônimo encontrado no enriquecimento semântico |
| `SynonymReport.js` | Value object | Relatório do Motor de Sinônimos |
| `SimilarityVote.js` | Value object | Voto individual na comparação de similaridade (Sprint 10) |
| `SimilarityExplanation.js` | Value object | Explicação amigável da similaridade |
| `SimilarityStatistics.js` | Value object | Métricas da comparação de similaridade |
| `SimilarityResult.js` | Value object | Resultado consolidado da similaridade |
| `DecisionAction.js` | Enum | Ações oficiais do Decision Engine (Sprint 11) |
| `DecisionRule.js` | Value object | Regra configurável de decisão |
| `DecisionResult.js` | Value object | Resultado oficial da decisão MIIP |
| `DecisionExplanation.js` | Value object | Explicação amigável da decisão |
| `DecisionStatistics.js` | Value object | Métricas da decisão |
| `DecisionHistory.js` | Value object | Registro histórico de decisões |
| `DecisionEngine.js` | Serviço | Cérebro decisório do MIIP (Sprint 11) |
| `MiipExplanation.js` | Value object | Explicação oficial de decisão (Sprint 12) |
| `ExplainReport.js` | Value object | Relatório para Central MIIP |
| `MiipExplainService.js` | Serviço | Camada de explicabilidade (Sprint 12) |

## Auditoria (Sprint 13)

| Arquivo | Tipo | Responsabilidade |
|---------|------|------------------|
| `audit/MiipAuditService.js` | Serviço | Auditoria final e relatório de prontidão |
| `audit/MiipHealthCheck.js` | Serviço | Verificação de saúde do MIIP |
| `audit/MiipPerformanceReport.js` | Serviço | Performance das suítes de teste |
| `audit/MiipArchitectureValidator.js` | Validador | Arquitetura e responsabilidades |
| `audit/MiipDecisionValidator.js` | Validador | Fluxo decisório centralizado |

## Telemetria (Sprint 14)

| Arquivo | Tipo | Responsabilidade |
|---------|------|------------------|
| `services/MiipTelemetryService.js` | Serviço | Telemetria de execuções |
| `services/MiipMonitoringService.js` | Serviço | Monitoramento operacional |
| `services/MiipDiagnosticService.js` | Serviço | Diagnóstico e health check |
| `core/MiipExecutionReport.js` | Value object | Relatório por execução |
| `core/MiipHealthStatus.js` | Enum | Estados OK / WARNING / ERROR |
| `core/MiipPerformanceMetrics.js` | Value object | Métricas agregadas |

## Pipeline (Sprint 2)

| Arquivo | Tipo | Responsabilidade |
|---------|------|------------------|
| `MiipPipeline.js` | Orquestrador | Cérebro do MIIP — fluxo completo de execução |
| `MiipExecution.js` | Aggregate | Representa uma execução completa |
| `MiipExecutionState.js` | Enum | Estados: CRIADO → INICIADO → EXECUTANDO → CONSOLIDANDO → FINALIZADO / ERRO |
| `MiipExecutionTimeline.js` | Serviço | Registro cronológico de cada etapa |
| `MiipRequest.js` | DTO entrada | Requisição recebida pelo pipeline |
| `MiipResponse.js` | DTO saída | Resposta entregue ao chamador |
| `MiipCandidateCollection.js` | Coleção | Armazena, mescla, ordena e ranqueia candidatos |
| `MiipDecisionBuilder.js` | Builder | Fachada que delega ao DecisionEngine + ExplainService (Sprint 13) |
| `MiipReportBuilder.js` | Builder | Gera relatório estrutural da execução |
| `MiipPipelineMetricsCollector.js` | Métricas | Métricas por execução do pipeline (≠ métricas por motor) |

> **Regra:** nenhum Engine executa fora do `MiipPipeline`. O `MiipOrchestrator` existente será migrado para delegar ao pipeline em sprint futura.

## Uso

```javascript
const {
  MiipEvidence,
  MiipCandidate,
  MiipResult
} = require('./motores/miip').core;

const evidencia = MiipEvidence.agora({
  motor: 'motor_gtin',
  tipo: 'gtin_exato',
  descricao: 'GTIN encontrado',
  peso: 100,
  valor: '7891234567890',
  score: 100
});

const candidato = MiipCandidate.create({
  produtoId: 42,
  scoreTotal: 100,
  confianca: 'ALTA',
  ranking: 1,
  evidencias: [evidencia],
  motoresQueVotaram: ['motor_gtin']
});
```
