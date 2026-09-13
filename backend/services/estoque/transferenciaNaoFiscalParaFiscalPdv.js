/**
 * Preparação de estoque no PDV: transfere saldo NÃO FISCAL → FISCAL
 * somente o déficit da quantidade informada, ANTES do Motor F×NF.
 *
 * Não altera o Motor (distribuidorEstoqueVenda).
 * Mutação de saldo: exclusivamente MTS + Interface Pública F×NF.
 */

'use strict';

const mts = require('../../motores/mts');
const estoqueSaldosPublico = require('../fiscalNaoFiscal/estoqueSaldosPublico');

const MOTIVO_TRANSFERENCIA_PDV = 'TRANSFERENCIA_NAO_FISCAL_PARA_FISCAL';
const EPS = 1e-9;

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function calcularTransferenciaNaoFiscalParaFiscal({
  quantidade,
  saldoFiscal,
  saldoNaoFiscal
} = {}) {
  const q = round3(quantidade);
  const sf = round3(saldoFiscal);
  const snf = round3(saldoNaoFiscal);
  const estoqueAtual = round3(sf + snf);
  const deficitFiscal = round3(Math.max(0, q - sf));
  const estoqueInsuficiente = q > estoqueAtual + EPS;
  const podeTransferir = !estoqueInsuficiente
    && deficitFiscal > EPS
    && snf + EPS >= deficitFiscal;

  return Object.freeze({
    quantidade: q,
    saldoFiscal: sf,
    saldoNaoFiscal: snf,
    estoqueAtual,
    deficitFiscal,
    estoqueInsuficiente,
    devePerguntar: podeTransferir,
    podeTransferir,
    quantidadeTransferir: podeTransferir ? deficitFiscal : 0
  });
}

function mensagemEstoqueInsuficiente(estoqueAtual) {
  return `Saldo insuficiente.\n\nDisponível: ${round3(estoqueAtual)}`;
}

/**
 * Decisão de inclusão APÓS a quantidade (espelho do fluxo PDV).
 * Nunca trata fiscal=0 como erro se o NF cobre o déficit e ainda não houve decisão.
 */
function avaliarFluxoInclusaoPdv({
  quantidade,
  saldoFiscal,
  saldoNaoFiscal,
  modoFiscal = false,
  respostaTransferencia = null,
  controlaEstoque = true,
  permitido = true
} = {}) {
  if (controlaEstoque === false) {
    return Object.freeze({
      acao: 'INCLUIR',
      quantidadeTransferir: 0,
      devePerguntar: false,
      mensagemBloqueio: null
    });
  }

  const calc = calcularTransferenciaNaoFiscalParaFiscal({
    quantidade,
    saldoFiscal,
    saldoNaoFiscal
  });

  if (permitido === false) {
    if (calc.estoqueInsuficiente) {
      return Object.freeze({
        acao: 'RECUSAR',
        quantidadeTransferir: 0,
        devePerguntar: false,
        mensagemBloqueio: mensagemEstoqueInsuficiente(calc.estoqueAtual),
        calc
      });
    }
    return Object.freeze({
      acao: 'INCLUIR',
      quantidadeTransferir: 0,
      devePerguntar: false,
      mensagemBloqueio: null,
      calc
    });
  }

  if (calc.devePerguntar && respostaTransferencia == null) {
    return Object.freeze({
      acao: 'PERGUNTAR',
      quantidadeTransferir: calc.quantidadeTransferir,
      devePerguntar: true,
      mensagemBloqueio: null,
      calc
    });
  }

  const aceitou = respostaTransferencia === true && calc.podeTransferir;
  if (aceitou) {
    return Object.freeze({
      acao: 'INCLUIR',
      quantidadeTransferir: calc.quantidadeTransferir,
      devePerguntar: false,
      mensagemBloqueio: null,
      saldoNaoAlteraNoSim: true,
      calc
    });
  }

  if (calc.estoqueInsuficiente) {
    return Object.freeze({
      acao: 'RECUSAR',
      quantidadeTransferir: 0,
      devePerguntar: false,
      mensagemBloqueio: mensagemEstoqueInsuficiente(calc.estoqueAtual),
      calc
    });
  }

  // NÃO (ou sem transferência): inclui no carrinho se o total F+NF cobre a
  // quantidade. Modo fiscal não recusa saldo somente não fiscal.
  return Object.freeze({
    acao: 'INCLUIR',
    quantidadeTransferir: 0,
    devePerguntar: false,
    mensagemBloqueio: null,
    calc
  });
}

