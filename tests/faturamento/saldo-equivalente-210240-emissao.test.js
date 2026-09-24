/**
 * PATCH — saldo equivalente 210240 na validação de emissão.
 * Não transmite SEFAZ e não altera a NF 100 real.
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
  garantirTabelasSaldoDevolucao,
  carregarSaldosDevolucaoCompra,
  validarQuantidadesContraSaldo
} = require('../../backend/services/fiscal/controleSaldoDevolucaoCompra');
const {
  setDbForTests: setDbSubst,
  garantirTabelasSubstituicaoDevolucao,
  registrarManifestacaoDevolucao,
  criarRelacaoSubstituicao,
  resolverOrigemSubstituicao210240,
  resolverExcecaoSaldoManifestacao210240,
  calcularSaldoDisponivelParaDevolucao,
  efetivarSubstituicaoAposAutorizacao,
  montarObservacaoSubstituicao,
  ORIGEM_XML
} = require('../../backend/services/fiscal/nfeDevolucaoSubstituicaoService');
const { buildXmlNFeDevolucaoCompra } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const CHAVE_COMPRA = '42260707670414000258550010000158601949669171';
const CHAVE_100 = '23260857824986000131550010000001001956868253';

const XML_210240 = `
<procEventoNFe>
  <evento>
    <infEvento>
      <CNPJ>07670414000258</CNPJ>
      <chNFe>${CHAVE_100}</chNFe>
      <dhEvento>2026-09-23T10:00:00-03:00</dhEvento>
      <tpEvento>210240</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento>
        <descEvento>Operacao nao Realizada</descEvento>
        <xJust>Divergencia de valores</xJust>
      </detEvento>
    </infEvento>
  </evento>
  <retEvento>
    <infEvento>
      <cStat>135</cStat>
      <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
      <nProt>123456789012345</nProt>
    </infEvento>
  </retEvento>
</procEventoNFe>`;

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

const tmp = path.join(os.tmpdir(), `cds-210240-emit-${Date.now()}.db`);
let conn;
const logs = [];
const origInfo = console.info;

async function validarComoEmissao(itens, rascunho, origemDevolucaoId) {
  const calc = await calcularSaldoDisponivelParaDevolucao({
    compraId: 2,
    origemDevolucaoId,
    rascunho,
    itensSolicitados: itens,
    carregarSaldos: carregarSaldosDevolucaoCompra
  });
  const val = validarQuantidadesContraSaldo({
    saldos: calc.saldos,
    itensSolicitados: itens,
    compraCancelada: calc.saldos.compraCancelada,
    excecaoSubstituicao: calc.excecao
  });
  return { calc, val };
}

before(async () => {
  conn = await openDb(tmp);
  setDbSaldo(conn);
  setDbSubst(conn);
  console.info = (...args) => {
    logs.push(args);
    origInfo.apply(console, args);
  };

  await run(conn, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, ncm TEXT, unidade TEXT)`);
  await run(conn, `CREATE TABLE compras (id INTEGER PRIMARY KEY, status TEXT, chave_acesso TEXT, numero_nf TEXT)`);
  await run(conn, `CREATE TABLE compras_itens (
    id INTEGER PRIMARY KEY, compra_id INTEGER, produto_id INTEGER, quantidade REAL,
    preco_unitario REAL, custo_unitario_final REAL, ncm TEXT, unidade TEXT,
    descricao_produto TEXT, codigo_barras TEXT
  )`);
  await run(conn, `CREATE TABLE nfe_devolucoes_compra (
    id INTEGER PRIMARY KEY, compra_id INTEGER, numero INTEGER, serie INTEGER,
    chave_acesso TEXT, protocolo TEXT, status TEXT, xml_autorizado TEXT
  )`);
  await run(conn, `CREATE TABLE nfe_devolucao_compra_rascunhos (
    id INTEGER PRIMARY KEY, compra_id INTEGER, origem_nfe_devolucao_id INTEGER,
    documento_original_id INTEGER, itens_json TEXT
  )`);
  await run(conn, `INSERT INTO compras (id, status, chave_acesso, numero_nf) VALUES (2, 'finalizada', ?, '15860')`, [CHAVE_COMPRA]);
  await run(conn, `INSERT INTO produtos (id, nome, codigo) VALUES (10, 'AL_CRIMP_DUP', 'AL_CRIMP_DUP')`);
  await run(conn, `INSERT INTO produtos (id, nome, codigo) VALUES (11, 'PROD_B', 'PROD_B')`);
  await run(conn, `INSERT INTO produtos (id, nome, codigo) VALUES (12, 'PROD_C', 'PROD_C')`);
  await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, descricao_produto, unidade)
    VALUES (1, 2, 10, 5, 15.88, 'AL_CRIMP_DUP', 'UN')`);
  await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, descricao_produto, unidade)
    VALUES (2, 2, 11, 4, 10, 'PROD_B', 'UN')`);
  await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, descricao_produto, unidade)
    VALUES (3, 2, 12, 5, 8, 'PROD_C', 'UN')`);
  await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status, xml_autorizado)
    VALUES (11, 2, 100, 1, ?, '223260092164139', 'autorizada', '<nfe>NF100</nfe>')`, [CHAVE_100]);
  await garantirTabelasSaldoDevolucao();
  await garantirTabelasSubstituicaoDevolucao();
  await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
    VALUES (11, 2, 1, 10, 1, 5)`);
  await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
    VALUES (11, 2, 2, 11, 2, 4)`);
  await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
    VALUES (11, 2, 3, 12, 3, 5)`);
  await run(conn, `INSERT INTO nfe_devolucao_compra_rascunhos
    (id, compra_id, origem_nfe_devolucao_id, documento_original_id)
    VALUES (18, 2, 11, 11)`);

  await registrarManifestacaoDevolucao(11, { xmlEvento: XML_210240 });
  const manif = await get(conn, `SELECT * FROM nfe_devolucao_manifestacoes WHERE tp_evento='210240' ORDER BY id DESC LIMIT 1`);
  await criarRelacaoSubstituicao({
    notaAnterior: { id: 11, compra_id: 2, chave_acesso: CHAVE_100, numero: 100, serie: 1 },
    rascunhoId: 18,
    manifestacao: manif,
    observacao: montarObservacaoSubstituicao({ numero: 100, serie: 1 }),
    usuarioNome: 'teste'
  });
});

after(async () => {
  console.info = origInfo;
  setDbSaldo(null);
  setDbSubst(null);
  await new Promise((r) => conn.close(() => r()));
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
});

describe('contexto NF 100 no rascunho', () => {
  it('recupera notaAnterior, chave e 210240 sem depender da UI', async () => {
    const rascunho = { id: 18, origem_nfe_devolucao_id: 11, documento_original_id: 11 };
    const origem = await resolverOrigemSubstituicao210240({ compraId: 2, rascunho });
    assert.equal(origem.origemDevolucaoId, 11);
    assert.ok(origem.manifestacao);
    assert.equal(String(origem.manifestacao.tp_evento), '210240');

    const soRelacao = await resolverOrigemSubstituicao210240({
      compraId: 2,
      rascunho: { id: 18 }
    });
    assert.equal(soRelacao.origemDevolucaoId, 11);
  });
});

describe('caso real AL_CRIMP_DUP / NF 100', () => {
  it('saldo normal 0 + exceção 5 = disponível 5 e validarQuantidadesContraSaldo OK', async () => {
    const itens = [{
      compra_item_id: 1,
      produto_id: 10,
      produto_nome: 'AL_CRIMP_DUP',
      quantidade: 5
    }];
    const { calc, val } = await validarComoEmissao(itens, { id: 18, origem_nfe_devolucao_id: 11 });
    const linha = calc.itens[0];
    assert.equal(calc.excecao.aplicar, true);
    assert.equal(linha.saldoNormal, 0);
    assert.equal(linha.restanteExcecao, 5);
    assert.equal(linha.saldoDisponivel, 5);
    assert.equal(linha.quantidadeSolicitada, 5);
    assert.equal(linha.resultado, 'PERMITIDO');
    assert.equal(val.ok, true);
    assert.equal(val.erros.length, 0);

    const logLinha = logs.find((a) => String(a[0]).includes('[DEVOLUCAO][SALDO_210240]'));
    assert.ok(logLinha, 'log SALDO_210240 obrigatório');
    const payload = JSON.parse(logLinha[1]);
    assert.equal(Number(payload.notaAnterior), 100);
    assert.equal(payload.chaveAnterior, CHAVE_100);
    assert.equal(payload.produto, 'AL_CRIMP_DUP');
    assert.equal(payload.saldoNormal, 0);
    assert.equal(payload.quantidadeNFAnterior, 5);
    assert.equal(payload.quantidadeJaSubstituida, 0);
    assert.equal(payload.restanteExcecao, 5);
    assert.equal(payload.saldoDisponivel, 5);
    assert.equal(payload.quantidadeSolicitada, 5);
    assert.equal(payload.resultado, 'PERMITIDO');
  });
});

describe('devolução completa — todos os itens via equivalente', () => {
  it('cada item da NF 100 passa pelo saldo equivalente, nenhum fica só no saldo normal', async () => {
    const itens = [
      { compra_item_id: 1, produto_id: 10, produto_nome: 'AL_CRIMP_DUP', quantidade: 5 },
      { compra_item_id: 2, produto_id: 11, produto_nome: 'PROD_B', quantidade: 4 },
      { compra_item_id: 3, produto_id: 12, produto_nome: 'PROD_C', quantidade: 5 }
    ];
    const { calc, val } = await validarComoEmissao(itens, { id: 18, origem_nfe_devolucao_id: 11 });
    assert.equal(val.ok, true);
    assert.equal(calc.itens.length, 3);
    for (const l of calc.itens) {
      assert.equal(l.saldoNormal, 0, `${l.produto} ainda no saldo normal`);
      assert.ok(l.restanteExcecao > 0, `${l.produto} sem exceção`);
      assert.equal(l.saldoDisponivel, l.quantidadeSolicitada);
      assert.equal(l.resultado, 'PERMITIDO');
    }
  });

  it('produto C solicitado 6 com disponível 5 bloqueia', async () => {
    const itens = [{ compra_item_id: 3, produto_id: 12, produto_nome: 'PROD_C', quantidade: 6 }];
    const { calc, val } = await validarComoEmissao(itens, { id: 18, origem_nfe_devolucao_id: 11 });
    assert.equal(calc.itens[0].resultado, 'BLOQUEADO');
    assert.equal(val.ok, false);
  });
});

describe('rejeição não consome', () => {
  it('NF nova rejeitada mantém exceção 5 e nova tentativa passa', async () => {
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (31, 2, 201, 1, '23260857824986000131550010000002010111111111', NULL, 'rejeitada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (31, 2, 1, 10, 1, 5)`);
    const efetivar = await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 11,
      novaDevolucaoId: 31,
      rascunhoId: 18
    });
    assert.equal(efetivar.efetivada, false);
    const { val } = await validarComoEmissao(
      [{ compra_item_id: 1, produto_id: 10, produto_nome: 'AL_CRIMP_DUP', quantidade: 5 }],
      { id: 18, origem_nfe_devolucao_id: 11 }
    );
    assert.equal(val.ok, true);
  });
});

describe('reutilização após autorização', () => {
  it('consome 5; tentativa extra bloqueia com mensagem da NF 100', async () => {
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (32, 2, 202, 1, '23260857824986000131550010000002020111111111', 'P1', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (32, 2, 1, 10, 1, 5)`);
    const ok = await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 11,
      novaDevolucaoId: 32,
      rascunhoId: 18
    });
    assert.equal(ok.efetivada, true);
    const { calc, val } = await validarComoEmissao(
      [{ compra_item_id: 1, produto_id: 10, produto_nome: 'AL_CRIMP_DUP', quantidade: 1 }],
      { id: 18, origem_nfe_devolucao_id: 11 }
    );
    assert.equal(calc.excecao.restantePorItem[1], 0);
    assert.equal(val.ok, false);
    assert.match(val.erros.join(' '), /já foi utilizada em uma nova NF-e de devolução relacionada à NF-e 100/);
    const n100 = await get(conn, `SELECT status, protocolo, chave_acesso, xml_autorizado FROM nfe_devolucoes_compra WHERE id=11`);
    assert.equal(n100.status, 'autorizada');
    assert.equal(n100.protocolo, '223260092164139');
    assert.equal(n100.chave_acesso, CHAVE_100);
    assert.equal(n100.xml_autorizado, '<nfe>NF100</nfe>');
  });
});

describe('parcial em outra compra isolada', () => {
  it('10 → 6 autorizada restante 4; 4 ok; 1 extra bloqueia', async () => {
    await run(conn, `INSERT INTO compras (id, status, chave_acesso, numero_nf) VALUES (3, 'finalizada', ?, '200')`, [CHAVE_COMPRA]);
    await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, descricao_produto)
      VALUES (30, 3, 10, 10, 1, 'AL_CRIMP_DUP')`);
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (40, 3, 300, 1, '23260857824986000131550010000003000111111111', 'P300', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (40, 3, 30, 10, 1, 10)`);
    await registrarManifestacaoDevolucao(40, {
      informadoUsuario: true,
      nProt: 'P300-210240',
      xJust: 'Parcial isolada'
    });
    const manif = await get(conn, `SELECT * FROM nfe_devolucao_manifestacoes WHERE nfe_devolucao_id=40`);
    await criarRelacaoSubstituicao({
      notaAnterior: { id: 40, compra_id: 3, chave_acesso: '23260857824986000131550010000003000111111111', numero: 300, serie: 1 },
      rascunhoId: 80,
      manifestacao: manif,
      observacao: 'parcial',
      usuarioNome: 'teste'
    });
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (41, 3, 301, 1, '23260857824986000131550010000003010111111111', 'P301', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (41, 3, 30, 10, 1, 6)`);
    await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 40,
      novaDevolucaoId: 41,
      rascunhoId: 80
    });

    const calc4 = await calcularSaldoDisponivelParaDevolucao({
      compraId: 3,
      origemDevolucaoId: 40,
      itensSolicitados: [{ compra_item_id: 30, produto_id: 10, quantidade: 4 }],
      carregarSaldos: carregarSaldosDevolucaoCompra
    });
    const ok4 = validarQuantidadesContraSaldo({
      saldos: calc4.saldos,
      itensSolicitados: [{ compra_item_id: 30, quantidade: 4 }],
      excecaoSubstituicao: calc4.excecao
    });
    assert.equal(calc4.excecao.quantidadeRestante, 4);
    assert.equal(ok4.ok, true);

    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (42, 3, 302, 1, '23260857824986000131550010000003020111111111', 'P302', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (42, 3, 30, 10, 1, 4)`);
    await run(conn, `INSERT INTO nfe_devolucoes_substituicoes
      (devolucao_anterior_id, nova_devolucao_id, compra_id, tipo_relacao, tp_evento, desc_evento, efetivada)
      VALUES (40, 42, 3, 'MANIFESTACAO_210240', '210240', 'Operação não Realizada', 1)`);

    const calc1 = await calcularSaldoDisponivelParaDevolucao({
      compraId: 3,
      origemDevolucaoId: 40,
      itensSolicitados: [{ compra_item_id: 30, produto_id: 10, quantidade: 1 }],
      carregarSaldos: carregarSaldosDevolucaoCompra
    });
    const bloq = validarQuantidadesContraSaldo({
      saldos: calc1.saldos,
      itensSolicitados: [{ compra_item_id: 30, quantidade: 1 }],
      excecaoSubstituicao: calc1.excecao
    });
    assert.equal(calc1.excecao.quantidadeRestante, 0);
    assert.equal(bloq.ok, false);
  });
});

describe('sem 210240 e evento diferente', () => {
  it('sem manifestação 210240 permanece SALDO_INSUFICIENTE', async () => {
    await run(conn, `INSERT INTO compras (id, status) VALUES (4, 'finalizada')`);
    await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, descricao_produto)
      VALUES (40, 4, 10, 5, 1, 'AL_CRIMP_DUP')`);
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, status)
      VALUES (50, 4, 400, 1, 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, quantidade)
      VALUES (50, 4, 40, 10, 5)`);
    const calc = await calcularSaldoDisponivelParaDevolucao({
      compraId: 4,
      origemDevolucaoId: 50,
      itensSolicitados: [{ compra_item_id: 40, produto_id: 10, quantidade: 5 }],
      carregarSaldos: carregarSaldosDevolucaoCompra
    });
    assert.equal(calc.excecao.aplicar, false);
    const val = validarQuantidadesContraSaldo({
      saldos: calc.saldos,
      itensSolicitados: [{ compra_item_id: 40, quantidade: 5 }],
      excecaoSubstituicao: calc.excecao
    });
    assert.equal(val.ok, false);
    assert.match(val.erros.join(' '), /Saldo insuficiente/);
  });

  it('210220 não aplica exceção', async () => {
    await run(conn, `INSERT INTO compras (id, status) VALUES (5, 'finalizada')`);
    await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario)
      VALUES (50, 5, 10, 5, 1)`);
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, status)
      VALUES (60, 5, 500, 1, 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, quantidade)
      VALUES (60, 5, 50, 10, 5)`);
    await run(conn, `INSERT INTO nfe_devolucao_manifestacoes
      (nfe_devolucao_id, chave_nfe, tp_evento, desc_evento, origem_registro, validado_sistema)
      VALUES (60, 'x', '210220', 'Confirmacao da Operacao', 'XML_SEFAZ', 1)`);
    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 60 });
    assert.equal(ex.aplicar, false);
    assert.equal(ex.motivo, 'manifestacao_diferente');
  });
});

describe('XML infCpl preservado', () => {
  it('observação vai para infAdic/infCpl; origem continua 15860; sem NFref da 100', () => {
    const obs = montarObservacaoSubstituicao({
      numero: 100, serie: 1, chaveAnterior: CHAVE_100, chaveCompra: CHAVE_COMPRA
    });
    const built = buildXmlNFeDevolucaoCompra({
      config: {
        codigoUf: '23', cnpj: '57824986000131', ie: '1', crt: 1, ambiente: 1, serie: 1,
        nomeEmpresa: 'X', logradouro: 'R', numero: '1', bairro: 'B',
        municipioCodigo: '2307304', municipioNome: 'JUAZEIRO DO NORTE', uf: 'CE',
        cep: '63000000', telefone: '1'
      },
      compra: {
        id: 2,
        chave_acesso: CHAVE_COMPRA,
        numero_nf: '15860',
        fornecedor: 'FORN',
        fornecedor_cnpj: '07670414000258',
        cidade: 'Joinville',
        uf: 'SC'
      },
      itens: [{
        produto_nome: 'AL_CRIMP_DUP', quantidade: 5, valor_unitario: 10, nItemOrigem: 3,
        csosn: '102', ncm: '82041100', cst_pis: '07', cst_cofins: '07'
      }],
      numero: 102,
      observacoes: obs
    });
    const xml = built.xmlSemAssinatura;
    assert.match(xml, /<infAdic>/);
    assert.match(xml, /<infCpl>/);
    assert.match(xml, /NF-e no 100/);
    assert.match(xml, /210240/);
    assert.match(xml, new RegExp(`<refNFe>${CHAVE_COMPRA}</refNFe>`));
    assert.match(xml, new RegExp(`<NFref><refNFe>${CHAVE_COMPRA}</refNFe></NFref>`));
    assert.doesNotMatch(xml, /<DFeReferenciado>/);
    assert.match(xml, new RegExp(CHAVE_100));
    assert.equal(built.infCpl, obs);
  });
});
