/**
 * Proteção de saldo do Fechamento Fiscal.
 * valor_principal é imutável; emitido/pendente vêm dos documentos AUTORIZADOS (DB = verdade).
 */

'use strict';

const { arredondarMoeda, toCentavos } = require('../fiscal/modeloTotais');
const { STATUS, DOC_STATUS } = require('./constants');
const { agoraLocal } = require('./FechamentoFiscalValidacaoService');

function getDb(dbOverride) {
  if (dbOverride) return dbOverride;
  return require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function logSaldo(evento, campos = {}) {
  const parts = Object.entries(campos)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  // eslint-disable-next-line no-console
  console.log(`[FECHAMENTO_FISCAL][SALDO][${evento}] ${parts.join(' ')}`);
}

function logContinuar(campos = {}) {
  const parts = Object.entries(campos)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  // eslint-disable-next-line no-console
  console.log(`[FECHAMENTO_FISCAL][CONTINUAR] ${parts.join(' ')}`);
}

/**
 * Deriva status operacional a partir do saldo (não esconde autorização parcial atrás de REJEITADO).
 */
function statusOperacionalDoSaldo(saldo, statusAtual) {
  const emit = toCentavos(saldo && saldo.valor_emitido_autorizado);
  const pend = toCentavos(saldo && saldo.valor_pendente_emissao);
  const st = String(statusAtual || '').toUpperCase();
  if (pend === 0 && emit > 0) return STATUS.AUTORIZADO;
  if (emit > 0 && pend > 0) return STATUS.AUTORIZACAO_PARCIAL;
  if (emit === 0 && (st === STATUS.REJEITADO || st === 'REJEITADO')) return STATUS.REJEITADO;
  return st || STATUS.PREVIA;
}

/**
 * Recalcula saldo, sincroniza status no banco e loga recuperação (abrir fechamento legado).
 */
async function sincronizarSaldoAoAbrir(dbOrDeps, fechamentoId, opts = {}) {
  const db = dbOrDeps && typeof dbOrDeps.run === 'function'
    ? dbOrDeps
    : getDb(dbOrDeps && dbOrDeps.db);
  const id = Number(fechamentoId);
  const ff = await get(db, `SELECT id, status FROM fechamentos_fiscais WHERE id = ?`, [id]);
  if (!ff) {
    const err = new Error('Fechamento não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }

  const saldo = await recalcularSaldoFechamento(db, id, opts);
  const statusNovo = statusOperacionalDoSaldo(saldo, ff.status);
  const statusAnterior = String(ff.status || '');

  if (statusNovo && statusNovo !== statusAnterior
    && statusAnterior !== STATUS.CANCELADO
    && statusAnterior !== STATUS.EMITINDO) {
    await run(
      db,
      `UPDATE fechamentos_fiscais SET status = ?, atualizado_em = ? WHERE id = ?`,
      [statusNovo, agoraLocal(), id]
    );
  }

  if (opts.log !== false) {
    logSaldo('RECUPERACAO', {
      fechamentoId: id,
      principal: saldo.valor_principal,
      autorizado: saldo.valor_emitido_autorizado,
      pendente: saldo.valor_pendente_emissao,
      status: statusNovo || statusAnterior
    });
  }

  return {
    ...saldo,
    status: statusNovo || statusAnterior,
    status_anterior: statusAnterior,
    mensagens: montarMensagensSaldo(saldo)
  };
}

/**
 * Bloqueia emissão/transmissão integral quando já há NFC-e autorizada e saldo pendente.
 */
function bloquearEmissaoIntegralSeParcial(saldo, opts = {}) {
  const emit = toCentavos(saldo && saldo.valor_emitido_autorizado);
  const pend = toCentavos(saldo && saldo.valor_pendente_emissao);
  if (!(emit > 0 && pend > 0)) return null;
  if (opts.continuar_emissao === true || opts.continuar === true) return null;

  const err = new Error(
    `Fechamento em AUTORIZAÇÃO PARCIAL. Já emitido R$ ${arredondarMoeda(saldo.valor_emitido_autorizado).toFixed(2)}; ` +
    `restante R$ ${arredondarMoeda(saldo.valor_pendente_emissao).toFixed(2)}. Use CONTINUAR EMISSÃO — não retransmita o valor principal.`
  );
  err.statusCode = 409;
  err.code = 'FECHAMENTO_AUTORIZACAO_PARCIAL';
  err.saldo = saldo;
  err.valor_principal = saldo.valor_principal;
  err.valor_emitido_autorizado = saldo.valor_emitido_autorizado;
  err.valor_pendente_emissao = saldo.valor_pendente_emissao;
  return err;
}

function montarMensagensSaldo(saldo, { ultimoAutorizado = null } = {}) {
  const msgs = [];
  if (ultimoAutorizado != null && Number(ultimoAutorizado) > 0) {
    msgs.push(`Venda emitida: R$ ${arredondarMoeda(ultimoAutorizado).toFixed(2)}`);
  }
  msgs.push(`Valor original do fechamento: R$ ${arredondarMoeda(saldo.valor_principal).toFixed(2)}`);
  msgs.push(`Valor restante para emissão: R$ ${arredondarMoeda(saldo.valor_pendente_emissao).toFixed(2)}`);
  if (Number(saldo.valor_emitido_autorizado) > 0) {
    msgs.push(`Já emitido (autorizado): R$ ${arredondarMoeda(saldo.valor_emitido_autorizado).toFixed(2)}`);
  }
  return msgs;
}

/**
 * Soma valores efetivamente autorizados no banco (fonte da verdade).
 */
async function somarValorAutorizadoDocumentos(db, fechamentoId) {
  const rows = await all(
    db,
    `SELECT valor_total, status, cstat, protocolo, chave_acesso
     FROM fechamentos_fiscais_documentos
     WHERE fechamento_fiscal_id = ?`,
    [fechamentoId]
  );
  let cents = 0;
  const autorizados = [];
  for (const d of rows) {
    const st = String(d.status || '').toUpperCase();
    const cstat = String(d.cstat || '');
    const okStatus = st === DOC_STATUS.AUTORIZADO || st === 'AUTORIZADA';
    const okCstat = cstat === '100' || cstat === '150';
    if (!okStatus) continue;
    // Preferir evidência de autorização quando disponível
    if ((d.protocolo || d.chave_acesso) || okCstat || okStatus) {
      const v = toCentavos(d.valor_total);
      if (v > 0) {
        cents += v;
        autorizados.push({
          valor: arredondarMoeda(v / 100),
          cstat: d.cstat,
          protocolo: d.protocolo,
          chave_acesso: d.chave_acesso
        });
      }
    }
  }
  return { valorCents: cents, valor: arredondarMoeda(cents / 100), documentos: autorizados };
}

function calcularPendente(principalCents, emitidoCents) {
  return Math.max(0, Number(principalCents || 0) - Number(emitidoCents || 0));
}

/**
 * Garante valor_principal na 1ª emissão; nunca sobrescreve se já > 0.
 */
async function garantirValorPrincipal(db, fechamentoId, candidato) {
  const ff = await get(
    db,
    `SELECT id, valor_informado, valor_distribuido, valor_principal FROM fechamentos_fiscais WHERE id = ?`,
    [fechamentoId]
  );
  if (!ff) {
    const err = new Error('Fechamento não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }

  const atual = toCentavos(ff.valor_principal);
  if (atual > 0) {
    logSaldo('FECHAMENTO_VALOR_PRINCIPAL', {
      fechamento_id: fechamentoId,
      principal: arredondarMoeda(atual / 100),
      imutavel: 1
    });
    return arredondarMoeda(atual / 100);
  }

  const base = Number(candidato != null
    ? candidato
    : (ff.valor_distribuido > 0 ? ff.valor_distribuido : ff.valor_informado));
  const principal = arredondarMoeda(Math.max(0, base));
  await run(
    db,
    `UPDATE fechamentos_fiscais
     SET valor_principal = ?, atualizado_em = ?
     WHERE id = ? AND (valor_principal IS NULL OR CAST(valor_principal AS REAL) <= 0)`,
    [principal, agoraLocal(), fechamentoId]
  );
  logSaldo('FECHAMENTO_VALOR_PRINCIPAL', {
    fechamento_id: fechamentoId,
    principal,
    origem: 'garantir'
  });
  return principal;
}

/**
 * Recalcula emitido/pendente a partir dos documentos AUTORIZADOS e persiste.
 */
async function recalcularSaldoFechamento(dbOrDeps, fechamentoId, opts = {}) {
  const db = dbOrDeps && typeof dbOrDeps.run === 'function'
    ? dbOrDeps
    : getDb(dbOrDeps && dbOrDeps.db);
  const id = Number(fechamentoId);
  const ff = await get(
    db,
    `SELECT * FROM fechamentos_fiscais WHERE id = ?`,
    [id]
  );
  if (!ff) {
    const err = new Error('Fechamento não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }

  const principal = await garantirValorPrincipal(
    db,
    id,
    opts.candidatoPrincipal != null
      ? opts.candidatoPrincipal
      : (ff.valor_distribuido > 0 ? ff.valor_distribuido : ff.valor_informado)
  );

  const { valor: emitido, documentos } = await somarValorAutorizadoDocumentos(db, id);
  const principalCents = toCentavos(principal);
  const emitidoCents = toCentavos(emitido);
  const pendenteCents = calcularPendente(principalCents, emitidoCents);
  const pendente = arredondarMoeda(pendenteCents / 100);

  await run(
    db,
    `UPDATE fechamentos_fiscais
     SET valor_principal = ?,
         valor_emitido_autorizado = ?,
         valor_pendente_emissao = ?,
         atualizado_em = ?
     WHERE id = ?`,
    [principal, emitido, pendente, agoraLocal(), id]
  );

  logSaldo('SALDO_FECHAMENTO_RECALCULADO', {
    fechamento_id: id,
    principal,
    autorizado: emitido,
    pendente
  });

  const saldo = {
    fechamento_id: id,
    valor_principal: principal,
    valor_emitido_autorizado: emitido,
    valor_pendente_emissao: pendente,
    documentos_autorizados: documentos,
    concluido: pendenteCents === 0 && principalCents > 0,
    mensagens: montarMensagensSaldo({
      valor_principal: principal,
      valor_emitido_autorizado: emitido,
      valor_pendente_emissao: pendente
    }, { ultimoAutorizado: opts.ultimoAutorizado })
  };

  if (saldo.concluido) {
    logSaldo('FECHAMENTO_CONCLUIDO', {
      fechamento_id: id,
      principal,
      autorizado: emitido,
      pendente: 0
    });
  }

  return saldo;
}

/**
 * Base obrigatória para nova emissão / continuação.
 * Nunca retorna valor_principal se já houver autorizado.
 */
async function obterBaseNovaEmissao(db, fechamentoId) {
  const saldo = await recalcularSaldoFechamento(db, fechamentoId);
  if (saldo.concluido) {
    const err = new Error('Fechamento já está totalmente autorizado. Não há saldo pendente para nova emissão.');
    err.statusCode = 409;
    err.code = 'FECHAMENTO_JA_CONCLUIDO';
    err.saldo = saldo;
    throw err;
  }
  if (toCentavos(saldo.valor_emitido_autorizado) > 0) {
    logSaldo('FECHAMENTO_CONTINUADO', {
      fechamento_id: fechamentoId,
      base: saldo.valor_pendente_emissao,
      principal: saldo.valor_principal,
      autorizado: saldo.valor_emitido_autorizado
    });
  }
  return {
    ...saldo,
    valor_nova_tentativa: saldo.valor_pendente_emissao
  };
}

/**
 * Bloqueia tentativa de usar valor_principal (ou superior ao pendente) após autorizações.
 */
function assertValorTentativaPermitido(saldo, valorTentativa) {
  const tent = toCentavos(valorTentativa);
  const pend = toCentavos(saldo.valor_pendente_emissao);
  const princ = toCentavos(saldo.valor_principal);
  const emit = toCentavos(saldo.valor_emitido_autorizado);

  if (emit > 0 && tent > pend) {
    const err = new Error(
      `Valor da nova tentativa (R$ ${arredondarMoeda(valorTentativa).toFixed(2)}) excede o saldo pendente ` +
      `(R$ ${arredondarMoeda(saldo.valor_pendente_emissao).toFixed(2)}). ` +
      `Já autorizado: R$ ${arredondarMoeda(saldo.valor_emitido_autorizado).toFixed(2)}.`
    );
    err.statusCode = 409;
    err.code = 'FECHAMENTO_SALDO_EXCEDE_PENDENTE';
    err.saldo = saldo;
    throw err;
  }
  if (emit > 0 && tent === princ && princ > pend) {
    const err = new Error(
      'Não é permitido reiniciar a emissão pelo valor principal após NFC-e autorizada. Use o saldo pendente.'
    );
    err.statusCode = 409;
    err.code = 'FECHAMENTO_NAO_REPETIR_PRINCIPAL';
    err.saldo = saldo;
    throw err;
  }
  return true;
}

/**
 * Continua emissão: recalcula saldo e devolve base = pendente (sem gerar NFC-e aqui).
 */
async function continuarEmissaoFechamento(fechamentoId, deps = {}) {
  const db = getDb(deps.db);
  const id = Number(fechamentoId);
  const base = await obterBaseNovaEmissao(db, id);

  // Documentos em possível processamento bloqueiam nova identidade automática
  const pendentesRec = await all(
    db,
    `SELECT id, status, chave_acesso, valor_total FROM fechamentos_fiscais_documentos
     WHERE fechamento_fiscal_id = ?
       AND status IN (?, ?)`,
    [id, DOC_STATUS.EMITINDO, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO]
  );
  if (pendentesRec.length) {
    const err = new Error(
      'Existe documento com possível processamento na SEFAZ. Execute recuperação antes de continuar a emissão.'
    );
    err.statusCode = 409;
    err.code = 'PENDENTE_RECUPERACAO_OBRIGATORIA';
    err.saldo = base;
    err.documentos = pendentesRec;
    throw err;
  }

  logContinuar({
    fechamentoId: id,
    valor: base.valor_nova_tentativa,
    principal: base.valor_principal,
    autorizado: base.valor_emitido_autorizado
  });

  return {
    ok: true,
    status: STATUS.AUTORIZACAO_PARCIAL,
    saldo: base,
    valor_base_continuacao: base.valor_nova_tentativa,
    mensagens: base.mensagens,
    mensagem:
      `Venda(s) já emitida(s): R$ ${base.valor_emitido_autorizado.toFixed(2)}. ` +
      `Restante para emissão: R$ ${base.valor_pendente_emissao.toFixed(2)}.`
  };
}

function anexarSaldoAoResultado(resultado, saldo) {
  if (!resultado || !saldo) return resultado;
  return {
    ...resultado,
    saldo,
    valor_principal: saldo.valor_principal,
    valor_emitido_autorizado: saldo.valor_emitido_autorizado,
    valor_pendente_emissao: saldo.valor_pendente_emissao,
    mensagens_saldo: saldo.mensagens,
    mensagem_saldo: (saldo.mensagens || []).join('\n')
  };
}

module.exports = {
  somarValorAutorizadoDocumentos,
  calcularPendente,
  garantirValorPrincipal,
  recalcularSaldoFechamento,
  obterBaseNovaEmissao,
  assertValorTentativaPermitido,
  continuarEmissaoFechamento,
  montarMensagensSaldo,
  anexarSaldoAoResultado,
  logSaldo,
  logContinuar,
  statusOperacionalDoSaldo,
  sincronizarSaldoAoAbrir,
  bloquearEmissaoIntegralSeParcial
};
