'use strict';

/**
 * MRT-35 — Diagnóstico da resolução do Gate Financeiro Destaxa
 * Sem INIT, ENABLE_REAL, TX, CRT, DLL, Native Host, V$Pague, DB write, venda.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-35-correcao-resolucao-gate-financeiro-report.json');
const GATE_FANTASMA_REL = './backend/services/tef/destaxa/destaxaGateFinanceiro';
const GATE_FANTASMA_ABS = path.join(ROOT, 'backend/services/tef/destaxa/destaxaGateFinanceiro.js');
const CONSTANTES_REL = './backend/services/tef/destaxa/destaxaConstantes';
const CONSTANTES_ABS = path.join(ROOT, 'backend/services/tef/destaxa/destaxaConstantes.js');
const ADAPTER_ABS = path.join(ROOT, 'backend/services/tef/adapters/DestaxaRealAdapter.js');

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

/**
 * Simula node -e / [eval]: relativos resolvem a partir de process.cwd(),
 * não do __dirname do arquivo de teste.
 */
function tryRequireComoEval(rel, cwd = ROOT) {
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    const req = Module.createRequire(path.join(cwd, '[eval]'));
    const exports = req(rel);
    return { ok: true, exports, resolved: req.resolve(rel), cwd };
  } catch (error) {
    return {
      ok: false,
      code: error.code || null,
      message: String(error.message || error),
      requireStack: Array.isArray(error.requireStack) ? error.requireStack : null,
      cwd
    };
  } finally {
    process.chdir(prev);
  }
}

