/**
 * NFC-e 65 — numeração com fonte única e identidade da tentativa preservada.
 * Executar: node --test tests/fiscal/nfce-numeracao-fonte-unica-tentativa.test.js
 *
 * SQLite e diretório fiscal temporários. Certificado, assinatura, transporte SEFAZ e
 * consulta por chave são simulados: nenhuma chamada real à SEFAZ.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-nfce-num-'));
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = path.join(tmpBase, 'db');
process.env.FISCAL_DIR = path.join(tmpBase, 'fiscal');
fs.mkdirSync(process.env.DB_DIR, { recursive: true });

const ROOT = path.join(__dirname, '../..');
const FISCAL = path.join(ROOT, 'backend/services/fiscal');

function stubModulo(arquivo, exportsFake) {
  const resolvido = require.resolve(path.join(FISCAL, arquivo));
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports: exportsFake
  };
}

const transporte = { chamadas: [], responder: null };
const consulta = { chamadas: [], responder: null };

stubModulo('certificateService.js', {
  carregarCertificadoPfx: () => ({ privateKeyPem: 'KEY', certPem: 'CERT' })
});
stubModulo('signer.js', {
  assinarNFe: (xml) => ({
    xmlAssinado: String(xml).replace(
      '</NFe>',
      '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature></NFe>'
    ),
    digestValue: 'stub'
  })
});
stubModulo('autorizacaoRuntime.js', {
  enviarAutorizacao: async (input) => {
    const chave = (String(input.loteXml).match(/Id="NFe(\d{44})"/) || [])[1];
    const nNF = Number((String(input.loteXml).match(/<nNF>(\d+)<\/nNF>/) || [])[1]);
    const serie = Number((String(input.loteXml).match(/<serie>(\d+)<\/serie>/) || [])[1]);
    const cNF = (String(input.loteXml).match(/<cNF>(\d+)<\/cNF>/) || [])[1];
    transporte.chamadas.push({ chave, nNF, serie, cNF });
    return transporte.responder({ chave, nNF, serie, cNF });
  }
});
stubModulo('consultaProtocoloRuntime.js', {
  consultarProtocolo: async (input) => {
    consulta.chamadas.push(input);
    return consulta.responder(input);
  }
});

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../backend/database');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) return reject(err);
    resolve(this);
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const CNPJ = '11222333000181';

function respostaAutorizada({ chave }) {
  return {
    success: true,
    status: 'soap_enviado',
    raw: `<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt>`
      + `<chNFe>${chave}</chNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>`
      + `<nProt>323260000000001</nProt></infProt></protNFe></retEnviNFe>`
  };
}

function respostaRejeicaoComum() {
  return {
    success: true,
    status: 'soap_enviado',
    raw: `<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt>`
      + `<cStat>225</cStat><xMotivo>Rejeicao: Falha no Schema XML</xMotivo></infProt></protNFe></retEnviNFe>`
  };
}

function chaveSefazDiferente(chave) {
  // Mesmo nNF/série, outro mês (2609) e outro cNF: documento pré-existente na SEFAZ.
  return `${chave.slice(0, 2)}2609${chave.slice(6, 35)}70573429${chave.slice(43)}`;
}

function resposta539({ chave }) {
  return {
    success: true,
    status: 'soap_enviado',
    cStat: '539',
    raw: `<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt>`
      + `<cStat>539</cStat><xMotivo>Rejeicao: Duplicidade de NF-e, com diferenca na Chave de Acesso `
      + `[chNFe:${chaveSefazDiferente(chave)}]</xMotivo></infProt></protNFe></retEnviNFe>`
  };
}

function respostaTimeout() {
  return { success: false, status: 'erro_transmissao', message: 'ETIMEDOUT', raw: null };
}

function consultaAutorizada({ chave }) {
  return {
    success: true,
    body: `<retConsSitNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><protNFe versao="4.00">`
      + `<infProt><chNFe>${chave}</chNFe><cStat>100</cStat><xMotivo>Autorizado</xMotivo>`
      + `<nProt>323260000000077</nProt></infProt></protNFe></retConsSitNFe>`
  };
}

function consultaNaoConsta() {
  return {
    success: true,
    body: '<retConsSitNFe><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>'
  };
}

function consultaSemResposta() {
  return { success: false, error: 'ETIMEDOUT na consulta' };
}

async function setCfg(chave, valor) {
  await run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao) VALUES (?, ?, 'string', '')
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    [chave, String(valor)]
  );
}

async function criarVenda(id) {
  await run(
    `INSERT INTO vendas (id, codigo, data_venda, total, forma_pagamento, status)
     VALUES (?, ?, date('now'), 10, 'dinheiro', 'concluida')`,
    [id, `V-${id}`]
  );
  await run(`UPDATE vendas SET status_pagamento = 'quitada' WHERE id = ?`, [id]).catch(() => {});
  await run(
    `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal,
       item_fiscal, quantidade_fiscal, valor_fiscal)
     VALUES (?, 1, 1, 10, 10, 1, 1, 10)`,
    [id]
  );
  await run(
    `INSERT INTO venda_pagamentos (venda_id, forma_pagamento, valor) VALUES (?, 'dinheiro', 10)`,
    [id]
  ).catch(() => {});
}

async function snapshotVenda(id) {
  const venda = await get('SELECT * FROM vendas WHERE id = ?', [id]);
  const itens = await all('SELECT * FROM vendas_itens WHERE venda_id = ? ORDER BY id', [id]);
  return JSON.stringify({ venda, itens });
}

async function proximoNaTabela() {
  const row = await get(
    `SELECT proximo_numero FROM fiscal_numeracao
     WHERE empresa_cnpj = ? AND ambiente = 2 AND modelo = '65' AND serie = 1`,
    [CNPJ]
  );
  return row ? Number(row.proximo_numero) : null;
}

let emissor;
let configService;
let numeracao;

describe('NFC-e 65 — fonte única de numeração e identidade da tentativa', () => {
  before(async () => {
    await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));

    const certFake = path.join(tmpBase, 'cert-fake.pfx');
    fs.writeFileSync(certFake, 'nao-e-um-pfx');

    const cfg = {
      nome_empresa: 'EMPRESA TESTE LTDA',
      razao_social: 'EMPRESA TESTE LTDA',
      cnpj: CNPJ,
      fiscal_ie: '061234567',
      fiscal_ambiente: '2',
      fiscal_uf: 'CE',
      fiscal_uf_sigla: 'CE',
      fiscal_codigo_uf: '23',
      fiscal_serie: '1',
      // Legado: tela salvou "Próximo Número NFC-e = 10002" (fiscal_numero_atual = próximo - 1).
      fiscal_numero_atual: '10001',
      fiscal_regime_tributario: '1',
      fiscal_id_csc: '1',
      fiscal_token_csc: 'TOKENTESTE',
      fiscal_certificado_path: certFake,
      fiscal_certificado_senha: 'x',
      fiscal_ws_autorizacao_homologacao: 'https://homologacao.invalid/NFeAutorizacao4',
      fiscal_csc_qrcode_url_homologacao: 'https://homologacao.invalid/qrcode',
      fiscal_consulta_chave_url_homologacao: 'https://homologacao.invalid/consulta',
      fiscal_municipio_codigo: '2307304',
      fiscal_municipio_nome: 'Juazeiro do Norte',
      fiscal_emitente_cep: '63000000',
      fiscal_emitente_logradouro: 'Rua Teste',
      fiscal_emitente_numero: '1',
      fiscal_emitente_bairro: 'Centro'
    };
    for (const [k, v] of Object.entries(cfg)) await setCfg(k, v);

    await run(
      `INSERT INTO produtos (id, codigo, nome, unidade, preco_venda) VALUES (1, 'P1', 'PRODUTO TESTE', 'UN', 10)`
    );
    await run(`UPDATE produtos SET ncm = '22021000', cfop = '5102', csosn = '102', origem = '0' WHERE id = 1`)
      .catch(() => {});

    for (const id of [14, 15, 16, 17, 18, 19, 20]) await criarVenda(id);

    emissor = require('../../backend/services/fiscal/emissor');
    configService = require('../../backend/services/fiscal/configService');
    numeracao = require('../../backend/services/fiscal/numeracaoFiscalService');
  });

  after(() => {
    db.close(() => {});
  });

  it('01 — config exibe o mesmo número que a reserva usará (legado "próximo 10002")', async () => {
    const cfg = await configService.getFiscalConfig({ validarUrls: false });
    assert.equal(cfg.numeracaoDocumentos.nfce.proximoNumero, 10002);
    assert.equal(cfg.numeroAtual + 1, 10002, 'tela deriva próximo = numeroAtual + 1');
    assert.equal(cfg.serie, 1);
    assert.equal(await proximoNaTabela(), 10002, 'migração legada respeita "último usado + 1"');
  });

  it('02 — venda nº 14 com próximo 10002: XML usa nNF 10002 série 1, nunca o número da venda', async () => {
    const antes = await snapshotVenda(14);
    transporte.chamadas.length = 0;
    transporte.responder = respostaAutorizada;

    const r = await emissor.emitirPorVendaId(14);

    assert.equal(r.status, 'autorizada');
    assert.equal(r.numero, 10002);
    assert.equal(r.serie, 1);
    assert.equal(transporte.chamadas.length, 1);
    assert.equal(transporte.chamadas[0].nNF, 10002);
    assert.notEqual(transporte.chamadas[0].nNF, 14);
    assert.equal(transporte.chamadas[0].serie, 1);
    assert.equal(transporte.chamadas[0].chave.slice(22, 25), '001');
    assert.equal(transporte.chamadas[0].chave.slice(25, 34), '000010002');

    const nota = await get('SELECT * FROM nfce_notas WHERE venda_id = 14');
    assert.equal(Number(nota.numero), 10002);
    assert.equal(Number(nota.serie), 1);
    assert.equal(nota.chave_acesso, transporte.chamadas[0].chave);
    assert.match(nota.xml_enviado, /<nNF>10002<\/nNF>/);
    assert.match(nota.xml_enviado, /<serie>1<\/serie>/);
    assert.match(nota.xml_enviado, /<mod>65<\/mod>/);

    assert.equal(await snapshotVenda(14), antes, 'venda finalizada permanece inalterada');
  });

  it('03 — após autorizar, config e tabela de reserva avançam juntas', async () => {
    const cfg = await configService.getFiscalConfig({ validarUrls: false });
    assert.equal(cfg.numeracaoDocumentos.nfce.proximoNumero, 10003);
    assert.equal(cfg.numeroAtual + 1, 10003);
    assert.equal(await proximoNaTabela(), 10003);
  });

  it('04 — reemitir/reimprimir venda autorizada não cria nova numeração', async () => {
    transporte.chamadas.length = 0;
    const r = await emissor.emitirPorVendaId(14);
    assert.equal(r.reused, true);
    assert.equal(r.numero, 10002);
    await emissor.obterDanfeHtmlAtualizado(14).catch(() => null);
    assert.equal(transporte.chamadas.length, 0);
    assert.equal(await proximoNaTabela(), 10003);
    const notas = await all('SELECT id FROM nfce_notas WHERE venda_id = 14');
    assert.equal(notas.length, 1);
  });

  it('05 — duas emissões concorrentes não reservam o mesmo número', async () => {
    transporte.chamadas.length = 0;
    transporte.responder = respostaAutorizada;
    const [a, b] = await Promise.all([emissor.emitirPorVendaId(15), emissor.emitirPorVendaId(16)]);
    assert.equal(a.status, 'autorizada');
    assert.equal(b.status, 'autorizada');
    assert.notEqual(a.numero, b.numero);
    assert.deepEqual([a.numero, b.numero].sort((x, y) => x - y), [10003, 10004]);
    assert.equal(await proximoNaTabela(), 10005);
  });

  it('06 — rejeição comum não avança a sequência e o retry mantém nNF, série e cNF (mesmo com série alterada na config)', async () => {
    transporte.chamadas.length = 0;
    transporte.responder = respostaRejeicaoComum;
    const r1 = await emissor.emitirPorVendaId(17);
    assert.equal(r1.status, 'rejeitada');
    assert.equal(r1.numero, 10005);
    assert.match(r1.message, /cStat 225\): Rejeicao: Falha no Schema XML/);
    assert.equal(await proximoNaTabela(), 10006);

    await setCfg('fiscal_serie', '2');
    try {
      transporte.responder = respostaAutorizada;
      const r2 = await emissor.emitirPorVendaId(17);
      assert.equal(r2.status, 'autorizada');
      assert.equal(r2.numero, 10005);
      assert.equal(r2.serie, 1);
    } finally {
      await setCfg('fiscal_serie', '1');
    }

    assert.equal(transporte.chamadas.length, 2);
    assert.equal(transporte.chamadas[1].nNF, transporte.chamadas[0].nNF);
    assert.equal(transporte.chamadas[1].serie, 1);
    assert.equal(transporte.chamadas[1].cNF, transporte.chamadas[0].cNF, 'mesma identidade (cNF)');
    assert.equal(await proximoNaTabela(), 10006, 'sequência não avançou no retry');
    const notas = await all('SELECT * FROM nfce_notas WHERE venda_id = 17');
    assert.equal(notas.length, 1);
    assert.equal(notas[0].chave_acesso, transporte.chamadas[1].chave);
  });

  it('07 — duplicidade 539: registra número, série, chaves, código e mensagem; não repete nem gera novo número', async () => {
    transporte.chamadas.length = 0;
    transporte.responder = resposta539;
    const r = await emissor.emitirPorVendaId(18);
    assert.equal(r.status, 'rejeitada_duplicidade');
    assert.equal(r.success, false);
    assert.equal(r.numero, 10006);
    assert.ok(r.duplicidade);
    assert.equal(r.duplicidade.cStat, '539');
    assert.equal(r.duplicidade.numero, 10006);
    assert.equal(r.duplicidade.serie, 1);
    assert.equal(r.duplicidade.chaveEnviada, transporte.chamadas[0].chave);
    assert.equal(r.duplicidade.chaveSefaz, chaveSefazDiferente(transporte.chamadas[0].chave));
    assert.match(r.duplicidade.xMotivo, /Duplicidade/);
    assert.match(r.message, /Recuperar duplicidades/);

    const nota = await get('SELECT * FROM nfce_notas WHERE venda_id = 18');
    assert.equal(nota.status, 'rejeitada_duplicidade');
    assert.match(nota.xml_retorno, /<cStat>539<\/cStat>/);
    const ocup = await get(
      `SELECT * FROM nfce_numeros_ocupados_sefaz WHERE numero = 10006 AND serie = 1 AND ambiente = 2`
    );
    assert.ok(ocup, 'número ocupado registrado sem apagar histórico');

    const proximoApos539 = await proximoNaTabela();
    for (let i = 0; i < 3; i += 1) {
      const retry = await emissor.emitirPorVendaId(18);
      assert.equal(retry.status, 'duplicidade_pendente_consulta');
      assert.equal(retry.success, false);
      assert.equal(retry.numero, 10006);
      assert.equal(retry.serie, 1);
    }
    assert.equal(transporte.chamadas.length, 1, 'nenhuma retransmissão automática após 539');
    assert.equal(await proximoNaTabela(), proximoApos539, 'nenhuma nova reserva após 539');
    const notas = await all('SELECT id FROM nfce_notas WHERE venda_id = 18');
    assert.equal(notas.length, 1);
  });

  it('08 — timeout: consulta a chave antes de qualquer nova emissão; sem resposta conclusiva, bloqueia', async () => {
    transporte.chamadas.length = 0;
    consulta.chamadas.length = 0;
    transporte.responder = respostaTimeout;
    const r1 = await emissor.emitirPorVendaId(19);
    assert.equal(r1.status, 'erro_transmissao');
    const numero = r1.numero;
    const chaveTentativa = transporte.chamadas[0].chave;
    const proximoAntes = await proximoNaTabela();

    consulta.responder = consultaSemResposta;
    const r2 = await emissor.emitirPorVendaId(19);
    assert.equal(r2.status, 'consulta_situacao_pendente');
    assert.equal(r2.numero, numero);
    assert.equal(consulta.chamadas.length, 1);
    assert.equal(consulta.chamadas[0].chave, chaveTentativa);
    assert.equal(transporte.chamadas.length, 1, 'não retransmite sem confirmação');
    assert.equal(await proximoNaTabela(), proximoAntes, 'não gera outro número');

    consulta.responder = consultaAutorizada;
    const r3 = await emissor.emitirPorVendaId(19);
    assert.equal(r3.success, true);
    assert.equal(r3.status, 'autorizada');
    assert.equal(r3.recuperadaPorConsulta, true);
    assert.equal(r3.numero, numero);
    assert.equal(r3.chaveAcesso, chaveTentativa);
    assert.equal(transporte.chamadas.length, 1, 'autorizada na SEFAZ: nada é retransmitido');
    const nota = await get('SELECT * FROM nfce_notas WHERE venda_id = 19');
    assert.equal(nota.status, 'autorizada');
    assert.equal(nota.protocolo, '323260000000077');
    assert.equal(await proximoNaTabela(), proximoAntes);

    const r4 = await emissor.emitirPorVendaId(19);
    assert.equal(r4.reused, true);
    assert.equal(consulta.chamadas.length, 2, 'nota já autorizada não é consultada de novo');
  });

  it('09 — timeout + consulta "não consta" (217): retransmite com o mesmo nNF, série e chave', async () => {
    transporte.chamadas.length = 0;
    consulta.chamadas.length = 0;
    transporte.responder = respostaTimeout;
    const r1 = await emissor.emitirPorVendaId(20);
    const proximoAntes = await proximoNaTabela();

    consulta.responder = consultaNaoConsta;
    transporte.responder = respostaAutorizada;
    const r2 = await emissor.emitirPorVendaId(20);
    assert.equal(r2.status, 'autorizada');
    assert.equal(r2.numero, r1.numero);
    assert.equal(consulta.chamadas.length, 1);
    assert.equal(transporte.chamadas.length, 2);
    assert.equal(transporte.chamadas[1].nNF, transporte.chamadas[0].nNF);
    assert.equal(transporte.chamadas[1].serie, transporte.chamadas[0].serie);
    assert.equal(transporte.chamadas[1].cNF, transporte.chamadas[0].cNF);
    assert.equal(transporte.chamadas[1].chave, transporte.chamadas[0].chave, 'mesma chave no mesmo mês');
    assert.equal(await proximoNaTabela(), proximoAntes);
  });

  it('10 — salvar "Próximo Número NFC-e" grava na mesma tabela usada pela reserva', async () => {
    await numeracao.salvarProximaNumeracaoFiscal({
      cnpj: CNPJ, ambiente: 2, modelo: '65', serie: 1, proximoNumero: 20000
    });
    const cfg = await configService.getFiscalConfig({ validarUrls: false });
    assert.equal(cfg.numeracaoDocumentos.nfce.proximoNumero, 20000);
    assert.equal(cfg.numeroAtual + 1, 20000);

    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/fiscal.js'), 'utf8');
    assert.match(
      rota,
      /payload\.fiscal_numero_atual !== undefined\)\s*\{\s*try\s*\{[\s\S]*?salvarProximaNumeracaoFiscal\([\s\S]*?modelo:\s*'65'/
    );

    const reserva = await numeracao.reservarProximaNumeracaoFiscal({
      cnpj: CNPJ, ambiente: 2, modelo: '65', serie: 1, origem: 'TESTE'
    });
    assert.equal(reserva.numero, 20000, 'número exibido = número reservado');
  });

  it('12 — tela exibe numeracaoDocumentos.nfce e só envia a numeração quando alterada', () => {
    const front = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
    assert.match(front, /cfg\.numeracaoDocumentos\.nfce\.proximoNumero/);
    assert.match(front, /proximoNumeroEl\.dataset\.original = String\(nfceProx\)/);
    assert.match(
      front,
      /if \(String\(proximoNumero\) !== String\(campoProximoNfce\.dataset\.original \|\| ''\)\) \{\s*payload\.fiscal_numero_atual = proximoNumero - 1;\s*\} else \{\s*delete payload\.fiscal_numero_atual;/
    );
  });

  it('13 — CSC de homologação próprio, sem alterar o CSC de produção', async () => {
    let cfg = await configService.getFiscalConfig({ validarUrls: false });
    assert.equal(cfg.idCSC, '1', 'sem CSC de homologação, usa o cadastrado (legado)');

    await setCfg('fiscal_id_csc_homologacao', '2');
    await setCfg('fiscal_token_csc_homologacao', 'TOKENHOMOLOG');
    try {
      cfg = await configService.getFiscalConfig({ validarUrls: false });
      assert.equal(cfg.idCSC, '2');
      assert.equal(cfg.tokenCSC, 'TOKENHOMOLOG');
      assert.equal(cfg.idCSCProducao, '1');
      assert.equal(cfg.tokenCSCProducao, 'TOKENTESTE');

      await setCfg('fiscal_ambiente', '1');
      cfg = await configService.getFiscalConfig({ validarUrls: false });
      assert.equal(cfg.idCSC, '1', 'produção continua com o CSC de produção');
      assert.equal(cfg.tokenCSC, 'TOKENTESTE');
    } finally {
      await setCfg('fiscal_ambiente', '2');
      await setCfg('fiscal_id_csc_homologacao', '');
      await setCfg('fiscal_token_csc_homologacao', '');
    }
  });

  it('11 — prévia não consome numeração', async () => {
    const a = await numeracao.previsualizarProximaNumeracaoFiscal({ cnpj: CNPJ, ambiente: 2, modelo: '65', serie: 1 });
    const b = await numeracao.previsualizarProximaNumeracaoFiscal({ cnpj: CNPJ, ambiente: 2, modelo: '65', serie: 1 });
    assert.equal(a.numero, b.numero);
    assert.equal(await proximoNaTabela(), a.numero);
  });
});
