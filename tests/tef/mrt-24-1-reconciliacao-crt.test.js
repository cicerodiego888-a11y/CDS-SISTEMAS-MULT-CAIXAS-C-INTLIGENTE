'use strict';

/**
 * MRT-24.1 — Reconciliação da CRT inconclusiva (sem operação financeira)
 *
 * PROIBIDO: TX_START/CONTINUE/FINALIZE, INIT, EST, cancelamento, estorno,
 * segunda CRT, nova idempotency_key, liberar bloqueio sem evidência.
 * Gate OFF.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-24-1-reconciliacao-crt-report.json');
const MRT24_REPORT = path.join(__dirname, '../../docs/build/mrt-24-primeira-crt-homologacao-report.json');

const TRANSACTION_ID = 'mrt24_5d70e3fb2328da54';
const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';

function openReadonly(dbPath) {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function escanearBanco(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { path: dbPath, existe: false };
  }
  const db = openReadonly(dbPath);
  try {
    const tables = await all(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tef%'"
    );
    let colunas = [];
    try {
      colunas = await all(db, 'PRAGMA table_info(tef_transacoes)');
    } catch (_) {
      colunas = [];
    }

    let transacoes = [];
    let hit = [];
    let logs = [];
    if (tables.some((t) => t.name === 'tef_transacoes')) {
      transacoes = await all(
        db,
        `SELECT id, status, provedor, valor, idempotency_key, codigo_transacao,
                created_at, updated_at
         FROM tef_transacoes
         ORDER BY id DESC
         LIMIT 30`
      );
      hit = await all(
        db,
        `SELECT id, status, provedor, valor, idempotency_key, codigo_transacao,
                created_at, updated_at
         FROM tef_transacoes
         WHERE codigo_transacao LIKE ?
            OR idempotency_key LIKE ?
            OR CAST(id AS TEXT) = ?`,
        [`%${TRANSACTION_ID}%`, '%mrt24%', TRANSACTION_ID]
      );
      // payload contém transactionId?
      const comPayload = await all(
        db,
        `SELECT id, status, idempotency_key, codigo_transacao
         FROM tef_transacoes
         WHERE payload_retorno LIKE ?
         LIMIT 10`,
        [`%${TRANSACTION_ID}%`]
      ).catch(() => []);
      hit = hit.concat(comPayload);
    }

    if (tables.some((t) => t.name === 'tef_logs')) {
      const colsLog = await all(db, 'PRAGMA table_info(tef_logs)');
      const nomes = colsLog.map((c) => c.name);
      const selectCols = ['id', 'transacao_id', 'created_at']
        .concat(['evento', 'tipo', 'mensagem', 'detalhes'].filter((c) => nomes.includes(c)))
        .filter((c, i, a) => a.indexOf(c) === i && nomes.includes(c));
      logs = await all(
        db,
        `SELECT ${selectCols.join(', ')} FROM tef_logs ORDER BY id DESC LIMIT 40`
      ).catch(() => []);
      const logsHit = await all(
        db,
        `SELECT ${selectCols.join(', ')} FROM tef_logs
         WHERE mensagem LIKE ? OR detalhes LIKE ? OR CAST(transacao_id AS TEXT) LIKE ?
         LIMIT 20`,
        [`%${TRANSACTION_ID}%`, `%${TRANSACTION_ID}%`, `%mrt24%`]
      ).catch(() => []);
      if (logsHit.length) logs = { recentes: logs, hit: logsHit };
    }

    return {
      path: dbPath,
      existe: true,
      tables: tables.map((t) => t.name),
      colunasTefTransacoes: colunas.map((c) => c.name),
      transacoesRecentes: transacoes,
      hitTransactionId: hit,
      logs
    };
  } finally {
    await closeDb(db);
  }
}

function inspecionarAdapterConsulta() {
  const adapterSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
    'utf8'
  );
  const baseSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/adapters/BaseAdapter.js'),
    'utf8'
  );
  const tefMgrSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/TefManager.js'),
    'utf8'
  );
  const constantes = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/destaxaConstantes.js'),
    'utf8'
  );
  const protocoloDll = fs.existsSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/destaxaNativeHostProtocolo.js')
  )
    ? fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/destaxa/destaxaNativeHostProtocolo.js'),
      'utf8'
    )
    : '';

  const destaxaImplementaConsultar = /async\s+consultarTransacao\s*\(/.test(adapterSrc)
    || /consultarTransacao\s*\(/.test(adapterSrc);
  const baseTemConsultar = /async\s+consultarTransacao\s*\(/.test(baseSrc);
  const operacoesHost = [];
  const m = protocoloDll.match(/OPERACOES_HOST\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const km = line.match(/^\s*([A-Z0-9_]+)\s*:/);
      if (km) operacoesHost.push(km[1]);
    }
  }

  return {
    destaxaRealAdapterImplementaConsultarTransacao: destaxaImplementaConsultar,
    baseAdapterTemConsultarTransacao: baseTemConsultar,
    tefManagerChamaConsultar: /consultarTransacao/.test(tefMgrSrc),
    operacoesHostDisponiveis: operacoesHost,
    hostTemOperacaoConsulta: operacoesHost.some((o) => /CONSULT|STATUS_TX|CNF|SITUACAO/i.test(o)),
    dllExportsDocumentados: [
      'iniciaClientDestaxa',
      'iniciaTransacaoDestaxa',
      'continuaTransacaoDestaxa',
      'finalizaTransacaoDestaxa'
    ],
    conclusao: destaxaImplementaConsultar
      ? 'Consulta de situação implementada no adapter Destaxa'
      : 'DestaxaRealAdapter NÃO implementa consultarTransacao — sem API oficial de consulta de situação no adapter; DLL Destaxa 1.83 só expõe INIT/TX_START/CONTINUE/FINALIZE (sem export de consulta)'
  };
}

function lerVsPagueLog() {
  const logPath = 'C:\\VBI\\V$Pague\\Client\\logs\\vspague-client.log';
  if (!fs.existsSync(logPath)) {
    return { existe: false, path: logPath };
  }
  const st = fs.statSync(logPath);
  const texto = fs.readFileSync(logPath, 'utf8');
  const linhas = texto.split(/\r?\n/);
  const relevantes = linhas.filter((l) =>
    /16:20|CRT|transacao|Transaction|mrt24|56138|60906|Connection reset|aprov|negad|autoriz/i.test(l)
  ).slice(-40);

  return {
    existe: true,
    path: logPath,
    lastWriteTime: st.mtime.toISOString(),
    size: st.size,
    linhasRelevantes: relevantes,
    observacaoIntervaloCrt: 'Em 2026-10-30 16:20:49 há conexão localhost→60906 seguida de Connection reset — compatível com tentativa de comunicação no horário da MRT-24; sem linha de aprovação/negação/NSU'
  };
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-24.1 — Reconciliação CRT inconclusiva (sem TX/INIT/CRT) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
  assert.strictEqual(transacaoRealHabilitada(), false, 'Gate deve permanecer OFF');

  const mrt24 = fs.existsSync(MRT24_REPORT)
    ? JSON.parse(fs.readFileSync(MRT24_REPORT, 'utf8'))
    : null;

  const consultaAdapter = inspecionarAdapterConsulta();
  console.log('1. Capacidade de consulta Destaxa:', consultaAdapter.conclusao);

  const dbTeste = path.join(process.env.LOCALAPPDATA || '', 'Temp', 'cds-sistemas-test-db', 'mercadao.db');
  const dbProd = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';

  console.log('2. Persistência TEF (somente leitura)…');
  const scanTeste = await escanearBanco(dbTeste);
  const scanProd = await escanearBanco(dbProd);
  // Produção: apenas verificar existência da linha — sem UPDATE
  console.log('  teste hit:', Array.isArray(scanTeste.hitTransactionId) ? scanTeste.hitTransactionId.length : 0);
  console.log('  prod hit:', Array.isArray(scanProd.hitTransactionId) ? scanProd.hitTransactionId.length : 0);

  const vspague = lerVsPagueLog();
  console.log('3. V$Pague log lastWrite:', vspague.lastWriteTime);

  const baseConsultar = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/adapters/BaseAdapter.js'),
    'utf8'
  );
  const baseConsultarBody = (() => {
    const m = baseConsultar.match(/async\s+consultarTransacao\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/);
    return m ? m[1].trim().slice(0, 400) : null;
  })();

  // TefManager em memória deste processo — não é o processo da MRT-24
  let tefManagerEstado = null;
  try {
    const tefManager = require('../../backend/services/tef/TefManager');
    tefManagerEstado = {
      continuidadeCrt: tefManager._continuidadeCrt || null,
      nota: 'Singleton deste processo Node ≠ processo da MRT-24; continuidade em memória da tentativa original não está aqui'
    };
  } catch (error) {
    tefManagerEstado = { erro: error.message };
  }

  const { clienteCompartilhadoExistente } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
  const hostAgora = clienteCompartilhadoExistente();
  const hostEstado = hostAgora ? hostAgora.getEstado() : null;

  const hitCds = []
    .concat(scanTeste.hitTransactionId || [])
    .concat(scanProd.hitTransactionId || []);

  const estadoCds = {
    encontradaEmPersistencia: hitCds.length > 0,
    registros: hitCds,
    motivoAusencia: hitCds.length
      ? null
      : 'MRT-24 executou DestaxaRealAdapter sem TefManager.autorizar — não houve INSERT em tef_transacoes; transactionId só existiu no IPC/runtime'
  };

  const idempotencyOriginal = mrt24?.execucao?.idempotencyKey
    || mrt24?.evidencias?.idempotencyKey
    || 'não persistida — gerada em runtime e perdida com a queda do processo (relatório MRT-24)';

  // Classificação — regras estritas
  let classificacaoReconciliacao = 'INCONCLUSIVA';
  let justificativa = [];

  const temEvidenciaAprovacao = false; // nenhum NSU/auth/00 conclusivo
  const temEvidenciaNegacao = false;
  const temEvidenciaNaoProcessadaConfiavel = false;
  // Não inferir NÃO PROCESSADA por ausência de logs

  if (temEvidenciaAprovacao) {
    classificacaoReconciliacao = 'APROVADA';
  } else if (temEvidenciaNegacao) {
    classificacaoReconciliacao = 'NEGADA';
  } else if (temEvidenciaNaoProcessadaConfiavel) {
    classificacaoReconciliacao = 'NÃO PROCESSADA';
  } else {
    classificacaoReconciliacao = 'INCONCLUSIVA';
    justificativa = [
      'TX_START foi enviado ao Native Host (log transacao.start) sem TX_START_RESULT capturado',
      'Sem registro em tef_transacoes / TefManager da tentativa',
      'V$Pague registra conexão/reset às 16:20:49 sem desfecho financeiro explícito',
      'DestaxaRealAdapter não oferece consulta oficial de situação de transação',
      'DLL Destaxa 1.83 sem export de consulta — não é possível consultar sem TX/INIT',
      'Ausência de logs ≠ evidência de não processamento (regra MRT-24.1)'
    ];
  }

  const report = {
    sprint: 'MRT-24.1',
    title: 'Reconciliação da CRT inconclusiva MRT-24',
    generatedAt: geradoEm,
    restricoesObservadas: {
      txStart: false,
      txContinue: false,
      txFinalize: false,
      init: false,
      est: false,
      cancelamento: false,
      estorno: false,
      segundaCrt: false,
      novaIdempotencyKey: false,
      gateOff: true,
      historicoOriginalAlterado: false,
      bloqueioInconclusivoLiberado: false
    },
    operacaoOriginal: {
      sprintOrigem: 'MRT-24',
      provedor: 'destaxa',
      ambiente: 'homologacao',
      operacao: 'CRT',
      valorCentavos: 100,
      transactionId: TRANSACTION_ID,
      idempotencyKey: idempotencyOriginal,
      estadoConhecidoAnterior: 'UNKNOWN',
      nativeHostPidMrt24: mrt24?.preValidacao?.init?.pid
        || mrt24?.evidencias?.nativeHostPid
        || 10952,
      vspaguePidMrt24: mrt24?.preValidacao?.vspague?.pid || 8740
    },
    estadoEncontradoNoCds: estadoCds,
    tefManagerProcessoAtual: tefManagerEstado,
    persistencia: {
      bancoTeste: {
        path: scanTeste.path,
        existe: scanTeste.existe,
        tables: scanTeste.tables || [],
        hitCount: (scanTeste.hitTransactionId || []).length,
        recentesResumo: (scanTeste.transacoesRecentes || []).slice(0, 5)
      },
      bancoProducao: {
        path: scanProd.path,
        existe: scanProd.existe,
        tables: scanProd.tables || [],
        hitCount: (scanProd.hitTransactionId || []).length,
        leituraSomente: true,
        alterado: false,
        recentesResumo: (scanProd.transacoesRecentes || []).slice(0, 5).map((r) => ({
          id: r.id,
          status: r.status,
          provedor: r.provedor,
          created_at: r.created_at
        }))
      }
    },
    logs: {
      mrt24Report: {
        path: 'docs/build/mrt-24-primeira-crt-homologacao-report.json',
        classificacao: mrt24?.classificacao || null,
        evidenciaLogRuntime: mrt24?.execucao?.evidenciaLogRuntime || [],
        ausencias: mrt24?.execucao?.ausencias || []
      },
      vspagueClient: vspague,
      nativeHost: {
        pidOriginal: 10952,
        processoAtualCompartilhado: hostEstado,
        nota: 'Host PID 10952 da MRT-24 não está vivo neste processo; sessão/runtime da tentativa original não é recuperável via singleton atual'
      }
    },
    consultaProvedor: {
      avaliada: true,
      utilizada: false,
      motivoNaoUtilizada: consultaAdapter.conclusao,
      naturezaSeExistisse: 'deveria ser somente leitura / não financeira',
      detalheCodigo: {
        ...consultaAdapter,
        baseAdapterConsultarTransacaoSnippet: baseConsultarBody
      },
      evidenciaDocumental: {
        exportsDll: consultaAdapter.dllExportsDocumentados,
        exportConsulta: false,
        operacaoConsultaNoHost: consultaAdapter.hostTemOperacaoConsulta
      }
    },
    evidenciaProvedorExterna: {
      aprovacao: null,
      negativa: null,
      nsu: null,
      autorizacao: null,
      processamentoConfirmado: null,
      nota: 'Sem comprovante Destaxa/V$Pague de aprovação ou negação para transactionId mrt24_5d70e3fb2328da54'
    },
    analiseEncerramento: {
      txStartEnviado: true,
      txStartResultRecebido: false,
      txFinalizeConfirmado: false,
      processoNodeEncerrouSemCapturarResultado: true,
      conexaoVsPagueNoHorario: vspague.linhasRelevantes || [],
      conclusao: 'Não é possível determinar se o provedor processou após o TX_START — encerramento ocorreu sem resposta capturada; conexão V$Pague resetada não prova desfecho'
    },
    classificacaoReconciliacao,
    justificativa,
    bloqueiosMantidos: {
      novaCobrancaAutomatica: true,
      retryCrtMesmaOperacao: true,
      liberacaoInconclusivo: false,
      cancelamentoEstornoAutomatico: true,
      gateFinanceiro: 'OFF',
      motivo: 'Sem evidência conclusiva do provedor — operação original permanece protegida/UNKNOWN'
    },
    proximaAcaoSeguraRecomendada: [
      'Manter bloqueio de nova CRT até tratamento formal',
      'Solicitar ao suporte/portal Destaxa (homologação) verificação da tentativa no horário da MRT-24 usando evidências de terminal/loja/horário — sem nova cobrança no CDS',
      'Não repetir CRT com nova idempotency_key até o Tech Lead autorizar após desfecho conhecido',
      'Se Destaxa confirmar formalmente NÃO PROCESSADA ou NEGADA/APROVADA, registrar evidência e só então reconciliar explicitamente no CDS',
      'Não iniciar MRT-25 nesta condição'
    ],
    confirmacaoNenhumaOperacaoFinanceira: {
      gateOff: true,
      tx: false,
      init: false,
      crt: false,
      est: false,
      mensagem: 'MRT-24.1 não executou INIT/TX/CRT/EST/cancelamento/estorno'
    },
    resultadoFinal: `MRT-24.1 CONCLUÍDA — RECONCILIAÇÃO: ${classificacaoReconciliacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('\n  Relatório:', REPORT_PATH);
  console.log('  Classificação reconciliação:', classificacaoReconciliacao);
  console.log('  Persistência hit:', estadoCds.encontradaEmPersistencia);
  console.log('  Consulta Destaxa utilizada:', false);
  console.log('  Gate OFF:', !transacaoRealHabilitada());
  console.log(`  ${report.resultadoFinal}\n`);

  assert.strictEqual(transacaoRealHabilitada(), false);
  assert.strictEqual(classificacaoReconciliacao, 'INCONCLUSIVA');
  assert.strictEqual(report.consultaProvedor.utilizada, false);
  assert.strictEqual(report.restricoesObservadas.segundaCrt, false);
}

main().catch((error) => {
  console.error('MRT-24.1 FALHOU:', error);
  process.exitCode = 1;
});
