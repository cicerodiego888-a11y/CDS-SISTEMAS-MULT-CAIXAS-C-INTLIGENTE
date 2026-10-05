/**
 * TEF-DESTAXA-07B — testes do executor CRT controlado, SEM gate financeiro.
 *
 * 1. Núcleo do executor com dependências falsas (nenhum módulo TEF real, nenhuma DLL):
 *    pré-condições, confirmação, 99 DISPLAY/COLETA/OPÇÃO, 00/03/08/A0/A1, finalização,
 *    cancelamento, timeout, trava de segunda iniciaTransacaoDestaxa, sanitização.
 * 2. Pré-voo real no Electron (runner --preflight): gate OFF, tripwire no host,
 *    somente iniciaClientDestaxa; banco oficial somente leitura antes/depois.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada`);
  process.exit(2);
}

const sqlite3 = require('sqlite3');
const { executarCrt07b, sanitizarParametros, RESULTADOS, FRASE_CONFIRMACAO, SHA256_DLL } = require('../../scripts/tef/destaxa-07b/executorCrt07b');

const RAIZ = path.resolve(__dirname, '../..');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-07b-real-crt-report.json');
const BANCO_OFICIAL = path.join(process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados'), 'mercadao.db');

let passou = 0;
let falhou = 0;
async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

const CHECKS_OK = Object.freeze({
  adapterMode: 'real',
  configuration: { valid: true, pendencias: [], configuredPort: 'COM3' },
  dll: { exports: 4, exportsValid: true },
  client: { clientInitializationCode: '00' },
  vspague: { running: true, responding: true, pid: '4321' },
  pinpad: { detected: true, model: 'Gertec PPC930', port: 'COM3' },
  crt: { operation: 'CRT', input: 'transacao_valor=1.00', valueCents: 100 }
});

const DISPLAY = { codigo: '99', acao: { tipo: 'DISPLAY', mensagem: 'INSIRA OU PASSE O CARTAO' } };
const COLETA = { codigo: '99', acao: { tipo: 'COLETA', mensagem: 'DIGITE OS 4 ULTIMOS DIGITOS', tipoDado: 'N', mascara: '####' } };
const OPCAO = { codigo: '99', acao: { tipo: 'OPCAO', mensagem: 'SELECIONE', opcoes: ['Credito a vista', 'Credito parcelado'] } };
const FINAL_00 = { codigo: '00', saida: 'transacao_nsu=123456;transacao_autorizacao=A1B2C3;transacao_valor=1.00;transacao_cartao_numero=5555444433331111;transacao_comprovante_1via=CUPOM' };

/** Ambiente falso que reproduz as superfícies usadas pelo executor. */
function criarAmbiente(op = {}) {
  const passos = op.passos || [DISPLAY, FINAL_00];
  const chamadas = { TX_START: 0, TX_CONTINUE: 0, TX_FINALIZE: 0, ENABLE_REAL: 0, bloqueadas: 0 };
  const linhas = new Map([
    [1, { id: 1, tipo: 'pix_tef', valor: 1, status: 'erro', nsu: null, autorizacao: null }],
    [2, { id: 2, tipo: 'pix_tef', valor: 1, status: 'erro', nsu: null, autorizacao: null }],
    [3, { id: 3, tipo: 'pix_tef', valor: 1, status: 'erro', nsu: null, autorizacao: null }],
    ...(op.linhasExtras || [])
  ]);
  const estado = {
    gate: op.gateInicial === true,
    host: { pid: 999, gateReal: false, tripwire: true, contadores: { dllLoads: 1, inicia: 0, continua: 0, finaliza: 0 }, contexto: null },
    trava: op.travaInicial || null,
    idx: 0,
    emVooPolls: op.timeout ? 2 : 0,
    autorizarChamadas: [],
    continuacoes: [],
    finalizacoes: [],
    reconciliacoes: [],
    logs: [],
    perguntas: [],
    informacoes: [],
    gateAberturas: 0
  };
  const TX_ID = 4;
  const ctxDoPasso = (p) => ({ transactionId: String(TX_ID), estado: p.codigo === '99' ? p.acao.tipo : 'FIM', codigoUltimo: p.codigo, ultimaAcao: p.acao || null, dadosUltimaResposta: { saida: p.saida || '' } });
  const statusPorCodigo = (c) => (c === '00' ? 'aprovado' : (['03', '04', '09'].includes(c) ? 'negado' : 'pendente'));

  const deps = {
    gate: {
      estado: () => estado.gate,
      async abrir() { estado.gate = true; estado.gateAberturas += 1; estado.host = { ...estado.host, gateReal: true, tripwire: op.hostTripwireAposAbrir ?? false }; },
      async fechar() { estado.gate = false; estado.host = { ...estado.host, gateReal: false }; }
    },
    async config() {
      return {
        linha: { tentativas: op.tentativas ?? 1 },
        cfg: { tefHabilitado: true, tefProvedor: 'destaxa', tefAmbiente: op.ambiente || 'homologacao', pinpadHabilitado: true, ...(op.cfg || {}) }
      };
    },
    async banco() {
      const todas = [...linhas.values()];
      return {
        total: todas.length,
        pendentes: todas.filter((l) => l.status === 'pendente').length,
        maxId: Math.max(...linhas.keys()),
        errosAnteriores: todas.filter((l) => l.status === 'erro').map((l) => ({ ...l }))
      };
    },
    async transacao(id) { return linhas.has(Number(id)) ? { ...linhas.get(Number(id)) } : null; },
    async logs() { return []; },
    outrosProcessosCds: () => op.outros || [],
    dll: () => ({ path: 'C:/x/win-x64/libdll-integracao-tef.dll', arch: 'x64', sha256: op.sha256 || SHA256_DLL }),
    tefManager: {
      timeout: 30000,
      async garantirRecuperacao() { return estado.trava; },
      obterTravaResultadoTardio() { return estado.trava; },
      async autorizar(dados) {
        estado.autorizarChamadas.push(dados);
        if (op.recusaAutorizar) return { sucesso: false, codigo: op.recusaAutorizar, mensagem: 'recusado antes da DLL' };
        chamadas.TX_START += 1;
        if (op.segundaInicia) chamadas.bloqueadas += 1;
        const p = passos[0];
        estado.host.contexto = ctxDoPasso(p);
        const status = statusPorCodigo(p.codigo);
        linhas.set(TX_ID, { id: TX_ID, tipo: 'credito', valor: 1, status, nsu: null, autorizacao: null });
        if (op.timeout) {
          estado.trava = { transacaoId: String(TX_ID), estado: 'AGUARDANDO_RESULTADO_TARDIO', pendentes: [String(TX_ID)] };
          return { sucesso: false, status: 'pendente', codigo: 'TIMEOUT', transacao_id: TX_ID };
        }
        if (status === 'pendente') estado.trava = { transacaoId: String(TX_ID), estado: 'RECONCILIACAO_PENDENTE', pendentes: [String(TX_ID)] };
        return { sucesso: status === 'aprovado', status, codigo: p.codigo, transacao_id: TX_ID };
      },
      reconciliarResultadoTardio(id, dados) {
        if (!estado.trava) throw Object.assign(new Error('sem trava'), { code: 'TEF_RECONCILIACAO_SEM_TRAVA' });
        estado.reconciliacoes.push({ id, ...dados });
        const status = { CONFIRMED_SUCCESS: 'aprovado', CONFIRMED_DENIED: 'negado', CANCELLED: 'cancelado' }[dados.financialState];
        linhas.set(Number(id), { ...linhas.get(Number(id)), status });
        estado.trava = null;
        return { transacaoId: String(id), status, financialState: dados.financialState, travaLiberada: true };
      }
    },
    adapter: {
      async prepararAutorizacao(dados) {
        estado.prepararDados = dados;
        if (op.prep) return op.prep;
        return { pronto: false, readiness: 'READY_FOR_REAL_TRANSACTION', resposta: { codigo: 'DESTAXA_REAL_TRANSACTION_DISABLED', readiness: 'READY_FOR_REAL_TRANSACTION', preparacao: { ...CHECKS_OK, ...(op.checks || {}) } } };
      },
      async continuarTransacao(resposta) {
        chamadas.TX_CONTINUE += 1;
        estado.continuacoes.push(resposta);
        estado.idx += 1;
        const p = passos[estado.idx];
        if (p.naoExecutada) return { sucesso: false, codigoDestaxa: 'HOST_CRASHED', naoExecutada: true, contexto: { transactionId: String(TX_ID) } };
        estado.host.contexto = ctxDoPasso(p);
        return { sucesso: p.codigo === '00', codigoDestaxa: p.codigo, acao: p.acao || null, saida: p.saida || '', estado: estado.host.contexto.estado, contexto: { transactionId: String(TX_ID) } };
      },
      async finalizarTransacao({ confirmacao }) {
        chamadas.TX_FINALIZE += 1;
        estado.finalizacoes.push(confirmacao);
        const ok = op.finalizacaoOk !== false;
        return { sucesso: ok, codigoDestaxa: ok ? '00' : '08', confirmacaoDescricao: confirmacao === 0 ? 'confirma' : 'cancela_desfaz' };
      }
    },
    async hostStatus() { return { ...estado.host }; },
    hostEstado() {
      if (estado.emVooPolls > 0) {
        estado.emVooPolls -= 1;
        return { emVoo: { operation: 'TX_START' } };
      }
      if (op.timeout && estado.trava?.estado === 'AGUARDANDO_RESULTADO_TARDIO') {
        estado.trava = { ...estado.trava, estado: 'RECONCILIACAO_PENDENTE' };
      }
      return { emVoo: null };
    },
    chamadas: () => ({ ...chamadas }),
    registrarLog: (...args) => estado.logs.push(args),
    aguardar: async () => {}
  };

  const respostas = [...(op.respostas || [])];
  const operador = {
    async perguntar(p) {
      estado.perguntas.push(p);
      if (p.tipo === 'CANAL') return op.canal === undefined ? 'OK' : op.canal;
      return respostas.length ? respostas.shift() : null;
    },
    informar(t) { estado.informacoes.push(t); }
  };
  return { deps, operador, estado, chamadas, linhas, TX_ID };
}

