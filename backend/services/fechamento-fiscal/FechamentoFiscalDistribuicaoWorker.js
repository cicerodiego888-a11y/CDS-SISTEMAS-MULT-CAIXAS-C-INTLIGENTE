'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

let fila = Promise.resolve();

function executarNoWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'fechamento-fiscal-distribuicao-worker.js'));
    let concluido = false;

    const finalizar = (erro, resultado) => {
      if (concluido) return;
      concluido = true;
      worker.terminate().catch(() => {});
      if (erro) reject(erro);
      else resolve(resultado);
    };

    worker.once('message', (mensagem) => {
      if (!mensagem || mensagem.ok !== true) {
        const erro = new Error(mensagem?.error || 'Falha no cálculo da prévia fiscal.');
        erro.code = mensagem?.code || 'PREVIA_WORKER_FAILED';
        finalizar(erro);
        return;
      }
      finalizar(null, mensagem.resultado);
    });
    worker.once('error', (erro) => finalizar(erro));
    worker.once('exit', (codigo) => {
      if (codigo !== 0) {
        finalizar(new Error(`Worker de distribuição encerrou com código ${codigo}.`));
      }
    });
    try {
      worker.postMessage(payload);
    } catch (erro) {
      finalizar(erro);
    }
  });
}

function gerarPreviaDistribuicaoNoWorker(payload) {
  const tarefa = fila.then(() => executarNoWorker(payload));
  fila = tarefa.catch(() => {});
  return tarefa;
}

module.exports = { gerarPreviaDistribuicaoNoWorker };
