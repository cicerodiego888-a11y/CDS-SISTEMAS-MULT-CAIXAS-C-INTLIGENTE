'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_TIMEOUT_MS = 90_000;
let fila = Promise.resolve();
let sequenciaFila = 0;

function logWorker(evento, dados = {}) {
  // eslint-disable-next-line no-console
  console.log(`[FechamentoFiscal] ${evento}`, JSON.stringify(dados));
}

function executarNoWorker(payload, rastreio, filaId, deps = {}) {
  const inicio = performance.now();
  logWorker('previa_worker_inicio', { ...rastreio, fila_id: filaId });
  return new Promise((resolve, reject) => {
    const criarWorker = deps.criarWorker
      || (() => new Worker(path.join(__dirname, 'fechamento-fiscal-distribuicao-worker.js')));
    const timeoutMs = Math.max(1, Number(deps.timeoutMs) || WORKER_TIMEOUT_MS);
    let worker;
    let concluido = false;
    let timeoutId;

    const finalizar = (erro, resultado) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timeoutId);
      logWorker('previa_worker_fim', {
        ...rastreio,
        fila_id: filaId,
        resultado: erro ? 'erro' : 'sucesso',
        codigo_erro: erro?.code || null,
        classe_erro: erro?.name || null,
        duracao_ms: Number((performance.now() - inicio).toFixed(3))
      });
      const concluir = (erroFinal = erro) => {
        if (erroFinal) reject(erroFinal);
        else resolve(resultado);
      };
      if (!worker) {
        concluir();
        return;
      }
      Promise.resolve()
        .then(() => worker.terminate())
        .then(() => concluir())
        .catch((erroEncerramento) => {
          logWorker('previa_worker_terminate_error', {
            ...rastreio,
            fila_id: filaId,
            classe_erro: erroEncerramento?.name || null,
            duracao_ms: Number((performance.now() - inicio).toFixed(3))
          });
          if (erro) {
            erro.erroEncerramentoWorker = erroEncerramento;
            concluir(erro);
            return;
          }
          erroEncerramento.code = erroEncerramento.code || 'PREVIA_WORKER_TERMINATE';
          concluir(erroEncerramento);
        });
    };

    try {
      worker = criarWorker();
    } catch (erro) {
      finalizar(erro);
      return;
    }

    timeoutId = setTimeout(() => {
      const erro = new Error(`Worker de distribuição excedeu o limite de ${timeoutMs} ms.`);
      erro.code = 'PREVIA_WORKER_TIMEOUT';
      logWorker('previa_worker_timeout', {
        ...rastreio,
        fila_id: filaId,
        timeout_ms: timeoutMs,
        duracao_ms: Number((performance.now() - inicio).toFixed(3))
      });
      finalizar(erro);
    }, timeoutMs);

    worker.once('message', (mensagem) => {
      logWorker('previa_worker_message', {
        ...rastreio,
        fila_id: filaId,
        ok: mensagem?.ok === true,
        codigo_erro: mensagem?.ok === true ? null : (mensagem?.code || 'PREVIA_WORKER_FAILED'),
        duracao_ms: Number((performance.now() - inicio).toFixed(3))
      });
      if (!mensagem || mensagem.ok !== true) {
        const erro = new Error(mensagem?.error || 'Falha no cálculo da prévia fiscal.');
        erro.code = mensagem?.code || 'PREVIA_WORKER_FAILED';
        finalizar(erro);
        return;
      }
      finalizar(null, mensagem.resultado);
    });
    worker.once('error', (erro) => {
      logWorker('previa_worker_error', {
        ...rastreio,
        fila_id: filaId,
        classe_erro: erro?.name || null,
        duracao_ms: Number((performance.now() - inicio).toFixed(3))
      });
      finalizar(erro);
    });
    worker.once('exit', (codigo) => {
      logWorker('previa_worker_exit', {
        ...rastreio,
        fila_id: filaId,
        codigo_saida: codigo,
        finalizado_antes_da_saida: concluido,
        duracao_ms: Number((performance.now() - inicio).toFixed(3))
      });
      if (!concluido) {
        const erro = new Error(
          codigo === 0
            ? 'Worker de distribuição encerrou sem retornar o resultado.'
            : `Worker de distribuição encerrou com código ${codigo}.`
        );
        erro.code = codigo === 0 ? 'PREVIA_WORKER_NO_RESULT' : 'PREVIA_WORKER_EXIT';
        finalizar(erro);
      }
    });
    try {
      worker.postMessage(payload);
    } catch (erro) {
      finalizar(erro);
    }
  });
}

function gerarPreviaDistribuicaoNoWorker(payload, rastreio = {}, deps = {}) {
  const filaId = ++sequenciaFila;
  const enfileiradoEm = performance.now();
  logWorker('previa_worker_enfileirado', {
    ...rastreio,
    fila_id: filaId,
    tipo: payload?.tipo === 'comprovantes' ? 'comprovantes' : 'normal'
  });
  const tarefa = fila.then(() => {
    logWorker('previa_worker_fila_inicio', {
      ...rastreio,
      fila_id: filaId,
      espera_fila_ms: Number((performance.now() - enfileiradoEm).toFixed(3))
    });
    return executarNoWorker(payload, rastreio, filaId, deps);
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

module.exports = { gerarPreviaDistribuicaoNoWorker, WORKER_TIMEOUT_MS };
