'use strict';

/**
 * SPRINT 51.61 — INIT_CLIENT único no processo oficial do ERP/PDV.
 * Usa DestaxaNativeHostClient / DestaxaHostBridge via TefManager + tefFactory
 * (singleton compartilhado). Sem probe isolado, sem TX_*, CRT, ENABLE_REAL, one-shot.
 *
 * Acionado somente com CDS_TEF_ERP_INIT_CLIENT_ONCE=1 no processo ERP.
 */

const fs = require('fs');
const path = require('path');
const { transacaoRealHabilitada } = require('../../../../backend/services/tef/destaxa/destaxaConstantes');
const DestaxaHostBridge = require('../../../../backend/services/tef/destaxa/DestaxaHostBridge');
const {
  obterClienteCompartilhado,
  clienteCompartilhadoExistente
} = require('../../../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { OPERACOES_HOST } = require('../../../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

const OUT_DIR = __dirname;
const OUT = path.join(OUT_DIR, 'evidencias-init.json');
const ALIVE = path.join(OUT_DIR, 'session-alive.json');
const LOCK = path.join(OUT_DIR, 'init-once.lock');

function gravar(file, obj) {
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

function lerRequestIdInit() {
  try {
    const obs = path.join(
      process.env.LOCALAPPDATA || '',
      'CDS-SISTEMAS',
      'logs',
      'destaxa-nativehost-observability.jsonl'
    );
    if (!fs.existsSync(obs)) return null;
    const lines = fs.readFileSync(obs, 'utf8').trim().split(/\r?\n/).slice(-60);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const e = JSON.parse(lines[i]);
        if (String(e.operation || e.operacao || '') === 'INIT_CLIENT' && e.requestId) {
          return e.requestId;
        }
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function lerStatus(client) {
  const status = await client.enviar(OPERACOES_HOST.STATUS);
  return {
    error: status.error || null,
    clientInitialized: status.output?.diagnostics?.clientInitialized
      ?? status.output?.clientInitialized,
    clientResultCode: status.output?.diagnostics?.clientResultCode
      ?? status.output?.clientResultCode,
    gateReal: status.output?.gateReal,
    operacaoAtiva: status.output?.operacaoAtiva,
    dllLoaded: status.output?.diagnostics?.dllLoaded ?? status.output?.dllLoaded,
    hostPid: client.getEstado()?.pid || null,
    hostSessionId: client.getEstado()?.hostSessionId || null
  };
}

async function executar() {
  const evidencias = {
    sprint: 'SPRINT-51.61',
    proposito: 'INIT_CLIENT_NO_ERP_OFICIAL',
    inicio: new Date().toISOString(),
    erpPid: process.pid,
    argv: process.argv.slice(0, 4),
    gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
    proibicoes: {
      TX_START: true,
      TX_CONTINUE: true,
      TX_FINALIZE: true,
      CRT: true,
      ENABLE_REAL: true,
      oneShot: true,
      pagar: true,
      probeIsolado: true
    }
  };

  try {
    if (transacaoRealHabilitada() || String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED) === '1') {
      throw Object.assign(new Error('Gate ON — abortar'), { code: 'TEF_5161_GATE_ON' });
    }
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

    if (fs.existsSync(LOCK)) {
      const prev = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      evidencias.ok = false;
      evidencias.classificacao = 'BLOCKED_WITH_EVIDENCE';
      evidencias.mensagem = 'INIT já disparado nesta pasta (lock). Sem segundo INIT.';
      evidencias.lock = prev;
      gravar(OUT, evidencias);
      return evidencias;
    }
    fs.writeFileSync(LOCK, `${JSON.stringify({ em: new Date().toISOString(), erpPid: process.pid })}\n`);

    // Carrega TefManager primeiro — configura bootstrap no singleton oficial.
    const TefManager = require('../../../../backend/services/tef/TefManager');
    const { obterAdapter } = require('../../../../backend/services/tef/tefFactory');

    const adapter = await obterAdapter();
    evidencias.adapter = {
      nome: adapter?.nome || null,
      modo: adapter?.modo || null,
      execucaoNativa: adapter?.execucaoNativa || null,
      bridgeTipo: adapter?.bridge ? adapter.bridge.constructor.name : null
    };

    if (!(adapter.bridge instanceof DestaxaHostBridge)) {
      throw Object.assign(
        new Error(`Bridge não é DestaxaHostBridge: ${evidencias.adapter.bridgeTipo}`),
        { code: 'TEF_5161_BRIDGE' }
      );
    }

    const client = adapter.bridge.client;
    const compartilhado = obterClienteCompartilhado();
    evidencias.singleton = {
      adapterClientIsShared: client === compartilhado,
      tefManagerClientIsShared: TefManager._nativeHostClient === compartilhado,
      clienteExistenteAntes: Boolean(clienteCompartilhadoExistente())
    };
    if (client !== compartilhado) {
      throw Object.assign(new Error('Adapter não usa singleton compartilhado'), { code: 'TEF_5161_SINGLETON' });
    }

    const carga = await adapter.bridge.load();
    evidencias.load = {
      sucesso: carga?.sucesso === true,
      codigo: carga?.codigo || null,
      mensagem: carga?.mensagem || null
    };
    if (carga && carga.sucesso === false) {
      throw Object.assign(new Error(carga.mensagem || 'LOAD falhou'), { code: carga.codigo || 'TEF_5161_LOAD' });
    }

    // Único INIT_CLIENT
    const init = await adapter.bridge.iniciarClient(adapter.config);
    const codigo = String(
      init?.codigoDestaxa || init?.diagnostico?.clientResultCode || ''
    ).toUpperCase();

    const estadoHost = client.getEstado();
    evidencias.nativeHost = {
      pid: estadoHost.pid,
      pidPai: estadoHost.pidPai || process.pid,
      hostSessionId: estadoHost.hostSessionId || null,
      processType: estadoHost.processType || null,
      securityBootstrapState: estadoHost.securityBootstrapState || null,
      estado: estadoHost.estado || null
    };
    evidencias.initClient = {
      codigoDestaxa: codigo || null,
      clientSucesso: init?.sucesso === true,
      mensagem: init?.mensagem || null,
      estado: init?.estado || null,
      clientInitialized: init?.diagnostico?.clientInitialized === true,
      clientResultCode: init?.diagnostico?.clientResultCode || codigo || null,
      bloqueadoA1: codigo === 'A1',
      bloqueadoF0: codigo === 'F0'
    };

    evidencias.statusFinal = await lerStatus(client);
    evidencias.requestId = lerRequestIdInit();

    const vinculoOk = Number(evidencias.nativeHost.pidPai) === Number(process.pid)
      && Number(evidencias.nativeHost.pid) > 0
      && evidencias.singleton.adapterClientIsShared === true
      && evidencias.singleton.tefManagerClientIsShared === true;

    evidencias.vinculoPdv = {
      erpPid: process.pid,
      hostPid: evidencias.nativeHost.pid,
      hostPpidEsperado: process.pid,
      hostPpidRegistrado: evidencias.nativeHost.pidPai,
      ipc: 'Electron utilityProcess.postMessage (DestaxaNativeHostClient)',
      mesmoSingletonTefManager: evidencias.singleton.tefManagerClientIsShared,
      ok: vinculoOk
    };

    evidencias.ok = codigo === '00'
      && evidencias.statusFinal.clientInitialized === true
      && String(evidencias.statusFinal.clientResultCode) === '00'
      && evidencias.statusFinal.operacaoAtiva == null
      && evidencias.statusFinal.gateReal === false
      && codigo !== 'A1'
      && codigo !== 'F0'
      && vinculoOk;

    evidencias.classificacao = evidencias.ok
      ? 'ERP_NATIVEHOST_SESSION_CONFIRMED'
      : (codigo === 'A1' || codigo === 'F0' ? 'BLOCKED_WITH_EVIDENCE' : 'BLOCKED_WITH_EVIDENCE');
    evidencias.mensagem = evidencias.ok
      ? 'INIT_CLIENT=00 no ERP oficial — NativeHost filho do ERP, sessão ativa.'
      : `INIT/vínculo falhou (codigo=${codigo || 'null'}, vinculo=${vinculoOk}) — sem retry.`;
    evidencias.hostEncerradoAposInit = false;
    evidencias.fimInit = new Date().toISOString();
    evidencias.gateEnvFinal = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;

    gravar(OUT, evidencias);
    process.stdout.write(`${JSON.stringify({
      event: 'init-done',
      classificacao: evidencias.classificacao,
      ok: evidencias.ok,
      codigo,
      requestId: evidencias.requestId,
      erpPid: process.pid,
      hostPid: evidencias.nativeHost.pid,
      hostSessionId: evidencias.nativeHost.hostSessionId
    })}\n`);

    if (!evidencias.ok) {
      return evidencias;
    }

    // Heartbeat STATUS (sem novo INIT) — preserva sessão.
    const tick = async () => {
      try {
        const st = await lerStatus(client);
        gravar(ALIVE, {
          em: new Date().toISOString(),
          sprint: 'SPRINT-51.61',
          erpPid: process.pid,
          hostPid: evidencias.nativeHost.pid,
          hostSessionId: evidencias.nativeHost.hostSessionId,
          requestIdInit: evidencias.requestId,
          gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
          status: st,
          sessaoAtiva: st.clientInitialized === true
            && String(st.clientResultCode) === '00'
            && Number(st.hostPid) === Number(evidencias.nativeHost.pid),
          vinculoPdvOk: Number(client.getEstado()?.pidPai) === Number(process.pid)
        });
      } catch (error) {
        gravar(ALIVE, {
          em: new Date().toISOString(),
          sprint: 'SPRINT-51.61',
          erro: error.message,
          sessaoAtiva: false
        });
      }
    };
    await tick();
    setInterval(tick, 15000).unref?.();
    return evidencias;
  } catch (error) {
    evidencias.ok = false;
    evidencias.classificacao = 'BLOCKED_WITH_EVIDENCE';
    evidencias.mensagem = error.message;
    evidencias.erro = { code: error.code || null, message: error.message };
    evidencias.fimInit = new Date().toISOString();
    gravar(OUT, evidencias);
    process.stdout.write(`${JSON.stringify({ event: 'init-error', ...evidencias.erro })}\n`);
    return evidencias;
  }
}

module.exports = { executar };
