/**
 * TEF-DESTAXA-07A — auditoria do fluxo real do PDV após a primeira tentativa.
 *
 * Não financeiro: bridge armadilha (qualquer chamada nativa falha o teste),
 * sdkDetector/configService stubados, banco oficial somente leitura.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada`);
  process.exit(2);
}
process.env[REAL_TRANSACTION_ENV] = '0';

const sqlite3 = require('sqlite3');
const RAIZ = path.resolve(__dirname, '../..');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-07a-auditoria-pdv-report.json');
const BANCO_OFICIAL = path.join(process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados'), 'mercadao.db');
const ADAPTER_REL = 'backend/services/tef/adapters/DestaxaRealAdapter.js';
const MSG_BLOQUEIO = 'Autorização financeira Destaxa bloqueada — use iniciarTransacao/continuarTransacao com mock nesta sprint';
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

let passou = 0;
let falhou = 0;
const falhas = [];
async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    falhas.push(nome);
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function git(args) {
  return String(spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).stdout || '');
}

/** Localiza a linha (1-based) de um trecho literal em um arquivo do working copy. */
function linha(rel, trecho) {
  const linhas = fs.readFileSync(path.join(RAIZ, rel), 'utf8').split(/\r?\n/);
  const i = linhas.findIndex((l) => l.includes(trecho));
  assert.ok(i >= 0, `${trecho} não encontrado em ${rel}`);
  return i + 1;
}

function linhaEm(texto, trecho) {
  const i = texto.split(/\r?\n/).findIndex((l) => l.includes(trecho));
  assert.ok(i >= 0, `${trecho} não encontrado`);
  return i + 1;
}

/** Bridge que registra e rejeita qualquer acesso a método: prova ausência de chamada nativa. */
function criarBridgeArmadilha() {
  const chamadas = [];
  const proxy = new Proxy({}, {
    get(_alvo, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return (...args) => {
        chamadas.push(String(prop));
        throw new Error(`bridge.${String(prop)} chamado durante auditoria`);
      };
    }
  });
  return { proxy, chamadas };
}

/** Compila o adapter da versão HEAD com os requires relativos do diretório real. */
function carregarAdapterHead() {
  const fonte = git(['show', `HEAD:${ADAPTER_REL}`]);
  assert.ok(fonte.includes(MSG_BLOQUEIO), 'mensagem ausente no adapter HEAD');
  const arquivo = path.join(RAIZ, ADAPTER_REL);
  const m = new Module(`${arquivo}#HEAD`, module);
  m.filename = arquivo;
  m.paths = Module._nodeModulePaths(path.dirname(arquivo));
  m._compile(fonte, arquivo);
  return { Adapter: m.exports, fonte };
}

