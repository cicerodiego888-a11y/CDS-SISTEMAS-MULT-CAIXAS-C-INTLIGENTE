'use strict';

const destaxaKoffiLoader = require('./destaxaKoffiLoader');
const destaxaDllResolver = require('./destaxaDllResolver');
const destaxaLogger = require('./destaxaLogger');
const DestaxaTransacaoOrquestrador = require('./destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('./destaxaTransacaoMockDriver');
const {
  PROVIDER,
  MODO_REAL,
  APLICACAO,
  EXPORTS_OBRIGATORIOS,
  ESTADOS,
  ERROS,
  CODIGO_CLIENT_OK,
  interpretarCodigoResultado,
  criarErro
} = require('./destaxaConstantes');

function obterVersaoAplicacao() {
  const pkg = require('../../../../package.json');
  return String(pkg.version || '').trim();
}

function valorConfig(config, ...chaves) {
  for (const chave of chaves) {
    const valor = config?.[chave];
    if (valor == null) continue;
    if (typeof valor === 'object') continue;
    const texto = String(valor).trim();
    if (!texto) continue;
    if (texto === 'undefined' || texto === 'null' || texto === '[object Object]') continue;
    return texto;
  }
  return null;
}

function montarEntradaClient(config = {}) {
  const versao = obterVersaoAplicacao();
  if (!versao) {
    throw criarErro(
      ERROS.DESTAXA_INVALID_CONFIGURATION,
      'Versão oficial da aplicação não encontrada para iniciaClientDestaxa'
    );
  }

  const pares = [
    ['versao', versao],
    ['aplicacao', APLICACAO]
  ];

  // Destaxa 1.83: estabelecimento / loja / terminal (não existe chave "empresa").
  const estabelecimento = valorConfig(
    config,
    'estabelecimento',
    'empresa_codigo',
    'empresaCodigo'
  );
  const loja = valorConfig(config, 'loja', 'loja_codigo', 'lojaCodigo');
  const terminal = valorConfig(config, 'terminal', 'terminal_codigo', 'terminalCodigo');

  if (estabelecimento) pares.push(['estabelecimento', estabelecimento]);
  if (loja) pares.push(['loja', loja]);
  if (terminal) pares.push(['terminal', terminal]);

  return {
    texto: pares.map(([chave, valor]) => `${chave}=${valor}`).join(';'),
    chaves: pares.map(([chave]) => chave),
    versao
  };
}

function lerCodigoBuffer(buffer) {
  if (!buffer) return '';
  const texto = Buffer.isBuffer(buffer)
    ? buffer.toString('latin1')
    : String(buffer);
  return texto.replace(/\0/g, '').trim().slice(0, 2).toUpperCase();
}

class DestaxaNativeBridge {
  constructor(opcoes = {}) {
    this.config = opcoes.config || {};
    this._loader = opcoes.nativeLoader || destaxaKoffiLoader;
    this._resolver = opcoes.resolver || destaxaDllResolver;
    this._arch = opcoes.arch || process.arch;

    this._dllPath = null;
    this._dllExists = false;
    this._dllLoaded = false;
    this._exportsValid = false;
    this._exports = {
      iniciaClientDestaxa: false,
      iniciaTransacaoDestaxa: false,
      continuaTransacaoDestaxa: false,
      finalizaTransacaoDestaxa: false
    };
    this._nativo = null;
    this._clientInitialized = false;
    this._ultimoCodigoClient = null;
    this._estado = ESTADOS.DLL_NOT_FOUND;
    this._ultimoErro = null;
    this._orquestrador = opcoes.orquestrador || new DestaxaTransacaoOrquestrador();
    this._mockTransacaoDriver = null;
  }

  isLoaded() {
    return this._dllLoaded === true;
  }

  getEstado() {
    return this._estado;
  }

  getDiagnostics() {
    return {
      provider: PROVIDER,
      mode: MODO_REAL,
      processArch: this._arch,
      dllArch: destaxaDllResolver.rotuloArquiteturaDll(this._arch),
      dllPath: this._dllPath,
      dllExists: this._dllExists,
      dllLoaded: this._dllLoaded,
      exportsValid: this._exportsValid,
      exports: { ...this._exports },
      clientInitialized: this._clientInitialized,
      clientResultCode: this._ultimoCodigoClient,
      estado: this._estado,
      tefDisponivel: this._estado === ESTADOS.CLIENT_INITIALIZED,
      ultimoCodigoClient: this._ultimoCodigoClient,
      ultimoErro: this._ultimoErro
        ? {
          codigo: this._ultimoErro.codigo,
          mensagem: this._ultimoErro.mensagem,
          windows: this._ultimoErro.windows || null
        }
        : null
    };
  }

  load() {
    this.unload();

    const resolucao = this._resolver.resolverDll(this.config, { arch: this._arch });
    this._dllPath = resolucao.dllPath || null;
    this._dllExists = resolucao.dllExists === true;

    destaxaLogger.registrar('dll.resolve', {
      processArch: this._arch,
      dllPath: this._dllPath,
      dllExists: this._dllExists,
      origem: resolucao.origem || null,
      codigo: resolucao.codigo || null
    });

    if (!this._dllExists) {
      this._estado = ESTADOS.DLL_NOT_FOUND;
      this._ultimoErro = {
        codigo: resolucao.codigo || ERROS.DESTAXA_DLL_NOT_FOUND,
        mensagem: resolucao.mensagem
      };
      return {
        sucesso: false,
        codigo: this._ultimoErro.codigo,
        mensagem: resolucao.mensagem,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    this._estado = ESTADOS.DLL_FOUND;

    try {
      this._nativo = this._loader.carregarBiblioteca(this._dllPath);
    } catch (error) {
      this._estado = ESTADOS.DLL_FOUND;
      this._ultimoErro = {
        codigo: error.codigo || ERROS.DESTAXA_DLL_LOAD_FAILED,
        mensagem: error.message,
        windows: error.detalhes?.windows || null
      };
      destaxaLogger.registrar('dll.load.failed', {
        processArch: this._arch,
        dllPath: this._dllPath,
        codigo: this._ultimoErro.codigo,
        windows: this._ultimoErro.windows
      });
      return {
        sucesso: false,
        codigo: this._ultimoErro.codigo,
        mensagem: error.message,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    this._dllLoaded = true;
    this._estado = ESTADOS.DLL_LOADED;

    for (const nome of EXPORTS_OBRIGATORIOS) {
      this._exports[nome] = typeof this._nativo.exports?.[nome] === 'function';
    }

    const ausentes = EXPORTS_OBRIGATORIOS.filter((nome) => this._exports[nome] !== true);
    if (ausentes.length) {
      this._exportsValid = false;
      this._ultimoErro = {
        codigo: ERROS.DESTAXA_EXPORT_MISSING,
        mensagem: `Exports Destaxa ausentes: ${ausentes.join(', ')}`
      };
      destaxaLogger.registrar('dll.exports.missing', {
        dllPath: this._dllPath,
        exports: this._exports
      });
      this.unload();
      this._dllExists = true;
      this._dllPath = resolucao.dllPath;
      this._estado = ESTADOS.DLL_FOUND;
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_EXPORT_MISSING,
        mensagem: this._ultimoErro.mensagem,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    this._exportsValid = true;
    this._estado = ESTADOS.EXPORTS_VALID;
    this._clientInitialized = false;
    this._ultimoErro = null;

    destaxaLogger.registrar('dll.loaded', {
      processArch: this._arch,
      dllPath: this._dllPath,
      dllExists: true,
      dllLoaded: true,
      exports: this._exports,
      estado: this._estado
    });

    return {
      sucesso: true,
      estado: this._estado,
      diagnostico: this.getDiagnostics()
    };
  }

  iniciarClient(config = {}) {
    const cfg = { ...this.config, ...config };

    if (!this._dllLoaded) {
      const carregado = this.load();
      if (!carregado.sucesso) {
        return carregado;
      }
    }

    let entrada;
    try {
      entrada = montarEntradaClient(cfg);
    } catch (error) {
      this._estado = ESTADOS.CLIENT_ERROR;
      this._ultimoErro = { codigo: error.codigo || ERROS.DESTAXA_INVALID_CONFIGURATION, mensagem: error.message };
      return {
        sucesso: false,
        codigo: this._ultimoErro.codigo,
        mensagem: error.message,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    const fn = this._nativo?.exports?.iniciaClientDestaxa;
    if (typeof fn !== 'function') {
      this._estado = ESTADOS.CLIENT_ERROR;
      this._ultimoErro = {
        codigo: ERROS.DESTAXA_EXPORT_MISSING,
        mensagem: 'Export iniciaClientDestaxa não disponível'
      };
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_EXPORT_MISSING,
        mensagem: this._ultimoErro.mensagem,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    const resultadoBuf = Buffer.alloc(3);
    const entradaBuf = Buffer.alloc(Math.max(entrada.texto.length + 1, 1));
    entradaBuf.write(entrada.texto, 0, 'latin1');

    destaxaLogger.registrar('client.init.start', {
      processArch: this._arch,
      dllPath: this._dllPath,
      chavesEntrada: entrada.chaves,
      tamanhoEntrada: entrada.texto.length
    });

    const inicio = process.hrtime.bigint();
    try {
      fn(resultadoBuf, entradaBuf, entrada.texto.length);
    } catch (error) {
      this._clientInitialized = false;
      this._estado = ESTADOS.CLIENT_ERROR;
      this._ultimoErro = {
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: error.message
      };
      destaxaLogger.registrar('client.init.exception', {
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        duracaoMs: Number(process.hrtime.bigint() - inicio) / 1e6
      });
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: error.message,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    const codigo = lerCodigoBuffer(resultadoBuf) || 'FF';
    const interpretado = interpretarCodigoResultado(codigo);
    this._ultimoCodigoClient = codigo;

    if (interpretado.sucesso) {
      this._clientInitialized = true;
      this._estado = ESTADOS.CLIENT_INITIALIZED;
      this._ultimoErro = null;
    } else {
      this._clientInitialized = false;
      this._estado = ESTADOS.CLIENT_ERROR;
      this._ultimoErro = {
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: `iniciaClientDestaxa retornou ${codigo} — ${interpretado.descricao}`
      };
    }

    destaxaLogger.registrar('client.init.result', {
      processArch: this._arch,
      dllPath: this._dllPath,
      codigo,
      sucesso: interpretado.sucesso,
      duracaoMs,
      estado: this._estado
    });
    destaxaLogger.registrarBlocoReal(this.getDiagnostics(), {
      iniciaClientExecutado: true,
      codigoDestaxa: codigo,
      duracaoMs
    });

    return {
      sucesso: interpretado.sucesso,
      codigo: interpretado.sucesso ? CODIGO_CLIENT_OK : ERROS.DESTAXA_CLIENT_INIT_FAILED,
      codigoDestaxa: codigo,
      descricaoCodigo: interpretado.descricao,
      mensagem: interpretado.sucesso
        ? 'Client Destaxa inicializado'
        : `iniciaClientDestaxa retornou ${codigo} — ${interpretado.descricao}`,
      estado: this._estado,
      duracaoMs,
      entrada: entrada.texto,
      tamanhoEntrada: entrada.texto.length,
      diagnostico: this.getDiagnostics()
    };
  }

  configurarDriverTransacaoMock(passos = []) {
    this._mockTransacaoDriver = new DestaxaTransacaoMockDriver(passos);
    this._orquestrador.definirDriver(this._mockTransacaoDriver);
    return this._mockTransacaoDriver;
  }

  limparTransacaoDestaxa() {
    this._orquestrador.reset();
    this._mockTransacaoDriver = null;
    this._orquestrador.definirDriver(null);
  }

  getTransacaoContexto() {
    return this._orquestrador.getContexto();
  }

  getOrquestradorTransacao() {
    return this._orquestrador;
  }

  /**
   * Protocolo Destaxa — nesta sprint só executa via driver mock injetado.
   * Não chama iniciaTransacaoDestaxa na DLL real.
   */
  iniciarTransacaoDestaxa(operacao, camposEntrada = {}) {
    return this._orquestrador.iniciarTransacao(operacao, camposEntrada);
  }

  continuarTransacaoDestaxa(respostaEntrada = {}) {
    return this._orquestrador.continuarTransacao(respostaEntrada);
  }

  finalizarTransacaoDestaxa(confirmacao) {
    return this._orquestrador.finalizarTransacao(confirmacao);
  }

  unload() {
    this.limparTransacaoDestaxa();
    if (this._nativo && typeof this._nativo.unload === 'function') {
      this._nativo.unload();
    }
    this._nativo = null;
    this._dllLoaded = false;
    this._exportsValid = false;
    this._clientInitialized = false;
    this._ultimoCodigoClient = null;
    this._exports = {
      iniciaClientDestaxa: false,
      iniciaTransacaoDestaxa: false,
      continuaTransacaoDestaxa: false,
      finalizaTransacaoDestaxa: false
    };
    if (this._dllExists) {
      this._estado = ESTADOS.DLL_FOUND;
    } else {
      this._estado = ESTADOS.DLL_NOT_FOUND;
    }
  }
}

module.exports = DestaxaNativeBridge;
module.exports.montarEntradaClient = montarEntradaClient;
module.exports.obterVersaoAplicacao = obterVersaoAplicacao;
module.exports.lerCodigoBuffer = lerCodigoBuffer;
