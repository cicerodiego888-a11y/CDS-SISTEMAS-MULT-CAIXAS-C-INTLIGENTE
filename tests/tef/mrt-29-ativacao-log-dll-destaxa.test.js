'use strict';

/**
 * MRT-29 — Ativação do log DLL Destaxa
 * AUTORIZAÇÃO EXPRESSA: UMA única iniciaClientDestaxa.
 * Sem TX_START / CRT / CONTINUE / FINALIZE / EST / ENABLE_REAL / 2º INIT.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-29-ativacao-log-dll-destaxa-report.json');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { obterClienteCompartilhado } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const {
  DESTAXA_DLL_LOG_PARAMS,
  garantirDiretorioLogDll,
  CHAVES_LOG_DLL
} = require('../../backend/services/tef/destaxa/destaxaDllLogConfig');
const {
  APLICACAO,
  REAL_TRANSACTION_ENV,
  AMBIENTE_TRANSACAO_REAL,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { parseParametrosDestaxa } = require('../../backend/services/tef/destaxa/destaxaProtocolo');

const LOG_PATH = path.join(
  DESTAXA_DLL_LOG_PARAMS.diretorio_trabalho,
  DESTAXA_DLL_LOG_PARAMS.nome_arquivo_log
);

function serializarErro(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    codigo: error.codigo || error.code || null,
    detalhes: error.detalhes || null
  };
}

function ocultarSensiveis(linha) {
  return String(linha || '')
    .replace(/\b\d{11,}\b/g, '[NUM]')
    .replace(/\b[0-9A-Fa-f]{32,}\b/g, '[HEX]')
    .replace(/(senha|password|token|pan|cvv|track)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/(\d{4,})\d{4}(\d{0,4})/g, '$1****$2');
}

function snapshotLog(caminho) {
  if (!fs.existsSync(caminho)) {
    return {
      existe: false,
      tamanhoBytes: 0,
      mtime: null,
      primeirasLinhas: [],
      contemRegistros: false
    };
  }
  const st = fs.statSync(caminho);
  const bruto = fs.readFileSync(caminho, 'utf8');
  const linhas = bruto.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return {
    existe: true,
    tamanhoBytes: st.size,
    mtime: st.mtime.toISOString(),
    primeirasLinhas: linhas.slice(0, 12).map(ocultarSensiveis),
    totalLinhasNaoVazias: linhas.length,
    contemRegistros: linhas.length > 0 || st.size > 0
  };
}

function bloquearFinanceiroESegundoInit(client) {
  const enviarOriginal = client.enviar.bind(client);
  let initCount = 0;
  const bloqueadas = [];
  client.enviar = async function enviarGuard(operacao, payload, opcoes) {
    const op = String(operacao || '');
    if (op === OPERACOES_HOST.TX_START
      || op === OPERACOES_HOST.TX_CONTINUE
      || op === OPERACOES_HOST.TX_FINALIZE
      || op === OPERACOES_HOST.ENABLE_REAL) {
      bloqueadas.push(op);
      const err = new Error(`MRT-29: operação financeira/transacional bloqueada (${op})`);
      err.codigo = 'MRT29_TX_BLOQUEADO';
      throw err;
    }
    if (op === OPERACOES_HOST.INIT_CLIENT) {
      initCount += 1;
      if (initCount > 1) {
        const err = new Error('MRT-29: segunda chamada INIT_CLIENT bloqueada — sem retry');
        err.codigo = 'MRT29_INIT_REPETIDO_BLOQUEADO';
        throw err;
      }
    }
    return enviarOriginal(operacao, payload, opcoes);
  };
  return {
    getInitCount: () => initCount,
    getBloqueadas: () => [...bloqueadas]
  };
}

async function carregarConfigSomenteLeitura() {
  try {
    const tefConfigService = require('../../backend/services/tef/tefConfigService');
    const config = await tefConfigService.obterConfiguracao();
    return {
      ok: true,
      provedor: config.tefProvedor || null,
      ambiente: config.tefAmbiente || null,
      empresaCodigo: config.empresaCodigo || null,
      lojaCodigo: config.lojaCodigo || null,
      terminalCodigo: config.terminalCodigo || null,
      pdvCodigo: config.pdvCodigo || null,
      caixaCodigo: config.caixaCodigo || null
    };
  } catch (error) {
    return { ok: false, erro: serializarErro(error) };
  }
}

function aguardar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const inicioSprint = new Date().toISOString();
  const pkg = require('../../package.json');
  const versao = String(pkg.version || '').trim();

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const rel = {
    sprint: 'MRT-29',
    title: 'Ativação do log DLL Destaxa (uma INIT autorizada)',
    generatedAt: inicioSprint,
    autorizacaoExpressa: {
      iniciaClientDestaxa: true,
      quantidadeMaxima: 1,
      financeiro: false
    },
    restricoesObservadas: {
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      est: false,
      cancelamento: false,
      estorno: false,
      reembolso: false,
      enableReal: false,
      gateOff: true,
      segundoInit: false,
      mrt24Repetida: false
    },
    preChecks: {},
    init: {},
    log: {},
    nativeHost: {},
    erros: [],
    classificacao: null
  };

  console.log('=== MRT-29 — Ativação log DLL Destaxa (1× INIT) ===\n');

  // ——— Pré-checks ———
  console.log('1. Pré-checks');
  const configRo = await carregarConfigSomenteLeitura();
  const ambiente = (configRo.ambiente && configRo.ambiente !== 'simulacao')
    ? configRo.ambiente
    : AMBIENTE_TRANSACAO_REAL;
  rel.preChecks.config = configRo;
  rel.preChecks.ambiente = {
    valor: ambiente,
    homologacao: ambiente === AMBIENTE_TRANSACAO_REAL || ambiente === 'homologacao',
    ok: ambiente === AMBIENTE_TRANSACAO_REAL || ambiente === 'homologacao'
  };
  console.log('  Ambiente:', ambiente);

  if (!rel.preChecks.ambiente.ok) {
    rel.classificacao = 'MRT-29 BLOQUEADA — AMBIENTE NAO HOMOLOGACAO';
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    console.error('  INTERROMPIDO: ambiente=', ambiente);
    process.exit(1);
  }

  const vspague = sdkDetector.detectarVsPagueClient();
  rel.preChecks.vspague = {
    detectado: vspague.detectado === true,
    executando: vspague.executando === true,
    responding: vspague.responding,
    pid: vspague.pid || null,
    caminho: vspague.caminho || null
  };
  console.log('  V$Pague:', JSON.stringify(rel.preChecks.vspague));

  if (!rel.preChecks.vspague.detectado
    || !rel.preChecks.vspague.executando
    || rel.preChecks.vspague.responding === false) {
    rel.classificacao = 'MRT-29 BLOQUEADA — V$PAGUE INDISPONIVEL';
    rel.preChecks.interrompido = true;
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    console.error('  INTERROMPIDO: V$Pague Client indisponível');
    process.exit(1);
  }

  const dirLog = garantirDiretorioLogDll();
  rel.preChecks.diretorioLog = dirLog;
  console.log('  Diretório log:', JSON.stringify(dirLog));
  if (!dirLog.ok) {
    rel.classificacao = 'MRT-29 BLOQUEADA — DIRETORIO LOG INDISPONIVEL';
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    process.exit(1);
  }

  rel.preChecks.gate = {
    env: process.env[REAL_TRANSACTION_ENV] || null,
    habilitado: transacaoRealHabilitada(),
    off: !transacaoRealHabilitada()
  };
  assert.strictEqual(rel.preChecks.gate.off, true);

  if (!versao) {
    rel.classificacao = 'MRT-29 BLOQUEADA — VERSAO AUSENTE';
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    process.exit(1);
  }

  const configInit = {
    provedor: 'destaxa',
    ambiente,
    empresa_codigo: configRo.empresaCodigo || null,
    loja_codigo: configRo.lojaCodigo || null,
    terminal_codigo: configRo.terminalCodigo || null,
    pdv_codigo: configRo.pdvCodigo || null,
    caixa_codigo: configRo.caixaCodigo || null
  };

  const projecao = projetarEntradaIniciaClient(configInit, { versao, aplicacao: APLICACAO });
  const parsedProj = parseParametrosDestaxa(projecao.texto);
  rel.preChecks.parametrosProjetados = {
    texto: projecao.texto,
    chaves: projecao.chaves,
    log: Object.fromEntries(CHAVES_LOG_DLL.map((k) => [k, parsedProj[k] || null]))
  };

  const logOk = CHAVES_LOG_DLL.every((k) => String(parsedProj[k]) === String(DESTAXA_DLL_LOG_PARAMS[k]));
  console.log('  Entrada projetada:', projecao.texto);
  if (!logOk) {
    rel.classificacao = 'MRT-29 BLOQUEADA — PARAMS LOG AUSENTES NA ENTRADA';
    rel.preChecks.interrompido = true;
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    console.error('  INTERROMPIDO: params de log não montados corretamente');
    process.exit(1);
  }

  const logAntes = snapshotLog(LOG_PATH);
  rel.log.antes = logAntes;

  const client = obterClienteCompartilhado();
  const guard = bloquearFinanceiroESegundoInit(client);
  const bridge = new DestaxaHostBridge({ client, config: configInit });

  const carga = await bridge.load();
  rel.preChecks.load = {
    sucesso: carga?.sucesso === true,
    estado: carga?.estado || carga?.diagnostico?.estado || null,
    dllPath: carga?.diagnostico?.dllPath || null,
    dllLoaded: carga?.diagnostico?.dllLoaded,
    exportsValid: carga?.diagnostico?.exportsValid,
    clientInitializedAntes: carga?.diagnostico?.clientInitialized === true
  };
  console.log('  LOAD:', JSON.stringify({
    sucesso: rel.preChecks.load.sucesso,
    estado: rel.preChecks.load.estado,
    clientInitializedAntes: rel.preChecks.load.clientInitializedAntes
  }));

  if (!rel.preChecks.load.sucesso) {
    rel.classificacao = 'MRT-29 BLOQUEADA — LOAD FALHOU';
    try { if (typeof client.encerrar === 'function') await client.encerrar(); } catch (_) { /* */ }
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    process.exit(1);
  }

  const statusAntes = await bridge.getHostStatus();
  rel.nativeHost.antes = {
    pid: statusAntes?.pid || null,
    disponivel: statusAntes?.disponivel === true,
    estado: statusAntes?.diagnostics?.estado || null,
    clientInitialized: statusAntes?.diagnostics?.clientInitialized === true,
    operacaoAtiva: statusAntes?.operacaoAtiva || null
  };
  console.log('  Native Host PID:', rel.nativeHost.antes.pid);

  if (statusAntes?.operacaoAtiva) {
    rel.classificacao = 'MRT-29 BLOQUEADA — OPERACAO NATIVA CONCORRENTE';
    try { if (typeof client.encerrar === 'function') await client.encerrar(); } catch (_) { /* */ }
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
    process.exit(1);
  }

  // ——— INIT único ———
  console.log('\n2. INIT único autorizado');
  const horarioInit = new Date().toISOString();
  const t0 = Date.now();
  let initResultado = null;
  let initErro = null;
  try {
    initResultado = await bridge.iniciarClient(configInit);
  } catch (error) {
    initErro = error;
  }
  const duracaoWallMs = Date.now() - t0;

  rel.init = {
    horarioInicio: horarioInit,
    horarioFim: new Date().toISOString(),
    duracaoWallMs,
    chamadasInit: guard.getInitCount(),
    repetiuAutomaticamente: false,
    parametrosEnviados: initResultado?.entrada || projecao.texto,
    tamanhoEntrada: initResultado?.tamanhoEntrada || projecao.texto.length,
    parametrosLogEfetivos: (() => {
      const p = parseParametrosDestaxa(initResultado?.entrada || projecao.texto);
      return Object.fromEntries(CHAVES_LOG_DLL.map((k) => [k, p[k] || null]));
    })(),
    codigoDestaxa: initResultado?.codigoDestaxa || null,
    codigoCds: initResultado?.codigo || null,
    descricaoCodigo: initResultado?.descricaoCodigo || null,
    sucesso: initResultado?.sucesso === true,
    estado: initResultado?.estado || null,
    mensagem: initResultado?.mensagem || null,
    duracaoMsDll: initResultado?.duracaoMs ?? null,
    erro: initErro ? serializarErro(initErro) : null,
    inconclusivo: false
  };

  console.log('  INIT:', JSON.stringify({
    chamadasInit: rel.init.chamadasInit,
    sucesso: rel.init.sucesso,
    codigoDestaxa: rel.init.codigoDestaxa,
    estado: rel.init.estado,
    mensagem: rel.init.mensagem,
    parametrosLogEfetivos: rel.init.parametrosLogEfetivos,
    duracaoWallMs: rel.init.duracaoWallMs,
    erro: rel.init.erro
  }, null, 2));

  if (guard.getInitCount() > 1) {
    rel.erros.push({ codigo: 'MRT29_INIT_REPETIDO', message: 'Mais de um INIT' });
    rel.restricoesObservadas.segundoInit = true;
  }

  if (initErro || (initResultado && initResultado.sucesso !== true && !initResultado.codigoDestaxa)) {
    rel.init.inconclusivo = true;
    rel.init.politica = 'SEM RETRY — preservar evidências';
    console.warn('  INIT inconclusivo/falha — sem segunda tentativa');
  }

  // Aguarda flush do arquivo pela DLL
  await aguardar(1500);

  const logDepois = snapshotLog(LOG_PATH);
  rel.log.depois = logDepois;
  rel.log.caminho = LOG_PATH;
  rel.log.criadoOuAtualizado = logDepois.existe === true
    && (
      !logAntes.existe
      || logDepois.tamanhoBytes > logAntes.tamanhoBytes
      || (logDepois.mtime && logAntes.mtime && logDepois.mtime !== logAntes.mtime)
    );
  console.log('  Log depois:', JSON.stringify({
    existe: logDepois.existe,
    tamanhoBytes: logDepois.tamanhoBytes,
    contemRegistros: logDepois.contemRegistros,
    primeirasLinhas: logDepois.primeirasLinhas
  }, null, 2));

  // STATUS pós-INIT
  try {
    const statusDepois = await bridge.getHostStatus();
    rel.nativeHost.depois = {
      pid: statusDepois?.pid || null,
      disponivel: statusDepois?.disponivel === true,
      clientInitialized: statusDepois?.diagnostics?.clientInitialized === true,
      clientResultCode: statusDepois?.diagnostics?.clientResultCode || null,
      estado: statusDepois?.diagnostics?.estado || null,
      dllLoaded: statusDepois?.diagnostics?.dllLoaded === true
    };
  } catch (error) {
    rel.nativeHost.depois = { erro: serializarErro(error) };
  }

  // Encerramento controlado
  console.log('\n3. Encerramento controlado do Native Host');
  const pidParaEncerrar = rel.nativeHost.depois?.pid || rel.nativeHost.antes?.pid || null;
  let encerramento = { ok: false };
  try {
    if (typeof client.encerrar === 'function') {
      await client.encerrar({ aguardarMs: 8000 });
      encerramento = {
        ok: true,
        motivo: 'SHUTDOWN',
        pid: pidParaEncerrar,
        classificacao: client.ultimaSaida?.classificacaoEncerramento
          || client.ultimaSaida?.motivo
          || 'SHUTDOWN'
      };
    }
  } catch (error) {
    encerramento = { ok: false, erro: serializarErro(error), pid: pidParaEncerrar };
  }
  rel.nativeHost.encerramento = encerramento;
  rel.nativeHost.pid = pidParaEncerrar;
  console.log('  Encerramento:', JSON.stringify(encerramento));

  rel.confirmacoes = {
    chamadasInit: rel.init.chamadasInit,
    exatamenteUmaInit: rel.init.chamadasInit === 1,
    operacoesFinanceiras: 0,
    txBloqueadasTentadas: guard.getBloqueadas(),
    enableReal: false,
    gateOff: true
  };

  const sessaoOk = rel.init.sucesso === true && rel.init.codigoDestaxa === '00';
  const logGerado = logDepois.existe === true;

  if (sessaoOk && logGerado) {
    rel.classificacao = logDepois.contemRegistros
      ? 'MRT-29 CONCLUIDA — INIT 00 E LOG GERADO'
      : 'MRT-29 CONCLUIDA — INIT 00 E ARQUIVO LOG PRESENTE (SEM LINHAS AINDA)';
  } else if (sessaoOk && !logGerado) {
    rel.classificacao = 'MRT-29 CONCLUIDA — INIT 00 MAS LOG AUSENTE (SEM RETRY)';
  } else if (rel.init.inconclusivo) {
    rel.classificacao = 'MRT-29 CONCLUIDA — INIT INCONCLUSIVO (SEM RETRY)';
  } else {
    rel.classificacao = 'MRT-29 CONCLUIDA — INIT NAO ESTABELECEU SESSAO (SEM RETRY)';
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${rel.classificacao}`);
  console.log(`  INIT: ${rel.init.chamadasInit}× | codigo=${rel.init.codigoDestaxa} | estado=${rel.init.estado}`);
  console.log(`  Log: existe=${logGerado} tamanho=${logDepois.tamanhoBytes} registros=${logDepois.contemRegistros}`);
  console.log(`  Host PID=${pidParaEncerrar} encerramento=${encerramento.classificacao || encerramento.motivo || encerramento.ok}`);
  console.log(`  Financeiro: 0 ops | gate OFF\n`);

  assert.ok(rel.init.chamadasInit <= 1, 'no máximo 1 INIT');
  assert.ok(fs.existsSync(REPORT_PATH));
}

main().catch((err) => {
  console.error(err);
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({
      sprint: 'MRT-29',
      fatal: true,
      erro: serializarErro(err),
      stack: err.stack
    }, null, 2));
  } catch (_) { /* ignore */ }
  process.exit(1);
});
