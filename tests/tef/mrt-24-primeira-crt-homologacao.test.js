'use strict';

/**
 * MRT-24 — Primeira CRT real de homologação Destaxa — R$ 1,00
 *
 * Autorizado: UMA CRT, R$1,00, homologação, Gertec PPC-930.
 * Proibido: segunda cobrança, EST, cancelamento, estorno, retry, produção.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-24-primeira-crt-homologacao-report.json');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const {
  obterClienteCompartilhado,
  clienteCompartilhadoExistente
} = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const {
  APLICACAO,
  OPERACOES,
  REAL_TRANSACTION_ENV,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { buildCrtInput } = require('../../backend/services/tef/destaxa/destaxaProtocolo');

function serializarErro(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    codigo: error.codigo || error.code || null
  };
}

/** Remove potenciais dados sensíveis de cartão/senha de strings de evidência. */
function sanitizarTexto(valor) {
  if (valor == null) return null;
  let s = String(valor);
  s = s.replace(/\b\d{13,19}\b/g, '[PAN_REDACTED]');
  s = s.replace(/(senha|password|pin)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
  s = s.replace(/(track|trilha)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
  if (s.length > 800) s = `${s.slice(0, 800)}…`;
  return s;
}

function sanitizarObjeto(obj, profundidade = 0) {
  if (obj == null || profundidade > 6) return obj;
  if (typeof obj === 'string') return sanitizarTexto(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((x) => sanitizarObjeto(x, profundidade + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/senha|password|pan|track|trilha|cvv|token/i.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizarObjeto(v, profundidade + 1);
    }
  }
  return out;
}

function perguntarOperador(acao) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(null);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n======== CONTINUIDADE DESTAXA (99) ========');
    console.log('Tipo:', acao?.tipo || '(desconhecido)');
    console.log('Mensagem:', sanitizarTexto(acao?.mensagem || ''));
    if (Array.isArray(acao?.opcoes) && acao.opcoes.length) {
      console.log('Opções:', acao.opcoes.join(' | '));
    }
    console.log('Use o PinPad se a coleta for no equipamento.');
    console.log('Se a AC deve responder, digite a resposta e Enter.');
    console.log('==========================================\n');
    rl.question('respostaContinuidade> ', (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function configServiceHomologacao() {
  return {
    async obterConfiguracao() {
      return {
        tefProvedor: 'destaxa',
        tefAmbiente: AMBIENTE_TRANSACAO_REAL,
        pinpadHabilitado: 'true',
        portaCom: 'COM4',
        pinpadCodigo: 'GERTEC_PPC930',
        pinpadModelo: 'Gertec PPC930',
        pinpadNome: 'Gertec PPC-930',
        _defaultsAplicados: false
      };
    },
    validarConfiguracao() {
      return { valida: true, pendencias: [] };
    }
  };
}

function instrumentarContadoresTx(client) {
  const enviarOriginal = client.enviar.bind(client);
  const contadores = {
    init: 0,
    enableReal: 0,
    txStart: 0,
    txContinue: 0,
    txFinalize: 0,
    outrasTx: 0
  };
  const sequencia = [];
  client.enviar = async function enviarCount(operacao, payload, opcoes = {}) {
    const op = String(operacao || '');
    const entrada = {
      op,
      em: new Date().toISOString(),
      transactionId: opcoes.transactionId != null ? String(opcoes.transactionId) : null
    };
    if (op === OPERACOES_HOST.INIT_CLIENT) contadores.init += 1;
    if (op === OPERACOES_HOST.ENABLE_REAL) contadores.enableReal += 1;
    if (op === OPERACOES_HOST.TX_START) {
      contadores.txStart += 1;
      sequencia.push({ ...entrada, passo: 'TX_START' });
    } else if (op === OPERACOES_HOST.TX_CONTINUE) {
      contadores.txContinue += 1;
      sequencia.push({ ...entrada, passo: 'TX_CONTINUE' });
    } else if (op === OPERACOES_HOST.TX_FINALIZE) {
      contadores.txFinalize += 1;
      sequencia.push({ ...entrada, passo: 'TX_FINALIZE' });
    } else if (op.startsWith('TX_')) {
      contadores.outrasTx += 1;
      sequencia.push({ ...entrada, passo: op });
    }
    const resp = await enviarOriginal(operacao, payload, opcoes);
    if (op === OPERACOES_HOST.TX_START
      || op === OPERACOES_HOST.TX_CONTINUE
      || op === OPERACOES_HOST.TX_FINALIZE) {
      const last = sequencia[sequencia.length - 1];
      if (last) {
        last.codigoDestaxa = resp?.output?.codigoDestaxa || resp?.output?.codigo || resp?.error?.code || null;
        last.requerContinuacao = resp?.output?.requerContinuacao === true;
        last.sucesso = resp?.error ? false : resp?.output?.sucesso === true;
        last.mensagem = sanitizarTexto(resp?.output?.mensagem || resp?.error?.message || null);
      }
    }
    return resp;
  };
  return { contadores, sequencia };
}

async function escreverRelatorio(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const geradoEm = new Date().toISOString();
  const pkg = require('../../package.json');
  const versao = String(pkg.version || '').trim();
  const transactionId = `mrt24_${crypto.randomBytes(8).toString('hex')}`;
  const idempotencyKey = `idem_mrt24_${crypto.randomBytes(8).toString('hex')}`;

  console.log('=== MRT-24 — Primeira CRT real homologação Destaxa R$ 1,00 ===\n');
  console.log('ATENÇÃO: operação financeira de TESTE em homologação.');
  console.log('Tenha o cartão de teste Destaxa e o PinPad PPC-930 (COM4) prontos.\n');

  const report = {
    sprint: 'MRT-24',
    title: 'Primeira CRT real de homologação Destaxa — R$ 1,00',
    generatedAt: geradoEm,
    classificacao: null,
    distinguicao: null,
    restricoesObservadas: {
      crtUnica: true,
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      ambiente: AMBIENTE_TRANSACAO_REAL,
      est: false,
      cancelamento: false,
      estorno: false,
      segundaCobranca: false,
      producao: false,
      migration: false,
      configDestaxaAlterada: false,
      bancoProducaoAlterado: false
    },
    preValidacao: {},
    execucao: {},
    evidencias: {},
    problemas: [],
    resultadoFinal: null
  };

  const interromper = async (classificacao, motivo, extra = {}) => {
    report.classificacao = classificacao;
    report.distinguicao = 'Operação não iniciada';
    report.preValidacao.interrompido = true;
    report.preValidacao.motivo = motivo;
    report.resultadoFinal = `MRT-24 — ${classificacao}: ${motivo}`;
    Object.assign(report.evidencias, extra);
    await escreverRelatorio(report);
    console.error('\nINTERROMPIDO:', motivo);
    console.error('Classificação:', classificacao);
    console.error('Relatório:', REPORT_PATH);
    process.exitCode = classificacao === 'CRT BLOQUEADA ANTES DA EXECUÇÃO' ? 0 : 1;
  };

  // ——— PRÉ-VALIDAÇÃO ———
  console.log('1. Pré-validação obrigatória');

  // Gate começa OFF até pré-conds OK; depois ON só para a CRT
  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const vspague = sdkDetector.detectarVsPagueClient();
  report.preValidacao.vspague = {
    detectado: vspague.detectado === true,
    executando: vspague.executando === true,
    responding: vspague.responding,
    pid: vspague.pid || null,
    caminho: vspague.caminho || null
  };
  console.log('  V$Pague:', JSON.stringify(report.preValidacao.vspague));

  if (!report.preValidacao.vspague.detectado
    || !report.preValidacao.vspague.executando
    || report.preValidacao.vspague.responding === false) {
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'V$Pague Client indisponível');
    return;
  }

  const pinpad = sdkDetector.detectarGertecPPC930({ portaConfigurada: 'COM4' });
  report.preValidacao.pinpad = {
    modelo: pinpad.modelo || 'Gertec PPC930',
    porta: pinpad.porta || null,
    detectado: pinpad.detectado === true,
    estado: pinpad.estado || null,
    usb: pinpad.usb === true,
    dispositivo: pinpad.dispositivo
      ? { porta: pinpad.dispositivo.porta, nome: pinpad.dispositivo.nome }
      : null
  };
  console.log('  PinPad:', JSON.stringify(report.preValidacao.pinpad));

  if (!report.preValidacao.pinpad.detectado
    || String(report.preValidacao.pinpad.porta || '').toUpperCase() !== 'COM4') {
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'PinPad PPC-930 não disponível na COM4');
    return;
  }

  if (process.arch !== 'x64') {
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', `Arquitetura ${process.arch} ≠ x64`);
    return;
  }

  if (!versao) {
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'package.json.version ausente');
    return;
  }

  const valorOk = VALOR_HOMOLOGACAO_CENTAVOS === 100;
  const entradaCrt = buildCrtInput({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS });
  report.preValidacao.crt = {
    provedor: 'destaxa',
    ambiente: AMBIENTE_TRANSACAO_REAL,
    operacao: OPERACOES.CRT,
    valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    valorFormatado: entradaCrt.campos?.transacao_valor || entradaCrt.texto,
    somenteCrt: true,
    valorExatoR1: valorOk
  };
  if (!valorOk) {
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'Valor homologação ≠ 100 centavos');
    return;
  }

  report.evidencias.transactionId = transactionId;
  report.evidencias.idempotencyKey = idempotencyKey;

  // Sessão anterior morta — novo host com gate ON no spawn
  process.env[REAL_TRANSACTION_ENV] = '1';
  assert.strictEqual(transacaoRealHabilitada(), true);

  const client = obterClienteCompartilhado();
  const estadoPrevio = client.getEstado();
  if (['READY', 'BUSY', 'CRASHED', 'STOPPED', 'SHUTTING_DOWN'].includes(estadoPrevio.estado)) {
    try {
      if (estadoPrevio.estado === 'READY' || estadoPrevio.estado === 'BUSY') {
        await client.encerrar({ aguardarMs: 5000 });
      }
      const reinicio = await client.reiniciar({ reconciliado: true });
      if (!reinicio.sucesso) {
        const okStart = await client.iniciar();
        if (!okStart) {
          delete process.env[REAL_TRANSACTION_ENV];
          await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'Falha ao iniciar Native Host compartilhado');
          return;
        }
      }
    } catch (error) {
      delete process.env[REAL_TRANSACTION_ENV];
      await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', `Native Host: ${error.message}`);
      return;
    }
  } else {
    const okStart = await client.iniciar();
    if (!okStart) {
      delete process.env[REAL_TRANSACTION_ENV];
      await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'Native Host não ficou READY');
      return;
    }
  }

  const { contadores, sequencia } = instrumentarContadoresTx(client);
  report.evidencias.contadoresIpc = contadores;
  report.evidencias.sequenciaTx = sequencia;

  const configInit = {
    provedor: 'destaxa',
    ambiente: AMBIENTE_TRANSACAO_REAL
  };
  const projecao = projetarEntradaIniciaClient(configInit, { versao, aplicacao: APLICACAO });
  report.preValidacao.entradaInit = {
    texto: projecao.texto,
    chaves: projecao.chaves,
    incluiPdvOuCaixa: projecao.incluiPdvOuCaixa
  };

  const bridge = new DestaxaHostBridge({ client, config: configInit });
  const adapter = new DestaxaRealAdapter(configInit, {
    bridge,
    executionMode: 'native-host',
    configService: configServiceHomologacao(),
    sdkDetector
  });

  const carga = await bridge.load();
  report.preValidacao.load = {
    sucesso: carga?.sucesso === true,
    dllPath: carga?.diagnostico?.dllPath || carga?.dllPath || null,
    dllLoaded: carga?.diagnostico?.dllLoaded === true,
    exportsValid: carga?.diagnostico?.exportsValid === true,
    exports: carga?.diagnostico?.exports || null,
    estado: carga?.estado || carga?.diagnostico?.estado || null
  };
  console.log('  LOAD:', JSON.stringify({
    sucesso: report.preValidacao.load.sucesso,
    exportsValid: report.preValidacao.load.exportsValid,
    estado: report.preValidacao.load.estado
  }));
  if (!report.preValidacao.load.sucesso || !report.preValidacao.load.exportsValid) {
    delete process.env[REAL_TRANSACTION_ENV];
    try { await client.encerrar({ aguardarMs: 3000 }); } catch (_) { /* */ }
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'LOAD/exports DLL falhou', {
      load: report.preValidacao.load
    });
    return;
  }

  const statusAntesInit = await bridge.getHostStatus();
  if (statusAntesInit?.operacaoAtiva) {
    delete process.env[REAL_TRANSACTION_ENV];
    try { await client.encerrar({ aguardarMs: 3000 }); } catch (_) { /* */ }
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'Operação nativa já ativa no host');
    return;
  }
  if (statusAntesInit?.diagnostics?.transactionActive
    || statusAntesInit?.contexto?.transactionId) {
    delete process.env[REAL_TRANSACTION_ENV];
    try { await client.encerrar({ aguardarMs: 3000 }); } catch (_) { /* */ }
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'Transação pendente/inconclusiva no host');
    return;
  }

  const pidAntesInit = statusAntesInit?.pid || client.getEstado().pid;
  report.evidencias.nativeHostPidAntesInit = pidAntesInit;

  console.log('  INIT único…');
  let initResultado = null;
  try {
    initResultado = await bridge.iniciarClient(configInit);
  } catch (error) {
    delete process.env[REAL_TRANSACTION_ENV];
    try { await client.encerrar({ aguardarMs: 3000 }); } catch (_) { /* */ }
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', `INIT falhou: ${error.message}`, {
      initErro: serializarErro(error)
    });
    return;
  }

  const statusPosInit = await bridge.getHostStatus();
  const pidPosInit = statusPosInit?.pid || client.getEstado().pid;
  report.preValidacao.init = {
    sucesso: initResultado?.sucesso === true,
    codigoDestaxa: initResultado?.codigoDestaxa || null,
    estado: initResultado?.estado || null,
    clientInitialized: statusPosInit?.diagnostics?.clientInitialized === true,
    clientResultCode: statusPosInit?.diagnostics?.clientResultCode || null,
    chamadasInit: contadores.init,
    pid: pidPosInit
  };
  report.evidencias.nativeHostPid = pidPosInit;
  report.evidencias.mesmoPidAposInit = String(pidAntesInit) === String(pidPosInit);
  console.log('  INIT:', JSON.stringify(report.preValidacao.init));

  if (!report.preValidacao.init.sucesso
    || report.preValidacao.init.codigoDestaxa !== '00'
    || !report.preValidacao.init.clientInitialized
    || contadores.init !== 1) {
    delete process.env[REAL_TRANSACTION_ENV];
    try { await client.encerrar({ aguardarMs: 3000 }); } catch (_) { /* */ }
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'INIT não estabeleceu clientInitialized=00');
    return;
  }

  if (String(pidAntesInit) !== String(pidPosInit)) {
    delete process.env[REAL_TRANSACTION_ENV];
    try { await client.encerrar({ aguardarMs: 3000 }); } catch (_) { /* */ }
    await interromper('CRT BLOQUEADA ANTES DA EXECUÇÃO', 'PID Native Host mudou durante INIT');
    return;
  }

  report.preValidacao.gateFinanceiro = {
    env: REAL_TRANSACTION_ENV,
    enabled: transacaoRealHabilitada() === true
  };
  report.preValidacao.ok = true;
  console.log('  Pré-validação OK — iniciando ÚNICA CRT R$1,00\n');
  console.log('>>> No PinPad: aproxime/insira o cartão de TESTE Destaxa quando solicitado.\n');

  // ——— EXECUÇÃO CRT ———
  report.execucao.inicio = new Date().toISOString();
  report.execucao.transactionId = transactionId;
  report.execucao.idempotencyKey = idempotencyKey;
  report.execucao.valorCentavos = VALOR_HOMOLOGACAO_CENTAVOS;
  report.classificacao = 'CRT INCONCLUSIVA';
  report.distinguicao = 'Operação iniciada sem resultado conclusivo';
  // Checkpoint antes da CRT — se o processo cair, evidência parcial permanece
  await escreverRelatorio({
    ...report,
    checkpoint: 'PRE_CRT',
    resultadoFinal: 'MRT-24 EM ANDAMENTO — checkpoint pré-CRT'
  });

  let resultado = null;
  let continuacoesOperador = 0;
  const maxLoopsOperador = 16;

  const finalizarSeguro = async (motivo) => {
    try {
      delete process.env[REAL_TRANSACTION_ENV];
    } catch (_) { /* */ }
    report.execucao.fim = new Date().toISOString();
    report.evidencias.contadoresIpc = { ...contadores };
    report.evidencias.sequenciaTx = sequencia.map((s) => sanitizarObjeto(s));
    report.evidencias.txStartCount = contadores.txStart;
    report.evidencias.segundoTxStart = contadores.txStart > 1;
    report.evidencias.gateFinalOff = transacaoRealHabilitada() === false;
    report.confirmacoes = {
      umUnicoTxStart: contadores.txStart <= 1,
      nenhumEst: true,
      nenhumCancelamentoEstorno: true,
      nenhumaSegundaCobranca: contadores.txStart <= 1,
      gateDesligadoAposRegistro: transacaoRealHabilitada() === false,
      semDadosSensiveisCartao: true
    };
    if (motivo) {
      report.problemas.push({ item: 'finalizarSeguro', erro: motivo });
    }
    report.resultadoFinal = `MRT-24 CONCLUÍDA — ${report.classificacao || 'CRT INCONCLUSIVA'}`;
    await escreverRelatorio(report);
  };

  process.on('exit', () => {
    try {
      if (!fs.existsSync(REPORT_PATH) || report.execucao.fim == null) {
        report.classificacao = report.classificacao || 'CRT INCONCLUSIVA';
        report.distinguicao = 'Operação iniciada sem resultado conclusivo';
        report.problemas.push({ item: 'exit', erro: 'Processo encerrou durante/após CRT sem flush completo' });
        report.resultadoFinal = `MRT-24 CONCLUÍDA — ${report.classificacao}`;
        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
      }
    } catch (_) { /* last resort */ }
  });

  try {
    resultado = await adapter.autorizarPagamento({
      tipo: 'credito',
      valor: 1,
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      transacao_id: transactionId,
      idempotency_key: idempotencyKey,
      venda_id: null,
      pdv_codigo: null
    }, {
      pronto: true,
      transactionId,
      contexto: {
        operacao: OPERACOES.CRT,
        valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
        camposEntrada: entradaCrt.campos,
        checks: { mrt24: true }
      }
    });

    await escreverRelatorio({
      ...report,
      checkpoint: 'POS_AUTORIZAR',
      execucao: {
        ...report.execucao,
        resultadoParcial: sanitizarObjeto({
          sucesso: resultado?.sucesso,
          codigo: resultado?.codigo,
          requerContinuacao: resultado?.requerContinuacao,
          inconclusivo: resultado?.inconclusivo
        })
      },
      evidencias: {
        ...report.evidencias,
        contadoresIpc: { ...contadores },
        sequenciaTx: sequencia.map((s) => sanitizarObjeto(s))
      },
      resultadoFinal: 'MRT-24 EM ANDAMENTO — pós autorizarPagamento'
    });

    // Loop continuidade SEM novo TX_START
    while (resultado?.requerContinuacao === true && continuacoesOperador < maxLoopsOperador) {
      if (contadores.txStart > 1) {
        throw Object.assign(new Error('Segundo TX_START detectado — abortando'), {
          codigo: 'MRT24_SEGUNDO_TX_START'
        });
      }
      const resposta = await perguntarOperador(resultado.acao);
      if (resposta == null || resposta === '') {
        report.problemas.push({
          item: 'continuidade',
          erro: 'Operador/TTY sem resposta para COLETA/OPCAO — ciclo permanece pendente/inconclusivo'
        });
        break;
      }
      continuacoesOperador += 1;
      resultado = await adapter.continuarPagamento({
        transacao_id: transactionId,
        transacaoId: transactionId,
        resposta_continuidade: resposta,
        acao: resultado.acao,
        idempotency_key: idempotencyKey
      });
    }
  } catch (error) {
    report.execucao.erro = serializarErro(error);
    report.problemas.push({ item: 'crt', ...serializarErro(error) });
    resultado = resultado || {
      sucesso: false,
      inconclusivo: true,
      codigo: error.codigo || 'MRT24_CRT_ERRO',
      mensagem: error.message
    };
    report.classificacao = contadores.txStart >= 1 ? 'CRT INCONCLUSIVA' : 'CRT BLOQUEADA ANTES DA EXECUÇÃO';
    report.distinguicao = contadores.txStart >= 1
      ? 'Operação iniciada sem resultado conclusivo'
      : 'Operação não iniciada';
    await finalizarSeguro(error.message);
    try { await client.encerrar({ aguardarMs: 5000 }); } catch (_) { /* */ }
    assert.ok(contadores.txStart <= 1, 'Nunca mais de um TX_START');
    return;
  }

  report.execucao.fim = new Date().toISOString();
  report.execucao.continuacoesOperador = continuacoesOperador;
  report.execucao.resultado = sanitizarObjeto({
    sucesso: resultado?.sucesso === true,
    status: resultado?.status || null,
    codigo: resultado?.codigo || null,
    codigoDestaxa: resultado?.codigoDestaxa || null,
    mensagem: resultado?.mensagem || null,
    financialState: resultado?.financialState || null,
    protocolState: resultado?.protocolState || resultado?.estado || null,
    requerContinuacao: resultado?.requerContinuacao === true,
    inconclusivo: resultado?.inconclusivo === true,
    reconciliacaoObrigatoria: resultado?.reconciliacaoObrigatoria === true,
    retryAllowed: resultado?.retryAllowed === false ? false : resultado?.retryAllowed,
    nsu: resultado?.nsu ? '[PRESENTE]' : null,
    autorizacao: resultado?.autorizacao ? '[PRESENTE]' : null,
    cicloCrt: resultado?.cicloCrt || null,
    acaoPendente: resultado?.acao
      ? { tipo: resultado.acao.tipo, mensagem: sanitizarTexto(resultado.acao.mensagem) }
      : null
  });

  report.evidencias.contadoresIpc = { ...contadores };
  report.evidencias.sequenciaTx = sequencia.map((s) => sanitizarObjeto(s));
  report.evidencias.segundoTxStart = contadores.txStart > 1;
  report.evidencias.txStartCount = contadores.txStart;
  report.evidencias.somenteCrt = contadores.outrasTx === 0;
  report.evidencias.gateAindaOnDuranteCrt = true;
  report.evidencias.tefManager = {
    usado: false,
    motivo: 'CRT via DestaxaRealAdapter (mesmo caminho chamado pelo TefManager) para não gravar em banco de produção; sem venda/PDV comercial'
  };
  report.evidencias.vinculoVendaPdv = resultado?.vinculoVendaPdv || null;

  const pidFinal = client.getEstado().pid;
  report.evidencias.nativeHostPidFinal = pidFinal;
  report.evidencias.pidPreservadoDuranteCrt = String(pidFinal) === String(pidPosInit);

  // Classificação
  const aprovado = resultado?.sucesso === true
    && (resultado?.status === 'aprovado' || resultado?.financialState === 'CONFIRMED_SUCCESS'
      || String(resultado?.codigoDestaxa || '') === '00');
  const negado = resultado?.sucesso === false
    && (resultado?.status === 'negado' || resultado?.financialState === 'CONFIRMED_DENIED'
      || ['03', '04', '09'].includes(String(resultado?.codigoDestaxa || resultado?.codigo || '').toUpperCase()));
  const inconclusivo = resultado?.inconclusivo === true
    || resultado?.reconciliacaoObrigatoria === true
    || resultado?.requerContinuacao === true
    || (contadores.txStart >= 1 && !aprovado && !negado);

  if (contadores.txStart < 1) {
    report.classificacao = 'CRT BLOQUEADA ANTES DA EXECUÇÃO';
    report.distinguicao = 'Operação não iniciada';
  } else if (aprovado && contadores.txStart === 1) {
    report.classificacao = 'CRT HOMOLOGADA COM SUCESSO';
    report.distinguicao = 'Operação concluída e aprovada';
  } else if (negado && contadores.txStart === 1) {
    report.classificacao = 'CRT NEGADA';
    report.distinguicao = 'Operação concluída e negada';
  } else {
    report.classificacao = 'CRT INCONCLUSIVA';
    report.distinguicao = contadores.txStart >= 1
      ? 'Operação iniciada sem resultado conclusivo'
      : 'Operação não iniciada';
  }

  report.confirmacoes = {
    umUnicoTxStart: contadores.txStart === 1,
    nenhumEst: true,
    nenhumCancelamentoEstorno: true,
    nenhumaSegundaCobranca: contadores.txStart <= 1,
    gateDesligadoAposRegistro: false,
    semDadosSensiveisCartao: true
  };

  // Gate OFF após registrar — sem segunda operação
  delete process.env[REAL_TRANSACTION_ENV];
  report.confirmacoes.gateDesligadoAposRegistro = transacaoRealHabilitada() === false;
  report.evidencias.gateFinalOff = transacaoRealHabilitada() === false;

  report.resultadoFinal = `MRT-24 CONCLUÍDA — ${report.classificacao}`;
  await escreverRelatorio(report);

  console.log('\n======== RESULTADO MRT-24 ========');
  console.log('Classificação:', report.classificacao);
  console.log('Distinção:', report.distinguicao);
  console.log('TX_START count:', contadores.txStart);
  console.log('TX_CONTINUE count:', contadores.txContinue);
  console.log('TX_FINALIZE count:', contadores.txFinalize);
  console.log('Native Host PID:', pidPosInit, '→', pidFinal);
  console.log('Relatório:', REPORT_PATH);
  console.log('==================================\n');

  // Encerrar host (sessão morre). Não liberar reconciliação inconclusiva.
  try {
    await client.encerrar({ aguardarMs: 5000 });
    report.evidencias.hostEncerradoAoFim = true;
  } catch (error) {
    report.evidencias.hostEncerradoAoFim = false;
    report.problemas.push({ item: 'encerrar', erro: error.message });
  }
  await escreverRelatorio(report);

  // Exit 0 mesmo se negada/inconclusiva — sprint executou o procedimento único
  assert.ok(contadores.txStart <= 1, 'Nunca mais de um TX_START');
  assert.strictEqual(transacaoRealHabilitada(), false);
}

main().catch(async (error) => {
  console.error('MRT-24 FALHOU:', error);
  delete process.env[REAL_TRANSACTION_ENV];
  try {
    const c = clienteCompartilhadoExistente();
    if (c) await c.encerrar({ aguardarMs: 3000 });
  } catch (_) { /* */ }
  try {
    await escreverRelatorio({
      sprint: 'MRT-24',
      fatal: true,
      classificacao: 'CRT INCONCLUSIVA',
      distinguicao: 'Operação iniciada sem resultado conclusivo',
      erro: serializarErro(error),
      stack: error.stack
    });
  } catch (_) { /* */ }
  process.exitCode = 1;
});
