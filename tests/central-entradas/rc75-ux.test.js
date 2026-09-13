/**
 * RC7.5 — UX Central de Entradas (somente apresentação).
 */

const assert = require('assert');
const path = require('path');

// Carrega o módulo UX em contexto Node (exporta via module.exports).
const UX = require(path.join(
  __dirname,
  '../../frontend/erp/js/central-entradas-ux.js'
));

function casoDatas() {
  const comEmissao = UX.resolverDataDocumentoCentral({
    dataEmissao: '2026-07-18T10:00:00.000Z',
    dhRecbto: '2026-07-19T10:00:00.000Z',
    createdAt: '2026-07-20T10:00:00.000Z'
  });
  assert.strictEqual(comEmissao.fonte, 'dataEmissao');

  const comDh = UX.resolverDataDocumentoCentral({
    dhRecbto: '2026-07-19T10:00:00.000Z',
    createdAt: '2026-07-20T10:00:00.000Z'
  });
  assert.strictEqual(comDh.fonte, 'dhRecbto');

  const sem = UX.resolverDataDocumentoCentral({ createdAt: '2026-07-20T10:00:00.000Z' });
  assert.strictEqual(sem.fonte, null);
  assert.strictEqual(sem.data, '—');
}

function casoCountdownETempo() {
  const agora = new Date('2026-07-19T12:00:00.000Z').getTime();
  const alvo = '2026-07-19T12:08:14.000Z';
  const cd = UX.formatarCountdownCentral(alvo, agora);
  assert.ok(cd.faltam.includes('08m') || cd.faltam.includes('8m') || /08m 14s/.test(cd.faltam));
  assert.strictEqual(cd.esgotado, false);

  const dur = UX.formatarDuracaoHumanaCentral(32 * 60 * 1000);
  assert.strictEqual(dur, '32 minutos');
  assert.strictEqual(UX.formatarDuracaoHumanaCentral(60 * 60 * 1000), '1 hora');
  assert.strictEqual(UX.formatarDuracaoHumanaCentral(24 * 60 * 60 * 1000), '1 dia');
}

function casoMensagens() {
  assert.match(UX.mensagemAmigavelCentral('AGUARDANDO_XML_COMPLETO'), /XML completo|disponibilizou|MIRX/i);
  assert.match(UX.mensagemAmigavelCentral('ERRO'), /indisponível/);
  assert.match(UX.mensagemAmigavelCentral('CONSUMO_INDEVIDO'), /intervalo/);
  assert.match(UX.mensagemAmigavelCentral('MANIFESTACAO_ACEITA'), /consultando automaticamente/);
}

function casoChipsEstados() {
  const chipXml = UX.resolverChipEtapaCentral({ status: 'AGUARDANDO_XML_COMPLETO' }, {});
  assert.strictEqual(chipXml.codigo, 'AGUARDANDO_XML');
  assert.ok(chipXml.indicador);

  const chipErro = UX.resolverChipEtapaCentral({ status: 'ERRO' }, {});
  assert.strictEqual(chipErro.codigo, 'ERRO');

  const html = UX.renderChipEtapaCentral(chipXml);
  assert.ok(html.includes('central-rc75-chip'));
}

function casoTimelineEProgresso() {
  const doc = {
    id: 1,
    status: 'AGUARDANDO_XML_COMPLETO',
    tipoDocumento: 'RES_NFE',
    createdAt: '2026-07-19T12:00:00.000Z'
  };
  const historico = [
    { statusNovo: 'SINCRONIZADA', createdAt: '2026-07-19T12:00:00.000Z', detalhe: 'RES_NFE' },
    { statusNovo: 'AGUARDANDO_XML_COMPLETO', createdAt: '2026-07-19T12:02:00.000Z', detalhe: 'MANIFESTACAO_ACEITA' }
  ];
  const modelo = UX.montarEtapasOperacionaisCentral(doc, historico, {
    tentativas: 2,
    iniciadoEm: '2026-07-19T12:00:00.000Z',
    proximaTentativa: '2026-07-19T12:10:00.000Z',
    ultimaConsulta: '2026-07-19T12:05:00.000Z'
  });
  assert.strictEqual(modelo.total, 14);
  assert.ok(modelo.etapas[0].concluida);
  assert.ok(modelo.percentual >= 0 && modelo.percentual <= 100);
  assert.ok(modelo.etapas.some((e) => e.ativa && (e.id === 'xml_sefaz' || e.id === 'xml_solicitado')));

  const barra = UX.renderBarraProgressoOperacionalCentral(modelo);
  assert.ok(barra.includes('central-rc75-progress'));
  assert.ok(barra.includes('%'));
  assert.ok(barra.includes('is-on'));

  const tl = UX.renderTimelineOperacionalCentral(modelo);
  assert.ok(tl.includes('central-rc75-timeline'));
  assert.ok(tl.includes('Documento localizado') || tl.includes('RES_NFE'));
}

