/**
 * AUDITORIA — divergências de centavos entre PDV, venda persistida e fechamento de caixa.
 * Executar: node --test tests/auditoria/divergencia-centavos-pdv-fechamento.test.js
 *
 * Auditoria + regressão da Sprint 1 (precisão monetária PDV/backend); achados 6–8 seguem caracterizados:
 * - PDV: funções reais de frontend/pdv/js/pdv.js executadas em vm (sem DOM real).
 * - Backend: VendaPagamentoService.criarVenda real, SQLite temporário, emitir_fiscal=false.
 * - Fechamento: FechamentoCaixaResumoService.consolidarSessaoCaixa real.
 * - Referência independente: aritmética inteira (centavos × milésimos), meio-para-cima por item.
 * Nenhuma emissão/cancelamento fiscal real; nenhum banco real.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-aud-centavos-'));
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = path.join(tmpBase, 'db');
process.env.FISCAL_DIR = path.join(tmpBase, 'fiscal');
fs.mkdirSync(process.env.DB_DIR, { recursive: true });

const ROOT = path.join(__dirname, '../..');

const chamadasFiscais = [];
const cancelarNfcePath = require.resolve(path.join(ROOT, 'backend/services/fiscal/cancelarNfce.js'));
require.cache[cancelarNfcePath] = {
  id: cancelarNfcePath,
  filename: cancelarNfcePath,
  loaded: true,
  exports: async (vendaId) => {
    chamadasFiscais.push(Number(vendaId));
    throw new Error('Evento fiscal bloqueado no teste de auditoria.');
  }
};

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../backend/database');

const identidadeMod = require('../../backend/services/caixa/ValidacaoIdentidadeVenda');
const identidadeChamadas = [];
const validarIdentidadeOriginal = identidadeMod.validarIdentidadeFinanceiraVenda;
identidadeMod.validarIdentidadeFinanceiraVenda = (args) => {
  const r = validarIdentidadeOriginal(args);
  identidadeChamadas.push({
    total: args.total, valor_fiscal_motor: args.valorFiscal, valor_nao_fiscal_motor: args.valorNaoFiscal,
    soma_motor: Number((Number(args.valorFiscal || 0) + Number(args.valorNaoFiscal || 0)).toFixed(2)),
    desconto: args.desconto, ok: r.ok, erro: r.erro || null
  });
  return r;
};

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve(this); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Referência monetária independente (BigInt, sem ponto flutuante)
// ---------------------------------------------------------------------------
function arredMeioCima(num, den) {
  const n = BigInt(num);
  const d = BigInt(den);
  return Number((2n * n + d) / (2n * d));
}

/** Valor da linha em centavos: preço (centavos) × quantidade (milésimos), desconto opcional. */
function refLinha({ precoCentavos, qtdMilesimos, descPctCentesimos = 0, descValorCentavos = 0 }) {
  const bruto = BigInt(precoCentavos) * BigInt(qtdMilesimos);
  let num = bruto * BigInt(10000 - descPctCentesimos);
  const den = 1000n * 10000n;
  num -= BigInt(descValorCentavos) * den;
  return arredMeioCima(num, den);
}

const reais = (centavos) => Number((centavos / 100).toFixed(2));

// ---------------------------------------------------------------------------
// PDV real em vm
// ---------------------------------------------------------------------------
const PDV_SRC = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function casarChaves(src, abre) {
  let depth = 0;
  let modo = null;
  for (let i = abre; i < src.length; i += 1) {
    const c = src[i];
    if (modo) {
      if (modo === '//') { if (c === '\n') modo = null; continue; }
      if (modo === '/*') { if (c === '/' && src[i - 1] === '*') modo = null; continue; }
      if (c === '\\') { i += 1; continue; }
      if (c === modo) modo = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { modo = '//'; i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { modo = '/*'; i += 1; continue; }
    if (c === "'" || c === '"' || c === '`') { modo = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('Chaves não balanceadas');
}

function extrairFuncao(nome) {
  const re = new RegExp(`\\n(async\\s+)?function\\s+${nome}\\s*\\(`);
  const m = re.exec(PDV_SRC);
  if (!m) throw new Error(`Função ${nome} não encontrada em pdv.js`);
  let i = m.index + m[0].length - 1;
  let depth = 0;
  for (; i < PDV_SRC.length; i += 1) {
    if (PDV_SRC[i] === '(') depth += 1;
    else if (PDV_SRC[i] === ')') { depth -= 1; if (depth === 0) break; }
  }
  const abre = PDV_SRC.indexOf('{', i);
  return PDV_SRC.slice(m.index + 1, casarChaves(PDV_SRC, abre) + 1);
}

function extrairTrecho(inicio, fim, { incluirFim = true, aPartirDe = 0 } = {}) {
  const a = PDV_SRC.indexOf(inicio, aPartirDe);
  if (a < 0) throw new Error(`Marcador inicial não encontrado: ${inicio}`);
  const b = PDV_SRC.indexOf(fim, a);
  if (b < 0) throw new Error(`Marcador final não encontrado: ${fim}`);
  return PDV_SRC.slice(a, incluirFim ? b + fim.length : b);
}

const FUNCOES_PDV = [
  'motorPrecoAtacadoDisponivel', 'obterPrecoBaseItemPdv', 'aplicarCalculoMotorItemPdv',
  'obterDescontoValorItemPdv', 'parseValorMonetarioPdv', 'obterValorRecebidoDinheiroPdv',
  'registrarValorRecebidoDinheiroPdv', 'normalizarTipoVendaItem', 'tipoVendaEhUnidade',
  'itemVendaPorUnidade', 'obterQuantidadeEstoqueParaVenda', 'unidadeEhKg',
  'produtoUsaConversaoUnidadesPdv', 'quantidadeUsaDecimaisPdv', 'parseQuantidadePdv',
  'normalizarQuantidadePdv', 'normalizarQuantidadeEtiquetaPdv', 'obterPrecoAtacado',
  'atualizarQuantidade', 'atualizarPercentual', 'atualizarDescontoValor', 'atualizarPrecoUnitario',
  'calcularSubtotal', 'calcularTotalValor', 'obterTotalVendaPDV',
  'decidirFluxoRecebimentosAB', 'deveEnviarPagamentosProcessadosPdv',
  'centavosPdv', 'valorLinhaCarrinhoPdv', 'precoInternoCoerenteLinhaPdv'
];

function montarCodigoPdv() {
  const constantes = [];
  const reConst = /\nconst (TIPO_VENDA_\w+) = ([^;\n]+);/g;
  let m;
  while ((m = reConst.exec(PDV_SRC)) !== null) constantes.push(`var ${m[1]} = ${m[2]};`);
  if (constantes.length < 2) throw new Error('Constantes TIPO_VENDA_* não encontradas');

  const trechoNovaLinha = extrairTrecho(
    '// avaliar atacado para quantidade inicial',
    'carrinho.push(novoItem);'
  );
  const idxTotal = PDV_SRC.indexOf('const total = Math.round((Math.max(0, subtotal - desconto + acrescimo)) * 100) / 100;');
  const idxInicioPayload = PDV_SRC.lastIndexOf("const desconto = parseFloat($('#descontoPdv').val()) || 0;", idxTotal);
  const trechoPayload = extrairTrecho(
    "const desconto = parseFloat($('#descontoPdv').val()) || 0;",
    "if (formaPagamento === 'prazo') {",
    { incluirFim: false, aPartirDe: idxInicioPayload }
  );
  const trechoCentavosMisto = extrairTrecho('function centavosMisto(v) {', '\n    }');
  const trechoSomaMisto = extrairTrecho(
    'let centavosInformados = 0;',
    'const somaCorreta = centavosInformados === centavosMisto(totalVenda);'
  );
  const condicaoBloqueioAB = extrairTrecho(
    'totalFiscal < 0 || totalNaoFiscal < 0',
    '!== centavosPdv(total)'
  );

  return [
    ...constantes,
    ...FUNCOES_PDV.map(extrairFuncao),
    `function __criarLinhaPdv(produto, quantidade, precoFinal, tipoVenda, etiquetaBalanca, subtotalEtiquetaFixo,
       descontoAtacadoItem, promocao, decisaoComposicao, quantidadeTransferirLinha) {
       ${trechoNovaLinha}
       return carrinho[carrinho.length - 1];
     }`,
    `function __montarPayloadPdv(formaPagamento, pagamentosMistos, clienteId, clienteSelecionado, vendaPrazoInfo) {
       ${trechoPayload}
       return dados;
     }`,
    `function __somaMistoAceita(totalVenda, valores) {
       const lista = Array.isArray(valores) ? valores : [valores];
       const $ = (alvo) => (alvo && alvo.__valor !== undefined
         ? { val: () => alvo.__valor }
         : { each(fn) { lista.forEach((v) => fn.call({ __valor: String(v) })); } });
       ${trechoCentavosMisto}
       ${trechoSomaMisto}
       return somaCorreta;
     }`,
    `function __distribuicaoBloqueadaPdv(totalFiscal, totalNaoFiscal, total) {
       return (${condicaoBloqueioAB});
     }`
  ].join('\n\n');
}

function criarPdv() {
  const campos = {};
  const faixasAtacado = {};
  const estado = { flagEditarPreco: false, putsCadastro: [], notificacoes: [] };
  const $ = (sel) => ({
    length: Object.prototype.hasOwnProperty.call(campos, sel) ? 1 : 0,
    val(v) {
      if (v === undefined) return campos[sel] ?? '';
      campos[sel] = v;
      return this;
    },
    text() { return this; },
    trigger() { return this; }
  });
  $.ajax = (opts) => {
    const m = /\/produtos\/(\d+)\/atacado$/.exec(String(opts.url || ''));
    if (m && typeof opts.success === 'function') opts.success(faixasAtacado[m[1]] || []);
    return { done() { return this; }, fail() { return this; } };
  };

  const ctx = {
    console, Intl, Math, Number, String, JSON, Array, Object, Date, Error,
    parseFloat, parseInt, isFinite,
    $, carrinho: [], produtosDisponiveis: [], API_URL: 'http://stub.invalid/api',
    localStorage: { getItem: () => '' },
    valorRecebidoDinheiroPDV: null,
    supervisorAuthToken: null,
    showNotification: (msg, tipo) => estado.notificacoes.push({ msg, tipo }),
    atualizarCarrinho() {}, animarTotalLinhaCarrinho() {}, focarCampoCodigo() {}, calcularTrocoPDV() {},
    abrirModalVendaSemEstoquePdv() {},
    removerItemCarrinho(i) { ctx.carrinho.splice(i, 1); },
    pdvValidarEstoqueVenda: () => ({ semSaldoTotal: false, confirmarSemEstoque: false }),
    pdvNotificarEstoqueInsuficiente: () => true,
    pdvPermitirEditarPrecoUnitario: () => estado.flagEditarPreco,
    sincronizarPrecoCadastroProdutoPdv: (item, produto, preco) => {
      estado.putsCadastro.push({ produto_id: Number(item.id), preco_venda: Number(Number(preco).toFixed(2)) });
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'frontend/shared/js/politicaMonetaria.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'frontend/shared/js/motor-preco-atacado.js'), 'utf8'), ctx);
  vm.runInContext(montarCodigoPdv(), ctx, { filename: 'pdv-extraido.js' });

  const fmtTela = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));

  return {
    ctx,
    estado,
    campos,
    faixasAtacado,
    reset(produtos) {
      ctx.carrinho.length = 0;
      ctx.produtosDisponiveis = produtos;
      ctx.valorRecebidoDinheiroPDV = null;
      for (const k of Object.keys(campos)) delete campos[k];
      estado.flagEditarPreco = false;
      estado.putsCadastro.length = 0;
      estado.notificacoes.length = 0;
    },
    /** Replica o pré-processamento de adicionarItemNoCarrinho e executa o trecho real de criação da linha. */
    adicionar(produto, quantidadeDigitada, opcoes = {}) {
      const tipoVenda = opcoes.tipoVenda || ctx.TIPO_VENDA_PESO;
      const etiqueta = opcoes.etiquetaValor != null ? { subtotalFixo: opcoes.etiquetaValor } : null;
      let quantidade = ctx.parseQuantidadePdv(quantidadeDigitada);
      let preco;
      if (ctx.tipoVendaEhUnidade(tipoVenda)) {
        quantidade = Math.max(0, Math.round(Number(quantidade || 0)));
        preco = Number(produto.preco_unidade ?? produto.preco_venda);
      } else if (etiqueta) {
        quantidade = ctx.normalizarQuantidadeEtiquetaPdv(quantidade);
        preco = Number(produto.preco_venda);
      } else {
        quantidade = ctx.normalizarQuantidadePdv(quantidade, produto);
        preco = Number(produto.preco_venda);
      }
      return ctx.__criarLinhaPdv(produto, quantidade, preco, tipoVenda, etiqueta,
        etiqueta ? Number(etiqueta.subtotalFixo) : null, 0, null,
        { acao: 'CRIAR', linha_id: `L${ctx.carrinho.length + 1}` }, 0);
    },
    totalTela() { return fmtTela(ctx.calcularTotalValor()); },
    linhaTela(i) {
      const it = ctx.carrinho[i];
      return fmtTela(it.subtotal_exibicao ?? ctx.MotorPrecoAtacado.arredondarMoeda(Number(it.subtotal || 0)));
    },
    payload(formaPagamento, pagamentosMistos = [], extra = {}) {
      return ctx.__montarPayloadPdv(formaPagamento, pagamentosMistos, extra.clienteId ?? null, null, null);
    }
  };
}

const parseTela = (txt) => Number(String(txt).replace(/[^\d,-]/g, '').replace(',', '.'));

// ---------------------------------------------------------------------------
// Backend real
// ---------------------------------------------------------------------------
let VendaPagamentoService;
let FechamentoSvc;
let VendaCancelamentoService;
let VendaDevolucaoService;

function chamarServico(fn) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      set() { return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; }
    };
    fn(res);
  });
}

