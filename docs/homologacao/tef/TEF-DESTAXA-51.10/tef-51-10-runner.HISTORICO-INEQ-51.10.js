'use strict';

/**
 * ARQUIVO HISTÓRICO — NÃO USAR EM HOMOLOGAÇÃO OPERACIONAL (TEF-DESTAXA-51.12).
 *
 * Cópia inequivalente da tentativa 51.10: forja transactionId `tx-5110-*` e
 * `persistenciaConfirmada: true` sem INSERT em tef_transacoes.
 * Resultado: UNKNOWN preservado. Entrada operacional: tef-51-10-runner.js (DESATIVADO).
 *
 * Original 51.10 — UMA CRT R$1,00 débito (DestaxaRealAdapter in-process).
 * NÃO executar. Homologação futura: PDV vivo + TefManager.autorizar.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT_DIR = __dirname;
const AUTH_ID = 'ba08c88e8e67410f3048bac5e10c4046';

const DestaxaRealAdapter = require(path.join(
  ROOT, 'backend', 'services', 'tef', 'adapters', 'DestaxaRealAdapter'
));
const destaxaLogger = require(path.join(
  ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaLogger'
));
const {
  inspecionarAutorizacaoExcepcional
} = require(path.join(
  ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaAutorizacaoExcepcional'
));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

function append(evento, dados = {}) {
  const linha = `${JSON.stringify({ event: evento, em: new Date().toISOString(), ...dados })}\n`;
  fs.appendFileSync(path.join(OUT_DIR, 'runner-stdout.jsonl'), linha, 'utf8');
  process.stdout.write(linha);
}

function gravar(nome, payload) {
  fs.writeFileSync(path.join(OUT_DIR, nome), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function gateOff() {
  const raw = process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
  if (String(raw || '').trim() === '1') {
    throw new Error('ABORT: DESTAXA_REAL_TRANSACTION_ENABLED=1');
  }
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  return { raw: raw == null ? null : String(raw), efetivo: '0' };
}

async function main() {
  const inicioIso = new Date().toISOString();
  const gate = gateOff();
  await app.whenReady();

  const insp = inspecionarAutorizacaoExcepcional(AUTH_ID);
  append('auth.inspect', { insp });
  if (!insp.ok || insp.autorizacao?.status !== 'ISSUED') {
    const payload = {
      ok: false,
      classificacao: 'FALHA TÉCNICA',
      motivo: 'Autorização ISSUED ausente/ambígua — CRT não iniciada',
      insp,
      inicioIso,
      fimIso: new Date().toISOString()
    };
    gravar('resultado-crt.json', payload);
    append('abort', payload);
    app.exit(2);
    return;
  }

  const transactionId = `tx-5110-${crypto.randomBytes(8).toString('hex')}`;
  const idempotencyKey = `idem-5110-${crypto.randomBytes(8).toString('hex')}`;
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { executionMode: 'in-process' }
  );

  append('runner.start', {
    sprint: 'TEF-DESTAXA-51.10',
    gate,
    transactionId,
    idempotencyKey,
    authorizationId: AUTH_ID,
    obs: destaxaLogger.obterArquivoAuditoria(),
    execucaoNativa: adapter.execucaoNativa
  });

  let resposta = null;
  let erro = null;
  const t0 = process.hrtime.bigint();
  try {
    const load = await adapter.bridge.load();
    append('bridge.load', { load });
    const init = await adapter.bridge.iniciarClient({
      provedor: 'destaxa',
      ambiente: 'homologacao'
    });
    append('bridge.init', {
      sucesso: init?.sucesso,
      codigo: init?.codigoDestaxa || init?.codigo || null,
      estado: init?.estado || null
    });

    const dados = {
      tipo: 'cartao_debito',
      valor: 1.0,
      valorCentavos: 100,
      parcelas: 1,
      autorizacaoExcepcionalId: AUTH_ID,
      authorizationId: AUTH_ID,
      idempotency_key: idempotencyKey,
      transacao_id: transactionId
    };

    const preparo = await adapter.prepararAutorizacao(dados);
    append('preparar', {
      pronto: preparo?.pronto === true,
      authId: preparo?.autorizacaoExcepcionalId || null,
      codigo: preparo?.resposta?.codigo || null
    });
    if (!preparo.pronto) {
      resposta = preparo.resposta;
      throw new Error(preparo.resposta?.mensagem || 'prepararAutorizacao não pronto');
    }

    const preparacao = {
      ...preparo,
      pronto: true,
      persistenciaConfirmada: true,
      transactionId,
      operation_id: `op-5110-${crypto.randomBytes(4).toString('hex')}`,
      idempotency_key: idempotencyKey,
      fingerprint: crypto.createHash('sha256').update(transactionId).digest('hex')
    };

    append('autorizar.start', { transactionId });
    resposta = await adapter.autorizarPagamento(dados, preparacao);
    append('autorizar.end', {
      sucesso: resposta?.sucesso,
      status: resposta?.status,
      codigo: resposta?.codigo || resposta?.codigoDestaxa || null,
      financialState: resposta?.financialState || null,
      requerContinuacao: resposta?.requerContinuacao === true,
      ciclo: resposta?.cicloCrt || resposta?.ciclo || null
    });
  } catch (error) {
    erro = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      code: error?.code || error?.codigo || null
    };
    append('autorizar.exception', erro);
  }

  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  try {
    if (adapter.bridge && typeof adapter.bridge.unload === 'function') {
      await adapter.bridge.unload();
    }
  } catch (_) { /* ignore */ }

  const inspFim = inspecionarAutorizacaoExcepcional(AUTH_ID);
  const financialState = resposta?.financialState || null;
  let classificacao = 'FALHA TÉCNICA';
  if (erro) classificacao = 'FALHA TÉCNICA';
  else if (financialState === 'UNKNOWN' || resposta?.inconclusivo === true) classificacao = 'UNKNOWN';
  else if (resposta?.sucesso === true && String(resposta?.codigo || resposta?.codigoDestaxa || '') === '00') {
    classificacao = 'HOMOLOGADO';
  } else if (resposta?.requerContinuacao === true) {
    classificacao = 'UNKNOWN';
  }

  const resultado = {
    sprint: 'TEF-DESTAXA-51.10',
    inicioIso,
    fimIso: new Date().toISOString(),
    durationMs,
    authorizationId: AUTH_ID,
    transactionId,
    idempotencyKey,
    gate,
    execucaoNativa: adapter.execucaoNativa,
    resposta,
    erro,
    authApos: inspFim.autorizacao || null,
    classificacao
  };
  gravar('resultado-crt.json', resultado);
  append('runner.end', { classificacao, durationMs });
  app.exit(erro ? 1 : 0);
}

main().catch((error) => {
  append('fatal', { message: error.message, stack: error.stack });
  gravar('resultado-crt.json', {
    ok: false,
    classificacao: 'FALHA TÉCNICA',
    erro: error.message
  });
  app.exit(1);
});
