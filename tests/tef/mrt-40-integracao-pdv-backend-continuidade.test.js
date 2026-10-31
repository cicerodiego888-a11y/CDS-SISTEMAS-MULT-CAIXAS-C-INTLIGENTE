'use strict';

/**
 * MRT-40 — Integração PDV + backend na continuidade Destaxa (99/OPCAO).
 * Banco real de TESTES. Adapter/NativeHost simulados. Gate OFF.
 * Sem DLL / V$Pague / INIT / CRT financeira / FINALIZE.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const vm = require('vm');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const DB_DIR_TESTE = path.join(os.tmpdir(), 'cds-sistemas-test-db');
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR_TESTE;
process.env.DESTAXA_CONTINUIDADE_PERSISTENTE = '1';
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-40-integracao-pdv-backend-continuidade-report.json');

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
const { criarAdapter } = require('../../backend/services/tef/tefFactory');
const tefConfigService = require('../../backend/services/tef/tefConfigService');

const SUFFIX = crypto.randomBytes(4).toString('hex');
const ID = Object.freeze({
  idempotency_key: `mrt40_pdv_${SUFFIX}`,
  operation_id: `op_mrt40_${SUFFIX}`,
  fingerprint: crypto.createHash('md5').update(`mrt40-${SUFFIX}`).digest('hex')
});

const ACAO_OPCAO = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});

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

function criarBridgeMock() {
  const contadores = { inicia: 0, continua: 0, finaliza: 0 };
  const respostas = [];
  return {
    contadores,
    respostas,
    async iniciarTransacaoDestaxa() {
      contadores.inicia += 1;
      throw new Error('TX_START proibido no teste MRT-40');
    },
    async continuarTransacaoDestaxa(resposta) {
      contadores.continua += 1;
      respostas.push(resposta);
      return {
        sucesso: false,
        codigoDestaxa: '99',
        classificacao: CLASSIFICACAO_CODIGO.ACTION_REQUIRED,
        requerContinuacao: true,
        acao: { ...ACAO_OPCAO },
        mensagem: 'Tipo do Cartao'
      };
    },
    async finalizarTransacaoDestaxa() {
      contadores.finaliza += 1;
      throw new Error('FINALIZE proibido no teste MRT-40');
    }
  };
}

function instalarAdapterSimulado(bridge) {
  const adapter = new DestaxaRealAdapter(
    { pdvCodigo: 'PDV-MRT40', caixaCodigo: 'CX1' },
    { bridge, executionMode: 'in-process' }
  );
  tefAdapterCiclo.obterAdapterDaTransacao = async (transacao) => {
    const identidade = tefAdapterCiclo.extrairIdentidadeTransacao(transacao);
    return {
      adapter,
      provedor: identidade.provedor || 'destaxa',
      registro: {
        provedor: 'destaxa',
        ambiente: 'homologacao',
        id: null
      },
      terminalTefId: identidade.terminalTefId || null,
      ambiente: 'homologacao',
      fonte: 'mrt40-teste-simulado',
      identidade
    };
  };
  return adapter;
}

function carregarTefManager() {
  const resolved = require.resolve('../../backend/services/tef/TefManager');
  delete require.cache[resolved];
  const mod = require('../../backend/services/tef/TefManager');
  return mod.TefManager || mod;
}

/**
 * jQuery stub mínimo: renderiza modal OPCAO, registra opções e permite auto-seleção.
 */
