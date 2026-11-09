'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const destaxaLogger = require('../../backend/services/tef/destaxa/destaxaLogger');
const {
  DestaxaNativeHostClient,
  ESTADOS_CLIENTE,
  CLASSIFICACAO_ENCERRAMENTO
} = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const {
  criarResponse,
  ERROS_HOST,
  OPERACOES_HOST
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt-50-56-'));
const arquivoLog = path.join(diretorioTemporario, 'observability.jsonl');
destaxaLogger.configurarArquivoAuditoria(arquivoLog);

function lerEventos() {
  return fs.readFileSync(arquivoLog, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((linha) => JSON.parse(linha));
}

function criarClientePronto(pid, enviar) {
  const client = new DestaxaNativeHostClient();
  client._estado = ESTADOS_CLIENTE.READY;
  client._info = { pid };
  client._processo = { pid, enviar, matar() {} };
  return client;
}

async function main() {
  try {
    const ordem = [];
    const chamada = destaxaLogger.executarChamadaNativaAuditada({
      requestId: 'native-return-1',
      pid: 4321,
      functionName: 'iniciaClientDestaxa',
      fn() {
        ordem.push('native');
        const antesDoRetorno = lerEventos();
        assert.strictEqual(antesDoRetorno.length, 1);
        assert.strictEqual(antesDoRetorno[0].evento, 'native.call.enter');
      },
      obterCodigoResultado: () => '00'
    });
    ordem.push('after');
    assert.deepStrictEqual(ordem, ['native', 'after']);
    let eventos = lerEventos();
    assert.strictEqual(eventos[0].requestId, 'native-return-1');
    assert.strictEqual(eventos[0].pid, 4321);
    assert.strictEqual(eventos[0].functionName, 'iniciaClientDestaxa');
    assert.strictEqual(eventos[0].entryConfirmed, true);
    assert.strictEqual(eventos[1].evento, 'native.call.return');
    assert.strictEqual(eventos[1].resultCode, '00');
    assert.deepStrictEqual(eventos[1].result, { code: '00' });
    assert.ok(eventos[1].returnedAt);
    assert.ok(eventos[1].durationMs >= 0);
    assert.strictEqual(chamada.resultCode, '00');

    assert.throws(() => destaxaLogger.executarChamadaNativaAuditada({
      requestId: 'native-exception-1',
      functionName: 'iniciaClientDestaxa',
      fn() {
        throw Object.assign(new Error('password=do-not-log'), { code: 'SIMULATED' });
      }
    }), /password=do-not-log/);
    eventos = lerEventos();
    const excecao = eventos.find((evento) => evento.evento === 'native.call.exception');
    assert.strictEqual(excecao.requestId, 'native-exception-1');
    assert.strictEqual(excecao.exception.code, 'SIMULATED');

    const enviados = [];
    const client = criarClientePronto(5001, (req) => enviados.push(req));
    const timeout = await client.enviar(OPERACOES_HOST.LOAD, {}, { timeoutMs: 10 });
    assert.strictEqual(timeout.error.code, ERROS_HOST.HOST_TIMEOUT);
    assert.strictEqual(timeout.requestId, enviados[0].requestId);
    const chamadaSeguinte = await client.enviar(OPERACOES_HOST.LOAD);
    assert.strictEqual(chamadaSeguinte.error.code, ERROS_HOST.HOST_BUSY);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(client._emVoo.req.requestId, timeout.requestId);
    eventos = lerEventos();
    const timeoutRegistrado = eventos.find((evento) =>
      evento.evento === 'nativehost.client.lifecycle' && evento.tipo === 'ipc.timeout');
    assert.strictEqual(timeoutRegistrado.requestId, timeout.requestId);
    assert.strictEqual(timeoutRegistrado.nativeCallCancelled, false);
    assert.strictEqual(timeoutRegistrado.lockHeld, true);

    client._aoMensagem(criarResponse(enviados[0], { output: { sucesso: true } }));
    const cleanup = criarClientePronto(5002, (req) => {
      if (req.operation !== OPERACOES_HOST.SHUTDOWN) return;
      cleanup._aoMensagem(criarResponse(req, { output: { encerrando: true } }));
      cleanup._aoSair(0, null);
    });
    const encerramento = await cleanup.encerrar({ aguardarMs: 20 });
    assert.strictEqual(encerramento.estado, ESTADOS_CLIENTE.STOPPED);
    eventos = lerEventos();
    const resultadoShutdown = eventos.find((evento) =>
      evento.evento === 'nativehost.client.lifecycle'
      && evento.tipo === 'shutdown.result'
      && evento.stoppedConfirmed === true);
    assert.ok(resultadoShutdown);
    const saidaNormal = eventos.find((evento) =>
      evento.evento === 'nativehost.client.lifecycle'
      && evento.tipo === 'host.exit'
      && evento.pidHost === 5002);
    assert.ok(saidaNormal);
    assert.ok(Number.isFinite(Date.parse(saidaNormal.horarioSaida)));

    const crash = criarClientePronto(5003, () => {});
    crash._emVoo = {
      req: { requestId: 'crash-before-response', operation: OPERACOES_HOST.INIT_CLIENT },
      inicio: Date.now(),
      expirado: false,
      resolve: null,
      timer: null
    };
    crash._aoSair(1, null);
    assert.strictEqual(crash._estado, ESTADOS_CLIENTE.CRASHED);
    eventos = lerEventos();
    const saidaCrash = eventos.find((evento) =>
      evento.evento === 'nativehost.client.lifecycle'
      && evento.tipo === 'host.exit'
      && evento.requestId === 'crash-before-response');
    assert.strictEqual(saidaCrash.classificacaoEncerramento, CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST);
    assert.strictEqual(saidaCrash.responseReceivedBeforeExit, false);
    assert.ok(eventos.some((evento) =>
      evento.evento === 'nativehost.client.lifecycle'
      && evento.tipo === 'ipc.process.exit.before_response'
      && evento.requestId === 'crash-before-response'
      && evento.responseReceived === false));

    const indeterminado = criarClientePronto(5004, () => {});
    indeterminado._estado = ESTADOS_CLIENTE.SHUTTING_DOWN;
    indeterminado._shutdownRequestId = 'shutdown-without-ack';
    indeterminado._aoSair(0, null);
    assert.strictEqual(indeterminado._estado, ESTADOS_CLIENTE.CRASHED);
    assert.strictEqual(
      indeterminado.getEstado().ultimaSaida.classificacaoEncerramento,
      CLASSIFICACAO_ENCERRAMENTO.ESTADO_INDETERMINADO
    );

    destaxaLogger.registrarPersistente('credential.test', {
      apiKey: 'sensitive-api-key',
      mensagem: 'password=credential-value',
      resultado: 'safe'
    });
    const conteudoLog = fs.readFileSync(arquivoLog, 'utf8');
    assert.ok(!conteudoLog.includes('sensitive-api-key'));
    assert.ok(!conteudoLog.includes('credential-value'));
    assert.ok(!conteudoLog.includes('do-not-log'));

    const ids = new Set(eventos.filter((evento) => evento.requestId).map((evento) => evento.requestId));
    assert.ok(ids.has(timeout.requestId));
    assert.ok(eventos.some((evento) =>
      evento.evento === 'nativehost.client.lifecycle'
      && evento.tipo === 'ipc.message.sent'
      && evento.requestId === timeout.requestId));
    assert.ok(eventos.some((evento) =>
      evento.evento === 'nativehost.client.lifecycle'
      && evento.tipo === 'ipc.response.received'
      && evento.requestId === enviados[0].requestId));
    console.log('MRT-50.56 instrumentação persistente validada com funções e IPC simulados; nenhuma DLL/NativeHost foi executada.');
  } finally {
    destaxaLogger.limparArquivoAuditoriaConfigurado();
    fs.rmSync(diretorioTemporario, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
