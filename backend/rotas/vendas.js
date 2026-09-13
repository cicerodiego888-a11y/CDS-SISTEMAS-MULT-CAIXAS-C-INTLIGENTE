const express = require('express');
const router = express.Router();
const db = require('../database');
const { validarCaixaAberto, validarCaixaSeOrigemPdv, validarCaixaAbertoCancelamentoVenda, validarCaixaAbertoDevolucaoVenda } = require('../middleware/validarCaixaAberto');
const { exigirSenhaAdmin } = require('../middleware/exigirSenhaAdmin');
const {
  FILTRO_VENDA_VALIDA,
  isModoFiscalRelatorio,
  getExprValorVenda,
  getExprValorItem,
  getExprValorItemFiscal,
  getExprValorItemNaoFiscal,
  getExprQuantidadeItem,
  getExprQuantidadeItemFiscal,
  getExprQuantidadeItemNaoFiscal,
  getFiltroItensFiscal
} = require('../services/reportFiscalHelpers');
const VendaFinanceiroService = require('../services/vendas/VendaFinanceiroService');
const VendaApplicationService = require('../services/vendas/VendaApplicationService');
const VendaPagamentoService = require('../services/vendas/VendaPagamentoService');
const VendaDevolucaoService = require('../services/vendas/VendaDevolucaoService');
const VendaCancelamentoService = require('../services/vendas/VendaCancelamentoService');

const { agoraLocalBrasil } = VendaFinanceiroService;
const { criarVenda } = VendaApplicationService;
const {
  preCalcularDistribuicao,
  consultarPagamentoNaoFiscal,
  registrarPagamentoNaoFiscal
} = VendaPagamentoService;
const { devolverParcial } = VendaDevolucaoService;
const { cancelarVendaPut, cancelarVendaPost } = VendaCancelamentoService;
const {
  mapearPagamentoRespostaApi,
  agruparPagamentosExibicaoPorVenda
} = require('../services/vendas/recebimentoPagamento');

function anexarPagamentosNasVendas(rows, done) {
  if (!rows || !rows.length) {
    return done(null, rows || []);
  }
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  db.all(
    `SELECT venda_id, tipo_recebimento, forma_pagamento, valor, status
     FROM venda_recebimentos
     WHERE venda_id IN (${ph})
     ORDER BY id`,
    ids,
    (recErr, recebimentos) => {
      if (recErr) return done(recErr);
      db.all(
        `SELECT venda_id, tipo_recebimento, forma_pagamento, valor
         FROM venda_pagamentos
         WHERE venda_id IN (${ph})
         ORDER BY id`,
        ids,
        (pagErr, pagamentos) => {
          if (pagErr) return done(pagErr);
          const porVenda = agruparPagamentosExibicaoPorVenda(recebimentos, pagamentos);
          const out = rows.map((v) => ({
            ...v,
            pagamentos: porVenda[Number(v.id)] || []
          }));
          done(null, out);
        }
      );
    }
  );
}
const {
  emitirNFeDevolucaoVenda,
  prepararNfeDevolucaoVenda,
  obterNfeDevolucaoVendaPorId,
  listarHistoricoDevolucaoVenda,
  cancelarNfeDevolucaoOficial,
  consultarSituacaoDevolucao,
  reenviarNfeDevolucao,
  listarEventosDevolucao,
  obterPainelStatus,
  obterXmlVersionado
} = require('../services/fiscal/nfeDevolucaoVenda');

