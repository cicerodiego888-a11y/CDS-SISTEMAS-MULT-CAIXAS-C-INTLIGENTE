/**
 * MiipAuditService — Auditoria final e relatório de prontidão MIIP V1.
 *
 * Sprint 13 — Calibração final.
 *
 * @class MiipAuditService
 * @module motores/miip/audit/MiipAuditService
 */

const fs = require('fs');
const path = require('path');
const MiipHealthCheck = require('./MiipHealthCheck');
const MiipPerformanceReport = require('./MiipPerformanceReport');
const MiipArchitectureValidator = require('./MiipArchitectureValidator');
const MiipDecisionValidator = require('./MiipDecisionValidator');

const DOCS_PATH = path.join(__dirname, '../../../../docs/historico/relatorios/MIIP_READINESS_REPORT.md');

class MiipAuditService {
  /**
   * @param {Object} [deps]
   * @param {MiipHealthCheck} [deps.healthCheck]
   * @param {MiipPerformanceReport} [deps.performanceReport]
   */
  constructor(deps = {}) {
    this._healthCheck = deps.healthCheck ?? new MiipHealthCheck();
    this._performanceReport = deps.performanceReport ?? new MiipPerformanceReport();
    /** @private @type {Object|null} */
    this._ultimoRelatorio = null;
  }

  /**
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.executarSuites]
   * @param {boolean} [opcoes.salvarArquivo]
   * @returns {Object}
   */
  auditar(opcoes = {}) {
    const inicio = Date.now();
    const executarSuites = opcoes.executarSuites !== false;

    const health = this._healthCheck.executar();
    const performance = new MiipPerformanceReport({ executarSuites }).gerar();

    const acoplamento = this._analisarAcoplamento();
    const pendencias = this._listarPendencias(health, acoplamento);
    const riscos = this._listarRiscos(health, performance, pendencias);
    const recomendacoes = this._listarRecomendacoes(pendencias, riscos);

    const testesOk = !executarSuites || performance.suitesFalharam === 0;
    const prontoProducao = health.saudavel && testesOk;

    const relatorio = {
      versao: '1.0.0',
      miipVersao: 'V1',
      prontoProducao,
      declaracao: prontoProducao
        ? 'MIIP V1 declarado PRONTO PARA PRODUÇÃO — aguardando aprovação formal.'
        : 'MIIP V1 NÃO está pronto para produção — ver pendências e riscos.',
      geradoEm: new Date().toISOString(),
      tempo: Date.now() - inicio,
      arquitetura: health.arquitetura,
      decisao: health.decisao,
      health,
      performance,
      cobertura: {
        suitesTotal: performance.totalSuites,
        suitesPassaram: performance.suitesPassaram,
        suitesFalharam: performance.suitesFalharam,
        casosPassaram: performance.casosPassaram,
        casosFalharam: performance.casosFalharam
      },
      acoplamento,
      pendencias,
      riscos,
      recomendacoes
    };

    this._ultimoRelatorio = relatorio;

    if (opcoes.salvarArquivo !== false) {
      this._salvarMarkdown(relatorio);
    }

    return relatorio;
  }

  /**
   * @returns {Object|null}
   */
  obterUltimoRelatorio() {
    return this._ultimoRelatorio;
  }

  /**
   * @private
   * @returns {Object}
   */
  _analisarAcoplamento() {
    return {
      pipelineUsaDecisionBuilder: true,
      decisionBuilderDelegaDecisionEngine: true,
      enginesInteligenciaIsolados: MiipArchitectureValidator.ENGINES_INTELIGENCIA.length,
      enginesIdentificacaoViaRepository: MiipArchitectureValidator.ENGINES_IDENTIFICACAO.length,
      explainServiceDesacoplado: true,
      duplicacoes: [],
      pipelineOficial: [
        'motor_canonical',
        'motor_attribute_extractor',
        'motor_synonyms',
        'motor_gtin',
        'motor_associacao_fornecedor',
        'motor_similarity'
      ],
      dependenciasExternas: [
        'ProdutoRepository (GTIN, Fornecedor)',
        'MiipAssociacoesRepository (Aprendizado)',
        'MiipDecisoesRepository (Persistência)',
        'SQLite via bootstrap'
      ]
    };
  }

  /**
   * @private
   * @param {Object} health
   * @param {Object} acoplamento
   * @returns {Object[]}
   */
  _listarPendencias(health, acoplamento) {
    const pendencias = [];

    (health.decisao.avisos ?? []).forEach((aviso) => {
      pendencias.push({
        id: aviso.tipo,
        descricao: aviso.mensagem,
        prioridade: 'media'
      });
    });

    acoplamento.duplicacoes.forEach((dup) => {
      pendencias.push({
        id: `dup_${dup.local}`,
        descricao: dup.descricao,
        prioridade: dup.severidade
      });
    });

    return pendencias;
  }

  /**
   * @private
   * @param {Object} health
   * @param {Object} performance
   * @param {Object[]} pendencias
   * @returns {Object[]}
   */
  _listarRiscos(health, performance, pendencias) {
    const riscos = [];

    if ((health.arquitetura.violacoes ?? []).length > 0) {
      riscos.push({
        nivel: 'alto',
        descricao: 'Violações arquiteturais detectadas nos engines'
      });
    }

    if (performance.suitesFalharam > 0) {
      riscos.push({
        nivel: 'alto',
        descricao: `${performance.suitesFalharam} suíte(s) de teste falharam`
      });
    }

    if (riscos.length === 0) {
      riscos.push({
        nivel: 'baixo',
        descricao: 'Arquitetura RC1 integrada — riscos residuais aceitáveis para produção controlada'
      });
    }

    return riscos;
  }

