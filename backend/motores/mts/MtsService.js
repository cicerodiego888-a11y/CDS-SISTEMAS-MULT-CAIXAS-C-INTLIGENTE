/**
 * MTS V1.0 — Motor de Transferência de Saldos
 *
 * API interna:
 *   transferirSaldo({ produto, origem, destino, quantidade, motivo, usuario, contextoAutorizacao })
 *   consultarTransferencia(id)
 *
 * Toda mutação de saldo ocorre exclusivamente via
 * backend/services/fiscalNaoFiscal (Interface Pública).
 *
 * RC5.1.2 — blindagem interna: transferirSaldo exige contexto de autorização
 * (validação de token/perfil permanece no orquestrador, ex.: Motor Comercial).
 */
'use strict';

const estoqueSaldosPublico = require('../../services/fiscalNaoFiscal/estoqueSaldosPublico');
const { TipoSaldo, ResultadoTransferencia } = require('./contracts');
const auditoria = require('./MtsAuditoriaRepository');
const schema = require('./schema');

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function getDefaultDb() {
  return require('../../database');
}

function erro(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function resolverProdutoId(input) {
  if (input == null) return null;
  if (typeof input === 'object') {
    return Number(input.id || input.produto_id || input.produtoId);
  }
  return Number(input);
}

function resolverUsuarioId(usuario) {
  if (usuario == null) return null;
  if (typeof usuario === 'object') {
    const id = usuario.id || usuario.usuario_id || usuario.usuarioId;
    return id != null ? Number(id) : null;
  }
  const n = Number(usuario);
  return Number.isFinite(n) ? n : null;
}

/**
 * RC5.1.2 — extrai contexto de autorização sem validar token/perfil.
 * @param {object} params
 * @param {object} deps
 * @returns {*|null}
 */
function extrairContextoAutorizacao(params = {}, deps = {}) {
  const ctx = params.contextoAutorizacao
    ?? params.autorizacao
    ?? deps.contextoAutorizacao
    ?? deps.autorizacao
    ?? null;
  return ctx == null ? null : ctx;
}

/**
 * RC5.1.2 — bloqueia transferência sem contexto de autorização.
 * @param {object} params
 * @param {object} deps
 */
function garantirContextoAutorizacao(params = {}, deps = {}) {
  const ctx = extrairContextoAutorizacao(params, deps);
  if (ctx == null || ctx === false) {
    throw erro(
      'AUTORIZACAO_AUSENTE',
      'Transferência de saldo exige contexto de autorização.'
    );
  }
  if (typeof ctx === 'object' && Object.prototype.hasOwnProperty.call(ctx, 'autorizado') && ctx.autorizado !== true) {
    throw erro(
      'AUTORIZACAO_AUSENTE',
      'Transferência de saldo exige contexto de autorização.'
    );
  }
  return ctx;
}

/**
 * @param {object} params
 * @param {number|object} params.produto
 * @param {string} params.origem - FISCAL | NAO_FISCAL
 * @param {string} params.destino - FISCAL | NAO_FISCAL
 * @param {number} params.quantidade
 * @param {string} [params.motivo]
 * @param {number|object} [params.usuario]
 * @param {object|true} [params.contextoAutorizacao] - RC5.1.2 contexto de autorização pré-validado
 * @param {{ db?: object, estoque?: object, contextoAutorizacao?: object }} [deps]
 */
async function transferirSaldo(params = {}, deps = {}) {
  const db = deps.db || getDefaultDb();
  const estoque = deps.estoque || estoqueSaldosPublico;

  await schema.garantirSchema(db);

  const produtoId = resolverProdutoId(params.produto ?? params.produto_id ?? params.produtoId);
  const quantidade = round3(params.quantidade);
  const motivo = params.motivo != null ? String(params.motivo).trim() : '';
  const usuarioId = resolverUsuarioId(params.usuario ?? params.usuario_id ?? params.usuarioId);

  let origem;
  let destino;
  try {
    origem = estoque.normalizarTipoSaldo
      ? estoque.normalizarTipoSaldo(params.origem)
      : estoqueSaldosPublico.normalizarTipoSaldo(params.origem);
    destino = estoque.normalizarTipoSaldo
      ? estoque.normalizarTipoSaldo(params.destino)
      : estoqueSaldosPublico.normalizarTipoSaldo(params.destino);
  } catch (e) {
    throw erro(e.code || 'TIPO_SALDO_INVALIDO', e.message);
  }

  if (!Number.isInteger(produtoId) || produtoId <= 0) {
    throw erro('PRODUTO_INVALIDO', 'Produto inválido.');
  }
  if (!(quantidade > 0)) {
    throw erro('QUANTIDADE_INVALIDA', 'Quantidade deve ser maior que zero.');
  }
  if (origem === destino) {
    throw erro('ORIGEM_DESTINO_IGUAIS', 'Origem e destino devem ser diferentes.');
  }

  // RC5.1.2 — antes de iniciar a transferência
  garantirContextoAutorizacao(params, deps);

  const executarTx = deps.jaEmTransacao
    ? async (work) => work(db)
    : (estoque.executarEmTransacao || estoqueSaldosPublico.executarEmTransacao);

  try {
    const resultado = await executarTx(async (txDb) => {
      // 1) Consultar via Interface Pública
      const antes = await estoque.consultarSaldo(produtoId, { db: txDb });

      const saldoOrigemAntes = origem === TipoSaldo.FISCAL
        ? antes.saldo_fiscal
        : antes.saldo_nao_fiscal;
      const saldoDestinoAntes = destino === TipoSaldo.FISCAL
        ? antes.saldo_fiscal
        : antes.saldo_nao_fiscal;

      if (saldoOrigemAntes + 1e-9 < quantidade) {
        throw erro(
          'SALDO_INSUFICIENTE',
          origem === TipoSaldo.FISCAL
            ? 'Saldo fiscal insuficiente.'
            : 'Saldo não fiscal insuficiente.',
          { saldo_disponivel: saldoOrigemAntes }
        );
      }

      // 2) Debitar origem / 3) Creditar destino — Interface Pública
      await estoque.debitarSaldo(produtoId, origem, quantidade, { db: txDb });
      await estoque.creditarSaldo(produtoId, destino, quantidade, { db: txDb });

      const depois = await estoque.consultarSaldo(produtoId, { db: txDb });
      const saldoOrigemDepois = origem === TipoSaldo.FISCAL
        ? depois.saldo_fiscal
        : depois.saldo_nao_fiscal;
      const saldoDestinoDepois = destino === TipoSaldo.FISCAL
        ? depois.saldo_fiscal
        : depois.saldo_nao_fiscal;

      // 4) Auditoria própria do MTS (mesma transação)
      const movimento = await auditoria.registrarMovimento(txDb, {
        produto_id: produtoId,
        origem,
        destino,
        quantidade,
        saldo_origem_antes: saldoOrigemAntes,
        saldo_origem_depois: saldoOrigemDepois,
        saldo_destino_antes: saldoDestinoAntes,
        saldo_destino_depois: saldoDestinoDepois,
        motivo: motivo || null,
        usuario_id: usuarioId,
        resultado: ResultadoTransferencia.SUCESSO
      });

      return {
        sucesso: true,
        resultado: ResultadoTransferencia.SUCESSO,
        transferencia_id: movimento.id,
        produto_id: produtoId,
        origem,
        destino,
        quantidade,
        saldo_origem_antes: saldoOrigemAntes,
        saldo_origem_depois: saldoOrigemDepois,
        saldo_destino_antes: saldoDestinoAntes,
        saldo_destino_depois: saldoDestinoDepois,
        motivo: motivo || null,
        usuario_id: usuarioId,
        saldos: depois
      };
    }, { db });

    return Object.freeze(resultado);
  } catch (err) {
    // Falhas de validação / saldo / motor — propagam como erro tipado
    if (err && err.code) throw err;
    throw erro('TRANSFERENCIA_FALHOU', err.message || 'Falha na transferência de saldo.');
  }
}

/**
 * Consulta registro de auditoria do MTS.
 * @param {number} id
 * @param {{ db?: object }} [deps]
 */
async function consultarTransferencia(id, deps = {}) {
  const db = deps.db || getDefaultDb();
  await schema.garantirSchema(db);
  const row = await auditoria.buscarPorId(db, id);
  if (!row) {
    throw erro('TRANSFERENCIA_NAO_ENCONTRADA', 'Transferência não encontrada.');
  }
  return Object.freeze(row);
}

module.exports = {
  transferirSaldo,
  consultarTransferencia
};
