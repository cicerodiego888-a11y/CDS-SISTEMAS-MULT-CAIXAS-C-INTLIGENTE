'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const {
  interpretarRespostaConsulta,
  recuperarSituacaoDuplicidade
} = require('../../backend/services/fechamento-fiscal/NfceDuplicidadeRecuperacaoService');
const {
  SITUACAO_NFCE,
  classificarSituacaoFiscalDaVenda
} = require('../../backend/services/fechamento-fiscal/NfceSituacaoFiscalService');
const {
  obterResumoDia
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalElegibilidadeService');

const CHAVE_5 = '23260968645756000121650010000000041962676433';
const CHAVE_6 = '23260968645756000121650010000000141549204719';

function openDb() {
  return new sqlite3.Database(':memory:');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function schema(db) {
  await run(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY, venda_id INTEGER NOT NULL, numero INTEGER, serie INTEGER,
    chave_acesso TEXT, ambiente INTEGER, status TEXT, xml_enviado TEXT,
    xml_retorno TEXT, protocolo TEXT
  )`);
  await run(db, `CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, usuario_nome TEXT,
    modulo TEXT, acao TEXT NOT NULL, referencia_tipo TEXT, referencia_id INTEGER,
    detalhes TEXT, ip_requisicao TEXT, criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, data_venda TEXT, total REAL, valor_fiscal REAL DEFAULT 0,
    valor_nao_fiscal REAL DEFAULT 0, cancelada INTEGER DEFAULT 0, status TEXT DEFAULT 'finalizada'
  )`);
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, item_fiscal INTEGER, estoque REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL,
    quantidade_fiscal REAL, quantidade_nao_fiscal REAL, subtotal REAL,
    valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE venda_pagamentos (id INTEGER PRIMARY KEY, venda_id INTEGER, valor REAL)`);
}

function xml539(chave) {
  return `<retEnviNFe><cStat>104</cStat><protNFe><infProt><cStat>539</cStat><xMotivo>Duplicidade de NF-e, com diferença na Chave de Acesso [chNFe:${chave}]</xMotivo></infProt></protNFe></retEnviNFe>`;
}

function xmlAutorizada(chave, protocolo = '135260000000001') {
  return `<retConsSitNFe><tpAmb>1</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><protNFe><infProt><chNFe>${chave}</chNFe><dhRecbto>2026-09-13T12:00:00-03:00</dhRecbto><nProt>${protocolo}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retConsSitNFe>`;
}

function xmlCancelada(chave) {
  return `<retConsSitNFe><tpAmb>1</tpAmb><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo><protNFe><infProt><chNFe>${chave}</chNFe><nProt>135260000000002</nProt><cStat>100</cStat></infProt></protNFe><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo></infEvento></retEvento></retConsSitNFe>`;
}

function xmlSemDocumento() {
  return '<retConsSitNFe><tpAmb>1</tpAmb><cStat>217</cStat><xMotivo>NF-e não consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>';
}

function xmlPendente() {
  return '<retConsSitNFe><tpAmb>1</tpAmb><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo></retConsSitNFe>';
}

async function inserirDuplicidade(db, vendaId, nfceId, chave = CHAVE_5) {
  await run(
    db,
    `INSERT INTO nfce_notas
      (id,venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno)
     VALUES (?,?,?,?,?,?,?,?)`,
    [nfceId, vendaId, vendaId, 1, `local-${vendaId}`, 1, 'rejeitada_duplicidade', xml539(chave)]
  );
}