async function consultarOficial() {
  const db = await new Promise((resolve, reject) => {
    const x = new sqlite3.Database(BANCO_OFICIAL, sqlite3.OPEN_READONLY, (e) => (e ? reject(e) : resolve(x)));
  });
  const todos = (sql) => new Promise((resolve, reject) => db.all(sql, [], (e, r) => (e ? reject(e) : resolve(r))));
  try {
    const transacoes = await todos(
      `SELECT id, venda_id, tipo, valor, parcelas, status, provedor, adquirente, nsu, autorizacao,
              codigo_transacao, codigo_resposta, idempotency_key, reversao_executada, criado_em, atualizado_em
         FROM tef_transacoes ORDER BY id`
    );
    const logs = await todos('SELECT id, transacao_id, tipo, mensagem, payload, criado_em FROM tef_logs WHERE transacao_id IS NOT NULL ORDER BY id');
    const [cfg] = await todos('SELECT ambiente, provedor, tentativas, atualizado_em FROM tef_configuracao ORDER BY id LIMIT 1');
    return { transacoes, logs, tefConfiguracao: cfg };
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
}

async function main() {
  console.log('\nTEF-DESTAXA-07A — auditoria do fluxo real do PDV\n');
  const evidencia = {};

  await test('gate: DESTAXA_REAL_TRANSACTION_ENABLED = OFF', () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  // ------------------------------------------------ cadeia no código
  const PDV = 'frontend/pdv/js/pdv.js';
  const cadeia = [
    { etapa: 'PDV — finalizar venda (fluxo A/B, Recebimento A)', arquivo: PDV, funcao: 'handler de finalização', linha: linha(PDV, 'await processarVendaFiscalNaoFiscal(dados, fluxoAB.valorA)'), parametros: 'dados, fluxoAB.valorA (= 1.00)' },
    { etapa: 'PDV — Recebimento A', arquivo: PDV, funcao: 'processarVendaFiscalNaoFiscal(dadosVenda, totalFiscal)', linha: linha(PDV, 'await processarPagamentoTEF(formaFiscal, totalFiscal, 1)'), parametros: 'formaFiscal = obterFormaPagamentoFiscal() → forma selecionada no PDV (pix)' },
    { etapa: 'PDV — forma → tipo TEF', arquivo: 'frontend/shared/js/tefFluxoPagamento.js', funcao: 'normalizarTipoTef', linha: linha('frontend/shared/js/tefFluxoPagamento.js', "return 'pix_tef';"), parametros: "'pix' → 'pix_tef'" },
    { etapa: 'PDV — mensagem "Gerando PIX TEF..."', arquivo: PDV, funcao: 'processarPagamentoTEF(tipo, valor, parcelas, opcoes)', linha: linha(PDV, "ehPixTef ? 'Gerando PIX TEF...'"), parametros: 'tipoTef = pix_tef → ehPixTef = true (notificação local, antes de qualquer chamada ao backend)' },
    { etapa: 'PDV → backend', arquivo: PDV, funcao: 'processarPagamentoTEF → fetch POST /api/tef/pagar', linha: linha(PDV, 'fetch(`${API_URL}/tef/pagar`'), parametros: '{ tipo: "pix_tef", valor: 1, parcelas: 1, venda_id: null, idempotency_key: "pdv-pix_tef-1.00-<ms>" }' },
    { etapa: 'Rota', arquivo: 'backend/rotas/tef.js', funcao: "router.post('/pagar')", linha: linha('backend/rotas/tef.js', 'await tefService.iniciarPagamento({'), parametros: 'venda_id, tipo, valor, parcelas, idempotency_key' },
    { etapa: 'Fachada TEF', arquivo: 'backend/services/tef/index.js', funcao: 'iniciarPagamento(dados)', linha: linha('backend/services/tef/index.js', 'await tefManager.autorizar(dados)'), parametros: 'dados' },
    { etapa: 'TefManager (versão carregada no processo = HEAD)', arquivo: 'backend/services/tef/TefManager.js@HEAD', funcao: 'TefManager.autorizar → criarTransacao(status pendente) → adapter.autorizarPagamento', linha: null, parametros: 'dadosNormalizados { tipo: pix_tef, valor: 1, parcelas: 1 }' },
    { etapa: 'Adapter (versão carregada no processo = HEAD)', arquivo: `${ADAPTER_REL}@HEAD`, funcao: 'DestaxaRealAdapter.autorizarPagamento()', linha: null, parametros: 'nenhum (assinatura sem parâmetros) — retorno constante DESTAXA_TRANSACAO_NAO_IMPLEMENTADA' },
    { etapa: 'Rota → HTTP 422', arquivo: 'backend/rotas/tef.js', funcao: "router.post('/pagar')", linha: linha('backend/rotas/tef.js', 'return res.status(422).json(resultado);'), parametros: 'sucesso=false, codigo presente, não aprovado' },
    { etapa: 'PDV — exibe a mensagem do backend', arquivo: PDV, funcao: 'processarPagamentoTEF (catch → showNotification(error.message))', linha: linha(PDV, "throw new Error(data.error || data.mensagem || 'Erro ao processar TEF.');"), parametros: '!response.ok → Error(data.mensagem) → retorna null' },
    { etapa: 'PDV — "Recebimento A não aprovado."', arquivo: PDV, funcao: 'processarVendaFiscalNaoFiscal', linha: linha(PDV, "throw new Error('Recebimento A não aprovado.');"), parametros: 'retorno === null (erro já tratado em processarPagamentoTEF)' }
  ];

  const { Adapter: AdapterHead, fonte: fonteHead } = carregarAdapterHead();
  const tefManagerHead = git(['show', 'HEAD:backend/services/tef/TefManager.js']);
  cadeia[7].linha = {
    autorizar: linhaEm(tefManagerHead, 'const adapter = await obterAdapter();'),
    criarTransacao: linhaEm(tefManagerHead, 'repository.criarTransacao({'),
    autorizarPagamento: linhaEm(tefManagerHead, 'await adapter.autorizarPagamento(dadosNormalizados)'),
    atualizarTransacao: linhaEm(tefManagerHead, 'repository.atualizarTransacao(transacaoId, {')
  };
  cadeia[8].linha = { autorizarPagamento: linhaEm(fonteHead, 'async autorizarPagamento()'), mensagem: linhaEm(fonteHead, MSG_BLOQUEIO) };

  // ------------------------------------------------ versão em execução
  const pid = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress"
  ], { encoding: 'utf8' });
  let processos = [];
  try { processos = [].concat(JSON.parse(pid.stdout || '[]')); } catch (_) { processos = []; }
  const principal = processos.find((p) => /electron\.exe"?\s+\.$/.test(String(p.CommandLine || '').trim())) || null;
  const inicioProcesso = principal ? new Date(Number(/\d+/.exec(principal.CreationDate)?.[0])) : null;
  const mtimes = Object.fromEntries([
    ADAPTER_REL, 'backend/services/tef/TefManager.js', 'backend/services/tef/destaxa/destaxaConstantes.js', 'backend/services/tef/tefFactory.js'
  ].map((rel) => [rel, fs.statSync(path.join(RAIZ, rel)).mtime.toISOString()]));
  evidencia.processoPdv = {
    pid: principal?.ProcessId || null,
    iniciadoEm: inicioProcesso ? inicioProcesso.toISOString() : null,
    comando: principal ? String(principal.CommandLine).trim() : null,
    modificacoesPosInicio: Object.fromEntries(Object.entries(mtimes).map(([k, v]) => [k, { mtime: v, posteriorAoInicio: inicioProcesso ? new Date(v) > inicioProcesso : null }]))
  };

  await test('mensagem de bloqueio existe somente no adapter HEAD (não no working copy) → processo do PDV usa módulo carregado antes das sprints 06B+', () => {
    assert.ok(!fs.readFileSync(path.join(RAIZ, ADAPTER_REL), 'utf8').includes(MSG_BLOQUEIO));
    assert.ok(fonteHead.includes(MSG_BLOQUEIO));
    if (inicioProcesso) assert.ok(new Date(mtimes[ADAPTER_REL]) > inicioProcesso, 'adapter não foi modificado após o início do processo');
  });

  // ------------------------------------------------ reprodução não financeira
  const armadilhaHead = criarBridgeArmadilha();
  const adapterHead = new AdapterHead({ provedor: 'destaxa', ambiente: 'homologacao' }, { bridge: armadilhaHead.proxy });
  const retornoHead = await adapterHead.autorizarPagamento({ tipo: 'pix_tef', valor: 1, parcelas: 1 });
  evidencia.reproducaoHead = { retorno: retornoHead, chamadasBridge: armadilhaHead.chamadas };
  await test('HEAD autorizarPagamento(pix_tef, 1.00): retorno constante idêntico ao log, 0 chamadas ao bridge/DLL', () => {
    assert.strictEqual(retornoHead.mensagem, MSG_BLOQUEIO);
    assert.strictEqual(retornoHead.codigo, 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA');
    assert.strictEqual(retornoHead.sucesso, false);
    assert.strictEqual(retornoHead.status, 'erro');
    assert.deepStrictEqual(armadilhaHead.chamadas, []);
  });

  const tefContrato = require('../../backend/services/tef/tefContrato');
  const api = tefContrato.paraRespostaApi({ ...retornoHead, transacaoId: '3' }, 3);
  const http = api.codigo === 'TRANSACAO_DUPLICADA' && !api.aprovado && api.sucesso !== true
    ? 409
    : (api.sucesso === false && api.codigo && !tefContrato.estaAprovado(api) ? 422 : 200);
  evidencia.respostaHttp = { status: http, corpo: { sucesso: api.sucesso, aprovado: api.aprovado, status: api.status, codigo: api.codigo, mensagem: api.mensagem, nsu: api.nsu } };
  await test('rota /tef/pagar responde 422 com a mensagem do adapter → PDV exibe a mensagem e depois "Recebimento A não aprovado."', () => {
    assert.strictEqual(http, 422);
    assert.strictEqual(api.aprovado, false);
    assert.strictEqual(api.mensagem, MSG_BLOQUEIO);
  });

  const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
  const armadilhaAtual = criarBridgeArmadilha();
  const detectorArmadilha = new Proxy({}, { get: (_a, p) => () => { throw new Error(`sdkDetector.${String(p)} chamado`); } });
  const adapterAtual = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao', porta: 'COM3' },
    { bridge: armadilhaAtual.proxy, sdkDetector: detectorArmadilha, configService: {} }
  );
  const retornoAtual = await adapterAtual.autorizarPagamento({ tipo: 'pix_tef', valor: 1, parcelas: 1 });
  evidencia.reproducaoAtual = { retorno: { sucesso: retornoAtual.sucesso, status: retornoAtual.status, codigo: retornoAtual.codigo, mensagem: retornoAtual.mensagem }, chamadasBridge: armadilhaAtual.chamadas };
  await test('código atual (após reinício do PDV): pix_tef bloqueado como DESTAXA_OPERACAO_NAO_PERMITIDA antes de DLL, PinPad e gate', () => {
    assert.strictEqual(retornoAtual.sucesso, false);
    assert.strictEqual(retornoAtual.codigo, 'DESTAXA_OPERACAO_NAO_PERMITIDA');
    assert.match(retornoAtual.mensagem, /PIX não permitida; somente CRT/);
    assert.deepStrictEqual(armadilhaAtual.chamadas, []);
  });

  // ------------------------------------------------ banco oficial
  const banco = await consultarOficial();
  const tentativas = banco.transacoes.filter((t) => t.tipo === 'pix_tef');
  const logsTentativas = banco.logs.filter((l) => tentativas.some((t) => t.id === l.transacao_id));
  evidencia.banco = {
    tefConfiguracao: banco.tefConfiguracao,
    totalTransacoes: banco.transacoes.length,
    pendentes: banco.transacoes.filter((t) => t.status === 'pendente').length,
    aprovadas: banco.transacoes.filter((t) => t.status === 'aprovado').length,
    tentativas,
    logs: logsTentativas.map((l) => ({ id: l.id, transacao_id: l.transacao_id, tipo: l.tipo, mensagem: l.mensagem, criado_em: l.criado_em }))
  };
  await test('banco: tentativas pix_tef com status erro, sem NSU/autorização/código Destaxa; nenhuma aprovada ou pendente', () => {
    assert.ok(tentativas.length > 0);
    for (const t of tentativas) {
      assert.strictEqual(t.status, 'erro');
      assert.strictEqual(Number(t.valor), 1);
      assert.strictEqual(t.nsu, null);
      assert.strictEqual(t.autorizacao, null);
      assert.strictEqual(t.codigo_resposta, null);
    }
    assert.strictEqual(evidencia.banco.pendentes, 0);
    assert.strictEqual(evidencia.banco.aprovadas, 0);
  });
  await test('logs: cada tentativa = INICIO → RETORNO (mensagem de bloqueio do adapter) → DECISAO_RETRY sem retry; nenhum log nativo', () => {
    for (const t of tentativas) {
      const tipos = logsTentativas.filter((l) => l.transacao_id === t.id).map((l) => l.tipo);
      assert.deepStrictEqual(tipos, ['INICIO', 'RETORNO', 'DECISAO_RETRY'], `transação ${t.id}`);
      const retorno = logsTentativas.find((l) => l.transacao_id === t.id && l.tipo === 'RETORNO');
      assert.strictEqual(retorno.mensagem, MSG_BLOQUEIO);
      const payload = JSON.parse(retorno.payload);
      assert.strictEqual(payload.codigo, 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA');
      assert.strictEqual(payload.nsu, null);
      assert.strictEqual(payload.retryAllowed, false);
    }
  });

  const aprovado = falhou === 0;
  const relatorio = {
    sprint: 'TEF-DESTAXA-07A',
    dataHora: new Date().toISOString(),
    transactionExecuted: false,
    A_fluxo: 'PDV finalizar venda (fluxo A/B) → processarVendaFiscalNaoFiscal → processarPagamentoTEF("pix" → "pix_tef", 1.00) → POST /api/tef/pagar → tefService.iniciarPagamento → TefManager.autorizar (HEAD) → repository.criarTransacao(pendente) → DestaxaRealAdapter.autorizarPagamento() (HEAD, retorno constante) → atualizarTransacao(status erro) → HTTP 422 → PDV notifica a mensagem → "Recebimento A não aprovado."',
    B_cadeia: cadeia,
    C_gerandoPixTef: { arquivo: PDV, funcao: 'processarPagamentoTEF', linha: cadeia[3].linha, origem: 'notificação local do PDV quando tipoTef === "pix_tef"; exibida antes da requisição, não indica comunicação com provider' },
    D_mensagemBloqueio: {
      arquivo: `${ADAPTER_REL} (versão HEAD, commit 336e648, carregada em memória no processo do PDV)`,
      funcao: 'DestaxaRealAdapter.autorizarPagamento()',
      linha: cadeia[8].linha,
      codigo: 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA',
      observacao: 'o texto não existe no working copy atual; o processo do PDV foi iniciado antes das alterações das sprints 06B–07-PREP e mantém o módulo antigo em cache'
    },
    E_motivoTrava: 'stub fixo da sprint TEF-DESTAXA-02/03: autorizarPagamento() sem parâmetros retorna sempre erro — não é o gate DESTAXA_REAL_TRANSACTION_ENABLED das sprints 06B/06C; nenhuma validação de operação/valor/DLL/PinPad foi executada',
    F_operacaoTentada: { tipo: 'pix_tef', operacaoDestaxaEquivalente: 'PIX', valor: 1.0, parcelas: 1, vendaId: null, provider: 'Destaxa', ambiente: banco.tefConfiguracao?.ambiente, adapter: 'DestaxaRealAdapter (modo real, versão HEAD)' },
    G_pixOuCrt: 'PIX TEF (forma de pagamento PIX selecionada no PDV); NÃO foi CRT',
    H_chamadaNativaReal: { houve: false, iniciaTransacaoDestaxa: 0, continuaTransacaoDestaxa: 0, finalizaTransacaoDestaxa: 0, prova: 'autorizarPagamento HEAD não referencia this.bridge; reproduzido com bridge armadilha (0 acessos); logs sem eventos nativos' },
    I_transactionId: { financeiroReal: null, nsu: null, idsInternosCds: tentativas.map((t) => t.id), observacao: 'ids internos de tef_transacoes criados pelo TefManager antes de chamar o adapter; não enviados à Destaxa' },
    J_registroBanco: { transacoesFinanceirasAprovadas: 0, pendentes: evidencia.banco.pendentes, registrosInternosDeTentativa: tentativas.map((t) => ({ id: t.id, status: t.status, valor: t.valor, criado_em: t.criado_em, idempotency_key: t.idempotency_key })) },
    K_comunicacaoPinPad: { houve: false, prova: 'caminho HEAD não chama bridge nem sdkDetector; tefEvents.emitirEstado(INSIRA_CARTAO) é evento interno de UI emitido pelo TefManager antes do adapter' },
    L_conclusao: 'BLOQUEADO PELO CDS (stub do adapter HEAD) — nenhuma chamada real iniciada; NÃO foi o gate 06B/06C',
    achados: [
      'O PDV em execução (npm start, electron.exe) iniciou antes das alterações de DestaxaRealAdapter/TefManager/destaxaConstantes; roda código HEAD e não o código certificado no 07-PREP. Reiniciar o aplicativo antes de qualquer próximo passo.',
      'A operação acionada foi PIX TEF (forma PIX no Recebimento A), não CRT; no código atual PIX é recusado com DESTAXA_OPERACAO_NAO_PERMITIDA antes de DLL/PinPad/gate.',
      `Foram registradas ${tentativas.length} tentativas internas (ids ${tentativas.map((t) => t.id).join(', ')}) com status 'erro' — cada clique gerou nova idempotency_key; nenhuma alcançou a Destaxa.`,
      'O fluxo normal do PDV usa TefManager.autorizar → adapter.autorizarPagamento; não usa iniciarTransacao/continuarTransacao e não tem UI para etapas 99 (DISPLAY/COLETA/OPÇÃO) — precisa ser tratado antes do 07-EXEC via PDV.',
      `tef_configuracao.tentativas = ${banco.tefConfiguracao?.tentativas} (07-EXEC exige 1).`,
      'Baseline do relatório 07-EXEC (0 transações) ficou desatualizado: agora há registros internos de tentativa (nenhum pendente).'
    ],
    evidencia,
    gate: { env: REAL_TRANSACTION_ENV, estado: transacaoRealHabilitada() ? 'ON' : 'OFF', removido: false },
    alteracoesFuncionais: 'nenhuma',
    tests: { passed: passou, failed: falhou, failures: falhas },
    result: aprovado ? 'READY_FOR_NEXT_TEF_STEP' : 'BLOCKED_WITH_FINDINGS'
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${path.relative(RAIZ, RELATORIO)} → ${relatorio.result}`);
  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(aprovado ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
