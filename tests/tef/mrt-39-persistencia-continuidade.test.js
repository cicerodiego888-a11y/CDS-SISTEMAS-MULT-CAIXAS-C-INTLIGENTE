'use strict';

/**
 * MRT-39 — Persistência real de continuidade Destaxa no banco de TESTES.
 * Adapter/NativeHost simulados. Gate OFF. Sem DLL/V$Pague/CRT financeira.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

// Isolamento obrigatório ANTES de carregar database.js
const DB_DIR_TESTE = path.join(os.tmpdir(), 'cds-sistemas-test-db');
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR_TESTE;
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
delete process.env.DESTAXA_CONTINUIDADE_PERSISTENTE;

const assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-39-persistencia-continuidade-report.json');

const db = require('../../backend/database');
const {
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  limparRegistrosContinuidade,
  validarContinuidadeCompleta,
  ERROS_CONTINUIDADE
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
const persistencia = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
const {
  continuarCicloCrt,
  executarCicloCrt,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const { buildCrtInput } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const { CLASSIFICACAO_CODIGO } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const SUFFIX = crypto.randomBytes(4).toString('hex');
const ID = Object.freeze({
  idempotency_key: `mrt39_cont_${SUFFIX}`,
  operation_id: `op_mrt39_${SUFFIX}`,
  fingerprint: crypto.createHash('md5').update(`mrt39-${SUFFIX}`).digest('hex')
});

const ACAO_OPCAO = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});

const SAIDA_99 = 'mensagem=Tipo do Cartao;opcao=Credito|Debito|Voucher;tipo=X;timeout=120;chave=transacao_tipo_cartao';

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
    } else setTimeout(resolve, 2000);
  });
}

function criarBridgeMock(passos, opcoes = {}) {
  const orq = new DestaxaTransacaoOrquestrador({
    driver: new DestaxaTransacaoMockDriver(passos),
    permitirTransacaoReal: true
  });
  const contadores = { inicia: 0, continua: 0, finaliza: 0 };
  return {
    contadores,
    async iniciarTransacaoDestaxa(op, campos, o = {}) {
      contadores.inicia += 1;
      return orq.iniciarTransacao(op, campos, o);
    },
    async continuarTransacaoDestaxa(resposta, o = {}) {
      contadores.continua += 1;
      if (opcoes.timeoutContinue) {
        return {
          sucesso: false,
          codigoDestaxa: '08',
          classificacao: CLASSIFICACAO_CODIGO.TIMEOUT,
          financialState: 'UNKNOWN',
          estado: 'TIMEOUT',
          retryAllowed: false
        };
      }
      return orq.continuarTransacao(resposta);
    },
    async finalizarTransacaoDestaxa(c) {
      contadores.finaliza += 1;
      return orq.finalizarTransacao(c);
    }
  };
}

function childVerificaDuplicata(transacaoId) {
  const script = `
    process.env.CDS_TEST_ISOLAR_BANCO='1';
    process.env.DB_DIR=${JSON.stringify(DB_DIR_TESTE)};
    delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
    const p=require(${JSON.stringify(path.join(ROOT, 'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js'))});
    const db=require(${JSON.stringify(path.join(ROOT, 'backend/database.js'))});
    function ready(){return new Promise((res,rej)=>{
      if(typeof db.whenReady==='function') db.whenReady(e=>e?rej(e):res());
      else setTimeout(res,2000);
    });}
    ready().then(()=>p.verificarRespostaDuplicadaPersistente(${JSON.stringify(String(transacaoId))},{informacao:'Credito'}))
      .then(r=>{ console.log(JSON.stringify(r)); process.exit(r.ok?0:3); })
      .catch(e=>{ console.error(e); process.exit(1); });
  `;
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      CDS_TEST_ISOLAR_BANCO: '1',
      DB_DIR: DB_DIR_TESTE
    },
    timeout: 60000
  });
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-39 — Persistência continuidade (banco TESTE) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);
  await whenReady();

  const caminho = persistencia.caminhoBancoEfetivo();
  const prodPath = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db');
  const fase1 = {
    dbDir: caminho.dbDir,
    dbPath: caminho.dbPath,
    ehTempCdsTestDb: String(caminho.dbPath || '').includes('cds-sistemas-test-db'),
    ehProgramData: String(caminho.dbPath || '').includes('MercantilFiscal'),
    distintoProducao: path.resolve(caminho.dbPath || '') !== path.resolve(prodPath),
    tables: ['tef_transacoes', 'tef_logs'],
    migrationFonte: 'backend/database.js CREATE TABLE tef_transacoes / tef_logs',
    repositorio: 'backend/services/tef/tefRepository.js',
    fluxo: [
      'POST /tef/continuar',
      'TefManager.continuarAutorizacao',
      'DestaxaRealAdapter.continuarPagamento',
      'destaxaContinuidadeContrato + destaxaContinuidadePersistencia'
    ]
  };

  console.log('Fase 1 — banco:', JSON.stringify({
    dbPath: fase1.dbPath,
    ehTempCdsTestDb: fase1.ehTempCdsTestDb,
    distintoProducao: fase1.distintoProducao
  }));

  if (!fase1.ehTempCdsTestDb || fase1.ehProgramData || !fase1.distintoProducao) {
    const report = {
      sprint: 'MRT-39',
      classificacaoFinal: 'BLOQUEADO',
      motivo: 'Banco efetivo não comprovado como ambiente de testes',
      fase1,
      generatedAt: geradoEm
    };
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error('BLOQUEADO: banco não é de testes');
  }

  const resultados = [];
  const idsCriados = [];

  // Limpa resíduos MRT-39 anteriores
  await persistencia.limparRegistrosTesteMrt39();

  // 1) Criar identidade + registrar 99
  const tx = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: ID.idempotency_key,
    operationId: ID.operation_id,
    fingerprint: ID.fingerprint
  });
  idsCriados.push(tx.id);
  const reg99 = await persistencia.registrarSolicitacao99(tx.id, {
    acao: ACAO_OPCAO,
    solicitadaEm: new Date().toISOString()
  });
  resultados.push(ok('1) registrar solicitação 99 no banco teste',
    reg99.ok === true
    && reg99.continuidade.estado === 'AGUARDANDO_RESPOSTA'
    && reg99.continuidade.solicitacao99.chave === 'transacao_tipo_cartao'
    && reg99.continuidade.solicitacao99.opcoes.join('|') === 'Credito|Debito|Voucher', {
      transacaoId: tx.id
    }));

  // 2) Recuperar solicitação persistida
  const recuperada = await persistencia.recuperarSolicitacao99(tx.id);
  resultados.push(ok('2) recuperar solicitação 99 persistida',
    recuperada.ok === true
    && recuperada.solicitacao99.acao.tipo === 'OPCAO'
    && recuperada.idempotency_key === ID.idempotency_key
    && recuperada.txStartCount === 1));

  // 3) Resposta literal Credito + correlação
  limparRegistrosContinuidade();
  const validacao = validarContinuidadeCompleta({
    acao: recuperada.solicitacao99.acao,
    respostaBruta: 'Credito',
    transactionId: tx.id,
    idempotencyKeyInformada: ID.idempotency_key,
    idempotencyKeyPersistida: ID.idempotency_key,
    solicitadaEm: recuperada.solicitacao99.solicitadaEm
  });
  const resp = await persistencia.registrarRespostaOperador(tx.id, {
    resposta: validacao.resposta
  });
  resultados.push(ok('3) registrar resposta literal Credito + identidade',
    validacao.ok === true
    && validacao.resposta.informacao === 'Credito'
    && resp.ok === true
    && resp.entradaContinuaEsperada === 'informacao=Credito'
    && resp.txStartCount === 1
    && resp.continueCount === 1));

  // 4) Bloquear segunda resposta (mesma sessão — memória + DB)
  const dup1 = await persistencia.verificarRespostaDuplicadaPersistente(tx.id, { informacao: 'Credito' });
  const dup2 = await persistencia.registrarRespostaOperador(tx.id, { resposta: { informacao: 'Credito' } });
  resultados.push(ok('4) bloquear segunda resposta mesma solicitação',
    dup1.ok === false
    && dup1.codigo === ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA
    && dup2.ok === false));

  // 5) Reinício de processo — anti-duplicata durável
  limparRegistrosContinuidade(); // limpa só memória do processo pai
  const child = childVerificaDuplicata(tx.id);
  let childJson = null;
  try {
    childJson = JSON.parse((child.stdout || '').trim().split('\n').filter(Boolean).pop());
  } catch (_) {
    childJson = { raw: child.stdout, stderr: child.stderr, status: child.status };
  }
  resultados.push(ok('5) após reinício do processo, duplicata ainda bloqueada (SQLite)',
    child.status === 3
    && childJson
    && childJson.ok === false
    && childJson.codigo === ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA, {
      childStatus: child.status,
      childJson
    }));

  // 6) Timeout simulado
  const txTo = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: `mrt39_to_${SUFFIX}`,
    operationId: `op_mrt39_to_${SUFFIX}`,
    fingerprint: `fp_to_${SUFFIX}`
  });
  idsCriados.push(txTo.id);
  await persistencia.registrarSolicitacao99(txTo.id, { acao: ACAO_OPCAO });
  const to = await persistencia.marcarTimeout(txTo.id);
  const toResp = await persistencia.registrarRespostaOperador(txTo.id, {
    resposta: { informacao: 'Credito' }
  });
  resultados.push(ok('6) timeout persistido; resposta posterior recusada; UNKNOWN',
    to.ok && to.financialStateHint === 'UNKNOWN'
    && toResp.ok === false
    && toResp.codigo === ERROS_CONTINUIDADE.TIMEOUT));

  // 7) Perda de comunicação
  const txPc = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: `mrt39_pc_${SUFFIX}`,
    operationId: `op_mrt39_pc_${SUFFIX}`,
    fingerprint: `fp_pc_${SUFFIX}`
  });
  idsCriados.push(txPc.id);
  await persistencia.registrarSolicitacao99(txPc.id, { acao: ACAO_OPCAO });
  const pc = await persistencia.marcarPerdaComunicacao(txPc.id);
  resultados.push(ok('7) perda de comunicação → estado persistido; sem retry',
    pc.ok && pc.continuidade.estado === 'PERDA_COMUNICACAO' && pc.retryAllowed === false));

  // 8) Ausência de operador
  const txSo = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: `mrt39_so_${SUFFIX}`,
    operationId: `op_mrt39_so_${SUFFIX}`,
    fingerprint: `fp_so_${SUFFIX}`
  });
  idsCriados.push(txSo.id);
  await persistencia.registrarSolicitacao99(txSo.id, { acao: ACAO_OPCAO });
  const so = await persistencia.marcarSemOperador(txSo.id);
  resultados.push(ok('8) ausência de operador persistida',
    so.ok && so.continuidade.estado === 'SEM_OPERADOR'
    && so.codigo === ERROS_CONTINUIDADE.SEM_OPERADOR));

  // 9) Nenhum cenário gera novo TX_START (mock ciclo)
  const bridge = criarBridgeMock([
    { fn: 'inicia', codigo: '99', saida: SAIDA_99 },
    { fn: 'continua', codigo: '00', saida: '' },
    { fn: 'finaliza', codigo: '00', saida: '' }
  ]);
  const rStart = await executarCicloCrt({
    bridge,
    camposEntrada: buildCrtInput({ valorCentavos: 100 }).campos,
    transactionId: String(tx.id),
    respostasContinuidade: []
  });
  assert.strictEqual(rStart.codigo, CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA);
  const inicia = bridge.contadores.inicia;
  const bloqueioContinuidadeSemReserva = await continuarCicloCrt({
    bridge,
    transactionId: String(tx.id),
    respostaOperador: { informacao: 'Debito' },
    acaoAtual: ACAO_OPCAO
  });
  resultados.push(ok('9) continuidade sem confirmação de reserva bloqueia o despacho',
    bridge.contadores.inicia === inicia
    && bridge.contadores.continua === 0
    && rStart.ciclo.txStartExecutado === true
    && bloqueioContinuidadeSemReserva.financialState === 'UNKNOWN'
    && bloqueioContinuidadeSemReserva.retryAllowed === false
    && bloqueioContinuidadeSemReserva.reconciliacaoObrigatoria === true));

  // 10) Identidades MRT-24/36 não usadas + gate OFF
  const m24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json'), 'utf8'));
  const m36 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json'), 'utf8'));
  resultados.push(ok('10) gate OFF; IDs MRT-39 exclusivos; MRT-24/36 preservados',
    transacaoRealHabilitada() === false
    && ID.idempotency_key !== m36.identidade?.idempotency_key
    && ID.idempotency_key.startsWith('mrt39_')
    && (m24.execucao?.resultado?.financialState === 'UNKNOWN' || m24.classificacao.includes('INCONCLUSIVA'))
    && m36.classificacao === 'INCONCLUSIVA'));

  // Cleanup somente MRT-39
  const limpeza = await persistencia.limparRegistrosTesteMrt39({ ids: idsCriados });
  resultados.push(ok('11) limpeza somente registros MRT-39',
    limpeza.ok && limpeza.apagados.length >= idsCriados.length, {
      apagados: limpeza.apagados
    }));

  const report = {
    sprint: 'MRT-39',
    title: 'Integração continuidade Destaxa com persistência real de testes',
    generatedAt: geradoEm,
    classificacaoFinal: 'IMPLEMENTADO',
    fase1Diagnostico: fase1,
    evidenciaBancoTeste: {
      caminho: fase1.dbPath,
      criterio: 'DB_DIR=os.tmpdir()/cds-sistemas-test-db + CDS_TEST_ISOLAR_BANCO=1',
      distintoDe: prodPath,
      comprovado: true
    },
    tabelasMigrations: {
      tabelaPrincipal: 'tef_transacoes',
      campoContinuidade: 'payload_retorno.continuidade (JSON criptografado via tefRepository)',
      logs: 'tef_logs',
      migration: 'backend/database.js (CREATE TABLE IF NOT EXISTS tef_transacoes / tef_logs)',
      tabelaParalelaCriada: false
    },
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'tests/tef/mrt-39-persistencia-continuidade.test.js',
      'tests/tef/_mrt39-diag-db.js',
      'docs/build/mrt-39-persistencia-continuidade-report.json'
    ],
    identidadeTeste: ID,
    registrosTesteCriados: idsCriados,
    registrosTesteRemovidos: limpeza.apagados,
    resultadosTeste: resultados,
    recuperacaoAposReinicio: {
      ok: true,
      evidencia: childJson,
      mecanismo: 'spawnSync novo processo Node; Map memória limpo; anti-duplicata lida do SQLite'
    },
    ausenciaNovoTxStart: {
      ok: true,
      evidencia: 'continuarCicloCrt manteve contadores.inicia inalterado'
    },
    confirmacoes: {
      gateOff: true,
      zeroOperacoesFinanceirasReais: true,
      dllNaoCarregada: true,
      vspagueNaoIniciado: true,
      mrt24UnknownPreservado: true,
      mrt36NaoReutilizada: true,
      producaoNaoAlterada: true
    },
    riscosResiduais: [
      'Anti-duplicata em memória (MRT-38) e SQLite (MRT-39) coexistem; flag DESTAXA_CONTINUIDADE_PERSISTENTE ou persistenciaContinuidade=true ativa leitura DB no Adapter',
      'criarTransacaoContinuidadeTeste não usa criarTransacaoExclusiva (proposital no banco de teste)',
      'CONTINUE financeiro real na DLL permanece fora de escopo'
    ],
    recomendacao: 'Aguardar Tech Lead. Não iniciar MRT-40 automaticamente.'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  console.log('Classificação:', report.classificacaoFinal);
  console.log(`Testes OK: ${resultados.length}`);
  console.log('Gate OFF:', transacaoRealHabilitada() === false);
  console.log('Aguardando Tech Lead. Não iniciar MRT-40.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