// Listar vendas com busca
router.get('/', (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const todas = req.query.todas === '1';
  const somenteFiscal = String(req.query.modo || '').toLowerCase() === 'fiscal';

  let where = '';
  const params = [];

  if (busca) {
    where = `
      WHERE (
        v.id LIKE ?
        OR v.codigo LIKE ?
        OR c.nome LIKE ?
        OR v.forma_pagamento LIKE ?
        OR v.status LIKE ?
      )
    `;

    const termo = `%${busca}%`;
    params.push(termo, termo, termo, termo, termo);
  }

  if (!todas) {
    const dataHoje = agoraLocalBrasil().slice(0, 10);
    where += (where ? ' AND ' : ' WHERE ');
    where += ` v.data_venda = ? `;
    params.push(dataHoje);
  }

  if (somenteFiscal) {
    where += (where ? ' AND ' : ' WHERE ');
    // Lista "modo fiscal" = vendas com documento fiscal (NFC-e ou NF-e).
    where += ` (n.id IS NOT NULL OR nfe.id IS NOT NULL) `;
  }

  db.all(`
    SELECT
      v.id,
      v.codigo,
      v.data_venda,
      v.created_at,
      v.cliente_id,
      v.total,
      v.valor_fiscal,
      v.valor_nao_fiscal,
      v.desconto,
      v.forma_pagamento,
      v.status,
      v.pedido_id,
      n.id AS nfce_id,
      n.numero AS nfce_numero,
      n.status AS nfce_status,
      n.chave_acesso AS nfce_chave,
      nfe.id AS nfe_id,
      nfe.numero AS nfe_numero,
      nfe.serie AS nfe_serie,
      nfe.status AS nfe_status,
      nfe.chave_acesso AS nfe_chave,
      nfe.protocolo AS nfe_protocolo,
      c.nome AS cliente_nome,
      (
        SELECT COUNT(*)
        FROM vendas_itens vi
        WHERE vi.venda_id = v.id
      ) AS total_itens
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN nfce_notas n ON n.id = (
      SELECT n2.id
      FROM nfce_notas n2
      WHERE n2.venda_id = v.id
      ORDER BY n2.id DESC
      LIMIT 1
    )
    LEFT JOIN nfe_notas nfe ON nfe.id = (
      SELECT nfe2.id
      FROM nfe_notas nfe2
      WHERE nfe2.venda_id = v.id
        AND LOWER(COALESCE(nfe2.status, '')) = 'autorizada'
      ORDER BY nfe2.id DESC
      LIMIT 1
    )
    ${where}
    ORDER BY v.data_venda DESC, v.id DESC
  `, params, (err, rows) => {
    if (err) {
      console.error('Erro ao listar vendas:', err);
      return res.status(500).json({ error: err.message });
    }

    res.setHeader('Cache-Control', 'no-store');
    anexarPagamentosNasVendas(rows || [], (pagErr, comPagamentos) => {
      if (pagErr) {
        console.error('Erro ao anexar pagamentos na listagem de vendas:', pagErr);
        return res.status(500).json({ error: pagErr.message });
      }
      res.json(comPagamentos);
    });
  });
});

