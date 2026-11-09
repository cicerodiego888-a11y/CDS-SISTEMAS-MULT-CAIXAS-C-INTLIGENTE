'use strict';

/**
 * MRT-39.1 — Validação do caminho integrado TefManager → DestaxaRealAdapter
 * com persistência durável MRT-39 no banco real de TESTES.
 *
 * Adapter/NativeHost simulados. Gate OFF. Sem DLL/V$Pague/INIT/CRT financeira.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const DB_DIR_TESTE = path.join(os.tmpdir(), 'cds-sistemas-test-db');
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR_TESTE;
process.env.DESTAXA_CONTINUIDADE_PERSISTENTE = '1';
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-39-1-integracao-tefmanager-adapter-report.json');

const db = require('../../backend/database');
const {
  REAL_TRANSACTION_ENV,
  CLASSIFICACAO_CODIGO,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  limparRegistrosContinuidade,
  ERROS_CONTINUIDADE
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
const persistencia = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const tefAdapterCiclo = require('../../backend/services/tef/tefAdapterCiclo');

const SUFFIX = crypto.randomBytes(4).toString('hex');
const ID = Object.freeze({
  idempotency_key: `mrt39_1_int_${SUFFIX}`,
  operation_id: `op_mrt391_${SUFFIX}`,
  fingerprint: crypto.createHash('md5').update(`mrt391-${SUFFIX}`).digest('hex')
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

/**
 * NativeHost/DLL simulados sem Orquestrador (sem sessão TX prévia).
 * CONTINUE devolve 99 para manter status pendente e evitar FINALIZE financeiro.
 */
function criarBridgeMockContinuidade() {
  const contadores = { inicia: 0, continua: 0, finaliza: 0 };
  return {
    contadores,
    async iniciarTransacaoDestaxa() {
      contadores.inicia += 1;
      throw new Error('TX_START proibido no teste MRT-39.1');
    },
    async continuarTransacaoDestaxa() {
      contadores.continua += 1;
      return {
        sucesso: false,
        codigoDestaxa: '99',
        classificacao: CLASSIFICACAO_CODIGO.ACTION_REQUIRED,
        requerContinuacao: true,
        acao: { ...ACAO_OPCAO },
        mensagem: 'Tipo do Cartao',
        saida: SAIDA_99
      };
    },
    async finalizarTransacaoDestaxa() {
      contadores.finaliza += 1;
      throw new Error('FINALIZE proibido no teste MRT-39.1');
    }
  };
}

function instalarAdapterSimulado(bridge) {
  const adapter = new DestaxaRealAdapter(
    { pdvCodigo: 'PDV-MRT391', caixaCodigo: 'CX1' },
    { bridge, executionMode: 'in-process' }
  );
  tefAdapterCiclo.obterAdapterDaTransacao = async (transacao) => ({
    adapter,
    provedor: 'destaxa',
    registro: {
      provedor: 'destaxa',
      ambiente: 'homologacao',
      id: null
    },
    terminalTefId: null,
    ambiente: 'homologacao',
    fonte: 'mrt39.1-teste-simulado'
  });
  return adapter;
}

function carregarTefManager() {
  const resolved = require.resolve('../../backend/services/tef/TefManager');
  delete require.cache[resolved];
  const mod = require('../../backend/services/tef/TefManager');
  // Export padrão é singleton; classe em .TefManager
  return mod.TefManager || mod;
}