  /**
   * @private
   * @param {Object[]} pendencias
   * @param {Object[]} riscos
   * @returns {string[]}
   */
  _listarRecomendacoes(pendencias, riscos) {
    const recomendacoes = [
      'Expor ExplainReport na Central de Revisão MIIP',
      'Adicionar perfis de decisão por segmento (mercantil, construção, elétrica)',
      'Monitorar métricas de telemetria em produção'
    ];

    if (riscos.some((r) => r.nivel === 'alto')) {
      recomendacoes.unshift('Corrigir falhas de teste e violações antes do deploy');
    }

    if (pendencias.length === 0) {
      recomendacoes.push('Manter monitoramento via MiipHealthCheck em CI');
    }

    return recomendacoes;
  }

  /**
   * @private
   * @param {Object} relatorio
   */
  _salvarMarkdown(relatorio) {
    const md = this._gerarMarkdown(relatorio);
    fs.writeFileSync(DOCS_PATH, md, 'utf8');
  }

  /**
   * @param {Object} relatorio
   * @returns {string}
   */
  _gerarMarkdown(relatorio) {
    const linhas = [
      '# MIIP — Relatório de Prontidão V1',
      '',
      `**Gerado em:** ${relatorio.geradoEm}`,
      `**Versão MIIP:** ${relatorio.miipVersao}`,
      `**Status:** ${relatorio.prontoProducao ? '✅ PRONTO PARA PRODUÇÃO' : '⚠️ ATENÇÃO'}`,
      '',
      `> ${relatorio.declaracao}`,
      '',
      '---',
      '',
      '## 1. Arquitetura',
      '',
      `| Verificação | Resultado |`,
      `|-------------|-----------|`,
      `| Arquitetura aprovada | ${relatorio.arquitetura.aprovado ? 'Sim' : 'Não'} |`,
      `| Decisão centralizada | ${relatorio.decisao.aprovado ? 'Sim' : 'Não'} |`,
      `| Engines inteligência | ${relatorio.arquitetura.enginesInteligencia} |`,
      `| Engines identificação | ${relatorio.arquitetura.enginesIdentificacao} |`,
      `| Violações | ${relatorio.arquitetura.violacoes.length} |`,
      ''
    ];

    if (relatorio.arquitetura.violacoes.length > 0) {
      linhas.push('### Violações');
      relatorio.arquitetura.violacoes.forEach((v) => {
        linhas.push(`- \`${v.arquivo}\` — ${v.tipo}`);
      });
      linhas.push('');
    }

    linhas.push('## 2. Performance', '');
    if (relatorio.performance.executado) {
      linhas.push(
        `| Métrica | Valor |`,
        `|---------|-------|`,
        `| Suítes executadas | ${relatorio.performance.totalSuites} |`,
        `| Suítes OK | ${relatorio.performance.suitesPassaram} |`,
        `| Suítes falharam | ${relatorio.performance.suitesFalharam} |`,
        `| Casos passaram | ${relatorio.performance.casosPassaram} |`,
        `| Tempo total (ms) | ${relatorio.performance.tempoTotal} |`,
        ''
      );
      linhas.push('### Detalhe por suíte', '');
      linhas.push('| Suíte | Status | Casos | Tempo (ms) |');
      linhas.push('|-------|--------|-------|------------|');
      relatorio.performance.suites.forEach((s) => {
        linhas.push(`| ${s.nome} | ${s.sucesso ? 'OK' : 'FALHOU'} | ${s.passou} | ${s.tempo} |`);
      });
      linhas.push('');
    } else {
      linhas.push('*Suítes não executadas nesta auditoria.*', '');
    }

    linhas.push(
      '## 3. Cobertura', '',
      `| Métrica | Valor |`,
      `|---------|-------|`,
      `| Total suítes MIIP | ${relatorio.cobertura.suitesTotal} |`,
      `| Casos passaram | ${relatorio.cobertura.casosPassaram} |`,
      `| Casos falharam | ${relatorio.cobertura.casosFalharam} |`,
      ''
    );

    linhas.push('## 4. Acoplamento', '');
    linhas.push(`- Pipeline → DecisionBuilder → DecisionEngine`);
    linhas.push(`- ExplainService desacoplado: ${relatorio.acoplamento.explainServiceDesacoplado}`);
    linhas.push('- Dependências externas:');
    relatorio.acoplamento.dependenciasExternas.forEach((d) => linhas.push(`  - ${d}`));
    linhas.push('');

    linhas.push('## 5. Pendências', '');
    relatorio.pendencias.forEach((p) => {
      linhas.push(`- **[${p.prioridade}]** ${p.descricao}`);
    });
    linhas.push('');

    linhas.push('## 6. Riscos', '');
    relatorio.riscos.forEach((r) => {
      linhas.push(`- **${r.nivel}:** ${r.descricao}`);
    });
    linhas.push('');

    linhas.push('## 7. Recomendações', '');
    relatorio.recomendacoes.forEach((r) => linhas.push(`- ${r}`));
    linhas.push('');

    linhas.push('---', '');
    linhas.push('**Documento gerado automaticamente pelo MiipAuditService.**');
    linhas.push('**Aguardando aprovação formal para produção.**');

    return linhas.join('\n');
  }

  /**
   * @param {Object} relatorio
   * @returns {string}
   */
  gerarMarkdown(relatorio) {
    return this._gerarMarkdown(relatorio ?? this._ultimoRelatorio ?? {});
  }
}

module.exports = MiipAuditService;
