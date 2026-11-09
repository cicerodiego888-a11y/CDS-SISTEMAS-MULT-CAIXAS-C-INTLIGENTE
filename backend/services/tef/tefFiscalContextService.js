'use strict';

const tefFluxoPagamento = require('./tefFluxoPagamento');
const contextosFiscaisValidos = new WeakSet();

function paraCentavos(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  const centavos = Math.round(numero * 100);
  if (Math.abs(numero * 100 - centavos) > 0.000001) return null;
  return centavos;
}

function criarContextoFiscal({ valor, valorFiscalDisponivel, tipo }) {
  const valorCentavos = paraCentavos(valor);
  const disponivelCentavos = paraCentavos(valorFiscalDisponivel);
  const tipoNormalizado = tefFluxoPagamento.normalizarTipoTef(tipo);

  if (
    valorCentavos == null
    || disponivelCentavos == null
    || valorCentavos <= 0
    || valorCentavos > disponivelCentavos
    || !tefFluxoPagamento.formaPagamentoUsaTEF(tipoNormalizado)
  ) {
    const error = new Error('Contexto fiscal insuficiente para autorizar TEF.');
    error.code = 'TEF_CONTEXTO_FISCAL_INVALIDO';
    throw error;
  }

  const contexto = Object.freeze({ valorCentavos, tipo: tipoNormalizado });
  contextosFiscaisValidos.add(contexto);
  return contexto;
}

function validarContextoFiscal(contexto, { valor, tipo }) {
  if (!contexto || !contextosFiscaisValidos.has(contexto)) return false;
  return contexto.valorCentavos === paraCentavos(valor)
    && contexto.tipo === tefFluxoPagamento.normalizarTipoTef(tipo);
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row || null);
    });
  });
}

function falha(codigo, mensagem) {
  return { ok: false, codigo, mensagem };
}

async function validarContextoFiscalVenda({
  vendaId,
  valor,
  tipo,
  idempotencyKey,
  db = require('../../database')
}) {
  const id = Number(vendaId);
  const valorCentavos = paraCentavos(valor);

  if (!Number.isInteger(id) || id <= 0 || valorCentavos == null || valorCentavos <= 0) {
    return falha(
      'TEF_CONTEXTO_FISCAL_AUSENTE',
      'A autorização TEF exige uma venda persistida e um valor válido.'
    );
  }

  const tipoNormalizado = tefFluxoPagamento.normalizarTipoTef(tipo);
  if (!tefFluxoPagamento.formaPagamentoUsaTEF(tipoNormalizado)) {
    return falha('TEF_TIPO_INVALIDO', 'A forma de pagamento não utiliza TEF.');
  }

  const venda = await get(
    db,
    'SELECT id, COALESCE(valor_fiscal, 0) AS valor_fiscal FROM vendas WHERE id = ?',
    [id]
  );
  if (!venda) {
    return falha('TEF_VENDA_INEXISTENTE', 'Venda fiscal não encontrada no backend.');
  }

  const valorFiscalCentavos = paraCentavos(venda.valor_fiscal);
  if (valorFiscalCentavos == null || valorFiscalCentavos <= 0) {
    return falha('TEF_VENDA_SEM_VALOR_FISCAL', 'A venda não possui parcela fiscal positiva.');
  }
  if (valorCentavos > valorFiscalCentavos) {
    return falha(
      'TEF_VALOR_EXCEDE_SALDO_FISCAL',
      'O valor TEF excede o valor fiscal persistido da venda.'
    );
  }

  if (idempotencyKey) {
    const transacaoExistente = await get(
      db,
      `SELECT venda_id, valor, tipo
       FROM tef_transacoes
       WHERE idempotency_key = ?`,
      [idempotencyKey]
    );

    if (transacaoExistente) {
      if (
        Number(transacaoExistente.venda_id) !== id
        || paraCentavos(transacaoExistente.valor) !== valorCentavos
        || tefFluxoPagamento.normalizarTipoTef(transacaoExistente.tipo)
          !== tefFluxoPagamento.normalizarTipoTef(tipo)
      ) {
        return falha(
          'TEF_IDEMPOTENCY_CONTEXT_CONFLICT',
          'A chave idempotente já está vinculada a outro contexto fiscal.'
        );
      }

      return {
        ok: true,
        venda_id: id,
        contextoFiscal: criarContextoFiscal({
          valor,
          valorFiscalDisponivel: valor,
          tipo
        })
      };
    }
  }

  const recebimentosSemTef = await get(
    db,
    `SELECT COALESCE(SUM(valor), 0) AS total
     FROM venda_recebimentos
     WHERE venda_id = ?
       AND tipo_recebimento = 'fiscal'
       AND status = 'aprovado'
       AND tef_transacao_id IS NULL`,
    [id]
  );
  const transacoesTefExistentes = await get(
    db,
    `SELECT COALESCE(SUM(valor), 0) AS total
     FROM tef_transacoes
     WHERE venda_id = ?
       AND status IN ('pendente', 'aprovado')`,
    [id]
  );

  const recebidoCentavos = paraCentavos(recebimentosSemTef?.total || 0);
  const tefExistenteCentavos = paraCentavos(transacoesTefExistentes?.total || 0);
  const disponivelCentavos = valorFiscalCentavos - recebidoCentavos - tefExistenteCentavos;

  if (valorCentavos > disponivelCentavos) {
    return falha(
      'TEF_VALOR_EXCEDE_SALDO_FISCAL',
      'O valor TEF excede o saldo fiscal disponível da venda.'
    );
  }

  return {
    ok: true,
    venda_id: id,
    contextoFiscal: criarContextoFiscal({
      valor,
      valorFiscalDisponivel: disponivelCentavos / 100,
      tipo
    })
  };
}

async function autorizarPagamentoFiscal({ autorizar, ...contexto }) {
  if (typeof autorizar !== 'function') {
    throw new TypeError('A autorização TEF exige uma função de execução do backend.');
  }
  const validacao = await validarContextoFiscalVenda(contexto);
  if (!validacao.ok) return validacao;

  return {
    ...validacao,
    resultado: await autorizar(validacao.contextoFiscal)
  };
}

module.exports = {
  criarContextoFiscal,
  validarContextoFiscal,
  validarContextoFiscalVenda,
  autorizarPagamentoFiscal,
  paraCentavos
};
