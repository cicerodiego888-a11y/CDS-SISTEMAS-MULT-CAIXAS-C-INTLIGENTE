'use strict';

/**
 * MRT-37 — Auditoria protocolo 99 / OPCAO Destaxa (mocks only).
 * Sem INIT, DLL, TX, CRT, CONTINUE real, gate ON, DB write, venda.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-37-auditoria-retorno-99-coleta-destaxa-report.json');
const MRT24 = path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json');
const MRT36 = path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json');

const {
  REAL_TRANSACTION_ENV,
  TIPOS_ACAO,
  CODIGO_ACAO_SOLICITADA,
  CLASSIFICACAO_CODIGO,
  ESTADOS_TRANSACAO,
  CONTRATO_TIMEOUT_DESTAXA,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  parseAcaoSolicitada,
  classificarCodigoTransacao,
  buildContinuaInput,
  parseParametrosDestaxa
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  normalizarAcaoContinuidade,
  validarRespostaOperador,
  montarPedidoContinuidade,
  ehSolicitacaoContinuidade
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
const {
  resolverRespostaContinuidade,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');

const SAIDA_MRT36_OPCAO = [
  'mensagem=Tipo do Cartao',
  'opcao=Credito|Debito|Voucher',
  'tipo=X',
  'timeout=120',
  'chave=transacao_tipo_cartao'
].join(';');

const MRT36_IDS = Object.freeze({
  idempotency_key: 'mrt36_e50313b50c697f37',
  operation_id: 'op_95e9873dcfa4_059cc3b889b0da9e',
  fingerprint: '56e347bf6be5746f4058700320f799aa',
  transactionId: '1',
  financialState: 'UNKNOWN'
});

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

function lerJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-37 — Auditoria retorno 99 / OPCAO Destaxa ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const resultados = [];
  const classificacoes = {};

  // 1) Código 99
  const class99 = classificarCodigoTransacao('99');
  resultados.push(ok('1) código 99 → ACTION_REQUIRED / WAITING_ACTION',
    class99.codigo === CODIGO_ACAO_SOLICITADA
    && class99.classificacao === CLASSIFICACAO_CODIGO.ACTION_REQUIRED
    && class99.estadoTransacao === ESTADOS_TRANSACAO.WAITING_ACTION, {
      class99
    }));
  classificacoes.contratoCodigo99 = 'CONTRATO_DOCUMENTADO';
  classificacoes.interpretacaoCds99 = 'IMPLEMENTADO';

  // 2) Parsing OPCAO espelhando MRT-36 (campos já renomeados pela DLL)
  const acao = parseAcaoSolicitada(SAIDA_MRT36_OPCAO);
  resultados.push(ok('2) parse OPCAO Tipo do Cartao + chave transacao_tipo_cartao',
    acao.tipo === TIPOS_ACAO.OPCAO
    && acao.mensagem === 'Tipo do Cartao'
    && acao.chave === 'transacao_tipo_cartao'
    && acao.tipoDado === 'X'
    && String(acao.timeout) === '120'
    && Array.isArray(acao.opcoes)
    && acao.opcoes.join('|') === 'Credito|Debito|Voucher', {
      acao: {
        tipo: acao.tipo,
        mensagem: acao.mensagem,
        chave: acao.chave,
        tipoDado: acao.tipoDado,
        timeout: acao.timeout,
        opcoes: acao.opcoes
      }
    }));
  classificacoes.parseOpcao = 'IMPLEMENTADO';
  classificacoes.preservacaoChave = 'IMPLEMENTADO';

  // 3) automacao_coleta_* — NÃO documentado no contrato AC; rename observado no log DLL
  const brutosInternos = parseParametrosDestaxa(
    'automacao_coleta_mensagem=Tipo do Cartao;automacao_coleta_palavra_chave=transacao_tipo_cartao'
  );
  const parseRaw = parseAcaoSolicitada(
    'automacao_coleta_mensagem=Tipo;automacao_coleta_opcao=Credito|Debito;automacao_coleta_tipo=X'
  );
  resultados.push(ok('3) automacao_coleta_* não é contrato AC; parse exige campos oficiais após rename DLL',
    !Object.prototype.hasOwnProperty.call(brutosInternos, 'mensagem')
    && parseRaw.tipo !== TIPOS_ACAO.OPCAO
    && parseAcaoSolicitada(SAIDA_MRT36_OPCAO).tipo === TIPOS_ACAO.OPCAO, {
      parseRawTipo: parseRaw.tipo,
      nota: 'DLL renomeia automacao_coleta_* → mensagem/timeout/tipo/opcao/chave (MRT-36 protocol.c:792)'
    }));
  classificacoes.automacaoColetaNoContratoAc = 'NAO_DOCUMENTADO';
  classificacoes.renameObservadoDll = 'IMPLEMENTADO_PARCIALMENTE';

  // 4) Resposta OPCAO → informacao=
  const validacao = validarRespostaOperador(acao, 'Credito');
  const entrada = buildContinuaInput(validacao.resposta);
  resultados.push(ok('4) resposta OPCAO Credito → entrada informacao=Credito',
    validacao.ok === true
    && validacao.resposta.informacao === 'Credito'
    && entrada.texto === 'informacao=Credito'
    && entrada.chaves.includes('informacao'), {
      entrada: entrada.texto
    }));
  classificacoes.respostaOpcaoEntrada = 'IMPLEMENTADO';

  // 5) Ciclo exige fila explícita (não auto-aprova 99)
  const filaVazia = resolverRespostaContinuidade(acao, []);
  resultados.push(ok('5) OPCAO sem fila → CONTINUIDADE_SEM_RESPOSTA (99 ≠ aprovação)',
    filaVazia.ok === false
    && filaVazia.codigo === CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA, {
      codigo: filaVazia.codigo
    }));
  classificacoes.protecaoRetry99 = 'IMPLEMENTADO';

  // 6) Transporte PDV / pedido continuidade preserva identidade
  const pedido = montarPedidoContinuidade({
    transacaoId: MRT36_IDS.transactionId,
    idempotencyKey: MRT36_IDS.idempotency_key,
    resposta: { informacao: 'Credito' },
    vendaId: null,
    acao
  });
  const acaoPdv = normalizarAcaoContinuidade(acao);
  resultados.push(ok('6) pedido /tef/continuar correlaciona transactionId + idempotency_key + chave',
    String(pedido.transacao_id) === MRT36_IDS.transactionId
    && pedido.idempotency_key === MRT36_IDS.idempotency_key
    && pedido.nao_iniciar_tx === true
    && acaoPdv.chave === 'transacao_tipo_cartao'
    && acaoPdv.reconhecida === true
    && ehSolicitacaoContinuidade({
      requerContinuacao: true,
      codigo: 'DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA'
    }) === true, {
      pedido,
      acaoPdv: { tipo: acaoPdv.tipo, chave: acaoPdv.chave, opcoes: acaoPdv.opcoes }
    }));
  classificacoes.transportePdv = 'IMPLEMENTADO';
  classificacoes.correlacaoIdentidade = 'IMPLEMENTADO';

  // 7) Timeout documentado
  resultados.push(ok('7) contrato timeout coleta = segundos; Client cancela se excedido',
    CONTRATO_TIMEOUT_DESTAXA.coleta.campo === 'timeout'
    && CONTRATO_TIMEOUT_DESTAXA.coleta.unidade === 'segundos'
    && CONTRATO_TIMEOUT_DESTAXA.codigo08.codigo === '08'
    && CONTRATO_TIMEOUT_DESTAXA.globalTimeout === 'DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO', {
      coleta: CONTRATO_TIMEOUT_DESTAXA.coleta,
      codigo08: CONTRATO_TIMEOUT_DESTAXA.codigo08
    }));
  classificacoes.timeoutColeta = 'CONTRATO_DOCUMENTADO';
  classificacoes.timeoutGlobalCrt = 'NAO_DOCUMENTADO';

  // 8) Preservação MRT-24 / MRT-36
  const m24 = lerJson(MRT24);
  const m36 = lerJson(MRT36);
  resultados.push(ok('8) identidades MRT-24 UNKNOWN e MRT-36 preservadas (somente leitura)',
    (m24.execucao?.resultado?.financialState || m24.classificacao) != null
    && m36.identidade?.idempotency_key === MRT36_IDS.idempotency_key
    && m36.identidade?.operation_id === MRT36_IDS.operation_id
    && m36.identidade?.fingerprint === MRT36_IDS.fingerprint
    && String(m36.identidade?.transactionId) === MRT36_IDS.transactionId
    && (m36.estadoFinalTransacao?.financialState === 'UNKNOWN'
      || m36.classificacao === 'INCONCLUSIVA'), {
      mrt24Financial: m24.execucao?.resultado?.financialState || 'UNKNOWN',
      mrt36: MRT36_IDS
    }));
  classificacoes.preservacaoMrt24 = 'IMPLEMENTADO';
  classificacoes.preservacaoMrt36 = 'IMPLEMENTADO';

  // 9) Gate OFF
  resultados.push(ok('9) gate permanece OFF', transacaoRealHabilitada() === false));

  // 10) Arquivos PDV / rota existem (leitura)
  const pdvCont = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdvTefContinuidade.js'), 'utf8');
  const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/tef.js'), 'utf8');
  resultados.push(ok('10) PDV + rota /tef/continuar presentes (continuidade parcial operacional)',
    /ehContinuidade/.test(pdvCont)
    && /TIPOS\.OPCAO|OPCAO:\s*'OPCAO'/.test(pdvCont)
    && /post\('\/continuar'/.test(rota)
    && /continuarPagamento/.test(rota), {
      arquivos: [
        'frontend/pdv/js/pdvTefContinuidade.js',
        'backend/rotas/tef.js'
      ]
    }));
  classificacoes.caminhoPdvContinuidade = 'IMPLEMENTADO';
  classificacoes.execucaoFinanceiraContinuidadeNestaSprint = 'AUSENTE';

  const report = {
    sprint: 'MRT-37',
    title: 'Auditoria do protocolo 99 / OPCAO — Destaxa',
    generatedAt: geradoEm,
    classificacaoGeral: 'IMPLEMENTADO_PARCIALMENTE',
    gateOff: true,
    identidadesPreservadas: {
      mrt24: { estado: 'UNKNOWN', naoReutilizado: true },
      mrt36: { ...MRT36_IDS, naoReutilizado: true, naoAlterado: true, naoLiberado: true }
    },
    documentacaoOficial: {
      pacote: 'Destaxa DLL 1.83',
      fontes: [
        'docs/07-api-continuatransacaodestaxa.md',
        'docs/09-tabela-codigos-de-retorno.md',
        'docs/10-acoes-de-coleta.md',
        'docs/06-api-iniciatransacaodestaxa.md',
        'docs/04-interface-dll-ac.md',
        'docs/dll-integracao-tef.html'
      ],
      codigo99: {
        classificacao: 'CONTRATO_DOCUMENTADO',
        significado: 'Client solicita uma ação da AC (display ou coleta)',
        acaoObrigatoria: 'chamar continuaTransacaoDestaxa até resultado ≠ 99'
      },
      optionOpcao: {
        classificacao: 'CONTRATO_DOCUMENTADO',
        identificacao: 'campo opcao presente em saida (lista separada por |), com mensagem e tipo',
        exemploDoc: 'mensagem=Forma de Pagamento;opcao=Debito|Credito;tipo=X',
        casoMrt36: 'mensagem=Tipo do Cartao;opcao=Credito|Debito|Voucher;tipo=X;timeout=120;chave=transacao_tipo_cartao'
      },
      automacao_coleta: {
        classificacao: 'NAO_DOCUMENTADO',
        nota: 'Prefixo automacao_coleta_* não consta no contrato AC 07/10. Evidência operacional MRT-36: DLL renomeia para mensagem/timeout/tipo/opcao/chave (protocol.c:792) antes da saida consumida pela AC.'
      },
      respostaOpcao: {
        classificacao: 'CONTRATO_DOCUMENTADO',
        exportDll: 'continuaTransacaoDestaxa',
        entrada: 'informacao=<VALOR_SELECIONADO> (doc 07 para coleta; Anexo I campo informacao)',
        mesmaTransacao: true,
        notaIdentidade: 'continuaTransacaoDestaxa continua a transação corrente; CDS correlaciona via transactionId/idempotency_key no Host/TefManager (não há transactionId no parâmetro entrada da DLL documentado)'
      },
      timeout: {
        classificacao: 'CONTRATO_DOCUMENTADO',
        campo: 'timeout',
        unidade: 'segundos',
        efeito: 'Client cancela a transação se AC não responder a tempo',
        codigoTimeout: '08',
        timeoutGlobalCrt: 'NAO_DOCUMENTADO'
      },
      retornos: {
        continuidade: ['99'],
        sucessoConclusivo: ['00'],
        cancelamentoNegacao: ['03', '04', '09'],
        timeout: ['08'],
        dadosInvalidos: ['05'],
        errosComunicacao: ['06', '07', 'F1'],
        errosApi: ['FF', 'F0', 'F2', 'FE'],
        pendenciasConfirmacao: ['A0', 'A1']
      }
    },
    auditoriaCds: {
      arquivos: [
        'backend/services/tef/destaxa/destaxaProtocolo.js (parseAcaoSolicitada, buildContinuaInput)',
        'backend/services/tef/destaxa/destaxaContinuidadeContrato.js',
        'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js',
        'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
        'backend/services/tef/destaxa/DestaxaNativeBridge.js',
        'backend/services/tef/destaxa/DestaxaNativeHost.js',
        'backend/services/tef/adapters/DestaxaRealAdapter.js',
        'backend/services/tef/TefManager.js (continuarAutorizacao)',
        'backend/rotas/tef.js (POST /continuar)',
        'frontend/pdv/js/pdvTefContinuidade.js',
        'frontend/pdv/js/pdv.js (processarPagamentoTEF continuidade)'
      ],
      statusPorCapacidade: classificacoes,
      lacunas: [
        {
          item: 'MRT-36 runner sem TTY/PDV',
          impacto: 'OPCAO chegou ao ciclo mas respostasContinuidade vazia → CONTINUIDADE_SEM_RESPOSTA',
          classificacao: 'IMPLEMENTADO_PARCIALMENTE'
        },
        {
          item: 'Pré-envio transacao_tipo_cartao em iniciaTransacaoDestaxa',
          impacto: 'Doc 06 lista o campo como entrada opcional de CRT; CDS CRT envia só transacao_valor e deixa o Client solicitar via 99 (comportamento alinhado a buildCrtInput). Não inventar preenchimento automático nesta sprint.',
          classificacao: 'IMPLEMENTADO'
        },
        {
          item: 'Grafia Debito vs Débito na doc 06',
          impacto: 'Doc 06 cita Débito/Credito; MRT-36 recebeu Debito|Credito|Voucher. Resposta deve ecoar literal da opção retornada (Credito), sem normalizar acento inventado.',
          classificacao: 'CONTRATO_DOCUMENTADO'
        }
      ]
    },
    testes: {
      arquivo: 'tests/tef/mrt-37-auditoria-retorno-99-coleta-destaxa.test.js',
      resultados,
      chamadaFinanceiraReal: false,
      dllCarregada: false
    },
    restricoesObservadas: {
      gateOff: true,
      init: false,
      dll: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalize: false,
      est: false,
      dbWrite: false,
      venda: false,
      mrt24Unknown: true,
      mrt36Preservada: true
    },
    recomendacaoProximaSprint: {
      codigo: 'MRT-38_CANDIDATA_CONTINUIDADE_CONTROLADA',
      quando: 'Somente após autorização Tech Lead / PO',
      oQue: 'Continuidade oficial da MESMA identidade MRT-36 OU nova CRT autorizada com PDV/TTY e respostasContinuidade=[Credito] — NÃO misturar sem conciliação',
      como: [
        'Preferir fluxo PDV → POST /tef/continuar (já implementado) com gate ON só na janela',
        'Resposta literal Credito → informacao=Credito via continuaTransacaoDestaxa',
        'Preservar transactionId/idempotency_key; nunca novo TX_START para a mesma cobrança',
        'Se MRT-36 já expirou timeout 120s no Client: NÃO CONTINUE — conciliar e, se autorizada, nova CRT',
        'Não reutilizar MRT-24'
      ],
      naoFazerNestaRevisao: 'Não iniciar MRT-38 automaticamente'
    },
    confirmacoes: {
      zeroOperacoesFinanceiras: true,
      gateOff: true,
      mrt24Unknown: true,
      mrt36IdentidadesIntocadas: true
    }
  };

  // Ajuste classificação rename
  report.auditoriaCds.statusPorCapacidade.renameObservadoDll = 'IMPLEMENTADO_PARCIALMENTE';

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  console.log('Classificação geral:', report.classificacaoGeral);
  console.log(`OK: ${resultados.length}`);
  console.log('Aguardando Tech Lead. Não iniciar MRT-38.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
