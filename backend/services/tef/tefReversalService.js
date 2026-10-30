const { obterAdapterDaTransacao } = require('./tefAdapterCiclo');
const repository = require('./tefRepository');
const tefEvents = require('./tefEvents');
const tefContrato = require('./tefContrato');

async function executarReversaoAutomatica(transacaoId, motivo = 'Reversão automática por falha na venda') {
  try {
    const db = require('../../database');

    const transacao = await new Promise((resolve, reject) => {
      db.get(`
        SELECT *
        FROM tef_transacoes
        WHERE id = ?
      `, [transacaoId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!transacao) {
      throw new Error('Transação TEF não encontrada para reversão.');
    }

    if (transacao.status !== 'aprovado') {
      throw new Error(`Transação não pode ser revertida. Status atual: ${transacao.status}`);
    }

    tefEvents.emitirEstado('PROCESSANDO', {
      acao: 'reversao',
      transacao_id: transacaoId
    });

    // MRT-13 — estorno/reversão no provedor original da transação
    const ciclo = await obterAdapterDaTransacao(transacao);
    const adapter = ciclo.adapter;
    const resultado = await adapter.cancelarPagamento({
      transacao_id: transacaoId,
      nsu: transacao.nsu,
      autorizacao: transacao.autorizacao,
      motivo
    });

    const confirmado = tefContrato.cancelamentoConfirmado(resultado);

    // TEF-17: sem confirmação financeira, não marca cancelado / reversao_executada.
    if (!confirmado) {
      repository.registrarLog(
        transacaoId,
        'REVERSAO_NAO_CONFIRMADA',
        `Reversão não confirmada pelo provedor: ${resultado?.mensagem || motivo}`,
        {
          resultado,
          statusAnterior: transacao.status,
          financialState: 'UNCHANGED'
        }
      );

      tefEvents.emitirEstado('ERRO_COMUNICACAO', {
        transacao_id: transacaoId,
        erro: resultado?.mensagem || 'Cancelamento TEF não confirmado',
        cancelOutcome: resultado?.cancelOutcome || null
      });

      return {
        sucesso: false,
        cancelConfirmed: false,
        financialState: 'UNCHANGED',
        transacao_id: transacaoId,
        status: transacao.status,
        resultado,
        mensagem: resultado?.mensagem || 'Reversão TEF não confirmada pelo provedor — estado financeiro inalterado'
      };
    }

    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE tef_transacoes
        SET
          status = ?,
          payload_retorno = ?,
          reversao_executada = 1,
          reversao_motivo = ?,
          reversao_data = datetime('now'),
          atualizado_em = datetime('now')
        WHERE id = ?
      `, [
        tefContrato.STATUS.CANCELADO,
        JSON.stringify(resultado),
        motivo,
        transacaoId
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    repository.registrarLog(
      transacaoId,
      'REVERSAO_SUCESSO',
      `Reversão automática executada: ${motivo}`,
      resultado
    );

    tefEvents.emitirEstado('CANCELADO', {
      transacao_id: transacaoId,
      motivo
    });

    return {
      sucesso: true,
      cancelConfirmed: true,
      financialState: 'CANCELLED',
      transacao_id: transacaoId,
      resultado,
      mensagem: 'Reversão automática executada com sucesso'
    };

  } catch (error) {
    console.error('Erro ao executar reversão automática:', error);

    repository.registrarLog(
      transacaoId,
      'REVERSAO_ERRO',
      `Erro na reversão automática: ${error.message}`,
      { error: error.message }
    );

    tefEvents.emitirEstado('ERRO_COMUNICACAO', {
      transacao_id: transacaoId,
      erro: error.message
    });

    throw error;
  }
}

async function verificarReversoesPendentes() {
  try {
    const db = require('../../database');

    const transacoesPendentes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT *
        FROM tef_transacoes
        WHERE status = 'aprovado'
          AND reversao_executada = 0
          AND criado_em < datetime('now', '-5 minutes')
        ORDER BY criado_em ASC
        LIMIT 10
      `, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    const resultados = [];
    for (const transacao of transacoesPendentes) {
      try {
        const resultado = await executarReversaoAutomatica(
          transacao.id,
          'Reversão por timeout de confirmação da venda'
        );
        resultados.push({
          transacao_id: transacao.id,
          sucesso: resultado.sucesso === true,
          cancelConfirmed: resultado.cancelConfirmed === true,
          resultado
        });
      } catch (error) {
        resultados.push({ transacao_id: transacao.id, sucesso: false, erro: error.message });
      }
    }

    return {
      total: transacoesPendentes.length,
      processadas: resultados.length,
      resultados
    };

  } catch (error) {
    console.error('Erro ao verificar reversões pendentes:', error);
    throw error;
  }
}

async function iniciarVerificacaoReversoes() {
  const INTERVALO_VERIFICACAO = 5 * 60 * 1000; // 5 minutos

  setInterval(async () => {
    try {
      await verificarReversoesPendentes();
    } catch (error) {
      console.error('Erro na verificação periódica de reversões:', error);
    }
  }, INTERVALO_VERIFICACAO);
}

module.exports = {
  executarReversaoAutomatica,
  verificarReversoesPendentes,
  iniciarVerificacaoReversoes
};
