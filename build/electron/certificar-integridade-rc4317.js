'use strict';

/**
 * RC4.31.7 — Certificação Final do Empacotamento Electron (App Integrity)
 * Uso:
 *   node build/electron/certificar-integridade-rc4317.js           # auditoria
 *   node build/electron/certificar-integridade-rc4317.js --rebuild # rebuild + certificação
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  gerarManifesto,
  escreverManifesto,
  certificarIntegridadeErp,
  escreverManifestoBuild,
  hashAsarCompleto,
  BUILD_MANIFEST_REL
} = require('../../electron-integrity');

const root = path.join(__dirname, '..', '..');
const TAG = '[RC4.31.7]';
const RELATORIO_PATH = path.join(root, 'docs', 'build', 'RC4317_RELATORIO_INTEGRIDADE.md');

function fail(msg) {
  console.error(TAG, 'ERRO —', msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  console.log(TAG, cmd, args.join(' '));
  const result = spawnSync(cmd, args, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, ...(opts.env || {}) }
  });
  if (result.status !== 0) fail(`comando falhou: ${cmd} (exit ${result.status})`);
}

function salvarRelatorio(conteudo) {
  fs.mkdirSync(path.dirname(RELATORIO_PATH), { recursive: true });
  fs.writeFileSync(RELATORIO_PATH, conteudo, 'utf8');
  console.log(TAG, 'relatório:', path.relative(root, RELATORIO_PATH));
}

function auditarPreBuild() {
  console.log(TAG, '=== ETAPA 1 — Auditoria app.asar ===');
  const cert = certificarIntegridadeErp(root);

  if (cert.asarPath) {
    console.log(TAG, 'asar:', cert.asarPath);
    try {
      console.log(TAG, 'hash app.asar:', hashAsarCompleto(cert.asarPath));
    } catch (_) {
      /* ignore */
    }
  } else {
    console.log(TAG, 'asar: não encontrado');
  }

  console.log('\n' + cert.relatorio);

  if (cert.cmp.divergencias?.length) {
    console.log(TAG, 'Divergências detectadas:');
    cert.cmp.divergencias.forEach((d) => {
      console.log(`  - ${d.arquivo}`);
      console.log(`    esperado: ${d.esperado}`);
      console.log(`    obtido:   ${d.obtido}`);
      console.log(`    motivo:   ${d.motivo || 'hash divergente — rebuild necessário (RC4.31.5/6 não empacotados)'}`);
    });
  }

  return cert;
}

function main() {
  const args = process.argv.slice(2);
  const rebuild = args.includes('--rebuild');
  const auditOnly = args.includes('--audit-only') || !rebuild;

  console.log(TAG, '=== Certificação App Integrity RC4.31.7 ===');

  const pre = auditarPreBuild();
  salvarRelatorio([
    '# RC4.31.7 — Relatório de Integridade Electron',
    '',
    `Data: ${new Date().toISOString()}`,
    '',
    pre.relatorio,
    '',
    pre.smoke.erros?.length ? `## Smoke test\n${pre.smoke.erros.map((e) => `- ${e}`).join('\n')}` : ''
  ].join('\n'));

  if (auditOnly && !rebuild) {
    if (!pre.asarPath) {
      console.log(TAG, 'Execute com --rebuild para gerar novo app.asar');
      process.exit(pre.ok ? 0 : 1);
    }
    process.exit(pre.ok ? 0 : 1);
  }

  console.log(TAG, '=== ETAPA 2 — Rebuild completo (sem cache) ===');
  run('node', ['build/electron/limpar-cache-build.js']);
  run('npm', ['run', 'build:erp'], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  });

  console.log(TAG, '=== ETAPA 3 — Certificação de hash ===');
  const manifesto = gerarManifesto(root, { modulo: 'erp' });
  escreverManifesto(root, manifesto);

  const pos = certificarIntegridadeErp(root);
  if (!pos.ok) {
    salvarRelatorio(pos.relatorio);
    fail(`certificação reprovada\n${pos.cmp.erros.join('\n')}`);
  }

  console.log(TAG, '=== ETAPA 4/5 — Smoke + Runtime ===');
  console.log(TAG, 'smoke módulos OK:', pos.smoke.modulos.join(', '));
  if (pos.smoke.erros.length) {
    fail(`smoke test falhou:\n${pos.smoke.erros.join('\n')}`);
  }

  run('node', ['tests/muc/rc431-build-certificacao.test.js', '--require-asar']);

  console.log(TAG, '=== ETAPA 6 — Manifesto da build ===');
  const buildPath = escreverManifestoBuild(root, pos.buildManifest);
  console.log(TAG, 'manifesto build:', path.relative(root, buildPath));
  console.log(JSON.stringify(pos.buildManifest, null, 2));

  salvarRelatorio([
    '# RC4.31.7 — Relatório de Integridade Electron',
    '',
    `Data: ${pos.buildManifest.data}`,
    `Commit: ${pos.buildManifest.commit}`,
    `Versão: ${pos.buildManifest.versao}`,
    '',
    pos.relatorio,
    '',
    '## Manifesto da build',
    '',
    '```json',
    JSON.stringify(pos.buildManifest, null, 2),
    '```',
    '',
    '## Resultado',
    '',
    `- Certificação: **${pos.buildManifest.certificacao.resultado}**`,
    `- Hash app.asar: \`${pos.buildManifest.hashAppAsar}\``,
    `- Arquivos empacotados: ${pos.buildManifest.quantidadeArquivosEmpacotados}`,
    `- Manifesto: \`${BUILD_MANIFEST_REL}\``
  ].join('\n'));

  console.log(TAG, '=== CERTIFICAÇÃO APROVADA ===');
  console.log('OK');
}

main();
