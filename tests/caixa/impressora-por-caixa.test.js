'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('node:vm');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, verificarPermissaoEspecifica } = require('../../backend/middleware/auth');
const authDb = require('../../backend/database');
const { criarImpressoraCaixaService } = require('../../backend/services/caixa/ImpressoraCaixaService');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

after(async () => {
  await close(authDb);
});

async function criarBancoTenant() {
  const db = new sqlite3.Database(':memory:');
  await run(db, `CREATE TABLE caixas (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    impressora_cupom TEXT,
    updated_at DATETIME
  )`);
  await run(db, 'CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)');
  await run(db, "INSERT INTO configuracoes (chave, valor) VALUES ('impressora_cupom', 'Global legado')");
  await run(db, "INSERT INTO caixas (id, nome) VALUES (1, 'Caixa 01'), (2, 'Caixa 02'), (3, 'Caixa 03')");
  return db;
}

describe('resolverImpressoraDoCaixa — por caixa com fallback legado', () => {
  let dbEmpresaA;

  before(async () => {
    dbEmpresaA = await criarBancoTenant();
    await dbEmpresaA.run("UPDATE caixas SET impressora_cupom = NULL WHERE id IN (1, 2, 3)");
  });

  after(async () => {
    await close(dbEmpresaA);
  });

  it('retorna o nome da impressora vinculada ao caixa quando existe configuração', async () => {
    const service = criarImpressoraCaixaService(dbEmpresaA);
    await service.salvarImpressoraDoCaixa(1, 'Elgin i8');
    await service.salvarImpressoraDoCaixa(2, 'Epson TM-T20');
    await service.salvarImpressoraDoCaixa(3, 'Bematech');

    assert.deepEqual(await service.resolverImpressoraDoCaixa(1), {
      caixa_id: 1,
      impressora_cupom: 'Elgin i8',
      configurada: true,
      deviceName: 'Elgin i8'
    });
    assert.deepEqual(await service.resolverImpressoraDoCaixa(2), {
      caixa_id: 2,
      impressora_cupom: 'Epson TM-T20',
      configurada: true,
      deviceName: 'Epson TM-T20'
    });
    assert.deepEqual(await service.resolverImpressoraDoCaixa(3), {
      caixa_id: 3,
      impressora_cupom: 'Bematech',
      configurada: true,
      deviceName: 'Bematech'
    });
  });

  it('usa fallback legado quando o caixa não possui impressora configurada', async () => {
    const service = criarImpressoraCaixaService(dbEmpresaA);
    await service.salvarImpressoraDoCaixa(1, '');
    const resolucao = await service.resolverImpressoraDoCaixa(1);
    assert.deepEqual(resolucao, {
      caixa_id: 1,
      impressora_cupom: null,
      configurada: false,
      deviceName: 'Global legado',
      fallback: 'Global legado'
    });
  });

  it('mantém a configuração global antiga sem ser alterada por um caixa diferente', async () => {
    const service = criarImpressoraCaixaService(dbEmpresaA);
    await service.salvarImpressoraDoCaixa(1, 'Epson');
    await service.salvarImpressoraDoCaixa(2, 'Epson');

    const legado = await new Promise((resolve, reject) => {
      dbEmpresaA.get("SELECT valor FROM configuracoes WHERE chave = 'impressora_cupom'", (err, row) => {
        if (err) return reject(err);
        resolve(row?.valor || null);
      });
    });
    assert.equal(legado, 'Global legado');
    assert.equal((await service.obterImpressoraDoCaixa(1)).impressora_cupom, 'Epson');
    assert.equal((await service.obterImpressoraDoCaixa(2)).impressora_cupom, 'Epson');
  });

  it('resolve o deviceName do caixa atual antes do fallback legado no pipeline de impressão', async () => {
    const codigo = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/fiscalImpressao.js'), 'utf8');
    const contexto = {
      API_URL: '/api',
      console,
      localStorage: {
        getItem: (key) => (key === 'token' ? 'abc-token' : null),
        setItem: () => {},
        removeItem: () => {}
      },
      fetch: async (url, options = {}) => {
        if (String(url).includes('/caixas/7/impressora-cupom')) {
          return {
            ok: true,
            json: async () => ({
              sucesso: true,
              caixa_id: 7,
              impressora_cupom: 'Elgin i8',
              configurada: true,
              deviceName: 'Elgin i8'
            })
          };
        }
        if (String(url).includes('/configuracoes/impressora_cupom')) {
          return {
            ok: true,
            json: async () => ({ sucesso: true, caminho: 'Global legado' })
          };
        }
        return {
          ok: false,
          json: async () => ({})
        };
      },
      window: null,
      globalThis: null,
      document: { querySelector: () => null },
      showNotification: () => {}
    };
    contexto.window = contexto;
    contexto.globalThis = contexto;
    contexto.window.ObterCaixaAtual = {
      obterCaixaAtual: async () => ({ ok: true, caixaId: 7 })
    };

    vm.runInNewContext(codigo, contexto);
    const deviceName = await contexto.obterDeviceNameImpressoraCupom();
    assert.equal(deviceName, 'Elgin i8');
  });

  it('encaminha a impressora resolvida pelo caixa ao fluxo existente de impressão', async () => {
    const fiscal = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/fiscalImpressao.js'), 'utf8');
    const policy = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/cupomPrintPolicy.js'), 'utf8');
    const service = criarImpressoraCaixaService(dbEmpresaA);
    const chamadasImpressao = [];
    const contexto = {
      API_URL: '/api',
      console,
      localStorage: { getItem: (key) => (key === 'token' ? 'token-de-teste' : null) },
      document: { querySelector: () => null },
      fetch: async (url) => {
        if (String(url).includes('/caixas/1/impressora-cupom')) {
          return { ok: true, json: async () => service.resolverImpressoraDoCaixa(1) };
        }
        return { ok: true, json: async () => ({}) };
      },
      electronAPI: {
        fecharComprovante: () => {},
        imprimirDANFESilencioso: async (html, deviceName) => {
          chamadasImpressao.push({ html, deviceName });
          return { sucesso: true };
        }
      },
      ObterCaixaAtual: {
        obterCaixaAtual: async () => ({ ok: true, caixaId: 1 })
      },
      showNotification: () => {}
    };
    contexto.window = contexto;
    contexto.globalThis = contexto;

    await service.salvarImpressoraDoCaixa(1, 'Elgin i8');
    vm.runInNewContext(fiscal, contexto);
    vm.runInNewContext(policy, contexto);
    contexto.CupomPrintPolicy.aplicarCache({ modo: 'AUTOMATICO', nao_fiscal: { modo: 'AUTOMATICO', vias: 1 } });

    const resultado = await contexto.CupomPrintPolicy.aposCupomNaTela({
      tipo: 'NAO_FISCAL',
      html: '<pre>CUPOM</pre>',
      automatico: true,
      reimpressao: true
    });

    assert.equal(resultado.ok, true);
    assert.equal(chamadasImpressao.length, 1);
    assert.equal(chamadasImpressao[0].deviceName, 'Elgin i8');
  });
});

