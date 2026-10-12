'use strict';

/**
 * Sprint 2.9 — transações SQLite da correção de produto e da gravação da compra.
 * Central real → tela de Compras real (VM) → rotas reais → SQLite temporário (arquivo, WAL).
 *
 * Concorrência: a correção é pausada dentro da transação (antes do histórico) enquanto outro módulo
 * grava na conexão compartilhada; o rollback/commit de um não pode desfazer nem confirmar o outro.
 * Falha de COMMIT: chave estrangeira adiada (DEFERRABLE INITIALLY DEFERRED) violada por gatilho;
 * o SQLite só recusa no COMMIT. O estado gravado é conferido numa conexão nova, sem presumir rollback.
 */

const {
  DocumentoFiscalStatus,
  db,
  getDb,
  allDb,
  runDb,
  criarCentral,
  criarPaginaCompras
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const sqlite3 = require('sqlite3');
const { test } = require('node:test');
const request = require('supertest');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const { executarEmTransacao } = require('../../backend/services/fiscalNaoFiscal/estoqueSaldosPublico');

const USUARIO_ID = 1;
const CNPJ_TESTE = '11222333000181';
const GTIN_SUCO = '7898043929014';
const GTIN_ARROZ = '7898043929021';
const PRODUTO_A = { id: 9911, nome: 'SUCO SPRINT29 UVA 1L (CADASTRO A)', saldo: 3, gtin: GTIN_SUCO };
const PRODUTO_B = { id: 9912, nome: 'SUCO SPRINT29 UVA 1L (CADASTRO B)', saldo: 5, gtin: GTIN_SUCO };
const PRODUTO_C = { id: 9913, nome: 'ARROZ SPRINT29 5KG', saldo: 7, gtin: GTIN_ARROZ };
const LINHA_SUCO = { codigo: 'S29-SUCO-1L', gtin: GTIN_SUCO, nome: 'SUCO SPRINT29 UVA 1L', uCom: 'UN', qCom: 6, vUnCom: 7, uTrib: 'UN', qTrib: 6, vUnTrib: 7 };
const LINHA_ARROZ = { codigo: 'S29-ARROZ-5', gtin: GTIN_ARROZ, nome: 'ARROZ SPRINT29 5KG', uCom: 'UN', qCom: 10, vUnCom: 25, uTrib: 'UN', qTrib: 10, vUnTrib: 25 };
const MOTIVO = 'Cadastro B é duplicado; o certo é o A';

const sha = (texto) => crypto.createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex');
const clonar = (valor) => JSON.parse(JSON.stringify(valor));
const esperarMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digitoChave(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function montarXmlNota(nf, linha) {
  const chave43 = `3526101122233300018155001${String(nf).padStart(9, '0')}1${String(nf).padStart(8, '0')}`;
  const chave = `${chave43}${digitoChave(chave43)}`;
  const total = (linha.qCom * linha.vUnCom).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <NFe>
      <infNFe Id="NFe${chave}" versao="4.00">
        <ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>${nf}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>${CNPJ_TESTE}</CNPJ><xNome>Fornecedor Sprint 2.9</xNome></emit>
        <det nItem="1"><prod>
          <cProd>${linha.codigo}</cProd><cEAN>${linha.gtin}</cEAN><xProd>${linha.nome}</xProd>
          <NCM>00000000</NCM><CFOP>5102</CFOP>
          <uCom>${linha.uCom}</uCom><qCom>${linha.qCom}</qCom><vUnCom>${linha.vUnCom.toFixed(2)}</vUnCom>
          <vProd>${total}</vProd><cEANTrib>${linha.gtin}</cEANTrib>
          <uTrib>${linha.uTrib}</uTrib><qTrib>${linha.qTrib}</qTrib><vUnTrib>${linha.vUnTrib.toFixed(2)}</vUnTrib>
        </prod><imposto /></det>
        <total><ICMSTot><vProd>${total}</vProd><vNF>${total}</vNF></ICMSTot></total>
      </infNFe>
    </NFe>`;
}

async function cadastrar(produto) {
  await runDb('DELETE FROM produto_embalagens WHERE produto_id = ?', [produto.id]);
  await runDb('DELETE FROM produtos WHERE id = ?', [produto.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', 'UN', 1, 5, 10, ?, 0, 0, ?, 0, ?, 1, ?, 'Fornecedor Sprint 2.9', 1)`,
    [produto.id, produto.nome, produto.saldo, produto.saldo, `INT-${produto.id}`, produto.gtin]
  );
}

/** Leitura numa conexão nova: o que está de fato no arquivo, fora de qualquer transação da aplicação. */
function lerArquivo(sql, params = []) {
  return new Promise((resolve, reject) => {
    const conexao = new sqlite3.Database(db.filename, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      conexao.all(sql, params, (qErr, rows) => conexao.close(() => (qErr ? reject(qErr) : resolve(rows))));
    });
  });
}

