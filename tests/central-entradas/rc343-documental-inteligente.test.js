/**
 * RC3.4.3 — Central Documental Inteligente
 * Executar: node tests/central-entradas/rc343-documental-inteligente.test.js
 */

const assert = require('assert');
const path = require('path');
const Doc = require('../../backend/motores/central-entradas/utils/centralDocumentalInteligente');
const UX = require(path.join(__dirname, '../../frontend/erp/js/central-entradas-ux.js'));

function testStatusReais() {
  assert.strictEqual(
    Doc.resolverStatusReal({ status: 'AGUARDANDO_XML_COMPLETO' }, {}),
    'Recuperação automática do XML agendada'
  );
  assert.strictEqual(
    Doc.resolverStatusReal({ status: 'AGUARDANDO_XML_COMPLETO' }, { dormindo: true }),
    'Recuperação automática do XML agendada'
  );
  assert.strictEqual(
    Doc.resolverStatusReal({ status: 'AGUARDANDO_XML_COMPLETO' }, { estadoMirx: 'CONSULTANDO_XML' }),
    'Recuperando XML automaticamente'
  );
  assert.strictEqual(
    Doc.resolverStatusReal({ status: 'AGUARDANDO_REVISAO' }, {}),
    'Aguardando revisão MIIP'
  );
  assert.strictEqual(Doc.resolverStatusReal({ status: 'GRAVADA' }, {}), 'Finalizado');
  assert.strictEqual(
    Doc.resolverStatusReal({ status: 'SINCRONIZADA', tipoDocumento: 'RES_NFE' }, {}),
    'Aguardando manifestação'
  );
}

function testExplicacao() {
  const txt = Doc.explicarStatus(
    { status: 'AGUARDANDO_XML_COMPLETO' },
    { proximaTentativa: '2026-07-27T17:35:00.000Z' },
    { proximaLabel: '14:35' }
  );
  assert.match(txt, /14:35/);
  assert.match(txt, /Recuperação automática do XML agendada/);
  assert.doesNotMatch(txt, /Aguardando disponibilidade da SEFAZ/);
}

function testEventosMirx() {
  const mapped = Doc.mapearEventosMirx([
    {
      id: 1,
      createdAt: '2026-07-27T12:00:00.000Z',
      detalhe: { mirx: true, tipoMirx: 'MIRX_SLEEP_START', motivo: '656' }
    },
    {
      id: 2,
      createdAt: '2026-07-27T13:00:00.000Z',
      detalhe: { mirx: true, tipoMirx: 'MIRX_WAKEUP' }
    },
    {
      id: 3,
      createdAt: '2026-07-27T13:05:00.000Z',
      detalhe: { mirx: true, tipoMirx: 'MIRX_XML_RECUPERADO' }
    },
    { id: 4, detalhe: { foo: 1 } }
  ]);
  assert.strictEqual(mapped.length, 3);
  assert.strictEqual(mapped[0].label, 'Dormiu');
  assert.strictEqual(mapped[1].label, 'Acordou');
  assert.strictEqual(mapped[2].label, 'XML encontrado');
}

function testAuditoriaEProgresso() {
  const audit = Doc.montarAuditoriaDocumental({
    doc: {
      status: 'AGUARDANDO_XML_COMPLETO',
      tipoDocumento: 'RES_NFE',
      createdAt: '2026-07-27T10:00:00.000Z'
    },
    wait: {
      tentativas: 3,
      ultimoMetodo: 'DistDFe',
      ultimoCStat: '137',
      dormindo: false,
      iniciadoEm: '2026-07-27T10:00:00.000Z'
    },
    historico: [],
    eventosMirx: [],
    agora: new Date('2026-07-27T12:00:00.000Z').getTime()
  });
  assert.strictEqual(audit.quantidadeTentativas, 3);
  assert.strictEqual(audit.ultimoMetodo, 'DistDFe');
  assert.match(audit.ultimoRetornoSefaz, /137/);
  assert.ok(audit.tempoTotalLabel);

  const prog = Doc.calcularProgressoPercentual({ total: 14, concluidas: 7 });
  assert.strictEqual(prog.percentual, 50);
  assert.strictEqual(prog.preenchidos, 5);
}

function testUxTimelineCompleta() {
  const doc = {
    id: 10,
    status: 'AGUARDANDO_XML_COMPLETO',
    tipoDocumento: 'RES_NFE',
    createdAt: '2026-07-27T10:00:00.000Z'
  };
  const modelo = UX.montarEtapasOperacionaisCentral(doc, [
    { statusNovo: 'SINCRONIZADA', createdAt: '2026-07-27T10:00:00.000Z', detalhe: 'RES_NFE' },
    { statusNovo: 'AGUARDANDO_XML_COMPLETO', createdAt: '2026-07-27T10:05:00.000Z', detalhe: 'MANIFESTACAO_ACEITA' }
  ], {
    tentativas: 2,
    proximaTentativa: '2026-07-27T14:35:00.000Z',
    iniciadoEm: '2026-07-27T10:05:00.000Z'
  }, [
    { tipoMirx: 'MIRX_ENFILEIRADO', label: 'XML solicitado automaticamente', createdAt: '2026-07-27T10:06:00.000Z' }
  ]);

  assert.strictEqual(modelo.total, 14);
  assert.ok(modelo.etapas.some((e) => e.label.includes('Documento localizado')));
  assert.ok(modelo.etapas.some((e) => e.label.includes('XML solicitado')));
  assert.ok(modelo.explicacao);
  assert.ok(String(modelo.statusReal).length > 3);

  const barra = UX.renderBarraProgressoOperacionalCentral(modelo);
  assert.ok(barra.includes(`${modelo.percentual}%`));

  const expl = UX.renderExplicacaoStatusCentral(doc, {
    proximaTentativa: '2026-07-27T14:35:00.000Z'
  });
  assert.ok(expl.includes('central-rc343-explica'));

  const mirx = UX.renderEventosMirxCentral([
    { label: 'Dormiu', icone: 'fa-moon', cor: '#64748b', createdAt: '2026-07-27T11:00:00.000Z', motivo: '656' },
    { label: 'Acordou', icone: 'fa-sun', cor: '#0d6efd', createdAt: '2026-07-27T12:00:00.000Z' }
  ]);
  assert.ok(mirx.includes('Dormiu'));
  assert.ok(mirx.includes('Acordou'));

  const audit = UX.renderAuditoriaDocumentalCentral({
    tempoTotalLabel: '2h 0min',
    quantidadeTentativas: 2,
    ultimoMetodo: 'DistDFe',
    ultimoRetornoSefaz: 'cStat 137',
    tempoAteXmlLabel: '—',
    dormindo: false
  });
  assert.ok(audit.includes('Auditoria'));
  assert.ok(audit.includes('DistDFe'));
}

function main() {
  console.log('\n=== RC3.4.3 — Central Documental Inteligente ===\n');
  testStatusReais();
  console.log('✓ Status reais');
  testExplicacao();
  console.log('✓ Explicação do status');
  testEventosMirx();
  console.log('✓ Eventos MIRX (Dormiu/Acordou/XML encontrado)');
  testAuditoriaEProgresso();
  console.log('✓ Auditoria + progresso %');
  testUxTimelineCompleta();
  console.log('✓ Timeline 14 etapas + barra + MIRX + auditoria UI');
  console.log('\nRC3.4.3 Documental Inteligente OK\n');
}

main();
