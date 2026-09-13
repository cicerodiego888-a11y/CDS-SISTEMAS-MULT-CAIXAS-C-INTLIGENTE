/**
 * RC8.2.2 — Fechamento final MPFC V1 (gaps RC8.2.1).
 * Sem alteração de regras de negócio / cálculos / XML / MIDP alocação.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mpfc = require('../../backend/services/mpfc');
const midpSrc = fs.readFileSync(
  path.join(__dirname, '../../backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'),
  'utf8'
);
const orqSrc = fs.readFileSync(
  path.join(__dirname, '../../backend/services/OrquestradorPagamento.js'),
  'utf8'
);
const nucleoDoc = fs.readFileSync(
  path.join(__dirname, '../../docs/arquitetura/NUCLEO_TRANSACIONAL_VENDA_V1.md'),
  'utf8'
);
const archDoc = fs.readFileSync(
  path.join(__dirname, '../../docs/arquitetura/ARQUITETURA_OFICIAL_CDS_V1.md'),
  'utf8'
);
const contratoSrc = fs.readFileSync(
  path.join(__dirname, '../../backend/services/mpfc/PoliticaFiscalComercialV1.js'),
  'utf8'
);

function capturarLogs(fn) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return logs;
}

describe('RC8.2.2 — Snapshot obrigatório pós-venda', () => {
  it('resolverPoliticaOperacionalDaVenda usa snapshot e nunca config atual', () => {
    const politicaVenda = mpfc.criarPoliticaFiscalComercialV1({
      modo: 'FLEXIVEL',
      percentualDinheiroFiscal: 10,
      preservarDinheiro: false
    });
    const snapshotJson = mpfc.snapshotParaJson(politicaVenda);
    const venda = { id: 42, mpfc_politica_snapshot: snapshotJson };

    const logs = capturarLogs(() => {
      const r = mpfc.resolverPoliticaOperacionalDaVenda(venda, 'cancelamento');
      assert.equal(r.snapshotPresente, true);
      assert.equal(r.fonte, 'mpfc_politica_snapshot');
      assert.equal(r.politica.modo, 'FLEXIVEL');
      assert.equal(r.politica.percentualDinheiroFiscal, 10);
    });
    assert.ok(logs.some((l) => l.includes('MPFC_SNAPSHOT_UTILIZADO')));
    assert.ok(logs.some((l) => l.includes('"contexto":"cancelamento"')));
  });

  it('cancelamento / estorno / reprocessamento: mesmos contextos oficiais', () => {
    const snap = mpfc.snapshotParaJson(
      mpfc.criarPoliticaFiscalComercialV1({ modo: 'FIXA', preservarDinheiro: true })
    );
    const venda = { id: 7, mpfc_politica_snapshot: snap };
    for (const ctx of ['cancelamento', 'estorno', 'reprocessamento']) {
      const r = mpfc.resolverPoliticaOperacionalDaVenda(venda, ctx);
      assert.equal(r.politica.preservarDinheiro, true);
      assert.equal(r.fonte, 'mpfc_politica_snapshot');
    }
  });

  it('legado sem snapshot: defaults V1 (sem ler configuracaoService)', () => {
    const r = mpfc.resolverPoliticaOperacionalDaVenda({ id: 1 }, 'cancelamento');
    assert.equal(r.snapshotPresente, false);
    assert.equal(r.fonte, 'defaults_v1_legado');
    assert.equal(r.politica.modo, 'FIXA');
    assert.equal(r.politica.preservarDinheiro, false);
  });

  it('alterar config atual não altera política resolvida do snapshot', () => {
    const snap = mpfc.snapshotParaJson(
      mpfc.criarPoliticaFiscalComercialV1({
        modo: 'FIXA',
        preservarDinheiro: true,
        margemMinimaSobreOCusto: 25
      })
    );
    const atual = mpfc.obterPolitica({
      emitirLog: false,
      config: { ativar_midp: false, mpfc_modo: 'FLEXIVEL', mpfc_percentual_dinheiro_fiscal: 99 }
    });
    assert.equal(atual.modo, 'FLEXIVEL');

    const r = mpfc.resolverPoliticaOperacionalDaVenda(
      { id: 9, mpfc_politica_snapshot: snap },
      'estorno'
    );
    assert.equal(r.politica.modo, 'FIXA');
    assert.equal(r.politica.preservarDinheiro, true);
    assert.equal(r.politica.margemMinimaSobreOCusto, 25);
  });
});

describe('RC8.2.2 — Logs oficiais', () => {
  it('emite POLITICA_CARREGADA + MODO_FIXA', () => {
    const logs = capturarLogs(() => {
      mpfc.obterPolitica({ emitirLog: true, config: { ativar_midp: false, mpfc_modo: 'FIXA' } });
    });
    assert.ok(logs.some((l) => l.includes('MPFC_POLITICA_CARREGADA')));
    assert.ok(logs.some((l) => l.includes('MPFC_MODO_FIXA')));
  });

  it('emite POLITICA_CARREGADA + MODO_FLEXIVEL', () => {
    const logs = capturarLogs(() => {
      mpfc.obterPolitica({
        emitirLog: true,
        config: { mpfc_modo: 'FLEXIVEL', mpfc_percentual_dinheiro_fiscal: 10 }
      });
    });
    assert.ok(logs.some((l) => l.includes('MPFC_MODO_FLEXIVEL')));
  });

  it('emite SNAPSHOT_GRAVADO', () => {
    const p = mpfc.obterPolitica({ emitirLog: false, config: {} });
    const logs = capturarLogs(() => {
      mpfc.registrarSnapshotGravado(p, { vendaId: 100, fonte: 'criar_venda' });
    });
    assert.ok(logs.some((l) => l.includes('MPFC_SNAPSHOT_GRAVADO')));
  });

  it('emite VALIDACAO_MARGEM', () => {
    const p = mpfc.criarPoliticaFiscalComercialV1({
      nuncaVenderAbaixoDaMargem: false,
      margemMinimaSobreOCusto: 20
    });
    const logs = capturarLogs(() => {
      mpfc.validarMargemMinimaComercial([], {}, p);
    });
    assert.ok(logs.some((l) => l.includes('MPFC_VALIDACAO_MARGEM')));
  });
});

describe('RC8.2.2 — Fallback operacional eliminado', () => {
  it('MIDP não chama isMidpAtivado', () => {
    assert.equal(midpSrc.includes('isMidpAtivado'), false);
    assert.equal(midpSrc.includes('configuracaoService'), false);
  });

  it('Orquestrador não chama isMidpAtivado', () => {
    assert.equal(/configService\.isMidpAtivado|require\(['\"]\.\/configuracaoService['\"]\)/.test(orqSrc), false);
    assert.ok(orqSrc.includes('RC8.2.2'));
    assert.ok(orqSrc.includes('midpAtivo'));
  });

  it('versão motor 8.2.2', () => {
    assert.equal(mpfc.VERSAO_MOTOR, '8.2.2');
  });
});

describe('RC8.2.2 — Documentação contrato congelado', () => {
  it('PoliticaFiscalComercialV1 declara CONGELADO', () => {
    assert.ok(contratoSrc.includes('CONTRATO CONGELADO') || contratoSrc.includes('CONGELADO'));
    assert.ok(contratoSrc.includes('PoliticaFiscalComercialV2'));
  });

  it('Núcleo e Arquitetura oficial atualizados', () => {
    assert.ok(nucleoDoc.includes('PoliticaFiscalComercialV1'));
    assert.ok(nucleoDoc.includes('CONGELADO'));
    assert.ok(nucleoDoc.includes('MPFC'));
    assert.ok(archDoc.includes('MPFC'));
    assert.ok(archDoc.includes('PoliticaFiscalComercialV1'));
  });
});
