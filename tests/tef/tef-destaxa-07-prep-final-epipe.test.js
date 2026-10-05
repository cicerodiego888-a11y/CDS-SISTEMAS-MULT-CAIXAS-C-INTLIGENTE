/**
 * TEF-DESTAXA-07-PREP-FINAL-EPIPE — prova independente de que o EPIPE não ocorre
 * e não está oculto.
 *
 * 1. Controle do mecanismo (Electron em modo Node, script mínimo, sem TEF):
 *    leitor que fecha o pipe cedo → EPIPE não tratado no filho (reproduz a falha);
 *    leitor que consome até o fim → nenhuma falha, todas as linhas recebidas.
 * 2. npm run test:tef-destaxa-07-prep N vezes, stdout/stderr consumidos até 'close'.
 * 3. Banco oficial (somente leitura), diffs de electron.js/package.json, regressões.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada`);
  process.exit(2);
}

const sqlite3 = require('sqlite3');
const RAIZ = path.resolve(__dirname, '../..');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-07-prep-final-epipe-report.json');
const RELATORIO_PREP = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-07-prep-report.json');
const RELATORIO_PERSISTENCIA = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-06c-persistencia-report.json');
const BANCO_OFICIAL = path.join(process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados'), 'mercadao.db');
const EXECUCOES = Number(process.env.TEF_07_EPIPE_EXECUCOES) || 8;
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const MARCADORES = Object.freeze({
  epipe: /EPIPE/g,
  uncaughtException: /uncaught\s*exception/gi,
  mainProcessError: /A JavaScript error occurred in the main process/gi
});

const MODULOS_TEF_PRODUTIVOS = [
  'backend/services/tef/TefManager.js',
  'backend/services/tef/adapters/DestaxaRealAdapter.js',
  'backend/services/tef/destaxa/DestaxaNativeHost.js',
  'backend/services/tef/destaxa/DestaxaNativeHostClient.js',
  'backend/services/tef/destaxa/DestaxaHostBridge.js',
  'backend/services/tef/destaxa/DestaxaNativeBridge.js',
  'backend/services/tef/destaxa/destaxaNativeHostProtocolo.js',
  'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
  'backend/services/tef/destaxa/destaxaProtocolo.js',
  'backend/services/tef/destaxa/destaxaConstantes.js',
  'backend/services/tef/tefRetryService.js',
  'backend/services/tef/tefRepository.js',
  'backend/services/tef/tefFinancialSafetyPolicy.js'
];

let passou = 0;
let falhou = 0;
const falhas = [];
async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    falhas.push(nome);
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function contar(texto) {
  return Object.fromEntries(Object.entries(MARCADORES).map(([k, re]) => [k, (texto.match(re) || []).length]));
}

/** Linhas de status do checklist ("  OK  21. ... EPIPE ...") citam os marcadores no título do item. */
const LINHA_CHECKLIST = /^\s*(OK|FALHOU)\s+\d+\.\s/;
function contarSaidaTeste(texto) {
  const linhas = texto.split(/\r?\n/);
  const checklist = linhas.filter((l) => LINHA_CHECKLIST.test(l));
  return {
    ocorrencias: contar(linhas.filter((l) => !LINHA_CHECKLIST.test(l)).join('\n')),
    linhasChecklistExcluidas: checklist.filter((l) => Object.values(contar(l)).some((n) => n > 0))
  };
}

