/**
 * TEF-DESTAXA-07-PREP — pré-voo da primeira transação real de R$1,00.
 *
 * Somente checagem: executa fixtures/tef-07-prep-electron-main.js no Electron do CDS
 * (Main + TEF Native Host em utilityProcess com tripwire) e avalia o checklist.
 * Função nativa permitida: iniciaClientDestaxa. Proibido: iniciaTransacaoDestaxa /
 * continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais. Gate permanece fechado.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada no 07-PREP`);
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixtures', 'tef-07-prep-electron-main.js');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-07-prep-report.json');
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const itens = [];
async function item(numero, nome, fn) {
  try {
    await fn();
    itens.push({ numero, nome, ok: true });
    console.log(`  OK  ${numero}. ${nome}`);
  } catch (error) {
    itens.push({ numero, nome, ok: false, erro: error.message });
    console.error(`  FALHOU  ${numero}. ${nome}`);
    console.error(`         ${error.message}`);
  }
}

const MARCADORES_FALHA_STDIO = Object.freeze({
  epipe: /EPIPE/,
  uncaughtException: /uncaught\s*exception/i,
  mainProcessError: /A JavaScript error occurred in the main process/i
});
const LIMITE_ELECTRON_MS = 240000;

/**
 * stdout/stderr do Electron em pipe, consumidos continuamente até o evento
 * 'close' (processo encerrado E os dois streams fechados). O pai nunca fecha o
 * pipe antes do filho: o único kill() é o limite de tempo, registrado como falha.
 */