function podeIniciarInclusaoPdv({ saldoFiscal, saldoNaoFiscal, controlaEstoque = true } = {}) {
  if (controlaEstoque === false) return true;
  return round3(Number(saldoFiscal || 0) + Number(saldoNaoFiscal || 0)) > EPS;
}

function aplicarTransferenciaEmMemoria(saldos, quantidadeTransferir) {
  const q = round3(quantidadeTransferir);
  if (q < -EPS) {
    const err = new Error('Quantidade de transferência inválida.');
    err.code = 'QUANTIDADE_INVALIDA';
    throw err;
  }
  const sf = round3(saldos?.saldoFiscal ?? saldos?.saldo_fiscal);
  const snf = round3(saldos?.saldoNaoFiscal ?? saldos?.saldo_nao_fiscal);

  if (!(q > 0)) {
    return Object.freeze({
      saldoFiscal: sf,
      saldoNaoFiscal: snf,
      estoqueAtual: round3(sf + snf),
      transferido: 0
    });
  }

  const saldoFiscalDepois = round3(sf + q);
  const saldoNaoFiscalDepois = round3(snf - q);

  if (saldoFiscalDepois < -EPS) {
    const err = new Error('Transferência resultaria em saldo fiscal negativo.');
    err.code = 'SALDO_FISCAL_NEGATIVO';
    throw err;
  }
  if (saldoNaoFiscalDepois < -EPS) {
    const err = new Error('Transferência resultaria em saldo não fiscal negativo.');
    err.code = 'SALDO_NAO_FISCAL_NEGATIVO';
    throw err;
  }

  return Object.freeze({
    saldoFiscal: saldoFiscalDepois,
    saldoNaoFiscal: saldoNaoFiscalDepois,
    estoqueAtual: round3(saldoFiscalDepois + saldoNaoFiscalDepois),
    transferido: q
  });
}

function obterQtdEstoqueItem(item = {}) {
  if (item.quantidade_estoque != null && item.quantidade_estoque !== '') {
    return Number(item.quantidade_estoque);
  }
  return Number(item.quantidade || 0);
}

function obterIntentTransferenciaItem(item = {}) {
  return round3(
    item.transferencia_nao_fiscal_para_fiscal
    ?? item.transferenciaNaoFiscalParaFiscal
    ?? 0
  );
}

function produtoControlaEstoqueEntrada(entrada = {}) {
  if (entrada.controlaEstoque === false || entrada.controlaEstoque === 0) {
    return false;
  }
  const produto = entrada.produto;
  if (produto && (produto.controla_estoque === 0 || produto.controla_estoque === '0')) {
    return false;
  }
  return true;
}

/**
 * Ajusta saldos das entradas do Motor com transferências consentidas (em memória).
 * Recalcula o déficit no momento da preparação; nunca transfere acima do déficit
 * nem com NF insuficiente.
 */