function deps(db, consultar) {
  return {
    db,
    consultarProtocolo: consultar,
    getFiscalConfig: async () => ({
      ambiente: 1,
      codigoUf: '23',
      certificadoPath: 'fixture.pfx',
      certificadoSenha: 'fixture'
    }),
    gravarAuditoria: async (registro) => run(
      db,
      `INSERT INTO auditoria
        (usuario_id,usuario_nome,modulo,acao,referencia_tipo,referencia_id,detalhes,ip_requisicao)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        registro.usuario_id,
        registro.usuario_nome,
        registro.modulo,
        registro.acao,
        registro.referencia_tipo,
        registro.referencia_id,
        JSON.stringify(registro.detalhes),
        registro.ip_requisicao
      ]
    )
  };
}

async function recuperar(db, consulta, vendaId = 5, nfceId = 50) {
  return recuperarSituacaoDuplicidade(
    {
      venda_id: vendaId,
      nfce_id: nfceId,
      confirmacao_consulta: true,
      usuario_id: 7,
      usuario_nome: 'operador'
    },
    deps(db, consulta)
  );
}

test.describe('Sprint 07.7 — recuperação segura de duplicidade NFC-e cStat 539', { concurrency: false }, () => {
  test('01 — 539 autorizado exige protocolo e usa a chave retornada pela SEFAZ', async () => {
    const db = openDb();
    await schema(db);
    await inserirDuplicidade(db, 5, 50);
    let input;
    const out = await recuperar(db, async (dados) => {
      input = dados;
      return { success: true, source: 'FIXTURE', body: xmlAutorizada(CHAVE_5) };
    });
    assert.equal(input.modelo, 'NFCE');
    assert.equal(input.chave, CHAVE_5);
    assert.equal(out.situacao_fiscal, SITUACAO_NFCE.AUTORIZADA);
    assert.equal(out.protocolo, '135260000000001');
    assert.equal(out.emitiu_nfce, undefined);
    await close(db);
  });

  test('02 — cStat 217 é sem autorização válida e nunca vira AUTORIZADA', async () => {
    const decisao = interpretarRespostaConsulta({ success: true, body: xmlSemDocumento() });
    assert.equal(decisao.situacao_fiscal, SITUACAO_NFCE.REJEITADA);
    assert.notEqual(decisao.situacao_fiscal, SITUACAO_NFCE.AUTORIZADA);
  });

  test('03 — consulta inconclusiva permanece PENDENTE', () => {
    assert.equal(
      interpretarRespostaConsulta({ success: true, body: xmlPendente() }).situacao_fiscal,
      SITUACAO_NFCE.PENDENTE
    );
  });

  test('04 — timeout técnico resulta em ERRO e fica auditado', async () => {
    const db = openDb();
    await schema(db);
    await inserirDuplicidade(db, 5, 50);
    const out = await recuperar(db, async () => {
      throw new Error('timeout de rede');
    });
    assert.equal(out.situacao_fiscal, SITUACAO_NFCE.ERRO);
    assert.match(out.erro_tecnico, /timeout/);
    const logs = await all(db, 'SELECT * FROM auditoria');
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0].detalhes).situacao_fiscal, 'ERRO');
    await close(db);
  });

  test('05 — autorização seguida de cancelamento resulta em CANCELADA', () => {
    const decisao = interpretarRespostaConsulta({ success: true, body: xmlCancelada(CHAVE_5) });
    assert.equal(decisao.situacao_fiscal, SITUACAO_NFCE.CANCELADA);
  });

  test('06 — resposta ambígua resulta em DESCONHECIDA, nunca em autorização', () => {
    const decisao = interpretarRespostaConsulta({
      success: true,
      body: '<retConsSitNFe><cStat>999</cStat><xMotivo>Resposta não mapeada</xMotivo></retConsSitNFe>'
    });
    assert.equal(decisao.situacao_fiscal, SITUACAO_NFCE.DESCONHECIDA);
  });

  test('07 — evidência recuperada passa a alimentar o classificador canônico', async () => {
    const db = openDb();
    await schema(db);
    await inserirDuplicidade(db, 5, 50);
    await recuperar(db, async () => ({ success: true, body: xmlAutorizada(CHAVE_5) }));
    const fiscal = await classificarSituacaoFiscalDaVenda(db, 5);
    assert.equal(fiscal.situacao, SITUACAO_NFCE.AUTORIZADA);
    assert.equal(fiscal.origem_classificacao, 'RECUPERACAO_DUPLICIDADE');
    await close(db);
  });

  test('08 — recuperação definitiva é idempotente e não repete consulta', async () => {
    const db = openDb();
    await schema(db);
    await inserirDuplicidade(db, 5, 50);
    let consultas = 0;
    const mock = async () => {
      consultas += 1;
      return { success: true, body: xmlAutorizada(CHAVE_5) };
    };
    await recuperar(db, mock);
    const segunda = await recuperar(db, mock);
    assert.equal(consultas, 1);
    assert.equal(segunda.consultou_sefaz, false);
    assert.equal(segunda.reutilizado, true);
    await close(db);
  });

  test('09 — PENDENTE e ERRO permitem nova tentativa explícita', async () => {
    const db = openDb();
    await schema(db);
    await inserirDuplicidade(db, 5, 50);
    let consultas = 0;
    const mock = async () => {
      consultas += 1;
      return consultas === 1
        ? { success: true, body: xmlPendente() }
        : { success: true, body: xmlAutorizada(CHAVE_5) };
    };
    assert.equal((await recuperar(db, mock)).situacao_fiscal, SITUACAO_NFCE.PENDENTE);
    assert.equal((await recuperar(db, mock)).situacao_fiscal, SITUACAO_NFCE.AUTORIZADA);
    assert.equal(consultas, 2);
    await close(db);
  });

  test('10 — falta da chave citada no 539 bloqueia consulta arbitrária', async () => {
    const db = openDb();
    await schema(db);
    await run(db, `INSERT INTO nfce_notas
      (id,venda_id,numero,serie,chave_acesso,ambiente,status,xml_retorno)
      VALUES (50,5,5,1,?,1,'rejeitada_duplicidade','<cStat>539</cStat>')`, [CHAVE_6]);
    let consultas = 0;
    await assert.rejects(
      recuperar(db, async () => { consultas += 1; }),
      (err) => err.code === 'CHAVE_539_NAO_ENCONTRADA'
    );
    assert.equal(consultas, 0);
    await close(db);
  });

  test('11 — Venda 5 autorizada sai e Venda 6 sem autorização volta à elegibilidade', async () => {
    const db = openDb();
    await schema(db);
    await run(db, `INSERT INTO produtos (id,nome,codigo,item_fiscal,estoque) VALUES (1,'Produto','P1',1,100)`);
    for (const vendaId of [5, 6]) {
      await run(db, `INSERT INTO vendas
        (id,data_venda,total,valor_fiscal,valor_nao_fiscal,cancelada,status)
        VALUES (?, '2026-09-13 10:00:00', 10, 10, 0, 0, 'finalizada')`, [vendaId]);
      await run(db, `INSERT INTO vendas_itens
        (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [vendaId, vendaId, 1, 1, 1, 0, 10, 10, 0, 10]);
    }
    await inserirDuplicidade(db, 5, 50, CHAVE_5);
    await inserirDuplicidade(db, 6, 60, CHAVE_6);
    assert.equal((await obterResumoDia(db, '2026-09-13')).valor_fiscal_elegivel, 0);
    await recuperar(db, async () => ({ success: true, body: xmlAutorizada(CHAVE_5) }), 5, 50);
    await recuperar(db, async () => ({ success: true, body: xmlSemDocumento() }), 6, 60);
    const resumo = await obterResumoDia(db, '2026-09-13');
    assert.equal(resumo.valor_fiscal_elegivel, 10);
    assert.equal(resumo.pendencias_fiscais.length, 0);
    await close(db);
  });

  test('12 — recuperação não altera vendas, itens, estoque, caixa, pagamentos ou financeiro', async () => {
    const db = openDb();
    await schema(db);
    await run(db, `INSERT INTO produtos (id,nome,codigo,item_fiscal,estoque) VALUES (1,'Produto','P1',1,25)`);
    await run(db, `INSERT INTO vendas (id,data_venda,total,status) VALUES (5,'2026-09-13',10,'finalizada')`);
    await run(db, `INSERT INTO vendas_itens
      (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
      VALUES (5,5,1,1,1,0,10,10,0,10)`);
    await run(db, `INSERT INTO financeiro (id,valor,tipo,origem) VALUES (1,10,'entrada','venda')`);
    await run(db, `INSERT INTO venda_pagamentos (id,venda_id,valor) VALUES (1,5,10)`);
    await inserirDuplicidade(db, 5, 50);
    const antes = {
      vendas: await all(db, 'SELECT * FROM vendas'),
      itens: await all(db, 'SELECT * FROM vendas_itens'),
      produtos: await all(db, 'SELECT * FROM produtos'),
      financeiro: await all(db, 'SELECT * FROM financeiro'),
      pagamentos: await all(db, 'SELECT * FROM venda_pagamentos')
    };
    await recuperar(db, async () => ({ success: true, body: xmlAutorizada(CHAVE_5) }));
    const depois = {
      vendas: await all(db, 'SELECT * FROM vendas'),
      itens: await all(db, 'SELECT * FROM vendas_itens'),
      produtos: await all(db, 'SELECT * FROM produtos'),
      financeiro: await all(db, 'SELECT * FROM financeiro'),
      pagamentos: await all(db, 'SELECT * FROM venda_pagamentos')
    };
    assert.deepEqual(depois, antes);
    assert.equal((await all(db, 'SELECT * FROM nfce_notas')).length, 1);
    await close(db);
  });

  test('13 — ambiente de produção é aceito e nenhuma autorização é chamada', async () => {
    const db = openDb();
    await schema(db);
    await inserirDuplicidade(db, 5, 50);
    let consultaInput;
    await recuperarSituacaoDuplicidade(
      { venda_id: 5, nfce_id: 50, confirmacao_consulta: true },
      {
        ...deps(db, async (input) => {
          consultaInput = input;
          return { success: true, body: xmlSemDocumento() };
        }),
        getFiscalConfig: async () => ({
          ambiente: 1, codigoUf: '23', certificadoPath: 'pfx', certificadoSenha: 'senha'
        })
      }
    );
    assert.equal(consultaInput.ambiente, 1);
    assert.equal(consultaInput.modelo, 'NFCE');
    await close(db);
  });

  test('14 — endpoint exige confirmação e declara zero emissão', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/fechamento-fiscal.js'),
      'utf8'
    );
    assert.match(src, /confirmacao_consulta !== true/);
    assert.match(src, /emitiu_nfce: false/);
    assert.match(src, /recuperar-duplicidades/);
  });

  test('15 — UI usa confirmação específica e ação manual de consulta', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'),
      'utf8'
    );
    assert.match(src, /Nenhuma nova NFC-e será emitida/);
    assert.match(src, /rotuloCancelar: 'Cancelar'/);
    assert.match(src, /rotuloConfirmar: 'Consultar SEFAZ'/);
    assert.match(src, /RECUPERAR SITUAÇÃO FISCAL/);
  });

  test('16 — o próprio serviço recusa consulta sem confirmação explícita', async () => {
    await assert.rejects(
      recuperarSituacaoDuplicidade({ venda_id: 5, nfce_id: 50 }),
      (err) => err.code === 'CONFIRMACAO_CONSULTA_OBRIGATORIA'
    );
  });
});