async function foto(documentoIds = []) {
  const ids = [PRODUTO_A.id, PRODUTO_B.id, PRODUTO_C.id];
  const contar = async (sql) => Number((await lerArquivo(sql))[0].n);
  const [financeiro] = await lerArquivo('SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS total FROM financeiro');
  const documentos = [];
  for (const id of documentoIds) {
    const [doc] = await lerArquivo('SELECT status, compra_id, xml, parse_json FROM central_entradas_documentos WHERE id = ?', [id]);
    documentos.push({
      id,
      status: doc.status,
      compra_id: doc.compra_id,
      xml: sha(doc.xml),
      parse: sha(doc.parse_json),
      revisao: await lerArquivo(
        'SELECT item_index, produto_destino_id, decisao, status, dados_json FROM central_entradas_revisao_itens WHERE documento_id = ? ORDER BY id',
        [id]
      ),
      historico: await lerArquivo('SELECT id, status_anterior, status_novo, detalhe FROM central_entradas_historico WHERE documento_id = ? ORDER BY id', [id])
    });
  }
  return {
    produtos: await lerArquivo(
      `SELECT id, estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      ids
    ),
    compras: await contar('SELECT COUNT(*) AS n FROM compras'),
    itens: await contar('SELECT COUNT(*) AS n FROM compras_itens'),
    lotes: await contar('SELECT COUNT(*) AS n FROM produtos_lotes'),
    financeiro: { n: Number(financeiro.n), total: Number(financeiro.total) },
    documentos
  };
}

async function upload(central, nf, linha) {
  const xml = montarXmlNota(nf, linha);
  const r = await central.uploadDocumentos([{
    originalname: `sprint29-${nf}.xml`, mimetype: 'application/xml', buffer: Buffer.from(xml, 'utf8')
  }]);
  assert.equal(r.importados, 1, JSON.stringify(r));
  return Number(r.itens[0].documentoId);
}

async function revisarEFinalizar(central, documentoId, produtoId) {
  if ((await central.obterDocumento(documentoId)).status === DocumentoFiscalStatus.EM_REVISAO) {
    await central.obterOuCriarSessaoRevisao(documentoId, { usuarioId: USUARIO_ID });
    await central.salvarDecisaoRevisao(documentoId, 0, {
      decisao: 'ASSOCIAR', produtoId, item: { produto_id: produtoId }, usuarioId: USUARIO_ID
    });
  }
  const entrada = await central.finalizarEntrada(documentoId, { usuarioId: USUARIO_ID });
  assert.equal(Number(entrada.dadosCompra.itens[0].produto_id), produtoId, JSON.stringify(entrada.dadosCompra.itens[0]));
  return entrada;
}

async function aguardar(condicao, descricao) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > 15000) throw new Error(`Tempo esgotado: ${descricao}`);
    await esperarMs(10);
  }
}

/** Corpo exato da tela de Compras; o POST é interceptado (409) para nada ser gravado na captura. */
async function capturarCorpoDaTela(app, documentoId, dadosCompra) {
  const appCaptura = express();
  appCaptura.post('/api/compras', (_req, res) => res.status(409).json({ error: 'captura do teste', code: 'CAPTURA_TESTE' }));
  appCaptura.use(app);
  const pagina = criarPaginaCompras(appCaptura);
  pagina.sessao.set('central_abrir_compra', JSON.stringify({ documentoId, origem: 'CENTRAL_NFE', dadosCompra }));
  pagina.valores.set('input[name="politica_entrada_import"]:checked', 'REVENDA');
  pagina.context.loadCompras();
  await aguardar(
    () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem) || n.tipo === 'danger'),
    'tela carregar a NF-e da Central'
  );
  assert.deepEqual(pagina.notificacoes.filter((n) => n.tipo === 'danger'), []);
  pagina.context.saveCompra();
  await aguardar(() => pagina.requisicoes.some((r) => r.metodo === 'POST' && r.url === '/api/compras'), 'POST da tela');
  return clonar(pagina.requisicoes.find((r) => r.metodo === 'POST' && r.url === '/api/compras').corpo);
}

/**
 * Pausa a correção dentro da transação, logo antes de gravar o histórico (documento e sessão já gravados).
 * `liberar('falhar')` faz a correção falhar ali; `liberar('seguir')` deixa concluir.
 */
function pausarCorrecaoNoHistorico() {
  const original = CentralHistoricoRepository.prototype.inserir;
  let avisarChegada;
  let liberar;
  const chegou = new Promise((resolve) => { avisarChegada = resolve; });
  const liberado = new Promise((resolve) => { liberar = resolve; });
  CentralHistoricoRepository.prototype.inserir = async function inserirPausado(dados) {
    if (/corrigido/.test(String(dados?.detalhe || ''))) {
      CentralHistoricoRepository.prototype.inserir = original;
      avisarChegada();
      if (await liberado === 'falhar') throw new Error('falha simulada no meio da correção');
    }
    return original.call(this, dados);
  };
  return {
    chegou,
    liberar,
    restaurar: () => {
      CentralHistoricoRepository.prototype.inserir = original;
      liberar('falhar');
    }
  };
}

/** A conexão compartilhada não pode ter ficado presa numa transação aberta. */
async function conexaoCompartilhadaLivre() {
  await runDb('BEGIN IMMEDIATE');
  await runDb('ROLLBACK');
}

async function linhasOutroModulo() {
  return (await lerArquivo('SELECT origem FROM s29_outro_modulo ORDER BY id')).map((r) => r.origem);
}

test('Sprint 2.9 — transações SQLite: concorrência e falha de COMMIT', async (t) => {
  const { app, central } = await criarCentral();
  app.use('/api/central-entradas', (req, _res, next) => {
    req.user = { id: USUARIO_ID };
    next();
  }, require('../../backend/rotas/central-entradas'));

  assert.ok(db.filename && db.filename !== ':memory:', 'banco temporário em arquivo');
  for (const p of [PRODUTO_A, PRODUTO_B, PRODUTO_C]) await cadastrar(p);
  await runDb('DROP TABLE IF EXISTS s29_outro_modulo');
  await runDb('CREATE TABLE s29_outro_modulo (id INTEGER PRIMARY KEY AUTOINCREMENT, origem TEXT NOT NULL)');
  // Chave estrangeira adiada: só é conferida no COMMIT.
  await runDb('DROP TABLE IF EXISTS s29_filho');
  await runDb('DROP TABLE IF EXISTS s29_pai');
  await runDb('CREATE TABLE s29_pai (id INTEGER PRIMARY KEY)');
  await runDb('CREATE TABLE s29_filho (pai_id INTEGER REFERENCES s29_pai(id) DEFERRABLE INITIALLY DEFERRED)');

  const docX = await upload(central, 9921, LINHA_SUCO);
  await revisarEFinalizar(central, docX, PRODUTO_B.id);
  const rota = `/api/central-entradas/${docX}/corrigir-produtos`;
  const troca = (de, para) => ({ linhas: [{ indice: 0, produto_id: para.id, produto_anterior_id: de.id }], motivo: MOTIVO });
  const produtoDaLinha = async () => Number(JSON.parse((await lerArquivo(
    'SELECT parse_json FROM central_entradas_documentos WHERE id = ?', [docX]
  ))[0].parse_json).itens[0].produto_id);

  await t.test('correção desfeita no meio: gravação de outro módulo feita durante a pausa permanece', async () => {
    const antes = await foto([docX]);
    const pausa = pausarCorrecaoNoHistorico();
    let gravouDuranteAPausa;
    let r;
    try {
      const correcao = request(app).post(rota).send(troca(PRODUTO_B, PRODUTO_A)).then((resposta) => resposta);
      await pausa.chegou;
      let gravouOutro = false;
      const outroModulo = runDb("INSERT INTO s29_outro_modulo (origem) VALUES ('gravação avulsa durante a correção')")
        .then(() => { gravouOutro = true; });
      await esperarMs(150);
      gravouDuranteAPausa = gravouOutro;
      pausa.liberar('falhar');
      [r] = await Promise.all([correcao, outroModulo]);
    } finally {
      pausa.restaurar();
    }
    assert.deepEqual(await linhasOutroModulo(), ['gravação avulsa durante a correção'], 'gravação do outro módulo preservada');
    assert.deepEqual(await foto([docX]), antes, 'correção desfeita por inteiro');
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.code, 'CORRECAO_NAO_GRAVADA');
    assert.equal(await produtoDaLinha(), PRODUTO_B.id);
    assert.equal(gravouDuranteAPausa, false, 'a gravação avulsa esperou a correção terminar (não entrou na transação dela)');
    await conexaoCompartilhadaLivre();
  });

  await t.test('rollback de outro módulo durante a correção: desfaz só o dele; a correção é gravada inteira', async () => {
    await runDb('DELETE FROM s29_outro_modulo WHERE id > 0');
    const antes = await foto([docX]);
    const pausa = pausarCorrecaoNoHistorico();
    let erroOutro = null;
    let erroDuranteAPausa;
    let r;
    try {
      const correcao = request(app).post(rota).send(troca(PRODUTO_B, PRODUTO_A)).then((resposta) => resposta);
      await pausa.chegou;
      const outroModulo = executarEmTransacao(async (tx) => {
        await new Promise((resolve, reject) => tx.run(
          "INSERT INTO s29_outro_modulo (origem) VALUES ('operação desistida')", (err) => (err ? reject(err) : resolve())
        ));
        throw new Error('outro módulo desistiu');
      }).catch((err) => { erroOutro = err; });
      await esperarMs(150);
      erroDuranteAPausa = erroOutro;
      pausa.liberar('seguir');
      [r] = await Promise.all([correcao, outroModulo]);
    } finally {
      pausa.restaurar();
    }
    const depois = await foto([docX]);
    assert.equal(await produtoDaLinha(), PRODUTO_A.id, 'correção gravada');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.linhas[0].alterado, true);
    assert.deepEqual(await linhasOutroModulo(), [], 'a gravação desistida foi desfeita');
    assert.equal(erroOutro?.message, 'outro módulo desistiu', 'o rollback do outro módulo foi o dele, sem erro de transação');
    assert.equal(erroDuranteAPausa, null, 'o outro módulo esperou a correção terminar');
    const novos = depois.documentos[0].historico.slice(antes.documentos[0].historico.length);
    assert.equal(novos.length, 1);
    assert.match(novos[0].detalhe, /#9912 → #9911/);
    const sessao = depois.documentos[0].revisao.find((l) => Number(l.item_index) === 0);
    assert.equal(Number(sessao.produto_destino_id), PRODUTO_A.id);
    assert.deepEqual(
      { produtos: depois.produtos, compras: depois.compras, itens: depois.itens, financeiro: depois.financeiro },
      { produtos: antes.produtos, compras: antes.compras, itens: antes.itens, financeiro: antes.financeiro }
    );
    await conexaoCompartilhadaLivre();
  });

  await t.test('COMMIT recusado na correção: resposta de falha, nada gravado, conexão livre; repetir grava uma vez', async () => {
    const antes = await foto([docX]);
    await runDb(`CREATE TRIGGER s29_commit_falha AFTER INSERT ON central_entradas_historico
      WHEN NEW.detalhe LIKE '%corrigido%' BEGIN INSERT INTO s29_filho (pai_id) VALUES (-1); END`);
    let r;
    try {
      r = await request(app).post(rota).send(troca(PRODUTO_A, PRODUTO_B));
    } finally {
      await runDb('DROP TRIGGER IF EXISTS s29_commit_falha');
    }
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.code, 'CORRECAO_NAO_GRAVADA', JSON.stringify(r.body));
    assert.equal(r.body.sucesso, false);
    assert.deepEqual(await foto([docX]), antes, 'estado no arquivo idêntico ao anterior');
    assert.deepEqual(await lerArquivo('SELECT * FROM s29_filho'), []);
    assert.equal(await produtoDaLinha(), PRODUTO_A.id);
    await conexaoCompartilhadaLivre();

    const repetida = await request(app).post(rota).send(troca(PRODUTO_A, PRODUTO_B));
    assert.equal(repetida.status, 200, JSON.stringify(repetida.body));
    const depois = await foto([docX]);
    assert.equal(depois.documentos[0].historico.length, antes.documentos[0].historico.length + 1, 'um histórico');
    assert.equal(await produtoDaLinha(), PRODUTO_B.id);

    const terceira = await request(app).post(rota).send(troca(PRODUTO_A, PRODUTO_B));
    assert.equal(terceira.status, 409);
    assert.equal(terceira.body.code, 'DECISAO_ALTERADA');
    assert.deepEqual(await foto([docX]), depois, 'repetição não duplica');
  });

  await t.test('COMMIT recusado na compra: 500 sem gravar, servidor de pé, conexão livre; repetir grava uma vez', async () => {
    const docY = await upload(central, 9922, LINHA_ARROZ);
    const entradaY = await revisarEFinalizar(central, docY, PRODUTO_C.id);
    const corpo = await capturarCorpoDaTela(app, docY, entradaY.dadosCompra);

    const antes = await foto([docY]);
    await runDb(`CREATE TRIGGER s29_commit_compra AFTER INSERT ON compras
      BEGIN INSERT INTO s29_filho (pai_id) VALUES (-1); END`);
    let r;
    try {
      r = await request(app).post('/api/compras').send(corpo);
    } finally {
      await runDb('DROP TRIGGER IF EXISTS s29_commit_compra');
    }
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.code, 'COMPRA_NAO_GRAVADA', JSON.stringify(r.body));
    assert.equal(r.body.sucesso, false);
    assert.equal(r.body.compra_id, null);
    assert.deepEqual(await foto([docY]), antes, 'compra, itens, estoque, lotes, financeiro e documento intactos no arquivo');
    assert.deepEqual(await lerArquivo('SELECT * FROM s29_filho'), []);
    await conexaoCompartilhadaLivre();
    const vivo = await request(app).get(`/api/produtos/${PRODUTO_C.id}`);
    assert.equal(vivo.status, 200, 'servidor continua atendendo');

    const repetida = await request(app).post('/api/compras').send(corpo);
    assert.equal(repetida.status, 200, JSON.stringify(repetida.body));
    const depois = await foto([docY]);
    assert.equal(depois.compras, antes.compras + 1);
    assert.equal(depois.itens, antes.itens + 1);
    const saldoC = (f) => f.produtos.find((p) => Number(p.id) === PRODUTO_C.id);
    assert.equal(Number(saldoC(depois).saldo_fiscal), Number(saldoC(antes).saldo_fiscal) + 10);
    assert.equal(Number(saldoC(depois).estoque_atual), Number(saldoC(antes).estoque_atual) + 10);
    assert.equal(Number(depois.documentos[0].compra_id), Number(repetida.body.id));
    const compra = await getDb('SELECT COUNT(*) AS n FROM compras WHERE chave_acesso = ?', [entradaY.dadosCompra.chave_acesso || corpo.chave_acesso]);
    assert.equal(Number(compra.n), 1);

    const terceira = await request(app).post('/api/compras').send(corpo);
    assert.ok(terceira.status >= 400, JSON.stringify(terceira.body));
    assert.deepEqual(await foto([docY]), depois, 'repetição não duplica compra, estoque, financeiro nem histórico');
    assert.deepEqual(await allDb('SELECT * FROM s29_filho'), []);
  });
});
