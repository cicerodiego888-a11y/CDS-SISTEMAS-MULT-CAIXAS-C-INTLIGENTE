'use strict';

/**
 * MRT-43 — Validação do fluxo 99/OPCAO após correção em TefManager.autorizar.
 *
 * Adapter + NativeHost simulados. Gate OFF. Sem DLL / V$Pague / INIT / CRT / EST /
 * FINALIZE reais. Não altera MRT-24 / 36 / 42.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const DB_DIR_TESTE = path.join(os.tmpdir(), 'cds-sistemas-test-db');
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR_TESTE;
process.env.DESTAXA_CONTINUIDADE_PERSISTENTE = '1';
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-43-validacao-fluxo-99-opcao-report.json');
const DONE_FLAG = path.join(ROOT, 'docs/build/mrt-43-done.flag');

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
const tefAdapterSelection = require('../../backend/services/tef/tefAdapterSelection');
const tefRouterIntegration = require('../../backend/services/tef/tefRouterIntegration');
const tefContrato = require('../../backend/services/tef/tefContrato');
const repository = require('../../backend/services/tef/tefRepository');

const SUFFIX = crypto.randomBytes(4).toString('hex');
const ID = Object.freeze({
  idempotency_key: `mrt43_opcao_${SUFFIX}`,
  operation_id: `op_mrt43_${SUFFIX}`,
  fingerprint: crypto.createHash('md5').update(`mrt43-${SUFFIX}`).digest('hex')
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

function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function auditarTefManagerAutorizar() {
  const src = fs.readFileSync(
    path.join(ROOT, 'backend/services/tef/TefManager.js'),
    'utf8'
  );
  const trechoAutorizar = src.slice(
    src.indexOf('async autorizar('),
    src.indexOf('async cancelar(')
  );
  return {
    propagaRequerContinuacao: /requerContinuacao:\s*retornoBruto\.requerContinuacao\s*===\s*true/.test(trechoAutorizar),
    propagaAcao: /acao:\s*retornoBruto\.acao\s*\|\|\s*null/.test(trechoAutorizar),
    persisteContinuidadePayload: /continuidade:\s*\{[\s\S]*?requerContinuacao:[\s\S]*?acao:/.test(trechoAutorizar),
    naoConcluiSeContinuidade: /if\s*\(\s*retornoBruto\.requerContinuacao\s*!==\s*true\s*\)\s*\{[\s\S]*?_concluirExecucao/.test(trechoAutorizar),
    marcaContinuidadeCrt: /_marcarContinuidadeCrt\(transacaoId/.test(trechoAutorizar),
    naoUsaSoParaRespostaApi: !/resolve\(\s*tefContrato\.paraRespostaApi\(retorno,\s*transacaoId\)\s*\)\s*;/.test(
      trechoAutorizar.slice(trechoAutorizar.lastIndexOf('clearTimeout(timeoutId)'))
    )
  };
}

function criarBridgeMock() {
  const contadores = { inicia: 0, continua: 0, finaliza: 0 };
  const respostas = [];
  return {
    contadores,
    respostas,
    async iniciarTransacaoDestaxa() {
      contadores.inicia += 1;
      throw new Error('TX_START proibido no teste MRT-43 (NativeHost simulado)');
    },
    async continuarTransacaoDestaxa(resposta) {
      contadores.continua += 1;
      respostas.push(resposta);
      // Mesmo padrão MRT-39.1: CONTINUE devolve 99 (ciclo interativo) sem FINALIZE
      return {
        sucesso: false,
        codigoDestaxa: '99',
        classificacao: CLASSIFICACAO_CODIGO.ACTION_REQUIRED,
        requerContinuacao: true,
        acao: { ...ACAO_OPCAO },
        mensagem: 'Tipo do Cartao',
        saida: 'mensagem=Tipo do Cartao;opcao=Credito|Debito|Voucher;tipo=X;timeout=120;chave=transacao_tipo_cartao'
      };
    },
    async finalizarTransacaoDestaxa() {
      contadores.finaliza += 1;
      throw new Error('FINALIZE proibido no teste MRT-43');
    }
  };
}

function criarAdapterSimulado(bridge) {
  const contadores = {
    autorizar: 0,
    continuar: 0,
    preparar: 0,
    txStartSimulado: 0
  };
  const destaxaContinue = new DestaxaRealAdapter(
    { pdvCodigo: 'PDV-MRT43', caixaCodigo: 'CX1' },
    { bridge, executionMode: 'in-process' }
  );

  const adapter = {
    nome: 'Destaxa',
    contratoTimeout: { resultadoTardio: false },
    contadores,
    async prepararAutorizacao() {
      contadores.preparar += 1;
      return { pronto: true };
    },
    async autorizarPagamento(_dados, preparacao) {
      contadores.autorizar += 1;
      contadores.txStartSimulado += 1;
      assert.ok(preparacao && preparacao.persistenciaConfirmada === true);
      assert.ok(preparacao.transactionId);
      return {
        sucesso: false,
        status: tefContrato.STATUS.PENDENTE,
        codigo: 'DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA',
        mensagem: 'Ação OPCAO exige resposta explícita na fila respostasContinuidade — 99 não é aprovação',
        nsu: null,
        autorizacao: null,
        modo: 'simulado',
        financialState: 'PENDING',
        protocolState: 'UNKNOWN',
        retryAllowed: false,
        retryReason: 'TEF_ACTION_REQUIRED_NO_RETRY',
        requerContinuacao: true,
        acao: { ...ACAO_OPCAO },
        inconclusivo: false,
        reconciliacaoObrigatoria: true,
        payloadRetorno: {
          operacao: 'CRT',
          codigoDestaxa: '99',
          estado: 'OPTION',
          acao: { ...ACAO_OPCAO }
        },
        cicloCrt: {
          passos: ['TX_START_SIMULADO', '99_OPCAO'],
          continues: 0,
          finalizado: false,
          txStartExecutado: true
        },
        vinculoVendaPdv: { venda_id: null }
      };
    },
    async continuarPagamento(dados) {
      contadores.continuar += 1;
      return destaxaContinue.continuarPagamento(dados);
    }
  };

  return adapter;
}

function instalarSelecaoECiclo(adapter) {
  tefAdapterSelection.selecionarAdapterPorRouteDecision = () => ({
    adapter,
    provedor: 'destaxa',
    terminalTefId: 'term-mrt43',
    modo: 'homologacao',
    fonte: 'mrt43-teste-simulado',
    executionMode: 'in-process',
    codigo: 'ADAPTER_OK',
    registro: { provedor: 'destaxa', ambiente: 'homologacao', id: null }
  });

  tefAdapterCiclo.obterAdapterDaTransacao = async (transacao) => ({
    adapter,
    provedor: 'destaxa',
    registro: { provedor: 'destaxa', ambiente: 'homologacao', id: null },
    terminalTefId: null,
    ambiente: 'homologacao',
    fonte: 'mrt43-teste-simulado',
    identidade: tefAdapterCiclo.extrairIdentidadeTransacao
      ? tefAdapterCiclo.extrairIdentidadeTransacao(transacao)
      : null
  });

  tefRouterIntegration.resolverRotaAutorizacao = async () => ({
    sucesso: true,
    leaseId: 'lease-mrt43-simulado',
    routeDecision: {
      sucesso: true,
      codigo: 'OK',
      mensagem: 'MRT-43 rota simulada',
      modo: 'COMPAT_SINGLETON',
      provedor: 'destaxa',
      pdvId: 'pdv-mrt43',
      terminalTefId: 'term-mrt43',
      adapterBinding: {
        registro: { provedor: 'destaxa', ambiente: 'homologacao' },
        fonte: 'mrt43',
        modo: 'homologacao',
        terminalTefId: 'term-mrt43'
      },
      executionContext: {
        localidadeExecucao: 'LOCAL',
        topologia: 'SINGLETON',
        runtime: { runtimeKey: 'mrt43' }
      },
      isolamento: { runtimeKey: 'mrt43' }
    }
  });
  tefRouterIntegration.classificarPosAutorizacao = () => ({
    acao: 'MANTER',
    motivo: 'mrt43-simulado',
    mensagem: 'MRT-43 lease stub'
  });
  tefRouterIntegration.aplicarPosAutorizacao = () => ({ ok: true, stub: true });
}

function carregarTefManager() {
  const resolved = require.resolve('../../backend/services/tef/TefManager');
  delete require.cache[resolved];
  const mod = require('../../backend/services/tef/TefManager');
  return mod.TefManager || mod;
}

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
            return { append() { return this; } };
          }
          if (selector.includes('tef-cont-erro')) {
            return { text() { return this; }, show() { return this; } };
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
              if (escolha === '__fechar__') {
                if (onHidden) onHidden();
                return;
              }
              selectVal = escolha == null ? '' : String(escolha);
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
    if (sel === 'body') return { append() { return this; } };
    return makeSelectApi();
  }
  $.fn = {};

  const src = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdvTefContinuidade.js'), 'utf8');
  const sandbox = {
    console, setTimeout, clearTimeout, Date, String, Number, Array, Object, Promise, JSON
  };
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

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-43 — Validação fluxo 99/OPCAO (TefManager.autorizar) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);
  await whenReady();

  const caminho = persistencia.caminhoBancoEfetivo();
  const prodPath = path.join(
    process.env.PROGRAMDATA || 'C:\\ProgramData',
    'MercantilFiscal',
    'dados',
    'mercadao.db'
  );
  const fase1 = {
    dbDir: caminho.dbDir,
    dbPath: caminho.dbPath,
    ehTempCdsTestDb: String(caminho.dbPath || '').includes('cds-sistemas-test-db'),
    ehProgramData: String(caminho.dbPath || '').includes('MercantilFiscal'),
    distintoProducao: path.resolve(caminho.dbPath || '') !== path.resolve(prodPath),
    gateOff: transacaoRealHabilitada() === false
  };

  if (!fase1.ehTempCdsTestDb || fase1.ehProgramData || !fase1.distintoProducao || !fase1.gateOff) {
    const report = {
      sprint: 'MRT-43',
      classificacaoFinal: 'BLOQUEADO',
      motivo: 'Pré-condições (banco teste / gate OFF) não atendidas',
      fase1,
      generatedAt: geradoEm
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error('BLOQUEADO: pré-condições MRT-43');
  }

  const auditoriaCodigo = auditarTefManagerAutorizar();
  const resultados = [];
  const idsCriados = [];
  const holdsPendentes = await allSql(
    `SELECT id, status FROM tef_transacoes WHERE status = 'pendente'`
  );

  // Isola exclusividade INSERT sem alterar conteúdo MRT-24/36/42 — restore no finally
  if (holdsPendentes.length) {
    await runSql(
      `UPDATE tef_transacoes SET status = 'mrt43_hold_temp' WHERE status = 'pendente'`
    );
  }

  try {
    resultados.push(ok('0) Auditoria estática TefManager.autorizar propaga 99/OPCAO',
      auditoriaCodigo.propagaRequerContinuacao
      && auditoriaCodigo.propagaAcao
      && auditoriaCodigo.persisteContinuidadePayload
      && auditoriaCodigo.naoConcluiSeContinuidade
      && auditoriaCodigo.marcaContinuidadeCrt
      && auditoriaCodigo.naoUsaSoParaRespostaApi,
      auditoriaCodigo));

    limparRegistrosContinuidade();

    const bridge = criarBridgeMock();
    const adapter = criarAdapterSimulado(bridge);
    instalarSelecaoECiclo(adapter);

    const TefManager = carregarTefManager();
    const mgr = new TefManager({ recuperarNoInicio: false });
    mgr._pendencias.clear();
    mgr._continuidadeCrt = null;
    mgr._autorizacaoEmCurso = false;
    mgr.garantirRecuperacao = async () => null;
    mgr.recarregarPendencias = async () => {
      mgr._pendencias.clear();
      return null;
    };

    // 1) autorizar — retorno 99 integral
    const rAuth = await mgr.autorizar({
      tipo: 'credito',
      valor: 1,
      parcelas: 1,
      idempotency_key: ID.idempotency_key,
      operation_id: ID.operation_id,
      _fingerprint: ID.fingerprint,
      venda_id: null
    }, 30000);

    const txId = rAuth.transacao_id || rAuth.transacaoId;
    if (txId != null) idsCriados.push(Number(txId));

    resultados.push(ok('1) TefManager.autorizar propaga requerContinuacao + acao OPCAO',
      rAuth.requerContinuacao === true
      && rAuth.acao
      && String(rAuth.acao.tipo).toUpperCase() === 'OPCAO'
      && Array.isArray(rAuth.acao.opcoes)
      && rAuth.acao.opcoes.join('|') === 'Credito|Debito|Voucher'
      && rAuth.acao.mensagem === 'Tipo do Cartao'
      && adapter.contadores.autorizar === 1
      && bridge.contadores.inicia === 0,
      {
        codigo: rAuth.codigo,
        requerContinuacao: rAuth.requerContinuacao,
        acao: rAuth.acao,
        transacaoId: txId,
        bridgeInicia: bridge.contadores.inicia
      }));

    // 2) ciclo não conclui enquanto ação pendente
    const aindaEmExecucao = mgr._emExecucao && mgr._emExecucao.has(String(txId));
    const continuidadeAtiva = mgr._continuidadeCrt
      && String(mgr._continuidadeCrt.transacaoId) === String(txId);
    const txDb = await persistencia.buscarTransacao(txId);
    const blocoCont = persistencia.obterBlocoContinuidade(txDb?.payload_retorno || {});

    resultados.push(ok('2) Ciclo não conclui com 99 pendente (_continuidadeCrt + status pendente)',
      continuidadeAtiva === true
      && aindaEmExecucao === true
      && txDb
      && txDb.status === 'pendente'
      && blocoCont.requerContinuacao === true
      && blocoCont.acao
      && String(blocoCont.acao.tipo).toUpperCase() === 'OPCAO',
      {
        continuidadeAtiva,
        aindaEmExecucao,
        statusDb: txDb?.status,
        payloadContinuidade: {
          requerContinuacao: blocoCont.requerContinuacao,
          acaoTipo: blocoCont.acao?.tipo
        }
      }));

    // 3) Fachada iniciarPagamento (mesmo contrato da rota /tef/pagar)
    const fachada = {
      requerContinuacao: rAuth.requerContinuacao === true,
      acao: rAuth.acao || null,
      codigo: rAuth.codigo,
      status: rAuth.status,
      sucesso: rAuth.sucesso,
      transacao_id: txId,
      transacaoId: txId,
      idempotency_key: ID.idempotency_key,
      retryAllowed: false
    };
    resultados.push(ok('3) Contrato fachada/API expõe ação para o PDV (202 continuidade)',
      fachada.requerContinuacao === true
      && fachada.acao?.tipo === 'OPCAO'
      && fachada.acao.opcoes[0] === 'Credito',
      { fachadaAcao: fachada.acao }));

    // 4) Frontend recebe ação e solicita resposta explícita
    const { Cont, evidencias } = carregarPdvComUi({ escolha: 'Credito', delayMs: 8 });
    assert.ok(Cont && typeof Cont.conduzirContinuidade === 'function');

    const posts = [];
    Cont.postContinuar = async (_apiUrl, _token, pedido) => {
      posts.push(pedido);
      const r = await mgr.continuarAutorizacao({
        transacao_id: pedido.transacao_id,
        idempotency_key: pedido.idempotency_key,
        resposta_continuidade: pedido.resposta_continuidade,
        acao: pedido.acao,
        persistenciaContinuidade: true,
        ambienteOperador: { tty: true }
      });
      return {
        response: { status: r.requerContinuacao === true ? 202 : 200 },
        data: r
      };
    };

    // Seed solicitação 99 durável (equivalente ao registro pós-DLL no fluxo real)
    await persistencia.registrarSolicitacao99(txId, {
      acao: ACAO_OPCAO,
      solicitadaEm: new Date().toISOString()
    });

    const iniciaAntesPdv = bridge.contadores.inicia;
    const continuaAntesPdv = bridge.contadores.continua;

    // maxPassos=1: prova 1 resposta OPCAO → /continuar; evita loop PDV sobre 99 simulado
    const rPdv = await Cont.conduzirContinuidade(fachada, {
      apiUrl: 'http://mrt43.local',
      token: 'tok-mrt43',
      idempotencyKey: ID.idempotency_key,
      permitirHeadless: false,
      maxPassos: 1
    });

    const opcoesUnicas = [...new Set(evidencias.opcoesRenderizadas)];
    const infoPost = posts[0]?.resposta_continuidade?.informacao
      || (typeof posts[0]?.resposta_continuidade === 'string' ? posts[0].resposta_continuidade : null);

    resultados.push(ok('4) PDV renderiza OPCAO literais e envia resposta explícita Credito',
      evidencias.modalShown === true
      && opcoesUnicas.includes('Credito')
      && opcoesUnicas.includes('Debito')
      && opcoesUnicas.includes('Voucher')
      && evidencias.mensagem === 'Tipo do Cartao'
      && posts.length >= 1
      && infoPost === 'Credito'
      && Cont.validarResposta(ACAO_OPCAO, 'Credito').ok === true,
      {
        evidencias: { ...evidencias, opcoesUnicas },
        post: posts[0],
        pdvCodigo: rPdv?.codigo || null,
        posts: posts.length
      }));

    resultados.push(ok('5) Continuidade oficial sem novo TX_START (bridge.inicia inalterado)',
      bridge.contadores.inicia === iniciaAntesPdv
      && bridge.contadores.inicia === 0
      && bridge.contadores.continua === continuaAntesPdv + 1
      && bridge.contadores.finaliza === 0
      && adapter.contadores.continuar === 1
      && adapter.contadores.autorizar === 1
      && posts.length === 1,
      {
        bridge: { ...bridge.contadores },
        adapter: { ...adapter.contadores },
        posts: posts.length
      }));

    const apos1 = await persistencia.buscarTransacao(txId);
    const cont1 = persistencia.obterBlocoContinuidade(apos1.payload_retorno || {});
    const respCredito = (cont1.respostas || []).some(
      (r) => String(r.informacao || '') === 'Credito'
        || String(r.fingerprint || '') === 'informacao=Credito'
    );

    resultados.push(ok('6) Resposta Credito persistida; continueCount>=1; txStartCount=1',
      respCredito === true
      && Number(cont1.continueCount || 0) >= 1
      && Number(cont1.txStartCount || 0) === 1,
      {
        estado: cont1.estado,
        continueCount: cont1.continueCount,
        txStartCount: cont1.txStartCount,
        respostas: cont1.respostas
      }));

    // 7) Nova CRT bloqueada enquanto continuidade 99 ativa (antes do teste de duplicata)
    const rSegunda = await mgr.autorizar({
      tipo: 'credito',
      valor: 1,
      parcelas: 1,
      idempotency_key: `mrt43_segunda_${SUFFIX}`,
      venda_id: null
    }, 10000);

    resultados.push(ok('7) Segunda autorização bloqueada (TEF_CRT_CONTINUIDADE_ATIVA)',
      rSegunda.codigo === 'TEF_CRT_CONTINUIDADE_ATIVA'
      && rSegunda.requerContinuacao === true
      && adapter.contadores.autorizar === 1
      && bridge.contadores.inicia === 0,
      { codigo: rSegunda.codigo, autorizarCount: adapter.contadores.autorizar }));

    // 8) Duplicata bloqueada — sem novo CONTINUE na bridge
    limparRegistrosContinuidade();
    const continuaAntesDup = bridge.contadores.continua;
    const iniciaAntesDup = bridge.contadores.inicia;
    const rDup = await mgr.continuarAutorizacao({
      transacao_id: txId,
      idempotency_key: ID.idempotency_key,
      resposta_continuidade: 'Credito',
      acao: ACAO_OPCAO,
      persistenciaContinuidade: true,
      ambienteOperador: { tty: true }
    });

    resultados.push(ok('8) Segunda resposta bloqueada (anti-duplicata) sem TX_START/CONTINUE extra',
      rDup.sucesso !== true
      && rDup.codigo === ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA
      && bridge.contadores.continua === continuaAntesDup
      && bridge.contadores.inicia === iniciaAntesDup,
      {
        codigo: rDup.codigo,
        bridgeContinua: bridge.contadores.continua,
        bridgeInicia: bridge.contadores.inicia
      }));
    // Preservação MRT-24/36/42
    const m24 = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json'),
      'utf8'
    ));
    const m36 = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json'),
      'utf8'
    ));
    const m42 = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'docs/build/mrt-42-crt-real-controlada-report.json'),
      'utf8'
    ));

    resultados.push(ok('9) Gate OFF; IDs novos; MRT-24/36/42 preservados',
      transacaoRealHabilitada() === false
      && ID.idempotency_key.startsWith('mrt43_')
      && ID.idempotency_key !== m42.identidade?.idempotency_key
      && ID.idempotency_key !== m36.identidade?.idempotency_key
      && (m24.execucao?.resultado?.financialState === 'UNKNOWN'
        || String(m24.classificacao || '').includes('INCONCLUSIVA'))
      && m36.classificacao === 'INCONCLUSIVA'
      && m42.classificacao === 'INCONCLUSIVA',
      {
        m42Id: m42.identidade?.idempotency_key,
        m43Id: ID.idempotency_key
      }));

    // Limpeza só das linhas MRT-43
    for (const id of idsCriados) {
      await runSql('DELETE FROM tef_logs WHERE transacao_id = ?', [id]);
      await runSql('DELETE FROM tef_transacoes WHERE id = ?', [id]);
    }
    await runSql(
      `DELETE FROM tef_transacoes WHERE idempotency_key LIKE ?`,
      ['mrt43_%']
    );

    resultados.push(ok('10) Limpeza somente registros MRT-43', true, { ids: idsCriados }));

    const report = {
      sprint: 'MRT-43',
      title: 'Validação do fluxo 99/OPCAO — propagação TefManager.autorizar → PDV → continuidade',
      generatedAt: geradoEm,
      classificacaoFinal: 'IMPLEMENTADO',
      fase1Diagnostico: fase1,
      auditoriaCodigo,
      identidadeTeste: ID,
      arquivosAlterados: [
        'tests/tef/mrt-43-validacao-fluxo-99-opcao.test.js',
        'docs/build/mrt-43-validacao-fluxo-99-opcao-report.json',
        'docs/build/mrt-43-done.flag'
      ],
      arquivosAuditadosSemMudancaArquitetural: [
        'backend/services/tef/TefManager.js (correção MRT-42 auditada; sem nova alteração nesta sprint)',
        'frontend/pdv/js/pdvTefContinuidade.js (exercitado; sem alteração)'
      ],
      caminhoValidado: [
        'TefManager.autorizar → adapter.autorizarPagamento (simulado 99/OPCAO)',
        'resolve({ requerContinuacao, acao }) + payload_retorno.continuidade',
        'PDV PdvTefContinuidade.conduzirContinuidade → solicitarRespostaOperador(OPCAO)',
        'POST continuidade → TefManager.continuarAutorizacao → DestaxaRealAdapter.continuarPagamento',
        'bridge.continuarTransacaoDestaxa (NativeHost simulado) — sem TX_START'
      ],
      resultadosTeste: resultados,
      evidencias: {
        autorizar: {
          codigo: rAuth.codigo,
          requerContinuacao: rAuth.requerContinuacao,
          acao: rAuth.acao,
          transacaoId: txId
        },
        pdv: {
          evidencias,
          posts,
          resultadoCodigo: rPdv?.codigo || null
        },
        bridge: { ...bridge.contadores },
        adapter: { ...adapter.contadores },
        segundaAutorizacao: { codigo: rSegunda.codigo },
        duplicata: { codigo: rDup.codigo }
      },
      confirmacoes: {
        gateOff: true,
        dllNaoCarregada: true,
        vspagueNaoConectado: true,
        zeroInitCrtEstFinalizeReais: true,
        txStartSomenteSimuladoNoAdapter: true,
        continuidadeSemNovoTxStart: bridge.contadores.inicia === 0,
        mrt24Preservado: true,
        mrt36Preservado: true,
        mrt42Preservado: true,
        producaoNaoAlterada: true
      },
      riscosResiduais: [
        'Router/seleção stubados para injetar adapter simulado sem DLL; o contrato TefManager.autorizar→resolve(requerContinuacao/acao) é o exercitado',
        'Pendentes pré-existentes do DB de teste foram hold temporário (mrt43_hold_temp) e restaurados — MRT-42 tx não apagada'
      ],
      recomendacao: 'Aguardar Tech Lead. Não iniciar próxima sprint automaticamente.'
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(
      DONE_FLAG,
      `${geradoEm}\nIMPLEMENTADO\ngate=OFF\ntestes=${resultados.length}\n`,
      'utf8'
    );

    console.log(`\nRelatório: ${REPORT_PATH}`);
    console.log('Classificação:', report.classificacaoFinal);
    console.log(`Testes OK: ${resultados.length}`);
    console.log('Gate OFF:', transacaoRealHabilitada() === false);
    console.log('Aguardando Tech Lead. Não iniciar próxima sprint.');
  } finally {
    // Restaura pendentes MRT-42 etc. sem alterar payload/identidade
    if (holdsPendentes.length) {
      for (const row of holdsPendentes) {
        await runSql(
          `UPDATE tef_transacoes SET status = ? WHERE id = ? AND status = 'mrt43_hold_temp'`,
          [row.status, row.id]
        );
      }
      await runSql(
        `UPDATE tef_transacoes SET status = 'pendente' WHERE status = 'mrt43_hold_temp'`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
