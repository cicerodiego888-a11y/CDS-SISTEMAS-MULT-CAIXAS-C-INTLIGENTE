'use strict';

/**
 * Sprint 2B — Consulta CNPJ (BrasilAPI) + autofill fornecedor.
 * Executar: node --test tests/cadastro/sprint2b-consulta-cnpj.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '../..');
const BrasilApiCnpjProvider = require('../../backend/services/cadastro/providers/BrasilApiCnpjProvider');
const { mapBrasilApiParaDto } = BrasilApiCnpjProvider;
const ConsultaCnpjService = require('../../backend/services/cadastro/ConsultaCnpjService');
const { limparCacheConsultaCnpj } = ConsultaCnpjService;
const { CODIGOS } = require('../../backend/services/cadastro/cnpjConsultaErros');
const EmpresaCnpjDTO = require('../../backend/services/cadastro/contracts/EmpresaCnpjDTO');

const CNPJ = '09591661000103';
const CNPJ_MASCARA = '09.591.661/0001-03';

const RAW_BRASILAPI = {
  cnpj: CNPJ,
  razao_social: 'EMPRESA TESTE LTDA',
  nome_fantasia: 'EMPRESA TESTE',
  descricao_situacao_cadastral: 'ATIVA',
  situacao_cadastral: 2,
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'EXEMPLO',
  numero: '100',
  complemento: 'SALA 1',
  bairro: 'CENTRO',
  cep: '60000000',
  municipio: 'FORTALEZA',
  uf: 'CE',
  codigo_municipio: 1389,
  ddd_telefone_1: '8533334444',
  email: null
};

function httpMock(impl) {
  return { get: impl };
}

function axiosError(status, code) {
  const err = new Error('http error');
  if (code) err.code = code;
  if (status) err.response = { status, data: {} };
  return err;
}

describe('Sprint 2B — BrasilApiCnpjProvider', () => {
  it('mapeia resposta válida para EmpresaCnpjDTO', () => {
    const dto = mapBrasilApiParaDto(RAW_BRASILAPI);
    assert.ok(dto instanceof EmpresaCnpjDTO);
    assert.equal(dto.cnpj, CNPJ);
    assert.equal(dto.razaoSocial, 'EMPRESA TESTE LTDA');
    assert.equal(dto.nomeFantasia, 'EMPRESA TESTE');
    assert.equal(dto.situacaoCadastral, 'ATIVA');
    assert.equal(dto.logradouro, 'RUA EXEMPLO');
    assert.equal(dto.numero, '100');
    assert.equal(dto.bairro, 'CENTRO');
    assert.equal(dto.municipio, 'FORTALEZA');
    assert.equal(dto.uf, 'CE');
    assert.equal(dto.cep, '60000000');
    assert.equal(dto.telefone, '8533334444');
    assert.equal(dto.inscricaoEstadual, null);
    assert.equal(dto.email, null);
  });

  it('consulta envia CNPJ só com dígitos e User-Agent', async () => {
    let urlChamada = '';
    let headers = {};
    const provider = new BrasilApiCnpjProvider({
      http: httpMock(async (url, opts) => {
        urlChamada = url;
        headers = opts.headers || {};
        return { data: RAW_BRASILAPI, status: 200 };
      }),
      timeoutMs: 10000
    });

    const dto = await provider.consultar(CNPJ_MASCARA);
    assert.ok(urlChamada.endsWith(`/${CNPJ}`));
    assert.equal(urlChamada.includes(CNPJ_MASCARA), false);
    assert.match(urlChamada, new RegExp(`/cnpj/v1/${CNPJ}$`));
    assert.match(headers['User-Agent'], /CDS-Sistemas/);
    assert.equal(dto.razaoSocial, 'EMPRESA TESTE LTDA');
  });

  it('404 → NAO_ENCONTRADO', async () => {
    const provider = new BrasilApiCnpjProvider({
      http: httpMock(async () => { throw axiosError(404); })
    });
    await assert.rejects(() => provider.consultar(CNPJ), (err) => {
      assert.equal(err.code, CODIGOS.NAO_ENCONTRADO);
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it('429 → RATE_LIMIT', async () => {
    const provider = new BrasilApiCnpjProvider({
      http: httpMock(async () => { throw axiosError(429); })
    });
    await assert.rejects(() => provider.consultar(CNPJ), (err) => {
      assert.equal(err.code, CODIGOS.RATE_LIMIT);
      assert.equal(err.statusCode, 429);
      return true;
    });
  });

  it('timeout → TIMEOUT', async () => {
    const provider = new BrasilApiCnpjProvider({
      http: httpMock(async () => { throw axiosError(null, 'ECONNABORTED'); })
    });
    await assert.rejects(() => provider.consultar(CNPJ), (err) => {
      assert.equal(err.code, CODIGOS.TIMEOUT);
      return true;
    });
  });

  it('500 → INDISPONIVEL', async () => {
    const provider = new BrasilApiCnpjProvider({
      http: httpMock(async () => { throw axiosError(500); })
    });
    await assert.rejects(() => provider.consultar(CNPJ), (err) => {
      assert.equal(err.code, CODIGOS.INDISPONIVEL);
      return true;
    });
  });

  it('resposta inválida → ERRO_PROVIDER', async () => {
    const provider = new BrasilApiCnpjProvider({
      http: httpMock(async () => ({ data: null, status: 200 }))
    });
    await assert.rejects(() => provider.consultar(CNPJ), (err) => {
      assert.equal(err.code, CODIGOS.ERRO_PROVIDER);
      return true;
    });
  });
});

describe('Sprint 2B — ConsultaCnpjService', () => {
  beforeEach(() => limparCacheConsultaCnpj());
  afterEach(() => limparCacheConsultaCnpj());

  it('CNPJ mascarado normaliza e consulta provider', async () => {
    let chamado = '';
    const service = new ConsultaCnpjService({
      provider: {
        async consultar(cnpj) {
          chamado = cnpj;
          return EmpresaCnpjDTO.create({ cnpj, razaoSocial: 'X' });
        }
      }
    });
    const r = await service.consultar(CNPJ_MASCARA);
    assert.equal(chamado, CNPJ);
    assert.equal(r.data.cnpj, CNPJ);
    assert.equal(r.fromCache, false);
  });

  it('CNPJ inválido não chama provider', async () => {
    let chamadas = 0;
    const service = new ConsultaCnpjService({
      provider: {
        async consultar() {
          chamadas += 1;
          return EmpresaCnpjDTO.create({ cnpj: CNPJ });
        }
      }
    });
    await assert.rejects(() => service.consultar('123'), (err) => {
      assert.equal(err.code, CODIGOS.CNPJ_INVALIDO);
      return true;
    });
    assert.equal(chamadas, 0);
  });

  it('cache evita segunda chamada ao provider', async () => {
    let chamadas = 0;
    const service = new ConsultaCnpjService({
      provider: {
        async consultar(cnpj) {
          chamadas += 1;
          return EmpresaCnpjDTO.create({ cnpj, razaoSocial: 'CACHE' });
        }
      }
    });
    await service.consultar(CNPJ);
    const r2 = await service.consultar(CNPJ_MASCARA);
    assert.equal(chamadas, 1);
    assert.equal(r2.fromCache, true);
    assert.equal(r2.data.razaoSocial, 'CACHE');
  });

  it('timeout faz 1 retry; 404 e 429 não fazem retry', async () => {
    let timeouts = 0;
    const svcTimeout = new ConsultaCnpjService({
      usarCache: false,
      provider: {
        async consultar() {
          timeouts += 1;
          const err = new Error('t');
          err.code = CODIGOS.TIMEOUT;
          err.statusCode = 504;
          throw err;
        }
      }
    });
    await assert.rejects(() => svcTimeout.consultar(CNPJ));
    assert.equal(timeouts, 2);

    let notFound = 0;
    const svc404 = new ConsultaCnpjService({
      usarCache: false,
      provider: {
        async consultar() {
          notFound += 1;
          const err = new Error('nf');
          err.code = CODIGOS.NAO_ENCONTRADO;
          err.statusCode = 404;
          throw err;
        }
      }
    });
    await assert.rejects(() => svc404.consultar(CNPJ));
    assert.equal(notFound, 1);

    let rate = 0;
    const svc429 = new ConsultaCnpjService({
      usarCache: false,
      provider: {
        async consultar() {
          rate += 1;
          const err = new Error('rl');
          err.code = CODIGOS.RATE_LIMIT;
          err.statusCode = 429;
          throw err;
        }
      }
    });
    await assert.rejects(() => svc429.consultar(CNPJ));
    assert.equal(rate, 1);
  });

  it('retorno é contrato EmpresaCnpjDTO (toJSON)', async () => {
    const service = new ConsultaCnpjService({
      usarCache: false,
      provider: {
        async consultar(cnpj) {
          return EmpresaCnpjDTO.create({ cnpj, razaoSocial: 'Y', municipio: 'Z' });
        }
      }
    });
    const r = await service.consultar(CNPJ);
    assert.equal(r.data.razaoSocial, 'Y');
    assert.equal(r.data.municipio, 'Z');
    assert.ok(!('razao_social' in r.data));
  });
});

describe('Sprint 2B — endpoint /api/consulta-cnpj', () => {
  beforeEach(() => limparCacheConsultaCnpj());
  afterEach(() => limparCacheConsultaCnpj());

  it('GET autenticado retorna DTO (provider mockado via service inject no router test local)', async () => {
    const ConsultaCnpjServiceLocal = require('../../backend/services/cadastro/ConsultaCnpjService');
    const service = new ConsultaCnpjServiceLocal({
      provider: {
        async consultar(cnpj) {
          return EmpresaCnpjDTO.create({
            cnpj,
            razaoSocial: 'EMPRESA TESTE LTDA',
            municipio: 'FORTALEZA',
            uf: 'CE'
          });
        }
      }
    });

    const app = express();
    app.get('/api/consulta-cnpj/:cnpj', async (req, res) => {
      try {
        const resultado = await service.consultar(req.params.cnpj);
        res.json({ success: true, data: resultado.data, fromCache: resultado.fromCache });
      } catch (err) {
        res.status(err.statusCode || 500).json({
          success: false,
          error: err.message,
          code: err.code
        });
      }
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;

    const ok = await fetch(`http://127.0.0.1:${port}/api/consulta-cnpj/${CNPJ}`);
    const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.cnpj, CNPJ);
    assert.equal(body.data.razaoSocial, 'EMPRESA TESTE LTDA');

    const bad = await fetch(`http://127.0.0.1:${port}/api/consulta-cnpj/123`);
    const badBody = await bad.json();
    assert.equal(bad.status, 400);
    assert.equal(badBody.code, CODIGOS.CNPJ_INVALIDO);

    await new Promise((resolve) => server.close(resolve));
  });

  it('server.js registra rota autenticada; UI tem botão Consultar CNPJ', () => {
    const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fornecedores.js'), 'utf8');
    assert.match(server, /consulta-cnpj/);
    assert.match(server, /verificarToken,\s*consultaCnpjRoutes/);
    assert.match(ui, /consultarCnpjFornecedor/);
    assert.match(ui, /btnConsultarCnpjFornecedor/);
    assert.match(ui, /\/api\/consulta-cnpj\//);
  });
});