function executarNoElectron() {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const filho = spawn(require('electron'), [FIXTURE], {
      cwd: RAIZ,
      env: { ...process.env, [REAL_TRANSACTION_ENV]: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const fluxos = {
      stdout: { texto: '', linhas: 0, bytes: 0, fechadoEm: null },
      stderr: { texto: '', linhas: 0, bytes: 0, fechadoEm: null }
    };
    for (const nome of ['stdout', 'stderr']) {
      filho[nome].setEncoding('utf8');
      filho[nome].on('data', (chunk) => {
        fluxos[nome].texto += chunk;
        fluxos[nome].bytes += Buffer.byteLength(chunk);
        fluxos[nome].linhas += (chunk.match(/\n/g) || []).length;
      });
      filho[nome].on('end', () => { fluxos[nome].fechadoEm = Date.now() - inicio; });
    }
    let encerradoEm = null;
    let motivo = 'exit';
    filho.on('exit', () => { encerradoEm = Date.now() - inicio; });
    const limite = setTimeout(() => {
      motivo = 'timeout';
      filho.kill();
    }, LIMITE_ELECTRON_MS);
    filho.on('error', (error) => {
      clearTimeout(limite);
      reject(error);
    });
    filho.on('close', (exitCode, signal) => {
      clearTimeout(limite);
      const combinado = `${fluxos.stdout.texto}\n${fluxos.stderr.texto}`;
      const stdio = {
        spawn: "child_process.spawn(electron, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] })",
        stdout: { linhas: fluxos.stdout.linhas, bytes: fluxos.stdout.bytes, fechadoAposMs: fluxos.stdout.fechadoEm },
        stderr: { linhas: fluxos.stderr.linhas, bytes: fluxos.stderr.bytes, fechadoAposMs: fluxos.stderr.fechadoEm },
        exitCode,
        signal,
        motivoEncerramento: motivo,
        processoEncerradoAposMs: encerradoEm,
        closeAposMs: Date.now() - inicio,
        ocorrencias: Object.fromEntries(Object.entries(MARCADORES_FALHA_STDIO).map(([k, re]) => [k, (combinado.match(new RegExp(re.source, `${re.flags}g`)) || []).length]))
      };
      const linha = fluxos.stdout.texto.split(/\r?\n/).filter((l) => l.startsWith('@@PREP07 ')).pop();
      if (!linha) {
        return reject(new Error(`Electron sem resultado (exit ${exitCode}, ${motivo}): ${combinado.slice(-1500)}`));
      }
      const resultado = JSON.parse(linha.slice('@@PREP07 '.length));
      if (!resultado.ok) return reject(new Error(`coleta falhou no Electron: ${resultado.erro}`));
      return resolve({ dados: resultado.dados, exitCode, stdio });
    });
  });
}

async function main() {
  console.log('\nTEF-DESTAXA-07-PREP — PRÉ-VOO R$1,00 (sem transação)\n');
  const { dados: d, exitCode, stdio } = await executarNoElectron();
  const checks = d.preparacao.checks;
  const host = d.nativeHost;

  await item(1, 'PROCESSO: Electron 22.3.27 / Node 16.17.1 / ABI 110 / win32 x64', () => {
    assert.deepStrictEqual(
      [d.runtime.electron, d.runtime.node, d.runtime.abi, d.runtime.platform, d.runtime.arch],
      ['22.3.27', '16.17.1', '110', 'win32', 'x64']
    );
    assert.strictEqual(exitCode, 0);
  });

  await item(2, 'CONFIGURAÇÃO (banco): destaxa / homologacao / real / PPC930 / COM3', () => {
    const c = d.configuracao;
    assert.strictEqual(c.linha.provedor, 'destaxa');
    assert.strictEqual(c.linha.ambiente, 'homologacao');
    assert.strictEqual(c.tefProvedor, 'destaxa');
    assert.strictEqual(c.tefAmbiente, 'homologacao');
    assert.strictEqual(c.tefModo, 'real');
    assert.match(String(c.pinpadModelo), /PPC\s*_?930/i);
    assert.strictEqual(c.portaCom, 'COM3');
    assert.strictEqual(c.validacaoModoReal.valida, true, c.validacaoModoReal.pendencias.join('; '));
  });

  await item(3, 'FACTORY: destaxa + homologacao + real → DestaxaRealAdapter, sem fallback', () => {
    assert.strictEqual(d.factory.classe, 'DestaxaRealAdapter');
    assert.strictEqual(d.factory.instanciaReal, true);
    assert.strictEqual(d.factory.modo, 'real');
    assert.strictEqual(d.factory.execucaoNativa, 'native-host');
    assert.strictEqual(d.factory.semFallbackQuandoIndisponivel, 'DESTAXA_REAL_ADAPTER_INDISPONIVEL');
  });

  await item(4, 'DLL: x64, 4 exports, SHA-256 esperado, Koffi disponível', () => {
    assert.strictEqual(d.dll.arch, 'x64');
    assert.strictEqual(d.dll.sha256, d.dll.sha256Esperado);
    assert.strictEqual(d.dll.tamanho, d.dll.tamanhoEsperado);
    assert.strictEqual(d.dll.koffiDisponivel, true);
    assert.strictEqual(d.dll.disponibilidade.disponivel, true);
    assert.strictEqual(checks.dll.loaded, true);
    assert.strictEqual(checks.dll.exports, 4);
    assert.strictEqual(checks.dll.exportsValid, true);
  });

  await item(5, 'CLIENT: iniciaClientDestaxa() → 00 (única função nativa chamada)', () => {
    assert.strictEqual(checks.client.clientInitializationCode, '00');
    assert.strictEqual(checks.client.state, 'CLIENT_INITIALIZED');
    assert.deepStrictEqual(d.operacoesNativasUsadas, ['LOAD', 'INIT_CLIENT (iniciaClientDestaxa)', 'STATUS', 'PING']);
  });

  await item(6, 'VSPAGUE: VSPagueClient ativo e respondendo', () => {
    assert.strictEqual(checks.vspague.found, true);
    assert.strictEqual(checks.vspague.running, true);
    assert.strictEqual(checks.vspague.responding, true);
  });

  await item(7, 'PINPAD: Gertec PPC930 USB VID 1753 / PID C902 em COM3, PnP OK', () => {
    assert.strictEqual(d.pinpad.checks.detected, true);
    assert.strictEqual(d.pinpad.checks.port, 'COM3');
    assert.strictEqual(d.pinpad.checks.usb, true);
    const dispositivo = d.pinpad.usb.find((u) => u.vid === '1753' && u.pid === 'C902');
    assert.ok(dispositivo, 'VID_1753&PID_C902 ausente');
    assert.strictEqual(dispositivo.status, 'OK');
    assert.match(dispositivo.nome, /\(COM3\)/);
  });

  await item(8, 'NATIVE HOST: utilityProcess, Main sem DLL, IPC ok, Main responsivo, nenhuma TX em voo', () => {
    assert.strictEqual(host.processType, 'utilityProcess');
    assert.strictEqual(host.estado, 'READY');
    assert.notStrictEqual(host.pid, host.mainPid);
    assert.strictEqual(host.versions.electron, '22.3.27');
    assert.strictEqual(host.cargasDllMain, 0);
    assert.strictEqual(host.contadores.dllLoads, 1);
    assert.strictEqual(host.ipcPing, true);
    assert.strictEqual(host.emVoo, null);
    assert.strictEqual(host.reconciliacaoPendente, null);
    assert.ok(host.mainResponsivo.maiorIntervaloForaDetectorMs < 250, `event loop do Main bloqueado ${host.mainResponsivo.maiorIntervaloForaDetectorMs}ms fora da detecção`);
  });

  await item(9, "LOCK: nenhuma tef_transacoes com status='pendente'", () => {
    assert.strictEqual(d.banco.antes.pendentes, 0);
    assert.strictEqual(d.banco.depois.pendentes, 0);
  });

  await item(10, 'TRANSACTION ID: nenhum criado no PREP (somente na autorização)', () => {
    assert.strictEqual(d.preparacao.transacaoId, null);
    assert.strictEqual(d.preparacao.transactionAttempted, false);
    assert.strictEqual(d.banco.depois.total, d.banco.antes.total);
  });

  await item(11, 'VALOR: 100 centavos → "1.00"; 100, 1, R$100 e demais recusados', () => {
    assert.strictEqual(d.valor.internoCentavos, 100);
    assert.strictEqual(d.valor.destaxa, '1.00');
    assert.strictEqual(d.valor.entradaCrt, 'transacao_valor=1.00');
    assert.strictEqual(d.valor.builder, 'transacao_valor=1.00');
    assert.ok(Object.values(d.valor.recusas).every((c) => c === 'DESTAXA_VALOR_NAO_PERMITIDO'));
    assert.ok(Object.values(d.valor.formatoRecusado).every((c) => c === 'DESTAXA_VALOR_NAO_PERMITIDO'));
  });

  await item(12, 'OPERAÇÃO: somente CRT', () => {
    assert.strictEqual(checks.operation, 'CRT');
    assert.strictEqual(d.operacao.operacao, 'CRT');
    assert.deepStrictEqual(d.operacao.permitidas, ['CRT']);
  });

  await item(13, 'TENTATIVAS: 1 tentativa efetiva, sem retry automático', () => {
    assert.strictEqual(d.tentativas.efetivas, 1);
    assert.strictEqual(d.tentativas.retryAllowed, false);
  });

  await item(14, 'TIMEOUT: TEF_TIMEOUT_MS inalterado; nenhum timeout Destaxa inventado', () => {
    assert.strictEqual(d.timeout.envTefTimeoutMs, null);
    assert.strictEqual(d.timeout.tefManagerMs, 30000);
    assert.strictEqual(d.timeout.destaxaGlobal, 'DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO');
    assert.strictEqual(d.timeout.ipcTransacional, null);
    assert.strictEqual(d.factory.contratoTimeout.resultadoTardio, true);
    assert.strictEqual(d.factory.contratoTimeout.cancelamentoFisico, false);
  });

  await item(15, 'INTERAÇÃO 99: DISPLAY / COLETA / OPÇÃO sem erro', () => {
    const p = d.interacao99.passos;
    assert.deepStrictEqual(p.map((x) => x.estado), ['DISPLAY', 'COLLECT', 'OPTION', 'SUCCESS']);
    assert.ok(p.slice(0, 3).every((x) => x.codigo === '99' && x.classificacao === 'ACTION_REQUIRED' && !x.erro));
  });

  await item(16, 'RESULTADOS: 00/03/08/A0/A1 com retryAllowed=false', () => {
    const r = d.resultados;
    assert.strictEqual(r['00'].classificacao, 'SUCCESS');
    assert.strictEqual(r['03'].financialState, 'CONFIRMED_DENIED');
    assert.strictEqual(r['08'].financialState, 'UNKNOWN');
    assert.strictEqual(r.A0.financialState, 'UNCONFIRMED');
    assert.strictEqual(r.A1.financialState, 'BLOCKED');
    assert.ok(Object.values(r).every((x) => x.retryAllowed === false));
  });

  await item(17, 'RESTART: nenhuma pendência recuperada', () => {
    assert.strictEqual(d.lock.travaRecuperada, null);
    assert.strictEqual(d.lock.pendenciasEmMemoria, 0);
  });

  await item(18, 'BANCO: contagem registrada, nenhum registro criado', () => {
    assert.deepStrictEqual(d.banco.depois, d.banco.antes);
  });

  await item(19, 'TRIPWIRE: inicia/continua/finaliza = 0 durante todo o PREP', () => {
    assert.strictEqual(host.tripwire, true);
    assert.strictEqual(host.modoTeste, false);
    assert.deepStrictEqual([host.contadores.inicia, host.contadores.continua, host.contadores.finaliza], [0, 0, 0]);
  });

  await item(20, 'GATE: DESTAXA_REAL_TRANSACTION_ENABLED = OFF', () => {
    assert.strictEqual(d.gate.habilitado, false);
    assert.strictEqual(host.gateRealNoHost, false);
    assert.strictEqual(d.preparacao.codigo, 'DESTAXA_REAL_TRANSACTION_DISABLED');
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  await item(21, 'STDIO: logs do Electron consumidos até o fim; EPIPE / uncaughtException / erro no main = 0', () => {
    assert.deepStrictEqual(stdio.ocorrencias, { epipe: 0, uncaughtException: 0, mainProcessError: 0 });
    assert.ok(stdio.stdout.linhas > 1, 'logs normais do Electron não chegaram ao harness');
    assert.notStrictEqual(stdio.stdout.fechadoAposMs, null);
    assert.notStrictEqual(stdio.stderr.fechadoAposMs, null);
    assert.strictEqual(stdio.motivoEncerramento, 'exit');
    assert.strictEqual(stdio.exitCode, 0);
  });

  const falhas = itens.filter((i) => !i.ok);
  const pronto = falhas.length === 0;
  const observacoes = [];
  if (Number(d.configuracao.tefTentativasPersistido) !== 1) {
    observacoes.push(`tef_configuracao.tentativas=${d.configuracao.tefTentativasPersistido} persistido, não consumido pela autorização (tefRetryService.autorizarComRetry executa 1 tentativa); valor não alterado pelo PREP`);
  }
  if (host.mainResponsivo.detectorSincrono.length) {
    observacoes.push(`sdkDetector (VSPague/PPC930) usa PowerShell síncrono no Main durante prepararAutorizacao: ${host.mainResponsivo.detectorSincrono.map((j) => `${j.nome} ${j.bloqueioMs}ms`).join(', ')}; ocorre antes do timer da autorização e fora da chamada nativa (pré-existente, TEF-02)`);
  }

  const relatorio = {
    sprint: 'TEF-DESTAXA-07-PREP',
    dataHora: new Date().toISOString(),
    transactionExecuted: false,
    electron: d.runtime.electron,
    node: d.runtime.node,
    abi: d.runtime.abi,
    platform: `${d.runtime.platform}/${d.runtime.arch}`,
    provider: d.configuracao.tefProvedor,
    ambiente: d.configuracao.tefAmbiente,
    modo: d.configuracao.tefModo,
    adapter: { classe: d.factory.classe, modo: d.factory.modo, execucaoNativa: d.factory.execucaoNativa, semFallback: d.factory.semFallbackQuandoIndisponivel },
    dll: { path: d.dll.path, arch: d.dll.arch, versaoPacote: d.dll.versaoPacote, tamanho: d.dll.tamanho, sha256: d.dll.sha256, sha256Esperado: d.dll.sha256Esperado, koffi: d.dll.koffiDisponivel },
    exports: checks.dll.exports,
    client00: { codigo: checks.client.clientInitializationCode, estado: checks.client.state },
    vspague: checks.vspague,
    ppc930: { modelo: checks.pinpad.model, usb: d.pinpad.usb, deteccao: checks.pinpad },
    com3: { configurada: d.configuracao.portaCom, detectada: checks.pinpad.port },
    nativeHost: {
      processType: host.processType,
      pid: host.pid,
      mainPid: host.mainPid,
      versions: host.versions,
      estado: host.estado,
      cargasDllMain: host.cargasDllMain,
      emVoo: host.emVoo,
      mainResponsivo: host.mainResponsivo
    },
    ipc: { ping: host.ipcPing, protocolo: 'cds-tef-native-host/1' },
    lock: { pendentes: d.banco.antes.pendentes, travaRecuperada: d.lock.travaRecuperada },
    banco: { antes: d.banco.antes, depois: d.banco.depois, configuracao: d.configuracao.linha, configuracaoAlterada: false },
    pendencias: d.banco.antes.pendentes,
    valorConfigurado: { centavos: d.valor.internoCentavos, destaxa: d.valor.destaxa, entradaCrt: d.valor.entradaCrt, recusados: { ...d.valor.recusas, ...d.valor.formatoRecusado } },
    operacaoCRT: { operacao: d.operacao.operacao, permitidas: d.operacao.permitidas, bloqueadas: d.operacao.naoPermitidas },
    attempts: { efetivas: d.tentativas.efetivas, retryAllowed: d.tentativas.retryAllowed, persistidoNaoConsumido: d.tentativas.persistidoNaoConsumido },
    timeout: d.timeout,
    interacao99: d.interacao99,
    resultados: d.resultados,
    tripwire: { ativo: host.tripwire, iniciaTransacaoDestaxa: host.contadores.inicia, continuaTransacaoDestaxa: host.contadores.continua, finalizaTransacaoDestaxa: host.contadores.finaliza },
    gate: { env: REAL_TRANSACTION_ENV, estado: d.gate.habilitado ? 'ON' : 'OFF', bloqueio: d.preparacao.codigo },
    funcoesNativasChamadas: d.operacoesNativasUsadas,
    harnessStdio: stdio,
    checklist: itens,
    observacoes,
    result: pronto ? 'READY_FOR_REAL_R$1' : 'BLOCKED_FOR_REAL_TRANSACTION'
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  for (const o of observacoes) console.log(`  OBS  ${o}`);
  console.log(`\nRelatório: ${path.relative(RAIZ, RELATORIO)} → ${relatorio.result}`);
  console.log(`\nResultado: ${itens.length - falhas.length} ok, ${falhas.length} falhou\n`);
  process.exit(pronto ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  const relatorio = { sprint: 'TEF-DESTAXA-07-PREP', dataHora: new Date().toISOString(), transactionExecuted: false, erro: error.message, checklist: itens, result: 'BLOCKED_FOR_REAL_TRANSACTION' };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  process.exit(1);
});
