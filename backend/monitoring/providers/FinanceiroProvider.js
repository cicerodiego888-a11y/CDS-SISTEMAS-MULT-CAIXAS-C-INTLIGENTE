/**
 * FinanceiroProvider — receber/pagar fiscal e não fiscal (somente leitura).
 */

const db = require('../../database');
const {
  sqlExcluirContaVendaCancelada,
  sqlExcluirFinanceiroVendaCancelada
} = require('../../services/vendas/VendaFinanceiroService');
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

function zeroPeriodo() {
  return { valor: 0, quantidade: 0 };
}

async function agregarReceberAberto(modo) {
  // modo: 'fiscal' | 'nao_fiscal'
  // Hotfix: consome v.valor_fiscal / v.valor_nao_fiscal do Motor (sem rateio).
  // Contas da mesma venda contam o Motor uma única vez (MAX por venda).
  const colMotor = modo === 'fiscal' ? 'v.valor_fiscal' : 'v.valor_nao_fiscal';
  const exprSemVenda = modo === 'fiscal'
    ? 'COALESCE(cr.valor_restante, 0)'
    : '0';

  const row = await dbGet(
    `SELECT
       COALESCE(SUM(parcela_motor), 0) AS valor,
       COUNT(CASE WHEN parcela_motor > 0.009 THEN 1 END) AS quantidade
     FROM (
       SELECT
         CASE
           WHEN v.id IS NULL THEN ${exprSemVenda}
           ELSE COALESCE(MAX(${colMotor}), 0)
         END AS parcela_motor
       FROM contas_receber cr
       LEFT JOIN vendas v ON v.id = cr.venda_id
       WHERE cr.status IN ('aberto', 'parcial')
         AND ${sqlExcluirContaVendaCancelada('cr')}
       GROUP BY COALESCE(cr.venda_id, -cr.id)
     )`
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function agregarReceberPeriodo(modo, inicio, fim) {
  const colMotor = modo === 'fiscal' ? 'v.valor_fiscal' : 'v.valor_nao_fiscal';
  const exprSemVenda = modo === 'fiscal'
    ? 'COALESCE(cr.valor_parcela, cr.valor_restante, 0)'
    : '0';

  const row = await dbGet(
    `SELECT
       COALESCE(SUM(parcela_motor), 0) AS valor,
       COUNT(CASE WHEN parcela_motor > 0.009 THEN 1 END) AS quantidade
     FROM (
       SELECT
         CASE
           WHEN v.id IS NULL THEN ${exprSemVenda}
           ELSE COALESCE(MAX(${colMotor}), 0)
         END AS parcela_motor
       FROM contas_receber cr
       LEFT JOIN vendas v ON v.id = cr.venda_id
       WHERE date(COALESCE(cr.created_at, cr.data_vencimento)) BETWEEN date(?) AND date(?)
         AND ${sqlExcluirContaVendaCancelada('cr')}
       GROUP BY COALESCE(cr.venda_id, -cr.id)
     )`,
    [inicio, fim]
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function ultimoReceber(modo) {
  const filtro = modo === 'fiscal'
    ? `(v.id IS NULL OR COALESCE(v.valor_fiscal, 0) > 0)`
    : `COALESCE(v.valor_nao_fiscal, 0) > 0`;
  const row = await dbGet(
    `SELECT cr.id, cr.valor_restante, cr.data_vencimento, cr.created_at, c.nome AS cliente
     FROM contas_receber cr
     LEFT JOIN vendas v ON v.id = cr.venda_id
     LEFT JOIN clientes c ON c.id = cr.cliente_id
     WHERE cr.status IN ('aberto', 'parcial')
       AND ${sqlExcluirContaVendaCancelada('cr')}
       AND ${filtro}
     ORDER BY datetime(COALESCE(cr.created_at, cr.data_vencimento)) DESC, cr.id DESC
     LIMIT 1`
  );
  if (!row || !row.id) return null;
  return {
    descricao: row.cliente || `Conta #${row.id}`,
    valor: num(row.valor_restante),
    data: row.created_at || row.data_vencimento || null
  };
}

async function agregarPagarAberto(modo) {
  // Despesas: fiscal se compra com chave OU sem compra; nao_fiscal se compra sem chave
  const filtro = modo === 'fiscal'
    ? `(f.compra_id IS NULL OR (c.chave_acesso IS NOT NULL AND TRIM(c.chave_acesso) != ''))`
    : `(f.compra_id IS NOT NULL AND (c.chave_acesso IS NULL OR TRIM(c.chave_acesso) = ''))`;

  const row = await dbGet(
    `SELECT
       COALESCE(SUM(f.valor), 0) AS valor,
       COUNT(*) AS quantidade
     FROM financeiro f
     LEFT JOIN compras c ON c.id = f.compra_id
     WHERE f.tipo = 'despesa'
       AND COALESCE(f.status, 'pendente') NOT IN ('pago', 'recebido', 'cancelado')
       AND ${sqlExcluirFinanceiroVendaCancelada('f')}
       AND ${filtro}`
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function agregarPagarPeriodo(modo, inicio, fim) {
  const filtro = modo === 'fiscal'
    ? `(f.compra_id IS NULL OR (c.chave_acesso IS NOT NULL AND TRIM(c.chave_acesso) != ''))`
    : `(f.compra_id IS NOT NULL AND (c.chave_acesso IS NULL OR TRIM(c.chave_acesso) = ''))`;

  const row = await dbGet(
    `SELECT
       COALESCE(SUM(f.valor), 0) AS valor,
       COUNT(*) AS quantidade
     FROM financeiro f
     LEFT JOIN compras c ON c.id = f.compra_id
     WHERE f.tipo = 'despesa'
       AND date(COALESCE(f.data_movimento, f.created_at)) BETWEEN date(?) AND date(?)
       AND ${sqlExcluirFinanceiroVendaCancelada('f')}
       AND ${filtro}`,
    [inicio, fim]
  );
  return { valor: num(row.valor), quantidade: num(row.quantidade) };
}

async function ultimoPagar(modo) {
  const filtro = modo === 'fiscal'
    ? `(f.compra_id IS NULL OR (c.chave_acesso IS NOT NULL AND TRIM(c.chave_acesso) != ''))`
    : `(f.compra_id IS NOT NULL AND (c.chave_acesso IS NULL OR TRIM(c.chave_acesso) = ''))`;
  const row = await dbGet(
    `SELECT f.id, f.descricao, f.valor, f.data_movimento, f.created_at
     FROM financeiro f
     LEFT JOIN compras c ON c.id = f.compra_id
     WHERE f.tipo = 'despesa'
       AND COALESCE(f.status, 'pendente') NOT IN ('pago', 'recebido', 'cancelado')
       AND ${sqlExcluirFinanceiroVendaCancelada('f')}
       AND ${filtro}
     ORDER BY datetime(COALESCE(f.created_at, f.data_movimento)) DESC, f.id DESC
     LIMIT 1`
  );
  if (!row || !row.id) return null;
  return {
    descricao: row.descricao || `Despesa #${row.id}`,
    valor: num(row.valor),
    data: row.data_movimento || row.created_at || null
  };
}

function montarCard(aberto, hoje, mes, ano, ultimo) {
  return {
    valor: aberto.valor,
    quantidade: aberto.quantidade,
    hoje,
    mes,
    ano,
    percentual: percentual(hoje.valor, mes.valor),
    ultimoLancamento: ultimo
  };
}

const FinanceiroProvider = {
  id: 'financeiro',

  async collect() {
    const inicio = Date.now();
    const warnings = [];
    const errors = [];
    try {
      const hojeStr = dataHojeBrasil();
      const mes = periodoMes(hojeStr);
      const ano = periodoAno(hojeStr);

      const [
        recFAberto, recFHoje, recFMes, recFAno, recFUlt,
        recNfAberto, recNfHoje, recNfMes, recNfAno, recNfUlt,
        pagFAberto, pagFHoje, pagFMes, pagFAno, pagFUlt,
        pagNfAberto, pagNfHoje, pagNfMes, pagNfAno, pagNfUlt
      ] = await Promise.all([
        agregarReceberAberto('fiscal'),
        agregarReceberPeriodo('fiscal', hojeStr, hojeStr),
        agregarReceberPeriodo('fiscal', mes.inicio, mes.fim),
        agregarReceberPeriodo('fiscal', ano.inicio, ano.fim),
        ultimoReceber('fiscal'),
        agregarReceberAberto('nao_fiscal'),
        agregarReceberPeriodo('nao_fiscal', hojeStr, hojeStr),
        agregarReceberPeriodo('nao_fiscal', mes.inicio, mes.fim),
        agregarReceberPeriodo('nao_fiscal', ano.inicio, ano.fim),
        ultimoReceber('nao_fiscal'),
        agregarPagarAberto('fiscal'),
        agregarPagarPeriodo('fiscal', hojeStr, hojeStr),
        agregarPagarPeriodo('fiscal', mes.inicio, mes.fim),
        agregarPagarPeriodo('fiscal', ano.inicio, ano.fim),
        ultimoPagar('fiscal'),
        agregarPagarAberto('nao_fiscal'),
        agregarPagarPeriodo('nao_fiscal', hojeStr, hojeStr),
        agregarPagarPeriodo('nao_fiscal', mes.inicio, mes.fim),
        agregarPagarPeriodo('nao_fiscal', ano.inicio, ano.fim),
        ultimoPagar('nao_fiscal')
      ]);

      return criarMonitoringResult({
        success: true,
        source: 'FinanceiroProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: {
          financeiro: {
            receberFiscal: montarCard(recFAberto, recFHoje, recFMes, recFAno, recFUlt),
            pagarFiscal: montarCard(pagFAberto, pagFHoje, pagFMes, pagFAno, pagFUlt),
            receberNaoFiscal: montarCard(recNfAberto, recNfHoje, recNfMes, recNfAno, recNfUlt),
            pagarNaoFiscal: montarCard(pagNfAberto, pagNfHoje, pagNfMes, pagNfAno, pagNfUlt)
          }
        },
        warnings,
        errors
      });
    } catch (err) {
      errors.push(err.message || String(err));
      const vazio = montarCard(zeroPeriodo(), zeroPeriodo(), zeroPeriodo(), zeroPeriodo(), null);
      return criarMonitoringResult({
        success: false,
        source: 'FinanceiroProvider',
        metrics: { tempoConsultaMs: Date.now() - inicio },
        data: {
          financeiro: {
            receberFiscal: vazio,
            pagarFiscal: vazio,
            receberNaoFiscal: vazio,
            pagarNaoFiscal: vazio
          }
        },
        warnings,
        errors
      });
    }
  }
};

module.exports = FinanceiroProvider;
