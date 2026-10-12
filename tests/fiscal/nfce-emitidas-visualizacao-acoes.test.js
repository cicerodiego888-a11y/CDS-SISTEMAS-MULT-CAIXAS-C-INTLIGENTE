/**
 * NFC-e Emitidas — visualização e ações da listagem (ReferenceError viewVenda).
 * Executar: node --test tests/fiscal/nfce-emitidas-visualizacao-acoes.test.js
 *
 * Frontend: fiscal.js executado em contexto vm com DOM mínimo (sem vendas.js pré-carregado,
 * como na tela real). Backend: GET /vendas/:id em SQLite temporário. Sem SEFAZ.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-nfce-emitidas-'));
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = path.join(tmpBase, 'db');
process.env.FISCAL_DIR = path.join(tmpBase, 'fiscal');
fs.mkdirSync(process.env.DB_DIR, { recursive: true });

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '../..');
const FISCAL_SRC = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
const MANIFEST_VENDAS = [
  '/shared/js/cupomPrintPolicy.js',
  '/shared/js/fiscalImpressao.js',
  '/shared/js/vendasHistoricoUi.js',
  '/erp/js/vendas.js'
];

const aguardar = () => new Promise((r) => setTimeout(r, 15));

function criarTela({ vendas = {}, loader = true } = {}) {
  const registro = {
    listeners: [], notificacoes: [], fetches: [], modais: [], resumos: [],
    detalhesFiscais: [], xmls: [], cancelDocumentos: [], avaliacoesAbertas: [], scripts: []
  };
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout,
    API_URL: '/api',
    localStorage: { getItem: () => 'token-teste' },
    document: {
      addEventListener(type, fn) { registro.listeners.push({ type, fn }); }
    },
    showNotification(msg, tipo) { registro.notificacoes.push({ msg, tipo }); },
    async fetch(url, opts = {}) {
      registro.fetches.push({ url, method: String(opts.method || 'GET').toUpperCase() });
      const mVenda = url.match(/^\/api\/vendas\/(\d+)$/);
      if (mVenda) {
        const v = vendas[mVenda[1]];
        if (v === undefined) {
          return { ok: false, status: 404, json: async () => ({ error: `Venda #${mVenda[1]} não encontrada.` }) };
        }
        return { ok: true, status: 200, json: async () => v };
      }
      const mAval = url.match(/^\/api\/vendas\/(\d+)\/cancelamento\/avaliacao$/);
      if (mAval) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ venda_id: Number(mAval[1]), cancelar_nfce: false, cancelar_venda_permitido: true, bloqueio: null })
        };
      }
      return { ok: false, status: 500, json: async () => ({ error: 'rota inesperada no teste' }) };
    }
  };
  ctx.window = ctx;
  if (loader) {
    ctx.CdsErpLazyLoader = {
      manifest: { vendas: MANIFEST_VENDAS },
      async loadFeatureScript(src) {
        registro.scripts.push(src);
        if (src === '/erp/js/vendas.js') {
          ctx.showVendaModal = (venda) => registro.modais.push(venda);
          ctx.verResumoVendaFiscalTEF = (id) => registro.resumos.push(id);
        }
      }
    };
  }
  vm.createContext(ctx);
  vm.runInContext(FISCAL_SRC, ctx, { filename: 'fiscal.js' });
  ctx.verDetalheFiscal = (id) => registro.detalhesFiscais.push(id);
  ctx.visualizarXmlNfce = (id) => registro.xmls.push(id);
  ctx.cancelarDocumentoFiscalNfce = (id) => registro.cancelDocumentos.push(id);
  ctx.abrirModalCancelamentoVendaNfce = (vendaId, av) => registro.avaliacoesAbertas.push({ vendaId, av });

  const botoes = (nota) => {
    const html = ctx.montarHtmlAcoesNfceEmitida(nota);
    return [...html.matchAll(/<button[^>]*data-nfce-acao="([^"]+)"[^>]*>/g)].map((m) => {
      const tag = m[0];
      const attr = (nome) => {
        const r = tag.match(new RegExp(`${nome}="([^"]*)"`));
        return r ? r[1] : null;
      };
      return { acao: m[1], tag, getAttribute: attr };
    });
  };

  const clicar = async (botao) => {
    const click = registro.listeners.find((l) => l.type === 'click');
    click.fn({ target: { closest: () => botao }, preventDefault() {} });
    await aguardar();
  };

  return { ctx, registro, botoes, clicar };
}

const NOTA_VENDA_16 = { id: 4, venda_id: 16, venda_codigo: 'V-16', status: 'rejeitada' };
const NOTA_VENDA_21 = { id: 5, venda_id: 21, venda_codigo: 'V-21', status: 'autorizada' };
const NOTA_FECHAMENTO = { id: 9, venda_id: null, origem: 'fechamento_fiscal_dia', fechamento_fiscal_id: 3, status: 'autorizada' };

describe('NFC-e Emitidas — visualização (frontend)', () => {
  it('01 — visualizar pela listagem sem ReferenceError (vendas.js não carregado)', async () => {
    const { ctx, registro, botoes, clicar } = criarTela({ vendas: { 16: { id: 16, codigo: 'V-16' } } });
    assert.equal(typeof ctx.viewVenda, 'undefined');
    assert.equal(typeof ctx.showVendaModal, 'undefined');
    assert.equal(registro.listeners.filter((l) => l.type === 'click').length, 1);

    const olho = botoes(NOTA_VENDA_16).find((b) => b.acao === 'detalhe');
    await clicar(olho);

    assert.deepEqual(registro.scripts, MANIFEST_VENDAS);
    assert.deepEqual(registro.modais.map((v) => v.id), [16]);
    assert.equal(registro.notificacoes.length, 0, JSON.stringify(registro.notificacoes));
  });

  it('02 — cada botão carrega o documento correto (venda × NFC-e sem confundir IDs)', async () => {
    const { registro, botoes, clicar } = criarTela({
      vendas: { 16: { id: 16 }, 21: { id: 21 } }
    });
    for (const b of botoes(NOTA_VENDA_21).filter((x) => x.acao === 'detalhe')) await clicar(b);
    for (const b of botoes(NOTA_VENDA_16).filter((x) => x.acao === 'detalhe')) await clicar(b);
    for (const b of botoes(NOTA_FECHAMENTO).filter((x) => x.acao === 'detalhe')) await clicar(b);

    assert.deepEqual(registro.modais.map((v) => v.id), [21, 21, 16, 16]);
    assert.deepEqual(registro.fetches.map((f) => f.url), ['/api/vendas/21', '/api/vendas/21', '/api/vendas/16', '/api/vendas/16']);
    assert.deepEqual(registro.detalhesFiscais, [9, 9], 'NFC-e sem venda abre o detalhe fiscal pelo ID da NFC-e');

    const xml = botoes(NOTA_VENDA_16).find((b) => b.acao === 'xml');
    await clicar(xml);
    assert.deepEqual(registro.xmls, [4], 'XML usa o ID da NFC-e, não o da venda');
  });

  it('03 — venda inexistente: mensagem amigável e nenhum modal', async () => {
    const { registro, botoes, clicar } = criarTela({ vendas: {} });
    await clicar(botoes({ id: 7, venda_id: 99, status: 'rejeitada' }).find((b) => b.acao === 'detalhe'));
    assert.equal(registro.modais.length, 0);
    assert.equal(registro.notificacoes.length, 1);
    assert.equal(registro.notificacoes[0].msg, 'Venda #99 vinculada à NFC-e #7 não foi encontrada.');
    assert.equal(registro.notificacoes[0].tipo, 'warning');
  });

  it('04 — resposta de outra venda é rejeitada (não exibe documento trocado)', async () => {
    const { registro, botoes, clicar } = criarTela({ vendas: { 16: { id: 61 } } });
    await clicar(botoes(NOTA_VENDA_16).find((b) => b.acao === 'detalhe'));
    assert.equal(registro.modais.length, 0);
    assert.match(registro.notificacoes[0].msg, /esperada venda #16, recebida #61/);
  });

  it('05 — carregador indisponível: mensagem clara, sem exceção', async () => {
    const { registro, botoes, clicar } = criarTela({ vendas: { 16: { id: 16 } }, loader: false });
    await clicar(botoes(NOTA_VENDA_16).find((b) => b.acao === 'detalhe'));
    assert.equal(registro.modais.length, 0);
    assert.match(registro.notificacoes[0].msg, /Não foi possível abrir os detalhes da venda: Carregador de módulos do ERP indisponível/);
  });

  it('06 — visualizar só lê (GET), sem nenhuma requisição de escrita', async () => {
    const { registro, botoes, clicar } = criarTela({ vendas: { 16: { id: 16 }, 21: { id: 21 } } });
    for (const n of [NOTA_VENDA_16, NOTA_VENDA_21]) {
      for (const b of botoes(n).filter((x) => ['detalhe', 'xml'].includes(x.acao))) await clicar(b);
    }
    assert.ok(registro.fetches.length > 0);
    assert.ok(registro.fetches.every((f) => f.method === 'GET'), JSON.stringify(registro.fetches));
  });

  it('07 — Resumo NFC-e / TEF carrega o módulo e usa a venda correta', async () => {
    const { registro, botoes, clicar } = criarTela();
    await clicar(botoes(NOTA_VENDA_21).find((b) => b.acao === 'resumo'));
    assert.deepEqual(registro.resumos, [21]);
    assert.equal(registro.notificacoes.length, 0);
  });

  it('08 — Cancelar venda × Cancelar documento fiscal: fluxos separados', async () => {
    const { registro, botoes, clicar } = criarTela();
    const cancelVenda = botoes(NOTA_VENDA_16).find((b) => b.acao === 'cancelar-venda');
    assert.ok(cancelVenda, 'NFC-e com venda exibe Cancelar venda');
    assert.equal(botoes(NOTA_VENDA_16).some((b) => b.acao === 'cancelar-documento'), false);
    await clicar(cancelVenda);
    assert.deepEqual(registro.fetches.map((f) => `${f.method} ${f.url}`), ['GET /api/vendas/16/cancelamento/avaliacao']);
    assert.equal(registro.avaliacoesAbertas[0].vendaId, 16);
    assert.equal(registro.cancelDocumentos.length, 0);

    const cancelDoc = botoes(NOTA_FECHAMENTO).find((b) => b.acao === 'cancelar-documento');
    assert.ok(cancelDoc, 'NFC-e do fechamento exibe Cancelar documento fiscal');
    assert.equal(botoes(NOTA_FECHAMENTO).some((b) => b.acao === 'cancelar-venda'), false);
    await clicar(cancelDoc);
    assert.deepEqual(registro.cancelDocumentos, [9]);
    assert.equal(registro.avaliacoesAbertas.length, 1);
  });

  it('09 — NFC-e cancelada não oferece cancelamento', () => {
    const { botoes } = criarTela();
    const acoes = botoes({ ...NOTA_VENDA_21, status: 'cancelada' }).map((b) => b.acao);
    assert.equal(acoes.includes('cancelar-venda'), false);
    assert.equal(acoes.includes('cancelar-documento'), false);
    assert.ok(acoes.includes('detalhe'));
  });

  it('10 — listagem não usa onclick inline nem referencia viewVenda', () => {
    const inicio = FISCAL_SRC.indexOf('function montarHtmlAcoesNfceEmitida');
    const fim = FISCAL_SRC.indexOf('function acaoNfceEmitidaExigirVenda');
    const bloco = FISCAL_SRC.slice(inicio, fim);
    assert.ok(inicio > 0 && fim > inicio);
    assert.doesNotMatch(bloco, /onclick=/);
    assert.doesNotMatch(FISCAL_SRC, /viewVenda\(/);
  });
});

describe('GET /vendas/:id — leitura sem efeitos colaterais (backend)', () => {
  let db;
  let request;
  let app;

  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve(this); });
  });

  async function fotografia() {
    const tabelas = ['vendas', 'vendas_itens', 'produtos', 'venda_recebimentos', 'venda_pagamentos',
      'nfce_notas', 'fiscal_numeracao', 'contas_receber', 'financeiro_movimentacoes', 'caixa_movimentacoes'];
    const existentes = new Set((await all(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name));
    const foto = {};
    for (const t of tabelas) {
      if (existentes.has(t)) foto[t] = await all(`SELECT * FROM ${t} ORDER BY rowid`);
    }
    return foto;
  }

  before(async () => {
    db = require('../../backend/database');
    await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
    request = require('supertest');
    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/vendas', require('../../backend/rotas/vendas'));

    for (let i = 0; i < 100; i += 1) {
      const flag = await all(`SELECT valor FROM configuracoes WHERE chave = 'migracao_recalc_saldos_estoque_v1'`);
      if (flag[0] && flag[0].valor === '1') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await run(`INSERT INTO produtos (id, codigo, nome, nome_busca, unidade, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal)
               VALUES (501, 'P501', 'PRODUTO 501', 'produto501', 'UN', 10, 5, 5, 0)`);
    for (const id of [16, 21]) {
      await run(`INSERT INTO vendas (id, codigo, data_venda, total, forma_pagamento, status)
                 VALUES (?, ?, date('now'), 10, 'dinheiro', 'concluida')`, [id, `V-${id}`]);
      await run(`INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
                 VALUES (?, 501, 1, 10, 10)`, [id]);
    }
    await run(`INSERT INTO nfce_notas (venda_id, numero, serie, ambiente, status, xml_retorno)
               VALUES (16, 10004, 1, 2, 'rejeitada', '<cStat>462</cStat>')`);
  });

  after(() => { db.close(() => {}); });

  it('11 — cada ID retorna a própria venda; inexistente retorna 404 com mensagem; nada é alterado', async () => {
    const antes = await fotografia();

    const r16 = await request(app).get('/vendas/16');
    assert.equal(r16.status, 200, JSON.stringify(r16.body));
    assert.equal(r16.body.id, 16);
    assert.equal(r16.body.nfce_numero, 10004);
    assert.equal(r16.body.nfce_status, 'rejeitada');

    const r21 = await request(app).get('/vendas/21');
    assert.equal(r21.status, 200);
    assert.equal(r21.body.id, 21);

    const r99 = await request(app).get('/vendas/99999');
    assert.equal(r99.status, 404);
    assert.equal(r99.body.error, 'Venda #99999 não encontrada.');

    assert.deepEqual(await fotografia(), antes, 'venda, itens, estoque, recebimentos, NFC-e e numeração inalterados');
  });
});
