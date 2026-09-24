'use strict';

/**
 * Sprint 2D — Padronização do cadastro de Cliente.
 * Executar: node --test tests/cadastro/sprint2d-cliente-padronizacao.test.js
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const db = require('../../backend/database');
const { validarLimiteCreditoCadastro } = require('../../backend/services/cadastro/limiteCreditoCliente');
const { sqlColunaSomenteDigitos } = require('../../backend/services/cadastro/documentoCpfCnpj');

const marker = `CDS_S2D_${Date.now()}`;
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

/**
 * Extrai e executa aplicarDadosConsultaCnpjCliente do frontend em sandbox jQuery-like.
 */
function carregarAplicarDadosConsulta() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/clientes.js'), 'utf8');
  const match = src.match(/function aplicarDadosConsultaCnpjCliente\([\s\S]*?\n\}/);
  assert.ok(match, 'aplicarDadosConsultaCnpjCliente deve existir');

  const store = {};
  const $ = (sel) => {
    const key = String(sel).replace(/^#/, '');
    return {
      val(v) {
        if (arguments.length === 0) return store[key] == null ? '' : store[key];
        store[key] = v;
        return this;
      }
    };
  };
  const sandbox = {
    $,
    formatarCpfCnpj: (v) => String(v || ''),
    console
  };
  vm.runInNewContext(`${match[0]}; this.aplicar = aplicarDadosConsultaCnpjCliente;`, sandbox);
  return {
    aplicar: sandbox.aplicar,
    getStore: () => ({ ...store }),
    setField: (k, v) => { store[k] = v; }
  };
}

describe('Sprint 2D — UI / consulta CNPJ', () => {
  it('formulário tem Razão Social, Contato, Observações e Buscar Endereço', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/clientes.js'), 'utf8');
    assert.match(ui, /Razão Social/);
    assert.match(ui, /Nome \/ Nome Fantasia/);
    assert.match(ui, /id="razao_social"/);
    assert.match(ui, /id="contato"/);
    assert.match(ui, /id="observacoes"/);
    assert.match(ui, /Buscar Endereço/);
    assert.match(ui, /buscarEnderecoPorCepCliente/);
    assert.match(ui, /viacep\.com\.br/);
    assert.match(ui, /Crédito Atual/);
    assert.match(ui, /readonly disabled/);
  });

  it('consulta CNPJ preenche Razão Social e Nome/Fantasia', () => {
    const { aplicar, getStore } = carregarAplicarDadosConsulta();
    aplicar({
      cnpj: '09591661000103',
      nomeFantasia: 'MV ENGENHARIA',
      razaoSocial: 'AV SOUSA ENGENHARIA LTDA',
      telefone: '8835212151',
      cep: '63145000',
      logradouro: 'RUA A',
      numero: '71',
      bairro: 'CENTRO',
      municipio: 'TARRAFAS',
      uf: 'CE',
      codigoMunicipio: '2313252',
      inscricaoEstadual: null,
      email: null
    });
    const s = getStore();
    assert.equal(s.nome, 'MV ENGENHARIA');
    assert.equal(s.razao_social, 'AV SOUSA ENGENHARIA LTDA');
    assert.equal(s.cpf_cnpj, '09591661000103');
    assert.equal(s.telefone, '8835212151');
    assert.equal(s.codigo_municipio, '2313252');
    assert.equal(s.inscricao_estadual, undefined);
    assert.equal(s.email, undefined);
  });

  it('consulta CNPJ não apaga campos quando API não retorna valor', () => {
    const { aplicar, getStore, setField } = carregarAplicarDadosConsulta();
    setField('email', 'cliente@empresa.com');
    setField('inscricao_estadual', 'ISENTO');
    setField('contato', 'João');
    setField('nome', 'Nome Manual');
    setField('razao_social', 'Razao Manual');

    aplicar({
      cnpj: '09591661000103',
      nomeFantasia: null,
      razaoSocial: null,
      email: null,
      inscricaoEstadual: null,
      telefone: '11999999999'
    });

    const s = getStore();
    assert.equal(s.email, 'cliente@empresa.com');
    assert.equal(s.inscricao_estadual, 'ISENTO');
    assert.equal(s.contato, 'João');
    assert.equal(s.nome, 'Nome Manual');
    assert.equal(s.razao_social, 'Razao Manual');
    assert.equal(s.telefone, '11999999999');
  });
});

