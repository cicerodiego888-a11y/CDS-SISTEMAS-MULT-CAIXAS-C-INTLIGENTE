'use strict';

const fs = require('fs');

function criarHandlerExportarContabilidade({
  exportarContabilidade,
  limparExportacaoTemporaria,
  fsApi = fs
} = {}) {
  if (typeof exportarContabilidade !== 'function'
      || typeof limparExportacaoTemporaria !== 'function'
      || !fsApi
      || typeof fsApi.createReadStream !== 'function') {
    throw new TypeError('Dependências inválidas para o handler da Central Contábil.');
  }

  return async function handlerExportarContabilidade(req, res) {
    let resultado = null;

    try {
      const body = req.body || {};
      const { dataInicial, dataFinal } = body;
      resultado = await exportarContabilidade({
        dataInicial,
        dataFinal,
        incluirNfce: body.incluirNfce,
        incluirNfe: body.incluirNfe,
        incluirEntradas: body.incluirEntradas,
        incluirRelatorios: body.incluirRelatorios,
        incluirManifesto: body.incluirManifesto
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${resultado.nomeZip}"`);
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Disposition, X-Export-Filename, X-Export-Arquivos, X-Export-Resumo'
      );
      res.setHeader('X-Export-Filename', resultado.nomeZip);
      res.setHeader('X-Export-Arquivos', JSON.stringify(resultado.arquivosGerados));
      res.setHeader('X-Export-Resumo', JSON.stringify(resultado.resumo));

      const stream = fsApi.createReadStream(resultado.caminhoZip);
      stream.on('close', () => limparExportacaoTemporaria(resultado));
      stream.on('error', () => limparExportacaoTemporaria(resultado));
      res.on('close', () => limparExportacaoTemporaria(resultado));
      stream.pipe(res);
    } catch (error) {
      if (resultado) {
        limparExportacaoTemporaria(resultado);
      }

      const status = error.statusCode || 500;
      res.status(status).json({
        error: error.message || 'Erro ao exportar documentos para contabilidade.'
      });
    }
  };
}

module.exports = { criarHandlerExportarContabilidade };
