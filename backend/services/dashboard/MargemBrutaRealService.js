/**
 * Margem Bruta Real — leitura agregada.
 * Custo histórico em vendas_itens.custo_unitario (nunca produtos.preco_compra).
 */
'use strict';

const { FILTRO_VENDA_VALIDA } = require('../reportFiscalHelpers');

function moeda2(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

function pct2(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

function agoraIsoLocal() {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function dataHojeBrasil() {
  return agoraIsoLocal().slice(0, 10);
}

function dataDiasAtrasBrasil(dias) {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );
  dataBrasil.setDate(dataBrasil.getDate() - Number(dias || 0));
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function resolverPeriodoOperacional(query = {}) {
  const hoje = dataHojeBrasil();
  const inicio = String(query.inicio || '').trim() || dataDiasAtrasBrasil(7);
  const fim = String(query.fim || '').trim() || hoje;
  return { inicio, fim, data_hoje: hoje };
}

function montarResumoZerado(periodo) {
  return {
    faturamento_bruto: 0,
    custo_mercadoria: 0,
    lucro_bruto: 0,
    margem_bruta: 0,
    atualizado_em: agoraIsoLocal(),
    periodo: {
      inicio: periodo.inicio,
      fim: periodo.fim
    }
  };
}

function montarResumo(row, periodo) {
  const faturamento = moeda2(row && row.faturamento_bruto);
  const cmv = moeda2(row && row.custo_mercadoria);
  const lucro = moeda2(faturamento - cmv);
  const margem = faturamento > 0 ? pct2((lucro / faturamento) * 100) : 0;
  return {
    faturamento_bruto: faturamento,
    custo_mercadoria: cmv,
    lucro_bruto: lucro,
    margem_bruta: margem,
    atualizado_em: agoraIsoLocal(),
    periodo: {
      inicio: periodo.inicio,
      fim: periodo.fim
    }
  };
}

function sqlFiltroEmpresa(empresaId) {
  if (empresaId == null || empresaId === '') {
    return { sql: '', params: [] };
  }
  return {
    sql: ' AND v.empresa_id = ?',
    params: [empresaId]
  };
}

/**
 * Quantidade líquida da venda (núcleo comercial) menos devoluções.
 * Não usa custo atual do cadastro.
 */
function sqlAgregacaoMargemBruta() {
  return `
    SELECT
      COALESCE(SUM(liq.quantidade_liquida * liq.preco_unitario), 0) AS faturamento_bruto,
      COALESCE(SUM(liq.quantidade_liquida * liq.custo_historico), 0) AS custo_mercadoria
    FROM (
      SELECT
        vi.preco_unitario,
        COALESCE(vi.custo_unitario, 0) AS custo_historico,
        MAX(
          0,
          COALESCE(
            NULLIF(
              COALESCE(vi.quantidade_fiscal, 0) + COALESCE(vi.quantidade_nao_fiscal, 0),
              0
            ),
            vi.quantidade
          ) - COALESCE(dev.quantidade_devolvida, 0)
        ) AS quantidade_liquida
      FROM vendas_itens vi
      INNER JOIN vendas v ON v.id = vi.venda_id
      LEFT JOIN (
        SELECT venda_item_id, COALESCE(SUM(quantidade), 0) AS quantidade_devolvida
        FROM vendas_devolucoes
        GROUP BY venda_item_id
      ) dev ON dev.venda_item_id = vi.id
      WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
        AND ${FILTRO_VENDA_VALIDA}
        AND COALESCE(v.cancelada, 0) = 0
        __EMPRESA__
    ) liq
  `;
}

function calcularResumoMargemBruta(db, opcoes, callback) {
  const periodo = resolverPeriodoOperacional(opcoes || {});
  const empresa = sqlFiltroEmpresa(opcoes && opcoes.empresa_id);
  const sql = sqlAgregacaoMargemBruta().replace('__EMPRESA__', empresa.sql);
  const params = [periodo.inicio, periodo.fim, ...empresa.params];

  db.get(sql, params, (err, row) => {
    if (err) return callback(err);
    if (!row) return callback(null, montarResumoZerado(periodo));
    callback(null, montarResumo(row, periodo));
  });
}

function calcularResumoMargemBrutaAsync(db, opcoes) {
  return new Promise((resolve, reject) => {
    calcularResumoMargemBruta(db, opcoes, (err, resumo) => {
      if (err) return reject(err);
      resolve(resumo);
    });
  });
}

module.exports = {
  moeda2,
  pct2,
  resolverPeriodoOperacional,
  montarResumoZerado,
  montarResumo,
  calcularResumoMargemBruta,
  calcularResumoMargemBrutaAsync,
  agoraIsoLocal,
  dataHojeBrasil,
  dataDiasAtrasBrasil
};
