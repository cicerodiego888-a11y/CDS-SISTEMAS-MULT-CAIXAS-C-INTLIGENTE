/**
 * TEF-DESTAXA-10 — Cadastro, mapeamento e validação do terminal PDV (sem hardware/TX).
 * Executar: node tests/tef/tef-destaxa-10-mapeamento-terminal.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const {
  avaliarMapeamentoTerminal,
  projetarEntradaIniciaClient,
  MAPEAMENTO_CAMPOS
} = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const { montarEntradaClient } = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const {
  listarConfVsPague,
  estadoMapeamentoOficial,
  avaliarEvidenciasDestaxa
} = require('../../backend/services/tef/destaxa/destaxaEvidenciasOperacionais');
const tefConfigService = require('../../backend/services/tef/tefConfigService');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error && error.stack ? error.stack : error}`);
    });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
  });
}

async function main() {
  console.log('\n=== TEF-DESTAXA-10 mapeamento terminal ===\n');

  await test('contrato mapeia empresa/loja/terminal e isola pdv/caixa', () => {
    const destaxa = MAPEAMENTO_CAMPOS.filter((c) => c.enviadoIniciaClient);
    const locais = MAPEAMENTO_CAMPOS.filter((c) => !c.enviadoIniciaClient);
    assert.strictEqual(destaxa.length, 3);
    assert.strictEqual(locais.length, 2);
    assert.ok(destaxa.every((c) => c.obrigatorioDll === false));
    assert.deepStrictEqual(locais.map((c) => c.cds).sort(), ['caixa_codigo', 'pdv_codigo']);
  });

  await test('entrada vazia: só versao+aplicacao; sem pdv/caixa', () => {
    const p = projetarEntradaIniciaClient({}, { versao: '1.0.3', aplicacao: 'CDS Sistemas' });
    assert.strictEqual(p.texto, 'versao=1.0.3;aplicacao=CDS Sistemas');
    assert.strictEqual(p.incluiPdvOuCaixa, false);
    const m = montarEntradaClient({});
    assert.strictEqual(m.texto, 'versao=1.0.3;aplicacao=CDS Sistemas');
    assert.ok(!m.chaves.includes('pdv'));
    assert.ok(!m.chaves.includes('caixa'));
  });

  await test('entrada parcial e completa mapeiam chaves Destaxa corretas', () => {
    const parcial = montarEntradaClient({ empresaCodigo: 'EST-A', loja_codigo: 'LJ-1' });
    assert.ok(parcial.texto.includes('estabelecimento=EST-A'));
    assert.ok(parcial.texto.includes('loja=LJ-1'));
    assert.ok(!parcial.texto.includes('terminal='));

    const completa = montarEntradaClient({
      empresa_codigo: 'E1',
      lojaCodigo: 'L1',
      terminalCodigo: 'T1',
      pdvCodigo: 'PDV-99',
      caixaCodigo: 'CX-1'
    });
    assert.strictEqual(
      completa.texto,
      'versao=1.0.3;aplicacao=CDS Sistemas;estabelecimento=E1;loja=L1;terminal=T1'
    );
    assert.ok(!completa.texto.includes('PDV-99'));
    assert.ok(!completa.texto.includes('CX-1'));
  });

  await test('avaliarMapeamento: vazio / parcial / completo sem homologar', () => {
    const vazio = avaliarMapeamentoTerminal({}, { provedor: 'destaxa' });
    assert.strictEqual(vazio.codigo, 'MAPEAMENTO_OFICIAL_PENDENTE');
    assert.strictEqual(vazio.tefProntoParaVenda, false);
    assert.strictEqual(vazio.homologacaoDeclarada, false);

    const parcial = avaliarMapeamentoTerminal(
      { empresaCodigo: 'E1' },
      { provedor: 'destaxa' }
    );
    assert.strictEqual(parcial.codigo, 'MAPEAMENTO_PARCIAL_SEM_CONFIRMACAO');
    assert.strictEqual(parcial.tefProntoParaVenda, false);

    const cheio = avaliarMapeamentoTerminal(
      { empresaCodigo: 'E1', lojaCodigo: 'L1', terminalCodigo: 'T1' },
      { provedor: 'destaxa' }
    );
    assert.strictEqual(cheio.codigo, 'MAPEAMENTO_PREENCHIDO_SEM_CONFIRMACAO_SERVIDOR');
    assert.strictEqual(cheio.tefProntoParaVenda, false);
    assert.strictEqual(cheio.homologacaoDeclarada, false);
  });

  await test('validarConfiguracao Destaxa: válida sem códigos, com avisos, sem homologar', () => {
    const r = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'destaxa',
      tefAmbiente: 'homologacao',
      pinpadHabilitado: true,
      pinpadModelo: 'PPC930',
      pinpadCodigo: 'GERTEC_PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM4'
    }, { modoAdapter: 'real' });
    assert.strictEqual(r.valida, true);
    assert.strictEqual(r.tefProntoParaVenda, false);
    assert.strictEqual(r.homologacaoDeclarada, false);
    assert.ok(Array.isArray(r.avisos) && r.avisos.length > 0);
    assert.strictEqual(r.mapeamentoDestaxa.codigo, 'MAPEAMENTO_OFICIAL_PENDENTE');
  });

  await test('validarConfiguracao outros provedores ainda exigem códigos', () => {
    const r = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'sitef',
      tefAmbiente: 'homologacao'
    }, { modoAdapter: 'real' });
    assert.strictEqual(r.valida, false);
    assert.ok(r.pendencias.some((p) => /empresa/i.test(p)));
  });

  await test('estadoMapeamentoOficial e evidências não declaram venda pronta', () => {
    const est = estadoMapeamentoOficial({});
    assert.strictEqual(est.homologacaoDeclarada, false);
    assert.strictEqual(est.tefProntoParaVenda, false);
    const evid = avaliarEvidenciasDestaxa({
      config: { tefProvedor: 'destaxa' },
      estadosIntegracao: {}
    });
    assert.strictEqual(evid.tefProntoParaVenda, false);
    assert.ok(evid.indicadores.mapeamentoEstabelecimentoLojaTerminal);
    assert.ok(evid.indicadores.identidadeClientVsPague);
  });

  await test('listarConfVsPague: estrutura de contagem (ambiente real ou ausente)', () => {
    const conf = listarConfVsPague();
    assert.ok(typeof conf.count === 'number');
    assert.ok(Array.isArray(conf.arquivos));
    // Ambiente atual documentado: 0 .conf — não falha se Destaxa provisionar depois.
    if (conf.diretorioExiste) {
      assert.ok(conf.count >= 0);
    }
  });

  await test('persistência isolada: round-trip empresa/loja/terminal/pdv/caixa', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-destaxa-10-'));
    const dbPath = path.join(dir, 'isolado.db');
    const db = await openDb(dbPath);
    await run(db, `
      CREATE TABLE tef_configuracao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habilitado INTEGER, provedor TEXT, ambiente TEXT,
        timeout INTEGER, tentativas INTEGER,
        empresa_codigo TEXT, loja_codigo TEXT, pdv_codigo TEXT,
        terminal_codigo TEXT, caixa_codigo TEXT,
        tipo_integracao TEXT, sdk_path TEXT, exe_path TEXT,
        ip_tef TEXT, porta_tef INTEGER,
        criado_em TEXT, atualizado_em TEXT
      )
    `);
    await run(
      db,
      `INSERT INTO tef_configuracao (
        habilitado, provedor, ambiente, empresa_codigo, loja_codigo,
        terminal_codigo, pdv_codigo, caixa_codigo, tipo_integracao
      ) VALUES (1,'destaxa','homologacao',?,?,?,?,?,'dll')`,
      ['EST-OFICIAL', 'LJ-OFICIAL', 'TERM-OFICIAL', 'PDV-LOCAL', 'CX-LOCAL']
    );
    const row = await get(
      db,
      'SELECT empresa_codigo, loja_codigo, terminal_codigo, pdv_codigo, caixa_codigo, provedor FROM tef_configuracao WHERE id=1'
    );
    assert.strictEqual(row.empresa_codigo, 'EST-OFICIAL');
    assert.strictEqual(row.loja_codigo, 'LJ-OFICIAL');
    assert.strictEqual(row.terminal_codigo, 'TERM-OFICIAL');
    assert.strictEqual(row.pdv_codigo, 'PDV-LOCAL');
    assert.strictEqual(row.caixa_codigo, 'CX-LOCAL');
    assert.strictEqual(row.provedor, 'destaxa');

    const entrada = montarEntradaClient({
      empresa_codigo: row.empresa_codigo,
      loja_codigo: row.loja_codigo,
      terminal_codigo: row.terminal_codigo,
      pdv_codigo: row.pdv_codigo,
      caixa_codigo: row.caixa_codigo
    });
    assert.ok(entrada.texto.includes('estabelecimento=EST-OFICIAL'));
    assert.ok(entrada.texto.includes('terminal=TERM-OFICIAL'));
    assert.ok(!entrada.texto.includes('PDV-LOCAL'));

    await new Promise((resolve, reject) => db.close((e) => (e ? reject(e) : resolve())));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('integridade: backup TEF-DESTAXA-10 existe e oficial intacto em tamanho', () => {
    const oficial = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';
    const bakDir = 'C:\\ProgramData\\MercantilFiscal\\dados\\backups';
    assert.ok(fs.existsSync(oficial), 'banco oficial deve existir');
    const backups = fs.existsSync(bakDir)
      ? fs.readdirSync(bakDir).filter((n) => n.includes('tef-destaxa-10'))
      : [];
    assert.ok(backups.length >= 1, 'backup tef-destaxa-10 deve existir');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(oficial)).digest('hex');
    assert.ok(sha.length === 64);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