function casoCardXmlECountdownLive() {
  const doc = { id: 9, status: 'AGUARDANDO_XML_COMPLETO' };
  const wait = {
    tentativas: 2,
    iniciadoEm: '2026-07-19T12:00:00.000Z',
    ultimaConsulta: '2026-07-19T12:05:00.000Z',
    proximaTentativa: '2026-07-19T12:15:00.000Z',
    tempoAguardandoMs: 18 * 60 * 1000
  };
  const html = UX.renderCardXmlWaitOperacionalCentral(doc, wait, {
    agora: new Date('2026-07-19T12:10:00.000Z').getTime(),
    ultimoCStat: '137',
    backoffLabel: '10 minutos'
  });
  assert.ok(html.includes('XML Completo'));
  assert.ok(html.includes('data-central-live="countdown"'));
  assert.ok(html.includes('Próxima tentativa') || html.includes('Dormindo') || html.includes('Backoff'));
  assert.ok(html.includes('137'));
}

function casoLoadingESaude() {
  const load = UX.renderLoadingEtapasCentral('recebendo');
  assert.ok(load.includes('Recebendo documentos'));
  assert.ok(load.includes('is-active'));

  const saude = UX.renderPainelSaudeSefazCentral({
    estadoOperacional: { codigo: 'NORMAL', indicador: '🟢', label: 'Normal' },
    consultasSOAP: 38,
    consultasEvitadas: 21,
    ultimaConsulta: '2026-07-19T23:28:00.000Z'
  }, { servicoAtivo: true, xmlWait: { ativo: true } });
  assert.ok(saude.includes('SEFAZ OPERACIONAL'));
  assert.ok(saude.includes('ATIVO'));
  assert.ok(saude.includes('38'));
}

function casoLiveRegionsParcial() {
  // Simula DOM mínimo
  const { JSDOM } = (() => {
    try { return require('jsdom'); } catch { return {}; }
  })();

  if (!JSDOM) {
    // Sem jsdom: valida API de atualização com stub
    const root = {
      querySelectorAll(sel) {
        if (sel.includes('countdown')) {
          return [{
            getAttribute: (a) => (a === 'data-central-target' ? '2026-07-19T12:10:00.000Z' : null),
            textContent: 'xx'
          }];
        }
        return [];
      }
    };
    const n = UX.atualizarLiveRegionsCentral(root, new Date('2026-07-19T12:00:00.000Z').getTime());
    assert.ok(n >= 1);
    return;
  }

  const dom = new JSDOM(`<div id="r">
    <span data-central-live="countdown" data-central-target="2026-07-19T12:10:00.000Z">--</span>
    <span data-central-live="tempo-aguardando" data-central-inicio="2026-07-19T11:00:00.000Z">--</span>
  </div>`);
  const n = UX.atualizarLiveRegionsCentral(
    dom.window.document.getElementById('r'),
    new Date('2026-07-19T12:00:00.000Z').getTime()
  );
  assert.ok(n >= 1);
}

function casoTechRecolhivel() {
  const html = UX.renderInfoTecnicasRecolhivelCentral({
    doc: { id: 1, nsu: '11', chave: '123' },
    wait: { correlationId: 'abc' },
    sefaz: { ultimoCStat: '137', consultasSOAP: 2 },
    statusBg: { servicoAtivo: true, xmlWait: { ativo: true } }
  });
  assert.ok(html.includes('<details'));
  assert.ok(html.includes('Informações Técnicas'));
  assert.ok(html.includes('CorrelationId'));
}

(function main() {
  casoDatas();
  casoCountdownETempo();
  casoMensagens();
  casoChipsEstados();
  casoTimelineEProgresso();
  casoCardXmlECountdownLive();
  casoLoadingESaude();
  casoLiveRegionsParcial();
  casoTechRecolhivel();
  console.log('RC7.5 UX Central OK');
})();