describe('Impressora vinculada ao cadastro do caixa', () => {
  let dbEmpresaA;
  let dbEmpresaB;
  let empresaA;
  let empresaB;

  before(async () => {
    dbEmpresaA = await criarBancoTenant();
    dbEmpresaB = await criarBancoTenant();
    empresaA = criarImpressoraCaixaService(dbEmpresaA);
    empresaB = criarImpressoraCaixaService(dbEmpresaB);
  });

  after(async () => {
    await close(dbEmpresaA);
    await close(dbEmpresaB);
  });

  before(async () => {
    await empresaA.salvarImpressoraDoCaixa(1, null);
    await empresaA.salvarImpressoraDoCaixa(2, null);
    await empresaA.salvarImpressoraDoCaixa(3, null);
    await empresaB.salvarImpressoraDoCaixa(1, null);
  });

  it('permite impressoras independentes nos três caixas da mesma empresa', async () => {
    await empresaA.salvarImpressoraDoCaixa(1, 'Elgin i8');
    await empresaA.salvarImpressoraDoCaixa(2, 'Epson TM-T20');
    await empresaA.salvarImpressoraDoCaixa(3, 'Bematech MP-4200 TH');

    assert.equal((await empresaA.obterImpressoraDoCaixa(1)).impressora_cupom, 'Elgin i8');
    assert.equal((await empresaA.obterImpressoraDoCaixa(2)).impressora_cupom, 'Epson TM-T20');
    assert.equal((await empresaA.obterImpressoraDoCaixa(3)).impressora_cupom, 'Bematech MP-4200 TH');
  });

  it('alterar um caixa não sobrescreve o outro', async () => {
    await empresaA.salvarImpressoraDoCaixa(1, 'Impressora A1');
    await empresaA.salvarImpressoraDoCaixa(2, 'Impressora A2');
    await empresaA.salvarImpressoraDoCaixa(1, 'Impressora A1 revisada');

    assert.equal((await empresaA.obterImpressoraDoCaixa(1)).impressora_cupom, 'Impressora A1 revisada');
    assert.equal((await empresaA.obterImpressoraDoCaixa(2)).impressora_cupom, 'Impressora A2');
  });

  it('isola caixas com o mesmo ID em bancos de empresas diferentes', async () => {
    await empresaA.salvarImpressoraDoCaixa(1, 'Impressora Empresa A');
    await empresaB.salvarImpressoraDoCaixa(1, 'Impressora Empresa B');

    assert.equal((await empresaA.obterImpressoraDoCaixa(1)).impressora_cupom, 'Impressora Empresa A');
    assert.equal((await empresaB.obterImpressoraDoCaixa(1)).impressora_cupom, 'Impressora Empresa B');
  });

  it('limpa somente a impressora do caixa solicitado', async () => {
    await empresaA.salvarImpressoraDoCaixa(1, 'Impressora A1');
    await empresaA.salvarImpressoraDoCaixa(2, 'Impressora A2');
    await empresaA.salvarImpressoraDoCaixa(1, '');

    assert.equal((await empresaA.obterImpressoraDoCaixa(1)).impressora_cupom, null);
    assert.equal((await empresaA.obterImpressoraDoCaixa(2)).impressora_cupom, 'Impressora A2');
  });

  it('valida o caixa existente e preserva a configuração global antiga', async () => {
    await assert.rejects(empresaA.salvarImpressoraDoCaixa(999, 'Impressora inexistente'), {
      status: 404
    });
    const legado = await new Promise((resolve, reject) => {
      dbEmpresaA.get("SELECT valor FROM configuracoes WHERE chave = 'impressora_cupom'", (err, row) => {
        if (err) return reject(err);
        resolve(row?.valor);
      });
    });
    assert.equal(legado, 'Global legado');
  });

  it('PDV envia o bearer token no PUT e a configuração pode ser lida após salvar', async () => {
    const codigo = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/app.js'), 'utf8');
    const chamadas = [];
    const token = jwt.sign({ id: 10, perfil: 'ADMIN' }, JWT_SECRET, { expiresIn: '1m' });
    let autenticacaoPermitida = false;
    function autorizarRequisicao(authorization) {
      return new Promise((resolve) => {
        const req = {
          headers: { authorization },
          method: 'PUT',
          originalUrl: '/api/caixas/1/impressora-cupom',
          query: {}
        };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(body) { resolve({ permitido: false, status: this.statusCode, body }); }
        };
        verificarPermissaoEspecifica('caixa')(req, res, () => {
          resolve({ permitido: true, user: req.user });
        });
      });
    }
    const contexto = {
      window: {},
      document: {},
      API_URL: '/api',
      localStorage: { getItem: (chave) => (chave === 'token' ? token : null) },
      fetch: async (url, options = {}) => {
        chamadas.push({ url, options });
        if (options.method === 'PUT') {
          const autorizacao = await autorizarRequisicao(options.headers.Authorization);
          autenticacaoPermitida = autorizacao.permitido;
          if (!autorizacao.permitido) {
            return { ok: false, status: autorizacao.status, json: async () => autorizacao.body };
          }
          await empresaA.salvarImpressoraDoCaixa(1, JSON.parse(options.body).impressora_cupom);
          return { ok: true, json: async () => ({ sucesso: true }) };
        }
        const resolucao = await empresaA.resolverImpressoraDoCaixa(1);
        return { ok: true, json: async () => resolucao };
      },
      $: () => ({ ready: () => {} })
    };

    vm.runInNewContext(codigo, contexto);
    await contexto.salvarImpressoraDoCaixaPdv(1, 'Elgin i8');

    assert.equal(chamadas[0].url, '/api/caixas/1/impressora-cupom');
    assert.equal(chamadas[0].options.headers.Authorization, `Bearer ${token}`);
    assert.equal(chamadas[0].options.method, 'PUT');
    assert.equal(autenticacaoPermitida, true);
    assert.equal((await empresaA.obterImpressoraDoCaixa(1)).impressora_cupom, 'Elgin i8');

    const leitura = await contexto.fetch('/api/caixas/1/impressora-cupom');
    assert.equal((await leitura.json()).deviceName, 'Elgin i8');
  });

  it('expõe configuração por caixa na API e lista impressoras do Electron local', () => {
    const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/caixas.js'), 'utf8');
    const tela = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/caixas.js'), 'utf8');
    const banco = fs.readFileSync(path.join(__dirname, '../../backend/database.js'), 'utf8');

    assert.match(rota, /router\.get\('\/:id\/impressora-cupom'/);
    assert.match(rota, /router\.put\('\/:id\/impressora-cupom'/);
    assert.match(rota, /salvarImpressoraDoCaixa\(req\.params\.id, req\.body\.impressora_cupom\)/);
    assert.match(tela, /window\.electronAPI\?\.listarImpressoras/);
    assert.match(tela, /\/caixas\/\$\{caixaId\}\/impressora-cupom/);
    assert.match(banco, /ALTER TABLE caixas ADD COLUMN impressora_cupom TEXT/);
    assert.match(banco, /CREATE TABLE IF NOT EXISTS caixas\s*\([\s\S]*?impressora_cupom TEXT/);
  });

  it('migra uma tabela caixas legada sem alterar a configuração global', async () => {
    const diretorioAnterior = process.env.DB_DIR;
    const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-caixas-printer-'));
    process.env.DB_DIR = diretorioTemporario;
    const caminhoBanco = path.join(diretorioTemporario, 'mercadao.db');
    let dbLegado;
    let dbAplicacao;

    try {
      dbLegado = new sqlite3.Database(caminhoBanco);
      await run(dbLegado, `CREATE TABLE caixas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        descricao TEXT,
        ativo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await run(dbLegado, "INSERT INTO caixas (nome) VALUES ('Caixa 01')");
      await close(dbLegado);
      dbLegado = null;

      const caminhoModulo = require.resolve('../../backend/database');
      delete require.cache[caminhoModulo];
      dbAplicacao = require('../../backend/database');
      await new Promise((resolve, reject) => {
        dbAplicacao.whenReady((erro) => (erro ? reject(erro) : resolve()));
      });

      const colunas = await new Promise((resolve, reject) => {
        dbAplicacao.all('PRAGMA table_info(caixas)', (erro, rows) => (erro ? reject(erro) : resolve(rows)));
      });
      assert.ok(colunas.some((coluna) => coluna.name === 'impressora_cupom'));

      const legado = await new Promise((resolve, reject) => {
        dbAplicacao.get("SELECT valor FROM configuracoes WHERE chave = 'impressora_cupom'", (erro, row) => {
          if (erro) return reject(erro);
          resolve(row?.valor || null);
        });
      });
      assert.equal(legado, null);
    } finally {
      if (dbLegado) await close(dbLegado);
      if (dbAplicacao) await close(dbAplicacao);
      delete require.cache[require.resolve('../../backend/database')];
      if (diretorioAnterior == null) delete process.env.DB_DIR;
      else process.env.DB_DIR = diretorioAnterior;
      fs.rmSync(diretorioTemporario, { recursive: true, force: true });
    }
  });
});