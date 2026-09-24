/**
 * Sprint — Preparação da continuação fiscal (caso real #5)
 * Principal 687,76 | Autorizado 249,99 | Pendente/tentativa 437,77
 *
 * Executar: node --test tests/fiscal/fechamento-fiscal-continuacao-preparacao.test.js
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  obterRecebimentosDaTentativa,
  resolverContextoEmissao,
  validarPreparacaoFiscal,
  ratearRecebimentosPorDocumentos
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalValidacaoService');
const {
  recalcularSaldoFechamento,
  bloquearEmissaoIntegralSeParcial,
  assertValorTentativaPermitido
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalSaldoService');
const { DOC_STATUS, STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const { garantirSchemaFechamentoFiscal } = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');
const { toCentavos, arredondarMoeda } = require('../../backend/services/fiscal/modeloTotais');

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

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

const PROD = {
  id: 1,
  nome: 'Produto Teste',
  ncm: '22021000',
  cfop: '5102',
  csosn: '102',
  origem: 0,
  unidade: 'UN'
};

function configFiscalOk() {
  return {
    cnpj: '12345678000199',
    ie: '123456789',
    ambiente: 2,
    serie: 1,
    certificadoPath: '/fake/cert.pfx'
  };
}

function previaTentativa437() {
  return [
    {
      id: 10,
      sequencia: 1,
      valor: 249.97,
      itens: [{ produto_id: 1, quantidade: 1, valor_unitario: 249.97, valor_total: 249.97 }]
    },
    {
      id: 11,
      sequencia: 2,
      valor: 187.80,
      itens: [{ produto_id: 1, quantidade: 1, valor_unitario: 187.80, valor_total: 187.80 }]
    }
  ];
}

describe('Continuação fiscal — preparação / validação / rateio (caso 5)', () => {
  let db;
  let ffId;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-cont-prep-'));
    db = await openDb(path.join(dir, 't.db'));
    await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
    await run(db, `INSERT INTO configuracoes VALUES ('fechamento_fiscal_do_dia','ATIVADO')`);
    await run(db, `INSERT INTO configuracoes VALUES ('cnpj','12345678000199')`);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
    });
    for (const sql of [
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_principal REAL`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_emitido_autorizado REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_pendente_emissao REAL NOT NULL DEFAULT 0`
    ]) {
      try { await run(db, sql); } catch (_) { /* already */ }
    }

    const ins = await run(
      db,
      `INSERT INTO fechamentos_fiscais (
        data_fechamento, cnpj, valor_informado, valor_distribuido, diferenca,
        status, valor_principal, valor_emitido_autorizado, valor_pendente_emissao
      ) VALUES ('2026-09-22','12345678000199',687.76,437.77,0,
        'AUTORIZACAO_PARCIAL',687.76,249.99,437.77)`
    );
    ffId = ins.lastID;

    await run(
      db,
      `INSERT INTO fechamentos_fiscais_recebimentos
        (fechamento_fiscal_id, operadora, cnpj, valor) VALUES (?,?,?,?)`,
      [ffId, 'MAQUINA1', '12345678000199', 687.76]
    );

    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 1, DOC_STATUS.AUTORIZADO, 249.99, '100', 'PROT13',
        '23260912345678000199650010000000131123456789', 13
      ]
    );
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, numero)
       VALUES (?,?,?,?,?,?)`,
      [ffId, 2, DOC_STATUS.REJEITADO, 249.97, '539', 14]
    );
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, numero)
       VALUES (?,?,?,?,?,?)`,
      [ffId, 3, DOC_STATUS.REJEITADO, 187.80, '539', 15]
    );
  });

  it('A) continuação 687,76 → autorizado 249,99 → pendente/tentativa 437,77', async () => {
    const saldo = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(saldo.valor_principal), 68776);
    assert.equal(toCentavos(saldo.valor_emitido_autorizado), 24999);
    assert.equal(toCentavos(saldo.valor_pendente_emissao), 43777);

    const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id=?`, [ffId]);
    const ctx = resolverContextoEmissao(ff, saldo, { continuar_emissao: true });
    assert.equal(ctx.tipo, 'CONTINUACAO');
    assert.equal(toCentavos(ctx.valorPrincipal), 68776);
    assert.equal(toCentavos(ctx.valorEmitidoAutorizado), 24999);
    assert.equal(toCentavos(ctx.valorPendente), 43777);
    assert.equal(toCentavos(ctx.valorTentativa), 43777);
    assert.notEqual(toCentavos(ctx.valorTentativa), toCentavos(ctx.valorPrincipal));
  });

  it('B) validação da continuação OK (não compara principal × distribuído)', async () => {
    const saldo = await recalcularSaldoFechamento(db, ffId);
    const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id=?`, [ffId]);
    const ctx = resolverContextoEmissao(ff, saldo);
    const recebimentos = await all(
      db,
      `SELECT * FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id=?`,
      [ffId]
    );
    const recTent = obterRecebimentosDaTentativa(recebimentos, ctx.valorTentativa);

    const validacao = validarPreparacaoFiscal({
      fechamento: { ...ff, valor_distribuido: 437.77, valor_informado: 687.76, diferenca: 0 },
      previaVendas: previaTentativa437(),
      produtosPorId: new Map([[1, PROD]]),
      configFiscal: configFiscalOk(),
      recebimentos: recTent,
      saldo,
      contextoEmissao: ctx,
      opts: { certificadoOpcional: true, recebimentosJaDaTentativa: true }
    });

    assert.equal(validacao.ok, true, formatErros(validacao));
    assert.equal(validacao.contextoEmissao.tipo, 'CONTINUACAO');
    assert.ok(!validacao.erros.some((e) => e.codigo === 'DIFERENCA_NAO_ZERO'));
    assert.ok(!validacao.erros.some((e) => e.codigo === 'RECEBIMENTOS_DIVERGENTES'));
  });

  it('C) rateio da continuação usa só 437,77 (não 687,76)', () => {
    const recs = obterRecebimentosDaTentativa(
      [{ id: 1, operadora: 'M1', cnpj: '12345678000199', valor: 687.76 }],
      437.77
    );
    assert.equal(recs.length, 1);
    assert.equal(toCentavos(recs[0].valor), 43777);
    assert.equal(toCentavos(recs[0].valor_original), 68776);

    const rateio = ratearRecebimentosPorDocumentos(
      [
        { previa_venda_id: 10, sequencia: 1, valor: 249.97 },
        { previa_venda_id: 11, sequencia: 2, valor: 187.80 }
      ],
      recs
    );
    const soma = rateio.reduce(
      (s, d) => s + d.pagamentos.reduce((a, p) => a + toCentavos(p.valor), 0),
      0
    );
    assert.equal(soma, 43777);
  });

  it('D) rejeição da continuação não muda saldo', async () => {
    const antes = await recalcularSaldoFechamento(db, ffId);
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, numero)
       VALUES (?,?,?,?,?,?)`,
      [ffId, 10, DOC_STATUS.REJEITADO, 437.77, '539', 99]
    );
    const depois = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(depois.valor_principal), toCentavos(antes.valor_principal));
    assert.equal(toCentavos(depois.valor_emitido_autorizado), 24999);
    assert.equal(toCentavos(depois.valor_pendente_emissao), 43777);
  });

  it('E) nova autorização parcial reduz pendente', async () => {
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 11, DOC_STATUS.AUTORIZADO, 200.00, '100', 'PROT200',
        '23260912345678000199650010000002001123456789', 200
      ]
    );
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_principal), 68776);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 44999);
    assert.equal(toCentavos(s.valor_pendente_emissao), 23777);
  });

  it('F) segunda continuação usa 237,77', async () => {
    const s = await recalcularSaldoFechamento(db, ffId);
    const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id=?`, [ffId]);
    const ctx = resolverContextoEmissao(ff, s, { continuar_emissao: true });
    assert.equal(ctx.tipo, 'CONTINUACAO');
    assert.equal(toCentavos(ctx.valorTentativa), 23777);

    const recs = await all(
      db,
      `SELECT * FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id=?`,
      [ffId]
    );
    const tent = obterRecebimentosDaTentativa(recs, ctx.valorTentativa);
    assert.equal(toCentavos(tent[0].valor), 23777);
  });

  it('G) conclusão em zero → AUTORIZADO', async () => {
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 12, DOC_STATUS.AUTORIZADO, 237.77, '100', 'PROT237',
        '23260912345678000199650010000002371123456789', 237
      ]
    );
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_principal), 68776);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 68776);
    assert.equal(toCentavos(s.valor_pendente_emissao), 0);
    assert.equal(s.concluido, true);
    const ctx = resolverContextoEmissao(
      { valor_principal: 687.76, valor_informado: 687.76, valor_emitido_autorizado: 687.76 },
      s
    );
    assert.equal(ctx.tipo, 'CONCLUIDO');
  });

  it('H) proteção contra repetir principal', () => {
    const saldo = {
      valor_principal: 687.76,
      valor_emitido_autorizado: 249.99,
      valor_pendente_emissao: 437.77
    };
    const err = bloquearEmissaoIntegralSeParcial(saldo, {});
    assert.ok(err);
    assert.equal(err.code, 'FECHAMENTO_AUTORIZACAO_PARCIAL');
    assert.throws(
      () => assertValorTentativaPermitido(saldo, 687.76),
      /principal|pendente|não é permitido/i
    );
    assert.doesNotThrow(() => assertValorTentativaPermitido(saldo, 437.77));
  });

  it('I) proteção — documentos AUTORIZADOS não são apagados na preparação', () => {
    const prep = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService.js'),
      'utf8'
    );
    assert.match(prep, /nunca apaga NFC-e AUTORIZADA/i);
    assert.match(prep, /obterRecebimentosDaTentativa/);
    assert.match(prep, /resolverContextoEmissao/);
    assert.match(prep, /contextoEmissao/);
    const val = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalValidacaoService.js'),
      'utf8'
    );
    assert.match(val, /CONTINUACAO/);
    assert.match(val, /obterRecebimentosDaTentativa/);
    assert.match(val, /valorTentativa/);
  });

  it('regressão: emissão INICIAL ainda compara informado = distribuído', () => {
    const ff = {
      status: STATUS.PREVIA,
      cnpj: '12345678000199',
      valor_informado: 100,
      valor_distribuido: 100,
      diferenca: 0,
      valor_principal: 100,
      valor_emitido_autorizado: 0
    };
    const ctx = resolverContextoEmissao(ff, {
      valor_principal: 100,
      valor_emitido_autorizado: 0,
      valor_pendente_emissao: 100
    });
    assert.equal(ctx.tipo, 'INICIAL');
    const v = validarPreparacaoFiscal({
      fechamento: ff,
      previaVendas: [{
        sequencia: 1,
        valor: 100,
        itens: [{ produto_id: 1, quantidade: 1, valor_unitario: 100, valor_total: 100 }]
      }],
      produtosPorId: new Map([[1, PROD]]),
      configFiscal: configFiscalOk(),
      recebimentos: [{ id: 1, valor: 100, operadora: 'X', cnpj: '12345678000199' }],
      contextoEmissao: ctx,
      opts: { certificadoOpcional: true }
    });
    assert.equal(v.ok, true, formatErros(v));
  });
});

function formatErros(v) {
  return (v.erros || []).map((e) => e.codigo + ':' + e.mensagem).join(' | ');
}
