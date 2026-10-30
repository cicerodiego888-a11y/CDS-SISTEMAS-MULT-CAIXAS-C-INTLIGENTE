'use strict';

/**
 * TEF-AUDITORIA-09 — catálogo PPC930 + indicadores sem falso "pronto".
 * Sem INIT_CLIENT, sem gate financeiro, sem escrita no banco oficial.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');

const pinpadCatalog = require('../../backend/services/tef/pinpads/pinpadCatalog');
const {
  avaliarEvidenciasDestaxa,
  ESTADOS_INDICADOR
} = require('../../backend/services/tef/destaxa/destaxaEvidenciasOperacionais');

const UI_PATH = path.join(__dirname, '../../frontend/erp/js/configuracao_tef.js');
const HTML_ERP = path.join(__dirname, '../../frontend/erp/pages/ConfiguracaoTEF.html');
const HTML_ROOT = path.join(__dirname, '../../frontend/pages/ConfiguracaoTEF.html');

describe('TEF-AUDITORIA-09 indicadores e catálogo PPC930', () => {
  it('nomeExibicao PPC930 descreve conexão física, não Rede/Itaú como provedor', () => {
    const ppc = pinpadCatalog.MODELOS.GERTEC_PPC930;
    assert.strictEqual(ppc.codigo, 'GERTEC_PPC930');
    assert.strictEqual(ppc.nomeExibicao, 'Gertec PPC930 (USB CDC → COM virtual)');
    assert.ok(!/Rede\/Itaú/.test(ppc.nomeExibicao));
    assert.ok(/USB CDC/.test(ppc.nomeExibicao));
    assert.ok(ppc.observacaoAdquirente);
    assert.ok(/provedor TEF efetivo/i.test(ppc.observacaoAdquirente));
    assert.ok(pinpadCatalog.resolverPorCodigo('Gertec PPC930 (Rede/Itaú)'), 'alias legado deve resolver');
  });

  it('UI fallback e HTML não associam PPC930 a CliSiTef/PayGo nem forçam badges true', () => {
    const ui = fs.readFileSync(UI_PATH, 'utf8');
    assert.ok(ui.includes('Gertec PPC930 (USB CDC → COM virtual)'));
    assert.ok(!ui.includes("atualizarStatus('diagReimpressao', true)"));
    assert.ok(!ui.includes("atualizarStatus('diagVenda', true)"));
    assert.ok(ui.includes('atualizarStatusEvidencia'));
    assert.ok(ui.includes('renderizarPainelDestaxaDiagnostico'));
    assert.ok(ui.includes('Parâmetros cadastrados'));
    assert.ok(!ui.includes("? 'Configurado' : 'Não configurado'"));

    for (const htmlPath of [HTML_ERP, HTML_ROOT]) {
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.ok(!/CliSiTef\/PayGo/.test(html), htmlPath);
      assert.ok(/USB CDC → COM virtual/.test(html), htmlPath);
    }
  });

  it('evidencias Destaxa bloqueiam venda e listam mapeamento pendente sem inventar códigos', () => {
    const evid = avaliarEvidenciasDestaxa({
      config: {
        empresaCodigo: '',
        lojaCodigo: '',
        terminalCodigo: ''
      },
      estadosIntegracao: {
        dll: { loaded: true, exportsValidated: true },
        vspague: { detected: true, running: true },
        pinpad: { configuredPort: 'COM3', detectedPort: 'COM3', comConsistent: true },
        client: {
          initialized: false,
          initClientExecuted: 'NAO_EXECUTADO',
          codeStatus: 'NAO_EXECUTADO',
          code: null
        },
        transactionCommunication: { validated: false },
        authorization: { available: false }
      }
    });

    assert.strictEqual(evid.tefProntoParaVenda, false);
    assert.strictEqual(evid.initClientNaoReexecutado, true);
    assert.strictEqual(evid.indicadores.inicializacaoClient.historicoComprovado.codigoDestaxa, '00');
    assert.strictEqual(evid.capacidadesGenericas.vendaDestaxa.estado, ESTADOS_INDICADOR.BLOQUEADO);
    assert.strictEqual(evid.capacidadesGenericas.cancelamentoDestaxa.estado, ESTADOS_INDICADOR.INDISPONIVEL);
    assert.strictEqual(evid.capacidadesGenericas.reimpressaoTef.estado, ESTADOS_INDICADOR.NAO_VALIDADO);
    assert.ok(evid.bloqueios.some((b) => b.codigo === 'MAPEAMENTO_OFICIAL_PENDENTE'));
    assert.ok(evid.bloqueios.some((b) => b.codigo === 'DESTAXA_REAL_TRANSACTION_DISABLED'));
  });

  it('mensagem testarConexao não declara pronto para teste', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/tefConfigService.js'),
      'utf8'
    );
    assert.ok(!src.includes('PinPad configurado e pronto para teste'));
    assert.ok(src.includes('parâmetros cadastrados'));
  });
});