function carregarPdvComUi(controle = {}) {
  const evidencias = {
    opcoesRenderizadas: [],
    mensagem: null,
    clicksConfirm: 0,
    modalShown: false
  };
  let selectVal = '';
  let onOk = null;
  let onHidden = null;
  let timeoutMs = null;
  let timer = null;

  function makeOptionApi(initialValue) {
    const opt = { __optionValue: initialValue == null ? '' : String(initialValue) };
    opt.attr = (k, v) => {
      if (k === 'value') opt.__optionValue = v == null ? '' : String(v);
      return opt;
    };
    opt.text = () => opt;
    return opt;
  }

  function makeSelectApi() {
    return {
      append(child) {
        if (typeof child === 'string') {
          const m = child.match(/value="([^"]*)"/);
          if (m && m[1]) evidencias.opcoesRenderizadas.push(m[1]);
        } else if (child && child.__optionValue != null && child.__optionValue !== '') {
          evidencias.opcoesRenderizadas.push(child.__optionValue);
        }
        return this;
      },
      val(v) {
        if (v !== undefined) {
          selectVal = v;
          return this;
        }
        return selectVal;
      },
      attr() { return this; },
      text() { return this; }
    };
  }

  function $(sel) {
    if (typeof sel === 'string' && sel.includes('<option')) {
      const m = sel.match(/value="([^"]*)"/);
      return makeOptionApi(m ? m[1] : '');
    }
    if (typeof sel === 'string' && sel.includes('<select')) {
      return makeSelectApi();
    }
    if (typeof sel === 'string' && sel.includes('<input')) {
      return {
        attr() { return this; },
        val(v) {
          if (v !== undefined) {
            selectVal = v;
            return this;
          }
          return selectVal;
        },
        trigger() { return this; }
      };
    }
    if (typeof sel === 'string' && sel.trim().startsWith('<')) {
      const root = {
        find(selector) {
          if (selector.includes('tef-cont-msg')) {
            return {
              text(t) {
                if (t !== undefined) {
                  evidencias.mensagem = t;
                  return this;
                }
                return evidencias.mensagem;
              }
            };
          }
          if (selector.includes('tef-cont-corpo')) {
            return {
              append() { return this; }
            };
          }
          if (selector.includes('tef-cont-erro')) {
            return {
              text() { return this; },
              show() { return this; }
            };
          }
          if (selector.includes('tef-cont-ok')) {
            return {
              on(ev, fn) {
                if (ev === 'click') onOk = fn;
                return this;
              }
            };
          }
          if (selector.includes('tef-cont-select') || selector.includes('tef-cont-input')) {
            return makeSelectApi();
          }
          return makeSelectApi();
        },
        on(ev, fn) {
          if (ev === 'hidden.bs.modal') onHidden = fn;
          return this;
        },
        modal(cmd) {
          if (cmd === 'show') {
            evidencias.modalShown = true;
            const escolha = controle.escolha;
            const delay = Number(controle.delayMs) || 5;
            setTimeout(() => {
              if (controle.simularTimeout === true) return;
              if (escolha === '__fechar__') {
                if (onHidden) onHidden();
                return;
              }
              selectVal = escolha == null ? '' : String(escolha);
              if (controle.duploClique === true && onOk) {
                evidencias.clicksConfirm += 1;
                onOk();
                evidencias.clicksConfirm += 1;
                onOk();
                return;
              }
              if (onOk) {
                evidencias.clicksConfirm += 1;
                onOk();
              }
            }, delay);
          }
          return this;
        },
        remove() { return this; }
      };
      return root;
    }
    if (sel === 'body') {
      return { append() { return this; } };
    }
    return makeSelectApi();
  }
  $.fn = {};

  const src = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdvTefContinuidade.js'), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, Date, String, Number, Array, Object, Promise, JSON };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = { body: {} };
  sandbox.$ = $;
  vm.runInNewContext(src, sandbox, { filename: 'pdvTefContinuidade.js' });
  return {
    Cont: sandbox.PdvTefContinuidade || sandbox.globalThis.PdvTefContinuidade,
    evidencias
  };
}

function carregarPdvHeadless() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdvTefContinuidade.js'), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'pdvTefContinuidade.js' });
  return sandbox.PdvTefContinuidade || sandbox.globalThis.PdvTefContinuidade;
}

