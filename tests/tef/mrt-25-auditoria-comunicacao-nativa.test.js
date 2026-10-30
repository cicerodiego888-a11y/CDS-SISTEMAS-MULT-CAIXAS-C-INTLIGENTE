'use strict';

/**
 * MRT-25 — Auditoria READ-ONLY de comunicação nativa Destaxa
 * Sem INIT / TX / ENABLE_REAL / CRT / EST.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-25-auditoria-comunicacao-nativa-report.json');
const ROOT = path.join(__dirname, '../..');

const { buildCrtInput, formatarValorDestaxa } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  VALOR_HOMOLOGACAO_CENTAVOS,
  REAL_TRANSACTION_ENV,
  OPERACOES,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-25 — Auditoria comunicação nativa Destaxa (READ-ONLY) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const fontes = {
    host: ler('backend/services/tef/destaxa/DestaxaNativeHost.js'),
    hostClient: ler('backend/services/tef/destaxa/DestaxaNativeHostClient.js'),
    hostBridge: ler('backend/services/tef/destaxa/DestaxaHostBridge.js'),
    nativeBridge: ler('backend/services/tef/destaxa/DestaxaNativeBridge.js'),
    orquestrador: ler('backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js'),
    koffi: ler('backend/services/tef/destaxa/destaxaKoffiLoader.js'),
    adapter: ler('backend/services/tef/adapters/DestaxaRealAdapter.js'),
    ciclo: ler('backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js'),
    protocolo: ler('backend/services/tef/destaxa/destaxaProtocolo.js'),
    protocoloHost: ler('backend/services/tef/destaxa/destaxaNativeHostProtocolo.js')
  };

  const evidencias = [];
  const ok = (nome, cond, detalhe) => {
    evidencias.push({ nome, ok: !!cond, detalhe: detalhe || null });
    console.log(`  ${cond ? 'OK' : 'FAIL'} — ${nome}`);
    assert.ok(cond, nome);
  };

  // ——— Fluxo de comunicação ———
  console.log('1. Fluxo real de comunicação (código)');
  const fluxo = [
    'PDV/API → TefManager.autorizar (ou MRT-24: DestaxaRealAdapter direto)',
    'DestaxaRealAdapter.autorizarPagamento → habilitarTransacaoReal (ENABLE_REAL IPC)',
    'executarCicloCrt → DestaxaHostBridge.iniciarTransacaoDestaxa',
    'DestaxaNativeHostClient.enviar(TX_START) via child_process/utilityProcess IPC',
    'DestaxaNativeHost (processo filho) → DestaxaNativeBridge → DestaxaTransacaoOrquestrador',
    'Koffi → iniciaTransacaoDestaxa(resultado, operacao, entrada, tamanho, saida, *tamanho_saida)',
    'DLL Destaxa conecta ao V$Pague Client Background (LISTEN 60906) — CDS Node NÃO abre 60906',
    'DLL bloqueia até retorno; Host responde IPC; Adapter/Ciclo interpreta código'
  ];
  ok('Host IPC usa child_process.fork ou Electron utilityProcess',
    /child_process/.test(fontes.hostClient) && /utilityProcess/.test(fontes.hostClient));
  ok('Host filho sai em disconnect IPC',
    /process\.on\('disconnect',\s*\(\)\s*=>\s*process\.exit\(0\)\)/.test(fontes.host));
  ok('Cliente faz unref do processo e do channel IPC',
    /child\.unref\(\)/.test(fontes.hostClient)
    && /channel\.unref/.test(fontes.hostClient));
  ok('TX nativo é síncrono (Koffi bloqueia thread do Host)',
    /chamarComSaida\('iniciaTransacaoDestaxa'/.test(fontes.nativeBridge)
    && /void iniciaTransacaoDestaxa/.test(fontes.koffi));
  ok('CDS não referencia porta 60906 no código TEF Destaxa',
    !/60906/.test(fontes.adapter + fontes.host + fontes.hostBridge + fontes.nativeBridge + fontes.orquestrador));

  // ——— Parâmetros TX_START ———
  console.log('\n2. Parâmetros efetivos TX_START');
  const entrada = buildCrtInput({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS });
  ok('Valor homologação 100 → transacao_valor=1.00',
    formatarValorDestaxa(100) === '1.00'
    && entrada.texto === 'transacao_valor=1.00'
    && entrada.chaves.includes('transacao_valor'));
  ok('operacao CRT é parâmetro separado (não entra na string entrada)',
    !/operacao=CRT/.test(entrada.texto)
    && OPERACOES.CRT === 'CRT');
  ok('HostBridge TX_START envia operacao+campos+transactionId IPC',
    /TX_START/.test(fontes.hostBridge)
    && /operacao, campos/.test(fontes.hostBridge.replace(/\s/g, ' '))
    || (/TX_START/.test(fontes.hostBridge) && /transactionId/.test(fontes.hostBridge)));
  ok('transactionId CDS fica no orquestrador/IPC — não no texto DLL entrada',
    /transactionId: opcoes\.transactionId/.test(fontes.orquestrador)
    && /entrada\.texto/.test(fontes.orquestrador));

  // ——— Quem abre/fecha 60906 ———
  console.log('\n3. Porta 60906 / protocolo');
  const mrt15 = JSON.parse(ler('docs/build/mrt-15-dll-diagnostico-real-report.json'));
  const mrt24 = JSON.parse(ler('docs/build/mrt-24-primeira-crt-homologacao-report.json'));
  const mrt241 = JSON.parse(ler('docs/build/mrt-24-1-reconciliacao-crt-report.json'));

  ok('Documentado: CDS não usa 60906; Client LISTEN Background',
    /CDS não as usa/.test(JSON.stringify(mrt15.analiseBackgroundEPortas || {}))
    || mrt15.analiseBackgroundEPortas?.commandLineClient?.interpretacao?.includes('CDS não'));

  const vspagueLinhas = mrt241?.logs?.vspagueClient?.linhasRelevantes
    || [];
  const temReset = (mrt241?.logs?.vspagueClient?.observacaoIntervaloCrt || '').includes('Connection reset')
    || vspagueLinhas.some((l) => /Connection reset/i.test(l));
  ok('MRT-24.1 correlacionou Connection reset às 16:20:49',
    temReset || /Connection reset/.test(JSON.stringify(mrt241.logs || {})));

  // ——— Ponto de falha MRT-24 ———
  console.log('\n4. Correlação MRT-24');
  ok('MRT-24: TX_START enviado sem TX_START_RESULT',
    (mrt24.execucao?.evidenciaLogRuntime || []).some((l) => /transacao\.start/.test(l))
    && (mrt24.execucao?.ausencias || []).includes('TX_START_RESULT'));
  ok('Hipótese código: disconnect→exit(0) mata Host no meio da DLL',
    /disconnect/.test(fontes.host) && /process\.exit\(0\)/.test(fontes.host));
  ok('encerrar() adia se emVoo — mas disconnect do parent não passa por encerrar()',
    /encerramentoPendente|_emVoo/.test(fontes.hostClient)
    && /disconnect/.test(fontes.host));

  // ——— Tratamento retorno vazio / erro ———
  console.log('\n5. Tratamento de retorno/erro');
  ok('Orquestrador captura throw da DLL em _montarErroFinanceiro',
    /_montarErroFinanceiro/.test(fontes.orquestrador)
    && /catch \(error\)/.test(fontes.orquestrador));
  ok('Host devolve HOST_INTERNAL_ERROR + resultado UNKNOWN em TX se throw',
    /HOST_INTERNAL_ERROR/.test(fontes.host)
    && /resultadoHostIndisponivel/.test(fontes.host));
  ok('Cliente: operação transacional sem timeout IPC padrão (aguarda Host ou queda)',
    /OPERACOES_TRANSACIONAIS\.has\(operation\) \? null/.test(fontes.hostClient)
    || /timeoutMs == null/.test(fontes.hostClient));
  ok('Gate OFF nesta auditoria', transacaoRealHabilitada() === false);

  const classificacao = 'CAUSA PARCIALMENTE IDENTIFICADA';

  const report = {
    sprint: 'MRT-25',
    title: 'Auditoria de comunicação nativa Destaxa (READ-ONLY)',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      init: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      est: false,
      enableReal: false,
      cobranca: false,
      alteracaoArquitetura: false,
      bancoProducao: false,
      dllAtualizada: false
    },
    arquivosAnalisados: [
      'backend/services/tef/destaxa/DestaxaNativeHost.js',
      'backend/services/tef/destaxa/DestaxaNativeHostClient.js',
      'backend/services/tef/destaxa/DestaxaHostBridge.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
      'backend/services/tef/destaxa/destaxaKoffiLoader.js',
      'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js',
      'backend/services/tef/destaxa/destaxaProtocolo.js',
      'backend/services/tef/destaxa/destaxaNativeHostProtocolo.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'docs/build/mrt-15-dll-diagnostico-real-report.json',
      'docs/build/mrt-24-primeira-crt-homologacao-report.json',
      'docs/build/mrt-24-1-reconciliacao-crt-report.json'
    ],
    fluxoRealComunicacao: fluxo,
    parametrosEfetivosCds: {
      operacaoDll: 'CRT',
      entradaDll: entrada.texto,
      chavesEntrada: entrada.chaves,
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      transactionIdIpc: 'correlation CDS↔Host (MRT-24: mrt24_5d70e3fb2328da54) — NÃO enviado no texto entrada da DLL',
      ipcOperation: OPERACOES_HOST.TX_START,
      serializacao: 'chave=valor;… (latin1/encoding Destaxa no buffer Koffi)'
    },
    porta60906: {
      protocolo: 'V$Pague Background / VeSComm (TCP) — NÃO é HTTP',
      listen: 'V$Pague Client (ex.: PID 8740) em 0.0.0.0:60906',
      quemAbreConexaoCliente: 'DLL Destaxa (libdll-integracao-tef.dll) no processo Native Host — não o processo CDS principal',
      quemEncerraObservadoMrt24: 'Connection reset (127.0.0.1) no log Client — compatível com queda/abort do processo que abriu o socket (Native Host/DLL) antes do handshake/processamento completo',
      cdsAbre60906: false,
      evidenciaCodigo: 'Nenhuma referência a 60906 no stack Destaxa CDS; MRT-15: CDS não usa 60603/60906'
    },
    dadosTransmitidos: {
      ipcTxStartEnviadoAoHost: true,
      logTransacaoStartNoHost: true,
      evidênciaDllChamouIniciaTransacao: 'provável — log transacao.start ocorre imediatamente antes da chamada Koffi síncrona',
      evidênciaPayloadCompletoNoVsPague: false,
      evidênciaProcessamentoFinanceiroNoClient: false,
      nota: 'Conexão TCP chegou ao LISTEN 60906; reset imediato sugere que o enquadramento VeSComm/solicitação CRT não foi processado até o fim pelo Client'
    },
    erroDllAntesDaInterrupcao: {
      codigoDestaxaCapturado: null,
      throwKoffiCapturadoNoCds: false,
      txStartResultRecebido: false,
      conclusao: 'Sem retorno DLL capturado pelo CDS — não há evidência de código Destaxa (00/99/03/…) antes da interrupção'
    },
    pontoDeInterrupcao: {
      camadaMaisProvavel: 'Native Host / ciclo de vida do processo filho durante chamada DLL síncrona',
      naoExclui: ['falha interna da DLL ao falar com Background', 'abort do processo pai CDS derrubando o IPC'],
      evidenciaCriticaCodigo: {
        hostDisconnectExit: "DestaxaNativeHost.js: process.on('disconnect', () => process.exit(0))",
        clientUnrefChannel: 'DestaxaNativeHostClient spawner unref() + channel.unref()',
        efeito: 'Se o processo pai CDS encerra ou o canal IPC desconecta durante iniciaTransacaoDestaxa, o Host termina com exit(0) no meio da chamada Koffi → socket TCP com 60906 é resetado → V$Pague registra Connection reset → CDS não recebe TX_START_RESULT'
      },
      correlacaoMrt24: {
        transactionId: 'mrt24_5d70e3fb2328da54',
        nativeHostPid: 10952,
        vspaguePid: 8740,
        logsCds: ['transacao.real.driver.habilitado', 'transacao.start … CRT'],
        logsVsPague: '16:20:49 Connected 127.0.0.1:56138→60906; Connection reset',
        processoPai: 'encerrou ~5,6s sem gravar relatório completo no próprio runtime'
      }
    },
    ipcVsDllVsClient: {
      ipc: 'Funcionou até TX_START (ENABLE_REAL + START logados)',
      dll: 'Chamada síncrona iniciada; retorno não observado',
      vspagueClient: 'Aceitou TCP e resetou — sem log de autorização/NSU',
      classificacaoCamada: 'Interrupção entre Native Host/DLL e canal Background do Client (pós-IPC OK, pré-resultado financeiro)'
    },
    evidenciasTestesEstaticos: evidencias,
    causasConfirmadas: [
      'CDS não comunica diretamente com a porta 60906; quem conecta é a DLL no Native Host',
      'Protocolo local é Background/VeSComm TCP, não HTTP',
      'Parâmetros CRT do CDS para a DLL: operacao=CRT + entrada transacao_valor=1.00',
      'Native Host encerra com process.exit(0) ao receber disconnect do IPC pai',
      'MRT-24: TX_START enviado; TX_START_RESULT ausente; V$Pague Connection reset no mesmo intervalo'
    ],
    hipotesesNaoComprovadas: [
      'Qual sinal exato derrubou o processo pai CDS na MRT-24 (harness/Cursor/exceção não capturada)',
      'Se a DLL chegou a enviar frame VeSComm completo antes do reset',
      'Se houve crash nativo (AV) dentro da DLL distinto de exit(0) por disconnect',
      'Se INIT 00 da mesma sessão estabeleceu canal Background persistente ou só a CRT abriu o TCP'
    ],
    recomendacoesParaSprintCorrecao: [
      'Não fazer unref do channel IPC enquanto houver operação transacional em voo',
      'Não process.exit(0) no disconnect se houver chamada Koffi ativa — ou impedir disconnect do pai durante TX',
      'Garantir que o processo pai não encerre durante TX_START (checkpoint/flush + keep-alive explícito)',
      'Capturar exit code/signal do Host e correlacionar com Connection reset',
      'Somente após correção de ciclo de vida: nova CRT autorizada (não nesta sprint)'
    ],
    confirmacaoNenhumaOperacaoFinanceira: {
      gateOff: true,
      mensagem: 'MRT-25 somente leitura de código/logs e asserts estáticos — sem INIT/TX/ENABLE_REAL'
    },
    resultadoFinal: `MRT-25 CONCLUÍDA — ${classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  ${report.resultadoFinal}\n`);
}

main();