async function abrirCaixa(rotulo) {
  const caixa = await run(
    `INSERT INTO caixa (data, valor_inicial, status, aberto_por, observacao)
     VALUES (date('now'), 100, 'aberto', 1, ?)`,
    [`auditoria centavos ${rotulo}`]
  );
  const sessao = await run(
    `INSERT INTO caixa_sessoes (caixa_turno_id, operador_id, valor_abertura, aberto_em, status)
     VALUES (?, 1, 100, datetime('now'), 'aberto')`,
    [caixa.lastID]
  );
  return { caixaId: caixa.lastID, sessaoId: sessao.lastID };
}

let ultimaVendaEm = 0;
async function enviarVenda(payload, caixa) {
  const desde = Date.now() - ultimaVendaEm;
  if (desde < 1100) await esperar(1100 - desde);
  ultimaVendaEm = Date.now();
  const body = JSON.parse(JSON.stringify(payload));
  const req = {
    body,
    caixaSessaoId: caixa.sessaoId,
    caixaId: caixa.caixaId,
    terminalId: null,
    operadorId: 1,
    user: { id: 1, perfil: 'ADMIN', username: 'auditoria' },
    __descontoAuthOk: true,
    ip: '127.0.0.1',
    headers: {}
  };
  const resp = await chamarServico((res) => VendaPagamentoService.criarVenda(req, res));
  await esperar(150);
  return resp;
}

async function lerPersistido(vendaId) {
  if (!vendaId) return null;
  const venda = await get(
    `SELECT id, total, typeof(total) AS tipo_total, desconto, valor_fiscal, valor_nao_fiscal,
            status_pagamento, forma_pagamento, valor_recebido, status, cancelada
       FROM vendas WHERE id = ?`,
    [vendaId]
  );
  const itens = await all('SELECT * FROM vendas_itens WHERE venda_id = ? ORDER BY id', [vendaId]);
  const pagamentos = await all('SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ? ORDER BY id', [vendaId]).catch(() => []);
  const recebimentos = await all('SELECT * FROM venda_recebimentos WHERE venda_id = ? ORDER BY id', [vendaId]).catch(() => []);
  const financeiro = await all('SELECT tipo, valor, status, categoria, origem FROM financeiro WHERE venda_id = ? ORDER BY id', [vendaId]).catch(() => []);
  const contas = await all('SELECT numero_parcela, valor, valor_restante, status FROM contas_receber WHERE venda_id = ? ORDER BY numero_parcela', [vendaId]).catch(() => []);
  return { venda, itens, pagamentos, recebimentos, financeiro, contas };
}

async function preCalcular(payload, caixa) {
  const req = {
    body: {
      itens: JSON.parse(JSON.stringify(payload.itens)),
      emitir_fiscal: true,
      pagamentos: JSON.parse(JSON.stringify(payload.pagamentos)),
      desconto: Number(payload.desconto || 0),
      acrescimo: Number(payload.acrescimo || 0)
    },
    caixaSessaoId: caixa.sessaoId,
    caixaId: caixa.caixaId,
    operadorId: 1,
    user: { id: 1, perfil: 'ADMIN' },
    headers: {}
  };
  return chamarServico((res) => VendaPagamentoService.preCalcularDistribuicao(req, res));
}

/**
 * Replica o ramo "confirmação fiscal manual" (sem TEF) de finalizarVenda no PDV:
 * pré-cálculo → decidirFluxoRecebimentosAB → pagamentos enviados.
 * emitir_fiscal=false + venda_fiscal=true: mesmo motor A/B, sem NFC-e.
 */
function montarPayloadFluxoFiscal(pdvCtx, payload, distrib) {
  const fluxo = pdvCtx.decidirFluxoRecebimentosAB(distrib.valor_fiscal, distrib.valor_nao_fiscal, {
    fluxoVendaFiscal: true,
    totalComercial: payload.total
  });
  const p = JSON.parse(JSON.stringify(payload));
  p.venda_fiscal = true;
  p.emitir_fiscal = false;
  p.valor_fiscal = distrib.valor_fiscal;
  p.valor_nao_fiscal = distrib.valor_nao_fiscal;
  p.fluxo_venda = 'fiscal';
  p.confirmacao_fiscal_manual = true;
  const original = payload.pagamentos.filter((x) => Number(x.valor) > 0).map((x) => ({ ...x, valor: Number(x.valor) }));
  if (fluxo.abrirA && !fluxo.abrirB && original.length === 1) {
    p.pagamentos = [{ forma_pagamento: original[0].forma_pagamento, valor: fluxo.valorA, tipo_recebimento: 'fiscal' }];
    if (pdvCtx.deveEnviarPagamentosProcessadosPdv(distrib.valor_fiscal, distrib.valor_nao_fiscal)) {
      p.pagamentos_processados_pdv = true;
    }
  } else {
    p.pagamentos = original;
  }
  return { payload: p, fluxo };
}

async function consolidar(caixa, dinheiroFisico) {
  return FechamentoSvc.consolidarSessaoCaixa(
    { id: caixa.caixaId, valor_inicial: 100, status: 'aberto', data: null },
    { sessaoId: caixa.sessaoId, db, valorInformado: Number((100 + dinheiroFisico).toFixed(2)) }
  );
}

// ---------------------------------------------------------------------------
// Fixtures (produtos sintéticos, ids altos)
// ---------------------------------------------------------------------------
const P = {
  UN: { id: 9101, codigo: 'AUD-UN', nome: 'AUDITORIA UNITARIO', unidade: 'UN', preco_venda: 7.99 },
  KG: { id: 9102, codigo: 'AUD-KG', nome: 'AUDITORIA KG', unidade: 'KG', preco_venda: 12.99 },
  KGA: { id: 9103, codigo: 'AUD-KGA', nome: 'AUDITORIA KG A', unidade: 'KG', preco_venda: 4.0 },
  KGB: { id: 9104, codigo: 'AUD-KGB', nome: 'AUDITORIA KG B', unidade: 'KG', preco_venda: 4.0 },
  KGC: { id: 9105, codigo: 'AUD-KGC', nome: 'AUDITORIA KG C', unidade: 'KG', preco_venda: 4.0 },
  ETQ: { id: 9106, codigo: 'AUD-ETQ', nome: 'AUDITORIA ETIQUETA', unidade: 'KG', preco_venda: 39.9 },
  ATC: { id: 9107, codigo: 'AUD-ATC', nome: 'AUDITORIA ATACADO', unidade: 'KG', preco_venda: 12.99, venda_atacado: 1 },
  UND: { id: 9108, codigo: 'AUD-UND', nome: 'AUDITORIA UNIDADE', unidade: 'KG', preco_venda: 10.48, preco_unidade: 3.49, peso_medio_unidade: 0.333 },
  AB1: { id: 9109, codigo: 'AUD-AB1', nome: 'AUDITORIA AB REAL', unidade: 'KG', preco_venda: 12.99, saldo_fiscal: 4.333, saldo_nao_fiscal: 50 },
  AB2: { id: 9110, codigo: 'AUD-AB2', nome: 'AUDITORIA AB BORDA', unidade: 'KG', preco_venda: 1.0, saldo_fiscal: 1.505, saldo_nao_fiscal: 50 },
  DEV: { id: 9111, codigo: 'AUD-DEV', nome: 'AUDITORIA DEVOLUCAO', unidade: 'UN', preco_venda: 9.99 },
  PRZ: { id: 9112, codigo: 'AUD-PRZ', nome: 'AUDITORIA PRAZO', unidade: 'UN', preco_venda: 100.0 },
  M10: { id: 9113, codigo: 'AUD-M10', nome: 'AUDITORIA MISTO', unidade: 'UN', preco_venda: 10.0 }
};