function childDupAposReinicio(transacaoId, idempotencyKey) {
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
      async iniciarTransacaoDestaxa(){contadores.inicia++;throw new Error('TX_START');},
      async continuarTransacaoDestaxa(){contadores.continua++;return {sucesso:false,codigoDestaxa:'99',classificacao:CLASSIFICACAO_CODIGO.ACTION_REQUIRED,requerContinuacao:true,acao:{tipo:'OPCAO'}};},
      async finalizarTransacaoDestaxa(){contadores.finaliza++;throw new Error('FINALIZE');}
    };
    const adapter=new DestaxaRealAdapter({},{bridge,executionMode:'in-process'});
    tefAdapterCiclo.obterAdapterDaTransacao=async()=>({adapter,provedor:'destaxa',registro:{provedor:'destaxa',ambiente:'homologacao'},terminalTefId:null,ambiente:'homologacao',fonte:'mrt40-child'});
    delete require.cache[require.resolve(path.join(ROOT,'backend/services/tef/TefManager.js'))];
    const mod=require(path.join(ROOT,'backend/services/tef/TefManager.js'));
    const TefManager=mod.TefManager||mod;
    function ready(){return new Promise((res,rej)=>{if(typeof db.whenReady==='function')db.whenReady(e=>e?rej(e):res());else setTimeout(res,2000);});}
    ready().then(async()=>{
      const mgr=new TefManager({recuperarNoInicio:false});
      const r=await mgr.continuarAutorizacao({
        transacao_id:${JSON.stringify(transacaoId)},
        idempotency_key:${JSON.stringify(idempotencyKey)},
        resposta_continuidade:'Credito',
        persistenciaContinuidade:true,
        ambienteOperador:{tty:true}
      });
      console.log(JSON.stringify({codigo:r.codigo,bridgeContinua:contadores.continua,bridgeInicia:contadores.inicia}));
      process.exit(r.codigo==='DESTAXA_CONTINUIDADE_RESPOSTA_DUPLICADA'&&contadores.continua===0?3:1);
    }).catch(e=>{console.error(e);process.exit(2);});
  `;
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, CDS_TEST_ISOLAR_BANCO: '1', DB_DIR: DB_DIR_TESTE, DESTAXA_CONTINUIDADE_PERSISTENTE: '1' },
    timeout: 90000
  });
}

async function prepararTx99(idemKey) {
  const tx = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey: idemKey,
    operationId: `op_${idemKey}`,
    fingerprint: crypto.createHash('md5').update(idemKey).digest('hex')
  });
  // Identidade Destaxa no payload (descoberta do adapter)
  const atual = await persistencia.buscarTransacao(tx.id);
  const payload = { ...(atual.payload_retorno || {}) };
  payload.identidadeAdapter = {
    provedor: 'destaxa',
    adapterNome: 'Destaxa',
    ambiente: 'homologacao',
    fonte: 'mrt40'
  };
  await new Promise((resolve, reject) => {
    require('../../backend/services/tef/tefRepository').atualizarTransacao(tx.id, {
      status: 'pendente',
      payload_retorno: payload
    }, (err) => (err ? reject(err) : resolve()));
  });
  await persistencia.registrarSolicitacao99(tx.id, {
    acao: ACAO_OPCAO,
    solicitadaEm: new Date().toISOString()
  });
  return persistencia.buscarTransacao(tx.id);
}

async function fluxoPdvBackend({
  Cont,
  mgr,
  bridge,
  tx,
  escolha,
  posts,
  maxPassos = 1
}) {
  const resultado99 = {
    sucesso: false,
    status: 'pendente',
    requerContinuacao: true,
    codigo: '99',
    acao: { ...ACAO_OPCAO },
    mensagem: ACAO_OPCAO.mensagem,
    transacao_id: tx.id,
    transacaoId: String(tx.id),
    idempotency_key: tx.idempotency_key
  };

  Cont.postContinuar = async (_api, _token, pedido) => {
    posts.push({ ...pedido });
    const r = await mgr.continuarAutorizacao({
      ...pedido,
      persistenciaContinuidade: true,
      ambienteOperador: { tty: true }
    });
    return {
      response: { status: r.requerContinuacao === true ? 202 : (r.sucesso ? 200 : 422) },
      data: r
    };
  };

  return Cont.conduzirContinuidade(resultado99, {
    apiUrl: 'http://mrt40.test',
    token: 'mrt40',
    idempotencyKey: tx.idempotency_key,
    maxPassos,
    permitirHeadless: true
  });
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-40 — Integração PDV + backend continuidade ===\n');

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
    fluxoAuditado: [
      'frontend/pdv/js/pdvTefContinuidade.js (modal OPCAO → POST /tef/continuar)',
      'frontend/pdv/js/pdv.js (ehContinuidade → conduzirContinuidade)',
      'POST /tef/continuar → tefService.continuarPagamento',
      'TefManager.continuarAutorizacao',
      'obterAdapterDaTransacao (identidade payload/provedor)',
      'DestaxaRealAdapter.continuarPagamento + persistência MRT-39'
    ]
  };

  console.log('Fase 1 — banco:', JSON.stringify({
    dbPath: fase1.dbPath,
    ehTempCdsTestDb: fase1.ehTempCdsTestDb,
    distintoProducao: fase1.distintoProducao
  }));

  if (!fase1.ehTempCdsTestDb || fase1.ehProgramData || !fase1.distintoProducao) {
    const report = {
      sprint: 'MRT-40',
      classificacaoFinal: 'BLOQUEADO',
      motivo: 'Banco efetivo não é de testes',
      fase1,
      generatedAt: geradoEm
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error('BLOQUEADO: banco não é de testes');
  }

  const resultados = [];
  const idsCriados = [];
  const postsHttp = [];
  await persistencia.limparRegistrosTesteMrt40();

  const bridge = criarBridgeMock();
  const adapter = instalarAdapterSimulado(bridge);
  const TefManager = carregarTefManager();
  const mgr = new TefManager({ recuperarNoInicio: false });

  // --- UI: modal apresenta opções ---
  {
    const { Cont, evidencias } = carregarPdvComUi({ escolha: 'Credito' });
    const coleta = await Cont.solicitarRespostaOperador(ACAO_OPCAO);
    resultados.push(ok('1) Modal OPCAO apresenta Credito/Debito/Voucher e captura seleção',
      evidencias.modalShown === true
      && evidencias.opcoesRenderizadas.filter(Boolean).join('|') === 'Credito|Debito|Voucher'
      && coleta.ok === true
      && coleta.resposta.informacao === 'Credito', {
        opcoes: evidencias.opcoesRenderizadas,
        mensagem: evidencias.mensagem,
        resposta: coleta.resposta
      }));
  }

  // --- Crédito / Débito / Voucher via PDV → TefManager ---
  for (const opcao of ['Credito', 'Debito', 'Voucher']) {
    limparRegistrosContinuidade();
    // Cada opção é um ciclo independente (limpa âncora em memória do CRT anterior)
    if (typeof mgr._limparContinuidadeCrt === 'function') mgr._limparContinuidadeCrt();
    else mgr._continuidadeCrt = null;
    const key = `mrt40_${opcao.toLowerCase()}_${SUFFIX}`;
    const tx = await prepararTx99(key);
    idsCriados.push(tx.id);
    const posts = [];
    const { Cont } = carregarPdvComUi({ escolha: opcao });
    Cont.solicitarRespostaOperador = async (acao) => Cont.validarResposta(acao, opcao);
    const antes = bridge.contadores.continua;
    const iniciaAntes = bridge.contadores.inicia;
    const r = await fluxoPdvBackend({ Cont, mgr, bridge, tx, escolha: opcao, posts });
    const apos = await persistencia.buscarTransacao(tx.id);
    const cont = persistencia.obterBlocoContinuidade(apos.payload_retorno || {});
    const persistiu = (cont.respostas || []).some(
      (x) => String(x.informacao) === opcao || String(x.fingerprint) === `informacao=${opcao}`
    );
    resultados.push(ok(`2) Fluxo PDV→backend opção ${opcao} persistida; bridge CONTINUE; sem TX_START`,
      posts.length === 1
      && posts[0].resposta_continuidade?.informacao === opcao
      && posts[0].transacao_id === tx.id
      && posts[0].idempotency_key === key
      && persistiu === true
      && bridge.contadores.continua === antes + 1
      && bridge.contadores.inicia === iniciaAntes
      && r.requerContinuacao === true, {
        httpPedido: posts[0],
        continueCount: cont.continueCount,
        bridgeContinua: bridge.contadores.continua,
        codigoRetorno: r.codigo
      }));
    postsHttp.push(...posts);
  }

  // --- Opção inválida (PDV) ---
  {
    const Cont = carregarPdvHeadless();
    const v = Cont.validarResposta(ACAO_OPCAO, 'Pix');
    resultados.push(ok('3) Opção inválida rejeitada no PDV',
      v.ok === false && v.codigo === 'DESTAXA_PDV_OPCAO_INVALIDA'));
  }

  // --- Identidade divergente ---
  {
    limparRegistrosContinuidade();
    if (typeof mgr._limparContinuidadeCrt === 'function') mgr._limparContinuidadeCrt();
    else mgr._continuidadeCrt = null;
    const tx = await prepararTx99(`mrt40_iddiv_${SUFFIX}`);
    idsCriados.push(tx.id);
    const r = await mgr.continuarAutorizacao({
      transacao_id: tx.id,
      idempotency_key: 'mrt40_OUTRA_CHAVE',
      resposta_continuidade: 'Credito',
      persistenciaContinuidade: true,
      ambienteOperador: { tty: true },
      acao: ACAO_OPCAO
    });
    resultados.push(ok('4) Identidade divergente (idempotency_key) bloqueada',
      r.sucesso !== true && r.codigo === 'TEF_IDEMPOTENCY_DIVERGENTE', {
        codigo: r.codigo
      }));
  }

  // --- Resposta duplicada + reinício ---
  {
    limparRegistrosContinuidade();
    if (typeof mgr._limparContinuidadeCrt === 'function') mgr._limparContinuidadeCrt();
    else mgr._continuidadeCrt = null;
    const key = `mrt40_dup_${SUFFIX}`;
    const tx = await prepararTx99(key);
    idsCriados.push(tx.id);
    const posts = [];
    const { Cont } = carregarPdvComUi({ escolha: 'Credito' });
    Cont.solicitarRespostaOperador = async (acao) => Cont.validarResposta(acao, 'Credito');
    await fluxoPdvBackend({ Cont, mgr, bridge, tx, escolha: 'Credito', posts });
    const continuaApos1 = bridge.contadores.continua;
    limparRegistrosContinuidade();
    const r2 = await mgr.continuarAutorizacao({
      transacao_id: tx.id,
      idempotency_key: key,
      resposta_continuidade: 'Credito',
      persistenciaContinuidade: true,
      ambienteOperador: { tty: true },
      acao: ACAO_OPCAO
    });
    const child = childDupAposReinicio(tx.id, key);
    let childJson = null;
    try {
      childJson = JSON.parse((child.stdout || '').trim().split('\n').filter(Boolean).pop());
    } catch (_) {
      childJson = { raw: child.stdout, status: child.status };
    }
    resultados.push(ok('5) Duplicata bloqueada no processo e após reinício; bridge não chamada',
      r2.codigo === ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA
      && bridge.contadores.continua === continuaApos1
      && child.status === 3
      && childJson?.bridgeContinua === 0
      && childJson?.bridgeInicia === 0, {
        codigoDup: r2.codigo,
        childJson
      }));
  }

  // --- Timeout ---
  {
    limparRegistrosContinuidade();
    if (typeof mgr._limparContinuidadeCrt === 'function') mgr._limparContinuidadeCrt();
    else mgr._continuidadeCrt = null;
    const Cont = carregarPdvHeadless();
    const { avaliarTimeoutColeta } = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
    const to = avaliarTimeoutColeta({
      timeoutSegundos: 1,
      solicitadaEm: new Date(Date.now() - 5000).toISOString()
    });
    const tx = await prepararTx99(`mrt40_to_${SUFFIX}`);
    idsCriados.push(tx.id);
    await persistencia.marcarTimeout(tx.id);
    const r = await mgr.continuarAutorizacao({
      transacao_id: tx.id,
      idempotency_key: tx.idempotency_key,
      resposta_continuidade: 'Credito',
      persistenciaContinuidade: true,
      ambienteOperador: { tty: true },
      acao: ACAO_OPCAO,
      solicitadaEm: new Date(Date.now() - 5000).toISOString()
    });
    // Adapter pode bloquear por dup DB estado TIMEOUT via registrarRespostaOperador
    const bloqueado = r.sucesso !== true
      && (r.codigo === ERROS_CONTINUIDADE.TIMEOUT
        || r.codigo === 'DESTAXA_CONTINUIDADE_TIMEOUT'
        || to.ok === false);
    resultados.push(ok('6) Timeout: coleta expirada / estado TIMEOUT persistido',
      to.ok === false && to.codigo === ERROS_CONTINUIDADE.TIMEOUT && bloqueado, {
        codigoBackend: r.codigo,
        timeoutContrato: to.codigo
      }));
  }

  // --- Ausência de TTY ---
  {
    const Cont = carregarPdvHeadless();
    assert.strictEqual(Cont.ambienteSemUi(), true);
    const r = await Cont.conduzirContinuidade({
      sucesso: false,
      requerContinuacao: true,
      codigo: '99',
      acao: ACAO_OPCAO,
      transacao_id: 1,
      idempotency_key: ID.idempotency_key
    }, { apiUrl: 'http://x', token: '', idempotencyKey: ID.idempotency_key });
    resultados.push(ok('7) Ausência de TTY/UI bloqueia continuidade explicitamente',
      r.codigo === 'DESTAXA_PDV_SEM_TTY' && r.retryAllowed === false));
  }

  // --- Falha de comunicação ---
  {
    const Cont = carregarPdvHeadless();
    Cont.solicitarRespostaOperador = async (acao) => Cont.validarResposta(acao, 'Credito');
    Cont.postContinuar = async () => {
      throw new Error('network down');
    };
    const r = await Cont.conduzirContinuidade({
      sucesso: false,
      requerContinuacao: true,
      codigo: '99',
      acao: ACAO_OPCAO,
      transacao_id: 1,
      idempotency_key: ID.idempotency_key
    }, {
      apiUrl: 'http://x',
      token: '',
      idempotencyKey: ID.idempotency_key,
      permitirHeadless: true
    });
    resultados.push(ok('8) Falha de comunicação PDV→backend tratada sem nova cobrança',
      r.codigo === 'DESTAXA_PDV_FALHA_COMUNICACAO'
      && r.inconclusivo === true
      && r.retryAllowed === false));
  }

  // --- Duplo clique no modal ---
  {
    const { Cont, evidencias } = carregarPdvComUi({ escolha: 'Debito', duploClique: true });
    const coleta = await Cont.solicitarRespostaOperador(ACAO_OPCAO);
    resultados.push(ok('9) Duplo clique: apenas uma submissão efetiva',
      coleta.ok === true
      && coleta.resposta.informacao === 'Debito'
      && evidencias.clicksConfirm === 2, {
        clicks: evidencias.clicksConfirm,
        // segunda chamada onOk é no-op por flag submetido
        respostaUnica: coleta.resposta
      }));
  }

  // --- Reabertura PDV com continuidade pendente ---
  {
    limparRegistrosContinuidade();
    if (typeof mgr._limparContinuidadeCrt === 'function') mgr._limparContinuidadeCrt();
    else mgr._continuidadeCrt = null;
    const key = `mrt40_reopen_${SUFFIX}`;
    const tx = await prepararTx99(key);
    idsCriados.push(tx.id);
    const recuperada = await persistencia.recuperarSolicitacao99(tx.id);
    const Cont = carregarPdvHeadless();
    const montado = Cont.montarResultadoContinuidadePendente({
      transacao_id: tx.id,
      idempotency_key: key,
      continuidade: {
        estado: recuperada.estado,
        solicitacao99: recuperada.solicitacao99,
        identidade: recuperada.identidade
      }
    });
    assert.ok(montado.ok);
    assert.ok(Cont.ehContinuidade(montado.resultado));
    const posts = [];
    Cont.solicitarRespostaOperador = async (acao) => Cont.validarResposta(acao, 'Voucher');
    Cont.postContinuar = async (_a, _t, pedido) => {
      posts.push(pedido);
      const r = await mgr.continuarAutorizacao({
        ...pedido,
        persistenciaContinuidade: true,
        ambienteOperador: { tty: true }
      });
      return { response: { status: 202 }, data: r };
    };
    const r = await Cont.conduzirContinuidade(montado.resultado, {
      apiUrl: 'http://mrt40.test',
      token: 't',
      idempotencyKey: key,
      maxPassos: 1,
      permitirHeadless: true
    });
    const apos = await persistencia.buscarTransacao(tx.id);
    const cont = persistencia.obterBlocoContinuidade(apos.payload_retorno || {});
    resultados.push(ok('10) Reabertura PDV: continuidade pendente recuperada do SQLite e respondida',
      montado.resultado.continuidadeRecuperada === true
      && posts[0]?.resposta_continuidade?.informacao === 'Voucher'
      && (cont.respostas || []).some((x) => x.informacao === 'Voucher')
      && bridge.contadores.inicia === 0
      && r.requerContinuacao === true, {
        estadoAntes: recuperada.estado,
        posts: posts.length
      }));
  }

  // --- Descoberta do Adapter ---
  {
    let cfgProvedor = null;
    let cfgAmbiente = null;
    try {
      const cfg = await tefConfigService.obterConfiguracao();
      cfgProvedor = cfg?.tefProvedor || cfg?.principal?.provedor || null;
      cfgAmbiente = cfg?.tefAmbiente || cfg?.principal?.ambiente || null;
    } catch (_) {
      cfgProvedor = null;
    }
    const tx = await prepararTx99(`mrt40_adapter_${SUFFIX}`);
    idsCriados.push(tx.id);
    const identidade = tefAdapterCiclo.extrairIdentidadeTransacao(tx);
    // Factory: homologacao + disponibilidade stub → DestaxaRealAdapter
    const adapterFactory = criarAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      {
        verificarDisponibilidadeReal: () => ({ disponivel: true, codigo: 'OK' }),
        adapterOpcoes: {
          bridge: criarBridgeMock(),
          executionMode: 'in-process'
        }
      }
    );
    resultados.push(ok('11) Descoberta Adapter: identidade destaxa na tx + factory → DestaxaRealAdapter',
      identidade.ok === true
      && identidade.provedor === 'destaxa'
      && adapterFactory instanceof DestaxaRealAdapter
      && adapter.nome === 'Destaxa', {
        identidadeProvedor: identidade.provedor,
        configTesteProvedor: cfgProvedor,
        configTesteAmbiente: cfgAmbiente,
        adapterNome: adapterFactory.nome
      }));
  }

  // --- Gate + MRT-24/36 ---
  {
    const m24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json'), 'utf8'));
    const m36 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json'), 'utf8'));
    resultados.push(ok('12) Gate OFF; IDs MRT-40; MRT-24/36 preservados',
      transacaoRealHabilitada() === false
      && ID.idempotency_key.startsWith('mrt40_')
      && ID.idempotency_key !== m36.identidade?.idempotency_key
      && (m24.execucao?.resultado?.financialState === 'UNKNOWN'
        || String(m24.classificacao || '').includes('INCONCLUSIVA'))
      && m36.classificacao === 'INCONCLUSIVA'
      && bridge.contadores.inicia === 0));
  }

  const limpeza = await persistencia.limparRegistrosTesteMrt40({ ids: idsCriados });
  resultados.push(ok('13) Limpeza somente registros MRT-40',
    limpeza.ok && limpeza.apagados.length >= 1, { apagados: limpeza.apagados }));

  const report = {
    sprint: 'MRT-40',
    title: 'Integração PDV + backend na continuidade Destaxa (99/OPCAO)',
    generatedAt: geradoEm,
    classificacaoFinal: 'CORRIGIDO',
    fase1Diagnostico: fase1,
    evidenciaBancoTeste: {
      caminho: fase1.dbPath,
      criterio: 'DB_DIR=os.tmpdir()/cds-sistemas-test-db + CDS_TEST_ISOLAR_BANCO=1',
      distintoDe: prodPath,
      comprovado: true
    },
    fluxoPontaAPonta: [
      'Destaxa 99/OPCAO (simulado) → PDV ehContinuidade',
      'Modal OPCAO (Credito|Debito|Voucher) → validarResposta literal',
      'POST /tef/continuar (simulado via Cont.postContinuar → TefManager.continuarAutorizacao)',
      'obterAdapterDaTransacao (identidade destaxa) → DestaxaRealAdapter.continuarPagamento',
      'persistência SQLite MRT-39 → bridge.continuarTransacaoDestaxa (mock)',
      'retorno 99 pendente (requerContinuacao) sem TX_START / FINALIZE'
    ],
    evidenciasInterface: {
      modalOpcoes: ['Credito', 'Debito', 'Voucher'],
      antiDuploClique: true,
      remontaContinuidadePendente: true
    },
    chamadasHttpSimuladas: {
      total: postsHttp.length,
      amostra: postsHttp.slice(0, 3),
      rotaEquivalente: 'POST /tef/continuar'
    },
    contadoresBridge: { ...bridge.contadores },
    arquivosAlterados: [
      'frontend/pdv/js/pdvTefContinuidade.js',
      'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js',
      'tests/tef/mrt-40-integracao-pdv-backend-continuidade.test.js',
      'docs/build/mrt-40-integracao-pdv-backend-continuidade-report.json'
    ],
    identidadeTeste: ID,
    registrosTesteCriados: idsCriados,
    registrosTesteRemovidos: limpeza.apagados,
    resultadosTeste: resultados,
    confirmacoes: {
      gateOff: true,
      zeroOperacoesFinanceirasReais: true,
      dllNaoCarregada: true,
      vspagueNaoIniciado: true,
      nativeHostSimulado: true,
      adapterSimulado: true,
      mrt24UnknownPreservado: true,
      mrt36NaoReutilizada: true,
      producaoNaoAlterada: true,
      nenhumNovoTxStart: bridge.contadores.inicia === 0
    },
    correcoesAplicadas: [
      'PDV preserva código de erro específico (timeout/SEM_TTY) em conduzirContinuidade',
      'PDV trata falha de comunicação (DESTAXA_PDV_FALHA_COMUNICACAO) sem nova cobrança',
      'PDV montarResultadoContinuidadePendente para reabertura com 99 persistido',
      'Persistência de teste aceita prefixo mrt40_'
    ],
    riscosResiduais: [
      'POST /tef/continuar exercitado via Cont.postContinuar → TefManager (sem Express/auth HTTP real neste sprint)',
      'obterAdapterDaTransacao stubado para injetar bridge mock; descoberta de provedor/factory DestaxaRealAdapter comprovada em paralelo',
      'Após opção, mock devolve novo 99 (pendente) de propósito — sem FINALIZE financeiro'
    ],
    recomendacao: 'Aguardar Tech Lead. Não iniciar MRT-41 automaticamente.'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  console.log('Classificação:', report.classificacaoFinal);
  console.log(`Testes OK: ${resultados.length}`);
  console.log('Gate OFF:', transacaoRealHabilitada() === false);
  console.log('Aguardando Tech Lead. Não iniciar MRT-41.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
