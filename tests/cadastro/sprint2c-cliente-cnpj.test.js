'use strict';

/**
 * Sprint 2C — Cliente por CNPJ + limite de crédito opcional/obrigatório.
 * Executar: node --test tests/cadastro/sprint2c-cliente-cnpj.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const db = require('../../backend/database');
const {
  validarLimiteCreditoCadastro
} = require('../../backend/services/cadastro/limiteCreditoCliente');
const { prepararDocumentoCadastro } = require('../../backend/services/cadastro/documentoCpfCnpj');
const { resolverMunicipioDestinatario } = require('../../backend/services/fiscal/municipioIbge');
const EmpresaCnpjDTO = require('../../backend/services/cadastro/contracts/EmpresaCnpjDTO');
const { sqlColunaSomenteDigitos } = require('../../backend/services/cadastro/documentoCpfCnpj');

const CNPJ = '09591661000103';
const marker = `CDS_S2C_${Date.now()}`;
const ids = [];

function whenReady() {
  return new Promise((resolve, reject) => {
    db.whenReady((err) => (err ? reject(err) : resolve()));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

describe('Sprint 2C — limite de crédito', () => {
  it('desmarcado + null → passa', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: 0, limite_credito: null });
    assert.equal(r.ok, true);
    assert.equal(r.utiliza, 0);
    assert.equal(r.limite, 0);
  });

  it('desmarcado + 0 → passa', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: false, limite_credito: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.utiliza, 0);
  });

  it('marcado + 5000 → passa', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.limite, 5000);
  });

  it('marcado + 0 → passa', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: true, limite_credito: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.limite, 0);
  });

  it('marcado + null → rejeita', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: null });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it('marcado + vazio → rejeita', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: '' });
    assert.equal(r.ok, false);
  });

  it('marcado + abc → rejeita', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: 'abc' });
    assert.equal(r.ok, false);
  });

  it('marcado + negativo → rejeita', () => {
    const r = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: -1 });
    assert.equal(r.ok, false);
  });
});

describe('Sprint 2C — CNPJ / IBGE / persistência', () => {
  after(async () => {
    await whenReady();
    for (const id of ids) {
      await run('DELETE FROM clientes WHERE id = ?', [id]).catch(() => {});
    }
    await run('DELETE FROM clientes WHERE nome LIKE ?', [`${marker}%`]).catch(() => {});
  });

  it('CNPJ inválido rejeita via prepararDocumentoCadastro', () => {
    const r = prepararDocumentoCadastro('09591661000100');
    assert.equal(r.ok, false);
  });

  it('DTO preenche campos de cliente (contrato)', () => {
    const dto = EmpresaCnpjDTO.create({
      cnpj: CNPJ,
      razaoSocial: 'CLIENTE TESTE LTDA',
      nomeFantasia: 'CLIENTE TESTE',
      cep: '63145000',
      logradouro: 'RUA A',
      numero: '10',
      bairro: 'CENTRO',
      municipio: 'TARRAFAS',
      uf: 'CE',
      codigoMunicipio: '2313252',
      telefone: '8835212151',
      inscricaoEstadual: null,
      email: null
    });
    assert.equal(dto.cnpj, CNPJ);
    assert.equal(dto.municipio, 'TARRAFAS');
    assert.equal(dto.inscricaoEstadual, null);
    assert.equal(dto.email, null);
  });

  it('código IBGE resolvido por cidade/UF', () => {
    const cMun = resolverMunicipioDestinatario({ cidade: 'TARRAFAS', uf: 'CE' });
    assert.equal(cMun, '2313252');
  });

  it('cliente desmarcado salva sem exigir limite; IBGE persistido', async () => {
    await whenReady();
    const cMun = resolverMunicipioDestinatario({ cidade: 'TARRAFAS', uf: 'CE' });
    const lim = validarLimiteCreditoCadastro({ utiliza_limite_credito: 0, limite_credito: null });
    assert.equal(lim.ok, true);

    const inserted = await run(
      `INSERT INTO clientes (
        nome, cpf_cnpj, cidade, uf, limite_credito, credito_atual,
        utiliza_limite_credito, codigo_municipio, inscricao_estadual
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [`${marker}_A`, null, 'TARRAFAS', 'CE', lim.limite, lim.utiliza, cMun, null]
    );
    ids.push(inserted.lastID);
    const row = await get('SELECT * FROM clientes WHERE id = ?', [inserted.lastID]);
    assert.equal(Number(row.utiliza_limite_credito) || 0, 0);
    assert.equal(row.codigo_municipio, '2313252');
    assert.equal(row.inscricao_estadual, null);
  });

  it('cliente marcado + valor salva; marcado vazio rejeitado pela validação', async () => {
    await whenReady();
    const ok = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: 5000 });
    assert.equal(ok.ok, true);
    const bad = validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: '' });
    assert.equal(bad.ok, false);

    const inserted = await run(
      `INSERT INTO clientes (
        nome, cpf_cnpj, limite_credito, credito_atual, utiliza_limite_credito
      ) VALUES (?, ?, ?, 0, ?)`,
      [`${marker}_B`, null, ok.limite, ok.utiliza]
    );
    ids.push(inserted.lastID);
    const row = await get('SELECT utiliza_limite_credito, limite_credito FROM clientes WHERE id = ?', [inserted.lastID]);
    assert.equal(Number(row.utiliza_limite_credito), 1);
    assert.equal(Number(row.limite_credito), 5000);
  });

  it('CNPJ já cadastrado detectado por dígitos (máscara vs limpo)', async () => {
    await whenReady();
    await run(`DELETE FROM clientes WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?`, [CNPJ]);
    const inserted = await run(
      `INSERT INTO clientes (nome, cpf_cnpj, limite_credito, credito_atual, utiliza_limite_credito)
       VALUES (?, ?, 0, 0, 0)`,
      [`${marker}_DUP`, CNPJ]
    );
    ids.push(inserted.lastID);

    const prep = prepararDocumentoCadastro('09.591.661/0001-03');
    assert.equal(prep.valor, CNPJ);
    const conflito = await get(
      `SELECT id, nome FROM clientes WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?`,
      [prep.valor]
    );
    assert.ok(conflito);
    assert.equal(conflito.id, inserted.lastID);
  });

  it('UI e rotas reutilizam consulta-cnpj; colunas migradas no database.js', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/clientes.js'), 'utf8');
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/clientes.js'), 'utf8');
    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(ui, /consultarCnpjCliente/);
    assert.match(ui, /\/api\/consulta-cnpj\//);
    assert.match(ui, /utiliza_limite_credito/);
    assert.match(rotas, /validarLimiteCreditoCadastro/);
    assert.match(rotas, /codigo_municipio/);
    assert.match(rotas, /utiliza_limite_credito/);
    assert.match(dbSrc, /utiliza_limite_credito/);
    assert.match(dbSrc, /clientes ADD COLUMN codigo_municipio/);
    assert.doesNotMatch(rotas, /BrasilApi|brasilapi/);
  });
});