// Buscar venda por ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get(`
    SELECT
      v.*,
      c.nome AS cliente_nome,
      c.cpf_cnpj AS cliente_cpf,
      n.id AS nfce_id,
      n.numero AS nfce_numero,
      n.status AS nfce_status,
      n.chave_acesso AS nfce_chave,
      nfe.id AS nfe_id,
      nfe.numero AS nfe_numero,
      nfe.serie AS nfe_serie,
      nfe.status AS nfe_status,
      nfe.chave_acesso AS nfe_chave,
      nfe.protocolo AS nfe_protocolo
    FROM vendas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    LEFT JOIN nfce_notas n ON n.id = (
      SELECT n2.id
      FROM nfce_notas n2
      WHERE n2.venda_id = v.id
      ORDER BY n2.id DESC
      LIMIT 1
    )
    LEFT JOIN nfe_notas nfe ON nfe.id = (
      SELECT nfe2.id
      FROM nfe_notas nfe2
      WHERE nfe2.venda_id = v.id
        AND LOWER(COALESCE(nfe2.status, '')) = 'autorizada'
      ORDER BY nfe2.id DESC
      LIMIT 1
    )
    WHERE v.id = ?
  `, [id], (err, venda) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    db.all(`
      SELECT vi.*, COALESCE(p.nome, 'Produto excluído') as produto_nome, p.codigo as produto_codigo, p.unidade
      FROM vendas_itens vi
      LEFT JOIN produtos p ON vi.produto_id = p.id
      WHERE vi.venda_id = ?
    `, [id], (err, itens) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      // Visão comercial: todos os itens originais (não filtrar pela NF-e).
      db.all(`
        SELECT tipo_recebimento, forma_pagamento, valor, status
        FROM venda_recebimentos
        WHERE venda_id = ?
        ORDER BY CASE
          WHEN LOWER(COALESCE(tipo_recebimento, '')) IN ('fiscal', 'a') THEN 0
          WHEN LOWER(COALESCE(tipo_recebimento, '')) IN ('nao_fiscal', 'b') THEN 1
          ELSE 2
        END, id
      `, [id], (recErr, recebimentos) => {
        if (recErr) {
          res.status(500).json({ error: recErr.message });
          return;
        }
        const concluir = (pagamentos) => {
          res.json({
            ...venda,
            itens,
            pagamentos: (pagamentos || []).map(mapearPagamentoRespostaApi)
          });
        };
        if (Array.isArray(recebimentos) && recebimentos.length > 0) {
          return concluir(recebimentos);
        }
        db.all(
          `SELECT forma_pagamento, valor, tipo_recebimento FROM venda_pagamentos WHERE venda_id = ?
           ORDER BY CASE
             WHEN LOWER(COALESCE(tipo_recebimento, '')) IN ('fiscal', 'a') THEN 0
             WHEN LOWER(COALESCE(tipo_recebimento, '')) IN ('nao_fiscal', 'b') THEN 1
             ELSE 2
           END, id`,
          [id],
          (pgErr, pags) => {
            if (pgErr) {
              res.status(500).json({ error: pgErr.message });
              return;
            }
            concluir(pags || []);
          }
        );
      });
    });
  });
});

// Buscar detalhes completos da venda para emissão de NFC-e
router.get('/:id/detalhes', (req, res) => {
  const vendaId = req.params.id;

  db.get(`
    SELECT v.*, c.nome as cliente_nome
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = ?
  `, [vendaId], (err, venda) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    db.all(`
      SELECT vi.*, COALESCE(p.nome, 'Produto excluído') as produto_nome
      FROM vendas_itens vi
      LEFT JOIN produtos p ON p.id = vi.produto_id
      WHERE vi.venda_id = ?
    `, [vendaId], (errItens, itens) => {
      if (errItens) return res.status(500).json({ error: errItens.message });

      res.json({
        venda,
        itens
      });
    });
  });
});

router.post('/pre-calcular-distribuicao', validarCaixaAberto, preCalcularDistribuicao);

// Sprint 2.2: PDV exige caixa; demais origens reconhecidas sem validarCaixaAberto
router.post('/', validarCaixaSeOrigemPdv, criarVenda);

router.get('/:id/pagamento-nao-fiscal', consultarPagamentoNaoFiscal);

router.post('/:id/pagamento-nao-fiscal', validarCaixaAberto, registrarPagamentoNaoFiscal);

router.post('/:id/devolver', validarCaixaAbertoDevolucaoVenda, exigirSenhaAdmin, (req, res) => {
  const vendaId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim();
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

  devolverParcial(vendaId, motivo, itens, req, res);
});

router.put('/:id/cancelar', validarCaixaAbertoCancelamentoVenda, (req, res) => {
  const { id } = req.params;
  const motivo = req.body.motivo || req.body.justificativa || '';
  cancelarVendaPut(id, motivo, req, res);
});

router.post('/cancelar/:id', validarCaixaAbertoCancelamentoVenda, (req, res) => {
  const vendaId = req.params.id;
  const { motivo } = req.body;
  cancelarVendaPost(vendaId, motivo, req, res);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);

  db.get(`
    SELECT *
    FROM vendas
    WHERE id = ?
  `, [id], (err, venda) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (venda.nfce_id) {
      return res.status(400).json({
        error: 'Venda fiscal não pode ser excluída. Cancele a NFC-e primeiro.'
      });
    }

    db.run(`
      DELETE FROM vendas_itens WHERE venda_id = ?
    `, [id], (errItens) => {
      if (errItens) {
        return res.status(500).json({ error: errItens.message });
      }

      db.run(`
        DELETE FROM vendas WHERE id = ?
      `, [id], (errVenda) => {
        if (errVenda) {
          return res.status(500).json({ error: errVenda.message });
        }

        res.json({
          success: true,
          message: 'Venda excluída com sucesso'
        });
      });
    });
  });
});

router.get('/relatorio/fechamento-caixa', (req, res) => {
  const { data_inicio, data_fim, modo_fiscal } = req.query;

  if (!data_inicio || !data_fim) {
    return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
  }

  const modoFiscal = modo_fiscal || '0';
  const exprValor = getExprValorVenda(modoFiscal);

  db.all(`
    SELECT
      forma_pagamento,
      COUNT(*) as quantidade,
      SUM(${exprValor}) as total
    FROM vendas v
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
    GROUP BY forma_pagamento
    ORDER BY total DESC
  `, [data_inicio, data_fim], (err, pagamentos) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.get(`
      SELECT
        COUNT(*) as quantidade_vendas,
        SUM(${exprValor}) as total_vendido,
        SUM(desconto) as total_descontos,
        AVG(${exprValor}) as ticket_medio
      FROM vendas v
      WHERE ${FILTRO_VENDA_VALIDA}
        AND date(v.data_venda) BETWEEN date(?) AND date(?)
    `, [data_inicio, data_fim], (errResumo, resumo) => {
      if (errResumo) {
        return res.status(500).json({ error: errResumo.message });
      }

      res.json({
        modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
        resumo: resumo || {
          quantidade_vendas: 0,
          total_vendido: 0,
          total_descontos: 0,
          ticket_medio: 0
        },
        pagamentos: pagamentos || []
      });
    });
  });
});

router.get('/relatorio/produtos-mais-vendidos', (req, res) => {
  const { data_inicio, data_fim, modo_fiscal, limite } = req.query;

  if (!data_inicio || !data_fim) {
    return res.status(400).json({ error: 'data_inicio e data_fim são obrigatórios' });
  }

  const modoFiscal = modo_fiscal || '0';
  const exprValor = getExprValorItem(modoFiscal);
  const exprQtd = getExprQuantidadeItem(modoFiscal);
  const exprQtdFiscal = getExprQuantidadeItemFiscal();
  const exprQtdNaoFiscal = getExprQuantidadeItemNaoFiscal();
  const exprValorFiscal = getExprValorItem('1');
  const exprValorNaoFiscal = getExprValorItemNaoFiscal();
  const filtroItens = getFiltroItensFiscal(modoFiscal);
  const limit = Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500);

  db.all(`
    SELECT
      p.id,
      p.codigo,
      p.nome,
      p.unidade,
      SUM(${exprQtd}) as quantidade_vendida,
      SUM(${exprQtdFiscal}) as quantidade_fiscal,
      SUM(${exprQtdNaoFiscal}) as quantidade_nao_fiscal,
      SUM(${exprValor}) as total_vendido,
      SUM(${exprValorFiscal}) as total_vendido_fiscal,
      SUM(${exprValorNaoFiscal}) as total_vendido_nao_fiscal,
      CASE
        WHEN SUM(${exprQtd}) > 0 THEN SUM(${exprValor}) / SUM(${exprQtd})
        ELSE AVG(vi.preco_unitario)
      END as preco_medio
    FROM vendas v
    INNER JOIN vendas_itens vi ON v.id = vi.venda_id
    INNER JOIN produtos p ON vi.produto_id = p.id
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
      ${filtroItens}
    GROUP BY p.id
    HAVING quantidade_vendida > 0
    ORDER BY total_vendido DESC
    LIMIT ?
  `, [data_inicio, data_fim, limit], (err, produtos) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({
      modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
      produtos: produtos || []
    });
  });
});

router.get('/relatorio/periodo', (req, res) => {
  const { data_inicio, data_fim, modo_fiscal } = req.query;
  const modoFiscal = modo_fiscal || '0';
  const exprValor = getExprValorVenda(modoFiscal);

  db.all(`
    SELECT
      DATE(v.data_venda) as data,
      COUNT(*) as total_vendas,
      SUM(${exprValor}) as valor_total,
      AVG(${exprValor}) as valor_medio,
      SUM(CASE WHEN v.cliente_id IS NOT NULL THEN 1 ELSE 0 END) as vendas_com_cliente
    FROM vendas v
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
    GROUP BY DATE(v.data_venda)
    ORDER BY data DESC
  `, [data_inicio, data_fim], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({
      modo_fiscal_ativo: isModoFiscalRelatorio(modoFiscal),
      dias: rows || []
    });
  });
});

/** RC5 — NF-e Devolução de Venda */
router.get('/:id/nfe-devolucao/preparar', async (req, res) => {
  try {
    const prep = await prepararNfeDevolucaoVenda(Number(req.params.id));
    res.json({ success: true, ...prep });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

router.get('/:id/nfe-devolucao/historico', async (req, res) => {
  try {
    const historico = await listarHistoricoDevolucaoVenda(Number(req.params.id));
    res.json({ success: true, ...historico });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/xml', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || 'assinado').toLowerCase();
    const xml = await obterXmlVersionado(Number(req.params.notaId), tipo);
    const nota = await obterNfeDevolucaoVendaPorId(Number(req.params.notaId));
    if (!nota) return res.status(404).json({ error: 'NF-e de devolução não encontrada.' });
    if (!xml) return res.status(404).json({ error: `XML (${tipo}) não disponível.` });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nfe-devolucao-venda-${tipo}-${nota.chave_acesso || nota.id}.xml"`
    );
    res.send(xml);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/danfe', async (req, res) => {
  try {
    const nota = await obterNfeDevolucaoVendaPorId(Number(req.params.notaId));
    if (!nota) return res.status(404).json({ error: 'NF-e de devolução não encontrada.' });
    const cancelado = String(req.query.tipo || '').toLowerCase() === 'cancelado';
    const html = cancelado ? nota.danfe_html_cancelado : nota.danfe_html;
    if (!html) return res.status(404).json({ error: 'DANFE não disponível.' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/status', async (req, res) => {
  try {
    const painel = await obterPainelStatus(Number(req.params.notaId));
    if (!painel) return res.status(404).json({ success: false, error: 'NF-e não encontrada.' });
    res.json({ success: true, ...painel });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/eventos', async (req, res) => {
  try {
    const eventos = await listarEventosDevolucao(Number(req.params.notaId));
    res.json({ success: true, eventos });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/nfe-devolucao/:notaId/consultar', async (req, res) => {
  try {
    const out = await consultarSituacaoDevolucao(Number(req.params.notaId), {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || null,
      ip: req.ip || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message, code: error.code });
  }
});

router.post('/nfe-devolucao/:notaId/reenviar', async (req, res) => {
  try {
    const out = await reenviarNfeDevolucao(Number(req.params.notaId), {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || null,
      ip: req.ip || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message, code: error.code });
  }
});

router.post('/nfe-devolucao/:notaId/cancelar', async (req, res) => {
  try {
    const out = await cancelarNfeDevolucaoOficial(Number(req.params.notaId), {
      motivo: req.body?.motivo || req.body?.justificativa,
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || null,
      ip: req.ip || null,
      forcarPrazo: Boolean(req.body?.forcarPrazo)
    });
    res.status(out.success ? 200 : 422).json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || error.codigo || null
    });
  }
});

router.post('/:id/emitir-nfe-devolucao', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await emitirNFeDevolucaoVenda(Number(req.params.id), {
      itens: body.itens,
      observacoes: body.observacoes,
      cfop: body.cfop,
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || null,
      ip: req.ip || null
    });

    if (!resultado.success && resultado.status === 'rejeitada') {
      return res.status(400).json({
        sucesso: false,
        autorizado: false,
        mensagem: resultado.message,
        cStat: resultado.cStat,
        xMotivo: resultado.xMotivo,
        resultado
      });
    }
    if (!resultado.success && ['erro_assinatura', 'erro_comunicacao', 'erro_validacao', 'modulo_desabilitado'].includes(resultado.status)) {
      return res.status(400).json({ sucesso: false, error: resultado.message, code: resultado.code, resultado });
    }

    res.json({
      message: resultado.message,
      resultado,
      notaId: resultado.notaId,
      status: resultado.status,
      chaveAcesso: resultado.chaveAcesso || resultado.chave,
      protocolo: resultado.protocolo,
      recibo: resultado.recibo || null,
      numero: resultado.numero,
      serie: resultado.serie,
      origem: 'VENDA'
    });
  } catch (error) {
    console.error('Erro ao emitir NF-e devolução venda:', error);
    res.status(error.statusCode || 500).json({
      error: error.message,
      code: error.code || null,
      erros: error.erros || null
    });
  }
});

module.exports = router;
