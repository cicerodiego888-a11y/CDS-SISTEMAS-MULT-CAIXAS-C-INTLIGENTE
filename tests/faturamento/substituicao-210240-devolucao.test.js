/**
 * Auditoria final — substituição 210240, saldo por item e infCpl.
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
  parsearXmlEventoManifestacao,
  montarObservacaoSubstituicao,
  registrarManifestacaoDevolucao,
  resolverExcecaoSaldoManifestacao210240,
  aplicarRestanteExcecaoNosSaldos,
  criarRelacaoSubstituicao,
  efetivarSubstituicaoAposAutorizacao,
  montarBlocoDevolucaoRelacionada,
  ORIGEM_MANUAL,
  ORIGEM_XML
} = require('../../backend/services/fiscal/nfeDevolucaoSubstituicaoService');
const { classificarResultadoEmissaoNfe } = require('../../backend/services/fiscal/classificarResultadoEmissaoNfe');
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

const tmp = path.join(os.tmpdir(), `cds-210240-audit-${Date.now()}.db`);
let conn;

const configXml = {
  codigoUf: '23', cnpj: '57824986000131', ie: '1', crt: 1, ambiente: 1, serie: 1,
  nomeEmpresa: 'X', logradouro: 'R', numero: '1', bairro: 'B',
  municipioCodigo: '2307304', municipioNome: 'JUAZEIRO DO NORTE', uf: 'CE',
  cep: '63000000', telefone: '1'
};

function gerarXml(obs) {
  return buildXmlNFeDevolucaoCompra({
    config: configXml,
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
      produto_nome: 'A', quantidade: 5, valor_unitario: 10, nItemOrigem: 3,
      csosn: '102', ncm: '82041100', cst_pis: '07', cst_cofins: '07'
    }],
    numero: 102,
    observacoes: obs
  });
}

async function seed(qtdCompra = 5, qtdNf100 = 5) {
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
  await run(conn, `INSERT INTO compras (id, status, chave_acesso, numero_nf) VALUES (2, 'finalizada', ?, '15860')`, [CHAVE_COMPRA]);
  await run(conn, `INSERT INTO compras_itens (id, compra_id, produto_id, quantidade, preco_unitario, descricao_produto, unidade)
    VALUES (1, 2, 10, ?, 15.88, 'PROD A', 'UN')`, [qtdCompra]);
  await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
    VALUES (11, 2, 100, 1, ?, '223260092164139', 'autorizada')`, [CHAVE_100]);
  await garantirTabelasSaldoDevolucao();
  await garantirTabelasSubstituicaoDevolucao();
  await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
    VALUES (11, 2, 1, 10, 1, ?)`, [qtdNf100]);
}

before(async () => {
  conn = await openDb(tmp);
  setDbSaldo(conn);
  setDbSubst(conn);
  await seed(10, 10);
});

after(async () => {
  setDbSaldo(null);
  setDbSubst(null);
  await new Promise((r) => conn.close(() => r()));
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
});

async function snapshot100() {
  return get(conn, `SELECT status, protocolo, chave_acesso, xml_autorizado FROM nfe_devolucoes_compra WHERE id = 11`);
}

describe('1) AUTORIZADA sem 210240 bloqueia', () => {
  it('saldo normal zerado e exceção não aplica', async () => {
    const saldos = await carregarSaldosDevolucaoCompra(2, { naoExcluirSubstituidas: true });
    assert.equal(saldos.totais.saldo, 0);
    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11 });
    assert.equal(ex.aplicar, false);
    const val = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 10 }]
    });
    assert.equal(val.ok, false);
  });
});

describe('2 / 9 / 16) 210240 libera e NF 100 permanece AUTORIZADA', () => {
  it('XML validado vs manual; status da 100 inalterado', async () => {
    const parsed = parsearXmlEventoManifestacao(XML_210240);
    assert.equal(parsed.tpEvento, '210240');
    assert.equal(parsed.chaveNfe, CHAVE_100);
    assert.equal(parsed.cnpjManifestante, '07670414000258');
    assert.equal(parsed.nSeqEvento, 1);
    assert.equal(parsed.nProt, '123456789012345');
    assert.equal(parsed.cStat, '135');

    const antes = await snapshot100();
    const xmlReg = await registrarManifestacaoDevolucao(11, { xmlEvento: XML_210240 });
    assert.equal(xmlReg.validadoSistema, true);
    assert.equal(xmlReg.origemRegistro, ORIGEM_XML);

    const manual = await registrarManifestacaoDevolucao(11, {
      informadoUsuario: true,
      nProt: 'MANUAL-1',
      xJust: 'Informado pelo operador'
    });
    assert.equal(manual.validadoSistema, false);
    assert.equal(manual.origemRegistro, ORIGEM_MANUAL);
    assert.match(manual.avisoManual, /não é evento SEFAZ validado/i);

    const depois = await snapshot100();
    assert.equal(depois.status, 'autorizada');
    assert.equal(depois.protocolo, antes.protocolo);
    assert.equal(depois.chave_acesso, CHAVE_100);

    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11 });
    assert.equal(ex.aplicar, true);
    assert.equal(ex.quantidadeRestante, 10);
    assert.equal(ex.consumida, false);
    assert.equal(ex.notaAnterior.status, 'autorizada');
  });
});

describe('3) rascunho não consome exceção', () => {
  it('criar relação deixa restante intacto', async () => {
    const manif = await get(conn, `SELECT * FROM nfe_devolucao_manifestacoes WHERE tp_evento='210240' ORDER BY id DESC LIMIT 1`);
    const rel = await criarRelacaoSubstituicao({
      notaAnterior: { id: 11, compra_id: 2, chave_acesso: CHAVE_100, numero: 100, serie: 1 },
      rascunhoId: 18,
      manifestacao: manif,
      observacao: montarObservacaoSubstituicao({ numero: 100, serie: 1 }),
      usuarioNome: 'teste'
    });
    assert.equal(rel.tipo_relacao, 'MANIFESTACAO_210240');
    assert.equal(Number(rel.efetivada || 0), 0);
    assert.equal(rel.nova_devolucao_id, null);
    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11 });
    assert.equal(ex.quantidadeRestante, 10);
    assert.equal(ex.consumida, false);
  });
});

describe('4) rejeição não consome', () => {
  it('NF nova rejeitada não reduz restante', async () => {
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (21, 2, 103, 1, '23260857824986000131550010000001030111111111', NULL, 'rejeitada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (21, 2, 1, 10, 1, 10)`);
    const efetivar = await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 11,
      novaDevolucaoId: 21,
      rascunhoId: 18
    });
    assert.equal(efetivar.efetivada, false);
    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11 });
    assert.equal(ex.quantidadeRestante, 10);
    const n100 = await snapshot100();
    assert.equal(n100.status, 'autorizada');
  });
});

describe('5–8) consumo parcial e reutilização', () => {
  it('autorizada consome; segunda tentativa e excesso bloqueiam; restante parcial ok', async () => {
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (22, 2, 104, 1, '23260857824986000131550010000001040111111111', '9', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (22, 2, 1, 10, 1, 6)`);
    const ok = await efetivarSubstituicaoAposAutorizacao({
      devolucaoAnteriorId: 11,
      novaDevolucaoId: 22,
      rascunhoId: 18
    });
    assert.equal(ok.efetivada, true);

    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11 });
    assert.equal(ex.quantidadeConsumida, 6);
    assert.equal(ex.quantidadeRestante, 4);
    assert.equal(ex.consumida, false);

    const normais = await carregarSaldosDevolucaoCompra(2, { naoExcluirSubstituidas: true });
    const saldos = aplicarRestanteExcecaoNosSaldos(normais, ex);
    assert.equal(saldos.itens[0].quantidade_liberada_substituicao, 4);
    assert.equal(saldos.itens[0].saldo, 4);

    const parcial = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 4 }],
      excecaoSubstituicao: ex
    });
    assert.equal(parcial.ok, true);

    const excesso = validarQuantidadesContraSaldo({
      saldos,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 5 }],
      excecaoSubstituicao: ex
    });
    assert.equal(excesso.ok, false);

    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (23, 2, 105, 1, '23260857824986000131550010000001050111111111', '10', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_compra_itens (nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item, quantidade)
      VALUES (23, 2, 1, 10, 1, 4)`);
    await run(conn, `INSERT INTO nfe_devolucoes_substituicoes
      (devolucao_anterior_id, nova_devolucao_id, compra_id, chave_nfe_anterior, tipo_relacao, tp_evento, desc_evento, efetivada)
      VALUES (11, 23, 2, ?, 'MANIFESTACAO_210240', '210240', 'Operação não Realizada', 1)`, [CHAVE_100]);

    const ex2 = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 11 });
    assert.equal(ex2.quantidadeRestante, 0);
    assert.equal(ex2.consumida, true);
    const saldos2 = aplicarRestanteExcecaoNosSaldos(
      await carregarSaldosDevolucaoCompra(2, { naoExcluirSubstituidas: true }),
      ex2
    );
    const reuse = validarQuantidadesContraSaldo({
      saldos: saldos2,
      itensSolicitados: [{ compra_item_id: 1, quantidade: 1 }],
      excecaoSubstituicao: ex2
    });
    assert.equal(reuse.ok, false);
    assert.match(reuse.erros.join(' '), /já foi utilizada em uma nova NF-e de devolução relacionada à NF-e 100/);

    const n100 = await snapshot100();
    assert.equal(n100.status, 'autorizada');
    assert.equal(n100.protocolo, '223260092164139');
  });
});

describe('10–12) XML infCpl e origem 15.860', () => {
  it('XML gerado contém infAdic/infCpl, NF 100 e não cancela; origem é 15860', () => {
    const padrao = montarObservacaoSubstituicao({
      numero: 100, serie: 1, chaveAnterior: CHAVE_100, chaveCompra: CHAVE_COMPRA
    });
    const built = gerarXml(padrao);
    const xml = built.xmlSemAssinatura;
    assert.match(xml, /<infAdic>/);
    assert.match(xml, /<infCpl>/);
    assert.match(xml, /NF-e no 100/);
    assert.match(xml, /serie 001/);
    assert.match(xml, /210240/);
    assert.doesNotMatch(xml, /cancelada/i);
    assert.match(xml, new RegExp(`<refNFe>${CHAVE_COMPRA}</refNFe>`));
    assert.match(xml, new RegExp(`<NFref><refNFe>${CHAVE_COMPRA}</refNFe></NFref>`));
    assert.doesNotMatch(xml, /<DFeReferenciado>/);
    assert.match(xml, new RegExp(CHAVE_100));
    assert.equal(built.infCpl, padrao);

    const editada = 'Nova NF-e emitida em substituicao operacional a NF-e 100 com valores corrigidos.';
    const built2 = gerarXml(editada);
    assert.match(built2.xmlSemAssinatura, /valores corrigidos/);
    assert.equal(built2.infCpl, editada);
  });
});

describe('13–14) classificação de emissão', () => {
  it('SALDO_INSUFICIENTE não é rejeição; rejeição SEFAZ mostra cStat', () => {
    const saldo = classificarResultadoEmissaoNfe({
      success: false,
      code: 'SALDO_INSUFICIENTE',
      status: 'erro_validacao',
      message: 'Saldo insuficiente'
    });
    assert.equal(saldo.rejeicaoSefaz, false);
    assert.match(saldo.titulo, /Não foi possível emitir/);

    const rej = classificarResultadoEmissaoNfe({
      success: false,
      status: 'rejeitada',
      cStat: '539',
      xMotivo: 'Duplicidade de NF-e'
    });
    assert.equal(rej.rejeicaoSefaz, true);
    assert.equal(rej.cStat, '539');
    assert.match(rej.titulo, /rejeitada pela SEFAZ/);
  });
});

describe('15) evento diferente não libera', () => {
  it('210220 não aplica', async () => {
    await run(conn, `INSERT INTO nfe_devolucoes_compra (id, compra_id, numero, serie, chave_acesso, protocolo, status)
      VALUES (99, 2, 99, 1, '23260857824986000131550010000000990111111111', '1', 'autorizada')`);
    await run(conn, `INSERT INTO nfe_devolucao_manifestacoes
      (nfe_devolucao_id, chave_nfe, tp_evento, desc_evento, origem_registro, validado_sistema)
      VALUES (99, '23260857824986000131550010000000990111111111', '210220', 'Confirmacao da Operacao', 'XML_SEFAZ', 1)`);
    const ex = await resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId: 99 });
    assert.equal(ex.aplicar, false);
    assert.equal(ex.motivo, 'manifestacao_diferente');
  });
});

describe('UI + relação', () => {
  it('bloco relacionado e infCpl na tela', () => {
    const bloco = montarBlocoDevolucaoRelacionada({
      aplicar: true,
      notaAnterior: { numero: 100, serie: 1, chave: CHAVE_100, status: 'autorizada' }
    });
    assert.equal(bloco.statusSefaz, 'AUTORIZADA');
    assert.match(bloco.aviso, /permanece AUTORIZADA/);
    const ui = fs.readFileSync(path.resolve(__dirname, '../../frontend/erp/js/nfe-devolucao-compra.js'), 'utf8');
    assert.match(ui, /DEVOLUÇÃO RELACIONADA/);
    assert.match(ui, /INFORMAÇÕES COMPLEMENTARES DA NF-e/);
    assert.match(ui, /infCpl/);
    const rasc = fs.readFileSync(path.resolve(__dirname, '../../backend/services/fiscal/rascunhoDevolucaoCompra.js'), 'utf8');
    assert.match(rasc, /slice\(0, 5000\)/);
  });
});
