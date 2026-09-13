/**
 * RecebimentosProvider — PIX / Dinheiro / Cartão fiscal e não fiscal.
 */

const db = require('../../database');
const { FILTRO_VENDA_VALIDA } = require('../../services/reportFiscalHelpers');
const { criarMonitoringResult } = require('../MonitoringResult');
const {
  dataHojeBrasil,
  periodoMes,
  periodoAno,
  num,
  percentual,
  dbGetFactory
} = require('../monitoringDateHelpers');

const dbGet = dbGetFactory(db);

const FORMA_MAP = {
  pix: `LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%pix%'`,
  dinheiro: `LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%dinheiro%' OR LOWER(COALESCE(vr.forma_pagamento, '')) IN ('cash', 'especie', 'espécie')`,
  cartao: `LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%cart%o%'
    OR LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%credito%'
    OR LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%crédito%'
    OR LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%debito%'
    OR LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%débito%'
    OR LOWER(COALESCE(vr.forma_pagamento, '')) LIKE '%tef%'`
};

async function agregar(forma, tipoRecebimento, inicio, fim) {
  const formaSql = FORMA_MAP[forma];
  const row = await dbGet(
    `SELECT
       COALESCE(SUM(vr.valor), 0) AS valor,
       COUNT(*) AS quantidade
     FROM venda_recebimentos vr
     INNER JOIN vendas v ON v.id = vr.venda_id
     WHERE date(v.data_venda) BETWEEN date(?) AND date(?)
       AND ${FILTRO_VENDA_VALIDA}
       AND COALESCE(vr.status, 'aprovado') != 'cancelado'
       AND LOWER(COALESCE(vr.tipo_recebimento, 'fiscal')) = ?
       AND (${formaSql})`,
    [inicio, fim, tipoRecebimento]
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function ultimo(forma, tipoRecebimento) {
  const formaSql = FORMA_MAP[forma];
  const row = await dbGet(
    `SELECT vr.valor, vr.forma_pagamento, vr.created_at, v.data_venda
     FROM venda_recebimentos vr
     INNER JOIN vendas v ON v.id = vr.venda_id
     WHERE ${FILTRO_VENDA_VALIDA}
       AND COALESCE(vr.status, 'aprovado') != 'cancelado'
       AND LOWER(COALESCE(vr.tipo_recebimento, 'fiscal')) = ?
       AND (${formaSql})
     ORDER BY datetime(COALESCE(vr.created_at, v.data_venda)) DESC, vr.id DESC
     LIMIT 1`,
    [tipoRecebimento]
  );
  if (!row || row.valor == null) return null;
  return {
    descricao: row.forma_pagamento || forma,
    valor: num(row.valor),
    data: row.created_at || row.data_venda || null
  };
}

function montar(hoje, mes, ano, ultimoLancamento) {
  return {
    valor: hoje.valor,
    quantidade: hoje.quantidade,
    hoje,
    mes,
    ano,
    percentual: percentual(hoje.valor, mes.valor),
    ultimoLancamento
  };
}

const RecebimentosProvider = {
  id: 'recebimentos',

  async collect() {
    const inicio = Date.now();
    const warnings = [];
    const errors = [];
    try {
      const hojeStr = dataHojeBrasil();
      const mes = periodoMes(hojeStr);
      const ano = periodoAno(hojeStr);
      const formas = ['pix', 'dinheiro', 'cartao'];
      const tipos = ['fiscal', 'nao_fiscal'];
      const tasks = [];

      for (const tipo of tipos) {
        for (const forma of formas) {
          tasks.push(agregar(forma, tipo, hojeStr, hojeStr));
          tasks.push(agregar(forma, tipo, mes.inicio, mes.fim));
          tasks.push(agregar(forma, tipo, ano.inicio, ano.fim));
          tasks.push(ultimo(forma, tipo));
        }
      }

      const results = await Promise.all(tasks);
      let i = 0;
      const out = {};
      for (const tipo of tipos) {
        for (const forma of formas) {
          const h = results[i++];
          const m = results[i++];
          const a = results[i++];
          const u = results[i++];
          const pretty = forma === 'pix' ? 'pix' : forma;
          const mapKey = tipo === 'fiscal'
            ? `${pretty}Fiscal`
            : `${pretty}NaoFiscal`;
          out[mapKey] = montar(h, m, a, u);
        }
      }

      return criarMonitoringResult({
        success: true,
        source: 'RecebimentosProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: { recebimentos: out },
        warnings,
        errors
      });
    } catch (err) {
      errors.push(err.message || String(err));
      const vazio = montar({ valor: 0, quantidade: 0 }, { valor: 0, quantidade: 0 }, { valor: 0, quantidade: 0 }, null);
      return criarMonitoringResult({
        success: false,
        source: 'RecebimentosProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: {
          recebimentos: {
            pixFiscal: vazio,
            dinheiroFiscal: vazio,
            cartaoFiscal: vazio,
            pixNaoFiscal: vazio,
            dinheiroNaoFiscal: vazio,
            cartaoNaoFiscal: vazio
          }
        },
        warnings,
        errors
      });
    }
  }
};

module.exports = RecebimentosProvider;
