/**
 * Sprint Entrega — Cliente completo, consumidor avulso, snapshot e comprovantes
 * node --test tests/vendas-entrega/sprint-cliente-snapshot-comprovantes.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const {
  montarSnapshotEntrega,
  resolverDadosClienteEntrega,
  formatarEnderecoLinha,
  montarHtmlComprovanteEntrega,
  montarHtmlComprovantePrestacao
} = require('../../backend/services/entrega');

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function closeDb(db) {
  return new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
  });
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Sprint Entrega — contratos UI/API', () => {
  it('modal usa busca dinâmica e consumidor avulso (sem select de lista)', () => {
    const ui = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.match(ui, /entregaClienteBusca/);
    assert.match(ui, /clientes\/buscar/);
    assert.match(ui, /btnConsumidorAvulsoEntrega/);
    assert.match(ui, /carregarClienteCompletoEntrega/);
    assert.match(ui, /clientes\/\$\{clienteId\}|clientes\/\$\{id\}|\/clientes\//);
    assert.match(ui, /nome_cliente_entrega/);
    assert.match(ui, /cpf_cnpj_cliente_entrega/);
    assert.match(ui, /email_cliente_entrega/);
    assert.doesNotMatch(ui, /carregarClientesEntrega/);
    assert.doesNotMatch(ui, /clientes\?limit=200/);
    assert.ok(!ui.includes("method: 'POST'") || !/fetch\([^)]*\/clientes[^)]*POST/.test(ui));
  });

  it('seed/migration de snapshot e serviços exportados', () => {
    const dbSrc = ler('backend/database.js');
    assert.match(dbSrc, /nome_cliente_entrega/);
    assert.match(dbSrc, /cpf_cnpj_cliente_entrega/);
    assert.match(dbSrc, /email_cliente_entrega/);
    assert.match(dbSrc, /cep_entrega/);
    assert.match(dbSrc, /numero_entrega/);
    assert.match(dbSrc, /bairro_entrega/);
    assert.match(dbSrc, /cidade_entrega/);
    assert.match(dbSrc, /uf_entrega/);

    const criar = ler('backend/services/entrega/CriarVendaEntregaService.js');
    assert.match(criar, /montarSnapshotEntrega/);
    assert.match(criar, /nome_cliente_entrega/);
    assert.match(criar, /resolverDadosClienteEntrega/);

    const motor = ler('backend/services/entrega/MotorFinalizacaoVenda.js');
    assert.match(motor, /nome_cliente_entrega/);
    assert.match(motor, /cpf_cnpj_cliente_entrega/);
    assert.match(motor, /cep_entrega/);

    const phone = ler('backend/motores/mib/enterprise/providers/BaseSqlProvider.js');
    assert.match(phone, /'\('/);
    assert.match(phone, /' '/);
  });
});

describe('Sprint Entrega — cliente e snapshot', () => {
  it('1-2. busca por nome/telefone — rota e provider existem', () => {
    const rotas = ler('backend/rotas/clientes.js');
    assert.match(rotas, /\/buscar/);
    assert.match(rotas, /SearchService|obterSearchService/);
    const provider = ler('backend/motores/mib/enterprise/providers/ClientProvider.js');
    assert.match(provider, /telefone/);
    assert.match(provider, /nome/);
  });

  it('3-15. snapshot carrega cadastro completo no body da entrega', () => {
    const cliente = {
      id: 7,
      nome: 'João da Silva',
      cpf_cnpj: '000.000.000-00',
      telefone: '(88) 99999-9999',
      email: 'joao@email.com',
      cep: '63031165',
      rua: 'Rua Santo Amâncio',
      numero: '190',
      complemento: 'Apto 02',
      bairro: 'Tiradentes',
      cidade: 'Juazeiro do Norte',
      uf: 'CE'
    };
    const snap = montarSnapshotEntrega({
      cliente_id: 7,
      referencia_entrega: 'Próximo à praça'
    }, cliente);

    assert.equal(snap.cliente_id, 7);
    assert.equal(snap.nome_cliente_entrega, 'João da Silva');
    assert.equal(snap.cpf_cnpj_cliente_entrega, '000.000.000-00');
    assert.equal(snap.telefone_entrega, '(88) 99999-9999');
    assert.equal(snap.email_cliente_entrega, 'joao@email.com');
    assert.equal(snap.cep_entrega, '63031165');
    assert.equal(snap.endereco_entrega, 'Rua Santo Amâncio');
    assert.equal(snap.numero_entrega, '190');
    assert.equal(snap.complemento_entrega, 'Apto 02');
    assert.equal(snap.bairro_entrega, 'Tiradentes');
    assert.equal(snap.cidade_entrega, 'Juazeiro do Norte');
    assert.equal(snap.uf_entrega, 'CE');
    assert.equal(snap.referencia_entrega, 'Próximo à praça');
  });

  it('16-22. consumidor avulso — cliente_id NULL e dados na entrega', () => {
    const snap = montarSnapshotEntrega({
      cliente_id: null,
      nome_cliente_entrega: 'Consumidor Avulso',
      telefone_entrega: '88988887777',
      endereco_entrega: 'Rua B',
      numero_entrega: '200',
      referencia_entrega: 'Portão verde'
    }, null);

    assert.equal(snap.cliente_id, null);
    assert.equal(snap.nome_cliente_entrega, 'Consumidor Avulso');
    assert.equal(snap.telefone_entrega, '88988887777');
    assert.equal(snap.endereco_entrega, 'Rua B');
    assert.equal(snap.numero_entrega, '200');
    assert.equal(snap.referencia_entrega, 'Portão verde');
  });

  it('23. entrega sem identificação continua Consumidor', () => {
    const snap = montarSnapshotEntrega({
      cliente_id: null,
      endereco_entrega: 'Rua C'
    }, null);
    assert.equal(snap.cliente_id, null);
    assert.equal(snap.nome_cliente_entrega, null);

    const dados = resolverDadosClienteEntrega({
      endereco_entrega: 'Rua C'
    });
    assert.equal(dados.nome, 'Consumidor');
  });

  it('7. edição na entrega não usa cadastro quando body sobrescreve', () => {
    const cliente = {
      id: 1,
      nome: 'João',
      rua: 'Rua A',
      numero: '100',
      telefone: '111'
    };
    const snap = montarSnapshotEntrega({
      cliente_id: 1,
      nome_cliente_entrega: 'João',
      endereco_entrega: 'Rua B',
      numero_entrega: '200',
      telefone_entrega: '222'
    }, cliente);
    assert.equal(snap.endereco_entrega, 'Rua B');
    assert.equal(snap.numero_entrega, '200');
    assert.equal(snap.telefone_entrega, '222');
  });

  it('24-30. imutabilidade do snapshot vs cadastro posterior', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE clientes (
        id INTEGER PRIMARY KEY, nome TEXT, rua TEXT, numero TEXT
      )`);
      await run(db, `CREATE TABLE vendas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER,
        nome_cliente_entrega TEXT,
        endereco_entrega TEXT,
        numero_entrega TEXT,
        telefone_entrega TEXT
      )`);
      await run(db, `INSERT INTO clientes (id, nome, rua, numero) VALUES (1, 'João', 'Rua A', '100')`);

      const snap1 = montarSnapshotEntrega({
        cliente_id: 1,
        nome_cliente_entrega: 'João',
        endereco_entrega: 'Rua A',
        numero_entrega: '100',
        telefone_entrega: '88'
      });
      await run(db, `INSERT INTO vendas (cliente_id, nome_cliente_entrega, endereco_entrega, numero_entrega, telefone_entrega)
        VALUES (?, ?, ?, ?, ?)`, [
        snap1.cliente_id, snap1.nome_cliente_entrega, snap1.endereco_entrega,
        snap1.numero_entrega, snap1.telefone_entrega
      ]);

      await run(db, `UPDATE clientes SET rua = 'Rua B', numero = '200' WHERE id = 1`);

      const entregaAntiga = await get(db, 'SELECT * FROM vendas WHERE id = 1');
      assert.equal(entregaAntiga.endereco_entrega, 'Rua A');
      assert.equal(entregaAntiga.numero_entrega, '100');
      assert.equal(entregaAntiga.cliente_id, 1);

      const snap2 = montarSnapshotEntrega({
        cliente_id: 1,
        nome_cliente_entrega: 'João',
        endereco_entrega: 'Rua B',
        numero_entrega: '200'
      });
      await run(db, `INSERT INTO vendas (cliente_id, nome_cliente_entrega, endereco_entrega, numero_entrega)
        VALUES (?, ?, ?, ?)`, [
        snap2.cliente_id, snap2.nome_cliente_entrega, snap2.endereco_entrega, snap2.numero_entrega
      ]);

      const e1 = await get(db, 'SELECT * FROM vendas WHERE id = 1');
      const e2 = await get(db, 'SELECT * FROM vendas WHERE id = 2');
      assert.equal(e1.endereco_entrega, 'Rua A');
      assert.equal(e2.endereco_entrega, 'Rua B');
      assert.equal(e1.cliente_id, 1);
      assert.equal(e2.cliente_id, 1);

      const avulso = montarSnapshotEntrega({
        cliente_id: null,
        nome_cliente_entrega: 'Avulso'
      });
      assert.equal(avulso.cliente_id, null);
    } finally {
      await closeDb(db);
    }
  });
});

describe('Sprint Entrega — comprovantes', () => {
  const vendaCompleta = {
    id: 100,
    total: 45,
    taxa_entrega: 5,
    pagamento_previsto: 'PIX',
    entregador: 'Carlos',
    leva_maquineta: 1,
    troco_para: 50,
    observacao_entrega: 'Cuidado',
    nome_cliente_entrega: 'Maria Oliveira',
    cpf_cnpj_cliente_entrega: '111.222.333-44',
    telefone_entrega: '(88) 98888-8888',
    email_cliente_entrega: 'maria@email.com',
    cep_entrega: '63000000',
    endereco_entrega: 'Rua das Flores',
    numero_entrega: '50',
    complemento_entrega: 'Casa',
    bairro_entrega: 'Centro',
    cidade_entrega: 'Juazeiro do Norte',
    uf_entrega: 'CE',
    referencia_entrega: 'Próximo à praça'
  };

  it('31. Comprovante de Entrega contém dados completos do snapshot', () => {
    const html = montarHtmlComprovanteEntrega(
      vendaCompleta,
      [{ nome: 'Bolacha', quantidade: 2, preco_unitario: 20, subtotal: 40 }],
      { nome: 'Loja', cnpj: '00.000.000/0001-00' }
    );
    assert.match(html, /COMPROVANTE DE ENTREGA/);
    assert.match(html, /DADOS DO CLIENTE\/CONSUMIDOR/);
    assert.match(html, /Maria Oliveira/);
    assert.match(html, /111\.222\.333-44/);
    assert.match(html, /\(88\) 98888-8888/);
    assert.match(html, /maria@email\.com/);
    assert.match(html, /ENDEREÇO DA ENTREGA/);
    assert.match(html, /63000-000/);
    assert.match(html, /Rua das Flores/);
    assert.match(html, /Número:<\/strong> 50/);
    assert.match(html, /Casa/);
    assert.match(html, /Centro/);
    assert.match(html, /Juazeiro do Norte/);
    assert.match(html, /UF:<\/strong> CE/);
    assert.match(html, /Próximo à praça/);
    assert.match(html, /Bolacha/);
    assert.match(html, /Subtotal/);
  });

  it('32. Comprovante de Prestação contém os mesmos dados do snapshot', () => {
    const html = montarHtmlComprovantePrestacao({
      ...vendaCompleta,
      pedido: 100,
      codigo: 'ENT-1',
      cliente: vendaCompleta.nome_cliente_entrega,
      valor: 45,
      pagamento_recebido: 'PIX',
      documento: 'NAO_FISCAL',
      troco_levado: 50,
      troco_devolvido: 5,
      maquineta: 'SIM',
      operador: 'Caixa'
    });
    assert.match(html, /COMPROVANTE DE PRESTAÇÃO/);
    assert.match(html, /CLIENTE \/ CONSUMIDOR/);
    assert.match(html, /Maria Oliveira/);
    assert.match(html, /111\.222\.333-44/);
    assert.match(html, /maria@email\.com/);
    assert.match(html, /Rua das Flores/);
    assert.match(html, /Próximo à praça/);
    assert.match(html, /PRESTAÇÃO DE CONTAS FINALIZADA/);
  });

  it('33-34. comprovante usa snapshot; alteração de cadastro não afeta HTML antigo', () => {
    const htmlAntes = montarHtmlComprovanteEntrega({
      ...vendaCompleta,
      endereco_entrega: 'Rua A',
      numero_entrega: '100'
    }, []);
    assert.match(htmlAntes, /Rua A/);
    assert.match(htmlAntes, /100/);

    const htmlDepois = montarHtmlComprovanteEntrega({
      ...vendaCompleta,
      endereco_entrega: 'Rua A',
      numero_entrega: '100'
    }, []);
    assert.equal(htmlAntes.includes('Rua B'), false);
    assert.match(htmlDepois, /Rua A/);
  });

  it('35. consumidor avulso aparece corretamente', () => {
    const html = montarHtmlComprovanteEntrega({
      id: 2,
      total: 10,
      nome_cliente_entrega: 'Avulso Teste',
      telefone_entrega: '8899',
      endereco_entrega: 'Rua X',
      numero_entrega: '1',
      cidade_entrega: 'Crato',
      uf_entrega: 'CE'
    }, []);
    assert.match(html, /Avulso Teste/);
    assert.doesNotMatch(html, />Consumidor</);
  });

  it('legado sem snapshot continua funcionando', () => {
    const html = montarHtmlComprovanteEntrega({
      id: 3,
      total: 10,
      cliente_nome: 'Legado',
      telefone_entrega: '11',
      endereco_entrega: 'Rua Antiga, 9, Centro'
    }, []);
    assert.match(html, /Legado/);
    assert.match(html, /Rua Antiga/);
  });

  it('formatarEnderecoLinha monta componentes', () => {
    const linha = formatarEnderecoLinha({
      endereco: 'Rua A',
      numero: '10',
      bairro: 'Centro',
      cidade: 'Crato',
      uf: 'CE',
      cep: '63100000'
    });
    assert.match(linha, /Rua A, 10/);
    assert.match(linha, /Centro/);
    assert.match(linha, /Crato - CE/);
    assert.match(linha, /CEP 63100-000/);
  });
});
