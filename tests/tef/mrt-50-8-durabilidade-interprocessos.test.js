'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DB_DIR = path.join(
  os.tmpdir(),
  `cds-mrt-50-8-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
);
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-50-8-durabilidade-interprocessos-report.json');
const ACAO = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});

process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR;
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
delete process.env.DESTAXA_CONTINUIDADE_PERSISTENTE;

const db = require('../../backend/database');
const repository = require('../../backend/services/tef/tefRepository');
const persistencia = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
const { REAL_TRANSACTION_ENV, transacaoRealHabilitada } =
  require('../../backend/services/tef/destaxa/destaxaConstantes');

const resultados = [];

function dbGet(handle, sql, params = []) {
  return new Promise((resolve, reject) => {
    handle.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });
}

function dbRun(handle, sql, params = []) {
  return new Promise((resolve, reject) => {
    handle.run(sql, params, (error) => (error ? reject(error) : resolve()));
  });
}

function whenReady() {
  return new Promise((resolve, reject) => {
    db.whenReady((error) => (error ? reject(error) : resolve()));
  });
}

async function criarFixture({ action = ACAO, timestamp = new Date().toISOString() } = {}) {
  const token = crypto.randomBytes(6).toString('hex');
  const fixture = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: `mrt40_mrt508_${token}`,
    operationId: `op_mrt508_${token}`,
    fingerprint: crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)
  });
  const identidade = {
    transactionId: String(fixture.id),
    operation_id: `op_mrt508_${token}`,
    idempotency_key: `mrt40_mrt508_${token}`,
    fingerprint: crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)
  };
  const solicitacao = await persistencia.registrarSolicitacao99(fixture.id, {
    acao: action,
    solicitadaEm: timestamp
  });
  assert.strictEqual(solicitacao.ok, true, solicitacao.mensagem);
  assert.strictEqual(solicitacao.duravel, true);
  assert.strictEqual(solicitacao.confirmada, true);
  return {
    id: String(fixture.id),
    idempotencyKey: identidade.idempotency_key,
    identidade,
    acao: action,
    solicitadaEm: new Date(timestamp).toISOString()
  };
}

function criarFixtureNoProcessoPai(dbDir) {
  const script = `
    const path=require('path');
    const crypto=require('crypto');
    const ROOT=${JSON.stringify(ROOT)};
    const action=${JSON.stringify(ACAO)};
    process.env.CDS_TEST_ISOLAR_BANCO='1';
    process.env.DB_DIR=${JSON.stringify(dbDir)};
    process.env.NODE_ENV='test';
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED='0';
    const db=require(path.join(ROOT,'backend/database.js'));
    const persistence=require(path.join(ROOT,'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js'));
    function ready(){return new Promise((resolve,reject)=>db.whenReady(e=>e?reject(e):resolve()));}
    function get(sql){return new Promise((resolve,reject)=>db.get(sql,[],(e,r)=>e?reject(e):resolve(r||null)));}
    function diagnosticar(){
      return Promise.all([
        get('PRAGMA database_list'),
        get('PRAGMA journal_mode'),
        get('PRAGMA busy_timeout'),
        get('PRAGMA synchronous')
      ]).then(([databaseList,journalMode,busyTimeout,synchronous])=>{
        const stat=require('fs').statSync(db.dbPath);
        return {
          pid:process.pid,
          caminho:path.resolve(db.dbPath),
          identidadeArquivo:{dev:stat.dev,ino:stat.ino,size:stat.size},
          databaseList,journalMode,busyTimeout,synchronous
        };
      });
    }
    ready().then(async()=>{
      const token=crypto.randomBytes(6).toString('hex');
      const fixture=await persistence.criarTransacaoContinuidadeTeste({
        idempotencyKey:'mrt40_mrt508_'+token,
        operationId:'op_mrt508_'+token,
        fingerprint:crypto.createHash('sha256').update(token).digest('hex').slice(0,32)
      });
      const identidade={
        transactionId:String(fixture.id),
        operation_id:'op_mrt508_'+token,
        idempotency_key:'mrt40_mrt508_'+token,
        fingerprint:crypto.createHash('sha256').update(token).digest('hex').slice(0,32)
      };
      const solicitadaEm=new Date().toISOString();
      const solicitacao=await persistence.registrarSolicitacao99(fixture.id,{acao:action,solicitadaEm});
      const resposta=await persistence.registrarRespostaOperador(fixture.id,{
        resposta:'Credito',
        incrementarContinue:true,
        exigirSolicitacao:true,
        acao:action,
        solicitadaEm,
        identidadeEsperada:identidade
      });
      const diagnostic=await diagnosticar();
      db.close((closeError)=>{
        console.log(JSON.stringify({
          fixture:{
            id:String(fixture.id),
            idempotencyKey:identidade.idempotency_key,
            identidade,
            acao:action,
            solicitadaEm
          },
          diagnostic,
          solicitacaoConfirmada:solicitacao?.ok===true
            && solicitacao?.duravel===true && solicitacao?.confirmada===true,
          respostaConfirmada:resposta?.ok===true
            && resposta?.duravel===true && resposta?.confirmada===true,
          closeError:closeError?.message||null
        }));
        process.exit(closeError?1:0);
      });
    }).catch(error=>{
      console.log(JSON.stringify({erro:error.message}));
      process.exit(1);
    });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      CDS_TEST_ISOLAR_BANCO: '1',
      DB_DIR: dbDir,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0',
      NODE_ENV: 'test'
    },
    timeout: 90000
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const lines = (child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const result = JSON.parse(lines[index]);
      assert.strictEqual(result.solicitacaoConfirmada, true, JSON.stringify(result));
      assert.strictEqual(result.respostaConfirmada, true, JSON.stringify(result));
      assert.strictEqual(result.closeError, null, JSON.stringify(result));
      return result;
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
  }
  assert.fail(child.stderr || 'Processo pai não produziu confirmação JSON');
}

