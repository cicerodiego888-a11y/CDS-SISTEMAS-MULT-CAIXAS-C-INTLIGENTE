/**
 * Sprint 07.9 — Simplificação do fluxo de emissão (UX/orquestração)
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint07-9.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fechamento-fiscal.js'), 'utf8');

const MOTOR_FISCAL_CANDIDATES = [
  'backend/services/fiscal/MotorFiscal.js',
  'backend/services/nfe/MotorFiscal.js',
  'backend/motor-fiscal',
  'backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'
];

function contextoEmissao(estadoInicial) {
  const sandbox = {
    console,
    Math,
    Number,
    Boolean,
    String,
    Array,
    Object,
    JSON,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    $: () => ({
      prop() { return this; },
      text() { return this; },
      on() { return this; },
      is() { return false; },
      val() { return ''; },
      length: 0
    }),
    bootstrap: {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    ffdApi: () => '',
    ffdHeaders: () => ({}),
    ffdNotify() {},
    ffdFmtMoney: (v) => `R$ ${Number(v || 0).toFixed(2)}`,
    ffdFmtDataBr: (d) => d,
    ffdEsc: (s) => String(s || ''),
    ffdErroApi: (b, f) => (b && b.error) || f,
    __ffdEstado: {
      fechamentoId: 4,
      data: '2026-09-13',
      previa: {
        valor_distribuido: 44,
        valor_informado: 44,
        perfeita: true,
        vendas: [{ sequencia: 1 }],
        quantidade_vendas: 1
      },
      recebimentos: [{ valor: 44, operadora: 'Mercado pago' }],
      resumo: { valor_fiscal_elegivel: 0 },
      validacao: null,
      documentos: [],
      statusFiscal: 'PREVIA',
      moduloOn: true,
      ambiente: 1,
      transmissaoHabilitada: true,
      diagnosticoTx: { ok: true },
      transmitindo: false,
      ops: { previa: false, validar: false, preparar: false, salvar: false, transmitir: false, emitir: false },
      ...(estadoInicial || {})
    }
  };

  // Extrai funções necessárias do frontend via vm parcial.
  const extrair = (nome) => {
    const re = new RegExp(`function ${nome}\\([\\s\\S]*?\\n\\}`);
    const m = FRONT.match(re);
    if (!m) throw new Error(`Função não encontrada: ${nome}`);
    return m[0];
  };

  const deps = [
    'function ffdTotalRecebimentos() { return (__ffdEstado.recebimentos || []).reduce((s, r) => s + Number(r.valor || 0), 0); }',
    extrair('ffdValorReferenciaConciliacao'),
    extrair('ffdDiferencaConciliacao'),
    extrair('ffdRecebimentosConciliados'),
    extrair('ffdPreviaValida'),
    extrair('ffdBloqueioAvanco'),
    extrair('ffdMotivosBloqueioEmissao')
  ].join('\n');

  vm.runInNewContext(`${deps}\nthis.out = {
    ffdRecebimentosConciliados,
    ffdPreviaValida,
    ffdBloqueioAvanco,
    ffdMotivosBloqueioEmissao,
    ffdDiferencaConciliacao,
    estado: __ffdEstado
  };`, sandbox);

  return sandbox.out;
}

describe('Sprint 07.9 — simplificação UX emissão', () => {
  it('01 — tela principal mostra Emitir fechamento e esconde etapas técnicas do fluxo principal', () => {
    assert.match(FRONT, /id="ffdBtnEmitir"/);
    assert.match(FRONT, /Emitir fechamento/);
    assert.match(FRONT, /function ffdEmitirFechamento/);
    assert.match(FRONT, /ffdDetalhesTecnicos/);
    assert.match(FRONT, /Está tudo certo\. Pode emitir/);
    assert.match(FRONT, /Não é possível emitir ainda/);
    // Botões técnicos permanecem (suporte), mas dentro de detalhes
    const idxEmitir = FRONT.indexOf('id="ffdBtnEmitir"');
    const idxDetalhes = FRONT.indexOf('id="ffdDetalhesTecnicos"');
    const idxValidar = FRONT.indexOf('id="ffdBtnValidar"');
    const idxTransmitir = FRONT.indexOf('id="ffdBtnTransmitir"');
    assert.ok(idxEmitir > 0 && idxDetalhes > idxEmitir, 'Emitir deve vir antes dos detalhes técnicos');
    assert.ok(idxValidar > idxDetalhes, 'Validar fiscal deve estar na área técnica');
    assert.ok(idxTransmitir > idxDetalhes, 'Transmitir deve estar na área técnica');
    assert.match(FRONT, /Validar fiscal/);
    assert.match(FRONT, /Gerar XML/);
    assert.match(FRONT, /Preparar para emissão/);
    assert.match(FRONT, /Transmitir para SEFAZ/);
  });

  it('02 — Emitir orquestra validação, preparação/XML e só transmite após confirmação', () => {
    assert.match(FRONT, /ffdExecutarValidacaoCore/);
    assert.match(FRONT, /ffdExecutarPreparacaoCore/);
    assert.match(FRONT, /gerarXml:\s*true/);
    assert.match(FRONT, /ffdConfirmarEmissaoModal/);
    assert.match(FRONT, /ffdTransmitirSefaz\(\{\s*confirmado:\s*true\s*\}\)/);
    assert.match(FRONT, /Confirmar emissão/);
    assert.match(FRONT, /Emitir fechamento fiscal\?/);
    assert.match(FRONT, /Esta emissão será transmitida para a SEFAZ em PRODUÇÃO/);
    // Não transmite só por abrir tela / prévia
    assert.doesNotMatch(FRONT, /ffdCarregarDia[\s\S]{0,400}ffdTransmitirSefaz\(/);
    assert.doesNotMatch(FRONT, /ffdRenderPrevia[\s\S]{0,200}ffdTransmitirSefaz\(/);
  });

  it('03 — endpoints e máquina de estados do backend permanecem', () => {
    assert.match(ROTA, /\/validar/);
    assert.match(ROTA, /preparar-emissao/);
    assert.match(ROTA, /\/transmitir/);
    assert.match(ROTA, /\/recuperar/);
    assert.doesNotMatch(ROTA, /ffdEmitirFechamento/);
  });

  it('04 — fechamento #4 R$44/R$44 fica apto (sem bloqueio de conciliação)', () => {
    const ctx = contextoEmissao();
    assert.equal(ctx.ffdRecebimentosConciliados(), true);
    assert.equal(ctx.ffdPreviaValida(), true);
    assert.equal(ctx.ffdDiferencaConciliacao(), 0);
    assert.equal(ctx.ffdBloqueioAvanco('emitir'), null);
    const motivos = Array.from(ctx.ffdMotivosBloqueioEmissao()).filter((m) => !/já autorizado/i.test(m));
    assert.equal(motivos.length, 0);
  });

  it('05 — erro em etapa interrompe e não chama transmissão sem confirmação', () => {
    assert.match(FRONT, /if\s*\(!val\.ok\)/);
    assert.match(FRONT, /if\s*\(!prep\.ok\)/);
    assert.match(FRONT, /if\s*\(!confirmado\)/);
    assert.match(FRONT, /Nenhuma transmissão foi enviada/);
    assert.match(FRONT, /confirmado:\s*true/);
    // transmissão real só via endpoint oficial
    assert.match(FRONT, /fiscal\/fechamentos\/\$\{id\}\/transmitir/);
  });

  it('06 — Salvar rascunho e Recuperar SEFAZ não são ações principais', () => {
    const idxEmitir = FRONT.indexOf('id="ffdBtnEmitir"');
    const idxSalvar = FRONT.indexOf('id="ffdBtnSalvarRascunho"');
    const idxRecuperar = FRONT.indexOf('id="ffdBtnRecuperar"');
    const idxDetalhes = FRONT.indexOf('id="ffdDetalhesTecnicos"');
    assert.ok(idxSalvar > idxDetalhes, 'Salvar rascunho na área técnica');
    assert.ok(idxRecuperar > idxDetalhes, 'Recuperar SEFAZ na área técnica');
    assert.ok(idxEmitir < idxDetalhes);
  });

  it('07 — polling e recuperação 539 / Motor Fiscal fora do escopo de alteração deste sprint', () => {
    assert.match(FRONT, /silencioso:\s*true/);
    assert.match(FRONT, /!__ffdEstado\.previa/);
    assert.match(FRONT, /!\(__ffdEstado\.recebimentos \|\| \[\]\)\.length/);
    assert.doesNotMatch(FRONT, /enviarAutorizacao|assinarNFe|autorizarNFe/);
    // Serviço 539 não deve ser reescrito neste arquivo de UX
    const recup = path.join(ROOT, 'backend/services/fechamento-fiscal/NfceDuplicidadeRecuperacaoService.js');
    assert.ok(fs.existsSync(recup));
    assert.match(FRONT, /recuperar-duplicidades/);
  });

  it('08 — não altera estoque/financeiro/vendas/NFC-e por esta UX', () => {
    assert.doesNotMatch(FRONT, /UPDATE\s+estoque|INSERT\s+INTO\s+vendas|UPDATE\s+financeiro/i);
    assert.match(FRONT, /sem baixa estoque|Monitoramento diário \+ prévia/i);
  });
});