function grepRepoParaGateFantasma() {
  const dirs = [
    path.join(ROOT, 'backend'),
    path.join(ROOT, 'tests'),
    path.join(ROOT, 'frontend'),
    path.join(ROOT, 'docs', 'build')
  ];
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        walk(full);
        continue;
      }
      if (!/\.(js|cjs|mjs|ts|json|md)$/i.test(ent.name)) continue;
      if (ent.name.includes('mrt-35')) continue;
      let txt;
      try {
        txt = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (txt.includes('destaxaGateFinanceiro')) {
        hits.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  };
  for (const d of dirs) walk(d);
  return hits;
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-35 — Resolução Gate Financeiro Destaxa ===\n');

  delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

  const resultados = [];

  resultados.push(
    ok('1) arquivo destaxaGateFinanceiro NÃO existe', !fs.existsSync(GATE_FANTASMA_ABS), {
      caminhoAbsoluto: GATE_FANTASMA_ABS
    })
  );

  resultados.push(
    ok('2) arquivo destaxaConstantes.js existe', fs.existsSync(CONSTANTES_ABS), {
      caminhoAbsoluto: CONSTANTES_ABS
    })
  );

  const failFantasma = tryRequireComoEval(GATE_FANTASMA_REL);
  resultados.push(
    ok('3) require relativo fantasma reproduz MODULE_NOT_FOUND', failFantasma.ok === false && failFantasma.code === 'MODULE_NOT_FOUND', {
      cwdUsado: ROOT,
      rel: GATE_FANTASMA_REL,
      message: failFantasma.message,
      nota: 'node -e resolve relativo a process.cwd(); [eval] no require stack — módulo nunca existiu'
    })
  );

  const okConstantes = tryRequireComoEval(CONSTANTES_REL);
  assert.strictEqual(okConstantes.ok, true);
  const {
    REAL_TRANSACTION_ENV,
    transacaoRealHabilitada
  } = okConstantes.exports;
  resultados.push(
    ok('4) require correto via destaxaConstantes resolve e exporta gate', typeof transacaoRealHabilitada === 'function'
      && REAL_TRANSACTION_ENV === 'DESTAXA_REAL_TRANSACTION_ENABLED'
      && path.normalize(okConstantes.resolved) === path.normalize(CONSTANTES_ABS), {
      resolved: okConstantes.resolved,
      REAL_TRANSACTION_ENV,
      gateOff: transacaoRealHabilitada() === false
    })
  );

  assert.strictEqual(transacaoRealHabilitada(), false);
  resultados.push(
    ok('5) gate permanece OFF no contexto do teste', transacaoRealHabilitada() === false, {
      env: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || ''
    })
  );

  // Simula resolução como o Adapter (caminho relativo ao arquivo do módulo, não ao cwd)
  const adapterDir = path.dirname(ADAPTER_ABS);
  const fromAdapter = path.join(adapterDir, '../destaxa/destaxaConstantes.js');
  resultados.push(
    ok('6) resolução relativa ao DestaxaRealAdapter aponta para destaxaConstantes', fs.existsSync(fromAdapter)
      && path.normalize(fromAdapter) === path.normalize(CONSTANTES_ABS), {
      fromAdapter,
      mecanismo: "require('../destaxa/destaxaConstantes') em DestaxaRealAdapter.js"
    })
  );

  const adapterSrc = fs.readFileSync(ADAPTER_ABS, 'utf8');
  resultados.push(
    ok('7) DestaxaRealAdapter NÃO referencia destaxaGateFinanceiro', !adapterSrc.includes('destaxaGateFinanceiro')
      && /require\(['"]\.\.\/destaxa\/destaxaConstantes['"]\)/.test(adapterSrc), {
      importGate: "transacaoRealHabilitada de destaxaConstantes"
    })
  );

  const hits = grepRepoParaGateFantasma();
  resultados.push(
    ok('8) nenhum require/código de produção referencia destaxaGateFinanceiro', hits.length === 0, {
      hits
    })
  );

  // Paths absolutos via createRequire (contexto Electron/backend/scripts)
  const createRequire = Module.createRequire(CONSTANTES_ABS);
  const viaAbs = createRequire(CONSTANTES_ABS);
  resultados.push(
    ok('9) createRequire absoluto carrega o mesmo gate OFF', typeof viaAbs.transacaoRealHabilitada === 'function'
      && viaAbs.transacaoRealHabilitada() === false, {
      mecanismo: 'Module.createRequire(caminhoAbsoluto destaxaConstantes.js)'
    })
  );

  const classificacao = 'CAUSA_IDENTIFICADA_SEM_CORRECAO';
  const report = {
    sprint: 'MRT-35',
    title: 'Diagnóstico e correção do carregamento do Gate Financeiro Destaxa',
    generatedAt: geradoEm,
    classificacao,
    causaRaiz: {
      codigo: 'MODULO_INEXISTENTE_NO_DIAGNOSTICO',
      resumo: 'O require de destaxaGateFinanceiro veio de um node -e diagnóstico da MRT-34 que inventou um caminho. O arquivo nunca existiu no repositório. O gate real vive em destaxaConstantes.js (transacaoRealHabilitada / REAL_TRANSACTION_ENV).',
      pontoExatoDoRequire: {
        tipo: 'node -e [eval]',
        contexto: 'diagnóstico MRT-34 (Shell)',
        caminhoTentado: GATE_FANTASMA_REL,
        baseResolucao: 'process.cwd() do shell = raiz do repo',
        requireStackTipico: `${ROOT}\\[eval]`
      },
      porQueFalhou: 'MODULE_NOT_FOUND — nome/arquivo inexistente; não é falha de cwd entre Electron/backend.',
      moduloCorreto: {
        caminhoAbsoluto: CONSTANTES_ABS,
        exports: ['REAL_TRANSACTION_ENV', 'transacaoRealHabilitada'],
        consumidores: [
          'backend/services/tef/adapters/DestaxaRealAdapter.js',
          'backend/services/tef/destaxa/DestaxaNativeBridge.js',
          'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
          'backend/services/tef/destaxa/DestaxaNativeHost.js'
        ]
      }
    },
    evidenciaAntes: {
      mensagem: failFantasma.message,
      code: failFantasma.code,
      arquivoExiste: false
    },
    evidenciaDepois: {
      requireCorretoOk: okConstantes.ok === true,
      resolved: okConstantes.resolved,
      gateOff: true,
      correcaoCodigoProducao: false,
      motivoSemCorrecao: 'Nenhuma importação de produção quebrada; criar destaxaGateFinanceiro.js seria facade inventada sem consumidor.'
    },
    caminhosValidados: {
      absolutoConstantes: CONSTANTES_ABS,
      relativoAdapter: '../destaxa/destaxaConstantes',
      relativoCwdRepo: CONSTANTES_REL
    },
    arquivosAlterados: [
      'tests/tef/mrt-35-resolucao-gate-financeiro.test.js',
      'docs/build/mrt-35-correcao-resolucao-gate-financeiro-report.json'
    ],
    diferencaContextos: {
      nodeEval: 'require(relativo) resolve a partir de process.cwd(); __filename = [eval]',
      backendScript: 'require relativo ao arquivo do módulo (__dirname)',
      electronMain: 'mesmo mecanismo Node; Adapter usa caminho relativo ao próprio arquivo → destaxaConstantes',
      conclusao: 'Não há divergência Electron vs backend no gate; o erro era só o nome fantasma no eval'
    },
    resultadosTeste: resultados,
    restricoesObservadas: {
      init: false,
      enableReal: false,
      txStart: false,
      crt: false,
      est: false,
      dll: false,
      nativeHost: false,
      vspague: false,
      dbWrite: false,
      venda: false,
      gateOff: true,
      mrt24: 'UNKNOWN'
    },
    confirmacoes: {
      zeroOperacoesFinanceiras: true,
      gatePermaneceOff: true,
      mrt24UnknownPreservado: true,
      crtNaoAvancada: true
    },
    recomendacao: 'Nenhuma correção de importação de produção. Diagnósticos futuros devem require destaxaConstantes (ou caminho absoluto validado neste relatório). Aguardar Tech Lead; não avançar CRT nesta sprint.'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  console.log(`Classificação: ${classificacao}`);
  console.log(`Resultados OK: ${resultados.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