function childContinuarDuplicata(transacaoId, idempotencyKey, solicitadaEmOriginal) {
  const script = `
    process.env.CDS_TEST_ISOLAR_BANCO='1';
    process.env.DB_DIR=${JSON.stringify(DB_DIR_TESTE)};
    process.env.DESTAXA_CONTINUIDADE_PERSISTENTE='1';
    delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
    const path=require('path');
    const ROOT=${JSON.stringify(ROOT)};
    const DestaxaRealAdapter=require(path.join(ROOT,'backend/services/tef/adapters/DestaxaRealAdapter.js'));
    const tefAdapterCiclo=require(path.join(ROOT,'backend/services/tef/tefAdapterCiclo.js'));
    const {CLASSIFICACAO_CODIGO}=require(path.join(ROOT,'backend/services/tef/destaxa/destaxaConstantes.js'));
    const db=require(path.join(ROOT,'backend/database.js'));
    const contadores={inicia:0,continua:0,finaliza:0};
    const bridge={
      contadores,
      async iniciarTransacaoDestaxa(){contadores.inicia++;throw new Error('TX_START proibido');},
      async continuarTransacaoDestaxa(){
        contadores.continua++;
        return {sucesso:false,codigoDestaxa:'99',classificacao:CLASSIFICACAO_CODIGO.ACTION_REQUIRED,
          requerContinuacao:true,acao:{tipo:'OPCAO'},mensagem:'Tipo do Cartao'};
      },
      async finalizarTransacaoDestaxa(){contadores.finaliza++;throw new Error('FINALIZE proibido');}
    };
    const adapter=new DestaxaRealAdapter({},{bridge,executionMode:'in-process'});
    tefAdapterCiclo.obterAdapterDaTransacao=async()=>({
      adapter,provedor:'destaxa',registro:{provedor:'destaxa',ambiente:'homologacao'},
      terminalTefId:null,ambiente:'homologacao',fonte:'mrt39.1-child'
    });
    delete require.cache[require.resolve(path.join(ROOT,'backend/services/tef/TefManager.js'))];
    const mod=require(path.join(ROOT,'backend/services/tef/TefManager.js'));
    const TefManager=mod.TefManager||mod;
    function ready(){return new Promise((res,rej)=>{
      if(typeof db.whenReady==='function') db.whenReady(e=>e?rej(e):res());
      else setTimeout(res,2000);
    });}
    ready().then(async()=>{
      const mgr=new TefManager({recuperarNoInicio:false});
      const r=await mgr.continuarAutorizacao({
        transacao_id:${JSON.stringify(transacaoId)},
        idempotency_key:${JSON.stringify(idempotencyKey)},
        resposta_continuidade:'Credito',
        solicitadaEm:${JSON.stringify(solicitadaEmOriginal)},
        persistenciaContinuidade:true,
        ambienteOperador:{tty:true}
      });
      console.log(JSON.stringify({
        codigo:r.codigo||null,
        sucesso:r.sucesso===true,
        bridgeContinua:contadores.continua,
        bridgeInicia:contadores.inicia,
        mensagem:r.mensagem||null
      }));
      process.exit(r.sucesso!==true && contadores.continua===0 && contadores.inicia===0 ? 3 : 1);
    }).catch(e=>{console.error(String(e&&e.stack||e));process.exit(2);});
  `;
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      CDS_TEST_ISOLAR_BANCO: '1',
      DB_DIR: DB_DIR_TESTE,
      DESTAXA_CONTINUIDADE_PERSISTENTE: '1'
    },
    timeout: 90000
  });
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-39.1 — Integração TefManager → Adapter (banco TESTE) ===\n');

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
    distintoProducao: path.resolve(caminho.dbPath || '') !== path.resolve(prodPath)
  };

  console.log('Fase 1 — banco:', JSON.stringify(fase1));

  if (!fase1.ehTempCdsTestDb || fase1.ehProgramData || !fase1.distintoProducao) {
    const report = {
      sprint: 'MRT-39.1',
      classificacaoFinal: 'BLOQUEADO',
      motivo: 'Banco efetivo não comprovado como ambiente de testes',
      fase1,
      generatedAt: geradoEm
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error('BLOQUEADO: banco não é de testes');
  }

  const resultados = [];
  const idsCriados = [];

  await persistencia.limparRegistrosTesteMrt39();

  // Setup: transação + solicitação 99 no SQLite de testes
  const tx = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: ID.idempotency_key,
    operationId: ID.operation_id,
    fingerprint: ID.fingerprint
  });
  idsCriados.push(tx.id);
  const timestampOriginal = new Date().toISOString();
  await persistencia.registrarSolicitacao99(tx.id, {
    acao: ACAO_OPCAO,
    solicitadaEm: timestampOriginal
  });

  limparRegistrosContinuidade();

  // Adapter simulado + patch ANTES de carregar TefManager (binding do require)
  const bridge = criarBridgeMockContinuidade();
  const adapter = instalarAdapterSimulado(bridge);
  const TefManager = carregarTefManager();
  const mgr = new TefManager({ recuperarNoInicio: false });

  resultados.push(ok('1) Adapter DestaxaRealAdapter com persistência durável habilitada',
    adapter.nome === 'Destaxa'
    && String(process.env.DESTAXA_CONTINUIDADE_PERSISTENTE) === '1'
    && typeof adapter.continuarPagamento === 'function'));

  // 2) Continuidade pelo caminho oficial TefManager
  const r1 = await mgr.continuarAutorizacao({
    transacao_id: tx.id,
    idempotency_key: ID.idempotency_key,
    resposta_continuidade: 'Credito',
    solicitadaEm: timestampOriginal,
    persistenciaContinuidade: true,
    ambienteOperador: { tty: true }
  });

  const apos1 = await persistencia.buscarTransacao(tx.id);
  const cont1 = persistencia.obterBlocoContinuidade(apos1.payload_retorno || {});
  const respCredito = (cont1.respostas || []).some(
    (r) => String(r.informacao || '') === 'Credito'
      || String(r.fingerprint || '') === 'informacao=Credito'
  );

  resultados.push(ok('2) TefManager chamou DestaxaRealAdapter (caminho oficial)',
    r1 != null
    && bridge.contadores.continua === 1
    && bridge.contadores.inicia === 0, {
      codigo: r1.codigo,
      bridgeContinua: bridge.contadores.continua,
      bridgeInicia: bridge.contadores.inicia,
      adapterFonte: 'mrt39.1-teste-simulado'
    }));

  resultados.push(ok('3) Resposta literal Credito persistida no SQLite',
    respCredito === true
    && Number(cont1.continueCount || 0) >= 1
    && Number(cont1.txStartCount || 0) === 1, {
      estado: cont1.estado,
      respostas: cont1.respostas,
      continueCount: cont1.continueCount,
      txStartCount: cont1.txStartCount
    }));

  // 4) Segunda resposta mesma solicitação — bloqueio sem nova chamada à bridge
  const continuaAntesDup = bridge.contadores.continua;
  const iniciaAntesDup = bridge.contadores.inicia;
  limparRegistrosContinuidade(); // prova que o bloqueio não depende só da memória MRT-38
  const r2 = await mgr.continuarAutorizacao({
    transacao_id: tx.id,
    idempotency_key: ID.idempotency_key,
    resposta_continuidade: 'Credito',
    solicitadaEm: timestampOriginal,
    persistenciaContinuidade: true,
    ambienteOperador: { tty: true }
  });

  resultados.push(ok('4) Segunda resposta bloqueada (duplicidade)',
    r2.sucesso !== true
    && r2.codigo === 'DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE', {
      codigo: r2.codigo,
      mensagem: r2.mensagem
    }));

  resultados.push(ok('5) Bridge NÃO chamada na tentativa duplicada (mesmo processo)',
    bridge.contadores.continua === continuaAntesDup
    && bridge.contadores.inicia === iniciaAntesDup, {
      continua: bridge.contadores.continua,
      inicia: bridge.contadores.inicia
    }));

  // 5) Reinício Node — caminho oficial ainda bloqueia; bridge zerada no child
  const child = childContinuarDuplicata(tx.id, ID.idempotency_key, timestampOriginal);
  let childJson = null;
  try {
    childJson = JSON.parse((child.stdout || '').trim().split('\n').filter(Boolean).pop());
  } catch (_) {
    childJson = { raw: child.stdout, stderr: child.stderr, status: child.status };
  }

  resultados.push(ok('6) Duplicidade bloqueada após reinício (TefManager no child)',
    child.status === 3
    && childJson
    && childJson.codigo === 'DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE'
    && childJson.bridgeContinua === 0
    && childJson.bridgeInicia === 0, {
      childStatus: child.status,
      childJson,
      stderr: child.stderr ? String(child.stderr).slice(0, 400) : null
    }));

  resultados.push(ok('7) Nenhum novo TX_START (inicia=0 em todo o exercício)',
    bridge.contadores.inicia === 0
    && (childJson?.bridgeInicia === 0 || childJson?.bridgeInicia == null), {
      parentInicia: bridge.contadores.inicia,
      childInicia: childJson?.bridgeInicia
    }));

  // Identidade + gate + MRT-24/36
  const m24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json'), 'utf8'));
  const m36 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json'), 'utf8'));
  resultados.push(ok('8) Gate OFF; IDs MRT-39.1; MRT-24/36 preservados UNKNOWN/INCONCLUSIVA',
    transacaoRealHabilitada() === false
    && ID.idempotency_key.startsWith('mrt39_1_')
    && ID.idempotency_key !== m36.identidade?.idempotency_key
    && (m24.execucao?.resultado?.financialState === 'UNKNOWN' || String(m24.classificacao || '').includes('INCONCLUSIVA'))
    && m36.classificacao === 'INCONCLUSIVA'));

  const limpeza = await persistencia.limparRegistrosTesteMrt39({ ids: idsCriados });
  resultados.push(ok('9) Limpeza somente registros MRT-39/39.1',
    limpeza.ok && limpeza.apagados.length >= idsCriados.length, {
      apagados: limpeza.apagados
    }));

  const report = {
    sprint: 'MRT-39.1',
    title: 'Validação do caminho integrado TefManager → DestaxaRealAdapter com persistência MRT-39',
    generatedAt: geradoEm,
    classificacaoFinal: 'IMPLEMENTADO',
    fase1Diagnostico: fase1,
    evidenciaBancoTeste: {
      caminho: fase1.dbPath,
      criterio: 'DB_DIR=os.tmpdir()/cds-sistemas-test-db + CDS_TEST_ISOLAR_BANCO=1',
      distintoDe: prodPath,
      comprovado: true
    },
    auditoriaChamada: {
      caminhoOficial: [
        'TefManager.continuarAutorizacao',
        'obterAdapterDaTransacao (stub teste → DestaxaRealAdapter simulado)',
        'DestaxaRealAdapter.continuarPagamento',
        'destaxaContinuidadePersistencia + continuarCicloCrt (bridge mock)'
      ],
      adapterNome: adapter.nome,
      persistenciaEnv: 'DESTAXA_CONTINUIDADE_PERSISTENTE=1',
      executionMode: 'in-process + bridge mock (sem DLL / sem NativeHost real)'
    },
    arquivosAlterados: [
      'backend/services/tef/TefManager.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'tests/tef/mrt-39-1-integracao-tefmanager-adapter.test.js',
      'docs/build/mrt-39-1-integracao-tefmanager-adapter-report.json'
    ],
    identidadeTeste: ID,
    registrosTesteCriados: idsCriados,
    registrosTesteRemovidos: limpeza.apagados,
    resultadosTeste: resultados,
    evidenciasChamadas: {
      primeiraContinuidade: {
        codigo: r1.codigo,
        bridgeContinua: 1,
        bridgeInicia: 0
      },
      segundaDuplicataMesmoProcesso: {
        codigo: r2.codigo,
        bridgeContinuaInalterada: true,
        bridgeContinua: bridge.contadores.continua
      },
      aposReinicio: childJson
    },
    persistenciaComprovada: {
      respostaCredito: respCredito,
      continueCount: cont1.continueCount,
      txStartCount: cont1.txStartCount,
      estadoAposPrimeira: cont1.estado
    },
    recuperacaoAposReinicio: {
      ok: child.status === 3,
      evidencia: childJson,
      mecanismo: 'spawnSync novo processo Node; TefManager.continuarAutorizacao; anti-duplicata SQLite; bridge.continua=0'
    },
    contadoresBridge: {
      parent: { ...bridge.contadores },
      child: childJson
        ? { inicia: childJson.bridgeInicia, continua: childJson.bridgeContinua }
        : null
    },
    ausenciaNovoTxStart: {
      ok: bridge.contadores.inicia === 0,
      evidencia: 'contadores.inicia permaneceram 0 no parent e no child'
    },
    confirmacoes: {
      gateOff: true,
      zeroOperacoesFinanceirasReais: true,
      dllNaoCarregada: true,
      vspagueNaoIniciado: true,
      nativeHostSimulado: true,
      adapterSimulado: true,
      mrt24UnknownPreservado: true,
      mrt36NaoReutilizada: true,
      producaoNaoAlterada: true
    },
    riscosResiduais: [
      'obterAdapterDaTransacao é stubado no teste para injetar DestaxaRealAdapter+bridge mock sem DLL; o binding oficial TefManager→Adapter.continuarPagamento é o exercitado',
      'Continuidade pós-Credito permanece em 99 simulado (sem FINALIZE financeiro) para manter status pendente e validar anti-duplicata no caminho oficial'
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