async function executar(modo, op) {
  const amb = criarAmbiente(op);
  const rel = await executarCrt07b({ modo, deps: amb.deps, operador: amb.operador });
  return { rel, ...amb };
}

function consultarOficial() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(BANCO_OFICIAL, sqlite3.OPEN_READONLY, (e) => {
      if (e) return reject(e);
      db.all('SELECT id, status, nsu, autorizacao FROM tef_transacoes ORDER BY id', [], (err, rows) => {
        db.close();
        return err ? reject(err) : resolve(rows);
      });
    });
  });
}

function executarPreflightReal() {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const filho = spawn(process.execPath, [path.join(RAIZ, 'scripts', 'tef', 'destaxa-07b', 'runner.js'), '--preflight'], {
      cwd: RAIZ,
      env: { ...process.env, [REAL_TRANSACTION_ENV]: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let saida = '';
    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    filho.stdout.on('data', (c) => { saida += c; });
    filho.stderr.on('data', (c) => { saida += c; });
    const limite = setTimeout(() => filho.kill(), 300000);
    filho.on('error', reject);
    filho.on('close', (code) => {
      clearTimeout(limite);
      resolve({ code, saida, duracaoMs: Date.now() - inicio });
    });
  });
}

async function main() {
  console.log('\nTEF-DESTAXA-07B — executor CRT controlado (sem gate financeiro)\n');
  const semGate = (rel) => {
    assert.strictEqual(rel.gate.depois, 'OFF');
  };

  // ------------------------------------------------ pré-condições (núcleo)
  await test('pré-voo com todas as pré-condições → READY_FOR_REAL_CRT, gate nunca aberto, 0 chamadas', async () => {
    const { rel, estado } = await executar('preflight', {});
    assert.strictEqual(rel.result, RESULTADOS.READY);
    assert.strictEqual(estado.gateAberturas, 0);
    assert.deepStrictEqual(estado.autorizarChamadas, []);
    assert.deepStrictEqual(estado.prepararDados, { tipo: 'credito', operacao: 'CRT', valor: 1, parcelas: 1 });
    assert.strictEqual(rel.valor.destaxa, 'transacao_valor=1.00');
    assert.strictEqual(rel.clientDestaxa.codigoInicial, '00');
    assert.strictEqual(rel.registrosErroAnteriores.length, 3);
    semGate(rel);
  });

  const bloqueios = [
    ['tentativas = 3', { tentativas: 3 }, 'tef_configuracao.tentativas'],
    ['ambiente != homologacao', { ambiente: 'producao' }, 'tefAmbiente'],
    ['transação pendente', { linhasExtras: [[3.5, { id: 3.5, status: 'pendente' }]] }, 'tef_transacoes pendentes'],
    ['recuperação com trava', { travaInicial: { transacaoId: '9', estado: 'RECONCILIACAO_PENDENTE', pendentes: ['9'] } }, 'recuperação de pendências limpa (TefManager)'],
    ['outra instância do CDS aberta', { outros: [{ pid: 4544, comando: 'electron.exe .' }] }, 'nenhuma outra instância do CDS em execução (sem transação concorrente)'],
    ['SHA-256 divergente', { sha256: 'ABC' }, 'DLL SHA-256'],
    ['Client != 00', { checks: { client: { clientInitializationCode: '01' } } }, 'iniciaClientDestaxa = 00'],
    ['PinPad em outra COM', { checks: { pinpad: { detected: true, model: 'PPC930', port: 'COM4' } } }, 'COM3 detectada e configurada'],
    ['VSPague sem resposta', { checks: { vspague: { running: true, responding: false } } }, 'VSPague respondendo'],
    ['operação != CRT', { checks: { crt: { operation: 'PIX', input: 'transacao_valor=1.00', valueCents: 100 } } }, 'operação CRT'],
    ['valor != 1.00', { checks: { crt: { operation: 'CRT', input: 'transacao_valor=100', valueCents: 10000 } } }, 'valor Destaxa transacao_valor=1.00'],
    ['caminho não parado no gate', { prep: { pronto: false, resposta: { codigo: 'DESTAXA_VSPAGUE_INDISPONIVEL', preparacao: CHECKS_OK } } }, 'caminho CRT pronto e parado no gate (gate OFF)']
  ];
  for (const [nome, op, itemEsperado] of bloqueios) {
    await test(`real: ${nome} → BLOCKED sem abrir gate e sem autorizar`, async () => {
      const { rel, estado } = await executar('real', { ...op, respostas: [FRASE_CONFIRMACAO] });
      assert.strictEqual(rel.result, RESULTADOS.BLOCKED);
      assert.ok(rel.preCondicoes.some((i) => i.item === itemEsperado && !i.ok), JSON.stringify(rel.preCondicoes.filter((i) => !i.ok)));
      assert.strictEqual(estado.gateAberturas, 0);
      assert.deepStrictEqual(estado.autorizarChamadas, []);
      semGate(rel);
    });
  }

  await test('registros status=erro antigos não bloqueiam e são descritos como erros internos sem NSU', async () => {
    const { rel } = await executar('preflight', {});
    assert.ok(rel.preCondicoes.find((i) => i.item.startsWith('registros status=erro')).ok);
    assert.ok(rel.registrosErroAnteriores.every((r) => r.nsu == null && /sem transação financeira Destaxa/.test(r.classificacao)));
  });

  await test('gate já aberto por fora → BLOCKED (liberação genérica recusada)', async () => {
    const { rel, estado } = await executar('real', { gateInicial: true, respostas: [FRASE_CONFIRMACAO] });
    assert.strictEqual(rel.result, RESULTADOS.BLOCKED);
    assert.deepStrictEqual(estado.autorizarChamadas, []);
    semGate(rel);
  });

  await test('canal do operador indisponível → BLOCKED', async () => {
    const { rel } = await executar('real', { canal: null });
    assert.strictEqual(rel.result, RESULTADOS.BLOCKED);
  });

  for (const resposta of [null, 'executar crt 1.00', 'SIM']) {
    await test(`operador não confirma (${JSON.stringify(resposta)}) → BLOCKED, sem cobrança`, async () => {
      const { rel, estado } = await executar('real', { respostas: [resposta] });
      assert.strictEqual(rel.result, RESULTADOS.BLOCKED);
      assert.strictEqual(estado.gateAberturas, 0);
      assert.deepStrictEqual(estado.autorizarChamadas, []);
    });
  }

  await test('host não reinicia sem tripwire após abrir o gate → BLOCKED antes da chamada, gate fechado', async () => {
    const { rel, estado } = await executar('real', { hostTripwireAposAbrir: true, respostas: [FRASE_CONFIRMACAO] });
    assert.strictEqual(rel.result, RESULTADOS.BLOCKED);
    assert.deepStrictEqual(estado.autorizarChamadas, []);
    semGate(rel);
  });

  await test('autorização recusada antes da DLL (0 iniciaTransacao) → BLOCKED', async () => {
    const { rel } = await executar('real', { recusaAutorizar: 'DESTAXA_REAL_TRANSACTION_DISABLED', respostas: [FRASE_CONFIRMACAO] });
    assert.strictEqual(rel.result, RESULTADOS.BLOCKED);
    assert.strictEqual(rel.chamadasNativas.iniciaTransacaoDestaxa, 0);
    semGate(rel);
  });

  // ------------------------------------------------ fluxo real (fakes)
  await test('99 DISPLAY → COLETA → OPÇÃO → 00 → finaliza 0 → reconciliação CONFIRMED_SUCCESS → REAL_CRT_CONFIRMED', async () => {
    const { rel, estado } = await executar('real', {
      passos: [DISPLAY, COLETA, OPCAO, FINAL_00],
      respostas: [FRASE_CONFIRMACAO, 'OK', '1234', '1', '0']
    });
    assert.strictEqual(rel.result, RESULTADOS.CONFIRMED);
    assert.deepStrictEqual(estado.autorizarChamadas.map((d) => [d.tipo, d.operacao, d.valor, d.parcelas]), [['credito', 'CRT', 1, 1]]);
    assert.deepStrictEqual(estado.continuacoes, [{ displayAck: true }, { informacao: '1234' }, { informacao: 'Credito a vista' }]);
    assert.deepStrictEqual(estado.finalizacoes, [0]);
    assert.strictEqual(estado.reconciliacoes[0].financialState, 'CONFIRMED_SUCCESS');
    assert.strictEqual(rel.transactionId, '4');
    assert.deepStrictEqual(rel.chamadasNativas, { iniciaTransacaoDestaxa: 1, continuaTransacaoDestaxa: 3, finalizaTransacaoDestaxa: 1, segundaIniciaBloqueada: 0 });
    assert.deepStrictEqual(rel.sequencia99.map((e) => e.codigo), ['99', '99', '99', '00']);
    assert.strictEqual(rel.nsu, '123456');
    assert.strictEqual(rel.autorizacao, 'A1B2C3');
    assert.strictEqual(rel.estadoFinanceiro, 'CONFIRMED_SUCCESS');
    assert.deepStrictEqual(rel.violacoes, []);
    assert.strictEqual(rel.retries, 0);
    semGate(rel);
    const texto = JSON.stringify(rel);
    assert.ok(!texto.includes('1234"') && !texto.includes('5555444433331111') && !texto.includes('CUPOM'), 'dado sensível no relatório');
  });

  await test('opção inválida é repetida ao operador sem continuar a transação', async () => {
    const { rel, estado } = await executar('real', { passos: [OPCAO, FINAL_00], respostas: [FRASE_CONFIRMACAO, '7', '2', '0'] });
    assert.strictEqual(rel.result, RESULTADOS.CONFIRMED);
    assert.deepStrictEqual(estado.continuacoes, [{ informacao: 'Credito parcelado' }]);
  });

  await test('00 direto (linha já aprovada) → finaliza 0, sem reconciliação → REAL_CRT_CONFIRMED', async () => {
    const { rel, estado } = await executar('real', { passos: [FINAL_00], respostas: [FRASE_CONFIRMACAO, '0'] });
    assert.strictEqual(rel.result, RESULTADOS.CONFIRMED);
    assert.deepStrictEqual(estado.reconciliacoes, []);
    assert.deepStrictEqual(estado.finalizacoes, [0]);
  });

  await test('00 e executor fechado antes da finalização → desfaz (9), nunca confirma automaticamente', async () => {
    const { rel, estado } = await executar('real', { passos: [DISPLAY, FINAL_00], respostas: [FRASE_CONFIRMACAO, 'OK'] });
    assert.deepStrictEqual(estado.finalizacoes, [9]);
    assert.notStrictEqual(rel.result, RESULTADOS.CONFIRMED);
    assert.strictEqual(estado.reconciliacoes[0].financialState, 'CANCELLED');
  });

  await test('00 com falha na finalização → REAL_CRT_UNKNOWN, linha preservada para reconciliação', async () => {
    const { rel, estado } = await executar('real', { passos: [DISPLAY, FINAL_00], finalizacaoOk: false, respostas: [FRASE_CONFIRMACAO, 'OK', '0'] });
    assert.strictEqual(rel.result, RESULTADOS.UNKNOWN);
    assert.deepStrictEqual(estado.reconciliacoes, []);
  });

  await test('03 após 99 → negado confirmado, sem finalização, reconciliação CONFIRMED_DENIED → REAL_CRT_EXECUTED', async () => {
    const { rel, estado } = await executar('real', { passos: [DISPLAY, { codigo: '03', saida: '' }], respostas: [FRASE_CONFIRMACAO, 'OK'] });
    assert.strictEqual(rel.result, RESULTADOS.EXECUTED);
    assert.strictEqual(rel.estadoFinanceiro, 'CONFIRMED_DENIED');
    assert.deepStrictEqual(estado.finalizacoes, []);
    assert.strictEqual(estado.reconciliacoes[0].financialState, 'CONFIRMED_DENIED');
  });

  for (const codigo of ['08', 'A0', 'A1', 'ZZ']) {
    await test(`${codigo} → REAL_CRT_UNKNOWN: PARAR, sem finalização, sem retry, sem reconciliação`, async () => {
      const { rel, estado } = await executar('real', { passos: [DISPLAY, { codigo, saida: '' }], respostas: [FRASE_CONFIRMACAO, 'OK'] });
      assert.strictEqual(rel.result, RESULTADOS.UNKNOWN);
      assert.deepStrictEqual(estado.finalizacoes, []);
      assert.deepStrictEqual(estado.reconciliacoes, []);
      assert.strictEqual(rel.chamadasNativas.iniciaTransacaoDestaxa, 1);
      semGate(rel);
    });
  }

  await test('host cai durante continuação → REAL_CRT_UNKNOWN sem finalizar', async () => {
    const { rel, estado } = await executar('real', { passos: [DISPLAY, { naoExecutada: true }], respostas: [FRASE_CONFIRMACAO, 'OK'] });
    assert.strictEqual(rel.result, RESULTADOS.UNKNOWN);
    assert.deepStrictEqual(estado.finalizacoes, []);
  });

  await test('CANCELAR durante COLETA → finaliza 9 → reconciliação CANCELLED → REAL_CRT_EXECUTED', async () => {
    const { rel, estado } = await executar('real', { passos: [DISPLAY, COLETA, FINAL_00], respostas: [FRASE_CONFIRMACAO, 'OK', 'cancelar'] });
    assert.strictEqual(rel.result, RESULTADOS.EXECUTED);
    assert.deepStrictEqual(estado.finalizacoes, [9]);
    assert.strictEqual(estado.reconciliacoes[0].financialState, 'CANCELLED');
    assert.strictEqual(estado.continuacoes.length, 1);
  });

  await test('timeout do TefManager → aguarda resultado tardio sem nova chamada e segue com o mesmo transactionId', async () => {
    const { rel, estado } = await executar('real', { timeout: true, passos: [DISPLAY, FINAL_00], respostas: [FRASE_CONFIRMACAO, 'OK', '0'] });
    assert.strictEqual(rel.timeout.atingido, true);
    assert.strictEqual(rel.result, RESULTADOS.CONFIRMED);
    assert.strictEqual(rel.chamadasNativas.iniciaTransacaoDestaxa, 1);
    assert.strictEqual(estado.autorizarChamadas.length, 1);
    assert.ok(estado.informacoes.some((t) => /NÃO foi interrompida/.test(t)));
  });

  await test('segunda iniciaTransacaoDestaxa (bloqueada pela trava do executor) → violação e REAL_CRT_UNKNOWN', async () => {
    const { rel } = await executar('real', { segundaInicia: true, passos: [FINAL_00], respostas: [FRASE_CONFIRMACAO, '0'] });
    assert.ok(rel.violacoes.some((v) => /iniciaTransacaoDestaxa/.test(v)));
    assert.strictEqual(rel.result, RESULTADOS.UNKNOWN);
  });

  await test('sanitização: remove PAN, comprovantes e sequências longas de dígitos', () => {
    const { parametros, chavesRemovidas } = sanitizarParametros('transacao_nsu=1;transacao_cartao_numero=5555444433331111;transacao_comprovante_1via=X;outra=4111111111111111;transacao_valor=1.00');
    assert.deepStrictEqual(parametros, { transacao_nsu: '1', transacao_valor: '1.00' });
    assert.deepStrictEqual(chavesRemovidas.sort(), ['outra', 'transacao_cartao_numero', 'transacao_comprovante_1via']);
  });

  // ------------------------------------------------ pré-voo real (Electron, gate OFF)
  const antes = await consultarOficial();
  const execucao = await executarPreflightReal();
  const depois = await consultarOficial();
  let rel = null;
  try { rel = JSON.parse(fs.readFileSync(RELATORIO, 'utf8')); } catch (_) { rel = null; }
  const ambientais = new Set([
    'tef_configuracao.tentativas',
    'nenhuma outra instância do CDS em execução (sem transação concorrente)',
    'PPC930 detectado',
    'COM3 detectada e configurada',
    'operação CRT',
    'valor Destaxa transacao_valor=1.00',
    'caminho CRT pronto e parado no gate (gate OFF)'
  ]);

  await test('pré-voo real: canal do operador via TCP local OK, relatório gerado', () => {
    assert.ok(rel, execucao.saida.slice(-1500));
    assert.strictEqual(rel.modo, 'preflight');
    assert.strictEqual(rel.canalOperador, 'OK');
  });
  await test('pré-voo real: gate OFF do início ao fim; host com tripwire; 0/0/0 chamadas transacionais', () => {
    assert.strictEqual(rel.gate.antes, 'OFF');
    assert.strictEqual(rel.gate.depois, 'OFF');
    assert.strictEqual(rel.gateNoFimDoProcesso, 'OFF');
    assert.strictEqual(rel.tripwire.antes.hostTripwire, true);
    assert.deepStrictEqual([rel.tripwire.antes.host.inicia, rel.tripwire.antes.host.continua, rel.tripwire.antes.host.finaliza], [0, 0, 0]);
    assert.deepStrictEqual(rel.chamadasNativas, { iniciaTransacaoDestaxa: 0, continuaTransacaoDestaxa: 0, finalizaTransacaoDestaxa: 0, segundaIniciaBloqueada: 0 });
  });
  await test('pré-voo real: pré-condições técnicas comprovadas (DLL, hash, exports, Client 00, VSPague, host; pinpad/CRT ambientais se ausentes)', () => {
    const tecnicasFalhas = rel.preCondicoes.filter((i) => !i.ok && !ambientais.has(i.item));
    assert.deepStrictEqual(tecnicasFalhas, []);
    assert.strictEqual(rel.clientDestaxa.codigoInicial, '00');
    if (rel.pinpad && rel.pinpad.detected) {
      assert.strictEqual(rel.valor.destaxa, 'transacao_valor=1.00');
    }
  });
  await test('pré-voo real: resultado coerente (READY somente com todas as pré-condições; senão BLOCKED)', () => {
    const todas = rel.preCondicoes.every((i) => i.ok);
    assert.strictEqual(rel.result, todas ? RESULTADOS.READY : RESULTADOS.BLOCKED);
  });
  await test('pré-voo real: banco oficial sem novas linhas nem alteração dos 3 registros erro', () => {
    assert.deepStrictEqual(depois, antes);
    assert.strictEqual(rel.registrosErroAnteriores.length, antes.filter((l) => l.status === 'erro').length);
  });

  if (rel) {
    console.log('\n  Pré-voo real:');
    for (const i of rel.preCondicoes.filter((x) => !x.ok)) console.log(`    PENDENTE: ${i.item} = ${JSON.stringify(i.valor)} (esperado ${JSON.stringify(i.esperado)})`);
    console.log(`    resultado: ${rel.result}`);
  }
  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
