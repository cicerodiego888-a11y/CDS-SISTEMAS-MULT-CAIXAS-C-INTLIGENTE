/**
 * Impressão opcional de cupom — política, vias e isolamento da venda.
 * node --test tests/impressao/cupom-print-policy.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const Policy = require('../../backend/services/impressao/CupomPrintPolicy');

function loadFront() {
  const sandbox = { module: { exports: {} } };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  const code = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/cupomPrintPolicy.js'), 'utf8');
  const fn = new Function('window', 'global', 'module', 'exports', code + '\nreturn module.exports || window.CupomPrintPolicy;');
  return fn(sandbox, sandbox, sandbox.module, sandbox.module.exports);
}

describe('CupomPrintPolicy — defaults e normalização', () => {
  it('padrão pergunta e 2 vias Cliente/Estabelecimento', () => {
    const fiscal = Policy.resolver({}, 'FISCAL');
    const nf = Policy.resolver({}, 'NAO_FISCAL');
    assert.equal(fiscal.modo, 'PERGUNTAR');
    assert.equal(fiscal.vias, 2);
    assert.deepEqual(fiscal.destinos, ['CLIENTE', 'ESTABELECIMENTO']);
    assert.deepEqual(fiscal.rotulos, ['VIA DO CLIENTE', 'VIA DO ESTABELECIMENTO']);
    assert.equal(nf.modo, 'PERGUNTAR');
    assert.equal(nf.vias, 2);
  });

  it('limita vias e completa destinos', () => {
    const r = Policy.resolver({ fiscal: { vias: 99, destinos: ['CLIENTE'] } }, 'FISCAL');
    assert.equal(r.vias, 4);
    assert.equal(r.destinos.length, 4);
    assert.equal(r.destinos[0], 'CLIENTE');
    assert.equal(r.destinos[1], 'ESTABELECIMENTO');
  });

  it('1 via fiscal não força segunda via', () => {
    const r = Policy.resolver({ fiscal: { vias: 1, destinos: ['CLIENTE'] } }, 'FISCAL');
    assert.equal(r.vias, 1);
    assert.deepEqual(r.destinos, ['CLIENTE']);
  });

  it('fiscal e não fiscal podem divergir', () => {
    const cfg = {
      fiscal: { modo: 'PERGUNTAR', vias: 2 },
      nao_fiscal: { modo: 'AUTOMATICO', vias: 1, destinos: ['CLIENTE'] }
    };
    assert.equal(Policy.resolver(cfg, 'FISCAL').perguntar, true);
    assert.equal(Policy.resolver(cfg, 'NAO_FISCAL').automatico, true);
    assert.equal(Policy.resolver(cfg, 'NAO_FISCAL').vias, 1);
  });

  it('overlay de terminal não vaza para outro terminal', () => {
    const cfg = {
      fiscal: { vias: 2 },
      terminais: { '2': { vias: 1, destinos: ['CLIENTE'] } }
    };
    assert.equal(Policy.resolver(cfg, 'FISCAL', { terminal_id: 1 }).vias, 2);
    assert.equal(Policy.resolver(cfg, 'FISCAL', { terminal_id: 2 }).vias, 1);
  });

  it('overlay de empresa não altera outra empresa', () => {
    const cfg = {
      fiscal: { vias: 2 },
      empresas: { A: { vias: 1 } }
    };
    assert.equal(Policy.resolver(cfg, 'FISCAL', { empresa_id: 'B' }).vias, 2);
    assert.equal(Policy.resolver(cfg, 'FISCAL', { empresa_id: 'A' }).vias, 1);
  });
});

describe('CupomPrintPolicy — frontend e integração', () => {
  it('front replica defaults e envelopa via sem alterar o cupom original', () => {
    const Ui = loadFront();
    const html = '<pre>CUPOM</pre>';
    const via = Ui.enveloparVia(html, 'CLIENTE');
    assert.match(via, /VIA DO CLIENTE/);
    assert.match(via, /CUPOM/);
    assert.equal(html, '<pre>CUPOM</pre>');
    const doc = '<html><head></head><body><p>CUPOM</p></body></html>';
    const viaDoc = Ui.enveloparVia(doc, 'CLIENTE');
    assert.match(viaDoc, /<body[^>]*>\s*<div class="cds-ui-cupom-via"/);
    assert.match(viaDoc, /<\/head><body/);
    Ui.aplicarCache({ fiscal: { vias: 2 } });
    const d = Ui.resolver('FISCAL');
    assert.equal(d.perguntar, true);
    assert.equal(d.vias, 2);
  });

  it('fiscalImpressao apresenta o cupom antes de imprimir', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/fiscalImpressao.js'), 'utf8');
    assert.match(src, /apresentarCupomNaTela/);
    assert.match(src, /enviarImpressora: false/);
    assert.match(src, /autoFecharMs: 5000/);
    assert.match(src, /CupomPrintPolicy/);
    assert.match(src, /tipo: 'FISCAL'/);
    assert.match(src, /tipo: 'NAO_FISCAL'/);
    assert.match(src, /deveEnviarCupomParaImpressora/);
    assert.doesNotMatch(src, /Motor Fiscal|emitirNFCe/);
  });

  it('rotas e UI administrativa existem', () => {
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /\/cupom_impressao_politica/);
    assert.match(rotas, /\/cupom_impressao_evento/);
    const conf = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/configuracoes.js'), 'utf8');
    assert.match(conf, /Você deseja imprimir|Perguntar antes de imprimir/);
    assert.match(conf, /salvarPoliticaImpressaoCupom/);
    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgCupomPoliticaModo/);
    const db = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(db, /cupom_impressao_politica/);
    assert.match(db, /PERGUNTAR/);
  });

  it('não altera motores, TEF, fechamento V2 nem pagamento', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'backend/services/impressao/CupomPrintPolicy.js'), 'utf8');
    assert.doesNotMatch(policy, /SEFAZ|NFC-e|Payment Core|FechamentoCaixa/);
    const front = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/cupomPrintPolicy.js'), 'utf8');
    assert.match(front, /Imprimindo\.\.\./);
    assert.match(front, /Escape/);
    assert.match(front, /Enter/);
    assert.match(front, /Não foi possível imprimir o cupom/);
    assert.match(front, /Não há uma impressora configurada/);
    const css = fs.readFileSync(path.join(ROOT, 'frontend/shared/design-system/cds-ui-foundation.css'), 'utf8');
    assert.match(css, /cds-ui-cupom-print-overlay/);
    assert.match(css, /248px/);
    assert.doesNotMatch(css, /\.cds-ui-cupom-print-overlay \{[\s\S]{0,80}inset: 0/);
  });
});
