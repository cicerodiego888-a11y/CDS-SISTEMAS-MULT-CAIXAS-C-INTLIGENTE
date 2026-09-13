/**
 * CentralUploadService — Upload manual de XML na Central Inteligente.
 *
 * Sprint 10: reutiliza persistência DF-e + pipeline oficial (Parser + MIIP).
 * Não cria compra nem fluxo paralelo.
 *
 * @class CentralUploadService
 */

const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { paraDocumentoDetalheDTO } = require('../utils/centralEntradasMapper');
const UploadResultadoDTO = require('../contracts/UploadResultadoDTO');
const CentralDfePersistenciaService = require('./CentralDfePersistenciaService');
const CentralProcessamentoService = require('./CentralProcessamentoService');
const {
  extrairMetadadosNota,
  detectarNfCancelada
} = require('../../../services/fiscal/dfeXmlMetadados');

const ORIGEM_UPLOAD = 'upload_manual';
const EXTENSAO_XML = /\.xml$/i;

class CentralUploadService {
  /**
   * @param {Object} [deps]
   * @param {CentralDfePersistenciaService} [deps.persistenciaService]
   * @param {CentralProcessamentoService} [deps.processamentoService]
   */
  constructor(deps = {}) {
    /** @private */
    this._persistencia = deps.persistenciaService ?? new CentralDfePersistenciaService();
    /** @private */
    this._processamento = deps.processamentoService ?? new CentralProcessamentoService();
  }

  /**
   * @private
   * @param {string} nome
   * @param {string} codigo
   * @param {string} mensagem
   * @param {Object} [extra]
   * @returns {Object}
   */
  _itemErro(nome, codigo, mensagem, extra = {}) {
    return {
      nomeArquivo: nome,
      sucesso: false,
      codigo,
      mensagem,
      ...extra
    };
  }

  /**
   * @private
   * @param {Object} arquivo
   * @returns {string}
   */
  _obterNome(arquivo) {
    return String(arquivo?.originalname || arquivo?.nome || 'documento.xml');
  }

  /**
   * @private
   * @param {Object} arquivo
   * @returns {string|null}
   */
  _obterXml(arquivo) {
    if (!arquivo?.buffer) return null;
    return arquivo.buffer.toString('utf8');
  }

  /**
   * @private
   * @param {string} xml
   * @returns {boolean}
   */
  _xmlPareceValido(xml) {
    const texto = String(xml || '').trim();
    if (!texto.startsWith('<')) return false;
    return /<(\w+:)?(nfeProc|NFe|enviNFe)\b/i.test(texto);
  }

