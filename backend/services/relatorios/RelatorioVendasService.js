const db = require('../../database');
const {
  FILTRO_VENDA_VALIDA,
  getExprValorVendaFiscal,
  getExprValorVendaNaoFiscal,
  getExprQuantidadeItemFiscal,
  getExprQuantidadeItemNaoFiscal
} = require('../reportFiscalHelpers');

function normalizarTipo(tipo) {
  const valor = String(tipo ?? '').trim().toUpperCase().replace(/[_\-\s]/g, '');

  if (['A', 'FISCALA'].includes(valor)) return 'A';
  if (['B', 'FISCALB'].includes(valor)) return 'B';

  return 'A';
}

async function colunaExiste(tabela, coluna) {
  return new Promise((resolve) => {
    db.all(`PRAGMA table_info(${tabela})`, (err, rows) => {
      if (err || !Array.isArray(rows)) {
        resolve(false);
        return;
      }
      resolve(rows.some((row) => row.name === coluna));
    });
  });
}

async function montarEmpresaFiltroSegura({ empresa_id, company_id, tenant_id }) {
  const ids = [
    { valor: empresa_id, campo: 'empresa_id' },
    { valor: company_id, campo: 'company_id' },
    { valor: tenant_id, campo: 'tenant_id' }
  ].filter((item) => item.valor !== undefined && item.valor !== null && item.valor !== '');

  if (!ids.length) {
    return { where: '', params: [] };
  }

  for (const item of ids) {
    const existe = await colunaExiste('vendas', item.campo);
    if (existe) {
      return {
        where: ` AND v.${item.campo} = ?`,
        params: [item.valor]
      };
    }
  }

  return { where: '', params: [] };
}

async function gerarRelatorioFiscal({ tipo, dataInicio, dataFim, empresa_id, company_id, tenant_id } = {}) {
  const tipoRelatorio = normalizarTipo(tipo);
  const inicio = String(dataInicio || '').trim();
  const fim = String(dataFim || '').trim();

  if (!inicio || !fim) {
    throw new Error('dataInicio e dataFim são obrigatórios');
  }

  const valorExpr = tipoRelatorio === 'A'
    ? getExprValorVendaFiscal('v')
    : getExprValorVendaNaoFiscal('v');
  const qtdExpr = tipoRelatorio === 'A'
    ? getExprQuantidadeItemFiscal('vi')
    : getExprQuantidadeItemNaoFiscal('vi');

  const empresaFiltro = await montarEmpresaFiltroSegura({ empresa_id, company_id, tenant_id });

  const resumoSql = `
    SELECT
      COUNT(DISTINCT v.id) AS vendas,
      COALESCE(SUM(${qtdExpr}), 0) AS itens,
      COALESCE(SUM(${valorExpr}), 0) AS valor_periodo
    FROM vendas v
    LEFT JOIN vendas_itens vi ON vi.venda_id = v.id
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
      ${empresaFiltro.where}
  `;

  const vendasSql = `
    SELECT
      v.id,
      v.codigo,
      v.data_venda,
      v.total,
      v.valor_fiscal,
      v.valor_nao_fiscal,
      v.forma_pagamento,
      v.status,
      COALESCE(c.nome, 'Cliente não informado') AS cliente_nome,
      COALESCE(u.nome, 'Operador não informado') AS operador_nome,
      CASE
        WHEN ? = 'A' THEN COALESCE(v.valor_fiscal, 0)
        ELSE COALESCE(v.valor_nao_fiscal, 0)
      END AS valor_relatorio,
      COALESCE((
        SELECT COUNT(*)
        FROM vendas_itens vi2
        WHERE vi2.venda_id = v.id
      ), 0) AS quantidade_itens,
      CASE
        WHEN COALESCE(v.valor_fiscal, 0) > 0 AND COALESCE(v.valor_nao_fiscal, 0) > 0 THEN 'MIXTA'
        WHEN COALESCE(v.valor_fiscal, 0) > 0 THEN 'FISCAL'
        WHEN COALESCE(v.valor_nao_fiscal, 0) > 0 THEN 'NAO_FISCAL'
        ELSE 'OUTROS'
      END AS classificacao_venda
    FROM vendas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN usuarios u ON u.id = v.operador_id
    WHERE ${FILTRO_VENDA_VALIDA}
      AND date(v.data_venda) BETWEEN date(?) AND date(?)
      ${empresaFiltro.where}
    ORDER BY v.data_venda DESC, v.id DESC
  `;

  const resumo = await new Promise((resolve, reject) => {
    db.get(resumoSql, [inicio, fim, ...empresaFiltro.params], (err, row) => {
      if (err) return reject(err);
      const dados = row || {};
      resolve({
        vendas: Number(dados.vendas || 0),
        itens: Number(dados.itens || 0),
        valor_periodo: Number(dados.valor_periodo || 0)
      });
    });
  });

  const vendasRows = await new Promise((resolve, reject) => {
    db.all(vendasSql, [tipoRelatorio, inicio, fim, ...empresaFiltro.params], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

  return {
    success: true,
    tipo: tipoRelatorio,
    periodo: {
      dataInicio: inicio,
      dataFim: fim
    },
    resumo,
    vendas: vendasRows.map((venda) => ({
      id: venda.id,
      codigo: venda.codigo,
      data_venda: venda.data_venda,
      total: Number(venda.total || 0),
      valor_fiscal: Number(venda.valor_fiscal || 0),
      valor_nao_fiscal: Number(venda.valor_nao_fiscal || 0),
      valor_relatorio: Number(venda.valor_relatorio || 0),
      forma_pagamento: venda.forma_pagamento,
      cliente_nome: venda.cliente_nome,
      operador_nome: venda.operador_nome,
      quantidade_itens: Number(venda.quantidade_itens || 0),
      status: venda.status,
      documento: venda.codigo || venda.id,
      classificacao_venda: venda.classificacao_venda
    }))
  };
}

module.exports = {
  normalizarTipo,
  gerarRelatorioFiscal
};
