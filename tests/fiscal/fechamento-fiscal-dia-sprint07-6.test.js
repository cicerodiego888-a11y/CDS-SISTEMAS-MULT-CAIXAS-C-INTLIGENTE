/**
 * Sprint 07.6 — Classificação Fiscal Canônica NFC-e
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint07-6.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sqlite3 = require('sqlite3');

const {
  SITUACAO_NFCE,
  classificarSituacaoFiscalNfce,
  classificarSituacoesFiscaisPorVenda,
  listarLotesElegiveisDoDia,
  obterResumoDia,
  gerarPreviaDistribuicao
} = require('../../backend/services/fechamento-fiscal');

const ROOT = path.join(__dirname, '../..');
const CLASSIFICADOR_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/NfceSituacaoFiscalService.js'),
  'utf8'
);
const HISTORICO_SRC = fs.readFileSync(
  path.join(ROOT, 'frontend/shared/js/vendasHistoricoUi.js'),
  'utf8'
);
const ERP_SRC = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/vendas.js'), 'utf8');
const PDV_SRC = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/vendas.js'), 'utf8');
const PDV_PRINCIPAL_SRC = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const FFD_SRC = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const TEF_ROTA_SRC = fs.readFileSync(path.join(ROOT, 'backend/rotas/tef.js'), 'utf8');

function openDb(file, mode) {
  return new Promise((resolve, reject) => {
    const callback = (err) => (err ? reject(err) : resolve(db));
    const db = mode == null
      ? new sqlite3.Database(file, callback)
      : new sqlite3.Database(file, mode, callback);
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function xmlRetorno(cStat, protocolo) {
  const prot = protocolo ? `<nProt>${protocolo}</nProt>` : '';
  return `<retEnviNFe><protNFe><infProt><cStat>${cStat}</cStat>${prot}</infProt></protNFe></retEnviNFe>`;
}

function nota(overrides = {}) {
  return {
    id: 1,
    venda_id: 1,
    numero: 10,
    serie: 1,
    ambiente: 1,
    status: 'pendente',
    chave_acesso: '23260968645756000121650010000000101000000010',
    protocolo: null,
    xml_retorno: null,
    ...overrides
  };
}

function historicoContext() {
  const context = {
    console,
    formatCurrency: (n) => `R$ ${Number(n).toFixed(2)}`,
    fiscalHabilitado: () => true
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(HISTORICO_SRC, context);
  return context;
}

async function criarSchema(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, item_fiscal INTEGER,
    preco_venda REAL, preco_compra REAL, saldo_fiscal REAL, saldo_nao_fiscal REAL
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, codigo TEXT, data_venda TEXT, total REAL,
    valor_fiscal REAL, valor_nao_fiscal REAL, status TEXT, cancelada INTEGER DEFAULT 0,
    empresa_id INTEGER
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
    quantidade REAL, quantidade_fiscal REAL, quantidade_nao_fiscal REAL,
    subtotal REAL, valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
  )`);
  await run(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER,
    produto_id INTEGER, quantidade REAL, valor_total REAL
  )`);
  await run(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER NOT NULL,
    numero INTEGER NOT NULL, serie INTEGER NOT NULL, chave_acesso TEXT,
    ambiente INTEGER DEFAULT 2, status TEXT, xml_enviado TEXT, xml_retorno TEXT,
    protocolo TEXT, recibo TEXT, qr_code_url TEXT, danfe_html TEXT,
    created_at TEXT, updated_at TEXT
  )`);
  await run(db, `CREATE TABLE financeiro (
    id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT
  )`);
  await run(db, `CREATE TABLE vendas_pagamentos (
    id INTEGER PRIMARY KEY, venda_id INTEGER, valor REAL, forma TEXT
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, data_fechamento TEXT, status TEXT
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_previa_itens (
    id INTEGER PRIMARY KEY, fechamento_fiscal_id INTEGER, venda_item_origem_id INTEGER,
    quantidade REAL
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_recebimentos (
    id INTEGER PRIMARY KEY, fechamento_fiscal_id INTEGER, operadora TEXT, valor REAL
  )`);
}

async function inserirVenda(db, id, data, valor, empresaId = 1) {
  await run(
    db,
    `INSERT INTO vendas
      (id,codigo,data_venda,total,valor_fiscal,valor_nao_fiscal,status,cancelada,empresa_id)
     VALUES (?,?,?,?,?,0,'concluida',0,?)`,
    [id, `V${id}`, data, valor, valor, empresaId]
  );
  await run(
    db,
    `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,
       subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
     VALUES (?,?,1,1,1,0,?,?,0,?)`,
    [id, id, valor, valor, valor]
  );
}

describe('Sprint 07.6 — classificação fiscal canônica NFC-e', { concurrency: false }, () => {
  let dir;
  let db;
  let contextoHistorico;
  let snapshotAntes;
  const DATA = '2026-09-13';
  const DATA_44 = '2026-09-14';

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s076-'));
    db = await openDb(path.join(dir, 'sprint07-6.db'));
    await criarSchema(db);
    await run(db, `INSERT INTO produtos
      (id,nome,codigo,item_fiscal,preco_venda,preco_compra,saldo_fiscal,saldo_nao_fiscal)
      VALUES (1,'Produto fiscal','P1',1,10,5,100,50)`);

    for (let id = 1; id <= 7; id += 1) await inserirVenda(db, id, DATA, 10, id === 7 ? 2 : 1);

    await run(db, `INSERT INTO nfce_notas
      (venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno,protocolo)
      VALUES (1,1,1,'23260968645756000121650010000000011000000010',1,'autorizada',?,'123456789012345')`,
    [xmlRetorno('100', '123456789012345')]);
    await run(db, `INSERT INTO nfce_notas
      (venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno)
      VALUES (2,2,1,'23260968645756000121650010000000021000000020',1,'rejeitada',?)`,
    [xmlRetorno('462')]);
    await run(db, `INSERT INTO nfce_notas
      (venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno)
      VALUES (3,3,1,'23260968645756000121650010000000031000000030',1,'rejeitada_duplicidade',?)`,
    [xmlRetorno('539')]);
    await run(db, `INSERT INTO nfce_notas
      (venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno,protocolo)
      VALUES (4,4,1,'23260968645756000121650010000000041000000040',1,'cancelada',?, '444444444444444')`,
    [`${xmlRetorno('100', '444444444444444')}<retEvento><infEvento><cStat>135</cStat></infEvento></retEvento>`]);
    await run(db, `INSERT INTO nfce_notas
      (venda_id,numero,serie,chave_acesso,ambiente,status)
      VALUES (6,6,1,'23260968645756000121650010000000061000000060',1,'')`);
    await run(db, `INSERT INTO nfce_notas
      (venda_id,numero,serie,chave_acesso,ambiente,status)
      VALUES (7,7,1,'23260968645756000121650010000000071000000070',1,'estado_novo')`);

    const valores44 = [3, 4, 8, 8, 8, 13];
    for (let i = 0; i < valores44.length; i += 1) {
      await inserirVenda(db, 101 + i, DATA_44, valores44[i]);
    }
    await run(db, `INSERT INTO fechamentos_fiscais_recebimentos
      (id,fechamento_fiscal_id,operadora,valor) VALUES (1,76,'Mercado Pago',44)`);
    await run(db, `INSERT INTO financeiro (id,valor,descricao,tipo,origem)
      VALUES (1,44,'snapshot','receita','pdv')`);
    await run(db, `INSERT INTO vendas_pagamentos (id,venda_id,valor,forma)
      VALUES (1,101,3,'pix')`);

    contextoHistorico = historicoContext();
    snapshotAntes = {
      estoque: await get(db, `SELECT saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id=1`),
      financeiro: await get(db, `SELECT COUNT(*) n, SUM(valor) total FROM financeiro`),
      vendas: await get(db, `SELECT COUNT(*) n, SUM(total) total FROM vendas`),
      pagamentos: await get(db, `SELECT COUNT(*) n, SUM(valor) total FROM vendas_pagamentos`)
    };
  });

  after(async () => {
    if (db) await closeDb(db);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('01 — NFC-e autorizada exige status, cStat e protocolo', () => {
    const c = classificarSituacaoFiscalNfce(nota({
      status: 'autorizada',
      protocolo: '123456789012345',
      xml_retorno: xmlRetorno('100', '123456789012345')
    }));
    assert.equal(c.situacao, SITUACAO_NFCE.AUTORIZADA);
    assert.equal(c.documentada, true);
  });

  it('02 — NFC-e rejeitada não é autorização', () => {
    const c = classificarSituacaoFiscalNfce(nota({ status: 'rejeitada', xml_retorno: xmlRetorno('462') }));
    assert.equal(c.situacao, SITUACAO_NFCE.REJEITADA);
    assert.equal(c.documentada, false);
  });

  it('03 — cStat 539 fica em duplicidade pendente', () => {
    const c = classificarSituacaoFiscalNfce(nota({ status: 'rejeitada_duplicidade', xml_retorno: xmlRetorno('539') }));
    assert.equal(c.situacao, SITUACAO_NFCE.DUPLICIDADE_PENDENTE);
    assert.equal(c.exige_recuperacao, true);
    assert.equal(c.permite_decisao_automatica, false);
  });

  it('04 — autorização cancelada permanece classificada como cancelada', () => {
    const c = classificarSituacaoFiscalNfce(nota({
      status: 'cancelada',
      protocolo: '123',
      xml_retorno: `${xmlRetorno('100', '123')}<retEvento><cStat>135</cStat></retEvento>`
    }));
    assert.equal(c.situacao, SITUACAO_NFCE.CANCELADA);
    assert.equal(c.documentada, false);
  });

  it('05 — ausência de linha resulta em SEM_DOCUMENTO', () => {
    assert.equal(classificarSituacaoFiscalNfce([]).situacao, SITUACAO_NFCE.SEM_DOCUMENTO);
  });

  it('06 — status vazio não vira autorização', () => {
    assert.equal(classificarSituacaoFiscalNfce(nota({ status: '' })).situacao, SITUACAO_NFCE.DESCONHECIDA);
  });

  it('07 — status desconhecido não vira autorização', () => {
    assert.equal(classificarSituacaoFiscalNfce(nota({ status: 'estado_novo' })).situacao, SITUACAO_NFCE.DESCONHECIDA);
    assert.equal(classificarSituacaoFiscalNfce(nota({ status: 'pendente' })).situacao, SITUACAO_NFCE.PENDENTE);
    assert.equal(classificarSituacaoFiscalNfce(nota({ status: 'erro_transmissao' })).situacao, SITUACAO_NFCE.ERRO);
    assert.equal(classificarSituacaoFiscalNfce(nota({ status: 'autorizada' })).situacao, SITUACAO_NFCE.DESCONHECIDA);
  });

  it('08 — Histórico autorizado exibe somente NFC-e verde', () => {
    const html = contextoHistorico.montarBadgeNfceHistorico({ nfce_situacao_fiscal: 'AUTORIZADA' });
    assert.match(html, /bg-success/);
    assert.match(html, />NFC-e</);
  });

  it('09 — Histórico rejeitado informa rejeição sem selo verde', () => {
    const html = contextoHistorico.montarBadgeNfceHistorico({ nfce_situacao_fiscal: 'REJEITADA' });
    assert.match(html, /NFC-e rejeitada/);
    assert.doesNotMatch(html, /bg-success/);
  });

  it('10 — Histórico cancelado informa cancelamento', () => {
    const html = contextoHistorico.montarBadgeNfceHistorico({ nfce_situacao_fiscal: 'CANCELADA' });
    assert.match(html, /NFC-e cancelada/);
  });

  it('11 — Histórico 539 exige verificação e ERP/PDV usam o helper canônico', () => {
    const html = contextoHistorico.montarBadgeNfceHistorico({ nfce_situacao_fiscal: 'DUPLICIDADE_PENDENTE' });
    assert.match(html, /NFC-e — verificar/);
    assert.match(ERP_SRC, /montarBadgeNfceHistorico\(v\)/);
    assert.match(PDV_SRC, /montarBadgeNfceHistorico\(v\)/);
    assert.match(ERP_SRC, /SITUAÇÃO FISCAL: \$\{data\.nfce_situacao_fiscal/);
    assert.match(PDV_SRC, /SITUAÇÃO FISCAL: \$\{data\.nfce_situacao_fiscal/);
    assert.match(PDV_PRINCIPAL_SRC, /SITUAÇÃO FISCAL: \$\{data\.nfce_situacao_fiscal/);
    assert.match(TEF_ROTA_SRC, /classificarSituacaoFiscalDaVenda\(db, vendaId\)/);
  });

  it('12 — fechamento exclui somente a NFC-e efetivamente autorizada', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.equal(lotes.some((l) => l.venda_id === 1), false);
  });

  it('13 — fechamento não trata rejeitada como autorizada', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.equal(lotes.some((l) => l.venda_id === 2), true);
  });

  it('14 — 539 bloqueia decisão automática e vendas reais 3–9 são classificadas', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.equal(lotes.some((l) => l.venda_id === 3), false);
    const resumo = await obterResumoDia(db, DATA);
    assert.equal(resumo.pendencias_fiscais.some((p) => p.venda_id === 3), true);
    assert.match(FFD_SRC, /duplicidade pendente de recuperação/);
    assert.match(FFD_SRC, /não foram incluídas nem classificadas como autorizadas/);

    const operacional = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
    if (fs.existsSync(operacional)) {
      const realDb = await openDb(operacional, sqlite3.OPEN_READONLY);
      try {
        const mapa = await classificarSituacoesFiscaisPorVenda(realDb, [3, 4, 5, 6, 7, 8, 9]);
        assert.deepEqual(
          [3, 4, 5, 6, 7, 8, 9].map((id) => mapa.get(id).situacao),
          ['SEM_DOCUMENTO', 'SEM_DOCUMENTO', 'DUPLICIDADE_PENDENTE',
            'DUPLICIDADE_PENDENTE', 'REJEITADA', 'CANCELADA', 'SEM_DOCUMENTO']
        );
      } finally {
        await closeDb(realDb);
      }
    }
  });

  it('15 — cancelada segue regra oficial existente e volta à avaliação', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const lote = lotes.find((l) => l.venda_id === 4);
    assert.ok(lote);
    assert.equal(lote.situacao_fiscal_nfce, SITUACAO_NFCE.CANCELADA);
  });

  it('16 — vínculo por venda impede nota de outro tenant de excluir a venda', async () => {
    const mapa = await classificarSituacoesFiscaisPorVenda(db, [7]);
    assert.equal(mapa.get(7).situacao, SITUACAO_NFCE.DESCONHECIDA);
    assert.equal(mapa.get(7).venda_id, 7);
    assert.doesNotMatch(CLASSIFICADOR_SRC, /WHERE\s+empresa_id\s*=/i);
  });

  it('17 — classificação é idempotente', async () => {
    const a = await classificarSituacoesFiscaisPorVenda(db, [1, 2, 3, 4, 5, 6, 7]);
    const b = await classificarSituacoesFiscaisPorVenda(db, [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  it('18 — regressão de elegibilidade controlada permanece em R$ 44', async () => {
    const resumo = await obterResumoDia(db, DATA_44);
    assert.equal(resumo.valor_fiscal_elegivel, 44);
    assert.equal(resumo.linhas_elegiveis, 6);
  });

  it('19 — regressão da distribuição preserva R$ 44 e diferença zero', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA_44);
    const previa = gerarPreviaDistribuicao(lotes, 44, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.equal(previa.valor_elegivel, 44);
    assert.equal(previa.valor_distribuido, 44);
    assert.equal(previa.diferenca, 0);
    assert.equal(previa.metricas.unidades_selecionadas, 6);
    assert.equal(previa.vendas.flatMap((v) => v.itens).length, 6);
  });

  it('20 — regressão do recebimento preserva R$ 44', async () => {
    const recebimento = await get(db, `SELECT SUM(valor) total
      FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id=76`);
    assert.equal(recebimento.total, 44);
  });

  it('21 — classificação e prévia não alteram estoque', async () => {
    await listarLotesElegiveisDoDia(db, DATA_44);
    const depois = await get(db, `SELECT saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id=1`);
    assert.deepEqual(depois, snapshotAntes.estoque);
  });

  it('22 — classificação e prévia não alteram financeiro, vendas ou pagamentos', async () => {
    const depois = {
      financeiro: await get(db, `SELECT COUNT(*) n, SUM(valor) total FROM financeiro`),
      vendas: await get(db, `SELECT COUNT(*) n, SUM(total) total FROM vendas`),
      pagamentos: await get(db, `SELECT COUNT(*) n, SUM(valor) total FROM vendas_pagamentos`)
    };
    assert.deepEqual(depois, {
      financeiro: snapshotAntes.financeiro,
      vendas: snapshotAntes.vendas,
      pagamentos: snapshotAntes.pagamentos
    });
  });

  it('23 — suíte não transmite, consulta ou cancela na SEFAZ', () => {
    assert.doesNotMatch(CLASSIFICADOR_SRC, /axios|https?:|emitirPorVendaId|cancelarNfce|enviarAutorizacao|transmitirFechamento/);
    assert.match(CLASSIFICADOR_SRC, /classificarSituacaoFiscalNfce/);
  });
});