/** Processo com stdout/stderr em pipe consumidos até 'close' (filho encerrado + streams fechados). */
function executar(comando, args, opcoes = {}) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const filho = spawn(comando, args, {
      cwd: RAIZ,
      env: { ...process.env, [REAL_TRANSACTION_ENV]: '0', ...(opcoes.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: opcoes.shell === true
    });
    const saida = { stdout: '', stderr: '' };
    const fechado = { stdout: false, stderr: false };
    for (const nome of ['stdout', 'stderr']) {
      filho[nome].setEncoding('utf8');
      filho[nome].on('data', (chunk) => {
        saida[nome] += chunk;
        if (nome === 'stdout' && opcoes.aoPrimeiraLinha && saida.stdout.includes('\n')) {
          const fn = opcoes.aoPrimeiraLinha;
          opcoes.aoPrimeiraLinha = null;
          fn(filho);
        }
      });
      filho[nome].on('close', () => { fechado[nome] = true; });
    }
    let motivo = 'exit';
    const limite = setTimeout(() => { motivo = 'timeout'; filho.kill(); }, opcoes.limiteMs || 600000);
    filho.on('error', (e) => { clearTimeout(limite); reject(e); });
    filho.on('close', (exitCode, signal) => {
      clearTimeout(limite);
      resolve({
        exitCode,
        signal,
        motivo,
        duracaoMs: Date.now() - inicio,
        stdout: saida.stdout,
        stderr: saida.stderr,
        linhasStdout: (saida.stdout.match(/\n/g) || []).length,
        linhasStderr: (saida.stderr.match(/\n/g) || []).length,
        streamsFechados: fechado
      });
    });
  });
}

async function consultarOficial() {
  const db = await new Promise((resolve, reject) => {
    const x = new sqlite3.Database(BANCO_OFICIAL, sqlite3.OPEN_READONLY, (e) => (e ? reject(e) : resolve(x)));
  });
  const todos = (sql) => new Promise((resolve, reject) => db.all(sql, [], (e, r) => (e ? reject(e) : resolve(r))));
  try {
    const porStatus = Object.fromEntries((await todos('SELECT status, COUNT(*) AS n FROM tef_transacoes GROUP BY status')).map((l) => [l.status, l.n]));
    const [cfg] = await todos('SELECT ambiente, provedor, tentativas, atualizado_em FROM tef_configuracao ORDER BY id LIMIT 1');
    return {
      total: Object.values(porStatus).reduce((s, n) => s + n, 0),
      pendentes: porStatus.pendente || 0,
      aprovadas: porStatus.aprovado || 0,
      negadas: porStatus.negado || 0,
      canceladas: porStatus.cancelado || 0,
      erros: porStatus.erro || 0,
      tefConfiguracao: cfg
    };
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

function hash(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, rel))).digest('hex');
}

function git(args) {
  return String(spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).stdout || '');
}

function linhasAdicionadas(diff) {
  const blocos = [];
  let atual = null;
  let linhaNova = 0;
  for (const l of diff.split(/\r?\n/)) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      linhaNova = Number(h[1]);
      atual = null;
      continue;
    }
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) {
      if (!atual) {
        atual = { de: linhaNova, ate: linhaNova, removidas: 0 };
        blocos.push(atual);
      }
      atual.ate = linhaNova;
      linhaNova += 1;
    } else if (l.startsWith('-')) {
      if (atual) atual.removidas += 1;
    } else if (l.startsWith(' ')) {
      atual = null;
      linhaNova += 1;
    }
  }
  return blocos;
}

