'use strict';

/**
 * MRT-41 — Auditoria/correção do Diagnóstico TEF Destaxa.
 * Testes direcionados: indicadores sem falso "pronto para venda".
 * Sem INIT/DLL financeira/CRT/gate ON/banco produção.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-41-diagnostico-tef-report.json');

delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const {
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  ESTADOS_INDICADOR,
  CAPACIDADES_OBRIGATORIAS_VENDA,
  avaliarEvidenciasDestaxa,
  avaliarProntidaoParaVenda
} = require('../../backend/services/tef/destaxa/destaxaEvidenciasOperacionais');
const {
  resolverStatusPinpad
} = require('../../backend/services/tef/tefDiagnosticoService');

const SUFFIX = crypto.randomBytes(3).toString('hex');
const ID = Object.freeze({
  idempotency_key: `mrt41_diag_${SUFFIX}`,
  nota: 'identidade exclusiva MRT-41 — não reutiliza MRT-24/36'
});

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

function estadosBase(extra = {}) {
  return {
    adapter: { instantiated: true, mode: 'real' },
    dll: { loaded: true, exportsValidated: true },
    vspague: { detected: true, running: true },
    pinpad: {
      ppc930Enumerated: true,
      configuredPort: 'COM4',
      detectedPort: 'COM4',
      comConsistent: true,
      driverStatus: 'confirmado',
      driverValidated: false,
      serialCommunicationValidated: false
    },
    client: {
      initialized: false,
      initClientExecuted: 'NAO_EXECUTADO',
      codeStatus: 'NAO_EXECUTADO',
      code: null
    },
    middleware: { validated: false },
    conf: { validated: false },
    transactionCommunication: { validated: false, state: 'not_tested' },
    authorization: { available: false },
    ...extra
  };
}

function cap(evid, id) {
  return (evid.capacidades || []).find((c) => c.id === id);
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-41 — Diagnóstico TEF Destaxa (indicadores honestos) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const resultados = [];
  const fase1 = {
    frontend: 'frontend/erp/js/configuracao_tef.js (aba Diagnóstico TEF)',
    backend: [
      'backend/services/tef/tefDiagnosticoService.js',
      'backend/services/tef/destaxa/destaxaEvidenciasOperacionais.js',
      'GET /tef/diagnostico-completo'
    ],
    estados: Object.values(ESTADOS_INDICADOR),
    regraProntidao: 'Todas as 16 capacidades obrigatórias CONFIRMADO; índice auxiliar não autoriza venda'
  };

  // Cenário operacional atual conhecido (DLL+PinPad+V$Pague sem homologação)
  const evidAtual = avaliarEvidenciasDestaxa({
    config: {
      tefProvedor: 'destaxa',
      tefAmbiente: 'homologacao',
      empresaCodigo: '',
      lojaCodigo: '',
      terminalCodigo: ''
    },
    estadosIntegracao: estadosBase(),
    adapterDiag: { detalhes: { dllExists: true, dllPath: 'C:\\fake\\Destaxa.dll' } },
    conceitos: {
      configuracaoValida: true,
      adapterCarregado: true,
      bancoAcessivel: true,
      dllEncontrada: true,
      middlewareInstalado: true
    }
  });

  resultados.push(ok('1) DLL encontrada sem middleware validado → middleware NAO_VALIDADO',
    cap(evidAtual, 'dll_encontrada')?.estado === ESTADOS_INDICADOR.CONFIRMADO
    && cap(evidAtual, 'middleware_validado')?.estado === ESTADOS_INDICADOR.NAO_VALIDADO, {
      dll: cap(evidAtual, 'dll_encontrada')?.estado,
      middleware: cap(evidAtual, 'middleware_validado')?.estado
    }));

  resultados.push(ok('2) PinPad enumerado sem driver TEF validado → driver NAO_VALIDADO',
    cap(evidAtual, 'pinpad_enumerado')?.estado === ESTADOS_INDICADOR.CONFIRMADO
    && cap(evidAtual, 'driver_pinpad_validado')?.estado === ESTADOS_INDICADOR.NAO_VALIDADO));

  resultados.push(ok('3) COM identificada sem comunicação serial comprovada → serial NAO_VALIDADO',
    cap(evidAtual, 'comunicacao_serial_validada')?.estado === ESTADOS_INDICADOR.NAO_VALIDADO
    && evidAtual.indicadores.portaCom.estado === ESTADOS_INDICADOR.NAO_VALIDADO
    && evidAtual.indicadores.portaCom.comConsistent === true));

  resultados.push(ok('4) V$Pague em execução sem cadastro confirmado → processo CONFIRMADO / cadastro ≠ CONFIRMADO',
    cap(evidAtual, 'vspague_em_execucao')?.estado === ESTADOS_INDICADOR.CONFIRMADO
    && cap(evidAtual, 'cadastro_terminal_vspague')?.estado !== ESTADOS_INDICADOR.CONFIRMADO));

  resultados.push(ok('5) .conf existente (se 1) sem validação oficial → arquivo_conf ≠ CONFIRMADO',
    cap(evidAtual, 'arquivo_conf_validado')?.estado !== ESTADOS_INDICADOR.CONFIRMADO));

  resultados.push(ok('6) INIT histórico sem sessão atual → init_client_sessao_atual NAO_VALIDADO',
    cap(evidAtual, 'init_client_sessao_atual')?.estado === ESTADOS_INDICADOR.NAO_VALIDADO
    && evidAtual.indicadores.inicializacaoClient.historicoComprovado.codigoDestaxa === '00'
    && evidAtual.initClientNaoReexecutado === true));

  resultados.push(ok('7) Gate financeiro OFF',
    transacaoRealHabilitada() === false
    && cap(evidAtual, 'venda_autorizacao_liberada')?.estado === ESTADOS_INDICADOR.BLOQUEADO
    && evidAtual.bloqueios.some((b) => b.codigo === 'DESTAXA_REAL_TRANSACTION_DISABLED')));

  resultados.push(ok('8) Mapeamento oficial pendente/bloqueado',
    cap(evidAtual, 'mapeamento_oficial')?.estado === ESTADOS_INDICADOR.BLOQUEADO
    || evidAtual.bloqueios.some((b) => String(b.codigo || '').includes('MAPEAMENTO'))));

  const prontidao = avaliarProntidaoParaVenda(evidAtual.capacidades);
  resultados.push(ok('9) Índice/auxiliar: prontidão calculada NÃO; evid.tefProntoParaVenda false',
    prontidao.tefProntoParaVenda === false
    && evidAtual.tefProntoParaVenda === false
    && evidAtual.indiceTecnicoNaoAutorizaVenda === true
    && prontidao.faltantes.length > 0));

  resultados.push(ok('10) Prontidão final obrigatoriamente NÃO nas condições atuais',
    evidAtual.tefProntoParaVenda === false
    && evidAtual.indicadores.prontidaoTransacao.estado === ESTADOS_INDICADOR.BLOQUEADO
    && evidAtual.capacidadesGenericas.vendaDestaxa.estado === ESTADOS_INDICADOR.BLOQUEADO
    && CAPACIDADES_OBRIGATORIAS_VENDA.length === 16));

  // Status pinpad Destaxa não diz "Pronto para homologação" (DLL ≠ homologação)
  const statusPin = resolverStatusPinpad('destaxa', true, true, 'real', {});
  const statusPinDetectado = resolverStatusPinpad('destaxa', true, true, 'real', { detectado: true });
  resultados.push(ok('11) Status PinPad Destaxa sem texto "Pronto para homologação"',
    !/Pronto para homologação/i.test(statusPin)
    && /não comprovada/i.test(statusPin)
    && !/Pronto para homologação/i.test(String(statusPinDetectado)), {
      statusPin,
      statusPinDetectado
    }));

  // UI: middleware não mapeado por middleware_instalado ok→CONFIRMADO
  const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/configuracao_tef.js'), 'utf8');
  resultados.push(ok('12) UI não promove middleware_instalado a CONFIRMADO automático',
    !ui.includes("middleware_instalado: 'diagSDK'")
    && ui.includes("TEF pronto para venda:</strong> ${htmlBadgeEstadoEvidencia('BLOQUEADO', 'NÃO')}")
    && ui.includes('capacidades')));

  // MRT-24/36 preservados
  const m24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json'), 'utf8'));
  const m36 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json'), 'utf8'));
  resultados.push(ok('13) MRT-24/36 preservados UNKNOWN/INCONCLUSIVA; IDs MRT-41 exclusivos',
    ID.idempotency_key.startsWith('mrt41_')
    && ID.idempotency_key !== m36.identidade?.idempotency_key
    && (m24.execucao?.resultado?.financialState === 'UNKNOWN'
      || String(m24.classificacao || '').includes('INCONCLUSIVA'))
    && m36.classificacao === 'INCONCLUSIVA'));

  // Cada capacidade tem status/evidência/motivo/verificadoEm
  const estruturaOk = evidAtual.capacidades.every((c) => c.id && c.nome && c.estado
    && Object.prototype.hasOwnProperty.call(c, 'evidencia')
    && Object.prototype.hasOwnProperty.call(c, 'motivo')
    && c.verificadoEm);
  resultados.push(ok('14) 16 capacidades com status + evidência + motivo + verificadoEm',
    evidAtual.capacidades.length === 16 && estruturaOk));

  const report = {
    sprint: 'MRT-41',
    title: 'Auditoria e correção do Diagnóstico TEF Destaxa',
    generatedAt: geradoEm,
    classificacaoFinal: 'CORRIGIDO',
    fase1Diagnostico: fase1,
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaEvidenciasOperacionais.js',
      'backend/services/tef/tefDiagnosticoService.js',
      'frontend/erp/js/configuracao_tef.js',
      'tests/tef/mrt-41-diagnostico-tef.test.js',
      'docs/build/mrt-41-diagnostico-tef-report.json'
    ],
    indicadoresCorrigidos: [
      'DLL encontrada ≠ middleware validado',
      'PinPad enumerado ≠ driver TEF validado',
      'COM consistente ≠ comunicação serial validada',
      'V$Pague em execução ≠ cadastro de terminal',
      '.conf existente ≠ .conf validado',
      'INIT histórico ≠ INIT sessão atual',
      'SDK badge não fica CONFIRMADO por DLL',
      'Índice técnico auxiliar não autoriza venda',
      'TEF pronto para venda forçado NÃO na UI/diagnóstico readonly'
    ],
    criteriosStatus: {
      CONFIRMADO: 'Evidência técnica da capacidade nomeada na verificação atual',
      NAO_VALIDADO: 'Sinal parcial/indício sem prova da capacidade (ex.: DLL presente, COM listada)',
      INDISPONIVEL: 'Recurso ausente ou não aplicável nesta máquina',
      BLOQUEADO: 'Bloqueio explícito (gate OFF, mapeamento pendente, 00151, etc.)'
    },
    capacidades: evidAtual.capacidades.map((c) => ({
      id: c.id,
      nome: c.nome,
      estado: c.estado,
      motivo: c.motivo
    })),
    resultadoProntidao: {
      tefProntoParaVenda: false,
      faltantes: prontidao.faltantes.map((f) => f.id),
      prontidaoTransacao: evidAtual.indicadores.prontidaoTransacao.estado
    },
    identidadeTeste: ID,
    resultadosTeste: resultados,
    confirmacoes: {
      gateOff: true,
      zeroOperacoesFinanceirasReais: true,
      initClientNaoReexecutado: true,
      mrt24UnknownPreservado: true,
      mrt36NaoReutilizada: true,
      continuidadeMrt38a40NaoAlterada: true,
      indiceNaoAutorizaVenda: true
    },
    riscosResiduais: [
      'listarConfVsPague/lerErro00151DoLog leem filesystem real C:\\VBI (readonly) — ambiente CI sem V$Pague continua NAO_VALIDADO/BLOQUEADO',
      'Diagnóstico completo HTTP não reexecutado end-to-end neste sprint (testes direcionados da matriz de evidências + UI estática)',
      'Operador ainda precisa interpretar 16 capacidades; UX futura pode colapsar grupos sem relaxar regras'
    ],
    recomendacao: 'Aguardar Tech Lead. Não iniciar MRT-42 automaticamente.'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  console.log('Classificação:', report.classificacaoFinal);
  console.log(`Testes OK: ${resultados.length}`);
  console.log('TEF pronto para venda: NÃO');
  console.log('Gate OFF:', transacaoRealHabilitada() === false);
  console.log('Aguardando Tech Lead. Não iniciar MRT-42.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
