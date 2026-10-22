'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const {
  carregarRecebimentosParaModo,
  mapearPagamentosPorComprovante
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService');
const {
  hashIdempotencia,
  validarPreparacaoFiscal
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalValidacaoService');
const { STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const { montarPagamentos } = require('../../backend/services/fiscal/xmlBuilder');
const frontend = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'),
  'utf8'
);

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

const CNPJ = '12345678000199';
const PRODUTO = {
  id: 1,
  nome: 'Produto de teste',
  ncm: '22021000',
  cfop: '5102',
  csosn: '102'
};

function validarComRecebimentos(recebimentos, valoresVendas = [10, 15], valorInformadoOverride = null, modoRecebimento = null) {
  const previaVendas = valoresVendas.map((valor, index) => ({
    id: index + 1,
    sequencia: index + 1,
    valor,
    itens: [{
      produto_id: 1,
      quantidade: 1,
      valor_unitario: valor,
      valor_total: valor
    }]
  }));
  const valorTotal = valoresVendas.reduce((soma, valor) => soma + valor, 0);
  const valorInformado = valorInformadoOverride == null ? valorTotal : valorInformadoOverride;
  return validarPreparacaoFiscal({
    fechamento: {
      id: 1,
      status: STATUS.PREVIA,
      cnpj: CNPJ,
      valor_informado: valorInformado,
      valor_distribuido: valorTotal,
      diferenca: Number((valorInformado - valorTotal).toFixed(2))
    },
    previaVendas,
    produtosPorId: new Map([[1, PRODUTO]]),
    configFiscal: {
      cnpj: CNPJ,
      ie: '123456789',
      ambiente: 2,
      serie: 1,
      certificadoPath: '/isolated-test/cert.pfx'
    },
    recebimentos,
    opts: modoRecebimento ? { modo_recebimento: modoRecebimento } : {}
  });
}

describe('Validação dos recebimentos fiscais por modo', () => {
  let db;
  let tempDir;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-recebimentos-'));
    db = await openDb(path.join(tempDir, 'qa.db'));
    await run(db, `CREATE TABLE fechamentos_fiscais_recebimentos (
      id INTEGER PRIMARY KEY,
      fechamento_fiscal_id INTEGER NOT NULL,
      operadora TEXT NOT NULL,
      valor REAL NOT NULL
    )`);
    await run(db, `CREATE TABLE fechamentos_fiscais_recebimentos_comprovantes (
      id INTEGER PRIMARY KEY,
      fechamento_fiscal_id INTEGER NOT NULL,
      valor REAL NOT NULL,
      ordem INTEGER NOT NULL,
      operadora TEXT,
      cnpj TEXT,
      forma_pagamento TEXT
    )`);
    await run(db, `CREATE TABLE fechamentos_fiscais_recebimentos_vendas (
      id INTEGER PRIMARY KEY,
      fechamento_fiscal_id INTEGER NOT NULL,
      venda_id INTEGER NOT NULL,
      valor_comprovante REAL
    )`);
  });

  after(async () => {
    if (db) await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function replaceRows(table, rows, columns) {
    await run(db, `DELETE FROM ${table} WHERE fechamento_fiscal_id = 1`);
    for (const row of rows) {
      await run(
        db,
        `INSERT INTO ${table} (fechamento_fiscal_id, ${columns}) VALUES (1, ${columns.split(',').map(() => '?').join(', ')})`,
        row
      );
    }
  }

  async function validateMode(mode, sales = [10, 15]) {
    const recebimentos = await carregarRecebimentosParaModo(db, 1, mode);
    return validarComRecebimentos(recebimentos, sales, null, mode);
  }

  it('envia à validação e preparação o modo de recebimento selecionado na tela', () => {
    assert.match(frontend, /const payloadPrevia = \{[\s\S]*?modo_recebimento: __ffdEstado\.modoRecebimento/);
  });

  it('aceita R$ 25,00 conciliados usando comprovantes, sem somar máquinas antigas', async () => {
    await replaceRows('fechamentos_fiscais_recebimentos', [
      ['Maquina A', 20],
      ['Maquina B', 5]
    ], 'operadora, valor');
    await replaceRows('fechamentos_fiscais_recebimentos_comprovantes', [
      [10, 0, 'Operadora A', '12345678000199', 'pix'],
      [15, 1, 'Operadora B', '12345678000199', 'cartao_credito']
    ], 'valor, ordem, operadora, cnpj, forma_pagamento');

    const validacao = await validateMode('por_comprovante');
    assert.equal(validacao.ok, true, JSON.stringify(validacao.erros));
    assert.equal(validacao.checklist.find((item) => item.key === 'pagamento').ok, true);
  });

  it('aprova R$ 20,00 exatos e bloqueia R$ 26,96 brutos contra R$ 20,00 recebidos', () => {
    const recebimentos = [{ operadora: 'Máquina A', valor: 20 }];
    const exata = validarComRecebimentos(recebimentos, [20], 20);
    assert.equal(exata.ok, true, JSON.stringify(exata.erros));

    const divergente = validarComRecebimentos(recebimentos, [26.96], 20);
    assert.equal(divergente.ok, false);
    assert.ok(divergente.erros.some((item) => item.codigo === 'DIFERENCA_NAO_ZERO'));
    assert.equal(divergente.checklist.find((item) => item.key === 'total').ok, false);
  });

  it('bloqueia recebimentos de R$ 24,99 ou R$ 25,01 contra fechamento de R$ 25,00', async () => {
    for (const [valorSegundo, totalEsperado] of [[14.99, '24.99'], [15.01, '25.01']]) {
      await replaceRows('fechamentos_fiscais_recebimentos_comprovantes', [
        [10, 0, 'Operadora A', '12345678000199', 'pix'],
        [valorSegundo, 1, 'Operadora B', '12345678000199', 'cartao_debito']
      ], 'valor, ordem, operadora, cnpj, forma_pagamento');
      const validacao = await validateMode('por_comprovante');
      const erro = validacao.erros.find((item) => item.codigo === 'RECEBIMENTOS_DIVERGENTES');
      assert.ok(erro, `A divergência de R$ ${totalEsperado} não bloqueou a validação.`);
      assert.match(erro.mensagem, new RegExp(totalEsperado.replace('.', '\\.')));
    }
  });

  it('soma duas vendas e duas máquinas uma única vez no modo por máquina', async () => {
    await replaceRows('fechamentos_fiscais_recebimentos', [
      ['Maquina A', 10],
      ['Maquina B', 15]
    ], 'operadora, valor');
    await replaceRows('fechamentos_fiscais_recebimentos_comprovantes', [
      [10, 0, 'Operadora A', '12345678000199', 'pix'],
      [15, 1, 'Operadora B', '12345678000199', 'dinheiro']
    ], 'valor, ordem, operadora, cnpj, forma_pagamento');

    const recebimentos = await carregarRecebimentosParaModo(db, 1, 'por_maquina');
    assert.deepEqual(recebimentos.map((item) => item.valor), [10, 15]);
    assert.equal((await validarComRecebimentos(recebimentos)).ok, true);
  });

  it('usa os comprovantes associados a múltiplas vendas e aprova após corrigir a pendência', async () => {
    await replaceRows('fechamentos_fiscais_recebimentos_vendas', [
      [10, 10],
      [15, 11]
    ], 'valor_comprovante, venda_id');

    let validacao = await validateMode('por_venda');
    assert.equal(validacao.ok, true, JSON.stringify(validacao.erros));

    await run(
      db,
      `UPDATE fechamentos_fiscais_recebimentos_vendas
       SET valor_comprovante = 14.99
       WHERE fechamento_fiscal_id = 1 AND venda_id = 11`
    );
    validacao = await validateMode('por_venda');
    assert.ok(validacao.erros.some((item) => item.codigo === 'RECEBIMENTOS_DIVERGENTES'));

    await run(
      db,
      `UPDATE fechamentos_fiscais_recebimentos_vendas
       SET valor_comprovante = 15
       WHERE fechamento_fiscal_id = 1 AND venda_id = 11`
    );
    validacao = await validateMode('por_venda');
    assert.equal(validacao.ok, true, JSON.stringify(validacao.erros));
  });

  it('preserva forma e valor próprios em cada venda e rejeita dados não mapeados ou divergentes', () => {
    const rateio = mapearPagamentosPorComprovante([
      { id: 21, sequencia: 1, valor: 10 },
      { id: 22, sequencia: 2, valor: 15 }
    ], [
      { id: 31, valor: 10, forma_pagamento: 'pix', operadora: 'PIX', cnpj: '123.456.780-00199' },
      { id: 32, valor: 15, forma_pagamento: 'cartao_debito', operadora: 'Débito' }
    ]);

    assert.deepEqual(rateio.map((item) => ({
      previa_venda_id: item.previa_venda_id,
      valor: item.pagamentos[0].valor,
      forma: item.pagamentos[0].forma_pagamento,
      cnpj: item.pagamentos[0].cnpj
    })), [
      { previa_venda_id: 21, valor: 10, forma: 'pix', cnpj: '12345678000199' },
      { previa_venda_id: 22, valor: 15, forma: 'cartao_debito', cnpj: null }
    ]);
    assert.match(montarPagamentos(rateio[0].pagamentos), /<tPag>17<\/tPag>[\s\S]*?<vPag>10\.00<\/vPag>/);
    assert.match(montarPagamentos(rateio[1].pagamentos), /<tPag>04<\/tPag>[\s\S]*?<vPag>15\.00<\/vPag>/);
    assert.throws(() => mapearPagamentosPorComprovante(
      [{ id: 1, valor: 10 }],
      [{ valor: 10, forma_pagamento: null }]
    ), { code: 'FORMA_PAGAMENTO_COMPROVANTE_INVALIDA' });
    assert.throws(() => mapearPagamentosPorComprovante(
      [{ id: 1, valor: 9.99 }],
      [{ valor: 10, forma_pagamento: 'pix' }]
    ), { code: 'VALOR_COMPROVANTE_VENDA_DIVERGENTE' });
  });

  it('rejeita forma ausente na validação do modo por comprovante', async () => {
    await replaceRows('fechamentos_fiscais_recebimentos_comprovantes', [
      [10, 0, 'Operadora A', '12345678000199', null],
      [15, 1, 'Operadora B', '12345678000199', 'pix']
    ], 'valor, ordem, operadora, cnpj, forma_pagamento');
    const validacao = await validateMode('por_comprovante');

    assert.equal(validacao.ok, false);
    assert.ok(validacao.erros.some((item) => item.codigo === 'FORMA_PAGAMENTO_COMPROVANTE_INVALIDA'));
  });

  it('inclui forma e CNPJ na idempotência de comprovantes sem alterar a chave por máquina', () => {
    const input = {
      fechamentoId: 1,
      previaVendas: [],
      ambiente: 2,
      cnpj: CNPJ
    };
    const recebimentosBase = [{ id: 1, operadora: 'Operadora', valor: 25, cnpj: CNPJ, forma_pagamento: 'pix' }];
    const alterado = [{ ...recebimentosBase[0], forma_pagamento: 'cartao_credito', cnpj: '98765432000100' }];

    assert.notEqual(
      hashIdempotencia({ ...input, recebimentos: recebimentosBase, modoRecebimento: 'por_comprovante' }),
      hashIdempotencia({ ...input, recebimentos: alterado, modoRecebimento: 'por_comprovante' })
    );
    assert.equal(
      hashIdempotencia({ ...input, recebimentos: recebimentosBase, modoRecebimento: 'por_maquina' }),
      hashIdempotencia({ ...input, recebimentos: alterado, modoRecebimento: 'por_maquina' })
    );
  });
});
