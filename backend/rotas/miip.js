/**
 * Rotas MIIP — API pública para identificação e feedback.
 *
 * Sprint 7: expõe identificação em lote para tela inteligente de importação XML.
 *
 * @module rotas/miip
 */

const express = require('express');
const { getMiipService } = require('../motores/miip/getMiipService');
const { mapearItemCompraParaIdentificavel } = require('../motores/miip/utils/mapearItemCompra');

const router = express.Router();

function miip() {
  return getMiipService();
}

const MOTOR_LABELS = Object.freeze({
  motor_gtin: 'GTIN / Código de Barras',
  motor_associacao_fornecedor: 'Associação Fornecedor'
});

const MOTORES_PERMITIDOS = Object.freeze([
  'motor_gtin',
  'motor_associacao_fornecedor'
]);

/**
 * @param {import('../motores/miip/core/MiipResult')|Object|null} resultado
 * @returns {string|null}
 */
function extrairMotorPrincipal(resultado) {
  const melhor = resultado?.candidatos?.[0];
  const motores = melhor?.motoresQueVotaram
    || resultado?.enginesExecutados
    || [];

  const permitido = motores.find((motor) => MOTORES_PERMITIDOS.includes(motor));
  if (permitido) return permitido;

  return motores[0] || null;
}

/**
 * @param {number} indice
 * @param {Object} miipResp
 * @returns {Object}
 */
function formatarSugestaoMiip(indice, miipResp) {
  const resultado = miipResp?.resultado;
  const produtoId = miipResp?.produtoId;
  const melhor = resultado?.candidatos?.[0];

  if (!produtoId || !melhor) {
    return {
      indice,
      encontrado: false,
      desabilitado: Boolean(miipResp?.desabilitado)
    };
  }

  const acao = resultado?.decisao?.acao;
  if (acao === 'criar_novo' || acao === 'revisar_manual') {
    return {
      indice,
      encontrado: false,
      desabilitado: Boolean(miipResp?.desabilitado)
    };
  }

  const produto = melhor.produto || {};
  const motor = extrairMotorPrincipal(resultado);

  if (motor && !MOTORES_PERMITIDOS.includes(motor)) {
    return {
      indice,
      encontrado: false,
      desabilitado: Boolean(miipResp?.desabilitado)
    };
  }

  return {
    indice,
    encontrado: true,
    produtoId: Number(produtoId),
    produtoNome: produto.nome || melhor.produtoNome || '',
    produtoCodigo: produto.codigo || '',
    codigoBarras: produto.codigoBarras || melhor.codigoBarras || null,
    confianca: resultado?.decisao?.confianca || melhor.confianca || 'NENHUMA',
    motor,
    motorLabel: MOTOR_LABELS[motor] || motor || 'MIIP',
    score: Number(resultado?.score?.valor ?? melhor.scoreTotal ?? 0),
    acao,
    operacaoId: resultado?.requestId || `miip-xml-${Date.now()}-${indice}`
  };
}

/**
 * POST /api/miip/identificar-lote
 * Body: { itens: [], fornecedor_cnpj?, fornecedor?, origem? }
 */
router.post('/identificar-lote', async (req, res) => {
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    const fornecedorCnpj = req.body?.fornecedor_cnpj || req.body?.fornecedorCnpj || null;
    const fornecedorNome = req.body?.fornecedor || req.body?.fornecedor_nome || null;

    if (itens.length === 0) {
      return res.json({
        usarMiip: miip().estaHabilitado(),
        itens: []
      });
    }

    const contexto = {
      origem: req.body?.origem || 'compra',
      ponto: 'importacao_xml'
    };

    const resultados = [];

    for (let indice = 0; indice < itens.length; indice += 1) {
      const bruto = itens[indice] || {};
      const item = mapearItemCompraParaIdentificavel({
        ...bruto,
        fornecedor_cnpj: bruto.fornecedor_cnpj || bruto.fornecedorCnpj || fornecedorCnpj,
        fornecedor_nome: bruto.fornecedor_nome || bruto.fornecedorNome || fornecedorNome
      });

      const miipResp = await miip().identificar(item, contexto);
      resultados.push(formatarSugestaoMiip(indice, miipResp));
    }

    return res.json({
      usarMiip: miip().estaHabilitado(),
      total: resultados.length,
      totalSugestoes: resultados.filter((r) => r.encontrado).length,
      itens: resultados
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Erro ao identificar itens com MIIP.'
    });
  }
});

/**
 * POST /api/miip/feedback
 * Body: confirmação manual → MiipLearningService
 */
router.post('/feedback', async (req, res) => {
  try {
    const feedback = req.body || {};
    const usuarioId = req.user?.id ?? feedback.usuarioId ?? feedback.usuario_id ?? null;

    const resultado = await miip().registrarFeedback({
      ...feedback,
      confirmado: feedback.confirmado === true,
      usuarioId
    });

    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      error: error?.message || 'Erro ao registrar feedback MIIP.'
    });
  }
});

/**
 * GET /api/miip/health — Saúde RC1 (somente leitura)
 */
router.get('/health', async (req, res) => {
  try {
    const health = await miip().healthCheck();
    const status = health.pronto ? 200 : 503;
    return res.status(status).json(health);
  } catch (error) {
    return res.status(503).json({
      pronto: false,
      versao: '1.0.0-rc1',
      erro: error?.message || 'Erro no health check MIIP'
    });
  }
});

module.exports = router;
