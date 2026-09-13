/**
 * Sprint 15.7 — DriverTemplateGenerator
 * Gera scaffold de novo driver (manifest, estrutura, testes, README, exemplo).
 */

'use strict';

const fs = require('fs');
const path = require('path');

function slugify(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toPascal(texto) {
  return String(texto || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/**
 * @param {Object} opcoes
 * @returns {{ ok: boolean, id: string, pasta: string, arquivos: string[], manifesto: Object }}
 */
function gerarDriver(opcoes = {}) {
  const fabricante = String(opcoes.fabricante || '').trim();
  const modelo = String(opcoes.modelo || '').trim();
  if (!fabricante || !modelo) {
    throw new Error('fabricante e modelo são obrigatórios');
  }

  const id = String(opcoes.id || `${slugify(fabricante)}-${slugify(modelo)}`);
  const categoria = String(opcoes.categoria || 'balanca').toLowerCase();
  const protocolo = String(opcoes.protocolo || `${slugify(fabricante)}-proto`);
  const transportes = Array.isArray(opcoes.transportes) && opcoes.transportes.length
    ? opcoes.transportes
    : ['ethernet'];
  const className = `${toPascal(fabricante)}${toPascal(modelo)}Driver`;
  const fabDir = slugify(fabricante);
  const rootDrivers = path.join(__dirname, '..', 'drivers', fabDir);
  const testsDir = path.join(__dirname, '..', '..', '..', '..', 'tests', 'equipamentos');

  if (!opcoes.forcar && fs.existsSync(path.join(rootDrivers, 'device.profile.js'))) {
    throw new Error(`Driver já existe em ${rootDrivers}`);
  }

  fs.mkdirSync(rootDrivers, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });

  const manifesto = {
    id,
    fabricante,
    modelo,
    categoria,
    protocolo,
    transportes,
    versao: '0.1.0',
    prioridade: Number(opcoes.prioridade) || 100,
    discovery: {
      ports: Array.isArray(opcoes.ports) ? opcoes.ports : [9000],
      timeout: 500
    },
    capabilities: {
      discovery: true,
      connection: true,
      identify: true,
      sync: false,
      telemetry: false,
      diagnostics: true,
      rollback: false,
      scheduler: false,
      update: false,
      backup: false
    },
    driverModule: `./${className}`,
    status: 'estrutura',
    motorMinimo: '15.7.0',
    nomeExibicao: `${fabricante} ${modelo}`
  };

  const arquivos = [];

  const profilePath = path.join(rootDrivers, 'device.profile.js');
  fs.writeFileSync(
    profilePath,
    `'use strict';\n\n/** Device Profile — ${fabricante} ${modelo} (SDK 15.7) */\n\nmodule.exports = ${JSON.stringify(manifesto, null, 2)};\n`,
    'utf8'
  );
  arquivos.push(profilePath);

  const driverPath = path.join(rootDrivers, `${className}.js`);
  fs.writeFileSync(
    driverPath,
    `'use strict';

const BaseDriver = require('../BaseDriver');

/**
 * ${className} — scaffold gerado pelo Device Profile SDK.
 * Implemente o protocolo específico sem alterar o núcleo do motor.
 */
class ${className} extends BaseDriver {
  fabricante() { return '${fabricante}'; }
  modelo() { return '${modelo}'; }
  versao() { return '0.1.0'; }
  transportesSuportados() { return ${JSON.stringify(transportes)}; }

  async conectar() { this._conectado = true; return { ok: true }; }
  async desconectar() { this._conectado = false; return { ok: true }; }
  async configurar(cfg = {}) { this.config = { ...this.config, ...cfg }; return { ok: true }; }
  async status() { return { conectado: Boolean(this._conectado) }; }
  async diagnostico() { return { ok: true, mensagens: ['scaffold'] }; }
  async descobrir() { return []; }
  async sincronizarProduto() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async sincronizarProdutos() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async sincronizarPromocao() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async sincronizarDepartamento() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async sincronizarEtiqueta() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async removerProduto() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async obterPeso() { return { peso: null }; }
  async zerar() { return { ok: false, motivo: 'NAO_IMPLEMENTADO' }; }
  async reiniciar() { return { ok: true }; }
  informacoes() {
    return {
      fabricante: this.fabricante(),
      modelo: this.modelo(),
      versao: this.versao(),
      protocolo: '${protocolo}'
    };
  }
}

module.exports = ${className};
`,
    'utf8'
  );
  arquivos.push(driverPath);

  const indexPath = path.join(rootDrivers, 'index.js');
  fs.writeFileSync(
    indexPath,
    `'use strict';\n\nmodule.exports = {\n  DRIVER: require('./${className}'),\n  profile: require('./device.profile.js')\n};\n`,
    'utf8'
  );
  arquivos.push(indexPath);

  const readmePath = path.join(rootDrivers, 'README.md');
  fs.writeFileSync(
    readmePath,
    `# ${fabricante} ${modelo}

Driver gerado pelo **Device Profile SDK** (Sprint 15.7).

## Manifesto

- **id:** \`${id}\`
- **categoria:** ${categoria}
- **protocolo:** ${protocolo}
- **transportes:** ${transportes.join(', ')}

## Checklist

- [ ] Implementar handshake / identificação
- [ ] Implementar sync (se aplicável)
- [ ] Homologar no Laboratório
- [ ] Registrar testes reais
- [ ] Atualizar capabilities no \`device.profile.js\`

## Fluxo

\`\`\`
Device Profile → DriverLoader → Registry → Discovery / Connection / Orchestrator
\`\`\`

## Exemplo

\`\`\`js
const sdk = require('../../sdk');
sdk.ensureLoaded();
const profile = sdk.registry.buscar('${id}');
console.log(profile.toJSON());
\`\`\`
`,
    'utf8'
  );
  arquivos.push(readmePath);

  const testPath = path.join(testsDir, `driver-${id}.scaffold.test.js`);
  fs.writeFileSync(
    testPath,
    `'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const profile = require(path.join(
  __dirname,
  '../../backend/motores/equipamentos/drivers/${fabDir}/device.profile.js'
));
const { validarManifest } = require('../../backend/motores/equipamentos/sdk/DriverValidator');

describe('Scaffold ${id}', () => {
  it('manifest válido', () => {
    const r = validarManifest(profile);
    assert.equal(r.valido, true);
    assert.equal(r.manifesto.id, '${id}');
  });
});
`,
    'utf8'
  );
  arquivos.push(testPath);

  // também espelha em sdk/profiles se pedido
  if (opcoes.registrarEmSdk !== false) {
    const sdkProfile = path.join(__dirname, 'profiles', `${id}.js`);
    fs.writeFileSync(
      sdkProfile,
      `'use strict';\n\nmodule.exports = ${JSON.stringify({ ...manifesto, driverModule: `${fabDir}/${className}` }, null, 2)};\n`,
      'utf8'
    );
    arquivos.push(sdkProfile);
  }

  return {
    ok: true,
    id,
    pasta: rootDrivers,
    className,
    arquivos,
    manifesto
  };
}

module.exports = {
  slugify,
  toPascal,
  gerarDriver
};
