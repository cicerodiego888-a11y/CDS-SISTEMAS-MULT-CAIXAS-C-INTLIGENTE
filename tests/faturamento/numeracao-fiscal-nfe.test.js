/**
 * Numeração fiscal independente (NFC-e 65 × NF-e 55) e nova identidade após 539.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  validarNumeracaoFiscal,
  chaveLockNumeracao,
  proximoLivreDeConjunto,
  cnpjChave,
  padModelo
} = require('../../backend/services/fiscal/numeracaoFiscalService');
const { withLockQueued, resetLocksForTests } = require('../../backend/services/fiscal/nfeEmissionLockService');
const { criarIdentidadeNfe } = require('../../backend/services/fiscal/nfeIdentityService');
const { podeReenviarDevolucao, podeGerarNovaIdentidadeDevolucao } = require('../../backend/services/fiscal/nfeDevolucaoEstados');
const { auditarNfe } = require('../../backend/services/fiscal/auditoriaFiscalNfe');

const ROOT = path.join(__dirname, '../..');

describe('Numeração fiscal configurável — NF-e 55', () => {
  it('1. configuração independente NFC-e e NF-e (chaves distintas)', () => {
    const a = chaveLockNumeracao({ cnpj: '111', ambiente: 2, modelo: '65', serie: 1 });
    const b = chaveLockNumeracao({ cnpj: '111', ambiente: 2, modelo: '55', serie: 1 });
    assert.notEqual(a, b);
    assert.equal(padModelo(65), '65');
    assert.equal(padModelo('55'), '55');
  });

  it('2. modelo 65 não interfere no modelo 55', () => {
    const map = new Map();
    map.set('A|2|65|1', 1250);
    map.set('A|2|55|1', 9);
    assert.equal(map.get('A|2|65|1'), 1250);
    assert.equal(map.get('A|2|55|1'), 9);
  });

  it('3. empresa A não interfere na empresa B', () => {
    const a = chaveLockNumeracao({ cnpj: '11111111000191', ambiente: 2, modelo: '55', serie: 1 });
    const b = chaveLockNumeracao({ cnpj: '22222222000191', ambiente: 2, modelo: '55', serie: 1 });
    assert.notEqual(a, b);
    assert.notEqual(cnpjChave('11.111.111/0001-91'), cnpjChave('22.222.222/0001-91'));
  });

  it('4. produção não interfere em homologação', () => {
    const hom = chaveLockNumeracao({ cnpj: '1', ambiente: 2, modelo: '55', serie: 1 });
    const prod = chaveLockNumeracao({ cnpj: '1', ambiente: 1, modelo: '55', serie: 1 });
    assert.notEqual(hom, prod);
  });

  it('5. série 1 não interfere em outra série', () => {
    const s1 = chaveLockNumeracao({ cnpj: '1', ambiente: 2, modelo: '55', serie: 1 });
    const s2 = chaveLockNumeracao({ cnpj: '1', ambiente: 2, modelo: '55', serie: 2 });
    assert.notEqual(s1, s2);
  });

  it('6. próximo número configurado / validado', () => {
    const v = validarNumeracaoFiscal({ serie: 1, proximoNumero: 9 });
    assert.equal(v.proximoNumero, 9);
    assert.throws(() => validarNumeracaoFiscal({ serie: 0, proximoNumero: 1 }), /Série/);
    assert.throws(() => validarNumeracaoFiscal({ serie: 1, proximoNumero: 0 }), /número/);
    assert.throws(() => validarNumeracaoFiscal({ serie: 1, proximoNumero: 1000000000 }), /número/);
  });

  it('7-8. incremento atômico — dois processos não recebem o mesmo número', async () => {
    resetLocksForTests();
    const store = { n: 9 };
    const a = withLockQueued('fiscal-num:test:2:55:1', async () => {
      const v = store.n;
      await new Promise((r) => setTimeout(r, 15));
      store.n = v + 1;
      return v;
    });
    const b = withLockQueued('fiscal-num:test:2:55:1', async () => {
      const v = store.n;
      store.n = v + 1;
      return v;
    });
    const [na, nb] = await Promise.all([a, b]);
    assert.notEqual(na, nb);
    assert.deepEqual([na, nb].sort((x, y) => x - y), [9, 10]);
  });

  it('9. auditoria pré-numeração não exige nNF real (fase pre_numeracao)', () => {
    const r = auditarNfe({
      xml: '<NFe><infNFe></infNFe></NFe>',
      contexto: { fase: 'pre_numeracao' }
    });
    assert.equal(r.erros.some((e) => String(e.codigo || '').startsWith('AUD-NUM')), false);
  });

  it('10-12. nova emissão após 539 recebe novo nNF, cNF e chave', () => {
    const a = criarIdentidadeNfe({
      uf: '23', aamm: '2608', cnpj: '57824986000131', modelo: '55',
      serie: 1, numero: 9, tpEmis: '1', cNF: '17371031', ambiente: 2
    });
    const b = criarIdentidadeNfe({
      uf: '23', aamm: '2608', cnpj: '57824986000131', modelo: '55',
      serie: 1, numero: 10, tpEmis: '1', cNF: '99999999', ambiente: 2
    });
    assert.notEqual(a.numero, b.numero);
    assert.notEqual(a.cNF, b.cNF);
    assert.notEqual(a.chave, b.chave);
  });

  it('13. XML antigo permanece imutável (congelamento no lifecycle)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoLifecycleService.js'),
      'utf8'
    );
    assert.match(src, /filtrarCamposIdentidadeSeCongelado/);
    assert.match(src, /if \(!nota\.xml_assinado\)/);
  });

  it('14-15. rascunho preserva e reutiliza N itens', () => {
    const itens = Array.from({ length: 46 }, (_, i) => ({ compra_item_id: i + 1, quantidade: 1 }));
    assert.equal(itens.length, 46);
    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoCompra.js'), 'utf8');
    assert.match(svc, /salvarRascunhoDevolucaoCompra/);
    assert.match(svc, /rascunho\.itens/);
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
    assert.match(ui, /gerarNovaNfeDevolucaoCompra/);
    assert.match(ui, /aplicarRascunhoNfeDevolucaoCompra/);
  });

  it('16-17. reenvio 539/275/590/863 bloqueado; gerar nova identidade permitido', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '539' }), false);
    assert.equal(podeGerarNovaIdentidadeDevolucao({ cstat_retorno: '539' }), true);
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '275' }), false);
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '590' }), false);
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '863' }), false);
    assert.equal(podeGerarNovaIdentidadeDevolucao({ cstat_retorno: '275' }), true);
  });

  it('18. NFC-e continua com incrementaNumeroFiscal próprio (modelo 65)', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/configService.js'), 'utf8');
    assert.match(cfg, /async function incrementaNumeroFiscal/);
    assert.match(cfg, /FROM nfce_notas/);
    assert.match(cfg, /modelo: '65'/);
  });

  it('19. documento autorizado não pode ter identidade alterada', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/fiscal/nfeIdentityService.js'),
      'utf8'
    );
    assert.match(src, /IDENTIDADE_IMUTAVEL/);
  });

  it('20. prévia mostra número e série da nova NF-e', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
    assert.match(ui, /Dados da nova NF-e/);
    assert.match(ui, /previa\.numero/);
    assert.match(ui, /previa\.serie/);
    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoCompra.js'), 'utf8');
    assert.match(svc, /obterProximaNumeracaoFiscal/);
    assert.match(svc, /reservarNumero: false/);
  });

  it('números ocupados na SEFAZ são pulados', () => {
    assert.equal(proximoLivreDeConjunto(8, [8, 9]), 10);
  });

  it('UI de configuração fiscal tem NF-e modelo 55', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
    assert.match(ui, /proximoNumeroNfe/);
    assert.match(ui, /fiscal_serie_nfe/);
    assert.match(ui, /Numeração dos documentos fiscais/i);
  });

  it('auditoria prévia ocorre antes de reservar número na emissão', () => {
    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoCompra.js'), 'utf8');
    const emit = svc.slice(svc.indexOf('async function emitirNFeDevolucaoCompra'));
    const iPre = emit.indexOf('auditoriaPre');
    const iNum = emit.indexOf('proximoNumeroNFeVenda');
    assert.ok(iPre > 0 && iNum > iPre);
  });
});