async function main() {
  console.log('\nTEF-DESTAXA-07-PREP-FINAL-EPIPE\n');
  const inicioSprint = new Date().toISOString();
  const bancoAntes = await consultarOficial();
  const hashesAntes = Object.fromEntries(MODULOS_TEF_PRODUTIVOS.map((m) => [m, hash(m)]));
  const electronBin = require('electron');
  const SCRIPT_CONTROLE = "let i=0;const t=setInterval(()=>{console.log('linha-controle-'+(++i));if(i>=200)clearInterval(t);},5);";

  await test('gate: DESTAXA_REAL_TRANSACTION_ENABLED = OFF', () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  // ------------------------------------------------ controle do mecanismo
  const negativo = await executar(electronBin, ['-e', SCRIPT_CONTROLE], {
    env: { ELECTRON_RUN_AS_NODE: '1' },
    limiteMs: 60000,
    aoPrimeiraLinha: (filho) => filho.stdout.destroy()
  });
  const positivo = await executar(electronBin, ['-e', SCRIPT_CONTROLE], { env: { ELECTRON_RUN_AS_NODE: '1' }, limiteMs: 60000 });
  const controle = {
    runtime: 'Electron 22.3.27 com ELECTRON_RUN_AS_NODE=1 (mesmo Node 16.17.1; sem janela de diálogo)',
    script: 'console.log a cada 5ms, 200 linhas',
    leitorFechaPipeCedo: { exitCode: negativo.exitCode, ocorrencias: contar(negativo.stderr), stderr: negativo.stderr.split(/\r?\n/).filter((l) => /EPIPE|Error|at /.test(l)).slice(0, 6) },
    leitorConsomeAteClose: { exitCode: positivo.exitCode, linhasRecebidas: positivo.linhasStdout, ocorrencias: contar(`${positivo.stdout}\n${positivo.stderr}`) }
  };
  await test('controle: fechar o pipe antes do fim do filho reproduz EPIPE não tratado em console.log', () => {
    assert.notStrictEqual(negativo.exitCode, 0);
    assert.ok(controle.leitorFechaPipeCedo.ocorrencias.epipe > 0, negativo.stderr.slice(-800));
  });
  await test('controle: consumir stdout/stderr até close → 0 EPIPE e todas as linhas recebidas', () => {
    assert.strictEqual(positivo.exitCode, 0);
    assert.strictEqual(positivo.linhasStdout, 200);
    assert.deepStrictEqual(controle.leitorConsomeAteClose.ocorrencias, { epipe: 0, uncaughtException: 0, mainProcessError: 0 });
  });

  // ------------------------------------------------ execuções do 07-PREP
  const execucoes = [];
  for (let n = 1; n <= EXECUCOES; n += 1) {
    const r = await executar('npm run test:tef-destaxa-07-prep', [], { shell: true, limiteMs: 600000 });
    let prep = null;
    try { prep = JSON.parse(fs.readFileSync(RELATORIO_PREP, 'utf8')); } catch (_) { prep = null; }
    const harness = prep?.harnessStdio || null;
    const saidaNpm = contarSaidaTeste(`${r.stdout}\n${r.stderr}`);
    const ocorrenciasNpm = saidaNpm.ocorrencias;
    const ocorrenciasElectron = harness?.ocorrencias || null;
    const execucao = {
      execucao: n,
      resultado: r.exitCode === 0 && prep?.result === 'READY_FOR_REAL_R$1' ? 'PASS' : 'FAIL',
      exitCode: r.exitCode,
      duracaoMs: r.duracaoMs,
      epipe: ocorrenciasNpm.epipe + (ocorrenciasElectron?.epipe ?? 0),
      uncaughtException: ocorrenciasNpm.uncaughtException + (ocorrenciasElectron?.uncaughtException ?? 0),
      mainProcessError: ocorrenciasNpm.mainProcessError + (ocorrenciasElectron?.mainProcessError ?? 0),
      electron: harness && {
        exitCode: harness.exitCode,
        motivoEncerramento: harness.motivoEncerramento,
        stdoutLinhas: harness.stdout.linhas,
        stderrLinhas: harness.stderr.linhas,
        stdoutFechadoAposMs: harness.stdout.fechadoAposMs,
        stderrFechadoAposMs: harness.stderr.fechadoAposMs,
        closeAposMs: harness.closeAposMs
      },
      harnessNpm: {
        stdoutLinhas: r.linhasStdout,
        stderrLinhas: r.linhasStderr,
        streamsFechados: r.streamsFechados,
        ocorrencias: ocorrenciasNpm,
        linhasChecklistExcluidasDaVarredura: saidaNpm.linhasChecklistExcluidas
      },
      electronOcorrencias: ocorrenciasElectron,
      prepResult: prep?.result || null,
      tripwire: prep?.tripwire || null,
      client: prep?.client00?.codigo || null,
      gate: prep?.gate?.estado || null
    };
    execucoes.push(execucao);
    console.log(`  #${n} ${execucao.resultado} exit=${r.exitCode} ${r.duracaoMs}ms EPIPE=${execucao.epipe} uncaught=${execucao.uncaughtException} mainError=${execucao.mainProcessError} stdout=${harness?.stdout.linhas} stderr=${harness?.stderr.linhas}`);
  }

  await test(`07-PREP ${EXECUCOES}x consecutivas: PASS, EPIPE=0, uncaughtException=0, erro no main=0`, () => {
    for (const e of execucoes) {
      assert.strictEqual(e.resultado, 'PASS', `execução ${e.execucao}`);
      assert.deepStrictEqual([e.epipe, e.uncaughtException, e.mainProcessError], [0, 0, 0], `execução ${e.execucao}`);
    }
  });
  await test('logs normais do Electron chegam ao harness (stdout e stderr consumidos até o fechamento)', () => {
    for (const e of execucoes) {
      assert.ok(e.electron.stdoutLinhas > 1);
      assert.notStrictEqual(e.electron.stdoutFechadoAposMs, null);
      assert.notStrictEqual(e.electron.stderrFechadoAposMs, null);
      assert.strictEqual(e.electron.motivoEncerramento, 'exit');
      assert.strictEqual(e.electron.exitCode, 0);
    }
  });
  await test('tripwire 0/0/0, iniciaClientDestaxa = 00 e gate OFF em todas as execuções', () => {
    for (const e of execucoes) {
      assert.deepStrictEqual([e.tripwire.iniciaTransacaoDestaxa, e.tripwire.continuaTransacaoDestaxa, e.tripwire.finalizaTransacaoDestaxa], [0, 0, 0]);
      assert.strictEqual(e.tripwire.ativo, true);
      assert.strictEqual(e.client, '00');
      assert.strictEqual(e.gate, 'OFF');
    }
  });

  // ------------------------------------------------ electron.js / package.json
  const diffElectron = git(['--no-pager', 'diff', '--', 'electron.js']);
  const diffPackage = git(['--no-pager', 'diff', '--', 'package.json']);
  const blocosElectron = linhasAdicionadas(diffElectron);
  const scriptsPackage = diffPackage.split(/\r?\n/).filter((l) => /^\+\s+"test:/.test(l)).map((l) => l.slice(1).trim());
  const mtimeElectron = fs.statSync(path.join(RAIZ, 'electron.js')).mtime.toISOString();

  // ------------------------------------------------ regressões
  const regressoes = [];
  if (String(process.env.TEF_07_EPIPE_SKIP_REGRESSOES || '').trim() !== '1') {
    const scripts = [
      'test:tef-01', 'test:tef-02', 'test:tef-fluxo',
      'test:tef-destaxa-01', 'test:tef-destaxa-02', 'test:tef-destaxa-03',
      'test:tef-destaxa-prep-04b', 'test:tef-destaxa-05', 'test:tef-destaxa-06a',
      'test:tef-destaxa-06b', 'test:tef-destaxa-06c-prep', 'test:tef-destaxa-06c-mitigacao',
      'test:tef-destaxa-06c-timeout', 'test:tef-destaxa-06c-persistencia'
    ];
    for (const script of scripts) {
      const env = script === 'test:tef-destaxa-06a' ? { DESTAXA_REAL_HARNESS: '1' } : {};
      const r = await executar(`npm run ${script}`, [], { shell: true, env, limiteMs: 1800000 });
      const resumo = r.stdout.split(/\r?\n/).filter((l) => /RESULTADO|Resultado:/.test(l)).map((l) => l.trim());
      regressoes.push({ script, exitCode: r.exitCode, durationMs: r.duracaoMs, summary: resumo, ocorrencias: contarSaidaTeste(`${r.stdout}\n${r.stderr}`).ocorrencias });
      await test(`regressão ${script}`, () => {
        assert.strictEqual(r.exitCode, 0, r.stdout.split(/\r?\n/).filter((l) => /FALHOU/.test(l)).slice(0, 8).join('\n'));
      });
    }
  }

  // ------------------------------------------------ banco / módulos
  const bancoDepois = await consultarOficial();
  await test('banco oficial: nenhuma linha nova em tef_transacoes; pendentes = 0; ambiente homologacao inalterado', () => {
    assert.strictEqual(bancoDepois.total, bancoAntes.total);
    assert.strictEqual(bancoDepois.pendentes, 0);
    for (const k of ['aprovadas', 'negadas', 'canceladas', 'erros']) assert.strictEqual(bancoDepois[k], bancoAntes[k], k);
    assert.strictEqual(bancoDepois.tefConfiguracao.ambiente, 'homologacao');
    assert.deepStrictEqual(bancoDepois.tefConfiguracao, bancoAntes.tefConfiguracao);
  });

  const hashesDepois = Object.fromEntries(MODULOS_TEF_PRODUTIVOS.map((m) => [m, hash(m)]));
  let hostPersistencia = null;
  try { hostPersistencia = JSON.parse(fs.readFileSync(RELATORIO_PERSISTENCIA, 'utf8')).nativeHost.files; } catch (_) { hostPersistencia = null; }
  await test('módulos TEF produtivos inalterados (durante o sprint e Native Host idêntico ao certificado na 06C-PERSISTENCIA)', () => {
    assert.deepStrictEqual(hashesDepois, hashesAntes);
    assert.ok(hostPersistencia, 'relatório 06C-PERSISTENCIA ausente');
    for (const [rel, h] of Object.entries(hostPersistencia)) assert.strictEqual(hashesDepois[rel], h, rel);
  });

  const aprovado = falhou === 0;
  const relatorio = {
    sprint: 'TEF-DESTAXA-07-PREP-FINAL-EPIPE',
    inicio: inicioSprint,
    fim: new Date().toISOString(),
    transactionExecuted: false,
    rootCause: {
      summary: 'Leitor do stdout/stderr do Electron encerrado antes do processo: todo console.log do main passa a falhar com EPIPE (erro emitido no stream sem handler → exceção não tratada → diálogo "A JavaScript error occurred in the main process"). Os stacks em database.js, produtoEmbalagensSchema.js, migracaoF12Policy.js, tefConfigService.js, destaxaTransacaoOrquestrador.js e no fixture são apenas o primeiro console.log de cada módulo após o fechamento do pipe.',
      trigger: 'Execução ad hoc do fixture durante a construção do 07-PREP, direto pelo PowerShell (`& electron.exe tests/tef/fixtures/tef-07-prep-electron-main.js > arquivo 2>&1`): o comando retornou (~11 s) com arquivo de saída vazio, ou seja, nenhum leitor manteve o pipe durante a vida do Electron. O harness Node (spawnSync) nunca fechava o pipe antes do filho.',
      mechanismReproduced: controle,
      responsibleFile: 'tests/tef/fixtures/tef-07-prep-electron-main.js (invocado sem harness que mantivesse o pipe) + tests/tef/tef-destaxa-07-prep.test.js (lifecycle de stdio implícito em spawnSync, sem contagem nem verificação)',
      latentRaceFixed: 'fixture chamava app.exit() logo após process.stdout.write do resultado (sem aguardar o flush do pipe) — podia truncar a linha final; agora app.exit() somente no callback do write'
    },
    lifecycleAnterior: {
      harness: "spawnSync(electron, [fixture], { encoding: 'utf8', maxBuffer: 50MB, timeout: 240000 })",
      stdout: 'pipe implícito, acumulado pelo spawnSync; nenhuma contagem/verificação de EPIPE',
      stderr: 'pipe implícito, acumulado pelo spawnSync; nenhuma verificação',
      encerramento: 'app.exit() imediatamente após process.stdout.write (sem aguardar flush)',
      usoAdHoc: 'fixture também foi executado direto pelo PowerShell com redirecionamento, sem leitor durante a vida do processo'
    },
    lifecycleCorrigido: {
      harness: "child_process.spawn(electron, [fixture], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })",
      stdout: "setEncoding('utf8') + listener 'data' contínuo desde o spawn; linhas/bytes contados; 'end' registrado",
      stderr: "setEncoding('utf8') + listener 'data' contínuo desde o spawn; linhas/bytes contados; 'end' registrado",
      encerramento: "resultado avaliado somente no evento 'close' do ChildProcess (processo encerrado E stdout/stderr fechados); nenhum kill/destroy/removeAllListeners; único kill() = limite de 240 s, registrado como motivoEncerramento='timeout' (falha)",
      fixture: 'await process.stdout.write(resultado, callback) antes de app.exit()',
      verificacao: 'item 21 do 07-PREP falha se houver EPIPE, "uncaught exception" ou "A JavaScript error occurred in the main process" no stdout/stderr do Electron, se nenhum log normal chegar, ou se o encerramento não for exit 0',
      naoOcultado: 'nenhum uncaughtException handler, nenhum console.log substituído, nenhum try/catch em logs, nenhum descarte de stdout/stderr (stdio ignore somente no stdin, que o fixture não usa)'
    },
    executions: {
      total: EXECUCOES,
      consecutive: true,
      markerScan: 'Electron: stdout+stderr integrais (harnessStdio do 07-PREP). npm: stdout+stderr integrais exceto linhas de status do checklist ("OK|FALHOU N."), cujo título do item 21 cita os marcadores — primeira execução do sprint contou 1 falso positivo por execução exatamente nessa linha.',
      results: execucoes
    },
    electronJsDiff: {
      mtime: mtimeElectron,
      addedBlocks: blocosElectron,
      removedLines: (diffElectron.match(/^-(?!--)/gm) || []).length,
      contents: [
        { sprint: 'TEF-DESTAXA-06B', trecho: 'hook DESTAXA_CRT_PATH_CHECK + DESTAXA_CRT_PATH_CHECK_ELECTRON (DestaxaCrtRealPathVerifier no Electron)', necessarioPara: 'test:tef-destaxa-06b e test:tef-destaxa-06c-prep (regressões)' },
        { sprint: 'TEF-DESTAXA-06C-MITIGACAO', trecho: 'hook DESTAXA_NATIVE_HOST_CHECK + DESTAXA_NATIVE_HOST_CHECK_ELECTRON (destaxaNativeHostVerifier no Electron)', necessarioPara: 'test:tef-destaxa-06c-mitigacao (regressão)' },
        { sprint: 'TEF-DESTAXA-06C-MITIGACAO', trecho: "will-quit: encerra o TEF Native Host compartilhado (adiado com chamada nativa em voo)", necessarioPara: 'lifecycle produtivo do Native Host' }
      ],
      belongsTo07Prep: false,
      requiredBy07PrepHarness: false,
      note: 'o 07-PREP executa o fixture como entry point próprio do Electron; electron.js não foi alterado no 07-PREP nem neste sprint; nada revertido',
      raw: diffElectron
    },
    packageJsonDiff: {
      addedScripts: scriptsPackage,
      belongsTo07Prep: scriptsPackage.filter((s) => s.includes('07-prep')),
      otherChanges: diffPackage.split(/\r?\n/).filter((l) => /^[+-](?![+-])/.test(l) && !/^\+\s+"test:/.test(l)),
      raw: diffPackage
    },
    regressions: regressoes,
    database: { before: bancoAntes, after: bancoDepois, newTransactions: bancoDepois.total - bancoAntes.total, configurationChanged: false },
    tripwire: execucoes.map((e) => ({ execucao: e.execucao, ...e.tripwire })),
    gate: { env: REAL_TRANSACTION_ENV, estado: transacaoRealHabilitada() ? 'ON' : 'OFF', porExecucao: execucoes.map((e) => e.gate) },
    realTransactionalCalls: {
      iniciaTransacaoDestaxa: execucoes.reduce((s, e) => s + (e.tripwire?.iniciaTransacaoDestaxa || 0), 0),
      continuaTransacaoDestaxa: execucoes.reduce((s, e) => s + (e.tripwire?.continuaTransacaoDestaxa || 0), 0),
      finalizaTransacaoDestaxa: execucoes.reduce((s, e) => s + (e.tripwire?.finalizaTransacaoDestaxa || 0), 0),
      nativaPermitida: 'iniciaClientDestaxa → 00'
    },
    productionTefModules: { unchanged: JSON.stringify(hashesAntes) === JSON.stringify(hashesDepois), sha256: hashesDepois },
    tests: { passed: passou, failed: falhou, failures: falhas },
    conclusion: aprovado
      ? 'EPIPE reproduzido somente no controle (leitor fecha o pipe cedo) e ausente em todas as execuções do 07-PREP com stdout/stderr consumidos até o close; nada ocultado; gate OFF; 0/0/0; banco sem novas transações; regressões verdes.'
      : 'Critérios não atendidos — ver tests.failures.',
    result: aprovado ? 'READY_FOR_07_EXEC' : 'BLOCKED_FOR_07_EXEC'
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${path.relative(RAIZ, RELATORIO)} → ${relatorio.result}`);
  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(aprovado ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
