'use strict';

/**
 * MRT-36 — Execução controlada de UMA CRT R$1,00 Destaxa (autorizada PO).
 *
 * Fluxo oficial: tef.iniciarPagamento → TefManager.autorizar → persistência →
 * DestaxaRealAdapter → HostBridge → NativeHost → Orquestrador → Koffi → DLL.
 *
 * Proibido: Adapter direto, bypass DLL, segunda CRT, EST/cancel/estorno, retry
 * após inconclusivo, reutilizar MRT-24.
 *
 * Banco: autorizada persistência operacional no DB oficial (ProgramData).
 * Desliga isolamento de teste ANTES de carregar database.js.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DB_DIR_OFICIAL = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
// Antes de qualquer require que carregue database.js
process.env.CDS_TEST_ISOLAR_BANCO = '0';
process.env.DB_DIR = process.env.MRT36_DB_DIR || DB_DIR_OFICIAL;
process.env.TEF_TIMEOUT_MS = process.env.TEF_TIMEOUT_MS || '600000';
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json');
const MRT24_REPORT = path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json');
const DLL_LOG = 'C:\\CDS-SISTEMAS\\logs\\destaxa\\destaxa-dll.log';
const DLL_DIR = 'C:\\CDS-SISTEMAS\\logs\\destaxa';
const DLL_PATH = path.join(ROOT, 'resources/tef/destaxa/win-x64/libdll-integracao-tef.dll');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const tefService = require('../../backend/services/tef');
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
const { ESTADOS_VINCULO } = require('../../backend/services/tef/tefVinculoVendaService');
const { clienteCompartilhadoExistente } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');

function agora() {
  return new Date().toISOString();
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
  if (!fs.existsSync(DLL_LOG)) {
    return { exists: false, bytes: 0, linhas: [] };
  }
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
      resolve(null);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n======== CONTINUIDADE CRT (mesma identidade; sem novo TX_START) ========');
    console.log('Tipo:', acao?.tipo || '(desconhecido)');
    console.log('Mensagem:', sanitizarTexto(acao?.mensagem || ''));
    if (Array.isArray(acao?.opcoes) && acao.opcoes.length) {
      console.log('Opções:', acao.opcoes.join(' | '));
    }
    console.log('PinPad: use o equipamento se a coleta for lá.');
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
    || resultado.status === 'pendente' || resultado.reconciliacaoObrigatoria === true) {
    return 'INCONCLUSIVA';
  }
  if (resultado.sucesso === false && resultado.transactionAttempted !== true) {
    return 'BLOQUEADA_PRE_EXECUCAO';
  }
  return 'INCONCLUSIVA';
}

async function main() {
  const geradoEm = agora();
  const suffix = crypto.randomBytes(8).toString('hex');
  const idempotencyKey = `mrt36_${suffix}`;

  let mrt24Ids = { transactionId: null, idempotencyKey: null };
  try {
    const m24 = JSON.parse(fs.readFileSync(MRT24_REPORT, 'utf8'));
    mrt24Ids = {
      transactionId: m24.execucao?.transactionId || m24.evidencias?.transactionId || null,
      idempotencyKey: m24.execucao?.idempotencyKey || null,
      financialState: m24.execucao?.resultado?.financialState || 'UNKNOWN'
    };
  } catch (_) { /* */ }

  assert.notStrictEqual(idempotencyKey, mrt24Ids.transactionId);
  assert.notStrictEqual(idempotencyKey, mrt24Ids.idempotencyKey);

  const etapasColetadas = [];
  const removerColetor = instalarColetorTeste((ev) => {
    etapasColetadas.push(sanitizarEvidencia(ev));
    console.log(`  [ETAPA] ${ev?.etapa || ev?.contexto?.etapa || '?'} @ ${ev?.timestamp || agora()}`);
  });

  const report = {
    sprint: 'MRT-36',
    title: 'Execução controlada de uma CRT R$1,00 Destaxa',
    generatedAt: geradoEm,
    autorizacao: {
      productOwner: true,
      escopo: 'UMA CRT R$1,00 homologação',
      segundaOperacaoAutorizada: false
    },
    classificacao: 'BLOQUEADA_PRE_EXECUCAO',
    restricoesObservadas: {
      fluxoOficialTefManager: true,
      adapterDireto: false,
      bypassDll: false,
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      ambiente: AMBIENTE_TRANSACAO_REAL,
      venda_id: null,
      segundaCrt: false,
      est: false,
      cancelamento: false,
      estorno: false,
      retryAposInconclusivo: false,
      mrt24Reutilizada: false
    },
    preCondicoes: {},
    identidade: {
      idempotency_key: idempotencyKey,
      operation_id: null,
      fingerprint: null,
      transactionId: null,
      distintaDeMrt24: true,
      mrt24Preservada: {
        transactionId: mrt24Ids.transactionId,
        financialState: mrt24Ids.financialState || 'UNKNOWN',
        estado: 'UNKNOWN'
      }
    },
    execucao: {
      inicio: null,
      fim: null,
      gateJanela: { ligadoEm: null, desligadoEm: null },
      resultadoBruto: null,
      continuidade: []
    },
    instrumentacao: { etapas: etapasColetadas, sequenciaEsperada: Object.values(ETAPAS_FLUXO) },
    dllLog: { antes: null, depois: null, linhasNovas: [] },
    vinculoVenda: {
      venda_id: null,
      estadoVinculo: ESTADOS_VINCULO.PENDENTE_FINALIZACAO,
      vinculacaoPosterior: 'somente tefVinculoVendaService se autorizada'
    },
    confirmacoes: {},
    problemas: []
  };

  const restaurarGate = (motivo) => {
    delete process.env[REAL_TRANSACTION_ENV];
    report.execucao.gateJanela.desligadoEm = agora();
    report.execucao.gateJanela.motivoOff = motivo;
    report.confirmacoes.gateOffAposExecucao = transacaoRealHabilitada() === false;
    console.log(`>>> Gate OFF (${motivo}). enabled=${transacaoRealHabilitada()}`);
  };

  const finalizarSeguro = (classificacao, motivo) => {
    try { restaurarGate(motivo || classificacao); } catch (_) { /* */ }
    report.classificacao = classificacao;
    report.execucao.fim = agora();
    report.instrumentacao.etapas = etapasColetadas;
    report.confirmacoes = {
      ...report.confirmacoes,
      gateOffAposExecucao: transacaoRealHabilitada() === false,
      segundaOperacaoNaoExecutada: true,
      mrt24UnknownPreservado: true,
      zeroEstCancelEstorno: true,
      crtUnica: true
    };
    escreverRelatorio(report);
    removerColetor();
    console.log('\nClassificação:', classificacao);
    console.log('Relatório:', REPORT_PATH);
  };

  process.on('uncaughtException', (err) => {
    report.problemas.push({ item: 'uncaughtException', erro: sanitizarTexto(err.message) });
    report.execucao.resultadoBruto = { inconclusivo: true, financialState: 'UNKNOWN', erro: sanitizarTexto(err.message) };
    finalizarSeguro('INCONCLUSIVA', 'uncaughtException');
    process.exitCode = 1;
  });
  process.on('unhandledRejection', (err) => {
    report.problemas.push({ item: 'unhandledRejection', erro: sanitizarTexto(err?.message || String(err)) });
    report.execucao.resultadoBruto = { inconclusivo: true, financialState: 'UNKNOWN', erro: sanitizarTexto(err?.message || String(err)) };
    finalizarSeguro('INCONCLUSIVA', 'unhandledRejection');
    process.exitCode = 1;
  });

  console.log('=== MRT-36 — CRT controlada R$1,00 Destaxa ===\n');
  console.log('1. Pré-condições (gate OFF)');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const vspague = sdkDetector.detectarVsPagueClient();
  const pinpad = sdkDetector.detectarGertecPPC930({ portaConfigurada: 'COM4' });
  report.dllLog.antes = lerDllLogSnapshot();

  report.preCondicoes = {
    homologacao: AMBIENTE_TRANSACAO_REAL,
    gateOffAntes: transacaoRealHabilitada() === false,
    dbDir: process.env.DB_DIR,
    bancoOficial: String(process.env.DB_DIR || '').includes('MercantilFiscal')
      && !String(process.env.DB_DIR || '').includes('cds-sistemas-test-db'),
    isolamentoTesteDesligado: process.env.CDS_TEST_ISOLAR_BANCO === '0',
    arch: process.arch,
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
    dll: {
      path: DLL_PATH,
      existe: fs.existsSync(DLL_PATH),
      versaoEsperada: '1.83 x64'
    },
    logDll: {
      diretorio: DLL_DIR,
      diretorioExiste: fs.existsSync(DLL_DIR),
      nivel_log: DESTAXA_DLL_LOG_PARAMS.nivel_log,
      bytesAntes: report.dllLog.antes.bytes
    },
    nativeHostMrt26: {
      disconnectAdiadoEmVoo: true,
      nota: 'DestaxaNativeHost.js — disconnect.adiado se nativa em voo'
    },
    mrt24: { estado: 'UNKNOWN', transactionId: mrt24Ids.transactionId },
    identidadeInedita: {
      idempotency_key: idempotencyKey,
      colideMrt24: false
    },
    hostPrevio: (() => {
      const c = clienteCompartilhadoExistente();
      if (!c) return { presente: false };
      const e = c.getEstado();
      return { presente: true, estado: e.estado, pid: e.pid };
    })()
  };

  console.log('  ', JSON.stringify({
    gateOff: report.preCondicoes.gateOffAntes,
    vspague: report.preCondicoes.vspague,
    pinpad: report.preCondicoes.pinpad,
    dll: report.preCondicoes.dll.existe,
    logBytes: report.preCondicoes.logDll.bytesAntes
  }));

  const falhas = [];
  if (!report.preCondicoes.gateOffAntes) falhas.push('gate não está OFF');
  if (!report.preCondicoes.bancoOficial) falhas.push('DB não é o banco oficial MercantilFiscal');
  if (!report.preCondicoes.isolamentoTesteDesligado) falhas.push('CDS_TEST_ISOLAR_BANCO ativo');
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

  if (falhas.length) {
    report.preCondicoes.ok = false;
    report.preCondicoes.falhas = falhas;
    report.problemas.push({ item: 'preCondicoes', erro: falhas.join('; ') });
    finalizarSeguro('BLOQUEADA_PRE_EXECUCAO', falhas.join('; '));
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
      idempotency_key: idempotencyKey
    });
  } catch (error) {
    resultado = {
      sucesso: false,
      inconclusivo: true,
      financialState: 'UNKNOWN',
      codigo: error.code || 'MRT36_EXCECAO',
      mensagem: error.message,
      retryAllowed: false,
      reconciliacaoObrigatoria: true
    };
    report.problemas.push({ item: 'iniciarPagamento', erro: sanitizarTexto(error.message) });
  }

  // Continuidade oficial da MESMA CRT (sem novo TX_START / sem segunda cobrança)
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
    report.execucao.continuidade.push({ n: loops, respostaLen: resposta.length });
    try {
      resultado = await tefService.continuarPagamento({
        transacao_id: resultado.transacao_id || resultado.transacaoId,
        idempotency_key: idempotencyKey,
        respostaOperador: { informacao: resposta },
        acao: resultado.acao
      });
    } catch (error) {
      resultado = {
        sucesso: false,
        inconclusivo: true,
        financialState: 'UNKNOWN',
        codigo: error.code || 'MRT36_CONTINUIDADE_EXCECAO',
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
    || null;
  report.identidade.fingerprint = etapasColetadas.find((e) => e.fingerprint)?.fingerprint || null;
  report.identidade.distintaDeMrt24 = String(report.identidade.transactionId || '') !== String(mrt24Ids.transactionId || '')
    && idempotencyKey !== mrt24Ids.idempotencyKey;

  report.execucao.resultadoBruto = sanitizarObjeto(resultado);
  report.execucao.fim = agora();
  report.dllLog.depois = lerDllLogSnapshot();
  const antesN = report.dllLog.antes.linhas.length;
  report.dllLog.linhasNovas = (report.dllLog.depois.linhas || []).slice(antesN).map(sanitizarTexto);
  report.dllLog.bytesDelta = (report.dllLog.depois.bytes || 0) - (report.dllLog.antes.bytes || 0);

  report.vinculoVenda = {
    venda_id: null,
    estadoVinculo: ESTADOS_VINCULO.PENDENTE_FINALIZACAO,
    evidenciadoNoRetorno: sanitizarObjeto(resultado?.vinculoVendaPdv || null)
  };

  const nomesEtapas = etapasColetadas.map((e) => e.etapa || e.contexto?.etapa).filter(Boolean);
  report.instrumentacao = {
    etapas: etapasColetadas,
    sequenciaObservada: nomesEtapas,
    sequenciaEsperada: Object.values(ETAPAS_FLUXO),
    persistenciaAntesAdapter: nomesEtapas.indexOf(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA) >= 0
      && (
        nomesEtapas.indexOf(ETAPAS_FLUXO.ADAPTER_AUTORIZADO) < 0
        || nomesEtapas.indexOf(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA)
          <= nomesEtapas.indexOf(ETAPAS_FLUXO.ADAPTER_AUTORIZADO)
      )
  };

  const classificacao = classificarResultado(resultado);
  report.classificacao = classificacao;
  report.estadoFinalTransacao = {
    status: resultado?.status || null,
    sucesso: resultado?.sucesso === true,
    codigo: resultado?.codigo || null,
    codigoDestaxa: resultado?.codigoDestaxa || null,
    financialState: resultado?.financialState
      || (classificacao === 'INCONCLUSIVA' ? 'UNKNOWN' : null),
    inconclusivo: resultado?.inconclusivo === true,
    retryAllowed: false,
    reconciliacaoObrigatoria: resultado?.reconciliacaoObrigatoria === true
      || classificacao === 'INCONCLUSIVA'
  };

  report.confirmacoes = {
    gateOffAposExecucao: transacaoRealHabilitada() === false,
    segundaOperacaoNaoExecutada: true,
    mrt24UnknownPreservado: true,
    zeroEstCancelEstorno: true,
    crtUnica: true,
    fluxoOficialUsado: true,
    vendaNaoCriada: true
  };

  if (classificacao === 'INCONCLUSIVA') {
    report.problemas.push({
      item: 'politica_inconclusivo',
      erro: 'Sem retry/EST/CONTINUE de recuperação/estorno — aguardar conciliação Destaxa; identidade preservada'
    });
  }

  escreverRelatorio(report);
  removerColetor();

  console.log('\n=== FIM MRT-36 ===');
  console.log('Classificação:', classificacao);
  console.log('transactionId:', report.identidade.transactionId);
  console.log('Etapas:', nomesEtapas.join(' → ') || '(nenhuma)');
  console.log('Linhas novas DLL log:', report.dllLog.linhasNovas.length);
  console.log('Gate OFF:', transacaoRealHabilitada() === false);
  console.log('Relatório:', REPORT_PATH);
  console.log('Aguardando revisão do Tech Lead. Não iniciar MRT-37.');
}

main().catch((err) => {
  console.error(err);
  try {
    delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
  } catch (_) { /* */ }
  process.exitCode = 1;
});
