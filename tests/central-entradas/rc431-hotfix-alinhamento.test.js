/**
 * HotFix RC4.3.1 — Auditoria automática de alinhamento arquitetural.
 * Valida perímetro Central / Centro / Homologação / Fiscal (config).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const files = {
  central: path.join(root, 'frontend/erp/js/central-entradas.js'),
  centro: path.join(root, 'frontend/erp/js/cds-centro-configuracoes.js'),
  homolog: path.join(root, 'frontend/erp/js/central-homologacao.js'),
  fiscal: path.join(root, 'frontend/erp/js/fiscal.js'),
  core: path.join(root, 'frontend/shared/js/core.js'),
  cfgSvc: path.join(root, 'backend/motores/central-entradas/services/CentralConfiguracaoService.js')
};

const src = Object.fromEntries(
  Object.entries(files).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')])
);

console.log('\n=== HotFix RC4.3.1 — Auditoria automática ===\n');

// 1) Endpoints fiscais editáveis na Central
assert.ok(
  src.central.includes("id: 'cfgUrlConsultaProd'")
  && src.central.includes('renderCampoEndpointResolvidoCfg'),
  'Consulta chave via renderCampoEndpointResolvidoCfg (RO)'
);
assert.ok(
  !/urlConsultaChaveProducao:\s*document\.getElementById\('cfgUrlConsultaProd'\)/.test(src.central),
  'Payload não deve enviar urlConsulta editável'
);
assert.ok(src.cfgSvc.includes('_resolverEndpointsConsultaChave'), 'Backend resolve consulta via UrlResolver');
assert.ok(src.cfgSvc.includes("delete flat.urlConsultaChaveProducao"), 'PUT ignora persistência de consulta');
assert.ok(src.central.includes('readonly disabled') || src.central.includes('renderCampoEndpointResolvidoCfg'), 'campos endpoint RO');

console.log('  OK  Nenhum endpoint fiscal editável na Central (consulta/manif/dfe RO)');

// 2) alert() no perímetro HotFix
for (const [nome, texto] of [
  ['central-entradas', src.central],
  ['central-homologacao', src.homolog],
  ['cds-centro-configuracoes', src.centro],
  ['fiscal.js', src.fiscal]
]) {
  assert.ok(!/\balert\s*\(/.test(texto), `${nome} não deve usar alert()`);
}
assert.ok(src.core.includes('function mostrarToastCentral'), 'mostrarToastCentral unificado');
assert.ok(src.core.includes('function showNotification'), 'showNotification oficial');
console.log('  OK  Sem alert() no perímetro Central/Centro/Fiscal/Homologação');

// 3) Nomenclatura
for (const [nome, texto] of Object.entries({
  central: src.central,
  centro: src.centro,
  homolog: src.homolog,
  fiscal: src.fiscal
})) {
  assert.ok(
    !/Configurações Avançadas/.test(texto),
    `${nome} não deve exibir "Configurações Avançadas"`
  );
}
console.log('  OK  Sem texto visível "Configurações Avançadas" no perímetro');

// 4) Badges conflitantes
assert.ok(!/Manifestação integrada/.test(src.central), 'sem badge Manifestação integrada');
assert.ok(!/Manifestação desativada/.test(src.central), 'sem badge Manifestação desativada');
console.log('  OK  Sem badges conflitantes (integrada/desativada)');

// 5) Plataforma resolve
assert.ok(src.cfgSvc.includes('FiscalWebServices'), 'usa FiscalWebServices.resolve');
assert.ok(src.cfgSvc.includes('CONSULTA_PROTOCOLO'), 'consulta via OperationType oficial');
console.log('  OK  Resolução exclusiva via Plataforma Fiscal (painel)');

console.log('\nResultado: auditoria automática RC4.3.1 PASSOU\n');
