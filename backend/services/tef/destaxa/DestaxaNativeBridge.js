'use strict';

const destaxaKoffiLoader = require('./destaxaKoffiLoader');
const destaxaDllResolver = require('./destaxaDllResolver');
const destaxaLogger = require('./destaxaLogger');
const DestaxaTransacaoOrquestrador = require('./destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('./destaxaTransacaoMockDriver');
const { projetarEntradaIniciaClient } = require('./destaxaMapeamentoTerminal');
const {
  PROVIDER,
  MODO_REAL,
  APLICACAO,
  EXPORTS_OBRIGATORIOS,
  ESTADOS,
  ERROS,
  CODIGO_CLIENT_OK,
  BUFFER_RESULTADO_BYTES,
  BUFFER_SAIDA_BYTES_SUGERIDO,
  ENCODING_DESTAXA,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada,
  interpretarCodigoResultado,
  criarErro
} = require('./destaxaConstantes');

function obterVersaoAplicacao() {
  const pkg = require('../../../../package.json');
  return String(pkg.version || '').trim();
}

function montarEntradaClient(config = {}) {
  const versao = obterVersaoAplicacao();
  if (!versao) {
    throw criarErro(
      ERROS.DESTAXA_INVALID_CONFIGURATION,
      'Versão oficial da aplicação não encontrada para iniciaClientDestaxa'
    );
  }

  // Destaxa 1.83: estabelecimento/loja/terminal opcionais; pdv/caixa CDS nunca entram.
  // MRT-28: parâmetros de log oficiais anexados na mesma string `entrada`.
  const projecao = projetarEntradaIniciaClient(config, { versao, aplicacao: APLICACAO });
  return {
    texto: projecao.texto,
    chaves: projecao.chaves,
    versao,
    incluiPdvOuCaixa: projecao.incluiPdvOuCaixa === true,
    camposLogDll: projecao.camposLogDll || null
  };
}

function lerCodigoBuffer(buffer) {
  if (!buffer) return '';
  const texto = Buffer.isBuffer(buffer)
    ? buffer.toString('latin1')
    : String(buffer);
  return texto.replace(/\0/g, '').trim().slice(0, 2).toUpperCase();
}

function montarBufferEntrada(texto) {
  const bytes = Buffer.from(String(texto || ''), ENCODING_DESTAXA);
  const buffer = Buffer.alloc(bytes.length + 1);
  bytes.copy(buffer);
  return { buffer, tamanho: bytes.length };
}

function lerSaidaBuffer(buffer, tamanhoInformado) {
  const fimNulo = buffer.indexOf(0);
  const limite = Number.isInteger(tamanhoInformado) && tamanhoInformado > 0 && tamanhoInformado <= buffer.length
    ? tamanhoInformado
    : (fimNulo >= 0 ? fimNulo : buffer.length);
  return buffer.toString(ENCODING_DESTAXA, 0, limite).replace(/\0[\s\S]*$/, '').trim();
}

/**
 * Driver transacional sobre os exports reais da DLL (contrato docs/04):
 * resultado 2 bytes; saida sugerida 99000 bytes; tamanho_saida int* (entrada/saída).
 */
function criarDriverTransacaoNativo(exportsNativos, opcoes = {}) {
  const capacidadeSaida = opcoes.capacidadeSaida || BUFFER_SAIDA_BYTES_SUGERIDO;

  function exigirExport(nome) {
    const fn = exportsNativos?.[nome];
    if (typeof fn !== 'function') {
      throw criarErro(ERROS.DESTAXA_EXPORT_MISSING, `Export ${nome} não disponível`);
    }
    return fn;
  }

  function chamarComSaida(nome, montarArgs) {
    const fn = exigirExport(nome);
    const resultado = Buffer.alloc(BUFFER_RESULTADO_BYTES + 1);
    const saida = Buffer.alloc(capacidadeSaida);
    const tamanhoSaida = new Int32Array([capacidadeSaida]);
    fn(...montarArgs(resultado, saida, tamanhoSaida));
    return {
      codigo: lerCodigoBuffer(resultado) || 'FF',
      saida: lerSaidaBuffer(saida, tamanhoSaida[0]),
      tamanhoSaida: tamanhoSaida[0]
    };
  }

  return {
    nome: 'native',
    capacidadeSaida,
    iniciaTransacaoDestaxa(operacao, entrada) {
      const e = montarBufferEntrada(entrada);
      // MRT-31/32 — BEGIN/END best-effort; exceção nativa sempre repropagada
      const { envolverChamadaInstrumentada } = require('./destaxaFluxoInstrumentacao');
      return envolverChamadaInstrumentada({
        exportNome: 'iniciaTransacaoDestaxa',
        contexto: { provedor: 'destaxa' },
        extraBegin: {
          operacao: String(operacao || ''),
          tamanhoEntrada: e.tamanho
        },
        fn: () => chamarComSaida('iniciaTransacaoDestaxa', (resultado, saida, tamanhoSaida) => [
          resultado, String(operacao), e.buffer, e.tamanho, saida, tamanhoSaida
        ])
      });
    },
    continuaTransacaoDestaxa(entrada) {
      const e = montarBufferEntrada(entrada);
      return chamarComSaida('continuaTransacaoDestaxa', (resultado, saida, tamanhoSaida) => [
        resultado, e.buffer, e.tamanho, saida, tamanhoSaida
      ]);
    },
    finalizaTransacaoDestaxa(confirmacao) {
      const fn = exigirExport('finalizaTransacaoDestaxa');
      const resultado = Buffer.alloc(BUFFER_RESULTADO_BYTES + 1);
      fn(resultado, Number(confirmacao));
      return { codigo: lerCodigoBuffer(resultado) || 'FF', saida: '', tamanhoSaida: 0 };
    }
  };
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
      tefDisponivel: false,
      transactionCommunicationValidated: false,
      authorizationAvailable: false,
      ultimoCodigoClient: this._ultimoCodigoClient,
      ultimoErro: this._ultimoErro
        ? {
          codigo: this._ultimoErro.codigo,
          mensagem: this._ultimoErro.mensagem,
          windows: this._ultimoErro.windows || null,
          classeDiagnostico: this._ultimoErro.classeDiagnostico || null
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

    if (!resolucao.sucesso || !this._dllExists) {
      const codigo = resolucao.codigo || ERROS.DESTAXA_DLL_NOT_FOUND;
      const classeDiagnostico = codigo === ERROS.DESTAXA_ARCHITECTURE_MISMATCH
        ? 'ARQUITETURA_INCOMPATIVEL'
        : codigo === ERROS.DESTAXA_ARCHITECTURE_NOT_SUPPORTED
          ? 'ARQUITETURA_PROCESSO_NAO_SUPORTADA'
          : 'DLL_AUSENTE';
      this._estado = this._dllExists ? ESTADOS.DLL_FOUND : ESTADOS.DLL_NOT_FOUND;
      this._ultimoErro = {
        codigo,
        mensagem: resolucao.mensagem || 'DLL Destaxa indisponível',
        classeDiagnostico
      };
      return {
        sucesso: false,
        codigo: this._ultimoErro.codigo,
        mensagem: this._ultimoErro.mensagem,
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
        windows: error.detalhes?.windows || null,
        classeDiagnostico: error.detalhes?.classeDiagnostico
          || error.detalhes?.windows?.classeDiagnostico
          || 'ERRO_CARREGAMENTO'
      };
      destaxaLogger.registrar('dll.load.failed', {
        processArch: this._arch,
        dllPath: this._dllPath,
        codigo: this._ultimoErro.codigo,
        classeDiagnostico: this._ultimoErro.classeDiagnostico,
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

  iniciarClient(config = {}, contexto = {}) {
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

    // MRT-28 — diretório de log pronto antes de iniciaClientDestaxa (sem alterar TX).
    try {
      const { garantirDiretorioLogDll, DESTAXA_DLL_LOG_PARAMS } = require('./destaxaDllLogConfig');
      const paramsLog = cfg.destaxaDllLog && typeof cfg.destaxaDllLog === 'object'
        ? { ...DESTAXA_DLL_LOG_PARAMS, ...cfg.destaxaDllLog }
        : DESTAXA_DLL_LOG_PARAMS;
      const dirLog = garantirDiretorioLogDll(paramsLog);
      if (!dirLog.ok) {
        this._estado = ESTADOS.CLIENT_ERROR;
        this._ultimoErro = { codigo: dirLog.codigo, mensagem: dirLog.mensagem };
        return {
          sucesso: false,
          codigo: dirLog.codigo,
          mensagem: `Diretório de log Destaxa indisponível: ${dirLog.mensagem}`,
          estado: this._estado,
          diagnostico: this.getDiagnostics()
        };
      }
    } catch (errorDir) {
      this._estado = ESTADOS.CLIENT_ERROR;
      this._ultimoErro = {
        codigo: ERROS.DESTAXA_INVALID_CONFIGURATION,
        mensagem: errorDir.message
      };
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_INVALID_CONFIGURATION,
        mensagem: errorDir.message,
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

    const requestId = contexto.requestId || undefined;
    destaxaLogger.registrarPersistente('client.init.start', {
      requestId,
      processArch: this._arch,
      tamanhoEntrada: entrada.texto.length
    });

    let chamada;
    try {
      chamada = destaxaLogger.executarChamadaNativaAuditada({
        requestId,
        pid: process.pid,
        functionName: 'iniciaClientDestaxa',
        fn: () => fn(resultadoBuf, entradaBuf, entrada.texto.length),
        obterCodigoResultado: () => lerCodigoBuffer(resultadoBuf) || 'FF'
      });
    } catch (error) {
      if (!destaxaLogger.ehExcecaoDeChamadaNativa(error)) throw error;
      this._clientInitialized = false;
      this._estado = ESTADOS.CLIENT_ERROR;
      this._ultimoErro = {
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: error.message
      };
      destaxaLogger.registrarPersistente('client.init.exception', {
        requestId,
        pid: process.pid,
        functionName: 'iniciaClientDestaxa',
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        exception: { name: error.name || 'Error', code: error.code || null }
      });
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: error.message,
        estado: this._estado,
        diagnostico: this.getDiagnostics()
      };
    }

    const duracaoMs = chamada.durationMs;
    const codigo = chamada.resultCode || 'FF';
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

    destaxaLogger.registrarPersistente('client.init.result', {
      requestId,
      pid: process.pid,
      functionName: 'iniciaClientDestaxa',
      processArch: this._arch,
      codigo,
      sucesso: interpretado.sucesso,
      duracaoMs,
      estado: this._estado
    });
    destaxaLogger.registrarBlocoReal({ ...this.getDiagnostics(), dllPath: null }, {
      requestId,
      pid: process.pid,
      iniciaClientExecutado: true,
      codigoDestaxa: codigo,
      duracaoMs
    });

    // TEF-DESTAXA-51.25 — A1 em iniciaClientDestaxa: classificar/bloquear sem finalização automática
    const bloqueadoA1 = String(codigo || '').toUpperCase() === 'A1';
    let a1 = null;
    if (bloqueadoA1) {
      try {
        const { classificarRetornoA1 } = require('./destaxaProtocolo');
        a1 = classificarRetornoA1('iniciaClientDestaxa', {
          finalizacaoAutomatica: false
        });
      } catch (_) {
        a1 = {
          codigo: 'A1',
          origemApi: 'iniciaClientDestaxa',
          finalizacaoAutomatica: false,
          financialState: 'BLOCKED'
        };
      }
    }

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
      bloqueadoA1,
      a1,
      finalizacaoAutomaticaA1: false,
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
    this._orquestrador.definirPermissaoTransacaoReal(false);
  }

  getTransacaoContexto() {
    return this._orquestrador.getContexto();
  }

  getOrquestradorTransacao() {
    return this._orquestrador;
  }

  /**
   * Instala o driver nativo no orquestrador.
   * Aceita DESTAXA_REAL_TRANSACTION_ENABLED=1 OU permit excepcional one-shot
   * já consumido (TEF-DESTAXA-51.02). Não liga o env global.
   * Não chama nenhuma função transacional da DLL.
   */
  habilitarTransacaoReal(opcoes = {}) {
    const {
      transacaoRealEfetivaPermitida,
      validarPermitExcepcional
    } = require('./destaxaAutorizacaoExcepcional');
    const exceptionalPermit = opcoes && opcoes.exceptionalPermit
      ? opcoes.exceptionalPermit
      : null;

    // MRT-50.67 / 51.02 — env literal "1" OU capability one-shot consumida
    if (!transacaoRealEfetivaPermitida(exceptionalPermit)) {
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
        mensagem: `Transação Destaxa real desabilitada: ${REAL_TRANSACTION_ENV} != 1`
      };
    }
    // SPRINT 51.47 — permit de recuperação TX3: TX_FINALIZE(0)/id=3; não exige CRT.
    let recuperacaoTx3 = false;
    if (exceptionalPermit && exceptionalPermit.purpose === 'RECUPERACAO_PROTOCOLAR_TX3') {
      recuperacaoTx3 = exceptionalPermit.operation === 'TX_FINALIZE'
        && Number(exceptionalPermit.confirmacao) === 0
        && String(exceptionalPermit.transactionId) === '3'
        && exceptionalPermit.exceptional === true
        && exceptionalPermit.oneShot === true;
      if (!recuperacaoTx3) {
        return {
          sucesso: false,
          codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
          mensagem: 'Permit RECUPERACAO_PROTOCOLAR_TX3 inválido (exige TX_FINALIZE/confirmacao=0/transactionId=3)'
        };
      }
    } else if (exceptionalPermit) {
      const check = validarPermitExcepcional(exceptionalPermit, {
        valorCentavos: exceptionalPermit.valorCentavos,
        tipoPdv: Array.isArray(exceptionalPermit.tipoPermitido)
          ? exceptionalPermit.tipoPermitido[0]
          : null,
        operacao: exceptionalPermit.operacao
      });
      if (!check.ok) {
        return {
          sucesso: false,
          codigo: check.codigo || ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
          mensagem: check.mensagem || 'Permit excepcional inválido'
        };
      }
    }
    // Recuperação: INIT_CLIENT=A1 deixa clientInitialized=false; DLL/exports + A1 bastam.
    const pendenciaA1Recuperacao = recuperacaoTx3
      && String(this._ultimoCodigoClient || '').toUpperCase() === 'A1';
    if (!this._dllLoaded || !this._exportsValid
        || (!this._clientInitialized && !pendenciaA1Recuperacao)) {
      return {
        sucesso: false,
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: 'DLL/Client Destaxa não inicializados — driver nativo não instalado'
      };
    }
    this._mockTransacaoDriver = null;
    this._orquestrador.definirDriver(criarDriverTransacaoNativo(this._nativo.exports));
    this._orquestrador.definirPermissaoTransacaoReal(true);
    this._orquestrador.definirPermitExcepcional(exceptionalPermit);
    destaxaLogger.registrar('transacao.real.driver.habilitado', {
      dllPath: this._dllPath,
      exceptional: Boolean(exceptionalPermit),
      authorizationId: exceptionalPermit?.authorizationId || null
    });
    return { sucesso: true, exceptional: Boolean(exceptionalPermit) };
  }

  iniciarTransacaoDestaxa(operacao, camposEntrada = {}, opcoes = {}) {
    return this._orquestrador.iniciarTransacao(operacao, camposEntrada, opcoes);
  }

  continuarTransacaoDestaxa(respostaEntrada = {}) {
    return this._orquestrador.continuarTransacao(respostaEntrada);
  }

  finalizarTransacaoDestaxa(confirmacao, opcoes = {}) {
    return this._orquestrador.finalizarTransacao(confirmacao, opcoes || {});
  }

  unload() {
    this.limparTransacaoDestaxa();
    try {
      this._orquestrador.definirPermitExcepcional(null);
      this._orquestrador.definirPermissaoTransacaoReal(false);
    } catch (_) { /* ignore */ }
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
module.exports.lerSaidaBuffer = lerSaidaBuffer;
module.exports.montarBufferEntrada = montarBufferEntrada;
module.exports.criarDriverTransacaoNativo = criarDriverTransacaoNativo;
