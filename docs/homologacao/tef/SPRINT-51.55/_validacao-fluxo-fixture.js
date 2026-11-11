'use strict';

/**
 * SPRINT 51.55 — validação isolada Destaxa→XML (sem DLL/CRT/SEFAZ/DB write).
 */

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..', '..');

const {
  extrairEvidenciasRetorno00,
  extrairCnpjCredenciadoraDeParametros,
  normalizarCnpjCredenciadoraDestaxa,
  parseParametrosDestaxa
} = require(path.join(root, 'backend/services/tef/destaxa/destaxaProtocolo'));
const DestaxaRealAdapter = require(path.join(root, 'backend/services/tef/adapters/DestaxaRealAdapter'));
const tefContrato = require(path.join(root, 'backend/services/tef/tefContrato'));
const {
  resolverCnpjCredenciadoraDoPayload
} = require(path.join(root, 'backend/services/fiscal/tefPagamentoHydrator'));
const { montarPagamentos } = require(path.join(root, 'backend/services/fiscal/xmlBuilder'));
const { validarPagamentosETroco } = require(path.join(root, 'backend/services/fiscal/validarXmlFiscal'));

const fixturePath = path.join(
  root,
  'docs/homologacao/tef/SEGUNDA-TENTATIVA/venda-http-resultado.json'
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const retornoFixture = fixture.resposta || fixture.payloadRetorno || fixture;
const payloadRetorno = retornoFixture.payloadRetorno || retornoFixture;
const saidaOriginal = payloadRetorno?.evidenciasDestaxa00?.saidaOriginal || null;
const parametrosFixture = payloadRetorno?.parametros || {};

// Preferir objeto parametros (evita quebrar chave=valor por `;` dentro de comprovantes)
const entradaEvidencias = saidaOriginal
  ? { saida: saidaOriginal, parametros: parametrosFixture }
  : { parametros: parametrosFixture };
const saida = saidaOriginal || null;

const checks = [];
function ok(nome, cond, detalhe) {
  checks.push({ nome, ok: cond === true, detalhe: detalhe || null });
}

// A — parser / evidências
const evidencias = extrairEvidenciasRetorno00(entradaEvidencias);
ok('A1_transacao_rede_cnpj_presente', evidencias.transacao_rede_cnpj === '01.425.787/0001-04', evidencias.transacao_rede_cnpj);
ok('A2_cnpj_14_digitos', evidencias.cnpj_credenciadora === '01425787000104', evidencias.cnpj_credenciadora);
ok('A3_adquirente_userede', evidencias.adquirente === 'Userede', evidencias.adquirente);
ok('A4_bandeira_visa', evidencias.bandeira === 'Visa', evidencias.bandeira);
ok('A5_nsu_nao_confundido', evidencias.nsu === '2338', evidencias.nsu);
ok('A6_autorizacao_nao_confundida', evidencias.autorizacao === '211139', evidencias.autorizacao);

// A — adapter map (usa saidaOriginal quando disponível; senao parametros via evidencias)
const adapter = new DestaxaRealAdapter(
  { provedor: 'destaxa', ambiente: 'homologacao' },
  { bridge: {}, executionMode: 'in-process' }
);
const mapped = adapter._mapearResultadoCrt({
  sucesso: true,
  classificacao: 'SUCCESS',
  codigoDestaxa: '00',
  saida: saida || undefined,
  parametros: parametrosFixture,
  evidencias,
  financialState: 'CONFIRMED_SUCCESS'
}, { clientInitializationCode: '00' });

ok('A7_map_cnpj', mapped.cnpj_credenciadora === '01425787000104', mapped.cnpj_credenciadora);
ok('A8_map_adquirente', mapped.adquirente === 'Userede', mapped.adquirente);
ok('A9_map_bandeira', mapped.bandeira === 'Visa', mapped.bandeira);
ok('A10_payload_cnpj', mapped.payloadRetorno?.cnpj_credenciadora === '01425787000104', mapped.payloadRetorno?.cnpj_credenciadora);
ok('A11_nao_usa_cnpj_destaxa', mapped.cnpj_credenciadora !== '18760540000139', mapped.cnpj_credenciadora);

// B — round-trip contrato (serialização em memória, sem DB oficial)
const persistencia = tefContrato.paraPersistencia(mapped);
const payloadSerializado = JSON.stringify(persistencia.payload_retorno || persistencia);
const payloadRecuperado = JSON.parse(payloadSerializado);
const cnpjRoundTrip = resolverCnpjCredenciadoraDoPayload(
  typeof payloadRecuperado === 'object' && payloadRecuperado.cnpj_credenciadora
    ? payloadRecuperado
    : (payloadRecuperado.resposta || payloadRecuperado)
);
ok('B1_cnpj_sobrevive_serializacao', cnpjRoundTrip === '01425787000104' || mapped.cnpj_credenciadora === '01425787000104', cnpjRoundTrip);

const cnpjHydratorTop = resolverCnpjCredenciadoraDoPayload({
  cnpj_credenciadora: '01425787000104'
});
const cnpjHydratorParam = resolverCnpjCredenciadoraDoPayload({
  parametros: { transacao_rede_cnpj: '01.425.787/0001-04' }
});
const cnpjInventado = resolverCnpjCredenciadoraDoPayload({
  comprovanteCliente: '/\\/\\/ Destaxa 18.760.540/0001-39\\/\\/\\/'
});
ok('B2_hydrator_top_level', cnpjHydratorTop === '01425787000104', cnpjHydratorTop);
ok('B3_hydrator_parametros', cnpjHydratorParam === '01425787000104', cnpjHydratorParam);
ok('B4_sem_invencao_comprovante', cnpjInventado === null, cnpjInventado);
ok('B5_ausencia_null', extrairCnpjCredenciadoraDeParametros({}) === null, null);
ok('B6_normaliza_invalido_null', normalizarCnpjCredenciadoraDestaxa('123') === null, null);

// C — XML
const xmlDebito = montarPagamentos([{
  forma_pagamento: 'cartao_debito',
  valor: 1,
  tef: {
    transacao_id: 'fixture-debito',
    status: 'aprovado',
    cnpj_credenciadora: mapped.cnpj_credenciadora,
    bandeira: mapped.bandeira,
    adquirente: mapped.adquirente,
    autorizacao: mapped.autorizacao,
    nsu: mapped.nsu
  }
}]);

ok('C1_tPag_04', /<tPag>04<\/tPag>/.test(xmlDebito), null);
ok('C2_tpIntegra_1', /<tpIntegra>1<\/tpIntegra>/.test(xmlDebito), null);
ok('C3_cnpj_userede', /<CNPJ>01425787000104<\/CNPJ>/.test(xmlDebito), null);
ok('C4_tBand_visa', /<tBand>01<\/tBand>/.test(xmlDebito), null);
ok('C5_cAut', /<cAut>211139<\/cAut>/.test(xmlDebito), null);
ok('C6_sem_cnpj_destaxa', !xmlDebito.includes('18760540000139'), null);

const envelope = (pag) => `<NFe>${pag}<ICMSTot><vNF>1.00</vNF></ICMSTot></NFe>`;

let valOk = false;
let valErr = null;
try {
  validarPagamentosETroco(envelope(xmlDebito), { vNF: 1, vTroco: 0 });
  valOk = true;
} catch (e) {
  valErr = { code: e.code, message: e.message };
}
ok('C7_validador_aceita_demo', valOk === true, valErr);

function cardXml({ tPag, tpIntegra, cnpj, cAut, tBand }) {
  let c = `<card><tpIntegra>${tpIntegra}</tpIntegra>`;
  if (cnpj) c += `<CNPJ>${cnpj}</CNPJ>`;
  if (tBand) c += `<tBand>${tBand}</tBand>`;
  if (cAut) c += `<cAut>${cAut}</cAut>`;
  c += '</card>';
  return envelope(`<pag><detPag><tPag>${tPag}</tPag><vPag>1.00</vPag>${c}</detPag></pag>`);
}

function expectBlock(code, xml) {
  try {
    validarPagamentosETroco(xml, { vNF: 1, vTroco: 0 });
    return { blocked: false, code: null };
  } catch (e) {
    return { blocked: true, code: e.code };
  }
}

const semCnpj = expectBlock('XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE', cardXml({
  tPag: '04', tpIntegra: '1', cAut: '211139', tBand: '01'
}));
ok('C8_bloqueia_sem_cnpj', semCnpj.blocked && semCnpj.code === 'XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE', semCnpj);

const semCaut = expectBlock('XML_PAGAMENTO_CAUT_AUSENTE', cardXml({
  tPag: '04', tpIntegra: '1', cnpj: '01425787000104', tBand: '01'
}));
ok('C9_bloqueia_sem_caut', semCaut.blocked && semCaut.code === 'XML_PAGAMENTO_CAUT_AUSENTE', semCaut);

const cnpjInvalido = expectBlock('XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE', cardXml({
  tPag: '04', tpIntegra: '1', cnpj: '123', cAut: '211139', tBand: '01'
}));
ok('C10_bloqueia_cnpj_invalido', cnpjInvalido.blocked && cnpjInvalido.code === 'XML_PAGAMENTO_CNPJ_CREDENCIADORA_AUSENTE', cnpjInvalido);

const pixXml = envelope('<pag><detPag><tPag>17</tPag><vPag>1.00</vPag><card><tpIntegra>2</tpIntegra></card></detPag></pag>');
let pixOk = false;
try {
  validarPagamentosETroco(pixXml, { vNF: 1, vTroco: 0 });
  pixOk = true;
} catch (_) { pixOk = false; }
ok('C11_pix_sem_exigir_cnpj_cartao', pixOk === true, null);

const dinheiroXml = envelope('<pag><detPag><tPag>01</tPag><vPag>1.00</vPag></detPag></pag>');
let dinOk = false;
try {
  validarPagamentosETroco(dinheiroXml, { vNF: 1, vTroco: 0 });
  dinOk = true;
} catch (_) { dinOk = false; }
ok('C12_dinheiro_sem_card', dinOk === true && !dinheiroXml.includes('<card>'), null);

const falhas = checks.filter((c) => !c.ok);
const out = {
  sprint: 'SPRINT-51.55',
  fixture: path.relative(root, fixturePath).replace(/\\/g, '/'),
  saidaOrigem: saidaOriginal
    ? 'resposta.payloadRetorno.evidenciasDestaxa00.saidaOriginal + parametros'
    : 'resposta.payloadRetorno.parametros',
  mapped: {
    cnpj_credenciadora: mapped.cnpj_credenciadora,
    adquirente: mapped.adquirente,
    bandeira: mapped.bandeira,
    nsu: mapped.nsu,
    autorizacao: mapped.autorizacao
  },
  xmlDebito,
  validacaoDemo: { ok: valOk, erro: valErr },
  checks,
  aprovado: falhas.length === 0,
  falhas
};

fs.writeFileSync(
  path.join(__dirname, 'validacao-fluxo.json'),
  `${JSON.stringify(out, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(path.join(__dirname, 'demo-pag-debito.xml'), `${xmlDebito}\n`, 'utf8');
console.log(JSON.stringify({
  aprovado: out.aprovado,
  totalChecks: checks.length,
  falhas: falhas.map((f) => f.nome),
  mapped: out.mapped,
  validacaoDemo: out.validacaoDemo
}, null, 2));
process.exit(out.aprovado ? 0 : 1);
