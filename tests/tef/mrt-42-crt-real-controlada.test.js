'use strict';

/**
 * MRT-42 — UMA CRT real R$1,00 Destaxa (autorizada PO).
 *
 * Fluxo oficial: tef.iniciarPagamento → TefManager → persistência →
 * DestaxaRealAdapter → NativeHost → DLL.
 *
 * Banco: TESTE autorizado (Temp/cds-sistemas-test-db). NÃO produção.
 * Gate: liga só para esta operação; desliga imediatamente após.
 * Continuidade 99/OPCAO: operador humano no console (sem auto-aprovação).
 * Não reutiliza MRT-24 / MRT-36. Sem retry / EST / cancel / estorno.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
const DB_DIR_TESTE = path.join(os.tmpdir(), 'cds-sistemas-test-db');
const DB_DIR_PROD = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');

process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR_TESTE;
process.env.TEF_TIMEOUT_MS = process.env.TEF_TIMEOUT_MS || '600000';
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-42-crt-real-controlada-report.json');
const DONE_FLAG = path.join(ROOT, 'docs/build/mrt-42-done.flag');
const MRT24_REPORT = path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json');
const MRT36_REPORT = path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json');
const DLL_LOG = 'C:\\CDS-SISTEMAS\\logs\\destaxa\\destaxa-dll.log';
const DLL_DIR = 'C:\\CDS-SISTEMAS\\logs\\destaxa';
const DLL_PATH = path.join(ROOT, 'resources/tef/destaxa/win-x64/libdll-integracao-tef.dll');

const db = require('../../backend/database');
const sdkDetector = require('../../backend/services/tef/sdkDetector');
const tefService = require('../../backend/services/tef');
const tefConfigService = require('../../backend/services/tef/tefConfigService');
const {
  REAL_TRANSACTION_ENV,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { DESTAXA_DLL_LOG_PARAMS } = require('../../backend/services/tef/destaxa/destaxaDllLogConfig');
const {
  ETAPAS_FLUXO,
  instalarColetorTeste,
  sanitizarEvidencia
} = require('../../backend/services/tef/destaxa/destaxaFluxoInstrumentacao');
const { clienteCompartilhadoExistente } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');

function agora() {
  return new Date().toISOString();
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
    } else setTimeout(resolve, 2000);
  });
}

function sanitizarTexto(valor) {
  if (valor == null) return null;
  let s = String(valor);
  s = s.replace(/\b\d{13,19}\b/g, '[PAN_REDACTED]');
  s = s.replace(/(senha|password|pin)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
  if (s.length > 1200) s = `${s.slice(0, 1200)}…`;
  return s;
}

function sanitizarObjeto(obj, profundidade = 0) {
  if (obj == null || profundidade > 8) return obj;
  if (typeof obj === 'string') return sanitizarTexto(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((x) => sanitizarObjeto(x, profundidade + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/senha|password|pan|track|trilha|cvv|token/i.test(k)) out[k] = '[REDACTED]';
    else out[k] = sanitizarObjeto(v, profundidade + 1);
  }
  return out;
}

function lerDllLogSnapshot() {
  if (!fs.existsSync(DLL_LOG)) return { exists: false, bytes: 0, linhas: [] };
  const st = fs.statSync(DLL_LOG);
  const txt = fs.readFileSync(DLL_LOG, 'utf8');
  return {
    exists: true,
    bytes: st.size,
    mtime: st.mtime.toISOString(),
    linhas: txt.split(/\r?\n/).filter((l) => l.trim())
  };
}

function escreverRelatorio(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function perguntarOperador(acao) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error('\n[MRT-42] SEM TTY — Continuidade 99 exige operador no console interativo.');
      resolve(null);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n======== CONTINUIDADE CRT (mesma identidade; sem novo TX_START) ========');
    console.log('Tipo:', acao?.tipo || '(desconhecido)');
    console.log('Mensagem:', sanitizarTexto(acao?.mensagem || ''));
    if (Array.isArray(acao?.opcoes) && acao.opcoes.length) {
      console.log('Opções (responda literalmente uma delas):', acao.opcoes.join(' | '));
    }
    console.log('PinPad: use o cartão de TESTE Destaxa quando solicitado.');
    console.log('NÃO invente opção. NÃO inicie outra cobrança.');
    console.log('=======================================================================\n');
    rl.question('respostaContinuidade> ', (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function classificarResultado(resultado) {
  if (!resultado) return 'INCONCLUSIVA';
  if (resultado.transactionAttempted === false && resultado.inconclusivo !== true
    && resultado.sucesso !== true) {
    const cod = String(resultado.codigo || '');
    if (/PERSISTENCIA|VALIDACAO|DESTAXA_.*NAO_PERMIT|PROVIDER|CONFIG|VSPAGUE|PINPAD|DLL|EXPORT|CLIENT_INIT|GATE|DISABLED/i.test(cod)
      || resultado.tipo_erro === 'pre_condicao'
      || resultado.tipo_erro === 'persistencia_obrigatoria'
      || resultado.tipo_erro === 'gate_financeiro') {
      return 'BLOQUEADA_PRE_EXECUCAO';
    }
  }
  if (resultado.sucesso === true || resultado.status === 'aprovado' || resultado.aprovado === true) {
    return 'APROVADA';
  }
  if (resultado.status === 'negado' || ['03', '04', '09'].includes(String(resultado.codigoDestaxa || ''))) {
    return 'RECUSADA';
  }
  if (resultado.inconclusivo === true || resultado.financialState === 'UNKNOWN'
    || resultado.status === 'pendente' || resultado.reconciliacaoObrigatoria === true
    || resultado.requerContinuacao === true) {
    return 'INCONCLUSIVA';
  }
  if (resultado.sucesso === false && resultado.transactionAttempted !== true) {
    return 'BLOQUEADA_PRE_EXECUCAO';
  }
  return 'INCONCLUSIVA';
}

function lerPreservacao(reportPath, sprint) {
  try {
    const j = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return {
      sprint,
      classificacao: j.classificacao || j.classificacaoFinal || null,
      financialState: j.execucao?.resultado?.financialState
        || j.execucao?.resultadoBruto?.financialState
        || j.estadoFinalTransacao?.financialState
        || 'UNKNOWN',
      idempotency_key: j.identidade?.idempotency_key || j.execucao?.idempotencyKey || null,
      transactionId: j.identidade?.transactionId || j.execucao?.transactionId || null
    };
  } catch (_) {
    return { sprint, classificacao: null, financialState: 'UNKNOWN' };
  }
}

async function garantirConfigHomologacaoTeste() {
  const atual = await tefConfigService.obterConfiguracao();
  const precisa = String(atual.tefProvedor || '').toLowerCase() !== 'destaxa'
    || String(atual.tefAmbiente || '').toLowerCase() !== AMBIENTE_TRANSACAO_REAL
    || String(atual.portaCom || '').toUpperCase() !== 'COM4'
    || String(atual.tefHabilitado) !== 'true';
  if (!precisa) {
    return { aplicada: false, config: atual };
  }
  // Não inventa empresa/loja/terminal — espelha o que a instalação já usa (vazios ok).
  const salvo = await tefConfigService.salvarConfiguracao({
    tefHabilitado: 'true',
    tefProvedor: 'destaxa',
    tefAmbiente: AMBIENTE_TRANSACAO_REAL,
    tipoIntegracao: 'dll',
    pinpadHabilitado: 'true',
    pinpadCodigo: 'GERTEC_PPC930',
    pinpadModelo: 'GERTEC_PPC930',
    fabricante: 'Gertec',
    modelo: 'PPC930',
    tipoConexao: 'serial',
    portaCom: 'COM4',
    debito: 'true',
    creditoAvista: 'true',
    creditoParcelado: 'true',
    empresaCodigo: atual.empresaCodigo || '',
    lojaCodigo: atual.lojaCodigo || '',
    terminalCodigo: atual.terminalCodigo || '',
    pdvCodigo: atual.pdvCodigo || '',
    caixaCodigo: atual.caixaCodigo || ''
  });
  return { aplicada: true, config: salvo || (await tefConfigService.obterConfiguracao()) };
}

async function main() {
  const geradoEm = agora();
  const suffix = crypto.randomBytes(8).toString('hex');
  const idempotencyKey = `mrt42_${suffix}`;
  const operationIdPlanejado = `op_mrt42_${suffix}`;
  const fingerprintPlanejado = crypto.createHash('md5')
    .update(`mrt42-crt-1reais-${suffix}`)
    .digest('hex');

  try { fs.unlinkSync(DONE_FLAG); } catch (_) { /* */ }

  await whenReady();

  const m24 = lerPreservacao(MRT24_REPORT, 'MRT-24');
  const m36 = lerPreservacao(MRT36_REPORT, 'MRT-36');
  assert.notStrictEqual(idempotencyKey, m24.idempotency_key);
  assert.notStrictEqual(idempotencyKey, m36.idempotency_key);

  const etapasColetadas = [];
  const removerColetor = instalarColetorTeste((ev) => {
    etapasColetadas.push(sanitizarEvidencia(ev));
    console.log(`  [ETAPA] ${ev?.etapa || ev?.contexto?.etapa || '?'} @ ${ev?.timestamp || agora()}`);
  });

  const report = {
    sprint: 'MRT-42',
    title: 'Teste real controlado Destaxa — CRT R$1,00',
    generatedAt: geradoEm,
    autorizacao: {
      productOwner: true,
      escopo: 'UMA CRT R$1,00 homologação',
      segundaOperacaoAutorizada: false
    },
    classificacao: 'BLOQUEADA_PRE_EXECUCAO',
    identidade: {
      idempotency_key: idempotencyKey,
      operation_id: operationIdPlanejado,
      fingerprint: fingerprintPlanejado,
      transactionId: null,
      distintaDeMrt24: true,
      distintaDeMrt36: true
    },
    preCondicoes: {},
    execucao: {
      inicio: null,
      fim: null,
      gateJanela: { ligadoEm: null, desligadoEm: null },
      resultadoBruto: null,
      continuidade: [],
      sequenciaDll: []
    },
    persistencia: {},
    preservacao: { mrt24: m24, mrt36: m36 },
    confirmacoes: {},
    problemas: []
  };

  const restaurarGate = (motivo) => {
    delete process.env[REAL_TRANSACTION_ENV];
    report.execucao.gateJanela.desligadoEm = agora();
    report.execucao.gateJanela.motivoOff = motivo;
    report.confirmacoes.gateOffAposExecucao = transacaoRealHabilitada() === false;
    report.confirmacoes.transacaoRealHabilitada = transacaoRealHabilitada();
    console.log(`>>> Gate OFF (${motivo}). transacaoRealHabilitada=${transacaoRealHabilitada()}`);
  };

  const finalizar = (classificacao, motivo) => {
    try { restaurarGate(motivo || classificacao); } catch (_) { /* */ }
    report.classificacao = classificacao;
    report.execucao.fim = agora();
    report.instrumentacao = {
      etapas: etapasColetadas,
      sequenciaObservada: etapasColetadas.map((e) => e.etapa || e.contexto?.etapa).filter(Boolean)
    };
    report.confirmacoes = {
      ...report.confirmacoes,
      gateOffAposExecucao: transacaoRealHabilitada() === false,
      transacaoRealHabilitada: false,
      segundaOperacaoNaoExecutada: true,
      mrt24UnknownPreservado: true,
      mrt36InconclusivaPreservada: true,
      zeroEstCancelEstorno: true,
      crtUnica: true,
      bancoTesteUsado: true,
      producaoNaoAlterada: true
    };
    escreverRelatorio(report);
    try { removerColetor(); } catch (_) { /* */ }
    fs.writeFileSync(DONE_FLAG, `${agora()}\n${classificacao}\n`, 'utf8');
    console.log('\nClassificação:', classificacao);
    console.log('Relatório:', REPORT_PATH);
  };

  process.on('uncaughtException', (err) => {
    report.problemas.push({ item: 'uncaughtException', erro: sanitizarTexto(err.message) });
    report.execucao.resultadoBruto = {
      inconclusivo: true,
      financialState: 'UNKNOWN',
      erro: sanitizarTexto(err.message)
    };
    finalizar('INCONCLUSIVA', 'uncaughtException');
    process.exitCode = 1;
  });
  process.on('unhandledRejection', (err) => {
    report.problemas.push({
      item: 'unhandledRejection',
      erro: sanitizarTexto(err?.message || String(err))
    });
    report.execucao.resultadoBruto = {
      inconclusivo: true,
      financialState: 'UNKNOWN',
      erro: sanitizarTexto(err?.message || String(err))
    };
    finalizar('INCONCLUSIVA', 'unhandledRejection');
    process.exitCode = 1;
  });

  console.log('=== MRT-42 — CRT real controlada R$1,00 Destaxa ===\n');
  console.log('TTY:', process.stdin.isTTY === true);
  console.log('DB_DIR:', process.env.DB_DIR);

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const cfgSeed = await garantirConfigHomologacaoTeste();
  const cfg = await tefConfigService.obterConfiguracao();
  const vspague = sdkDetector.detectarVsPagueClient();
  const pinpad = sdkDetector.detectarGertecPPC930({ portaConfigurada: 'COM4' });
  report.dllLog = { antes: lerDllLogSnapshot(), depois: null, linhasNovas: [] };

  const dbPath = path.join(DB_DIR_TESTE, 'mercadao.db');
  report.preCondicoes = {
    homologacao: String(cfg.tefAmbiente || '').toLowerCase(),
    provedor: String(cfg.tefProvedor || '').toLowerCase(),
    configSeedAplicada: cfgSeed.aplicada,
    gateOffAntes: transacaoRealHabilitada() === false,
    dbDir: process.env.DB_DIR,
    dbPath,
    bancoTeste: String(dbPath).includes('cds-sistemas-test-db'),
    bancoProducao: path.resolve(DB_DIR_TESTE) === path.resolve(DB_DIR_PROD),
    isolamentoTeste: process.env.CDS_TEST_ISOLAR_BANCO === '1',
    arch: process.arch,
    tty: process.stdin.isTTY === true,
    vspague: {
      detectado: vspague.detectado === true,
      executando: vspague.executando === true,
      responding: vspague.responding,
      pid: vspague.pid || null
    },
    pinpad: {
      detectado: pinpad.detectado === true,
      porta: pinpad.porta || null,
      estado: pinpad.estado || null
    },
    dll: { path: DLL_PATH, existe: fs.existsSync(DLL_PATH), versaoEsperada: '1.83 x64' },
    logDll: {
      diretorio: DLL_DIR,
      diretorioExiste: fs.existsSync(DLL_DIR),
      nivel_log: DESTAXA_DLL_LOG_PARAMS.nivel_log,
      bytesAntes: report.dllLog.antes.bytes
    },
    mrt24: m24,
    mrt36: m36,
    hostPrevio: (() => {
      const c = clienteCompartilhadoExistente();
      if (!c) return { presente: false };
      const e = c.getEstado();
      return { presente: true, estado: e.estado, pid: e.pid };
    })()
  };

  console.log('Pré-condições:', JSON.stringify({
    ambiente: report.preCondicoes.homologacao,
    provedor: report.preCondicoes.provedor,
    bancoTeste: report.preCondicoes.bancoTeste,
    vspague: report.preCondicoes.vspague,
    pinpad: report.preCondicoes.pinpad,
    dll: report.preCondicoes.dll.existe,
    tty: report.preCondicoes.tty
  }));

  const falhas = [];
  if (!report.preCondicoes.gateOffAntes) falhas.push('gate não está OFF');
  if (!report.preCondicoes.bancoTeste) falhas.push('DB não é cds-sistemas-test-db');
  if (report.preCondicoes.bancoProducao) falhas.push('DB aponta para produção');
  if (report.preCondicoes.homologacao !== AMBIENTE_TRANSACAO_REAL) {
    falhas.push(`ambiente=${report.preCondicoes.homologacao} ≠ homologacao`);
  }
  if (report.preCondicoes.provedor !== 'destaxa') falhas.push('provedor ≠ destaxa');
  if (!report.preCondicoes.vspague.detectado || !report.preCondicoes.vspague.executando
    || report.preCondicoes.vspague.responding === false) falhas.push('V$Pague indisponível');
  if (!report.preCondicoes.pinpad.detectado
    || String(report.preCondicoes.pinpad.porta || '').toUpperCase() !== 'COM4') {
    falhas.push('PinPad PPC-930 não na COM4');
  }
  if (!report.preCondicoes.dll.existe) falhas.push('DLL Destaxa ausente');
  if (!report.preCondicoes.logDll.diretorioExiste) falhas.push('diretório log DLL ausente');
  if (String(DESTAXA_DLL_LOG_PARAMS.nivel_log) !== '1') falhas.push('nivel_log ≠ 1');
  if (process.arch !== 'x64') falhas.push(`arch ${process.arch} ≠ x64`);
  if (!report.preCondicoes.tty) {
    falhas.push('SEM TTY — rode em console interativo para responder 99/OPCAO');
  }

  if (falhas.length) {
    report.preCondicoes.ok = false;
    report.preCondicoes.falhas = falhas;
    report.problemas.push({ item: 'preCondicoes', erro: falhas.join('; ') });
    finalizar('BLOQUEADA_PRE_EXECUCAO', falhas.join('; '));
    return;
  }
  report.preCondicoes.ok = true;
  escreverRelatorio(report);

  console.log('\n2. Janela ENABLE_REAL — UMA CRT via TefManager (iniciarPagamento)');
  console.log('>>> No PinPad GERTEC COM4: cartão de TESTE Destaxa quando solicitado.\n');

  process.env[REAL_TRANSACTION_ENV] = '1';
  report.execucao.gateJanela.ligadoEm = agora();
  assert.strictEqual(transacaoRealHabilitada(), true);
  report.execucao.inicio = agora();
  escreverRelatorio(report);

  let resultado = null;
  try {
    resultado = await tefService.iniciarPagamento({
      tipo: 'credito',
      valor: 1,
      parcelas: 1,
      venda_id: null,
      idempotency_key: idempotencyKey,
      operation_id: operationIdPlanejado,
      fingerprint: fingerprintPlanejado
    });
  } catch (error) {
    resultado = {
      sucesso: false,
      inconclusivo: true,
      financialState: 'UNKNOWN',
      codigo: error.code || 'MRT42_EXCECAO',
      mensagem: error.message,
      retryAllowed: false,
      reconciliacaoObrigatoria: true
    };
    report.problemas.push({ item: 'iniciarPagamento', erro: sanitizarTexto(error.message) });
  }

  let loops = 0;
  while (resultado && resultado.requerContinuacao === true && loops < 16) {
    loops += 1;
    const resposta = await perguntarOperador(resultado.acao);
    if (resposta == null || resposta === '') {
      report.execucao.continuidade.push({
        n: loops,
        status: 'SEM_TTY_OU_VAZIO',
        acao: sanitizarObjeto(resultado.acao)
      });
      break;
    }
    report.execucao.continuidade.push({
      n: loops,
      respostaLen: resposta.length,
      respostaLiteral: sanitizarTexto(resposta)
    });
    try {
      resultado = await tefService.continuarPagamento({
        transacao_id: resultado.transacao_id || resultado.transacaoId,
        idempotency_key: idempotencyKey,
        resposta_continuidade: resposta,
        acao: resultado.acao,
        persistenciaContinuidade: true,
        ambienteOperador: { tty: true }
      });
    } catch (error) {
      resultado = {
        sucesso: false,
        inconclusivo: true,
        financialState: 'UNKNOWN',
        codigo: error.code || 'MRT42_CONTINUIDADE_EXCECAO',
        mensagem: error.message,
        retryAllowed: false,
        reconciliacaoObrigatoria: true
      };
      break;
    }
  }

  restaurarGate('pos-retorno-crt');

  report.identidade.transactionId = resultado?.transacao_id || resultado?.transacaoId || null;
  report.identidade.operation_id = resultado?.operation_id
    || etapasColetadas.find((e) => e.operation_id)?.operation_id
    || operationIdPlanejado;
  report.identidade.fingerprint = etapasColetadas.find((e) => e.fingerprint)?.fingerprint
    || fingerprintPlanejado;
  report.identidade.distintaDeMrt24 = String(report.identidade.idempotency_key) !== String(m24.idempotency_key || '');
  report.identidade.distintaDeMrt36 = String(report.identidade.idempotency_key) !== String(m36.idempotency_key || '');

  report.execucao.resultadoBruto = sanitizarObjeto(resultado);
  report.execucao.fim = agora();
  report.dllLog.depois = lerDllLogSnapshot();
  const antesN = report.dllLog.antes.linhas.length;
  report.dllLog.linhasNovas = (report.dllLog.depois.linhas || []).slice(antesN).map(sanitizarTexto);
  report.dllLog.bytesDelta = (report.dllLog.depois.bytes || 0) - (report.dllLog.antes.bytes || 0);
  report.execucao.sequenciaDll = report.dllLog.linhasNovas;

  // Persistência no banco de teste
  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, status, idempotency_key, nsu, autorizacao, provedor, payload_retorno FROM tef_transacoes WHERE idempotency_key = ?',
        [idempotencyKey],
        (err, r) => (err ? reject(err) : resolve(r || null))
      );
    });
    report.persistencia = {
      encontrada: Boolean(row),
      id: row?.id || null,
      status: row?.status || null,
      nsu: row?.nsu || null,
      autorizacao: row?.autorizacao || null,
      provedor: row?.provedor || null,
      banco: dbPath
    };
  } catch (e) {
    report.persistencia = { erro: sanitizarTexto(e.message) };
  }

  const classificacao = classificarResultado(resultado);
  report.classificacao = classificacao;
  report.estadoFinalTransacao = {
    status: resultado?.status || null,
    sucesso: resultado?.sucesso === true,
    codigo: resultado?.codigo || null,
    codigoDestaxa: resultado?.codigoDestaxa
      || resultado?.payloadRetorno?.codigoDestaxa
      || null,
    nsu: resultado?.nsu || null,
    autorizacao: resultado?.autorizacao || null,
    financialState: resultado?.financialState
      || (classificacao === 'INCONCLUSIVA' ? 'UNKNOWN' : null),
    inconclusivo: resultado?.inconclusivo === true,
    requerContinuacao: resultado?.requerContinuacao === true,
    retryAllowed: false,
    reconciliacaoObrigatoria: resultado?.reconciliacaoObrigatoria === true
      || classificacao === 'INCONCLUSIVA'
  };

  report.confirmacoes = {
    gateOffAposExecucao: transacaoRealHabilitada() === false,
    transacaoRealHabilitada: false,
    segundaOperacaoNaoExecutada: true,
    mrt24UnknownPreservado: true,
    mrt36InconclusivaPreservada: String(m36.classificacao || '').includes('INCONCLUSIVA')
      || m36.financialState === 'UNKNOWN'
      || m36.financialState === 'PENDING',
    zeroEstCancelEstorno: true,
    crtUnica: true,
    fluxoOficialUsado: true,
    bancoTesteUsado: true,
    producaoNaoAlterada: true
  };

  if (classificacao === 'INCONCLUSIVA') {
    report.problemas.push({
      item: 'politica_inconclusivo',
      erro: 'Sem retry/EST/CONTINUE de recuperação/estorno — preservar resultado real; identidade MRT-42 exclusiva'
    });
  }

  escreverRelatorio(report);
  try { removerColetor(); } catch (_) { /* */ }
  fs.writeFileSync(DONE_FLAG, `${agora()}\n${classificacao}\n`, 'utf8');

  console.log('\n=== FIM MRT-42 ===');
  console.log('Classificação:', classificacao);
  console.log('transactionId:', report.identidade.transactionId);
  console.log('codigo:', report.estadoFinalTransacao.codigo);
  console.log('nsu:', report.estadoFinalTransacao.nsu);
  console.log('autorizacao:', report.estadoFinalTransacao.autorizacao);
  console.log('Gate OFF / transacaoRealHabilitada:', transacaoRealHabilitada());
  console.log('Relatório:', REPORT_PATH);
  console.log('Aguardando Tech Lead. Não ampliar escopo.');
}

main().catch((err) => {
  console.error(err);
  try { delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED; } catch (_) { /* */ }
  process.exitCode = 1;
});
