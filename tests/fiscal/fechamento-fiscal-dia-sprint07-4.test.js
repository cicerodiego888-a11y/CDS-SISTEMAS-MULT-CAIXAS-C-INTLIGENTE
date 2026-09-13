/**
 * Sprint 07.4 — Prévia e finalização do Fechamento Fiscal do Dia
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint07-4.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  STATUS,
  criarRascunho,
  adicionarRecebimento,
  gerarPrevia,
  validarFiscal,
  prepararEmissaoFiscal,
  obterResumoDia,
  listarLotesElegiveisDoDia,
  snapshotComercial,
  resolverDataFechamento,
  diagnosticarProntidaoTransmissao,
  garantirSchemaFechamentoFiscal
} = require('../../backend/services/fechamento-fiscal');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fechamento-fiscal.js'), 'utf8');
const ELEG = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalElegibilidadeService.js'),
  'utf8'
);

const CFG_PRODUCAO = {
  codigoUf: '23',
  cnpj: '12345678000199',
  ie: '073252638',
  crt: 1,
  ambiente: 1,
  serie: 1,
  numeroAtual: 50,
  nomeEmpresa: 'EMPRESA TESTE LTDA',
  logradouro: 'RUA A',
  numero: '100',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipioCodigo: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '8835110000',
  tpImp: 4,
  csosn_padrao: '102',
  certificadoPath: 'C:/certificado-teste.pfx',
  certificadoSenha: 'teste',
  idCSC: '1',
  tokenCSC: 'TOKEN',
  urls: {
    autorizacao: 'https://producao.example/autorizacao',
    consultaQr: 'https://producao.example/qr',
    consultaChave: 'https://producao.example/chave'
  }
};

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
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

async function criarSchemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, preco_venda REAL DEFAULT 0, preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN',
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
    ncm TEXT, cest TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, data_venda TEXT, total REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    status TEXT DEFAULT 'concluida', cancelada INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
    quantidade REAL DEFAULT 0, quantidade_fiscal REAL DEFAULT 0, quantidade_nao_fiscal REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    preco_unitario REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER, produto_id INTEGER,
    quantidade REAL, valor_unitario REAL, valor_total REAL
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE vendas_pagamentos (id INTEGER PRIMARY KEY, venda_id INTEGER, valor REAL)`);
  await run(db, `CREATE TABLE contas_receber (id INTEGER PRIMARY KEY, valor REAL)`);
  await run(db, `CREATE TABLE contas_pagar (id INTEGER PRIMARY KEY, valor REAL)`);
  await run(db, `CREATE TABLE caixa_movimentacoes (id INTEGER PRIMARY KEY, valor REAL)`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '12345678000199')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function seedCenario44(db) {
  const produtos = [
    [1, 'Coca Cola 1L', '7891', 8, 5],
    [2, 'Coca Cola 250ml', '7892', 3, 2],
    [3, 'Coca Cola 2L', '7893', 13, 9]
  ];
  for (const [id, nome, codigo, preco, custo] of produtos) {
    await run(db, `INSERT INTO produtos
      (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
      VALUES (?,?,?,?,?,1,'UN',100,100,1,'22021000','5102','102',0)`,
    [id, nome, codigo, preco, custo]);
  }

  const itens = [
    [1, 1, 1, 8, 8],
    [2, 2, 1, 8, 8],
    [3, 3, 1, 5, 4],
    [4, 4, 1, 8, 8],
    [5, 5, 2, 3, 3],
    [6, 6, 3, 13, 13]
  ];
  for (const [id, vendaId, produtoId, precoComercial, valorFiscal] of itens) {
    await run(db, `INSERT INTO vendas
      (id,data_venda,total,valor_fiscal,valor_nao_fiscal,status,cancelada)
      VALUES (?,'2026-09-13',?,0,?,'concluida',0)`,
    [vendaId, valorFiscal, valorFiscal]);
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,
       subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
      VALUES (?,?,?,1,1,0,?,?,?,?)`,
    [id, vendaId, produtoId, precoComercial, valorFiscal, valorFiscal, precoComercial]);
  }
  await run(db, `INSERT INTO financeiro (id,valor,descricao,tipo,origem)
    VALUES (1,44,'movimento comercial existente','receita','pdv')`);
  await run(db, `INSERT INTO vendas_pagamentos (id,venda_id,valor) VALUES (1,1,8)`);
  await run(db, `INSERT INTO contas_receber (id,valor) VALUES (1,44)`);
  await run(db, `INSERT INTO contas_pagar (id,valor) VALUES (1,10)`);
  await run(db, `INSERT INTO caixa_movimentacoes (id,valor) VALUES (1,44)`);
}

async function snapshotCompleto(db) {
  const comercial = await snapshotComercial(db);
  const contasReceber = await get(db, `SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM contas_receber`);
  const contasPagar = await get(db, `SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM contas_pagar`);
  const caixa = await get(db, `SELECT COUNT(*) n, COALESCE(SUM(valor),0) total FROM caixa_movimentacoes`);
  return { comercial, contasReceber, contasPagar, caixa };
}

describe('Sprint 07.4 — cenário funcional R$ 44', { concurrency: false }, () => {
  let dir;
  let db;
  let fechamento;
  let resumo;
  let lotes;
  let retornoPrevia;
  let snapshotAntes;
  let snapshotDepois;
  let contagensPrimeiraPrevia;
  let validacao;
  let preparacao;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s074-'));
    db = await openDb(path.join(dir, 'sprint07-4.db'));
    await criarSchemaBase(db);
    await seedCenario44(db);
    snapshotAntes = await snapshotCompleto(db);
    fechamento = await criarRascunho({
      data_fechamento: '2026-09-13',
      cnpj: '12345678000199',
      valor_alvo: 250,
      valor_min: 80,
      valor_max: 400,
      distribuicao_automatica: true
    }, { db });
    await adicionarRecebimento(fechamento.id, { operadora: 'Mercado Pago', valor: 44 }, { db });
    resumo = await obterResumoDia(db, '2026-09-13', { excluirFechamentoId: fechamento.id });
    lotes = await listarLotesElegiveisDoDia(db, '2026-09-13', { excluirFechamentoId: fechamento.id });
  });

  after(async () => {
    if (db) await closeDb(db);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('01 — frontend envia data e data_fechamento explicitamente', () => {
    assert.match(FRONT, /data,\s*\n\s*data_fechamento: data/);
    assert.match(FRONT, /PREVIA REQUEST/);
  });

  it('02 — contrato aceita somente data_fechamento', () => {
    assert.equal(resolverDataFechamento({ data_fechamento: '2026-09-13' }), '2026-09-13');
    assert.match(ROTA, /data_fechamento: body\.data_fechamento/);
  });

  it('03 — contrato usa fallback da data do fechamento', () => {
    assert.equal(
      resolverDataFechamento({}, { data_fechamento: '2026-09-13', data_referencia_comercial: '2026-09-12' }),
      '2026-09-13'
    );
  });

  it('04 — data inválida sem fallback retorna 400 explícito', async () => {
    await run(db, `INSERT INTO fechamentos_fiscais
      (id,data_fechamento,cnpj,status,criado_em,atualizado_em)
      VALUES (99,'','99999999000199','RASCUNHO',datetime('now'),datetime('now'))`);
    await assert.rejects(
      () => gerarPrevia({ id: 99, valor_informado: 44, persistir: false }, { db, moduloOn: true, capturarSnapshot: false }),
      (err) => err.statusCode === 400 && /Data inválida/.test(err.message)
    );
  });

  it('05 — elegibilidade totaliza R$ 44', () => {
    assert.equal(resumo.valor_fiscal_elegivel, 44);
    assert.equal(resumo.capacidade_elegivel, 44);
  });

  it('06 — recebimento Mercado Pago totaliza R$ 44', async () => {
    const row = await get(db, `SELECT operadora, SUM(valor) total
      FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id=?`, [fechamento.id]);
    assert.equal(row.operadora, 'Mercado Pago');
    assert.equal(row.total, 44);
  });

  it('07 — conciliação possui diferença R$ 0', async () => {
    const row = await get(db, `SELECT valor_informado FROM fechamentos_fiscais WHERE id=?`, [fechamento.id]);
    assert.equal(Math.round((resumo.valor_fiscal_elegivel - row.valor_informado) * 100) / 100, 0);
  });

  it('08 — prévia cria composição', async () => {
    retornoPrevia = await gerarPrevia({
      id: fechamento.id,
      data: '2026-09-13',
      data_fechamento: '2026-09-13',
      valor_informado: 44,
      valor_alvo: 250,
      valor_min: 80,
      valor_max: 400,
      persistir: true
    }, { db, moduloOn: true });
    assert.ok(retornoPrevia.previa.vendas.length > 0);
  });

  it('09 — composição contém 3 produtos elegíveis', () => {
    assert.equal(retornoPrevia.indicadores.produtos_elegiveis, 3);
    assert.equal(new Set(retornoPrevia.previa.itensUtilizados.map((i) => i.produto_id)).size, 3);
  });

  it('10 — composição utiliza as 6 unidades', () => {
    assert.equal(retornoPrevia.indicadores.quantidade_utilizada, 6);
  });

  it('11 — distribuição totaliza exatamente R$ 44', () => {
    assert.equal(retornoPrevia.previa.valor_elegivel, 44);
    assert.equal(retornoPrevia.previa.valor_distribuido, 44);
    assert.equal(retornoPrevia.previa.diferenca, 0);
    assert.equal(retornoPrevia.previa.perfeita, true);
  });

  it('12 — lote fiscal R$ 4 preserva preço comercial R$ 5 apenas como auditoria', () => {
    const lote = lotes.find((l) => l.venda_item_id === 3);
    assert.equal(lote.valor_disponivel, 4);
    assert.equal(lote.valor_unitario_fiscal, 4);
    assert.equal(lote.preco_unitario_comercial, 5);
  });

  it('13 — distribuição não utiliza R$ 5 indevidamente', () => {
    const item = retornoPrevia.previa.vendas
      .flatMap((v) => v.itens)
      .find((i) => i.venda_item_origem_id === 3);
    assert.equal(item.valor_unitario, 4);
    assert.equal(item.valor_total, 4);
    assert.match(ELEG, /valor_unitario_fiscal: unit/);
  });

  it('14 — mínimo sugerido R$ 80 não bloqueia total R$ 44', () => {
    assert.equal(retornoPrevia.previa.codigo, 'OK');
    assert.equal(retornoPrevia.previa.quantidade_vendas, 1);
    assert.equal(retornoPrevia.previa.vendas[0].valor, 44);
  });

  it('15 — reexecução da prévia é idempotente', async () => {
    contagensPrimeiraPrevia = {
      vendas: (await get(db, `SELECT COUNT(*) n FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id=?`, [fechamento.id])).n,
      itens: (await get(db, `SELECT COUNT(*) n FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id=?`, [fechamento.id])).n
    };
    const novamente = await gerarPrevia({
      id: fechamento.id,
      valor_informado: 44,
      valor_alvo: 250,
      valor_min: 80,
      valor_max: 400,
      persistir: true
    }, { db, moduloOn: true });
    const depois = {
      vendas: (await get(db, `SELECT COUNT(*) n FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id=?`, [fechamento.id])).n,
      itens: (await get(db, `SELECT COUNT(*) n FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id=?`, [fechamento.id])).n
    };
    assert.deepEqual(depois, contagensPrimeiraPrevia);
    assert.equal(novamente.previa.valor_distribuido, 44);
  });

  it('16 — polling mantém prévia e existe apenas um timer', () => {
    assert.match(FRONT, /FFD_POLL_MS = 10000/);
    assert.match(FRONT, /clearInterval\(__ffdEstado\.pollTimer\)/);
    assert.match(FRONT, /ff\.previa_vendas && ff\.previa_vendas\.length && !silencioso/);
    assert.doesNotMatch(FRONT, /setInterval\([\s\S]{0,80}setInterval/);
  });

  it('17 — ambiente PRODUÇÃO permanece válido', () => {
    const diagnostico = diagnosticarProntidaoTransmissao(CFG_PRODUCAO);
    assert.equal(diagnostico.ambiente, 1);
    assert.equal(diagnostico.producao_bloqueada, false);
    assert.equal(diagnostico.transmissao_habilitada, true);
  });

  it('18 — validação fiscal após a prévia retorna OK', async () => {
    validacao = await validarFiscal(fechamento.id, {}, {
      db,
      certificadoOpcional: true,
      getFiscalConfig: async () => ({ ...CFG_PRODUCAO })
    });
    assert.equal(validacao.ok, true);
    assert.equal(validacao.validacao.ok, true);
  });

  it('19 — preparação chega a PRONTO_EMISSAO', async () => {
    preparacao = await prepararEmissaoFiscal(fechamento.id, { gerarXml: true }, {
      db,
      certificadoOpcional: true,
      getFiscalConfig: async () => ({ ...CFG_PRODUCAO })
    });
    assert.equal(preparacao.status, STATUS.PRONTO_EMISSAO);
    assert.equal(preparacao.documentos.length, 1);
    assert.equal(preparacao.documentos[0].valor_total, 44);
  });

  it('20 — estoque, financeiro, contas e caixa permanecem iguais', async () => {
    snapshotDepois = await snapshotCompleto(db);
    assert.deepEqual(snapshotDepois, snapshotAntes);
  });

  it('21 — fechamento não cria nem duplica vendas ou pagamentos', async () => {
    assert.equal(snapshotDepois.comercial.vendas, 6);
    assert.equal(snapshotDepois.comercial.pagamentos, 1);
    assert.equal((await get(db, `SELECT COUNT(*) n FROM vendas`)).n, 6);
    assert.equal((await get(db, `SELECT COUNT(*) n FROM vendas_pagamentos`)).n, 1);
  });

  it('22 — PRONTO_EMISSAO não transmite nem autoriza automaticamente', async () => {
    const ff = await get(db, `SELECT status, data_hora_emissao, data_hora_autorizacao FROM fechamentos_fiscais WHERE id=?`, [fechamento.id]);
    const docsAutorizados = await get(db, `SELECT COUNT(*) n FROM fechamentos_fiscais_documentos
      WHERE fechamento_fiscal_id=? AND status='AUTORIZADO'`, [fechamento.id]);
    const transmissoes = await get(db, `SELECT COUNT(*) n FROM fechamentos_fiscais_transmissoes WHERE fechamento_fiscal_id=?`, [fechamento.id]);
    assert.equal(ff.status, STATUS.PRONTO_EMISSAO);
    assert.equal(ff.data_hora_emissao, null);
    assert.equal(ff.data_hora_autorizacao, null);
    assert.equal(docsAutorizados.n, 0);
    assert.equal(transmissoes.n, 0);
  });
});
