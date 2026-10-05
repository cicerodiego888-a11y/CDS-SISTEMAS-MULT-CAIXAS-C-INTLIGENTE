'use strict';

const { parentPort } = require('worker_threads');
const distribuicao = require('./FechamentoFiscalDistribuicaoService');
const { gerarPreviaPorComprovante } = require('./FechamentoFiscalService');

parentPort.on('message', (mensagem) => {
  try {
    const resultado = mensagem.tipo === 'comprovantes'
      ? gerarPreviaPorComprovante(
        mensagem.comprovantes,
        mensagem.lotes,
        mensagem.opcoes
      )
      : distribuicao.gerarPreviaDistribuicao(
        mensagem.lotes,
        mensagem.valorInformado,
        mensagem.opcoes
      );
    parentPort.postMessage({ ok: true, resultado });
  } catch (erro) {
    parentPort.postMessage({
      ok: false,
      error: erro && erro.message ? erro.message : String(erro),
      code: erro && erro.code ? erro.code : 'PREVIA_WORKER_FAILED'
    });
  }
});