  /**
   * Processa um arquivo XML via pipeline oficial.
   *
   * @param {Object} arquivo
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async processarArquivo(arquivo, opcoes = {}) {
    const nome = this._obterNome(arquivo);

    if (!EXTENSAO_XML.test(nome)) {
      return this._itemErro(nome, 'EXTENSAO_INVALIDA', 'Apenas arquivos .xml são permitidos');
    }

    const xml = this._obterXml(arquivo);
    if (!xml || !String(xml).trim().startsWith('<')) {
      return this._itemErro(nome, 'XML_INVALIDO', 'XML inválido ou vazio');
    }

    if (detectarNfCancelada(xml)) {
      return this._itemErro(nome, 'NF_CANCELADA', 'NF-e cancelada ou inutilizada');
    }

    if (!this._xmlPareceValido(xml)) {
      return this._itemErro(nome, 'XML_INVALIDO', 'XML inválido ou não reconhecido como NF-e');
    }

    const metadados = extrairMetadadosNota(xml);
    if (!metadados.chave) {
      return this._itemErro(nome, 'XML_INVALIDO', 'XML sem chave de acesso identificável');
    }

    const persistido = await this._persistencia.persistirDocumentoDfe({
      xml,
      origem: ORIGEM_UPLOAD
    });

    // RC7.4.2 — upload cancela wait, backoff, bloqueio 656 e erro 593.
    try {
      const xmlWait = require('./CentralXmlWaitScheduler');
      if (persistido.documento?.id) {
        xmlWait.cancelar(persistido.documento.id, 'upload');
      } else if (metadados.chave) {
        xmlWait.cancelarPorChave(metadados.chave, 'upload');
      }
      xmlWait.limparBloqueio656('upload');
      xmlWait.limparErro593('upload');
      try {
        require('./CentralSefazOperationalGate').limparBloqueiosPorUpload();
      } catch { /* ignore */ }
    } catch { /* ignore */ }

    if (persistido.ignorado) {
      return this._itemErro(
        nome,
        'XML_INVALIDO',
        persistido.motivo || 'XML não pôde ser indexado',
        { chave: metadados.chave }
      );
    }

    if (persistido.duplicado) {
      const doc = persistido.documento;
      const jaComprada = doc?.status === DocumentoFiscalStatus.DUPLICADA;
      return {
        nomeArquivo: nome,
        sucesso: false,
        codigo: jaComprada ? 'DOCUMENTO_DUPLICADO' : 'DOCUMENTO_JA_EXISTENTE',
        mensagem: persistido.motivo
          || (jaComprada ? 'Documento duplicado — NF já registrada em compras' : 'Documento já existente na Central'),
        chave: doc?.chave || metadados.chave,
        documentoId: doc?.id ?? null,
        documento: doc ? paraDocumentoDetalheDTO(doc) : null
      };
    }

    const documentoId = persistido.documento?.id;
    const processado = await this._processamento.processar(documentoId, {
      usuarioId: opcoes.usuarioId
    });

    if (!processado.sucesso) {
      return {
        nomeArquivo: nome,
        sucesso: false,
        codigo: 'ERRO_PROCESSAMENTO',
        mensagem: processado.mensagem || 'Falha no pipeline oficial',
        chave: persistido.documento?.chave || metadados.chave,
        documentoId,
        erros: processado.erros || []
      };
    }

    return {
      nomeArquivo: nome,
      sucesso: true,
      codigo: 'IMPORTADO',
      mensagem: processado.mensagem || 'Upload concluído',
      chave: processado.documento?.chave || metadados.chave,
      documentoId,
      status: processado.documento?.status || null,
      proximaAcao: processado.proximaAcao || null,
      possuiPendencias: processado.possuiPendencias ?? false,
      documento: processado.documento || null
    };
  }

  /**
   * @param {Object[]} arquivos
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async processarUpload(arquivos = [], opcoes = {}) {
    const lista = Array.isArray(arquivos) ? arquivos : [];
    const itens = [];

    for (const arquivo of lista) {
      // eslint-disable-next-line no-await-in-loop
      const item = await this.processarArquivo(arquivo, opcoes);
      itens.push(item);
    }

    const importados = itens.filter((i) => i.codigo === 'IMPORTADO').length;
    const duplicados = itens.filter((i) => (
      i.codigo === 'DOCUMENTO_JA_EXISTENTE' || i.codigo === 'DOCUMENTO_DUPLICADO'
    )).length;
    const invalidos = itens.filter((i) => i.codigo === 'XML_INVALIDO' || i.codigo === 'EXTENSAO_INVALIDA').length;
    const cancelados = itens.filter((i) => i.codigo === 'NF_CANCELADA').length;
    const erros = itens.filter((i) => (
      i.codigo === 'ERRO_PROCESSAMENTO'
    )).length;

    const mensagem = importados > 0
      ? `Upload concluído — ${importados} documento(s) importado(s)`
      : (lista.length === 0
        ? 'Nenhum arquivo enviado'
        : 'Nenhum documento importado');

    return UploadResultadoDTO.create({
      sucesso: importados > 0,
      totalEnviados: lista.length,
      importados,
      duplicados,
      invalidos,
      cancelados,
      erros,
      mensagem,
      itens
    }).toJSON();
  }
}

module.exports = CentralUploadService;
module.exports.ORIGEM_UPLOAD = ORIGEM_UPLOAD;
