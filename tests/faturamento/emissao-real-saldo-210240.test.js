/**
 * Integração do fluxo REAL emitirNFeDevolucaoCompra + 210240.
 * Para após montar XML. Não transmite SEFAZ e não altera a NF 100 real.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  setDbForTests: setDbSaldo,
  garantirTabelasSaldoDevolucao
} = require('../../backend/services/fiscal/controleSaldoDevolucaoCompra');
const {
  setDbForTests: setDbSubst,
  garantirTabelasSubstituicaoDevolucao,
  registrarManifestacaoDevolucao,
  criarRelacaoSubstituicao,
  montarObservacaoSubstituicao,
  efetivarSubstituicaoAposAutorizacao,
  resolverExcecaoSaldoManifestacao210240
} = require('../../backend/services/fiscal/nfeDevolucaoSubstituicaoService');
const {
  setDbForTests: setDbRasc,
  salvarRascunhoDevolucaoCompra
} = require('../../backend/services/fiscal/rascunhoDevolucaoCompra');
const {
  setDbForTests: setDbEmit,
  emitirNFeDevolucaoCompra
} = require('../../backend/services/fiscal/nfeDevolucaoCompra');

const CHAVE_COMPRA = '42260707670414000258550010000158601949669171';
const CHAVE_100 = '23260857824986000131550010000001001956868253';

const XML_210240 = `
<procEventoNFe><evento><infEvento>
  <CNPJ>07670414000258</CNPJ><chNFe>${CHAVE_100}</chNFe>
  <dhEvento>2026-09-23T10:00:00-03:00</dhEvento>
  <tpEvento>210240</tpEvento><nSeqEvento>1</nSeqEvento>
  <detEvento><descEvento>Operacao nao Realizada</descEvento><xJust>Divergencia</xJust></detEvento>
</infEvento></evento>
<retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><nProt>123</nProt></infEvento></retEvento>
</procEventoNFe>`;

const fiscalConfig = {
  codigoUf: '23', cnpj: '57824986000131', ie: '1', crt: 1, ambiente: 1, serie: 1, serieNfe: 1,
  nomeEmpresa: 'X', logradouro: 'R', numero: '1', bairro: 'B',
  municipioCodigo: '2307304', municipioNome: 'JUAZEIRO DO NORTE', uf: 'CE',
  cep: '63000000', telefone: '1'
};

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

const tmp = path.join(os.tmpdir(), `cds-210240-emit-real-${Date.now()}.db`);
let conn;
const traces = [];
const origInfo = console.info;

function itemLinha(i) {
  if (i === 1) {
    return { id: 1, produto_id: 10, nome: 'AL_CRIMP_DUP', qtd: 5 };
  }
  return { id: i, produto_id: 100 + i, nome: `ITEM_${String(i).padStart(2, '0')}`, qtd: 1 };
}

async function emitirComoUsuario(itens, extras = {}) {
  return emitirNFeDevolucaoCompra(2, {
    itens,
    observacoes: montarObservacaoSubstituicao({
      numero: 100, serie: 1, chaveAnterior: CHAVE_100, chaveCompra: CHAVE_COMPRA
    }),
    cfop: '5202',
    refNFe: CHAVE_COMPRA,
    origemNfeDevolucaoId: extras.origemNfeDevolucaoId,
    forcarEmissaoTeste: true,
    pularReconciliacaoSefaz: true,
    pularEspelhamento: true,
    pararAposMontarXml: true,
    fiscalConfig,
    ...extras
  });
}

before(async () => {
  conn = await openDb(tmp);
  setDbSaldo(conn);
  setDbSubst(conn);
  setDbRasc(conn);
  setDbEmit(conn);
  console.info = (...args) => {
    traces.push(args);
    origInfo.apply(console, args);
  };

  await run(conn, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, ncm TEXT, unidade TEXT, csosn TEXT, codigo_barras TEXT)`);
  await run(conn, `CREATE TABLE compras_devolucoes (
    id INTEGER PRIMARY KEY, compra_id INTEGER, compra_item_id INTEGER, quantidade REAL
  )`);
  await run(conn, `CREATE TABLE fornecedores (
    id INTEGER PRIMARY KEY, cpf_cnpj TEXT, rua TEXT, numero TEXT, bairro TEXT,
    cidade TEXT, uf TEXT, cep TEXT, inscricao_estadual TEXT, codigo_municipio TEXT
  )`);
  await run(conn, `CREATE TABLE compras (
    id INTEGER PRIMARY KEY, status TEXT, chave_acesso TEXT, numero_nf TEXT, serie_nf TEXT,
    fornecedor TEXT, fornecedor_cnpj TEXT, cidade TEXT, uf TEXT
  )`);
  await run(conn, `CREATE TABLE compras_itens (
    id INTEGER PRIMARY KEY, compra_id INTEGER, produto_id INTEGER, quantidade REAL,
    preco_unitario REAL, custo_unitario_final REAL, ncm TEXT, unidade TEXT,
    descricao_produto TEXT, codigo_barras TEXT
  )`);
  await run(conn, `CREATE TABLE nfe_devolucoes_compra (
    id INTEGER PRIMARY KEY, compra_id INTEGER, numero INTEGER, serie INTEGER,
    chave_acesso TEXT, protocolo TEXT, status TEXT, xml_autorizado TEXT
  )`);
  await run(conn, `INSERT INTO fornecedores (id, cpf_cnpj, cidade, uf, codigo_municipio)
    VALUES (1, '07670414000258', 'Joinville', 'SC', '4209102')`);
  await run(conn, `INSERT INTO compras (id, status, chave_acesso, numero_nf, serie_nf, fornecedor, fornecedor_cnpj, cidade, uf)
    VALUES (2, 'finalizada', ?, '15860', '1', 'FORN', '07670414000258', 'Joinville', 'SC')`, [CHAVE_COMPRA]);
  await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status, xml_autorizado)
    VALUES (11, 2, 100, 1, ?, '223260092164139', 'autorizada', '<nfe>NF100</nfe>')`, [CHAVE_100]);

  await garantirTabelasSaldoDevolucao();
  await garantirTabelasSubstituicaoDevolucao();

  for (let i = 1; i <= 46; i += 1) {
    const it = itemLinha(i);
    await run(conn, `INSERT INTO produtos (id, nome, codigo, ncm, unidade) VALUES (?, ?, ?, '82041100', 'UN')`,
      [it.produto_id, it.nome, it.nome]);
    await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, ncm, unidade, descricao_produto)
      VALUES (?, 2, ?, ?, 10, '82041100', 'UN', ?)`, [it.id, it.produto_id, it.qtd, it.nome]);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens
      (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (11, 2, ?, ?, ?, ?)`, [it.id, it.produto_id, i, it.qtd]);
  }

  await registrarManifestacaoDevolucao(11, { xmlEvento: XML_210240 });
  const manif = await get(conn, `SELECT * FROM nfe_devolucao_manifestacoes WHERE tp_evento='210240' ORDER BY id DESC LIMIT 1`);
  const itensRasc = [];
  for (let i = 1; i <= 46; i += 1) {
    const it = itemLinha(i);
    itensRasc.push({
      compra_item_id: it.id,
      produto_id: it.produto_id,
      produto_nome: it.nome,
      quantidade: it.qtd,
      valor_unitario: 10,
      ncm: '82041100',
      unidade: 'UN'
    });
  }
  await salvarRascunhoDevolucaoCompra(2, {
    itens: itensRasc,
    cfop: '5202',
    observacoes: montarObservacaoSubstituicao({
      numero: 100, serie: 1, chaveAnterior: CHAVE_100, chaveCompra: CHAVE_COMPRA
    }),
    fornecedor: 'FORN',
    chave_nfe_original: CHAVE_COMPRA,
    origem_nfe_devolucao_id: 11,
    documento_original_id: 11
  });
  const rasc = await get(conn, `SELECT id FROM nfe_devolucao_compra_rascunhos WHERE compra_id=2`);
  await criarRelacaoSubstituicao({
    notaAnterior: { id: 11, compra_id: 2, chave_acesso: CHAVE_100, numero: 100, serie: 1 },
    rascunhoId: rasc.id,
    manifestacao: manif,
    observacao: montarObservacaoSubstituicao({
      numero: 100, serie: 1, chaveAnterior: CHAVE_100, chaveCompra: CHAVE_COMPRA
    }),
    usuarioNome: 'teste'
  });
});

after(async () => {
  console.info = origInfo;
  setDbSaldo(null);
  setDbSubst(null);
  setDbRasc(null);
  setDbEmit(null);
  await new Promise((r) => conn.close(() => r()));
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
});

describe('fluxo real emitirNFeDevolucaoCompra', () => {
  it('produção: sem linha em nfe_devolucao_manifestacoes, 210240 no rascunho/auditoria, saldo equivalente PERMITE', async () => {
    await run(conn, `DELETE FROM nfe_devolucao_manifestacoes`);
    await run(conn, `CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY, acao TEXT, referencia_tipo TEXT, referencia_id INTEGER, detalhes TEXT
    )`);
    await run(conn, `INSERT INTO auditoria (acao, referencia_tipo, referencia_id, detalhes)
      VALUES ('REGISTRO_MANIFESTACAO_210240', 'nfe_devolucao_compra', 11, '{"tp_evento":"210240"}')`);
    const out = await emitirComoUsuario([{
      compra_item_id: 1,
      produto_id: 10,
      produto_nome: 'AL_CRIMP_DUP',
      quantidade: 5,
      valor_unitario: 10,
      ncm: '82041100',
      n_item_origem: 1,
      nItemOrigem: 1,
      csosn: '102',
      cst_pis: '07',
      cst_cofins: '07'
    }]);
    assert.notEqual(out.code, 'SALDO_INSUFICIENTE');
    assert.equal(out.status, 'xml_montado_sem_transmissao');
    const crimp = (out.calculo && out.calculo.itens || []).find((i) => i.compra_item_id === 1);
    assert.equal(crimp.saldoDisponivel, 5);
    assert.equal(crimp.resultado, 'PERMITIDO');
  });

  it('AL_CRIMP_DUP 5/0/5 passa validação e monta XML sem transmitir', async () => {
    const out = await emitirComoUsuario([{
      compra_item_id: 1,
      produto_id: 10,
      produto_nome: 'AL_CRIMP_DUP',
      quantidade: 5,
      valor_unitario: 10,
      ncm: '82041100',
      n_item_origem: 1,
      nItemOrigem: 1,
      csosn: '102',
      cst_pis: '07',
      cst_cofins: '07'
    }]);
    assert.notEqual(out.code, 'SALDO_INSUFICIENTE');
    assert.notEqual(out.code, 'SALDO_ZERADO');
    assert.equal(out.status, 'xml_montado_sem_transmissao');
    assert.equal(out.transmitido, false);
    assert.equal(out.validacaoSaldoOk, true);
    const crimp = (out.calculo && out.calculo.itens || []).find((i) => i.compra_item_id === 1);
    assert.ok(crimp);
    assert.equal(crimp.saldoNormal, 0);
    assert.equal(crimp.restanteExcecao, 5);
    assert.equal(crimp.saldoDisponivel, 5);
    assert.equal(crimp.quantidadeSolicitada, 5);
    assert.equal(crimp.resultado, 'PERMITIDO');
    assert.equal(out.refNFe, CHAVE_COMPRA);
    assert.match(String(out.xml || ''), /<infAdic>/);
    assert.match(String(out.xml || ''), /<infCpl>/);
    assert.match(String(out.xml || ''), /210240/);
    assert.match(String(out.xml || ''), new RegExp(CHAVE_100));
    assert.match(String(out.xml || ''), new RegExp(CHAVE_COMPRA));
    assert.match(String(out.xml || ''), new RegExp(`<NFref><refNFe>${CHAVE_COMPRA}</refNFe></NFref>`));
    assert.doesNotMatch(String(out.xml || ''), /<DFeReferenciado>/);
    assert.doesNotMatch(String(out.xml || ''), new RegExp(`<refNFe>${CHAVE_100}</refNFe>`));
    const n100 = await get(conn, `SELECT status, protocolo, chave_acesso, xml_autorizado FROM nfe_devolucoes_compra WHERE id=11`);
    assert.equal(n100.status, 'autorizada');
    assert.equal(n100.protocolo, '223260092164139');
    assert.equal(n100.chave_acesso, CHAVE_100);
    assert.equal(n100.xml_autorizado, '<nfe>NF100</nfe>');

    const traceItem = traces.find((a) => String(a[0]).includes('[DEVOLUCAO][TRACE_210240]')
      && String(a[1]).includes('AL_CRIMP_DUP')
      && String(a[1]).includes('PERMITIDO'));
    assert.ok(traceItem, 'TRACE_210240 do item AL_CRIMP_DUP');
    const payload = JSON.parse(traceItem[1]);
    assert.equal(payload.saldoNormal, 0);
    assert.equal(payload.restanteExcecao, 5);
    assert.equal(payload.saldoDisponivel, 5);
    assert.equal(payload.quantidadeSolicitada, 5);
    assert.equal(payload.resultado, 'PERMITIDO');
  });

  it('46 itens da NF 100 passam pelo saldo equivalente', async () => {
    const itens = [];
    for (let i = 1; i <= 46; i += 1) {
      const it = itemLinha(i);
      itens.push({
        compra_item_id: it.id,
        produto_id: it.produto_id,
        produto_nome: it.nome,
        quantidade: it.qtd,
        valor_unitario: 10,
        ncm: '82041100',
        n_item_origem: i,
        nItemOrigem: i,
        csosn: '102',
        cst_pis: '07',
        cst_cofins: '07'
      });
    }
    const out = await emitirComoUsuario(itens);
    assert.equal(out.status, 'xml_montado_sem_transmissao');
    assert.equal(out.calculo.itens.length, 46);
    for (const l of out.calculo.itens) {
      assert.equal(l.resultado, 'PERMITIDO', l.produto);
      assert.ok(l.saldoNormal === 0);
      assert.ok(l.restanteExcecao > 0);
    }
  });

  it('excesso 6 em AL_CRIMP_DUP bloqueia', async () => {
    await assert.rejects(
      () => emitirComoUsuario([{
        compra_item_id: 1,
        produto_id: 10,
        produto_nome: 'AL_CRIMP_DUP',
        quantidade: 6,
        valor_unitario: 10
      }]),
      (err) => {
        assert.equal(err.code, 'SALDO_INSUFICIENTE');
        assert.match(String(err.message), /saldo 5/i);
        assert.match(String(err.message), /solicitado 6/i);
        return true;
      }
    );
  });

  it('rejeição não consome; autorização consome', async () => {
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, status)
      VALUES (201, 2, 201, 1, '23260857824986000131550010000002010111111111', 'rejeitada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, quantidade)
      VALUES (201, 2, 1, 10, 5)`);
    const rej = await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 11, novaDevolucaoId: 201
    });
    assert.equal(rej.efetivada, false);
    const ainda = await emitirComoUsuario([{
      compra_item_id: 1, produto_id: 10, produto_nome: 'AL_CRIMP_DUP',       quantidade: 5, valor_unitario: 10, n_item_origem: 1, nItemOrigem: 1
    }]);
    assert.equal(ainda.status, 'xml_montado_sem_transmissao');

    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (202, 2, 202, 1, '23260857824986000131550010000002020111111111', 'P202', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, quantidade)
      VALUES (202, 2, 1, 10, 5)`);
    const rasc = await get(conn, `SELECT id FROM nfe_devolucao_compra_rascunhos WHERE compra_id=2`);
    const ok = await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 11, novaDevolucaoId: 202, rascunhoId: rasc.id
    });
    assert.equal(ok.efetivada, true);
    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11, compraId: 2 });
    assert.equal(ex.restantePorItem[1], 0);
    await assert.rejects(
      () => emitirComoUsuario([{
        compra_item_id: 1, produto_id: 10, produto_nome: 'AL_CRIMP_DUP', quantidade: 1, valor_unitario: 10
      }]),
      (err) => {
        assert.equal(err.code, 'SALDO_INSUFICIENTE');
        assert.match(String(err.message), /já foi utilizada em uma nova NF-e de devolução relacionada à NF-e 100/);
        return true;
      }
    );
    const n100 = await get(conn, `SELECT status, chave_acesso FROM nfe_devolucoes_compra WHERE id=11`);
    assert.equal(n100.status, 'autorizada');
    assert.equal(n100.chave_acesso, CHAVE_100);
  });
});