describe('Sprint 2D — persistência POST/PUT campos + limite', () => {
  after(async () => {
    await whenReady();
    for (const id of ids) {
      await run('DELETE FROM clientes WHERE id = ?', [id]).catch(() => {});
    }
    await run('DELETE FROM clientes WHERE nome LIKE ?', [`${marker}%`]).catch(() => {});
  });

  it('salva Razão Social, Nome/Fantasia, Contato e Observações', async () => {
    await whenReady();
    const lim = validarLimiteCreditoCadastro({ utiliza_limite_credito: 0, limite_credito: null });
    assert.equal(lim.ok, true);

    const inserted = await run(
      `INSERT INTO clientes (
        nome, razao_social, cpf_cnpj, telefone, email, contato, cep, rua, numero, bairro, cidade, uf,
        limite_credito, credito_atual, utiliza_limite_credito, codigo_municipio, inscricao_estadual, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        `${marker}_FANTASIA`,
        `${marker}_RAZAO`,
        null,
        '85999990000',
        'a@b.com',
        'Maria Contato',
        '63145000',
        'RUA X',
        '10',
        'CENTRO',
        'TARRAFAS',
        'CE',
        lim.limite,
        lim.utiliza,
        '2313252',
        null,
        'Obs sprint 2D'
      ]
    );
    ids.push(inserted.lastID);

    const row = await get(
      `SELECT nome, razao_social, contato, observacoes, utiliza_limite_credito, limite_credito, credito_atual
       FROM clientes WHERE id = ?`,
      [inserted.lastID]
    );
    assert.equal(row.nome, `${marker}_FANTASIA`);
    assert.equal(row.razao_social, `${marker}_RAZAO`);
    assert.equal(row.contato, 'Maria Contato');
    assert.equal(row.observacoes, 'Obs sprint 2D');
    assert.equal(Number(row.utiliza_limite_credito) || 0, 0);
    assert.equal(Number(row.credito_atual) || 0, 0);
  });

  it('PUT atualiza novos campos sem alterar credito_atual', async () => {
    await whenReady();
    const inserted = await run(
      `INSERT INTO clientes (
        nome, razao_social, contato, observacoes, limite_credito, credito_atual, utiliza_limite_credito
      ) VALUES (?, ?, ?, ?, 100, 35.5, 1)`,
      [`${marker}_PUT`, 'Razao Antiga', 'Contato A', 'Obs A']
    );
    ids.push(inserted.lastID);

    await run(
      `UPDATE clientes
       SET nome = ?, razao_social = ?, contato = ?, observacoes = ?,
           limite_credito = ?, utiliza_limite_credito = ?
       WHERE id = ?`,
      [`${marker}_PUT_NOVO`, 'Razao Nova', 'Contato B', 'Obs B', 200, 1, inserted.lastID]
    );

    const row = await get(
      'SELECT nome, razao_social, contato, observacoes, limite_credito, credito_atual, utiliza_limite_credito FROM clientes WHERE id = ?',
      [inserted.lastID]
    );
    assert.equal(row.nome, `${marker}_PUT_NOVO`);
    assert.equal(row.razao_social, 'Razao Nova');
    assert.equal(row.contato, 'Contato B');
    assert.equal(row.observacoes, 'Obs B');
    assert.equal(Number(row.limite_credito), 200);
    assert.equal(Number(row.credito_atual), 35.5);
  });

  it('limite de crédito Sprint 2C continua válido', () => {
    assert.equal(validarLimiteCreditoCadastro({ utiliza_limite_credito: 0, limite_credito: null }).ok, true);
    assert.equal(validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: 10 }).ok, true);
    assert.equal(validarLimiteCreditoCadastro({ utiliza_limite_credito: 1, limite_credito: '' }).ok, false);
  });

  it('rotas e migration incluem novos campos; sem BrasilAPI na rota de clientes', () => {
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/clientes.js'), 'utf8');
    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(rotas, /razao_social/);
    assert.match(rotas, /contato/);
    assert.match(rotas, /observacoes/);
    assert.match(rotas, /validarLimiteCreditoCadastro/);
    assert.doesNotMatch(rotas, /BrasilApi|brasilapi/);
    assert.match(dbSrc, /clientes ADD COLUMN razao_social/);
    assert.match(dbSrc, /clientes ADD COLUMN contato/);
    assert.match(dbSrc, /clientes ADD COLUMN observacoes/);
  });

  it('Buscar CEP permanece na UI (ViaCEP existente)', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/clientes.js'), 'utf8');
    assert.match(ui, /buscarEnderecoPorCepCliente/);
    assert.match(ui, /viacep\.com\.br\/ws\//);
    assert.match(ui, /if \(data\.logradouro\)/);
  });
});
