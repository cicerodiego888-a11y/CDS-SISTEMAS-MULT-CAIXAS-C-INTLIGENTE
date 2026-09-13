'use strict';

const IntentEngine = require('./IntentEngine');
const Planner = require('./Planner');
const { criarToolRegistry } = require('./ToolRegistry');
const { autorizar, autorizarPlano } = require('./AgentPermissions');
const OperationalMemory = require('./OperationalMemory');
const AgentAudit = require('./AgentAudit');

/**
 * Agent Orchestrator — interpreta → planeja → consulta motores → responde.
 */
class AgentOrchestrator {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.intent = new IntentEngine();
    this.planner = new Planner();
    this.tools = criarToolRegistry({ db });
    this.memory = new OperationalMemory();
    this.audit = new AgentAudit(db);
  }

  listarTools() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      motor: t.motor,
      descricao: t.descricao,
      permissao: t.permissao,
      somenteLeitura: t.somenteLeitura !== false,
      critica: Boolean(t.critica)
    }));
  }

  /**
   * Chat principal.
   * @param {{ mensagem: string, origem?: string, confirmar?: boolean, confirmacao_id?: string }} req
   * @param {object} userCtx
   */
  async chat(req = {}, userCtx = {}) {
    const inicio = process.hrtime.bigint();
    const mensagem = String(req.mensagem || req.message || '').trim();
    const ctx = {
      operador_id: userCtx.id || userCtx.operador_id || null,
      filial_id: userCtx.filial_id || null,
      sessao_id: req.sessao_id || userCtx.sessao_id || 'default',
      role: userCtx.role,
      perfil: userCtx.perfil,
      permissoes: userCtx.permissoes,
      origem: req.origem || 'erp'
    };

    // confirmação de ação pendente
    if (req.confirmar && this.memory.get(ctx).pendenteConfirmacao) {
      return this._confirmar(ctx, req, inicio);
    }

    if (!mensagem) {
      return {
        ok: true,
        resposta: 'Como posso ajudar? Exemplos: "produtos sem estoque", "buscar coca", "previsão de vendas".',
        intent: 'help',
        plano: null
      };
    }

    const classificacao = this.intent.classificar(mensagem);
    const mem = this.memory.get(ctx);
    const plano = this.planner.planejar(classificacao, mem);

    const auth = autorizarPlano(userCtx, plano);
    if (!auth.ok) {
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      await this.audit.registrar({
        ...ctx,
        intent: plano.intent,
        pergunta: mensagem,
        plano,
        motores: [],
        tempo_ms: ms,
        ok: false,
        resultado_resumo: auth.motivo,
        permissao: plano.permissao
      });
      return {
        ok: false,
        bloqueado: true,
        resposta: auth.motivo,
        intent: plano.intent,
        plano
      };
    }

    if (plano.intent === IntentEngine.INTENTS.HELP || !plano.steps.length) {
      return {
        ok: true,
        resposta: this._ajuda(),
        intent: 'help',
        plano,
        tools: this.listarTools().slice(0, 12)
      };
    }

    // se crítica e ainda não confirmou — só prepara
    if (plano.requerConfirmacao && !req.confirmar) {
      const prep = await this._executarPlano(plano, ctx, { stopOnCritical: true });
      const pendente = {
        id: `conf_${Date.now()}`,
        intent: plano.intent,
        plano,
        resumo: prep.resultados.find((r) => r.tool === 'action.prepare_critical')?.data?.resumo
          || 'Ação crítica pendente'
      };
      this.memory.setPendente(ctx, pendente);
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
      await this.audit.registrar({
        ...ctx,
        intent: plano.intent,
        pergunta: mensagem,
        plano,
        motores: prep.motores,
        tempo_ms: ms,
        ok: true,
        resultado_resumo: 'Aguardando confirmação',
        permissao: plano.permissao
      });
      return {
        ok: true,
        requerConfirmacao: true,
        confirmacao_id: pendente.id,
        resposta: `⚠️ Esta ação exige confirmação: ${pendente.resumo}. Responda confirmando (confirmar=true) para prosseguir.`,
        intent: plano.intent,
        plano,
        motores: prep.motores,
        resultados: prep.resultados,
        tempoMs: Number(ms.toFixed(2))
      };
    }

    const exec = await this._executarPlano(plano, ctx, {});
    const resposta = this._montarResposta(plano, exec);
    const lista = this._extrairLista(exec);

    this.memory.rememberTurn(ctx, {
      intent: plano.intent,
      pergunta: mensagem,
      resposta: resposta.slice(0, 500),
      entidades: plano.entidades,
      lista
    });

    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    await this.audit.registrar({
      ...ctx,
      intent: plano.intent,
      pergunta: mensagem,
      plano,
      motores: exec.motores,
      tempo_ms: ms,
      ok: true,
      resultado_resumo: resposta.slice(0, 200),
      permissao: plano.permissao
    });

    return {
      ok: true,
      resposta,
      intent: plano.intent,
      plano: {
        intent: plano.intent,
        steps: plano.steps.map((s) => ({ tool: s.tool, porque: s.porque })),
        critica: plano.critica
      },
      motores: exec.motores,
      resultados: exec.resultados,
      sugestoes: this._sugestoes(plano.intent),
      tempoMs: Number(ms.toFixed(2))
    };
  }

  /**
   * Executa plano já confirmado / tool direta.
   */
  async execute(req = {}, userCtx = {}) {
    if (req.confirmar || req.confirmacao_id) {
      return this.chat({ ...req, mensagem: req.mensagem || 'confirmar', confirmar: true }, userCtx);
    }
    if (req.tool) {
      const tool = this.tools.get(req.tool);
      if (!tool) return { ok: false, erro: 'Tool desconhecida' };
      const auth = autorizar(userCtx, tool.permissao);
      if (!auth.ok) return { ok: false, bloqueado: true, erro: auth.motivo };
      if (tool.critica && !req.confirmar) {
        return { ok: false, requerConfirmacao: true, erro: 'Tool crítica exige confirmação' };
      }
      const data = await tool.execute(req.args || {}, {
        operador_id: userCtx.id,
        filial_id: userCtx.filial_id
      });
      return { ok: true, tool: tool.name, motor: tool.motor, data };
    }
    return this.chat(req, userCtx);
  }

  async _confirmar(ctx, req, inicio) {
    const pendente = this.memory.get(ctx).pendenteConfirmacao;
    this.memory.clearPendente(ctx);
    // CIA não executa destrutivo nos motores — registra confirmação e orienta
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const resposta = `Confirmação registrada para "${pendente.resumo}". `
      + 'A execução definitiva permanece nos módulos oficiais do ERP/PDV (CIA não substitui fluxos críticos).';
    await this.audit.registrar({
      ...ctx,
      intent: pendente.intent,
      pergunta: 'CONFIRMADO',
      plano: pendente.plano,
      motores: ['CIA'],
      tempo_ms: ms,
      ok: true,
      resultado_resumo: resposta,
      permissao: pendente.plano?.permissao
    });
    return {
      ok: true,
      confirmado: true,
      resposta,
      intent: pendente.intent,
      confirmacao_id: pendente.id || req.confirmacao_id,
      tempoMs: Number(ms.toFixed(2))
    };
  }

  async _executarPlano(plano, ctx, opcoes = {}) {
    const resultados = [];
    const motores = new Set();

    for (const step of plano.steps) {
      const tool = this.tools.get(step.tool);
      if (!tool) {
        resultados.push({ tool: step.tool, ok: false, erro: 'tool_nao_registrada' });
        continue;
      }

      const authTool = autorizar(ctx, tool.permissao);
      if (!authTool.ok) {
        resultados.push({ tool: step.tool, ok: false, bloqueado: true, erro: authTool.motivo });
        continue;
      }

      if (opcoes.stopOnCritical && tool.name === 'action.prepare_critical') {
        const data = await tool.execute(step.args || {}, ctx);
        motores.add(tool.motor);
        resultados.push({ tool: tool.name, motor: tool.motor, ok: true, data });
        break;
      }

      try {
        const data = await tool.execute({ ...(step.args || {}), origem: ctx.origem }, ctx);
        motores.add(tool.motor);
        resultados.push({ tool: tool.name, motor: tool.motor, ok: true, data });
      } catch (err) {
        resultados.push({ tool: tool.name, motor: tool.motor, ok: false, erro: err.message });
      }
    }

    return { resultados, motores: [...motores] };
  }

  _montarResposta(plano, exec) {
    const partes = [];
    for (const r of exec.resultados) {
      if (!r.ok) {
        partes.push(`⚠️ ${r.tool}: ${r.erro || 'falha'}`);
        continue;
      }
      if (r.tool === 'mib.search') {
        const itens = r.data?.itens || [];
        if (!itens.length) partes.push('Nenhum resultado encontrado.');
        else {
          partes.push(`Encontrei ${itens.length} item(ns):`);
          itens.slice(0, 8).forEach((i, idx) => {
            partes.push(`${idx + 1}. ${i.nome || i.username || i.codigo || i.id}`);
          });
        }
      } else if (r.tool === 'mib.recommend') {
        const recs = r.data?.recomendacoes || [];
        if (recs.length) {
          partes.push('Recomendações (MIB):');
          recs.slice(0, 5).forEach((x) => partes.push(`• ${x.nome} (${x.motivo || x.score})`));
        }
      } else if (r.tool === 'cip.insights' || r.tool === 'cip.analyze') {
        const resumo = r.data?.resumo || r.data?.insights?.resumo || {};
        partes.push(
          `Insights CIP — estoque crítico: ${resumo.estoqueCritico ?? '—'}, `
          + `zerados: ${resumo.produtosZerados ?? '—'}, `
          + `contas vencidas: ${resumo.contasVencidas ?? '—'}, `
          + `tendência: ${resumo.tendenciaVendas ?? '—'}.`
        );
        const riscos = r.data?.riscos || r.data?.insights?.riscos || [];
        riscos.slice(0, 3).forEach((x) => partes.push(`⚠ ${x.titulo}: ${x.mensagem}`));
      } else if (r.tool === 'cip.forecast') {
        const v = r.data?.vendas || {};
        partes.push(`Previsão de vendas: tendência ${v.tendencia || '—'}, média diária ${v.mediaDiaria ?? '—'}.`);
        const fluxo = r.data?.fluxoCaixa;
        if (fluxo) partes.push(`Fluxo 7d: entradas R$ ${fluxo.entradas7d}, risco vencido R$ ${fluxo.riscoVencido}.`);
      } else if (r.tool === 'cip.recommend') {
        const items = r.data?.items || [];
        items.slice(0, 5).forEach((x) => partes.push(`• ${x.titulo}: ${x.mensagem}`));
      } else if (r.tool === 'miip.identify') {
        if (r.data?.desabilitado) partes.push(r.data.mensagem);
        else if (r.data?.encontrado) partes.push(`MIIP encontrou produto #${r.data.produtoId}.`);
        else partes.push('MIIP não encontrou match confiável.');
      } else if (r.tool === 'miip.enrich') {
        const s = r.data?.sugestao || r.data?.sugestaoCadastro;
        if (s) partes.push(`Sugestão de cadastro — categoria: ${s.categoria?.nome || s.categoria?.id || '—'}, marca: ${s.marca?.nome || s.marca?.id || '—'}, NCM: ${s.ncm || '—'}.`);
      } else if (r.tool === 'action.prepare_critical') {
        partes.push(r.data?.mensagem || 'Aguardando confirmação.');
      } else if (r.tool === 'muc.status') {
        partes.push(`MUC ${r.data?.versao || ''} (${r.data?.codigo || ''}).`);
      }
    }
    if (!partes.length) return 'Concluído, sem detalhes adicionais.';
    return partes.join('\n');
  }

  _extrairLista(exec) {
    for (const r of exec.resultados) {
      if (r.tool === 'mib.search' && r.data?.itens?.length) {
        return r.data.itens.map((i) => ({ id: i.id, nome: i.nome }));
      }
    }
    return [];
  }

  _sugestoes(intent) {
    const base = [
      'Produtos sem estoque',
      'Previsão de vendas',
      'Quem está inadimplente?',
      'Buscar produto coca'
    ];
    if (intent === 'search_product') return ['Recomendações para este produto', ...base.slice(0, 2)];
    return base;
  }

  _ajuda() {
    return [
      'Sou o CDS Copiloto (CIA). Posso:',
      '• Buscar produtos/clientes (MIB)',
      '• Insights e previsões (CIP)',
      '• Identificar produto por GTIN (MIIP)',
      '• Preparar ações críticas com confirmação',
      '',
      'Exemplos: "produtos sem estoque", "buscar arroz", "previsão de vendas", "cadastrar produto pelo GTIN".'
    ].join('\n');
  }
}

module.exports = AgentOrchestrator;
