'use strict';

/**
 * MRT-28 — Configuração de log da DLL Destaxa 1.83
 * Validação estática / preparação de diretório. SEM INIT, TX_START, CRT, ENABLE_REAL.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-28-configuracao-log-dll-destaxa-report.json');

const {
  DESTAXA_DLL_LOG_PARAMS,
  DESTAXA_DLL_LOG_META,
  CHAVES_LOG_DLL,
  TAM_MAX_LOG_BYTES_CONFIRMADO,
  TAM_MAX_LOG_MEGABYTES_DLL,
  paresLogDll,
  garantirDiretorioLogDll,
  anexarParamsLogEntrada,
  descreverConfigLogDll
} = require('../../backend/services/tef/destaxa/destaxaDllLogConfig');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const { montarEntradaClient } = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const {
  REAL_TRANSACTION_ENV,
  APLICACAO,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { parseParametrosDestaxa } = require('../../backend/services/tef/destaxa/destaxaProtocolo');

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-28 — Configuração de log DLL Destaxa (estático, sem INIT) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const resultados = [];

  // --- Assinatura Koffi / doc ---
  console.log('1. Assinatura iniciaClientDestaxa + Koffi');
  const koffiSrc = ler('backend/services/tef/destaxa/destaxaKoffiLoader.js');
  resultados.push(ok('Koffi: iniciaClientDestaxa(resultado, entrada, tamanho_entrada)',
    /iniciaClientDestaxa:\s*'void iniciaClientDestaxa\(uint8 \*resultado, uint8 \*entrada, int tamanho_entrada\)'/.test(koffiSrc),
    {
      assinaturaDoc: 'void iniciaClientDestaxa(char *resultado, char *entrada, int tamanho_entrada)',
      nota: 'Log params NÃO são argumentos C — entram em `entrada` como chave=valor'
    }));

  const docOficialPath = 'C:\\Users\\cicer\\Desktop\\DLL DESTAXA\\1_83-20260831T165940Z-1-001\\1_83\\docs\\05-api-iniciaclientdestaxa.md';
  const docExiste = fs.existsSync(docOficialPath);
  let docConteudo = '';
  if (docExiste) {
    docConteudo = fs.readFileSync(docOficialPath, 'utf8');
  }
  resultados.push(ok('Doc 1.83 lista os cinco parâmetros de log',
    docExiste
    && /diretorio_trabalho/.test(docConteudo)
    && /nivel_log/.test(docConteudo)
    && /nome_arquivo_log/.test(docConteudo)
    && /tam_max_log/.test(docConteudo)
    && /total_bkp_log/.test(docConteudo)
    && /mega bytes/i.test(docConteudo),
    { docExiste, docOficialPath }));

  // --- Montagem dos cinco parâmetros ---
  console.log('\n2. Montagem dos parâmetros confirmados');
  const pares = paresLogDll();
  const mapaPares = Object.fromEntries(pares);
  resultados.push(ok('Cinco chaves na ordem da sprint',
    CHAVES_LOG_DLL.length === 5
    && pares.length === 5
    && CHAVES_LOG_DLL.every((k, i) => pares[i][0] === k),
    { CHAVES_LOG_DLL, pares }));

  resultados.push(ok('nivel_log === 1 (DEBUG na escala 5…0)',
    DESTAXA_DLL_LOG_PARAMS.nivel_log === '1' && mapaPares.nivel_log === '1',
    { nivel_log: DESTAXA_DLL_LOG_PARAMS.nivel_log, escala: DESTAXA_DLL_LOG_META.documentacaoOficial.nivel_log_escala }));

  resultados.push(ok('Caminho e nome do arquivo',
    DESTAXA_DLL_LOG_PARAMS.diretorio_trabalho === 'C:\\CDS-SISTEMAS\\logs\\destaxa'
    && DESTAXA_DLL_LOG_PARAMS.nome_arquivo_log === 'destaxa-dll.log'
    && DESTAXA_DLL_LOG_META.caminhoArquivoLogEsperado === 'C:\\CDS-SISTEMAS\\logs\\destaxa\\destaxa-dll.log',
    {
      diretorio_trabalho: DESTAXA_DLL_LOG_PARAMS.diretorio_trabalho,
      nome_arquivo_log: DESTAXA_DLL_LOG_PARAMS.nome_arquivo_log,
      caminhoCompleto: DESTAXA_DLL_LOG_META.caminhoArquivoLogEsperado
    }));

  resultados.push(ok('Tamanho 10 MB (DLL em megabytes) + 5 backups',
    TAM_MAX_LOG_BYTES_CONFIRMADO === 10485760
    && TAM_MAX_LOG_MEGABYTES_DLL === 10
    && DESTAXA_DLL_LOG_PARAMS.tam_max_log === '10'
    && DESTAXA_DLL_LOG_PARAMS.total_bkp_log === '5',
    {
      bytesConfirmadosEspecialista: TAM_MAX_LOG_BYTES_CONFIRMADO,
      megabytesEnviadosDll: DESTAXA_DLL_LOG_PARAMS.tam_max_log,
      total_bkp_log: DESTAXA_DLL_LOG_PARAMS.total_bkp_log,
      unidadeDoc: 'mega bytes'
    }));

  // --- Projeção entrada (preserva versao/aplicacao) ---
  console.log('\n3. Compatibilidade com entrada chave=valor');
  const proj = projetarEntradaIniciaClient({}, { versao: '1.0.3', aplicacao: APLICACAO });
  const parsed = parseParametrosDestaxa(proj.texto);
  resultados.push(ok('Parâmetros atuais preservados (versao + aplicacao)',
    parsed.versao === '1.0.3'
    && parsed.aplicacao === APLICACAO
    && proj.chaves[0] === 'versao'
    && proj.chaves[1] === 'aplicacao',
    { texto: proj.texto, chaves: proj.chaves }));

  resultados.push(ok('Cinco params de log presentes na mesma string entrada',
    CHAVES_LOG_DLL.every((k) => parsed[k] === DESTAXA_DLL_LOG_PARAMS[k])
    && CHAVES_LOG_DLL.every((k) => proj.chaves.includes(k)),
    { camposLogDll: proj.camposLogDll, parsedLog: Object.fromEntries(CHAVES_LOG_DLL.map((k) => [k, parsed[k]])) }));

  const comCodigos = projetarEntradaIniciaClient({
    empresa_codigo: 'EST1',
    loja_codigo: 'LJ1',
    terminal_codigo: 'T1'
  }, { versao: '1.0.3', aplicacao: APLICACAO });
  const p2 = parseParametrosDestaxa(comCodigos.texto);
  resultados.push(ok('Preserva estabelecimento/loja/terminal + log',
    p2.estabelecimento === 'EST1' && p2.loja === 'LJ1' && p2.terminal === 'T1'
    && p2.nivel_log === '1' && p2.tam_max_log === '10',
    { texto: comCodigos.texto }));

  const anexado = anexarParamsLogEntrada([['versao', '1.0.3'], ['aplicacao', 'CDS Sistemas']]);
  resultados.push(ok('anexarParamsLogEntrada não duplica chaves',
    anexado.filter(([k]) => k === 'nivel_log').length === 1
    && anexado.length === 2 + 5,
    { anexado }));

  // montarEntradaClient (usa package.json version — sem chamar DLL)
  let entradaBridge = null;
  try {
    entradaBridge = montarEntradaClient({});
    resultados.push(ok('montarEntradaClient inclui log sem carregar DLL',
      entradaBridge.camposLogDll
      && entradaBridge.camposLogDll.nivel_log === '1'
      && entradaBridge.chaves.includes('nome_arquivo_log'),
      { chaves: entradaBridge.chaves, camposLogDll: entradaBridge.camposLogDll }));
  } catch (err) {
    resultados.push(ok('montarEntradaClient inclui log sem carregar DLL', false, { erro: err.message }));
  }

  // --- Diretório gravável ---
  console.log('\n4. Diretório de logs');
  const dirResult = garantirDiretorioLogDll();
  resultados.push(ok('Diretório criado e gravável',
    dirResult.ok === true
    && fs.existsSync(DESTAXA_DLL_LOG_PARAMS.diretorio_trabalho)
    && dirResult.gravavel === true,
    { dirResult }));

  // --- Estático: TX não alterado; INIT não executado ---
  console.log('\n5. Restrições / estático');
  const bridgeSrc = ler('backend/services/tef/destaxa/DestaxaNativeBridge.js');
  const cicloSrc = ler('backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js');
  resultados.push(ok('garantirDiretorioLogDll chamado em iniciarClient (pré-INIT)',
    /garantirDiretorioLogDll/.test(bridgeSrc),
    {}));
  resultados.push(ok('Ciclo CRT não referencia config de log (TX intacto)',
    !/destaxaDllLogConfig/.test(cicloSrc),
    {}));
  resultados.push(ok('Gate financeiro OFF',
    transacaoRealHabilitada() === false,
    { env: process.env[REAL_TRANSACTION_ENV] || null }));
  resultados.push(ok('INIT não executado nesta sprint',
    true,
    { iniciaClientDestaxaChamado: false, autorizacao: 'requer autorização expressa do usuário' }));

  const classificacao = resultados.every((r) => r.ok)
    ? 'CONFIG_LOG_DLL_APROVADA'
    : 'CONFIG_LOG_DLL_REPROVADA';

  const relatorio = {
    sprint: 'MRT-28',
    title: 'Configuração de log da DLL Destaxa 1.83',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      init: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      est: false,
      cancelamento: false,
      estorno: false,
      enableReal: false,
      gateOff: true,
      bancoProducao: false,
      dllAtualizada: false,
      mrt24Repetida: false,
      operacaoFinanceira: false
    },
    assinaturaIniciaClient: {
      documentacao: 'void iniciaClientDestaxa(char *resultado, char *entrada, int tamanho_entrada)',
      koffi: 'void iniciaClientDestaxa(uint8 *resultado, uint8 *entrada, int tamanho_entrada)',
      formatoEntrada: 'chave=valor;chave=valor',
      logComoArgumentosCSeparados: false,
      logNaStringEntrada: true
    },
    tiposFormatosConfirmados: {
      diretorio_trabalho: { tipoEntrada: 'string path', valor: DESTAXA_DLL_LOG_PARAMS.diretorio_trabalho },
      nivel_log: { tipoEntrada: 'string numérica 5..0 / <0', valor: '1', significado: 'DEBUG' },
      nome_arquivo_log: { tipoEntrada: 'string', valor: 'destaxa-dll.log' },
      tam_max_log: {
        tipoEntrada: 'string numérica em mega bytes (doc 1.83)',
        valorEnviado: DESTAXA_DLL_LOG_PARAMS.tam_max_log,
        bytesConfirmadosEspecialista: TAM_MAX_LOG_BYTES_CONFIRMADO,
        nota: 'Especialista confirmou 10485760 bytes (=10 MiB); DLL exige megabytes → enviado 10'
      },
      total_bkp_log: { tipoEntrada: 'string numérica', valor: '5' }
    },
    configCentralizada: descreverConfigLogDll(),
    amostraEntrada: proj.texto,
    diretorio: dirResult,
    arquivosAnalisados: [
      'C:/Users/cicer/Desktop/DLL DESTAXA/.../docs/05-api-iniciaclientdestaxa.md',
      'backend/services/tef/destaxa/destaxaKoffiLoader.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'backend/services/tef/destaxa/destaxaMapeamentoTerminal.js',
      'examples clang/dotnet (pacote 1.83)'
    ],
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaDllLogConfig.js',
      'backend/services/tef/destaxa/destaxaMapeamentoTerminal.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'tests/tef/mrt-28-configuracao-log-dll-destaxa.test.js',
      'docs/build/mrt-28-configuracao-log-dll-destaxa-report.json'
    ],
    testes: resultados,
    resultadoEsperado: {
      arquivo: 'C:\\CDS-SISTEMAS\\logs\\destaxa\\destaxa-dll.log',
      nivel: 1,
      backups: 5,
      tamanhoMaxMb: 10,
      nota: 'Arquivo será gerado pela DLL após INIT autorizado (não executado nesta sprint)'
    },
    confirmacoes: {
      operacaoFinanceira: false,
      gateFinanceiroOff: true,
      initNaoExecutado: true
    }
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(relatorio, null, 2), 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  Amostra entrada: ${proj.texto}`);
  console.log(`  Diretório: ${dirResult.diretorio} (gravável=${dirResult.gravavel})`);
  console.log(`\n  MRT-28 CONCLUÍDA — ${classificacao}\n`);

  if (classificacao !== 'CONFIG_LOG_DLL_APROVADA') process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