async function persistirResposta(fixture, resposta = 'Credito') {
  const grava = await persistencia.registrarRespostaOperador(fixture.id, {
    resposta,
    incrementarContinue: true,
    exigirSolicitacao: true,
    acao: fixture.acao,
    solicitadaEm: fixture.solicitadaEm,
    identidadeEsperada: fixture.identidade
  });
  return grava;
}

function montarScriptFilho({ mode, fixture, timestamp, dbDir }) {
  const identity = JSON.stringify(fixture.identidade);
  const action = JSON.stringify(fixture.acao);
  const transactionId = JSON.stringify(fixture.id);
  const idempotencyKey = JSON.stringify(fixture.idempotencyKey);
  const timestampValue = timestamp === undefined ? 'undefined' : JSON.stringify(timestamp);
  const script = `
    const path=require('path');
    const ROOT=${JSON.stringify(ROOT)};
    const mode=${JSON.stringify(mode)};
    const id=${transactionId};
    const timestamp=${timestampValue};
    const identity=${identity};
    const action=${action};
    const idempotencyKey=${idempotencyKey};
    const db=require(path.join(ROOT,'backend/database.js'));
    const persistencia=require(path.join(ROOT,'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js'));
    const Adapter=require(path.join(ROOT,'backend/services/tef/adapters/DestaxaRealAdapter.js'));
    const counters={inicia:0,continua:0,finaliza:0};
    const bridge={
      async iniciarTransacaoDestaxa(){counters.inicia++;throw new Error('TX_START proibido');},
      async continuarTransacaoDestaxa(){
        counters.continua++;
        return {
          sucesso:false,
          codigoDestaxa:'99',
          classificacao:'ACTION_REQUIRED',
          requerContinuacao:true,
          acao:action
        };
      },
      async finalizarTransacaoDestaxa(){counters.finaliza++;throw new Error('FINALIZE proibido');}
    };
    const adapter=new Adapter({}, {bridge,executionMode:'in-process'});
    function ready(){return new Promise((resolve,reject)=>db.whenReady(e=>e?reject(e):resolve()));}
    function get(handle,sql,params=[]){return new Promise((resolve,reject)=>handle.get(sql,params,(e,r)=>e?reject(e):resolve(r||null)));}
    function stat(p){const s=require('fs').statSync(p);return {dev:s.dev,ino:s.ino,size:s.size};}
    ready().then(async()=>{
      const dbPath=path.resolve(db.dbPath);
      const diagnostic={
        pid:process.pid,
        caminho:dbPath,
        identidadeArquivo:stat(dbPath),
        databaseList:await get(db,'PRAGMA database_list'),
        journalMode:await get(db,'PRAGMA journal_mode'),
        busyTimeout:await get(db,'PRAGMA busy_timeout'),
        synchronous:await get(db,'PRAGMA synchronous')
      };
      if(mode==='falha-leitura-resposta'){
        persistencia.recuperarRespostaOperador=async()=>{throw new Error('falha de leitura injetada');};
      }
      if(mode==='falha-recuperacao'){
        persistencia.recuperarSolicitacao99=async()=>{throw new Error('falha de recuperação injetada');};
      }
      if(mode==='banco-inacessivel'){
        persistencia.recuperarSolicitacao99=async()=>{
          const error=new Error('SQLite indisponível no processo filho');
          error.code='SQLITE_CANTOPEN';
          throw error;
        };
      }
      let provaResposta=null;
      if(mode==='valido' || mode==='replay'){
        try{
          provaResposta=await persistencia.recuperarRespostaOperador(id,{
            solicitadaEm:timestamp,acao:action,identidadeEsperada:identity
          });
        }catch(e){provaResposta={ok:false,codigo:'LEITURA_FALHOU'};}
      }
      const request={
        transacao_id:id,
        idempotency_key:mode==='identidade-divergente'?'chave_divergente':idempotencyKey,
        idempotency_key_persistida:idempotencyKey,
        exigirRespostaPersistida:mode==='resposta-confirmada-ausente',
        identidadePersistida:mode==='identidade-divergente'
          ? {...identity,fingerprint:'fingerprint_divergente'}:identity,
        acao:mode==='acao-divergente'?{...action,opcoes:['Voucher']}:action,
        resposta_continuidade:mode==='resposta-confirmada-ausente'?'Credito':undefined,
        solicitadaEm:mode==='timestamp-ausente'?undefined:
          (mode==='timestamp-invalido'?'timestamp-invalido':
          (mode==='timestamp-divergente'?'2001-01-01T00:00:00.000Z':timestamp)),
        ambienteOperador:{tty:true}
      };
      let result;
      try{
        result=await adapter.continuarPagamento(request);
      }catch(e){
        result={sucesso:false,codigo:e.code||e.codigo||'EXCECAO',mensagem:e.message};
      }
      console.log(JSON.stringify({
        modo:mode,
        codigo:result?.codigo||null,
        mensagem:result?.mensagem||null,
        sucesso:result?.sucesso===true,
        mensagem:result?.mensagem||null,
        requerContinuacao:result?.requerContinuacao===true,
        respostaEncontrada:provaResposta?.ok===true,
        codigoResposta:provaResposta?.codigo||null,
        mensagemResposta:provaResposta?.mensagem||null,
        identidadeRespostaCompleta:Boolean(provaResposta?.identidade?.transactionId
          && provaResposta?.identidade?.operation_id
          && provaResposta?.identidade?.idempotency_key
          && provaResposta?.identidade?.fingerprint),
        contadores:counters,
        diagnostic
      }));
      process.exit(0);
    }).catch(e=>{
      console.log(JSON.stringify({
        modo,
        erro:e.message,
        contadores:counters,
        diagnostic:{caminho:db.dbPath||null}
      }));
      process.exit(0);
    });
  `;
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      CDS_TEST_ISOLAR_BANCO: '1',
      DB_DIR: dbDir || DB_DIR,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0',
      NODE_ENV: 'test'
    },
    timeout: 90000
  });
}

