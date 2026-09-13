/**
 * ProdutoImagemService — galeria de imagens do produto (INFRA 02).
 * Mantém sincronia com produtos.imagem_principal sem alterar o contrato da UI atual.
 */

const ProdutoImagemRepository = require('../repositories/ProdutoImagemRepository');
const { removerArquivoImagemProduto } = require('./produtoImagemUpload');

function normalizarArquivo(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (!texto || texto.startsWith('data:')) return null;
  return texto;
}

class ProdutoImagemService {
  /**
   * @param {Object} deps
   * @param {Object} deps.db
   * @param {ProdutoImagemRepository} [deps.repository]
   */
  constructor(deps = {}) {
    this._db = deps.db;
    this._repo = deps.repository || new ProdutoImagemRepository({ db: deps.db });
  }

  async listarImagens(produtoId, opcoes = {}) {
    return this._repo.listarPorProduto(produtoId, opcoes);
  }

  async adicionarImagem(produtoId, arquivo, opcoes = {}) {
    const pathArquivo = normalizarArquivo(arquivo);
    if (!pathArquivo) {
      throw new Error('Arquivo de imagem inválido.');
    }

    const existente = await this._repo.buscarAtivaPorArquivo(produtoId, pathArquivo);
    if (existente) {
      if (opcoes.principal) {
        return this.definirImagemPrincipal(produtoId, existente.id);
      }
      return existente;
    }

    const lista = await this._repo.listarPorProduto(produtoId);
    const proximaOrdem = opcoes.ordem != null
      ? Number(opcoes.ordem) || 1
      : (lista.reduce((max, img) => Math.max(max, Number(img.ordem) || 0), 0) + 1);

    if (opcoes.principal) {
      await this._repo.limparFlagPrincipal(produtoId);
    }

    const criada = await this._repo.inserir({
      produtoId,
      arquivo: pathArquivo,
      ordem: proximaOrdem,
      principal: !!opcoes.principal,
      ativo: true
    });

    if (opcoes.principal) {
      await this._espelharImagemPrincipalNoProduto(produtoId, pathArquivo);
    }

    return criada;
  }

  async removerImagem(produtoId, imagemId, opcoes = {}) {
    const imagem = await this._repo.buscarPorId(imagemId);
    if (!imagem || Number(imagem.produto_id) !== Number(produtoId)) {
      throw new Error('Imagem não encontrada para o produto.');
    }

    const eraPrincipal = imagem.principal;
    await this._repo.inativar(imagemId);

    if (opcoes.removerArquivo) {
      removerArquivoImagemProduto(imagem.arquivo);
    }

    if (eraPrincipal) {
      const restantes = await this._repo.listarPorProduto(produtoId);
      if (restantes.length > 0) {
        const novaPrincipal = restantes[0];
        await this.definirImagemPrincipal(produtoId, novaPrincipal.id);
      } else {
        await this._espelharImagemPrincipalNoProduto(produtoId, null);
      }
    }

    return { success: true };
  }

  async definirImagemPrincipal(produtoId, imagemId) {
    const imagem = await this._repo.buscarPorId(imagemId);
    if (!imagem || Number(imagem.produto_id) !== Number(produtoId) || !imagem.ativo) {
      throw new Error('Imagem não encontrada para o produto.');
    }

    await this._repo.limparFlagPrincipal(produtoId);
    const atualizada = await this._repo.atualizar(imagemId, {
      principal: true,
      ordem: 1,
      ativo: true
    });
    await this._espelharImagemPrincipalNoProduto(produtoId, atualizada.arquivo);
    return atualizada;
  }

  async ordenarImagens(produtoId, ordenacao = []) {
    return this._repo.reordenar(produtoId, ordenacao);
  }

  /**
   * Sincroniza galeria a partir do campo legado produtos.imagem_principal.
   * Não altera o valor em produtos.imagem_principal.
   */
  async sincronizarAPartirDeImagemPrincipal(produtoId, imagemPrincipal) {
    const arquivo = normalizarArquivo(imagemPrincipal);

    if (!arquivo) {
      await this._repo.inativarPrincipais(produtoId);
      return null;
    }

    const principalAtual = await this._repo.buscarPrincipalAtiva(produtoId);
    if (principalAtual && principalAtual.arquivo === arquivo) {
      return principalAtual;
    }

    const mesmaArquivo = await this._repo.buscarAtivaPorArquivo(produtoId, arquivo);
    await this._repo.limparFlagPrincipal(produtoId);

    if (mesmaArquivo) {
      return this._repo.atualizar(mesmaArquivo.id, {
        principal: true,
        ordem: 1,
        ativo: true
      });
    }

    return this._repo.inserir({
      produtoId,
      arquivo,
      ordem: 1,
      principal: true,
      ativo: true
    });
  }

  /**
   * Fire-and-forget seguro para rotas legadas.
   */
  sincronizarAPartirDeImagemPrincipalSafe(produtoId, imagemPrincipal) {
    this.sincronizarAPartirDeImagemPrincipal(produtoId, imagemPrincipal).catch((err) => {
      console.warn(
        `[PRODUTO IMAGEM] Falha ao sincronizar galeria do produto ${produtoId}:`,
        err.message
      );
    });
  }

  _espelharImagemPrincipalNoProduto(produtoId, arquivo) {
    return new Promise((resolve, reject) => {
      this._db.run(
        `UPDATE produtos SET imagem_principal = ? WHERE id = ?`,
        [arquivo, produtoId],
        function cb(err) {
          if (err) return reject(err);
          resolve({ changes: this.changes });
        }
      );
    });
  }
}

let _singleton = null;

function obterProdutoImagemService(db) {
  if (!_singleton || (_singleton._db !== db && db)) {
    _singleton = new ProdutoImagemService({ db });
  }
  return _singleton;
}

module.exports = ProdutoImagemService;
module.exports.ProdutoImagemService = ProdutoImagemService;
module.exports.obterProdutoImagemService = obterProdutoImagemService;
module.exports.normalizarArquivoImagem = normalizarArquivo;
