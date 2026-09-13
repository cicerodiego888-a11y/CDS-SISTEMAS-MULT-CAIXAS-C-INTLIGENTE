/**
 * Validação fiscal obrigatória / escrituração interna
 * Executar: node tests/compras/rc91-validacao-fiscal.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { extrairDadosFiscaisXml } = require('../../backend/services/compras/extrairSinaisFiscaisXml');
const {
  montarResumoFiscalEntrada,
  sugerirCfopEscrituracao,
  normalizarEscrituracaoParaPersistencia
} = require('../../backend/services/compras/EscrituracaoEntradaCompra');
const { TIPO_ENTRADA } = require('../../backend/services/compras/PoliticaEntradaCompra');

const ROOT = path.join(__dirname, '../..');
let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

console.log('\n=== Validação Fiscal Obrigatória ===\n');

const XML_SAMPLE = `
<nfeProc>
  <infNFe>
    <ide><natOp>Venda de mercadoria</natOp><finNFe>1</finNFe></ide>
    <det>
      <prod><CFOP>5405</CFOP></prod>
      <imposto>
        <ICMS><ICMSSN500><CSOSN>500</CSOSN></ICMSSN500></ICMS>
        <PIS><PISOutr><CST>49</CST></PISOutr></PIS>
        <COFINS><COFINSOutr><CST>49</CST></COFINSOutr></COFINS>
        <IPI><IPITrib><CST>99</CST></IPITrib></IPI>
      </imposto>
    </det>
  </infNFe>
</nfeProc>`;

test('extrai CFOP CSOSN PIS COFINS IPI natureza', () => {
  const d = extrairDadosFiscaisXml(XML_SAMPLE);
  assert.strictEqual(d.cfopPredominante, '5405');
  assert.strictEqual(d.csosn, '500');
  assert.strictEqual(d.cstPis, '49');
  assert.strictEqual(d.cstCofins, '49');
  assert.strictEqual(d.cstIpi, '99');
  assert.match(d.natureza, /mercadoria/i);
});

test('USO_CONSUMO sugere CFOP 1556 divergente de 5405', () => {
  const s = sugerirCfopEscrituracao(TIPO_ENTRADA.USO_CONSUMO, '5405');
  assert.strictEqual(s.utilizado, '1556');
  assert.strictEqual(s.alterado, true);
  assert.ok(s.motivo);
});

test('resumo fiscal destaca divergência CFOP', () => {
  const r = montarResumoFiscalEntrada({
    xml: XML_SAMPLE,
    tipo_entrada: 'USO_CONSUMO',
    dadosCompra: { fornecedor: 'Fornecedor X', valor_total_nota: 1500 }
  });
  assert.strictEqual(r.original.cfop, '5405');
  assert.strictEqual(r.utilizado.cfop, '1556');
  assert.strictEqual(r.alterada, true);
  assert.strictEqual(r.xmlImutavel, true);
  const cfopCampo = r.campos.find((c) => c.campo === 'cfop');
  assert.ok(cfopCampo.divergente);
});

test('operador pode sobrescrever CFOP utilizado', () => {
  const r = montarResumoFiscalEntrada({
    xml: XML_SAMPLE,
    tipo_entrada: 'USO_CONSUMO',
    cfop: '1557',
    dadosCompra: { fornecedor: 'Y', valor_total_nota: 10 }
  });
  assert.strictEqual(r.utilizado.cfop, '1557');
  assert.strictEqual(r.original.cfop, '5405');
});

test('persistência preserva original e utilizado', () => {
  const r = montarResumoFiscalEntrada({
    xml: XML_SAMPLE,
    tipo_entrada: 'USO_CONSUMO',
    dadosCompra: { fornecedor: 'Z', valor_total_nota: 1 }
  });
  const p = normalizarEscrituracaoParaPersistencia({}, r);
  assert.strictEqual(p.cfop_xml, '5405');
  assert.strictEqual(p.cfop, '1556');
  assert.strictEqual(p.escrituracao_alterada, 1);
});

test('REVENDA mantém CFOP do XML', () => {
  const r = montarResumoFiscalEntrada({
    xml: XML_SAMPLE,
    tipo_entrada: 'REVENDA',
    dadosCompra: { fornecedor: 'A', valor_total_nota: 1 }
  });
  assert.strictEqual(r.utilizado.cfop, '5405');
  assert.strictEqual(r.campos.find((c) => c.campo === 'cfop').divergente, false);
});

test('database tem colunas de escrituração', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(src, /cfop_xml/);
  assert.match(src, /csosn_cst_xml/);
  assert.match(src, /escrituracao_motivo/);
});

test('API resumo-fiscal-entrada na rota', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /resumo-fiscal-entrada/);
  assert.match(src, /escrituracao/);
});

test('UI exige validação fiscal antes de gravar', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /mostrarResumoFiscalObrigatorio/);
  assert.match(src, /Validação Fiscal Obrigatória/);
  assert.match(src, /XML SEFAZ é imutável/);
  assert.match(src, /executarGravacaoCompra/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
if (falhas > 0) process.exit(1);
