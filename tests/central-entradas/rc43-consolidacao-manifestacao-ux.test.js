/**
 * RC4.3 — Consolidação UX Manifestação (fonte única preservada).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const centralJs = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
  'utf8'
);
const centroJs = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/cds-centro-configuracoes.js'),
  'utf8'
);

assert.ok(
  !centralJs.includes('id="cfgPoliticaManifestacao"'),
  'Central não deve mais editar politicaManifestacao'
);
assert.ok(
  centralJs.includes('btnCentralAbrirConfigManifestacao'),
  'Central deve ter deep-link para Config Fiscal / Manifestação'
);
assert.ok(
  centralJs.includes('centralCfgTestarResolucao'),
  'Central deve ter Testar Resolução'
);
assert.ok(
  centralJs.includes('centralCfgCopiarUrlManif'),
  'Central deve ter Copiar URL'
);
assert.ok(
  !/politicaManifestacao:\s*document\.getElementById\('cfgPoliticaManifestacao'\)/.test(centralJs),
  'Payload da Central não deve enviar politica do select removido'
);

assert.ok(centroJs.includes('cdsCfgCardManifestacao'), 'Card Manifestação no Centro');
assert.ok(centroJs.includes('cdsPoliticaManifestacao'), 'Radios de política no Centro');
assert.ok(centroJs.includes('btnSalvarPoliticaManifestacao'), 'Botão salvar política');
assert.ok(
  centroJs.includes("central-entradas/configuracao"),
  'Centro usa API oficial PUT/GET configuracao'
);
assert.ok(centroJs.includes('__CDS_CFG_FORCE_ANCHOR'), 'Deep-link anchor suportado');

console.log('RC4.3 UX consolidação: OK');