function executarFilho(config) {
  const child = montarScriptFilho(config);
  assert.strictEqual(child.error, undefined, child.error?.message);
  const lines = (child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }
  assert.fail(child.stderr || 'Processo filho não produziu diagnóstico JSON');
}

function provarLeituraReadOnlyNaoCommitada(fixture, payloadOriginalHash) {
  const script = `
    const path=require('path');
    const crypto=require('crypto');
    const sqlite3=require('sqlite3').verbose();
    const dbPath=path.join(${JSON.stringify(DB_DIR)},'mercadao.db');
    const id=${JSON.stringify(fixture.id)};
    const expectedHash=${JSON.stringify(payloadOriginalHash)};
    const counters={inicia:0,continua:0,finaliza:0};
    const db=new sqlite3.Database(dbPath,sqlite3.OPEN_READONLY,(openError)=>{
      if(openError){
        console.log(JSON.stringify({erro:openError.code||openError.message,contadores:counters}));
        process.exit(0);
      }
      db.get('SELECT payload_retorno FROM tef_transacoes WHERE id = ?',[id],(error,row)=>{
        const observed=error?null:crypto.createHash('sha256')
          .update(String(row?.payload_retorno||'')).digest('hex');
        db.close(()=> {
          console.log(JSON.stringify({
            caminho:path.resolve(dbPath),
            payloadOriginalVisivel:observed===expectedHash,
            erro:error?.code||null,
            contadores:counters
          }));
        });
      });
    });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, CDS_TEST_ISOLAR_BANCO: '1', DB_DIR, NODE_ENV: 'test' },
    timeout: 30000
  });
  assert.strictEqual(child.error, undefined, child.error?.message);
  const lines = (child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }
  assert.fail(child.stderr || 'Leitor somente leitura não produziu diagnóstico JSON');
}

function assertBloqueio(nome, resultado) {
  assert.notStrictEqual(resultado.sucesso, true, `${nome}: fluxo deveria falhar fechado`);
  assert.deepStrictEqual(resultado.contadores, { inicia: 0, continua: 0, finaliza: 0 }, nome);
  resultados.push({
    cenario: nome,
    resultado: 'PASSOU',
    codigo: resultado.codigo || resultado.erro || null,
    contadores: resultado.contadores
  });
}

async function corromperResposta(fixture) {
  const transacao = await persistencia.buscarTransacao(fixture.id);
  const payload = { ...(transacao.payload_retorno || {}) };
  const continuidade = persistencia.obterBlocoContinuidade(payload);
  continuidade.respostas[0].resposta = { informacao: 'Debito' };
  payload.continuidade = continuidade;
  await new Promise((resolve, reject) => {
    repository.atualizarTransacao(fixture.id, {
      status: 'pendente',
      payload_retorno: payload
    }, (error) => (error ? reject(error) : resolve()));
  });
}

async function removerRespostaPreservandoRespondida(fixture) {
  const transacao = await persistencia.buscarTransacao(fixture.id);
  const payload = { ...(transacao.payload_retorno || {}) };
  const continuidade = persistencia.obterBlocoContinuidade(payload);
  continuidade.estado = 'RESPONDIDA';
  continuidade.respostas = [];
  payload.continuidade = continuidade;
  await new Promise((resolve, reject) => {
    repository.atualizarTransacao(fixture.id, {
      status: 'pendente',
      payload_retorno: payload
    }, (error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  process.env[REAL_TRANSACTION_ENV] = '0';
  assert.strictEqual(transacaoRealHabilitada(), false);
  await whenReady();

  const dbPath = path.resolve(db.dbPath);
  const parentStat = fs.statSync(dbPath);
  const parent = {
    pid: process.pid,
    caminho: dbPath,
    identidadeArquivo: { dev: parentStat.dev, ino: parentStat.ino, size: parentStat.size },
    databaseList: await dbGet(db, 'PRAGMA database_list'),
    journalMode: await dbGet(db, 'PRAGMA journal_mode'),
    busyTimeout: await dbGet(db, 'PRAGMA busy_timeout'),
    synchronous: await dbGet(db, 'PRAGMA synchronous')
  };

  const dbDirInterprocesso = path.join(DB_DIR, 'pai-filho');
  const pai = criarFixtureNoProcessoPai(dbDirInterprocesso);
  const valido = pai.fixture;
  const gravacao = {
    ok: pai.respostaConfirmada,
    duravel: pai.respostaConfirmada,
    confirmada: pai.respostaConfirmada
  };
  const filhoValido = executarFilho({
    mode: 'valido',
    fixture: valido,
    timestamp: valido.solicitadaEm,
    dbDir: dbDirInterprocesso
  });
  assert.strictEqual(filhoValido.respostaEncontrada, true, JSON.stringify(filhoValido));
  assert.strictEqual(filhoValido.identidadeRespostaCompleta, true);
  assert.strictEqual(filhoValido.requerContinuacao, true, JSON.stringify(filhoValido));
  assert.notStrictEqual(filhoValido.sucesso, true);
  assert.strictEqual(filhoValido.contadores.inicia, 0);
  assert.strictEqual(filhoValido.contadores.continua, 1);
  assert.strictEqual(filhoValido.contadores.finaliza, 0);
  assert.strictEqual(filhoValido.diagnostic.caminho, pai.diagnostic.caminho);
  assert.strictEqual(filhoValido.diagnostic.identidadeArquivo.dev, pai.diagnostic.identidadeArquivo.dev);
  assert.strictEqual(filhoValido.diagnostic.identidadeArquivo.ino, pai.diagnostic.identidadeArquivo.ino);
  assert.notStrictEqual(filhoValido.diagnostic.pid, pai.diagnostic.pid);
  assert.notStrictEqual(pai.diagnostic.pid, process.pid);
  resultados.push({
    cenario: 'Processo filho recupera resposta confirmada pelo pai no mesmo SQLite',
    resultado: 'PASSOU',
    pai: pai.diagnostic,
    filho: filhoValido.diagnostic,
    processoPaiEncerradoAntesDoFilho: true,
    respostaRecuperada: filhoValido.respostaEncontrada,
    continuacaoSolicitada: filhoValido.requerContinuacao,
    sucessoFinanceiroImplicito: filhoValido.sucesso,
    despachoExatamenteUmaVez: filhoValido.contadores.continua === 1,
    contadores: filhoValido.contadores
  });

  assertBloqueio('Replay depois da reserva durável de despacho', executarFilho({
    mode: 'replay',
    fixture: valido,
    timestamp: valido.solicitadaEm,
    dbDir: dbDirInterprocesso
  }));

  const semResposta = await criarFixture();
  assertBloqueio('Resposta inexistente no processo filho', executarFilho({
    mode: 'sem-resposta',
    fixture: semResposta,
    timestamp: semResposta.solicitadaEm,
    dbDir: DB_DIR
  }));

  const respostaConfirmadaAusente = await criarFixture();
  const gravacaoAusente = await persistirResposta(respostaConfirmadaAusente);
  assert.strictEqual(gravacaoAusente.ok, true, gravacaoAusente.mensagem);
  await removerRespostaPreservandoRespondida(respostaConfirmadaAusente);
  assertBloqueio('Estado RESPONDIDA sem a resposta persistida', executarFilho({
    mode: 'resposta-confirmada-ausente',
    fixture: respostaConfirmadaAusente,
    timestamp: respostaConfirmadaAusente.solicitadaEm,
    dbDir: DB_DIR
  }));

  const bancoDivergente = path.join(DB_DIR, 'outro-banco');
  assertBloqueio('Caminho SQLite divergente', executarFilho({
    mode: 'banco-divergente',
    fixture: semResposta,
    timestamp: semResposta.solicitadaEm,
    dbDir: bancoDivergente
  }));

  for (const [mode, label] of [
    ['timestamp-ausente', 'Timestamp ausente'],
    ['timestamp-invalido', 'Timestamp inválido'],
    ['timestamp-divergente', 'Timestamp divergente'],
    ['identidade-divergente', 'Identidade completa divergente'],
    ['acao-divergente', 'Ação divergente']
  ]) {
    assertBloqueio(label, executarFilho({
      mode,
      fixture: valido,
      timestamp: valido.solicitadaEm,
      dbDir: DB_DIR
    }));
  }

  const expirado = await criarFixture({
    action: { ...ACAO, timeout: '1' },
    timestamp: new Date(Date.now() - 5000).toISOString()
  });
  const respostaExpirada = await persistirResposta(expirado);
  assert.strictEqual(respostaExpirada.ok, true, respostaExpirada.mensagem);
  assertBloqueio('Timestamp original expirado', executarFilho({
    mode: 'expirado',
    fixture: expirado,
    timestamp: expirado.solicitadaEm,
    dbDir: DB_DIR
  }));

  const payloadInvalido = await criarFixture();
  const gravacaoPayload = await persistirResposta(payloadInvalido);
  assert.strictEqual(gravacaoPayload.ok, true, gravacaoPayload.mensagem);
  await corromperResposta(payloadInvalido);
  assertBloqueio('Payload persistido inválido', executarFilho({
    mode: 'payload-invalido',
    fixture: payloadInvalido,
    timestamp: payloadInvalido.solicitadaEm,
    dbDir: DB_DIR
  }));

  assertBloqueio('Falha de releitura da resposta', executarFilho({
    mode: 'falha-leitura-resposta',
    fixture: valido,
    timestamp: valido.solicitadaEm,
    dbDir: DB_DIR
  }));
  assertBloqueio('Falha ao recuperar solicitação pendente', executarFilho({
    mode: 'falha-recuperacao',
    fixture: valido,
    timestamp: valido.solicitadaEm,
    dbDir: DB_DIR
  }));
  assertBloqueio('SQLite inacessível ao processo filho', executarFilho({
    mode: 'banco-inacessivel',
    fixture: valido,
    timestamp: valido.solicitadaEm,
    dbDir: DB_DIR
  }));

  const naoCommitada = await criarFixture();
  const payloadOriginal = await dbGet(
    db,
    'SELECT payload_retorno FROM tef_transacoes WHERE id = ?',
    [naoCommitada.id]
  );
  const payloadOriginalHash = crypto.createHash('sha256')
    .update(String(payloadOriginal?.payload_retorno || ''))
    .digest('hex');
  await dbRun(db, 'BEGIN IMMEDIATE');
  const gravacaoNaoCommitada = await persistirResposta(naoCommitada);
  assert.notStrictEqual(gravacaoNaoCommitada.ok, true);
  const leituraNaoCommitada = provarLeituraReadOnlyNaoCommitada(
    naoCommitada,
    payloadOriginalHash
  );
  assert.strictEqual(leituraNaoCommitada.payloadOriginalVisivel, true);
  assert.deepStrictEqual(leituraNaoCommitada.contadores, {
    inicia: 0,
    continua: 0,
    finaliza: 0
  });
  await dbRun(db, 'ROLLBACK');
  resultados.push({
    cenario: 'Persistência não confirmada em outra conexão enquanto transação não commitada',
    resultado: 'PASSOU',
    persistenciaPaiConfirmada: false,
    respostaNaoVisivelNoFilho: leituraNaoCommitada.payloadOriginalVisivel,
    contadoresFilho: leituraNaoCommitada.contadores
  });

  const report = {
    sprint: 'MRT-50.8',
    classificacao: 'TESTADO',
    escopo: 'SQLite temporário e drivers mockados; nenhuma operação financeira real',
    gateFinanceiro: transacaoRealHabilitada() ? 'ON' : 'OFF',
    dllDestaxaAcessada: false,
    bancoOficialAcessado: false,
    databasePai: pai.diagnostic,
    databaseRunner: parent,
    resultadoProcessoFilhoValido: filhoValido.diagnostic,
    gravacaoRespostaPai: {
      ok: gravacao.ok,
      duravel: gravacao.duravel,
      confirmada: gravacao.confirmada
    },
    causas: {
      comprovada: 'O pai e o filho usam o mesmo arquivo SQLite. O replay não transmitia solicitadaEm e TefManager substituía o timestamp original pelo da solicitação 99 corrente.',
      correcao: 'Timestamp original obrigatório e comparado de ponta a ponta; resposta e reserva de despacho são confirmadas por conexão SQLite independente, com estado de uso único.'
    },
    resultados: resultados,
    totalCenarios: resultados.length,
    regressaoMrt40Completada: null,
    regressaoMrt507Completada: null,
    outrasRegressoes: 'Executar e registrar separadamente; este arquivo cobre os cenários interprocessos MRT-50.8.'
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`MRT-50.8: ${resultados.length} cenários aprovados; relatório ${REPORT_PATH}`);

  await persistencia.limparRegistrosTesteMrt40();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
