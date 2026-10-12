/**
 * Cancelamento de venda × cancelamento de NFC-e (tela NFC-e Emitidas).
 * Executar: node --test tests/vendas/cancelamento-venda-nfce-avaliacao.test.js
 *
 * SQLite temporário. O motor de cancelamento fiscal (evento 110111) é simulado:
 * nenhuma transmissão real à SEFAZ.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-canc-venda-'));
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = path.join(tmpBase, 'db');
process.env.FISCAL_DIR = path.join(tmpBase, 'fiscal');
fs.mkdirSync(process.env.DB_DIR, { recursive: true });

const ROOT = path.join(__dirname, '../..');

const eventosFiscais = { chamadas: [], responder: null };
const cancelarNfcePath = require.resolve(path.join(ROOT, 'backend/services/fiscal/cancelarNfce.js'));
const cancelarNfceFake = async (vendaId, justificativa) => {
  eventosFiscais.chamadas.push({ vendaId: Number(vendaId), justificativa });
  return eventosFiscais.responder(Number(vendaId));
};
require.cache[cancelarNfcePath] = {
  id: cancelarNfcePath, filename: cancelarNfcePath, loaded: true, exports: cancelarNfceFake
};

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../backend/database');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve(this); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const CNPJ = '11222333000181';
const MOTIVO = 'Cliente desistiu da compra no caixa';

function dhFiscal(msAtras) {
  const d = new Date(Date.now() - msAtras - 3 * 3600 * 1000);
  return `${d.toISOString().slice(0, 19)}-03:00`;
}

function chave(numero) {
  return `2326${'10'}${CNPJ}65001${String(numero).padStart(9, '0')}1${'12345678'}9`;
}

function xmlAutorizada(numero, { comProtocolo = true, msAtras = 5 * 60 * 1000 } = {}) {
  return `<retEnviNFe><cStat>104</cStat><protNFe><infProt><chNFe>${chave(numero)}</chNFe>`
    + `<dhRecbto>${dhFiscal(msAtras)}</dhRecbto><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>`
    + `${comProtocolo ? '<nProt>323260000000001</nProt>' : ''}</infProt></protNFe></retEnviNFe>`;
}

function retornoEvento(cStat, xMotivo) {
  return `<retEnvEvento><cStat>128</cStat><retEvento versao="1.00"><infEvento><cStat>${cStat}</cStat>`
    + `<xMotivo>${xMotivo}</xMotivo>${cStat === '135' ? '<nProt>323260000009999</nProt>' : ''}`
    + `<dhRegEvento>${dhFiscal(0)}</dhRegEvento></infEvento></retEvento></retEnvEvento>`;
}

async function criarVenda(id, { estoque = 10 } = {}) {
  await run(
    `INSERT INTO produtos (id, codigo, nome, unidade, preco_venda, estoque_atual, saldo_fiscal, saldo_nao_fiscal)
     VALUES (?, ?, ?, 'UN', 10, ?, ?, 0)`,
    [id, `P${id}`, `PRODUTO ${id}`, estoque, estoque]
  );
  await run(
    `INSERT INTO vendas (id, codigo, data_venda, total, forma_pagamento, status)
     VALUES (?, ?, date('now'), 10, 'dinheiro', 'concluida')`,
    [id, `V-${id}`]
  );
  await run(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
       item_fiscal, quantidade_fiscal, valor_fiscal)
     VALUES (?, ?, 1, 10, 10, 1, 1, 10)`,
    [id, id]
  );
}

async function criarNota(vendaId, { numero, status, chaveAcesso = null, protocolo = null, xmlRetorno = null }) {
  const r = await run(
    `INSERT INTO nfce_notas (venda_id, numero, serie, chave_acesso, ambiente, status, xml_enviado, xml_retorno, protocolo)
     VALUES (?, ?, 1, ?, 2, ?, '<NFe/>', ?, ?)`,
    [vendaId, numero, chaveAcesso, status, xmlRetorno, protocolo]
  );
  return r.lastID;
}

async function estado(vendaId) {
  const venda = await get('SELECT cancelada, status FROM vendas WHERE id = ?', [vendaId]);
  const produto = await get(
    'SELECT COALESCE(saldo_fiscal, 0) + COALESCE(saldo_nao_fiscal, 0) AS estoque_atual FROM produtos WHERE id = ?',
    [vendaId]
  );
  const nota = await get('SELECT status, xml_retorno, chave_acesso, protocolo FROM nfce_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1', [vendaId]);
  return { venda, estoque: Number(produto.estoque_atual), nota };
}

function chamarPost(vendaId, motivo) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; }
    };
    servico.cancelarVendaPost(vendaId, motivo, { user: { id: 1 }, ip: '127.0.0.1', body: { motivo } }, res);
  });
}

let servico;
let avaliacaoSvc;

describe('Cancelamento de venda × NFC-e', () => {
  before(async () => {
    await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
    for (let i = 0; i < 100; i += 1) {
      const flag = await get(`SELECT valor FROM configuracoes WHERE chave = 'migracao_recalc_saldos_estoque_v1'`);
      if (flag && flag.valor === '1') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    servico = require('../../backend/services/vendas/VendaCancelamentoService');
    avaliacaoSvc = require('../../backend/services/vendas/VendaCancelamentoAvaliacaoService');

    await criarVenda(16);
    await criarNota(16, {
      numero: 10004,
      status: 'rejeitada',
      chaveAcesso: chave(10004),
      xmlRetorno: '<retEnviNFe><cStat>104</cStat><protNFe><infProt><cStat>462</cStat>'
        + '<xMotivo>Rejeicao: Codigo identificador do CSC no QR-Code nao cadastrado na SEFAZ</xMotivo></infProt></protNFe></retEnviNFe>'
    });

    await criarVenda(21);
    await criarNota(21, { numero: 10021, status: 'autorizada', chaveAcesso: chave(10021), protocolo: '323260000000001', xmlRetorno: xmlAutorizada(10021) });

    await criarVenda(22);
    await criarNota(22, { numero: 10022, status: 'autorizada', chaveAcesso: chave(10022), protocolo: '323260000000001', xmlRetorno: xmlAutorizada(10022) });

    await criarVenda(23);
    await criarNota(23, {
      numero: 10023,
      status: 'cancelada',
      chaveAcesso: chave(10023),
      protocolo: '323260000000001',
      xmlRetorno: `${xmlAutorizada(10023)}\n${retornoEvento('135', 'Evento registrado e vinculado a NF-e')}`
    });

    await criarVenda(24);
    await criarNota(24, { numero: 10024, status: 'autorizada', chaveAcesso: chave(10024), xmlRetorno: xmlAutorizada(10024, { comProtocolo: false }) });

    await criarVenda(25);

    await criarVenda(26);
    await criarNota(26, {
      numero: 10026, status: 'autorizada', chaveAcesso: chave(10026), protocolo: '323260000000001',
      xmlRetorno: xmlAutorizada(10026, { msAtras: 2 * 3600 * 1000 })
    });

    await criarVenda(27);
    await criarNota(27, {
      numero: 10027, status: 'rejeitada_duplicidade', chaveAcesso: chave(10027),
      xmlRetorno: `<cStat>539</cStat><xMotivo>Rejeicao: Duplicidade de NF-e [chNFe:${chave(10027)}]</xMotivo>`
    });

    await criarVenda(28);
    await criarNota(28, { numero: 10028, status: 'autorizada', chaveAcesso: '', protocolo: '323260000000001', xmlRetorno: '<cStat>100</cStat><nProt>323260000000001</nProt>' });
  });

  after(() => { db.close(() => {}); });

  it('01 — NFC-e rejeitada (cStat 462): nenhum evento fiscal; cancela só a venda e preserva o histórico fiscal', async () => {
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(16);
    assert.equal(av.cancelar_nfce, false);
    assert.equal(av.cancelar_venda_permitido, true);
    assert.equal(av.bloqueio, null);
    assert.equal(av.nfce.cstat, '462');
    assert.match(av.mensagem, /rejeitada \(cStat 462/);
    assert.match(av.mensagem, /nenhum evento será enviado/);

    const antes = await estado(16);
    eventosFiscais.chamadas.length = 0;
    const r = await chamarPost(16, MOTIVO);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.sucesso, true);
    assert.equal(r.body.nfce_cancelada, false);
    assert.equal(eventosFiscais.chamadas.length, 0, 'nenhuma tentativa de cancelamento fiscal');

    const depois = await estado(16);
    assert.equal(depois.venda.cancelada, 1);
    assert.equal(depois.estoque, antes.estoque + 1);
    assert.deepEqual(depois.nota, antes.nota, 'XML, chave, status e retorno da NFC-e preservados');
  });

  it('02 — NFC-e autorizada e elegível: fluxo fiscal disponível; nada muda antes da confirmação', async () => {
    const antes = await estado(21);
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(21);
    assert.equal(av.cancelar_nfce, true);
    assert.equal(av.exige_justificativa, true);
    assert.equal(av.prazo.dentro_prazo, true);
    assert.deepEqual(await estado(21), antes, 'avaliação não altera venda, estoque nem nota');

    eventosFiscais.chamadas.length = 0;
    const curto = await chamarPost(21, 'curto');
    assert.equal(curto.status, 400);
    assert.match(curto.body.mensagem, /obrigatório para cancelar NFC-e autorizada/);
    assert.equal(eventosFiscais.chamadas.length, 0);
    assert.deepEqual(await estado(21), antes, 'justificativa inválida não altera nada');

    eventosFiscais.responder = async (vendaId) => {
      const nota = await get(`SELECT id FROM nfce_notas WHERE venda_id = ? AND status = 'autorizada'`, [vendaId]);
      return { sefaz: retornoEvento('135', 'Evento registrado e vinculado a NF-e'), notaId: nota.id };
    };
    const r = await chamarPost(21, MOTIVO);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.nfce_cancelada, true);
    assert.equal(r.body.sefaz.cStatEvento, '135');
    assert.equal(r.body.sefaz.protocoloCancelamento, '323260000009999');
    assert.equal(eventosFiscais.chamadas.length, 1);
    assert.equal(eventosFiscais.chamadas[0].justificativa, MOTIVO);

    const depois = await estado(21);
    assert.equal(depois.nota.status, 'cancelada');
    assert.ok(depois.nota.xml_retorno.startsWith(antes.nota.xml_retorno), 'retorno de autorização preservado');
    assert.equal(depois.nota.chave_acesso, antes.nota.chave_acesso);
    assert.equal(depois.venda.cancelada, 1);
    assert.equal(depois.estoque, antes.estoque + 1);
  });

  it('03 — cancelamento fiscal rejeitado pela SEFAZ: estado e resposta originais preservados', async () => {
    const antes = await estado(22);
    eventosFiscais.chamadas.length = 0;
    eventosFiscais.responder = async (vendaId) => {
      const nota = await get(`SELECT id FROM nfce_notas WHERE venda_id = ?`, [vendaId]);
      return { sefaz: retornoEvento('573', 'Rejeicao: Duplicidade de evento'), notaId: nota.id };
    };
    const r = await chamarPost(22, MOTIVO);
    assert.equal(r.status, 400);
    assert.equal(r.body.sucesso, false);
    assert.match(r.body.mensagem, /cStat 573\): Rejeicao: Duplicidade de evento/);
    assert.equal(r.body.sefaz.cStatEvento, '573');
    assert.equal(eventosFiscais.chamadas.length, 1);
    assert.deepEqual(await estado(22), antes, 'venda, estoque e nota inalterados');
  });

  it('04 — NFC-e já cancelada: nenhum novo evento', async () => {
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(23);
    assert.equal(av.cancelar_nfce, false);
    assert.match(av.mensagem, /já está cancelada na SEFAZ; nenhum novo evento/);
    eventosFiscais.chamadas.length = 0;
    const r = await chamarPost(23, MOTIVO);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(eventosFiscais.chamadas.length, 0);
    assert.equal((await estado(23)).nota.status, 'cancelada');
  });

  it('05 — NFC-e autorizada sem protocolo ou sem chave: bloqueio com mensagem clara', async () => {
    const semProt = await avaliacaoSvc.avaliarCancelamentoVenda(24);
    assert.equal(semProt.bloqueio.codigo, 'NFCE_SEM_CHAVE_OU_PROTOCOLO');
    assert.match(semProt.mensagem, /não possui protocolo de autorização/);

    const semChave = await avaliacaoSvc.avaliarCancelamentoVenda(28);
    assert.equal(semChave.bloqueio.codigo, 'NFCE_SEM_CHAVE_OU_PROTOCOLO');
    assert.match(semChave.mensagem, /não possui chave de acesso válida/);

    const antes = await estado(24);
    eventosFiscais.chamadas.length = 0;
    const r = await chamarPost(24, MOTIVO);
    assert.equal(r.status, 409);
    assert.equal(r.body.codigo, 'NFCE_SEM_CHAVE_OU_PROTOCOLO');
    assert.equal(eventosFiscais.chamadas.length, 0);
    assert.deepEqual(await estado(24), antes);
  });

  it('06 — venda sem NFC-e: somente cancelamento comercial', async () => {
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(25);
    assert.equal(av.situacao_fiscal, 'SEM_DOCUMENTO');
    assert.equal(av.cancelar_nfce, false);
    eventosFiscais.chamadas.length = 0;
    const r = await chamarPost(25, MOTIVO);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(eventosFiscais.chamadas.length, 0);
    assert.equal((await estado(25)).venda.cancelada, 1);
  });

  it('07 — autorizada fora do prazo: não transmite evento e informa o prazo', async () => {
    const antes = await estado(26);
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(26);
    assert.equal(av.bloqueio.codigo, 'CANCELAMENTO_FORA_DO_PRAZO');
    assert.match(av.mensagem, /prazo de cancelamento é de 30 min/);
    eventosFiscais.chamadas.length = 0;
    const r = await chamarPost(26, MOTIVO);
    assert.equal(r.status, 409);
    assert.equal(eventosFiscais.chamadas.length, 0);
    assert.deepEqual(await estado(26), antes);
  });

  it('08 — situação fiscal não confirmada (539 pendente): bloqueia venda e evento', async () => {
    const antes = await estado(27);
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(27);
    assert.equal(av.bloqueio.codigo, 'SITUACAO_FISCAL_NAO_CONFIRMADA');
    const r = await chamarPost(27, MOTIVO);
    assert.equal(r.status, 409);
    assert.match(r.body.mensagem, /ainda não foi confirmada/);
    assert.deepEqual(await estado(27), antes);
  });

  it('09 — venda já cancelada: motivo específico', async () => {
    const av = await avaliacaoSvc.avaliarCancelamentoVenda(16);
    assert.equal(av.bloqueio.codigo, 'VENDA_JA_CANCELADA');
  });

  it('10 — tela NFC-e Emitidas não depende de vendas.js e não usa a mensagem genérica', () => {
    const front = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
    const bloco = front.slice(
      front.indexOf('async function acaoNfceEmitidaCancelarVenda'),
      front.indexOf('function cancelarDocumentoFiscalNfce')
    );
    assert.ok(bloco.length > 0);
    assert.doesNotMatch(front, /Cancelar venda indisponível neste contexto/);
    assert.doesNotMatch(bloco, /cancelarVendaNaoFiscal/);
    assert.match(bloco, /\/vendas\/\$\{Number\(vendaId\)\}\/cancelamento\/avaliacao/);
    assert.match(bloco, /\/vendas\/cancelar\/\$\{Number\(vendaId\)\}/);
    assert.doesNotMatch(bloco, /[^A-Za-z]escapeHtml\(/, 'não depende de helper carregado por outra tela');
  });
});
