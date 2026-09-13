const path = require('path');
const fs = require('fs');
const multer = require('multer');

function getWritableStoragePath() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.PROGRAMDATA || 'C:\\ProgramData',
      'CDS Sistemas',
      'CDS Sistemas'
    );
  }
  return path.join(process.cwd(), 'dados-app');
}

const produtosImagensPath = path.join(getWritableStoragePath(), 'storage', 'produtos');
fs.mkdirSync(produtosImagensPath, { recursive: true });

const produtoImagemUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, produtosImagensPath),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      cb(null, `produto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Tipo de arquivo inválido. Use PNG, JPG, JPEG, GIF ou WEBP.'));
    }
    cb(null, true);
  }
});

function caminhoPublicoImagemProduto(filename) {
  return `/storage/produtos/${filename}`;
}

function resolverArquivoImagemProduto(imagemPrincipal) {
  const valor = String(imagemPrincipal || '').trim();
  if (!valor || valor.startsWith('data:')) {
    return null;
  }

  const marker = '/storage/produtos/';
  const idx = valor.indexOf(marker);
  const filename = idx >= 0 ? valor.slice(idx + marker.length) : path.basename(valor);
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }

  return path.join(produtosImagensPath, filename);
}

function removerArquivoImagemProduto(imagemPrincipal) {
  const arquivo = resolverArquivoImagemProduto(imagemPrincipal);
  if (!arquivo || !fs.existsSync(arquivo)) {
    return false;
  }
  try {
    fs.unlinkSync(arquivo);
    return true;
  } catch (err) {
    console.warn('[PRODUTO IMAGEM] Falha ao remover arquivo:', err.message);
    return false;
  }
}

function handleMulterProdutoImagemError(err, req, res, next) {
  if (!err) return next();
  console.error('[PRODUTO IMAGEM] Erro multer:', err.message);
  return res.status(400).json({ error: err.message || 'Erro no upload da imagem.' });
}

module.exports = {
  produtoImagemUpload,
  caminhoPublicoImagemProduto,
  removerArquivoImagemProduto,
  handleMulterProdutoImagemError,
  produtosImagensPath
};