async function inserirProdutos() {
  for (const p of Object.values(P)) {
    const saldoFiscal = p.saldo_fiscal ?? 500;
    const saldoNaoFiscal = p.saldo_nao_fiscal ?? 0;
    await run(
      `INSERT INTO produtos (id, codigo, nome, nome_busca, unidade, preco_venda, preco_compra,
         estoque_atual, saldo_fiscal, saldo_nao_fiscal, item_fiscal, venda_atacado, controla_estoque)
       VALUES (?, ?, ?, ?, ?, ?, 0.01, ?, ?, ?, 1, ?, 1)`,
      [p.id, p.codigo, p.nome, p.nome.toLowerCase(), p.unidade, p.preco_venda,
        saldoFiscal + saldoNaoFiscal, saldoFiscal, saldoNaoFiscal, p.venda_atacado || 0]
    );
    if (p.preco_unidade != null) {
      await run('UPDATE produtos SET preco_unidade = ?, peso_medio_unidade = ? WHERE id = ?',
        [p.preco_unidade, p.peso_medio_unidade, p.id]).catch((e) => { p.erroUnidade = e.message; });
    }
  }
}

// ---------------------------------------------------------------------------
// Execução de cenários e trilha de auditoria
// ---------------------------------------------------------------------------
const trilhas = [];
const analises = {};

function resumoItensPdv(pdv) {
  return pdv.ctx.carrinho.map((it, i) => ({
    produto: Number(it.id),
    quantidade_carrinho: it.quantidade,
    preco_original: it.preco_base,
    preco_aplicado_interno: it.preco_unitario,
    desconto_pct: it.desconto_percentual,
    desconto_valor: it.desconto_valor,
    subtotal_interno: it.subtotal,
    subtotal_exibicao: it.subtotal_exibicao ?? null,
    linha_tela: pdv.linhaTela(i)
  }));
}

async function executarCenario(def) {
  const pdv = def.pdv;
  const caixa = def.caixa || await abrirCaixa(def.id);
  let payload = def.payload;
  let fluxoFiscal = null;
  if (def.fluxoFiscal) {
    const pre = await preCalcular(payload, caixa);
    const montado = montarPayloadFluxoFiscal(pdv.ctx, payload, pre.body);
    payload = montado.payload;
    fluxoFiscal = {
      pre_calculo: {
        valor_fiscal: pre.body.valor_fiscal, valor_nao_fiscal: pre.body.valor_nao_fiscal,
        midp_preservacao: pre.body.midp_preservacao, itens: pre.body.itens
      },
      fluxo_ab: montado.fluxo,
      bloqueio_pdv: pdv.ctx.__distribuicaoBloqueadaPdv(
        Number(pre.body.valor_fiscal || 0), Number(pre.body.valor_nao_fiscal || 0), payload.total
      ),
      cobrado_operador: Number(((montado.fluxo.abrirA ? montado.fluxo.valorA : 0)
        + (montado.fluxo.abrirB ? montado.fluxo.valorB : 0)).toFixed(2))
    };
  }
  identidadeChamadas.length = 0;
  const resp = await enviarVenda(payload, caixa);
  const identidade = identidadeChamadas.length ? identidadeChamadas[identidadeChamadas.length - 1] : null;
  const vendaId = resp.status === 200 ? Number(resp.body.id || resp.body.venda_id) : null;
  const persistido = await lerPersistido(vendaId);
  if (def.posVenda && vendaId) await def.posVenda(vendaId, persistido);
  const persistidoFinal = def.posVenda && vendaId ? await lerPersistido(vendaId) : persistido;
  let dinheiroFisico = vendaId ? def.dinheiroFisico : 0;
  if (fluxoFiscal && vendaId && def.dinheiroFisicoFluxo === 'cobrado') dinheiroFisico = fluxoFiscal.cobrado_operador;
  const fech = def.semFechamento ? null : await consolidar(caixa, dinheiroFisico);
  if (def.semFechamento) {
    return { id: def.id, vendaId, resp, payload, persistido, dinheiroFisico, fluxoFiscal };
  }

  const t = {
    id: def.id,
    titulo: def.titulo,
    entrada: def.entrada,
    itens_pdv: def.itensPdv,
    ref_por_item: reais(def.refCentavos),
    ref_total_unico: def.refTotalUnicoCentavos != null ? reais(def.refTotalUnicoCentavos) : null,
    total_tela: def.totalTela,
    total_enviado: payload.total,
    itens_enviados: payload.itens.map((i) => ({
      quantidade: i.quantidade, preco_unitario: i.preco_unitario,
      preco_unitario_interno: i.preco_unitario_interno, subtotal: i.subtotal
    })),
    pagamentos_enviados: payload.pagamentos,
    troco_enviado: payload.troco ?? null,
    backend_status: resp.status,
    backend_erro: resp.status === 200 ? null : resp.body.error,
    identidade_motor: identidade,
    fluxo_fiscal: fluxoFiscal,
    persistido: persistidoFinal ? {
      total: persistidoFinal.venda.total,
      desconto: persistidoFinal.venda.desconto,
      tipo_total: persistidoFinal.venda.tipo_total,
      valor_fiscal: persistidoFinal.venda.valor_fiscal,
      valor_nao_fiscal: persistidoFinal.venda.valor_nao_fiscal,
      status_pagamento: persistidoFinal.venda.status_pagamento,
      status: persistidoFinal.venda.status,
      itens: persistidoFinal.itens.map((i) => ({
        quantidade: i.quantidade, preco_unitario: i.preco_unitario, subtotal: i.subtotal,
        quantidade_fiscal: i.quantidade_fiscal, quantidade_nao_fiscal: i.quantidade_nao_fiscal,
        valor_fiscal: i.valor_fiscal, valor_nao_fiscal: i.valor_nao_fiscal
      })),
      soma_itens: Number(persistidoFinal.itens.reduce((a, i) => a + Number(i.subtotal || 0), 0).toFixed(6)),
      pagamentos: persistidoFinal.pagamentos,
      recebimentos: persistidoFinal.recebimentos.map((r) => ({
        forma: r.forma_pagamento, valor: r.valor, tipo: r.tipo_recebimento || r.tipo || null, status: r.status || null
      })),
      financeiro: persistidoFinal.financeiro,
      contas_receber: persistidoFinal.contas
    } : null,
    dinheiro_fisico: dinheiroFisico,
    fechamento: {
      vendido: fech.vendas.total_vendido,
      recebido: fech.vendas.total_recebido,
      pendente: fech.vendas.total_pendente,
      pagamentos: fech.pagamentos,
      dinheiro_esperado: fech.dinheiro.esperado,
      dinheiro_informado: fech.dinheiro.informado,
      diferenca_fisica: fech.dinheiro.diferenca,
      tela_exige_justificativa: fech.dinheiro.diferenca != null && Math.abs(fech.dinheiro.diferenca) >= 0.005,
      backend_conferencia_ok: fech.caixa_fisico ? fech.caixa_fisico.conferencia_ok ?? null : null,
      validacao_ok: fech.validacao.ok,
      inconsistencias: fech.validacao.inconsistencias,
      saldo_liquido: fech.validacao.saldo_liquido,
      reconciliacao: (fech.reconciliacao.vendas || []).map((r) => ({
        venda: r.venda_id, status: r.status_reconciliacao, divergencia: r.divergencia,
        fiscal_mais_nao_fiscal: r.fiscal_mais_nao_fiscal, recebido: r.recebido_total
      })),
      divergencias: fech.validacao.divergencias
    },
    extra: def.extra || null
  };

  const etapas = [];
  if (Math.abs(t.total_enviado - t.ref_por_item) > 0.0001) etapas.push('PDV (total enviado ≠ referência)');
  if (t.backend_status !== 200) etapas.push('BACKEND (venda rejeitada)');
  if (t.persistido) {
    if (Math.abs(Number(t.persistido.total) - t.total_enviado) > 0.0001) etapas.push('PERSISTÊNCIA (total ≠ enviado)');
    if (Math.abs(t.persistido.soma_itens - Number(t.persistido.desconto || 0) - Number(t.persistido.total)) > 0.0001) {
      etapas.push('PERSISTÊNCIA (Σ itens − desconto da venda ≠ total)');
    }
    const af = Number((Number(t.persistido.valor_fiscal || 0) + Number(t.persistido.valor_nao_fiscal || 0)).toFixed(2));
    if (Math.abs(af - Number(t.persistido.total)) > 0.0001) etapas.push('PERSISTÊNCIA (A+B ≠ total)');
    if (Math.abs(t.fechamento.recebido - Number(t.persistido.total)) > 0.0001) etapas.push('PAGAMENTOS (recebido ≠ total)');
  }
  if (fluxoFiscal && Math.abs(fluxoFiscal.cobrado_operador - t.total_enviado) > 0.0001) etapas.push('PAGAMENTOS (cobrado A+B ≠ total)');
  if (t.persistido) {
    const somaRec = Number(t.persistido.recebimentos.reduce((a, r) => a + Number(r.valor || 0), 0).toFixed(2));
    if (Math.abs(somaRec - Number(t.persistido.total)) > 0.0001 && t.persistido.status !== 'cancelada') etapas.push('PERSISTÊNCIA (Σ recebimentos ≠ total)');
    if (t.persistido.itens.some((i) => Number(i.valor_nao_fiscal || 0) !== 0 && Number(i.quantidade_nao_fiscal || 0) === 0)) {
      etapas.push('PERSISTÊNCIA (valor não fiscal sem quantidade não fiscal)');
    }
  }
  if (t.fechamento.diferenca_fisica != null && Math.abs(t.fechamento.diferenca_fisica) >= 0.005) etapas.push('FECHAMENTO (diferença física)');
  if (!t.fechamento.validacao_ok) etapas.push('FECHAMENTO (reconciliação bloqueia)');
  t.diferenca_vs_ref = Number((t.total_enviado - t.ref_por_item).toFixed(2));
  t.etapas_divergencia = etapas;
  trilhas.push(t);
  return t;
}

