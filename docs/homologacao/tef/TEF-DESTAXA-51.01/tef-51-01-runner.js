'use strict';

/**
 * TEF-DESTAXA-51.01 — única chamada autorizada:
 * DestaxaRealAdapter.testarConexao() → INIT_CLIENT / iniciaClientDestaxa
 *
 * Proibido: CRT, TX_*, CONTINUE, FINALIZE, CPF, CST, PIX, gate=1, retry.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT_DIR = __dirname;
const RESULT_FILE = path.join(OUT_DIR, 'resultado-chamada.json');
const STDOUT_FILE = path.join(OUT_DIR, 'runner-stdout.jsonl');

const DestaxaRealAdapter = require(path.join(
  ROOT, 'backend', 'services', 'tef', 'adapters', 'DestaxaRealAdapter'
));
const destaxaLogger = require(path.join(
  ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaLogger'
));
const { EXECUTION_NOTE } = (() => ({ EXECUTION_NOTE: 'TEF-DESTAXA-51.01' }))();

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

function appendStdout(registro) {
  const linha = `${JSON.stringify(registro)}\n`;
  fs.appendFileSync(STDOUT_FILE, linha, 'utf8');
  process.stdout.write(linha);
}

function gravarResultado(payload) {
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function confirmarGateOff() {
  const raw = process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
  const normalizado = raw == null ? '' : String(raw).trim();
  if (normalizado === '1') {
    throw new Error('ABORT: DESTAXA_REAL_TRANSACTION_ENABLED=1 — chamada não autorizada');
  }
  // Garantir literal OFF neste processo (não altera User/Machine).
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  return { raw: raw == null ? null : String(raw), efetivo: '0' };
}

async function executar() {
  const inicioIso = new Date().toISOString();
  const gate = confirmarGateOff();
  const obsPath = destaxaLogger.obterArquivoAuditoria();

  appendStdout({
    event: 'preflight.runner',
    sprint: 'TEF-DESTAXA-51.01',
    inicioIso,
    pidPai: process.pid,
    electron: process.versions.electron || null,
    node: process.versions.node,
    arch: process.arch,
    gate,
    observabilityPath: obsPath
  });

  await app.whenReady();

  // executionMode in-process: testarConexao() → DestaxaNativeBridge.iniciarClient
  // → iniciaClientDestaxa. Sem TX_*. NativeHost não é necessário para esta chamada.
  const adapter = new DestaxaRealAdapter(
    {
      provedor: 'destaxa',
      ambiente: 'homologacao'
    },
    { executionMode: 'in-process' }
  );

  appendStdout({
    event: 'call.start',
    method: 'DestaxaRealAdapter.testarConexao',
    execucaoNativa: adapter.execucaoNativa,
    bridge: adapter.bridge?.constructor?.name || null,
    startedAt: new Date().toISOString()
  });

  const t0 = process.hrtime.bigint();
  let resposta = null;
  let erro = null;
  try {
    resposta = await adapter.testarConexao();
  } catch (error) {
    erro = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      code: error?.code || error?.codigo || null
    };
  }
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const fimIso = new Date().toISOString();

  // Encerrar imediatamente após INIT — unload só libera recursos; não chama TX.
  try {
    if (adapter.bridge && typeof adapter.bridge.unload === 'function') {
      adapter.bridge.unload();
    }
  } catch (_) { /* ignore */ }

  const detalhes = resposta?.detalhes || {};
  const resultado = {
    sprint: 'TEF-DESTAXA-51.01',
    authorizedMethod: 'DestaxaRealAdapter.testarConexao',
    inicioIso,
    fimIso,
    durationMs,
    pidPai: process.pid,
    nativeHostPid: null,
    nativeHostIniciado: false,
    execucaoNativa: adapter.execucaoNativa,
    gate,
    sucesso: resposta?.sucesso === true,
    mensagem: resposta?.mensagem || null,
    codigoDestaxa: detalhes.codigoDestaxa || detalhes.clientResultCode || null,
    estado: detalhes.estado || null,
    entrada: detalhes.entrada || null,
    tamanhoEntrada: detalhes.tamanhoEntrada || null,
    dllLoaded: detalhes.dllLoaded === true,
    exportsValid: detalhes.exportsValid === true,
    clientInitialized: detalhes.clientInitialized === true,
    dllPath: detalhes.dllPath || null,
    exception: erro,
    observabilityPath: obsPath,
    note: EXECUTION_NOTE
  };

  appendStdout({ event: 'call.end', ...resultado });
  gravarResultado(resultado);

  // Exit code: 0=sucesso API, 2=retorno Destaxa não-00, 1=exceção
  if (erro) return 1;
  if (resultado.sucesso && resultado.codigoDestaxa === '00') return 0;
  return 2;
}

executar()
  .then((code) => {
    appendStdout({ event: 'runner.exit', code, at: new Date().toISOString() });
    app.exit(code);
  })
  .catch((error) => {
    appendStdout({
      event: 'runner.fatal',
      message: error.message,
      code: error.code || null,
      at: new Date().toISOString()
    });
    gravarResultado({
      sprint: 'TEF-DESTAXA-51.01',
      sucesso: false,
      exception: { message: error.message, code: error.code || null }
    });
    app.exit(1);
  });
