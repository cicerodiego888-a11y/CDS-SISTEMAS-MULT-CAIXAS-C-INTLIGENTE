/**
 * Testes — Classificador oficial de documentos DF-e (RC6.1)
 * Apenas classificação. Sem HTTP / SEFAZ / banco / pipeline.
 *
 * Executar: npm run test:central-entradas-rc6.1
 */

const assert = require('assert');
const DocumentoDfeClassifier = require('../../backend/motores/central-entradas/services/DocumentoDfeClassifier');
const {
  DocumentoDfeTipo,
  isValido
} = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

function main() {
  console.log('\n=== Testes RC6.1 — DocumentoDfeClassifier ===\n');

  test('enum DocumentoDfeTipo contém os 6 tipos oficiais', () => {
    assert.strictEqual(DocumentoDfeTipo.RES_NFE, 'RES_NFE');
    assert.strictEqual(DocumentoDfeTipo.PROC_NFE, 'PROC_NFE');
    assert.strictEqual(DocumentoDfeTipo.NFE, 'NFE');
    assert.strictEqual(DocumentoDfeTipo.PROC_EVENTO_NFE, 'PROC_EVENTO_NFE');
    assert.strictEqual(DocumentoDfeTipo.RES_EVENTO, 'RES_EVENTO');
    assert.strictEqual(DocumentoDfeTipo.DESCONHECIDO, 'DESCONHECIDO');
    assert.ok(isValido(DocumentoDfeTipo.RES_NFE));
  });

  test('classifica resNFe → RES_NFE', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>23260707196033002141550090012840571375100827</chNFe>
</resNFe>`;
    assert.strictEqual(DocumentoDfeClassifier.classificar(xml), DocumentoDfeTipo.RES_NFE);
  });

  test('classifica nfeProc → PROC_NFE', () => {
    const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe123"/></NFe>
</nfeProc>`;
    assert.strictEqual(DocumentoDfeClassifier.classificar(xml), DocumentoDfeTipo.PROC_NFE);
  });

  test('classifica NFe → NFE', () => {
    const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe123"/>
</NFe>`;
    assert.strictEqual(DocumentoDfeClassifier.classificar(xml), DocumentoDfeTipo.NFE);
  });

  test('classifica procEventoNFe → PROC_EVENTO_NFE', () => {
    const xml = `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <evento/>
</procEventoNFe>`;
    assert.strictEqual(
      DocumentoDfeClassifier.classificar(xml),
      DocumentoDfeTipo.PROC_EVENTO_NFE
    );
  });

  test('classifica resEvento → RES_EVENTO', () => {
    const xml = `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>23260707196033002141550090012840571375100827</chNFe>
</resEvento>`;
    assert.strictEqual(DocumentoDfeClassifier.classificar(xml), DocumentoDfeTipo.RES_EVENTO);
  });

  test('XML desconhecido → DESCONHECIDO', () => {
    assert.strictEqual(
      DocumentoDfeClassifier.classificar('<retDistDFeInt versao="1.01"/>'),
      DocumentoDfeTipo.DESCONHECIDO
    );
    assert.strictEqual(DocumentoDfeClassifier.classificar(''), DocumentoDfeTipo.DESCONHECIDO);
    assert.strictEqual(DocumentoDfeClassifier.classificar(null), DocumentoDfeTipo.DESCONHECIDO);
    assert.strictEqual(DocumentoDfeClassifier.classificar(undefined), DocumentoDfeTipo.DESCONHECIDO);
    assert.strictEqual(
      DocumentoDfeClassifier.classificar('<foo><bar/></foo>'),
      DocumentoDfeTipo.DESCONHECIDO
    );
  });

  test('ignora comentário inicial e prefixo de namespace', () => {
    const comComentario = `<!-- resumo -->
<resNFe versao="1.01"><chNFe>1</chNFe></resNFe>`;
    assert.strictEqual(
      DocumentoDfeClassifier.classificar(comComentario),
      DocumentoDfeTipo.RES_NFE
    );

    const comPrefixo = `<nfe:nfeProc xmlns:nfe="http://www.portalfiscal.inf.br/nfe" versao="4.00"/>`;
    assert.strictEqual(
      DocumentoDfeClassifier.classificar(comPrefixo),
      DocumentoDfeTipo.PROC_NFE
    );
  });

  test('não confunde NFe interno de nfeProc com raiz NFE', () => {
    const xml = `<nfeProc versao="4.00"><NFe><infNFe/></NFe></nfeProc>`;
    assert.strictEqual(DocumentoDfeClassifier.classificar(xml), DocumentoDfeTipo.PROC_NFE);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
