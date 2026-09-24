'use strict';

/**
 * Sprint 1 — Fundação cadastro inteligente por CNPJ.
 * Normalização, validação DV, duplicidade, DTO e persistência.
 *
 * Executar: node --test tests/cadastro/sprint1-cnpj-fundacao.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  normalizarCnpj,
  validarCnpj,
  prepararDocumentoCadastro,
  apenasDigitos,
  sqlColunaSomenteDigitos
} = require('../../backend/services/cadastro/documentoCpfCnpj');
const { normalizarCnpj: normalizarCnpjMiip } = require('../../backend/motores/miip/utils/normalizarCnpj');
const EmpresaCnpjDTO = require('../../backend/services/cadastro/contracts/EmpresaCnpjDTO');
const helpersRc831 = require('../../frontend/erp/js/compras-fornecedor-cnpj-rc831.js');
const db = require('../../backend/database');

const CNPJ_MASCARA = '09.591.661/0001-03';
const CNPJ_DIGITOS = '09591661000103';
const CNPJ_ESPACOS = '09 591 661 0001 03';
const CNPJ_INVALIDO_DV = '09591661000100';
const CPF_EXEMPLO = '529.982.247-25';
const CPF_DIGITOS = '52998224725';

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

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

describe('Sprint 1 — normalização CNPJ', () => {
  it('TESTE 1: máscara → 14 dígitos', () => {
    assert.equal(normalizarCnpj(CNPJ_MASCARA), CNPJ_DIGITOS);
    assert.equal(normalizarCnpjMiip(CNPJ_MASCARA), CNPJ_DIGITOS);
  });

  it('TESTE 2: já normalizado permanece', () => {
    assert.equal(normalizarCnpj(CNPJ_DIGITOS), CNPJ_DIGITOS);
  });

  it('TESTE 3: espaços → 14 dígitos', () => {
    assert.equal(normalizarCnpj(CNPJ_ESPACOS), CNPJ_DIGITOS);
  });

  it('null/vazio/curto → null', () => {
    assert.equal(normalizarCnpj(null), null);
    assert.equal(normalizarCnpj(''), null);
    assert.equal(normalizarCnpj('123'), null);
    assert.equal(normalizarCnpj(CPF_EXEMPLO), null);
  });
});

describe('Sprint 1 — validação CNPJ', () => {
  it('TESTE 4: CNPJ inválido por dígitos verificadores', () => {
    assert.equal(validarCnpj(CNPJ_INVALIDO_DV), false);
    assert.equal(prepararDocumentoCadastro(CNPJ_INVALIDO_DV).ok, false);
    assert.equal(helpersRc831.validarCnpjCompra(CNPJ_INVALIDO_DV), false);
  });

  it('CNPJ válido passa na validação (backend e RC831)', () => {
    assert.equal(validarCnpj(CNPJ_MASCARA), true);
    assert.equal(helpersRc831.validarCnpjCompra(CNPJ_MASCARA), true);
    assert.equal(prepararDocumentoCadastro(CNPJ_MASCARA).valor, CNPJ_DIGITOS);
  });

  it('TESTE 11: CPF não é tratado como CNPJ', () => {
    assert.equal(normalizarCnpj(CPF_EXEMPLO), null);
    const prep = prepararDocumentoCadastro(CPF_EXEMPLO);
    assert.equal(prep.ok, true);
    assert.equal(prep.tipo, 'cpf');
    assert.equal(prep.valor, CPF_DIGITOS);
    assert.notEqual(prep.valor.length, 14);
  });
});

describe('Sprint 1 — EmpresaCnpjDTO', () => {
  it('cria contrato interno sem depender de API', () => {
    const dto = EmpresaCnpjDTO.create({
      cnpj: CNPJ_DIGITOS,
      razao_social: 'Empresa Teste LTDA',
      nome_fantasia: 'Empresa Teste',
      municipio: 'Fortaleza',
      uf: 'CE',
      codigo_municipio: '2304400'
    });
    assert.equal(dto.cnpj, CNPJ_DIGITOS);
    assert.equal(dto.razaoSocial, 'Empresa Teste LTDA');
    assert.equal(dto.municipio, 'Fortaleza');
    assert.equal(dto.codigoMunicipio, '2304400');
    const payload = dto.toFornecedorPayload();
    assert.equal(payload.cpf_cnpj, CNPJ_DIGITOS);
    assert.equal(payload.razao_social, 'Empresa Teste LTDA');
    assert.equal(payload.cidade, 'Fortaleza');
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'nome_fantasia'));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'complemento'));
  });
});

describe('Sprint 1 — persistência fornecedor / cliente / compras', () => {
  const idsFornecedor = [];
  const idsCliente = [];
  const marker = `CDS_S1_CNPJ_${Date.now()}`;

  after(async () => {
    await whenReady();
    for (const id of idsFornecedor) {
      await run('DELETE FROM fornecedores WHERE id = ?', [id]).catch(() => {});
    }
    for (const id of idsCliente) {
      await run('DELETE FROM clientes WHERE id = ?', [id]).catch(() => {});
    }
    await run('DELETE FROM fornecedores WHERE nome LIKE ?', [`${marker}%`]).catch(() => {});
    await run('DELETE FROM clientes WHERE nome LIKE ?', [`${marker}%`]).catch(() => {});
  });

  it('TESTE 6: fornecedor novo com máscara grava só dígitos', async () => {
    await whenReady();
    const cnpj = CNPJ_DIGITOS;
    await run('DELETE FROM fornecedores WHERE ' + sqlColunaSomenteDigitos('cpf_cnpj') + ' = ?', [cnpj]);

    const prep = prepararDocumentoCadastro(CNPJ_MASCARA);
    assert.equal(prep.ok, true);
    assert.equal(prep.valor, cnpj);

    const existente = await get(
      `SELECT id FROM fornecedores WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?`,
      [prep.valor]
    );
    assert.equal(existente, null);

    const inserted = await run(
      `INSERT INTO fornecedores (nome, razao_social, cpf_cnpj) VALUES (?, ?, ?)`,
      [`${marker}_F1`, `${marker}_F1`, prep.valor]
    );
    idsFornecedor.push(inserted.lastID);

    const row = await get('SELECT cpf_cnpj FROM fornecedores WHERE id = ?', [inserted.lastID]);
    assert.equal(row.cpf_cnpj, CNPJ_DIGITOS);
    assert.equal(/\D/.test(row.cpf_cnpj), false);
  });

  it('TESTE 5: duplicidade máscara vs dígitos detectada', async () => {
    await whenReady();
    const cnpj = CNPJ_DIGITOS;
    let row = await get(
      `SELECT id FROM fornecedores WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?`,
      [cnpj]
    );
    if (!row) {
      const inserted = await run(
        `INSERT INTO fornecedores (nome, cpf_cnpj) VALUES (?, ?)`,
        [`${marker}_F2`, cnpj]
      );
      idsFornecedor.push(inserted.lastID);
      row = { id: inserted.lastID };
    }

    const prepMascara = prepararDocumentoCadastro(CNPJ_MASCARA);
    assert.equal(prepMascara.valor, cnpj);

    const conflito = await get(
      `SELECT id, nome FROM fornecedores WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?`,
      [prepMascara.valor]
    );
    assert.ok(conflito);
    assert.equal(apenasDigitos(conflito.id ? CNPJ_MASCARA : ''), CNPJ_DIGITOS);
  });

  it('TESTE 7: atualização com máscara mantém só dígitos', async () => {
    await whenReady();
    const inserted = await run(
      `INSERT INTO fornecedores (nome, cpf_cnpj) VALUES (?, ?)`,
      [`${marker}_F3`, '11222333000181']
    );
    idsFornecedor.push(inserted.lastID);

    const prep = prepararDocumentoCadastro('11.222.333/0001-81');
    assert.equal(prep.valor, '11222333000181');

    await run('UPDATE fornecedores SET cpf_cnpj = ? WHERE id = ?', [prep.valor, inserted.lastID]);
    const row = await get('SELECT cpf_cnpj FROM fornecedores WHERE id = ?', [inserted.lastID]);
    assert.equal(row.cpf_cnpj, '11222333000181');
  });

  it('TESTE 8: cliente POST com CNPJ (só dígitos)', async () => {
    await whenReady();
    const cnpjAlt = '11444777000161';
    await run('DELETE FROM clientes WHERE ' + sqlColunaSomenteDigitos('cpf_cnpj') + ' = ?', [cnpjAlt]);

    const prep = prepararDocumentoCadastro('11.444.777/0001-61');
    assert.equal(prep.ok, true);
    assert.equal(prep.valor, cnpjAlt);

    const inserted = await run(
      `INSERT INTO clientes (nome, cpf_cnpj, limite_credito, credito_atual) VALUES (?, ?, 0, 0)`,
      [`${marker}_C1`, prep.valor]
    );
    idsCliente.push(inserted.lastID);
    const row = await get('SELECT cpf_cnpj FROM clientes WHERE id = ?', [inserted.lastID]);
    assert.equal(row.cpf_cnpj, cnpjAlt);
  });

  it('TESTE 9: cliente PUT com máscara normaliza como POST', async () => {
    await whenReady();
    const inserted = await run(
      `INSERT INTO clientes (nome, cpf_cnpj, limite_credito, credito_atual) VALUES (?, ?, 0, 0)`,
      [`${marker}_C2`, '11222333000181']
    );
    idsCliente.push(inserted.lastID);

    const prep = prepararDocumentoCadastro(CNPJ_MASCARA);
    // outro CNPJ válido para update
    const prep2 = prepararDocumentoCadastro('07.670.414/0002-58');
    assert.equal(prep2.valor, '07670414000258');

    await run('UPDATE clientes SET cpf_cnpj = ? WHERE id = ?', [prep2.valor, inserted.lastID]);
    const row = await get('SELECT cpf_cnpj FROM clientes WHERE id = ?', [inserted.lastID]);
    assert.equal(row.cpf_cnpj, '07670414000258');
    assert.equal(prep.ok, true);
  });

  it('TESTE 10: importação XML encontra fornecedor mascarado legado', async () => {
    await whenReady();
    const cnpjXml = '63479539000195';
    // Simula legado mascarado + busca estilo garantirFornecedorCompra
    await run('DELETE FROM fornecedores WHERE ' + sqlColunaSomenteDigitos('cpf_cnpj') + ' = ?', [cnpjXml]);
    const inserted = await run(
      `INSERT INTO fornecedores (nome, cpf_cnpj) VALUES (?, ?)`,
      [`${marker}_XML`, '63.479.539/0001-95']
    );
    idsFornecedor.push(inserted.lastID);

    const encontrado = await get(
      `SELECT id FROM fornecedores WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ? LIMIT 1`,
      [cnpjXml]
    );
    assert.ok(encontrado);
    assert.equal(encontrado.id, inserted.lastID);
  });

  it('rotas usam prepararDocumentoCadastro / sqlColunaSomenteDigitos', () => {
    const forn = fs.readFileSync(path.join(ROOT, 'backend/rotas/fornecedores.js'), 'utf8');
    const cli = fs.readFileSync(path.join(ROOT, 'backend/rotas/clientes.js'), 'utf8');
    const compras = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
    assert.match(forn, /prepararDocumentoCadastro/);
    assert.match(forn, /sqlColunaSomenteDigitos/);
    assert.match(cli, /normalizarDocumentoCliente/);
    assert.match(cli, /sqlColunaSomenteDigitos/);
    assert.match(compras, /documentoCpfCnpj/);
    assert.match(compras, /sqlColunaSomenteDigitos/);
  });
});