function prepararEntradasMotorComTransferenciaPdv(entradas = [], opcoes = {}) {
  const permitido = Object.prototype.hasOwnProperty.call(opcoes || {}, 'permitido')
    ? opcoes.permitido === true
    : true;
  const running = new Map();
  const aplicacoes = [];
  const saida = [];

  for (const entrada of entradas) {
    const item = entrada.item || entrada;
    const produtoId = Number(item.produto_id || item.id);
    const qtdEstoque = obterQtdEstoqueItem(item);

    let sf = Number(entrada.saldoFiscal != null ? entrada.saldoFiscal : 0);
    let snf = Number(entrada.saldoNaoFiscal != null ? entrada.saldoNaoFiscal : 0);

    if (Number.isInteger(produtoId) && running.has(produtoId)) {
      const prev = running.get(produtoId);
      sf = prev.saldoFiscal;
      snf = prev.saldoNaoFiscal;
    }

    const intent = permitido ? obterIntentTransferenciaItem(item) : 0;
    let transferido = 0;

    if (produtoControlaEstoqueEntrada(entrada) && intent > EPS) {
      const calc = calcularTransferenciaNaoFiscalParaFiscal({
        quantidade: qtdEstoque,
        saldoFiscal: sf,
        saldoNaoFiscal: snf
      });
      if (calc.podeTransferir) {
        const mem = aplicarTransferenciaEmMemoria(
          { saldoFiscal: sf, saldoNaoFiscal: snf },
          calc.quantidadeTransferir
        );
        transferido = mem.transferido;
        sf = mem.saldoFiscal;
        snf = mem.saldoNaoFiscal;
        aplicacoes.push({
          produto_id: produtoId,
          quantidade: transferido,
          quantidade_venda: qtdEstoque,
          saldo_fiscal_antes: calc.saldoFiscal,
          saldo_nao_fiscal_antes: calc.saldoNaoFiscal,
          motivo: MOTIVO_TRANSFERENCIA_PDV
        });
      } else {
        return {
          sucesso: false,
          aplicacoes: [],
          entradas: [],
          erro: calc.estoqueInsuficiente
            ? `Saldo insuficiente para transferência. Disponível: ${calc.estoqueAtual}`
            : 'Saldo não fiscal insuficiente para cobrir o déficit fiscal.'
        };
      }
    }

    if (Number.isInteger(produtoId) && produtoId > 0) {
      running.set(produtoId, { saldoFiscal: sf, saldoNaoFiscal: snf });
    }

    saida.push({
      ...entrada,
      item,
      saldoFiscal: sf,
      saldoNaoFiscal: snf,
      transferenciaAplicadaEmMemoria: transferido
    });
  }

  return { sucesso: true, entradas: saida, aplicacoes };
}

function montarDepsMts(opts = {}) {
  const db = opts.db;
  const jaEmTransacao = opts.jaEmTransacao === true;
  return {
    db,
    jaEmTransacao,
    estoque: {
      ...estoqueSaldosPublico,
      consultarSaldo: estoqueSaldosPublico.consultarSaldo,
      debitarSaldo: estoqueSaldosPublico.debitarSaldo,
      creditarSaldo: estoqueSaldosPublico.creditarSaldo,
      normalizarTipoSaldo: estoqueSaldosPublico.normalizarTipoSaldo,
      executarEmTransacao: jaEmTransacao
        ? async (work) => work(db)
        : estoqueSaldosPublico.executarEmTransacao
    }
  };
}

/**
 * Persiste aplicações via MTS (auditoria movimentos_transferencia_saldos).
 */
async function aplicarTransferenciasPdv(aplicacoes = [], opts = {}) {
  const resultados = [];
  const usuarioId = opts.usuarioId != null ? opts.usuarioId : opts.usuario;
  const deps = montarDepsMts(opts);

  for (const ap of aplicacoes) {
    const quantidade = round3(ap.quantidade);
    if (!(quantidade > 0)) continue;

    const tr = await mts.transferirSaldo({
      produto: ap.produto_id,
      origem: mts.TipoSaldo.NAO_FISCAL,
      destino: mts.TipoSaldo.FISCAL,
      quantidade,
      motivo: ap.motivo || MOTIVO_TRANSFERENCIA_PDV,
      usuario: usuarioId,
      contextoAutorizacao: {
        autorizado: true,
        origem: 'PDV_INCLUSAO_ITEM',
        produto_id: ap.produto_id,
        quantidade_venda: ap.quantidade_venda,
        venda_id: opts.vendaId || ap.venda_id || null
      }
    }, deps);

    resultados.push(tr);
  }

  return resultados;
}

function aplicarTransferenciasPdvCb(aplicacoes, opts, callback) {
  aplicarTransferenciasPdv(aplicacoes, opts)
    .then((r) => callback(null, r))
    .catch((err) => callback(err));
}

module.exports = {
  MOTIVO_TRANSFERENCIA_PDV,
  round3,
  calcularTransferenciaNaoFiscalParaFiscal,
  aplicarTransferenciaEmMemoria,
  avaliarFluxoInclusaoPdv,
  podeIniciarInclusaoPdv,
  prepararEntradasMotorComTransferenciaPdv,
  aplicarTransferenciasPdv,
  aplicarTransferenciasPdvCb
};
