'use strict';

/**
 * Tool Registry — catálogo de ferramentas publicadas pelos motores.
 * CIA só chama estas tools; nunca SQL de negócio.
 */

/**
 * @typedef {object} AgentTool
 * @property {string} name
 * @property {string} motor
 * @property {string} descricao
 * @property {string|null} permissao
 * @property {boolean} [somenteLeitura]
 * @property {boolean} [critica]
 * @property {(args: object, ctx: object) => Promise<any>} execute
 */

/**
 * @param {{ db: any }} deps
 * @returns {Map<string, AgentTool>}
 */
function criarToolRegistry(deps) {
  const { db } = deps;
  /** @type {Map<string, AgentTool>} */
  const tools = new Map();

  const reg = (tool) => {
    tools.set(tool.name, tool);
  };

  // ── MIB ──────────────────────────────────────────────
  reg({
    name: 'mib.search',
    motor: 'MIB',
    descricao: 'Pesquisar entidades via SearchService',
    permissao: null,
    somenteLeitura: true,
    async execute(args) {
      const { obterSearchService } = require('../../mib');
      return obterSearchService(db).search({
        entity: args.entity || 'produto',
        query: args.query || '',
        limite: args.limite || 10,
        origem: args.origem || 'cia',
        skipAuth: true
      });
    }
  });

  reg({
    name: 'mib.recommend',
    motor: 'MIB',
    descricao: 'Recomendações do Knowledge Graph',
    permissao: 'produtos',
    somenteLeitura: true,
    async execute(args) {
      const { obterKnowledge } = require('../../mib');
      if (args.produto_id) {
        return obterKnowledge(db).recommendations(args.produto_id, args.limite || 5);
      }
      // busca produto e recomenda o primeiro
      const { obterSearchService } = require('../../mib');
      const r = await obterSearchService(db).search({
        entity: 'produto',
        query: args.query || '',
        limite: 1,
        skipAuth: true,
        origem: 'cia'
      });
      const id = r.itens?.[0]?.id;
      if (!id) return { recomendacoes: [], mensagem: 'Produto base não encontrado' };
      return obterKnowledge(db).recommendations(id, args.limite || 5);
    }
  });

  reg({
    name: 'mib.learn',
    motor: 'MIB',
    descricao: 'Registrar aprendizado de seleção',
    permissao: 'produtos',
    somenteLeitura: false,
    async execute(args, ctx) {
      const { obterMib } = require('../../mib');
      return obterMib(db).registrarAprendizado({
        ...args,
        operador_id: ctx.operador_id
      });
    }
  });

  // ── CIP ──────────────────────────────────────────────
  reg({
    name: 'cip.insights',
    motor: 'CIP',
    descricao: 'Insights consolidados da plataforma',
    permissao: 'relatorios',
    somenteLeitura: true,
    async execute(args) {
      const { obterCip } = require('../../cip');
      return obterCip(db).insights({ origem: args.origem || 'cia', force: true });
    }
  });

  reg({
    name: 'cip.forecast',
    motor: 'CIP',
    descricao: 'Previsões de vendas/estoque/caixa',
    permissao: 'relatorios',
    somenteLeitura: true,
    async execute(args) {
      const { obterCip } = require('../../cip');
      return obterCip(db).forecast({ origem: args.origem || 'cia' });
    }
  });

  reg({
    name: 'cip.recommend',
    motor: 'CIP',
    descricao: 'Recomendações CIP',
    permissao: 'relatorios',
    somenteLeitura: true,
    async execute(args) {
      const { obterCip } = require('../../cip');
      return obterCip(db).recommendations({ origem: args.origem || 'cia' });
    }
  });

  reg({
    name: 'cip.analyze',
    motor: 'CIP',
    descricao: 'Análise completa CIP',
    permissao: 'relatorios',
    somenteLeitura: true,
    async execute(args) {
      const { obterCip } = require('../../cip');
      return obterCip(db).analyze({
        origem: args.origem || 'cia',
        dryRun: true,
        automacao: false
      });
    }
  });

  // ── MIIP ─────────────────────────────────────────────
  reg({
    name: 'miip.identify',
    motor: 'MIIP',
    descricao: 'Identificar produto (GTIN/nome)',
    permissao: 'produtos',
    somenteLeitura: true,
    async execute(args) {
      const { getMiipService } = require('../../miip/getMiipService');
      const miip = getMiipService();
      if (typeof miip.estaHabilitado === 'function' && !miip.estaHabilitado()) {
        return { desabilitado: true, mensagem: 'MIIP desabilitado nesta instalação' };
      }
      return miip.identificar({
        nome: args.nome || args.query,
        gtin: args.gtin,
        codigo_barras: args.gtin || args.codigo_barras
      }, { origem: 'cia' });
    }
  });

  reg({
    name: 'miip.enrich',
    motor: 'MIIP',
    descricao: 'Enriquecer via MIB Knowledge (ponte)',
    permissao: 'produtos',
    somenteLeitura: true,
    async execute(args) {
      const { consultarGrafoMiip } = require('../../mib');
      return consultarGrafoMiip(db, {
        nome: args.nome || args.query,
        gtin: args.gtin,
        ncm: args.ncm
      }, { origem: 'cia' });
    }
  });

  // ── MUC (status only — conversão sob demanda em fluxos específicos) ──
  reg({
    name: 'muc.status',
    motor: 'MUC',
    descricao: 'Status do Motor Universal de Conversão',
    permissao: null,
    somenteLeitura: true,
    async execute() {
      const ver = require('../../muc/version');
      return { versao: ver.VERSAO, codigo: ver.CODIGO, tag: ver.TAG };
    }
  });

  // ── Ações críticas (plano + confirmação — não executam destrutivo aqui) ──
  reg({
    name: 'action.prepare_critical',
    motor: 'CIA',
    descricao: 'Prepara ação crítica para confirmação do usuário',
    permissao: null,
    critica: true,
    somenteLeitura: false,
    async execute(args) {
      return {
        pendenteConfirmacao: true,
        acao: args.acao,
        resumo: args.resumo,
        mensagem: 'Confirme explicitamente para executar esta ação.'
      };
    }
  });

  return tools;
}

module.exports = { criarToolRegistry };