function prepararPdv(pdv, produtos, passos) {
  pdv.reset(produtos);
  passos(pdv);
  return {
    itensPdv: resumoItensPdv(pdv),
    totalTela: pdv.totalTela()
  };
}

// ---------------------------------------------------------------------------
describe('AUDITORIA — divergência de centavos PDV → venda → fechamento', () => {
  let pdv;

  before(async () => {
    await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
    for (let i = 0; i < 100; i += 1) {
      const flag = await get(`SELECT valor FROM configuracoes WHERE chave = 'migracao_recalc_saldos_estoque_v1'`);
      if (flag && flag.valor === '1') break;
      await esperar(100);
    }
    VendaPagamentoService = require('../../backend/services/vendas/VendaPagamentoService');
    FechamentoSvc = require('../../backend/services/caixa/FechamentoCaixaResumoService');
    VendaCancelamentoService = require('../../backend/services/vendas/VendaCancelamentoService');
    VendaDevolucaoService = require('../../backend/services/vendas/VendaDevolucaoService');
    await inserirProdutos();
    await run(`INSERT INTO clientes (id, nome) VALUES (9901, 'CLIENTE AUDITORIA')`).catch(() => {});
    pdv = criarPdv();
  });

  after(() => {
    const dir = path.join(os.tmpdir(), 'cds-aud-busca');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'centavos-trilha.json'), JSON.stringify(trilhas, null, 2), 'utf8');
      fs.writeFileSync(path.join(dir, 'centavos-analises.json'), JSON.stringify(analises, null, 2), 'utf8');
    } catch (_) { /* relatório opcional */ }
    for (const t of trilhas) {
      console.log(`TRILHA ${t.id} ref=${t.ref_por_item} tela=${t.total_tela} enviado=${t.total_enviado} `
        + `backend=${t.backend_status}${t.backend_erro ? ` (${t.backend_erro})` : ''} `
        + `persistido=${t.persistido ? t.persistido.total : '-'} recebido=${t.fechamento.recebido} `
        + `difFisica=${t.fechamento.diferenca_fisica} etapas=[${t.etapas_divergencia.join('; ')}]`);
    }
    console.log(`ANALISES ${JSON.stringify(analises)}`);
  });

  it('harness: funções reais do PDV extraídas e executáveis', () => {
    for (const nome of FUNCOES_PDV) assert.equal(typeof pdv.ctx[nome], 'function', nome);
    assert.equal(typeof pdv.ctx.__criarLinhaPdv, 'function');
    assert.equal(typeof pdv.ctx.__montarPayloadPdv, 'function');
    assert.equal(refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }), 13727);
  });

  it('C01 item unitário sem desconto', async () => {
    const prep = prepararPdv(pdv, [P.UN], (p) => p.adicionar(P.UN, '3'));
    const t = await executarCenario({
      id: 'C01', titulo: 'Unitário 3 × 7,99', pdv, ...prep,
      entrada: { quantidade: '3', preco: 7.99 },
      refCentavos: refLinha({ precoCentavos: 799, qtdMilesimos: 3000 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C02 10,567 kg × 12,99 digitado na adição', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => p.adicionar(P.KG, '10,567'));
    const t = await executarCenario({
      id: 'C02', titulo: '10,567 kg × 12,99 (adição direta)', pdv, ...prep,
      entrada: { quantidade: '10,567', preco: 12.99, valor_matematico: 12.99 * 10.567 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C03 fracionado com quantidade alterada após adicionar', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
    });
    const t = await executarCenario({
      id: 'C03', titulo: '1 kg → editado para 10,567 kg × 12,99', pdv, ...prep,
      entrada: { quantidade: '1 → 10,567', preco: 12.99 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C04 desconto percentual 7% em item fracionado', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.ctx.carrinho[0].desconto_manual = 1;
      p.ctx.atualizarPercentual(0, 7);
    });
    const t = await executarCenario({
      id: 'C04', titulo: '10,567 kg × 12,99 com 7%', pdv, ...prep,
      entrada: { quantidade: '10,567', preco: 12.99, desconto_pct: 7 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567, descPctCentesimos: 700 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C05 desconto em valor fixo R$ 1,37 no item', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.ctx.atualizarDescontoValor(0, 1.37);
    });
    const t = await executarCenario({
      id: 'C05', titulo: '10,567 kg × 12,99 − R$ 1,37 (item)', pdv, ...prep,
      entrada: { quantidade: '10,567', preco: 12.99, desconto_valor: 1.37 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567, descValorCentavos: 137 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C05b desconto em valor R$ 0,50 na venda (rodapé)', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.campos['#descontoPdv'] = '0.50';
    });
    const t = await executarCenario({
      id: 'C05b', titulo: '10,567 kg × 12,99 − R$ 0,50 (venda)', pdv, ...prep,
      entrada: { quantidade: '10,567', preco: 12.99, desconto_venda: 0.5 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }) - 50,
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C06 edição temporária do preço (flag de cadastro desligada)', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.estado.flagEditarPreco = false;
      p.ctx.atualizarPrecoUnitario(0, '11,49');
    });
    const t = await executarCenario({
      id: 'C06', titulo: '10,567 kg, preço editado 11,49 (temporário)', pdv, ...prep,
      entrada: { quantidade: '10,567', preco_original: 12.99, preco_editado: '11,49' },
      refCentavos: refLinha({ precoCentavos: 1149, qtdMilesimos: 10567 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela),
      extra: { puts_cadastro: [...pdv.estado.putsCadastro] }
    });
    assert.ok(t);
  });

  it('C07 edição de preço que atualiza o cadastro (flag ligada)', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.estado.flagEditarPreco = true;
      p.ctx.atualizarPrecoUnitario(0, '11,49');
    });
    const puts = [...pdv.estado.putsCadastro];
    const t = await executarCenario({
      id: 'C07', titulo: '10,567 kg, preço editado 11,49 (grava cadastro)', pdv, ...prep,
      entrada: { quantidade: '10,567', preco_original: 12.99, preco_editado: '11,49' },
      refCentavos: refLinha({ precoCentavos: 1149, qtdMilesimos: 10567 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela),
      extra: { puts_cadastro: puts }
    });
    assert.ok(t);
  });

  it('C08 vários itens com frações intermediárias (3 × 0,251 kg × 4,00)', async () => {
    const prods = [P.KGA, P.KGB, P.KGC];
    const prep = prepararPdv(pdv, prods, (p) => {
      prods.forEach((prod, i) => {
        p.adicionar(prod, '1');
        p.ctx.atualizarQuantidade(i, '0,251');
      });
    });
    const t = await executarCenario({
      id: 'C08', titulo: '3 linhas de 0,251 kg × 4,00', pdv, ...prep,
      entrada: { linhas: 3, quantidade: '0,251', preco: 4.0 },
      refCentavos: 3 * refLinha({ precoCentavos: 400, qtdMilesimos: 251 }),
      refTotalUnicoCentavos: arredMeioCima(3n * 400n * 251n, 1000n),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C08b etiqueta de balança por VALOR (R$ 7,77 a 39,90/kg)', async () => {
    const prep = prepararPdv(pdv, [P.ETQ], (p) => {
      const qtd = p.ctx.normalizarQuantidadeEtiquetaPdv(7.77 / 39.9);
      p.adicionar(P.ETQ, String(qtd), { etiquetaValor: 7.77 });
    });
    const t = await executarCenario({
      id: 'C08b', titulo: 'Etiqueta VALOR 7,77 / 39,90', pdv, ...prep,
      entrada: { etiqueta_valor: 7.77, preco: 39.9 },
      refCentavos: 777,
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C09 pagamento dividido dinheiro + PIX + cartão (exato)', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
    });
    const total = pdv.ctx.obterTotalVendaPDV();
    const mistos = [
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'pix', valor: 50 },
      { forma_pagamento: 'cartao_debito', valor: Number((total - 100).toFixed(2)) }
    ];
    const payload = pdv.payload('misto', mistos);
    payload.confirmacao_fiscal_manual = true;
    const t = await executarCenario({
      id: 'C09', titulo: 'Misto 50 + 50 + restante', pdv, ...prep,
      entrada: { pagamentos: mistos },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload,
      dinheiroFisico: 50,
      extra: { pdv_aceita_soma: pdv.ctx.__somaMistoAceita(total, mistos.reduce((a, m) => a + m.valor, 0)) }
    });
    assert.ok(t);
  });

  it('C09b pagamento dividido com 1 centavo a menos', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
    });
    const total = pdv.ctx.obterTotalVendaPDV();
    const mistos = [
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'pix', valor: 50 },
      { forma_pagamento: 'cartao_debito', valor: Number((total - 100 - 0.01).toFixed(2)) }
    ];
    const informado = mistos.reduce((a, m) => a + Number(m.valor), 0);
    const payload = pdv.payload('misto', mistos);
    payload.confirmacao_fiscal_manual = true;
    const somasTeste = {};
    for (const centavos of [1, 2, 3, 4]) {
      const inf = Number((total - centavos / 100).toFixed(2));
      somasTeste[`falta_${centavos}c`] = pdv.ctx.__somaMistoAceita(total, inf);
    }
    const t = await executarCenario({
      id: 'C09b', titulo: 'Misto com 0,01 a menos', pdv, ...prep,
      entrada: { pagamentos: mistos },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload,
      dinheiroFisico: 50,
      extra: { pdv_aceita_soma: pdv.ctx.__somaMistoAceita(total, informado), aceite_por_falta: somasTeste }
    });
    assert.ok(t);
  });

  for (const variante of [
    { id: 'C09c', titulo: 'Misto 5,00 + 4,99 em venda de 10,00 (falta 0,01)', mistos: [['dinheiro', 5], ['pix', 4.99]], fisico: 5 },
    { id: 'C09d', titulo: 'Misto 5,01 + 5,00 em venda de 10,00 (sobra 0,01)', mistos: [['dinheiro', 5.01], ['pix', 5]], fisico: 5.01 }
  ]) {
    it(`${variante.id} ${variante.titulo}`, async () => {
      const prep = prepararPdv(pdv, [P.M10], (p) => p.adicionar(P.M10, '1'));
      const mistos = variante.mistos.map(([forma_pagamento, valor]) => ({ forma_pagamento, valor }));
      const informado = mistos.reduce((a, m) => a + m.valor, 0);
      const payload = pdv.payload('misto', mistos);
      payload.confirmacao_fiscal_manual = true;
      const t = await executarCenario({
        id: variante.id, titulo: variante.titulo, pdv, ...prep,
        entrada: { pagamentos: mistos },
        refCentavos: 1000,
        payload,
        dinheiroFisico: variante.fisico,
        extra: { pdv_aceita_soma: pdv.ctx.__somaMistoAceita(pdv.ctx.obterTotalVendaPDV(), informado) }
      });
      assert.ok(t);
    });
  }

  it('C10 dinheiro com troco', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.campos['#valorRecebidoPDV'] = '150';
    });
    const payload = pdv.payload('dinheiro');
    const t = await executarCenario({
      id: 'C10', titulo: '137,27 pago com 150,00', pdv, ...prep,
      entrada: { recebido: 150 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload,
      dinheiroFisico: Number((150 - Number(payload.troco || 0)).toFixed(2))
    });
    assert.ok(t);
  });

  it('C11 fracionado + preço editado + desconto %', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
      p.ctx.atualizarPrecoUnitario(0, '12,49');
      p.ctx.carrinho[0].desconto_manual = 1;
      p.ctx.atualizarPercentual(0, 5);
    });
    const t = await executarCenario({
      id: 'C11', titulo: '10,567 kg, preço 12,49 editado, depois 5%', pdv, ...prep,
      entrada: { quantidade: '10,567', preco_original: 12.99, preco_editado: '12,49', desconto_pct: 5 },
      refCentavos: refLinha({ precoCentavos: 1249, qtdMilesimos: 10567, descPctCentesimos: 500 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C12 modalidade atacado (faixa ≥ 10 kg a 11,90)', async () => {
    pdv.faixasAtacado[String(P.ATC.id)] = [{ quantidade_minima: 10, preco_atacado: 11.9 }];
    const prep = prepararPdv(pdv, [P.ATC], (p) => p.adicionar(P.ATC, '10,567'));
    const t = await executarCenario({
      id: 'C12', titulo: 'Atacado 10,567 kg (faixa 11,90)', pdv, ...prep,
      entrada: { quantidade: '10,567', preco_varejo: 12.99, preco_atacado: 11.9 },
      refCentavos: refLinha({ precoCentavos: 1190, qtdMilesimos: 10567 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C12b modalidade venda por UNIDADE (3 un × 3,49, peso médio 0,333)', async () => {
    const prep = prepararPdv(pdv, [P.UND], (p) => p.adicionar(P.UND, '3', { tipoVenda: p.ctx.TIPO_VENDA_UNIDADE }));
    const t = await executarCenario({
      id: 'C12b', titulo: 'Venda por unidade 3 × 3,49', pdv, ...prep,
      entrada: { quantidade: 3, preco_unidade: 3.49, peso_medio: 0.333, erro_fixture: P.UND.erroUnidade || null },
      refCentavos: refLinha({ precoCentavos: 349, qtdMilesimos: 3000 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C13 itens A e B — split realista (4,333 kg fiscal de 10,567 kg)', async () => {
    const prep = prepararPdv(pdv, [P.AB1], (p) => {
      p.adicionar(P.AB1, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
    });
    const payload = pdv.payload('dinheiro');
    payload.venda_fiscal = true;
    const t = await executarCenario({
      id: 'C13', titulo: 'A/B 10,567 kg (fiscal 4,333)', pdv, ...prep,
      entrada: { quantidade: '10,567', saldo_fiscal: 4.333, venda_fiscal: true, emitir_fiscal: false },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload,
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C13b itens A e B — borda de meio centavo (3,010 kg × 1,00, fiscal 1,505)', async () => {
    const prep = prepararPdv(pdv, [P.AB2], (p) => {
      p.adicionar(P.AB2, '1');
      p.ctx.atualizarQuantidade(0, '3,01');
    });
    const payload = pdv.payload('dinheiro');
    payload.venda_fiscal = true;
    const t = await executarCenario({
      id: 'C13b', titulo: 'A/B 3,010 kg × 1,00 (fiscal 1,505)', pdv, ...prep,
      entrada: { quantidade: '3,01', saldo_fiscal: 1.505, venda_fiscal: true, emitir_fiscal: false },
      refCentavos: refLinha({ precoCentavos: 100, qtdMilesimos: 3010 }),
      payload,
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.ok(t);
  });

  it('C14 cancelamento estornado uma única vez', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '1');
      p.ctx.atualizarQuantidade(0, '10,567');
    });
    const cancelamentos = [];
    const t = await executarCenario({
      id: 'C14', titulo: 'Venda 137,27 cancelada (2 tentativas)', pdv, ...prep,
      entrada: { cancelar: 2 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: 0,
      extra: { cancelamentos },
      posVenda: async (vendaId) => {
        for (let i = 0; i < 2; i += 1) {
          const r = await chamarServico((res) => VendaCancelamentoService.cancelarVendaPost(
            vendaId, 'Auditoria de centavos cancelamento',
            { user: { id: 1, perfil: 'ADMIN' }, ip: '127.0.0.1', body: { motivo: 'Auditoria de centavos cancelamento' } }, res
          ));
          cancelamentos.push({ status: r.status, erro: r.body?.error || null });
          await esperar(200);
        }
      }
    });
    assert.ok(t);
  });

  it('C15 devolução parcial de item com desconto', async () => {
    const prep = prepararPdv(pdv, [P.DEV], (p) => {
      p.adicionar(P.DEV, '3');
      p.ctx.carrinho[0].desconto_manual = 1;
      p.ctx.atualizarPercentual(0, 7);
    });
    const devolucao = {};
    const t = await executarCenario({
      id: 'C15', titulo: '3 × 9,99 com 7%, devolve 1', pdv, ...prep,
      entrada: { quantidade: 3, preco: 9.99, desconto_pct: 7, devolver: 1 },
      refCentavos: refLinha({ precoCentavos: 999, qtdMilesimos: 3000, descPctCentesimos: 700 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela),
      extra: { devolucao },
      posVenda: async (vendaId, persistido) => {
        const item = persistido.itens[0];
        const r = await chamarServico((res) => VendaDevolucaoService.devolverParcial(
          vendaId, 'Auditoria devolução parcial', [{ venda_item_id: item.id, quantidade: 1 }],
          { user: { id: 1 }, operadorId: 1, ip: '127.0.0.1' }, res
        ));
        devolucao.status = r.status;
        devolucao.valor_devolvido = r.body?.valor_total_devolvido ?? null;
        devolucao.erro = r.body?.error || null;
        devolucao.ref_valor_liquido_1un = reais(refLinha({ precoCentavos: 999, qtdMilesimos: 1000, descPctCentesimos: 700 }));
      }
    });
    assert.ok(t);
  });

  it('C16 venda a prazo em 3 parcelas (contas a receber)', async () => {
    const prep = prepararPdv(pdv, [P.PRZ], (p) => p.adicionar(P.PRZ, '1'));
    const payload = pdv.payload('prazo', [], { clienteId: 9901 });
    payload.parcelas = 3;
    payload.primeiro_vencimento = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const t = await executarCenario({
      id: 'C16', titulo: 'Prazo 100,00 em 3x', pdv, ...prep,
      entrada: { total: 100, parcelas: 3 },
      refCentavos: 10000,
      payload,
      dinheiroFisico: 0
    });
    assert.ok(t);
  });

  // ------------------------------------------------------------------------
  // Fluxo fiscal do PDV (pré-cálculo → A/B → pagamentos), sem NFC-e
  // ------------------------------------------------------------------------
  const passosKgEditado = (p) => {
    p.adicionar(P.KG, '1');
    p.ctx.atualizarQuantidade(0, '10,567');
  };
  const cenariosFiscais = [
    {
      id: 'F01', titulo: 'Fiscal: 10,567 kg × 12,99 sem desconto', produtos: [P.KG], passos: passosKgEditado,
      ref: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 })
    },
    {
      id: 'F02', titulo: 'Fiscal: 10,567 kg × 12,99 com 7%', produtos: [P.KG],
      passos: (p) => { passosKgEditado(p); p.ctx.carrinho[0].desconto_manual = 1; p.ctx.atualizarPercentual(0, 7); },
      ref: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567, descPctCentesimos: 700 })
    },
    {
      id: 'F03', titulo: 'Fiscal: 10,567 kg × 12,99 − R$ 1,37', produtos: [P.KG],
      passos: (p) => { passosKgEditado(p); p.ctx.atualizarDescontoValor(0, 1.37); },
      ref: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567, descValorCentavos: 137 })
    },
    {
      id: 'F04', titulo: 'Fiscal: etiqueta VALOR 7,77 / 39,90', produtos: [P.ETQ],
      passos: (p) => p.adicionar(P.ETQ, String(p.ctx.normalizarQuantidadeEtiquetaPdv(7.77 / 39.9)), { etiquetaValor: 7.77 }),
      ref: 777
    },
    {
      id: 'F05', titulo: 'Fiscal: desconto de venda R$ 0,50', produtos: [P.KG],
      passos: (p) => { passosKgEditado(p); p.campos['#descontoPdv'] = '0.50'; },
      ref: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567 }) - 50
    },
    {
      id: 'F06', titulo: 'Fiscal: 7% pago em PIX', produtos: [P.KG], forma: 'pix',
      passos: (p) => { passosKgEditado(p); p.ctx.carrinho[0].desconto_manual = 1; p.ctx.atualizarPercentual(0, 7); },
      ref: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567, descPctCentesimos: 700 })
    },
    {
      id: 'F07', titulo: 'Fiscal: A/B 10,567 kg com 7% (fiscal 4,333)', produtos: [P.AB1],
      passos: (p) => {
        p.adicionar(P.AB1, '1');
        p.ctx.atualizarQuantidade(0, '10,567');
        p.ctx.carrinho[0].desconto_manual = 1;
        p.ctx.atualizarPercentual(0, 7);
      },
      ref: refLinha({ precoCentavos: 1299, qtdMilesimos: 10567, descPctCentesimos: 700 })
    }
  ];

  for (const c of cenariosFiscais) {
    it(`${c.id} ${c.titulo}`, async () => {
      const prep = prepararPdv(pdv, c.produtos, c.passos);
      const forma = c.forma || 'dinheiro';
      const t = await executarCenario({
        id: c.id, titulo: c.titulo, pdv, ...prep,
        entrada: { forma, fluxo: 'fiscal manual (sem TEF)' },
        refCentavos: c.ref,
        payload: pdv.payload(forma),
        fluxoFiscal: true,
        dinheiroFisico: 0,
        dinheiroFisicoFluxo: forma === 'dinheiro' ? 'cobrado' : null
      });
      assert.ok(t);
    });
  }

  /** Etiqueta de balança por VALOR a 39,90/kg; qtd = valor ÷ preço (3 casas), como no PDV. */
  function etiquetaPdv(valor) {
    const { calcularValoresFiscaisItem } = require('../../backend/services/distribuidorEstoqueVenda');
    const quantidade = pdv.ctx.normalizarQuantidadeEtiquetaPdv(valor / 39.9);
    return {
      valor,
      quantidade,
      // qtd × preço impresso, sem subtotal (cálculo usado antes da Sprint 1)
      valor_qtd_x_preco: calcularValoresFiscaisItem({ quantidade, preco_unitario: 39.9 }, quantidade, 0).valorFiscal
    };
  }

  it('F04b Fiscal: etiqueta VALOR 1,87 / 39,90 (qtd × preço impresso = 1,88)', async () => {
    const alvo = etiquetaPdv(1.87);
    assert.equal(alvo.valor_qtd_x_preco, 1.88);
    const prep = prepararPdv(pdv, [P.ETQ], (p) => p.adicionar(P.ETQ, String(alvo.quantidade), { etiquetaValor: alvo.valor }));
    const t = await executarCenario({
      id: 'F04b', titulo: `Fiscal: etiqueta VALOR ${alvo.valor.toFixed(2)} / 39,90`, pdv, ...prep,
      entrada: { forma: 'dinheiro', fluxo: 'fiscal manual (sem TEF)', etiqueta: alvo },
      refCentavos: Math.round(alvo.valor * 100),
      payload: pdv.payload('dinheiro'),
      fluxoFiscal: true,
      dinheiroFisico: 0,
      dinheiroFisicoFluxo: 'cobrado'
    });
    assert.ok(t);
  });

  it('G5 etiquetas VALOR: valor fiscal do motor × valor impresso', () => {
    const { calcularValoresFiscaisItem } = require('../../backend/services/distribuidorEstoqueVenda');
    const res = {};
    for (const preco of [39.9, 12.99, 59.9, 8.49]) {
      const prod = { ...P.ETQ, preco_venda: preco };
      let casos = 0;
      let acima = 0;
      let abaixo = 0;
      let qtdXPrecoDivergente = 0;
      let invariantesViolados = 0;
      for (let c = 100; c <= 10000; c += 1) {
        const v = c / 100;
        const q = pdv.ctx.normalizarQuantidadeEtiquetaPdv(v / preco);
        pdv.reset([prod]);
        pdv.adicionar(prod, String(q), { etiquetaValor: v });
        const item = pdv.payload('dinheiro').itens[0];
        const motor = calcularValoresFiscaisItem(item, item.quantidade, 0);
        casos += 1;
        const d = Number((motor.valorFiscal - v).toFixed(2));
        if (d > 0) acima += 1;
        else if (d < 0) abaixo += 1;
        if (item.subtotal !== v || motor.valorNaoFiscal !== 0) invariantesViolados += 1;
        const legado = calcularValoresFiscaisItem({ quantidade: q, preco_unitario: preco }, q, 0).valorFiscal;
        if (legado !== v) qtdXPrecoDivergente += 1;
      }
      res[String(preco)] = {
        casos,
        motor_acima: acima,
        motor_abaixo: abaixo,
        pct_divergente: Number((100 * (acima + abaixo) / casos).toFixed(2)),
        invariantes_violados: invariantesViolados,
        pct_qtd_x_preco_impresso_divergente: Number((100 * qtdXPrecoDivergente / casos).toFixed(2))
      };
    }
    analises.G5 = res;
    assert.ok(true);
  });

  it('S01 sessão com várias vendas de centavo divergente (fechamento acumulado)', async () => {
    const caixa = await abrirCaixa('S01');
    const vendas = [];
    const etq = etiquetaPdv(1.87);
    const passosEtq = (p) => p.adicionar(P.ETQ, String(etq.quantidade), { etiquetaValor: etq.valor });
    const roteiro = [
      { titulo: `etiqueta ${etq.valor}`, produtos: [P.ETQ], passos: passosEtq },
      { titulo: `etiqueta ${etq.valor}`, produtos: [P.ETQ], passos: passosEtq },
      { titulo: 'etiqueta 7,77', produtos: [P.ETQ], passos: cenariosFiscais[3].passos },
      { titulo: '7% em 10,567 kg', produtos: [P.KG], passos: cenariosFiscais[1].passos },
      { titulo: '− R$ 1,37 em 10,567 kg', produtos: [P.KG], passos: cenariosFiscais[2].passos },
      { titulo: '10,567 kg adição direta', produtos: [P.KG], passos: (p) => p.adicionar(P.KG, '10,567') },
      { titulo: 'misto 5,00 + 4,99 (10,00)', produtos: [P.M10], passos: (p) => p.adicionar(P.M10, '1'),
        mistos: [{ forma_pagamento: 'dinheiro', valor: 5 }, { forma_pagamento: 'pix', valor: 4.99 }], fisico: 5 },
      { titulo: 'misto 5,00 + 4,99 (10,00)', produtos: [P.M10], passos: (p) => p.adicionar(P.M10, '1'),
        mistos: [{ forma_pagamento: 'dinheiro', valor: 5 }, { forma_pagamento: 'pix', valor: 4.99 }], fisico: 5 }
    ];
    let fisico = 0;
    for (const r of roteiro) {
      const prep = prepararPdv(pdv, r.produtos, r.passos);
      const payloadVenda = r.mistos ? pdv.payload('misto', r.mistos) : pdv.payload('dinheiro');
      const out = await executarCenario({
        id: `S01-${vendas.length + 1}`, titulo: r.titulo, pdv, ...prep, caixa,
        refCentavos: 0, payload: payloadVenda, fluxoFiscal: true,
        dinheiroFisico: r.fisico ?? 0, dinheiroFisicoFluxo: r.mistos ? null : 'cobrado', semFechamento: true
      });
      if (out.vendaId) fisico = Number((fisico + out.dinheiroFisico).toFixed(2));
      vendas.push({
        titulo: r.titulo, tela: prep.totalTela, total: out.payload.total, status: out.resp.status,
        erro: out.resp.status === 200 ? null : out.resp.body.error,
        cobrado: out.fluxoFiscal?.cobrado_operador ?? null,
        fluxo_ab: out.fluxoFiscal?.fluxo_ab ? { a: out.fluxoFiscal.fluxo_ab.valorA, b: out.fluxoFiscal.fluxo_ab.valorB } : null,
        persistido_total: out.persistido?.venda?.total ?? null,
        recebimentos: out.persistido ? out.persistido.recebimentos.map((x) => x.valor) : []
      });
    }
    const fech = await consolidar(caixa, fisico);
    analises.S01 = {
      vendas,
      dinheiro_fisico_cobrado: fisico,
      fechamento: {
        vendido: fech.vendas.total_vendido,
        recebido: fech.vendas.total_recebido,
        fiscal: fech.vendas.fiscal,
        nao_fiscal: fech.vendas.nao_fiscal,
        dinheiro_esperado: fech.dinheiro.esperado,
        informado: fech.dinheiro.informado,
        diferenca_fisica: fech.dinheiro.diferenca,
        validacao_ok: fech.validacao.ok,
        inconsistencias: fech.validacao.inconsistencias,
        saldo_liquido: fech.validacao.saldo_liquido,
        reconciliacao: (fech.reconciliacao.vendas || []).map((r) => ({ venda: r.venda_id, status: r.status_reconciliacao, divergencia: r.divergencia }))
      }
    };
    assert.ok(vendas.length === roteiro.length);
  });

  // ------------------------------------------------------------------------
  // Varreduras determinísticas (frequência de cada mecanismo)
  // ------------------------------------------------------------------------
  it('G1 arredondamento da quantidade na adição (12,99/kg, 0,001 a 30,000 kg)', () => {
    const hist = {};
    let divergentes = 0;
    let maior = 0;
    let menor = 0;
    let exemplo = null;
    for (let mil = 1; mil <= 30000; mil += 1) {
      pdv.reset([P.KG]);
      const qtdTxt = (mil / 1000).toFixed(3).replace('.', ',');
      pdv.adicionar(P.KG, qtdTxt);
      const total = pdv.ctx.obterTotalVendaPDV();
      const ref = reais(refLinha({ precoCentavos: 1299, qtdMilesimos: mil }));
      const dif = Number((total - ref).toFixed(2));
      if (dif !== 0) {
        divergentes += 1;
        hist[dif] = (hist[dif] || 0) + 1;
        if (dif > maior) { maior = dif; exemplo = { quantidade: qtdTxt, pdv: total, ref }; }
        if (dif < menor) menor = dif;
      }
    }
    analises.G1 = { casos: 30000, divergentes, pct: Number((100 * divergentes / 30000).toFixed(2)), maior, menor, histograma: hist, exemplo_maior: exemplo };
    assert.ok(divergentes >= 0);
  });

  it('G2 item com desconto %: subtotal do PDV × motor do backend (qtd × preço 2 casas)', () => {
    const { calcularValoresFiscaisItem } = require('../../backend/services/distribuidorEstoqueVenda');
    let casos = 0;
    let divergentes = 0;
    const hist = {};
    let exemplo = null;
    for (let mil = 101; mil <= 20000; mil += 13) {
      for (let pct = 1; pct <= 15; pct += 1) {
        pdv.reset([P.KG]);
        pdv.adicionar(P.KG, '1');
        pdv.ctx.atualizarQuantidade(0, (mil / 1000).toFixed(3).replace('.', ','));
        pdv.ctx.atualizarPercentual(0, pct);
        const item = pdv.payload('dinheiro').itens[0];
        const motor = calcularValoresFiscaisItem(item, item.quantidade, 0);
        casos += 1;
        const dif = Number((item.subtotal - motor.subtotalVenda).toFixed(2));
        if (dif !== 0) {
          divergentes += 1;
          hist[dif] = (hist[dif] || 0) + 1;
          if (!exemplo) exemplo = { quantidade: item.quantidade, pct, preco_enviado: item.preco_unitario, subtotal_pdv: item.subtotal, subtotal_motor: motor.subtotalVenda };
        }
      }
    }
    analises.G2 = { casos, divergentes, pct: Number((100 * divergentes / casos).toFixed(2)), histograma: hist, exemplo };
    assert.ok(casos > 0);
  });

  it('G3 carrinho com várias linhas fracionadas: total enviado × Σ linhas exibidas', () => {
    let semente = 12345;
    const aleatorio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
    const prods = [P.KG, P.KGA, P.KGB, P.KGC, P.ETQ];
    let casos = 0;
    let divergentes = 0;
    const hist = {};
    let exemplo = null;
    for (let n = 0; n < 1500; n += 1) {
      const linhas = 2 + Math.floor(aleatorio() * 5);
      pdv.reset(prods);
      for (let i = 0; i < linhas; i += 1) {
        const prod = prods[i % prods.length];
        pdv.adicionar(prod, '1');
        const mil = 50 + Math.floor(aleatorio() * 4950);
        pdv.ctx.atualizarQuantidade(i, (mil / 1000).toFixed(3).replace('.', ','));
      }
      const payload = pdv.payload('dinheiro');
      const somaLinhas = Number(payload.itens.reduce((a, it) => a + it.subtotal, 0).toFixed(2));
      casos += 1;
      const dif = Number((payload.total - somaLinhas).toFixed(2));
      if (dif !== 0) {
        divergentes += 1;
        hist[dif] = (hist[dif] || 0) + 1;
        if (!exemplo) exemplo = { linhas: payload.itens.map((i) => [i.quantidade, i.preco_unitario, i.subtotal]), total: payload.total, soma_linhas: somaLinhas };
      }
    }
    analises.G3 = { casos, divergentes, pct: Number((100 * divergentes / casos).toFixed(2)), histograma: hist, exemplo };
    assert.ok(casos > 0);
  });

  it('G4 tolerância de soma do pagamento misto (PDV e backend)', () => {
    const { validarSomaPagamentosVenda } = require('../../backend/services/vendas/VendaFinanceiroService');
    const res = {};
    for (const faltaCent of [-1, 1]) {
      let aceitosPdv = 0;
      let aceitosBackend = 0;
      let casos = 0;
      for (let c = 200; c <= 50000; c += 1) {
        const total = c / 100;
        const informado = Number(((c - faltaCent) / 100).toFixed(2));
        casos += 1;
        if (pdv.ctx.__somaMistoAceita(total, informado)) aceitosPdv += 1;
        if (validarSomaPagamentosVenda([{ forma_pagamento: 'dinheiro', valor: informado }], total) === null) aceitosBackend += 1;
      }
      res[faltaCent === 1 ? 'falta_1_centavo' : 'sobra_1_centavo'] = { casos, aceitosPdv, aceitosBackend };
    }
    analises.G4 = res;
    assert.ok(true);
  });

  // ------------------------------------------------------------------------
  // Sprint 1 — testes obrigatórios complementares
  // ------------------------------------------------------------------------
  it('C03b fracionado digitado no modal (10,567) e editado depois (10,568)', async () => {
    const prep = prepararPdv(pdv, [P.KG], (p) => {
      p.adicionar(P.KG, '10,567');
      p.ctx.atualizarQuantidade(0, '10,568');
    });
    const t = await executarCenario({
      id: 'C03b', titulo: '10,567 kg (modal) → editado para 10,568 kg × 12,99', pdv, ...prep,
      entrada: { quantidade: '10,567 → 10,568', preco: 12.99 },
      refCentavos: refLinha({ precoCentavos: 1299, qtdMilesimos: 10568 }),
      payload: pdv.payload('dinheiro'),
      dinheiroFisico: parseTela(prep.totalTela)
    });
    assert.equal(t.itens_pdv[0].quantidade_carrinho, 10.568);
  });

  it('V01 backend com subtotal de item adulterado (+0,01) e total ≠ Σ linhas', async () => {
    const caixa = await abrirCaixa('V01');
    const vendasAntes = (await get('SELECT COUNT(*) AS n FROM vendas')).n;
    pdv.reset([P.KG]);
    pdv.adicionar(P.KG, '10,567');
    const base = pdv.payload('dinheiro');
    assert.equal(base.itens[0].subtotal, 137.27);

    const itemAdulterado = JSON.parse(JSON.stringify(base));
    itemAdulterado.itens[0].subtotal = 137.28;
    itemAdulterado.total = 137.28;
    itemAdulterado.pagamentos[0].valor = 137.28;
    const r1 = await enviarVenda(itemAdulterado, caixa);

    const totalAdulterado = JSON.parse(JSON.stringify(base));
    totalAdulterado.total = 137.28;
    totalAdulterado.pagamentos[0].valor = 137.28;
    const r2 = await enviarVenda(totalAdulterado, caixa);

    const pre = await preCalcular(itemAdulterado, caixa);
    analises.V01 = {
      item_adulterado: { status: r1.status, codigo: r1.body.codigo, erro: r1.body.error },
      total_adulterado: { status: r2.status, codigo: r2.body.codigo, erro: r2.body.error },
      pre_calculo_item_adulterado: { status: pre.status, codigo: pre.body.codigo },
      vendas_gravadas: (await get('SELECT COUNT(*) AS n FROM vendas')).n - vendasAntes
    };
    assert.ok(true);
  });

  it('N01 ruído de ponto flutuante aceito no PDV e no backend; R$ 0,01 real bloqueado no PDV', () => {
    const { validarSomaPagamentosVenda } = require('../../backend/services/vendas/VendaFinanceiroService');
    const casos = [
      { total: 0.3, valores: [0.1, 0.2] },
      { total: 137.27, valores: [50, 50, 37.27] },
      { total: 1.15, valores: [0.15, 0.15, 0.15, 0.7] },
      { total: 100.03, valores: [33.34, 33.34, 33.35] }
    ];
    for (const c of casos) {
      const somaFloat = c.valores.reduce((a, v) => a + v, 0);
      const pags = c.valores.map((valor) => ({ forma_pagamento: 'pix', valor }));
      assert.equal(pdv.ctx.__somaMistoAceita(c.total, c.valores), true, `PDV ${c.total} (Σ float ${somaFloat})`);
      assert.equal(validarSomaPagamentosVenda(pags, c.total), null, `backend ${c.total}`);
    }
    assert.notEqual(0.1 + 0.2, 0.3);
    const backendUmCentavo = [];
    for (const delta of [-0.01, 0.01]) {
      const pags = [{ forma_pagamento: 'pix', valor: 0.1 }, { forma_pagamento: 'pix', valor: Number((0.2 + delta).toFixed(2)) }];
      assert.equal(pdv.ctx.__somaMistoAceita(0.3, pags.map((p) => p.valor)), false);
      backendUmCentavo.push(validarSomaPagamentosVenda(pags, 0.3));
    }
    assert.equal(validarSomaPagamentosVenda(
      [{ forma_pagamento: 'pix', valor: 56.29, tipo_recebimento: 'fiscal' }],
      137.27,
      { valor_fiscal: 56.29, valor_nao_fiscal: 80.98 }
    ), null);
    backendUmCentavo.push(validarSomaPagamentosVenda(
      [{ forma_pagamento: 'pix', valor: 56.3, tipo_recebimento: 'fiscal' }],
      137.27,
      { valor_fiscal: 56.29, valor_nao_fiscal: 80.98 }
    ));
    analises.N01 = { backend_um_centavo: backendUmCentavo };
  });

  it('G6 partilha A/B do motor do backend: A + B × linha, negativos, B sem quantidade', () => {
    const { calcularValoresFiscaisItem } = require('../../backend/services/distribuidorEstoqueVenda');
    let semente = 777;
    const aleatorio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
    let casos = 0;
    const violacoes = [];
    const porProblema = {};
    for (let n = 0; n < 6000; n += 1) {
      pdv.reset([P.KG]);
      pdv.adicionar(P.KG, '1');
      const mil = 10 + Math.floor(aleatorio() * 20000);
      pdv.ctx.atualizarQuantidade(0, (mil / 1000).toFixed(3).replace('.', ','));
      const modo = n % 3;
      if (modo === 1) pdv.ctx.atualizarPercentual(0, 1 + Math.floor(aleatorio() * 15));
      if (modo === 2) {
        const tetoDesconto = Math.min(3, (12.99 * mil / 1000) * 0.9);
        pdv.ctx.atualizarDescontoValor(0, Number((aleatorio() * tetoDesconto).toFixed(2)));
      }
      const item = pdv.payload('dinheiro').itens[0];
      const q = item.quantidade;
      const qF = Number((Math.floor(aleatorio() * (q * 1000 + 1)) / 1000).toFixed(3));
      const qNf = Number((q - qF).toFixed(3));
      const r = calcularValoresFiscaisItem(item, qF, qNf);
      casos += 1;
      const soma = Math.round(r.valorFiscal * 100) + Math.round(r.valorNaoFiscal * 100);
      const problemas = [];
      if (soma !== Math.round(item.subtotal * 100)) problemas.push('A+B≠linha');
      if (r.valorFiscal < 0 || r.valorNaoFiscal < 0) problemas.push('negativo');
      if (r.valorNaoFiscal !== 0 && qNf <= 0) problemas.push('B sem quantidade');
      if (r.valorFiscal !== 0 && qF <= 0) problemas.push('A sem quantidade');
      for (const p of problemas) porProblema[p] = (porProblema[p] || 0) + 1;
      if (problemas.length && violacoes.length < 10) violacoes.push({ q, qF, qNf, item: item.subtotal, r, problemas });
    }
    analises.G6 = { casos, porProblema, violacoes };
    assert.ok(casos > 0);
  });

  // ------------------------------------------------------------------------
  // Sprint 1 — lado PDV dos achados 1 a 4 corrigido (regressão).
  // ------------------------------------------------------------------------
  it('CORRIGIDOS no PDV — quantidade, linha, total e soma do pagamento misto', () => {
    const T = Object.fromEntries(trilhas.map((t) => [t.id, t]));

    // ACHADO 1 — quantidade com 3 casas preservada na adição e na edição.
    assert.equal(T.C02.itens_pdv[0].quantidade_carrinho, 10.567);
    assert.equal(T.C02.itens_enviados[0].quantidade, 10.567);
    assert.equal(T.C02.total_enviado, 137.27);
    assert.equal(T.C02.ref_por_item, 137.27);
    assert.equal(T.C03.total_enviado, 137.27);

    // ACHADO 2 (PDV) — preço interno coerente com a linha enviada.
    assert.equal(T.C04.itens_enviados[0].preco_unitario, 12.08);
    assert.equal(T.C04.itens_enviados[0].preco_unitario_interno, 12.0807);
    assert.equal(T.C08b.itens_enviados[0].preco_unitario, 39.9);

    // ACHADO 3 (PDV) — total = Σ linhas exibidas.
    assert.equal(T.C08.total_enviado, 3);
    assert.equal(T.C08.backend_status, 200);
    assert.equal(T.C05b.total_enviado, 136.77);
    assert.equal(analises.G3.divergentes, 0);

    // ACHADO 4 (PDV) — pagamento misto com R$ 0,01 real de diferença bloqueado.
    assert.equal(T.C09b.backend_status, 400);
    for (const id of ['C09b', 'C09c', 'C09d']) {
      assert.equal(T[id].extra.pdv_aceita_soma, false, id);
    }
    assert.deepEqual(T.C09b.extra.aceite_por_falta, { falta_1c: false, falta_2c: false, falta_3c: false, falta_4c: false });
    assert.equal(T.C09.extra.pdv_aceita_soma, true);
    for (const k of ['falta_1_centavo', 'sobra_1_centavo']) {
      assert.equal(analises.G4[k].aceitosPdv, 0, k);
    }
    for (const id of ['F01', 'F02', 'F03', 'F07']) {
      assert.equal(T[id].fluxo_fiscal.bloqueio_pdv, false, id);
    }
  });

  // ------------------------------------------------------------------------
  // Microsprint 2 — pré-cálculo fiscal A/B do Motor (etiqueta de valor e desconto global).
  // ------------------------------------------------------------------------
  it('CORRIGIDOS Microsprint 2 — pré-cálculo A/B com valor da linha e desconto global', () => {
    const T = Object.fromEntries(trilhas.map((t) => [t.id, t]));

    // Etiqueta VALOR: A = valor impresso, B = 0, venda fiscal aceita sem bloqueio do PDV.
    assert.equal(T.F04.fluxo_fiscal.pre_calculo.valor_fiscal, 7.77);
    assert.equal(T.F04.fluxo_fiscal.pre_calculo.valor_nao_fiscal, 0);
    assert.equal(T.F04b.fluxo_fiscal.pre_calculo.valor_fiscal, 1.87);
    assert.equal(T.F04b.fluxo_fiscal.pre_calculo.valor_nao_fiscal, 0);
    for (const id of ['F04', 'F04b', 'C08b']) {
      assert.equal(T[id].backend_status, 200, id);
      assert.equal(Number(T[id].persistido.itens[0].valor_nao_fiscal), 0, id);
    }
    assert.equal(T.F04.fluxo_fiscal.cobrado_operador, 7.77);
    assert.equal(T.F04b.fluxo_fiscal.cobrado_operador, 1.87);

    // Desconto global: pré-cálculo devolve o líquido (137,27 − 0,50 = 136,77).
    assert.equal(T.F05.fluxo_fiscal.pre_calculo.valor_fiscal, 136.77);
    assert.equal(T.F05.fluxo_fiscal.pre_calculo.valor_nao_fiscal, 0);
    assert.equal(T.F05.backend_status, 200);
    assert.equal(T.C05b.backend_status, 200);
    assert.equal(Number(T.C05b.persistido.itens[0].valor_fiscal), 136.77);

    for (const id of ['F01', 'F02', 'F03', 'F04', 'F04b', 'F05', 'F07']) {
      assert.equal(T[id].fluxo_fiscal.bloqueio_pdv, false, id);
    }

    // Mesmo valor da linha: sem B fantasma em desconto de item / atacado.
    for (const id of ['C04', 'C05', 'F02', 'F03']) {
      assert.equal(Number(T[id].persistido.itens[0].valor_nao_fiscal), 0, id);
    }
    assert.equal(analises.G2.divergentes, 0);
    for (const preco of Object.keys(analises.G5)) {
      assert.equal(analises.G5[preco].pct_divergente, 0, `G5 ${preco}`);
      assert.equal(analises.G5[preco].invariantes_violados, 0, `G5 ${preco}`);
    }
    assert.deepEqual(analises.G6.porProblema, {});

    // A/B persistido coerente (qtd, valor e sinal).
    for (const t of trilhas.filter((x) => x.persistido)) {
      for (const it of t.persistido.itens) {
        const qNf = Number(it.quantidade_nao_fiscal || 0);
        assert.ok(Number(it.valor_fiscal) >= 0 && Number(it.valor_nao_fiscal) >= 0, `${t.id} negativo`);
        assert.ok(!(Number(it.valor_nao_fiscal) !== 0 && qNf <= 0), `${t.id} B sem quantidade`);
      }
    }

    // Subtotal adulterado não é usado pelo Motor; a validação existente recusa a venda.
    assert.equal(analises.V01.item_adulterado.status, 400);
    assert.equal(analises.V01.vendas_gravadas, 0);

    // Sessão acumulada: vendido = recebido.
    assert.equal(analises.S01.fechamento.vendido, analises.S01.fechamento.recebido);
    assert.equal(analises.S01.fechamento.validacao_ok, true);
  });

  // ------------------------------------------------------------------------
  // Fora das Microsprints 1 e 2 (aguardando decisão): comportamento atual caracterizado.
  // ------------------------------------------------------------------------
  it('PENDENTES backend — arredondamento do motor, unidade no Motor e tolerância de pagamentos', () => {
    const T = Object.fromEntries(trilhas.map((t) => [t.id, t]));

    // Arredondamento interno do motor (meio centavo) diverge da referência em 2 quantidades.
    assert.equal(analises.G1.divergentes, 2);

    // Motor sem unidade do cadastro: KG fracionado distribuído como inteiro.
    assert.equal(T.C13.persistido.itens[0].quantidade_fiscal, 4);

    // Backend aceita R$ 0,01 de diferença no pagamento (tolerância em float, parcial).
    assert.equal(T.C09c.backend_status, 200);
    assert.equal(T.C09d.backend_status, 200);
    for (const k of ['falta_1_centavo', 'sobra_1_centavo']) {
      assert.ok(analises.G4[k].aceitosBackend > 0, k);
    }
    assert.ok(analises.N01.backend_um_centavo.some((r) => r === null));
  });

  // ------------------------------------------------------------------------
  // Fora do escopo da Sprint 1 (Etapa 2): comportamento atual caracterizado.
  // ------------------------------------------------------------------------
  it('PENDENTES Etapa 2 — achados 6 a 8 (comportamento atual)', () => {
    const T = Object.fromEntries(trilhas.map((t) => [t.id, t]));

    // ACHADO 6 — parcelas a prazo sem ajuste de resíduo.
    const somaParcelas = Number(T.C16.persistido.financeiro.reduce((a, f) => a + Number(f.valor), 0).toFixed(2));
    assert.equal(somaParcelas, 99.99);

    // ACHADO 7 — devolução parcial altera só vendas.total; reconciliação acusa inconsistência.
    assert.equal(T.C15.fechamento.validacao_ok, false);
    assert.equal(T.C15.fechamento.reconciliacao[0].status, 'INCONSISTENTE');
    assert.equal(T.C15.fechamento.reconciliacao[0].divergencia, 9.29);

    // ACHADO 8 — preço editado seguido de desconto % volta ao preço base original.
    assert.equal(T.C11.total_enviado, 130.4);
    assert.equal(T.C11.ref_por_item, 125.38);
  });

  it('CONSISTENTES — quantidade, subtotal, A/B e pagamentos de ponta a ponta', () => {
    const T = Object.fromEntries(trilhas.map((t) => [t.id, t]));
    const consistentes = [
      'C01', 'C02', 'C03', 'C03b', 'C04', 'C05', 'C05b', 'C06', 'C07', 'C08', 'C08b', 'C09', 'C10',
      'C12', 'C12b', 'C13', 'C13b', 'F01', 'F02', 'F03', 'F04', 'F04b', 'F05', 'F07'
    ];
    for (const id of consistentes) {
      const t = T[id];
      assert.equal(t.backend_status, 200, `${id}: ${t.backend_erro}`);
      assert.equal(t.total_enviado, t.ref_por_item, id);
      assert.equal(parseTela(t.total_tela), t.total_enviado, id);
      assert.equal(Number(t.persistido.total), t.total_enviado, id);
      assert.equal(t.fechamento.recebido, t.total_enviado, id);
      assert.equal(t.fechamento.diferenca_fisica, 0, id);
      assert.equal(t.fechamento.validacao_ok, true, id);
      assert.deepEqual(t.etapas_divergencia, [], id);
    }
    // Atacado e venda por unidade preservados.
    assert.equal(T.C12.itens_enviados[0].preco_unitario, 11.9);
    assert.equal(T.C12.itens_enviados[0].quantidade, 10.567);
    assert.equal(T.C12b.itens_enviados[0].preco_unitario, 3.49);
    assert.equal(T.C12b.itens_enviados[0].quantidade, 3);
    assert.equal(T.C10.troco_enviado, 12.73);
    assert.deepEqual(T.C06.extra.puts_cadastro, []);
    assert.deepEqual(T.C07.extra.puts_cadastro, [{ produto_id: P.KG.id, preco_venda: 11.49 }]);
    assert.equal(T.C14.persistido.status, 'cancelada');
    assert.deepEqual(T.C14.extra.cancelamentos.map((c) => c.status), [200, 400]);
    assert.equal(T.C14.persistido.financeiro.filter((f) => f.status === 'cancelado').length, 1);
    assert.equal(T.C14.fechamento.vendido, 0);
  });

  it('nenhum evento fiscal foi disparado', () => {
    assert.deepEqual(chamadasFiscais, []);
  });
});
