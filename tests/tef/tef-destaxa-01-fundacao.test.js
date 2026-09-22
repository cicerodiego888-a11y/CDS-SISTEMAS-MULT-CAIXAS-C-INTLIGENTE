/**
 * TEF-DESTAXA-01 — Fundação da integração Destaxa (sem transação).
 * Executar: node tests/tef/tef-destaxa-01-fundacao.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tefFactory = require('../../backend/services/tef/tefFactory');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const destaxaDllResolver = require('../../backend/services/tef/destaxa/destaxaDllResolver');
const {
  PROVIDER,
  ESTADOS,
  ERROS,
  EXPORTS_OBRIGATORIOS
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

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
      console.error(`         ${error.stack || error.message}`);
    });
}

function criarLoaderMock(codigoClient = '00', exportsOverride = null) {
  const presentes = exportsOverride || {
    iniciaClientDestaxa: true,
    iniciaTransacaoDestaxa: true,
    continuaTransacaoDestaxa: true,
    finalizaTransacaoDestaxa: true
  };

  return {
    carregarBiblioteca() {
      const exports = {};
      for (const nome of EXPORTS_OBRIGATORIOS) {
        if (!presentes[nome]) {
          exports[nome] = null;
          continue;
        }
        if (nome === 'iniciaClientDestaxa') {
          exports[nome] = (resultadoBuf) => {
            Buffer.from(String(codigoClient)).copy(resultadoBuf);
          };
        } else {
          exports[nome] = () => {
            throw new Error(`${nome} não deve ser executada na sprint TEF-DESTAXA-01`);
          };
        }
      }
      return {
        exports,
        unload() {}
      };
    }
  };
}

function criarResolverFixo(dllPath, exists = true) {
  return {
    rotuloArquiteturaDll: destaxaDllResolver.rotuloArquiteturaDll,
    resolverDll() {
      return {
        sucesso: exists,
        dllExists: exists,
        dllPath,
        processArch: process.arch,
        dllArch: destaxaDllResolver.rotuloArquiteturaDll(process.arch),
        origem: 'teste',
        codigo: exists ? null : ERROS.DESTAXA_DLL_NOT_FOUND,
        mensagem: exists ? null : 'DLL Destaxa não encontrada'
      };
    }
  };
}

async function executar() {
  console.log('=== TESTES — TEF-DESTAXA-01 FUNDAÇÃO ===\n');

  await test('TESTE 1 — provider DESTAXA reconhecido e factory cria DestaxaRealAdapter', () => {
    assert.strictEqual(tefFactory.provedorReconhecido(PROVIDER), true);
    assert.ok(tefFactory.PROVEDORES.includes('destaxa'));
    assert.ok(tefFactory.PROVEDORES.includes('sitef'));
    assert.ok(tefFactory.PROVEDORES.includes('paygo'));
    assert.ok(tefFactory.PROVEDORES.includes('cielo'));
    assert.ok(tefFactory.PROVEDORES.includes('stone'));
    assert.ok(tefFactory.PROVEDORES.includes('rede'));
    assert.ok(tefFactory.PROVEDORES.includes('getnet'));

    const adapter = tefFactory.criarAdapter({
      provedor: 'DESTAXA',
      ambiente: 'HOMOLOGACAO'
    });
    assert.ok(adapter instanceof DestaxaRealAdapter);
    assert.strictEqual(adapter.modo, 'real');
    assert.strictEqual(adapter.nome, 'Destaxa');
  });

  await test('TESTE 2 — DESTAXA + SIMULACAO não carrega DLL', () => {
    const adapter = tefFactory.criarAdapter({
      provedor: 'destaxa',
      ambiente: 'SIMULACAO'
    });
    assert.ok(!(adapter instanceof DestaxaRealAdapter));
    assert.strictEqual(adapter.modo, 'simulacao');
    assert.strictEqual(adapter.nome, 'Destaxa');
    assert.strictEqual(adapter.bridge, undefined);
  });

  await test('TESTE 3 — DLL inexistente retorna DESTAXA_DLL_NOT_FOUND sem crash', () => {
    const caminhoInvalido = path.join(os.tmpdir(), `destaxa-nao-existe-${Date.now()}`, 'libdll-integracao-tef.dll');
    const bridge = new DestaxaNativeBridge({
      config: { sdkPath: caminhoInvalido },
      nativeLoader: {
        carregarBiblioteca() {
          throw new Error('não deveria carregar');
        }
      }
    });

    let resultado;
    assert.doesNotThrow(() => {
      resultado = bridge.load();
    });
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.codigo, ERROS.DESTAXA_DLL_NOT_FOUND);
    assert.strictEqual(bridge.getEstado(), ESTADOS.DLL_NOT_FOUND);
    assert.strictEqual(bridge.isLoaded(), false);
    assert.strictEqual(bridge.getDiagnostics().dllExists, false);
    assert.strictEqual(bridge.getDiagnostics().dllLoaded, false);
    assert.strictEqual(bridge.getDiagnostics().clientInitialized, false);
  });

  await test('TESTE 4 — exports obrigatórios validados via loader mockado', () => {
    const dllFake = path.join(os.tmpdir(), 'libdll-integracao-tef.dll');
    const bridge = new DestaxaNativeBridge({
      config: {},
      nativeLoader: criarLoaderMock('00'),
      resolver: criarResolverFixo(dllFake, true)
    });
    const resultado = bridge.load();
    assert.strictEqual(resultado.sucesso, true);
    const diag = bridge.getDiagnostics();
    assert.strictEqual(diag.dllLoaded, true);
    assert.strictEqual(diag.exportsValid, true);
    for (const nome of EXPORTS_OBRIGATORIOS) {
      assert.strictEqual(diag.exports[nome], true, `export ${nome}`);
    }
    assert.strictEqual(diag.estado, ESTADOS.EXPORTS_VALID);
    assert.strictEqual(diag.clientInitialized, false);
  });

  await test('TESTE 5 — iniciaClientDestaxa 00 → CLIENT_INITIALIZED', () => {
    const dllFake = path.join(os.tmpdir(), 'libdll-integracao-tef.dll');
    const bridge = new DestaxaNativeBridge({
      config: { empresa_codigo: '001', loja_codigo: '0001', terminal_codigo: 'PDV01' },
      nativeLoader: criarLoaderMock('00'),
      resolver: criarResolverFixo(dllFake, true)
    });
    const resultado = bridge.iniciarClient();
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.codigoDestaxa, '00');
    assert.strictEqual(resultado.estado, ESTADOS.CLIENT_INITIALIZED);
    assert.strictEqual(bridge.getDiagnostics().clientInitialized, true);
  });

  await test('TESTE 6 — iniciaClientDestaxa 05 → CLIENT_ERROR', () => {
    const dllFake = path.join(os.tmpdir(), 'libdll-integracao-tef.dll');
    const bridge = new DestaxaNativeBridge({
      config: {},
      nativeLoader: criarLoaderMock('05'),
      resolver: criarResolverFixo(dllFake, true)
    });
    const resultado = bridge.iniciarClient();
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.codigo, ERROS.DESTAXA_CLIENT_INIT_FAILED);
    assert.strictEqual(resultado.codigoDestaxa, '05');
    assert.strictEqual(resultado.estado, ESTADOS.CLIENT_ERROR);
    assert.strictEqual(bridge.getDiagnostics().clientInitialized, false);
  });

  await test('TESTE 7 — arquitetura x64 → DLL x64 e ia32 → DLL x86', () => {
    const raiz = path.join(os.tmpdir(), `destaxa-arch-${Date.now()}`);
    const x64 = path.join(raiz, 'resources', 'tef', 'destaxa', 'win-x64', 'libdll-integracao-tef.dll');
    const x86 = path.join(raiz, 'resources', 'tef', 'destaxa', 'win-ia32', 'libdll-integracao-tef.dll');
    fs.mkdirSync(path.dirname(x64), { recursive: true });
    fs.mkdirSync(path.dirname(x86), { recursive: true });
    fs.writeFileSync(x64, 'x64');
    fs.writeFileSync(x86, 'x86');

    const r64 = destaxaDllResolver.resolverDll({}, { arch: 'x64', raizProjeto: raiz });
    const r86 = destaxaDllResolver.resolverDll({}, { arch: 'ia32', raizProjeto: raiz });

    assert.strictEqual(r64.dllExists, true);
    assert.strictEqual(r64.dllArch, 'x64');
    assert.strictEqual(path.normalize(r64.dllPath), path.normalize(x64));

    assert.strictEqual(r86.dllExists, true);
    assert.strictEqual(r86.dllArch, 'x86');
    assert.strictEqual(path.normalize(r86.dllPath), path.normalize(x86));

    fs.rmSync(raiz, { recursive: true, force: true });
  });

  await test('DestaxaRealAdapter não executa pagamento nesta sprint', async () => {
    const dllFake = path.join(os.tmpdir(), 'libdll-integracao-tef.dll');
    const adapter = new DestaxaRealAdapter({}, {
      nativeLoader: criarLoaderMock('00'),
      resolver: criarResolverFixo(dllFake, true)
    });
    const r = await adapter.autorizarPagamento();
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.codigo, 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA');
  });

  await test('provedores existentes continuam reconhecidos', () => {
    const sitef = tefFactory.criarAdapter({ provedor: 'sitef', ambiente: 'simulacao' });
    const paygo = tefFactory.criarAdapter({ provedor: 'paygo', ambiente: 'simulacao' });
    const cielo = tefFactory.criarAdapter({ provedor: 'cielo', ambiente: 'simulacao' });
    assert.strictEqual(sitef.nome, 'CliSiTef');
    assert.strictEqual(paygo.nome, 'PayGo');
    assert.strictEqual(cielo.nome, 'Cielo');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou`);
  if (falhou > 0) {
    process.exit(1);
  }
}

executar();
