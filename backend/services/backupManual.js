const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const db = require("../database");

function formatarDataArquivo() {
  const agora = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return (
    agora.getFullYear() +
    "-" + pad(agora.getMonth() + 1) +
    "-" + pad(agora.getDate()) +
    "_" + pad(agora.getHours()) +
    "-" + pad(agora.getMinutes()) +
    "-" + pad(agora.getSeconds())
  );
}

/**
 * Fallback oficial: <dir do banco>/backups
 * Com banco em ProgramData\MercantilFiscal\dados → ...\dados\backups
 */
function obterPastaBackupPadrao(dbPath = null) {
  const baseDb = dbPath || db.dbPath || null;
  if (baseDb) {
    return path.join(path.dirname(baseDb), "backups");
  }
  const programData = process.env.PROGRAMDATA || "C:\\ProgramData";
  return path.join(programData, "MercantilFiscal", "dados", "backups");
}

function obterPastaBackup(dbPath) {
  return obterPastaBackupPadrao(dbPath);
}

/**
 * Normaliza e garante que a pasta existe e é gravável.
 * Cria a pasta se necessário (ex.: ProgramData\...\backups ainda inexistente).
 */
function garantirPastaBackupGravavel(pastaDestino) {
  if (pastaDestino == null || typeof pastaDestino !== "string") {
    return {
      sucesso: false,
      erro: "Caminho da pasta de backup inválido.",
      codigo: "EINVAL",
      pasta: pastaDestino
    };
  }

  const normalizado = path.resolve(pastaDestino.trim());
  if (!normalizado) {
    return {
      sucesso: false,
      erro: "Caminho da pasta de backup vazio.",
      codigo: "EINVAL",
      pasta: pastaDestino
    };
  }

  try {
    if (!fs.existsSync(normalizado)) {
      fs.mkdirSync(normalizado, { recursive: true });
    }
    const st = fs.statSync(normalizado);
    if (!st.isDirectory()) {
      return {
        sucesso: false,
        erro: "O caminho informado não é uma pasta.",
        codigo: "ENOTDIR",
        pasta: normalizado
      };
    }

    const probe = path.join(normalizado, `.cds_backup_write_${process.pid}_${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);

    return { sucesso: true, caminho: normalizado };
  } catch (err) {
    console.error("[BACKUP] Erro ao validar pasta:", err.message, "pasta:", normalizado);
    return {
      sucesso: false,
      erro: "Não foi possível acessar ou criar a pasta de backup.",
      codigo: err.code || "EPERM",
      pasta: normalizado,
      detalhe: err.message
    };
  }
}

function enriquecerErroBackup(err, extras = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  if (extras.codigo && !e.code) e.code = extras.codigo;
  if (extras.operacao) e.operacao = extras.operacao;
  if (extras.pasta) e.pasta = extras.pasta;
  if (extras.dbPath) e.dbPath = extras.dbPath;
  if (extras.destino) e.destino = extras.destino;
  return e;
}

function fazerBackupManual(dbPath, pastaDestino = null) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    const err = enriquecerErroBackup(
      new Error("Banco de dados não encontrado: " + dbPath),
      { codigo: "ENOENT", operacao: "verificar_banco", dbPath }
    );
    console.error("[BACKUP] Erro:", err.message);
    throw err;
  }

  const pastaSolicitada = pastaDestino || obterPastaBackupPadrao(dbPath);
  console.log("[BACKUP] Banco utilizado:", dbPath);
  console.log("[BACKUP] Pasta utilizada:", pastaSolicitada);

  const validacao = garantirPastaBackupGravavel(pastaSolicitada);
  if (!validacao.sucesso) {
    const err = enriquecerErroBackup(
      new Error(
        `${validacao.erro}${validacao.detalhe ? ` (${validacao.detalhe})` : ""}`
      ),
      {
        codigo: validacao.codigo,
        operacao: "validar_pasta",
        pasta: validacao.pasta,
        dbPath
      }
    );
    console.error("[BACKUP] Erro:", err.message, "codigo:", err.code, "pasta:", err.pasta);
    throw err;
  }

  const pastaBackup = validacao.caminho;
  const nomeBackup = `backup_pdv_${formatarDataArquivo()}.db`;
  const caminhoBackup = path.join(pastaBackup, nomeBackup);

  try {
    fs.copyFileSync(dbPath, caminhoBackup);
  } catch (copyErr) {
    const err = enriquecerErroBackup(
      new Error(`Falha ao copiar banco para backup: ${copyErr.message}`),
      {
        codigo: copyErr.code || "EIO",
        operacao: "copyFile",
        pasta: pastaBackup,
        dbPath,
        destino: caminhoBackup
      }
    );
    console.error("[BACKUP] Erro:", err.message);
    throw err;
  }

  if (!fs.existsSync(caminhoBackup)) {
    const err = enriquecerErroBackup(
      new Error("Backup não foi criado no destino esperado."),
      { codigo: "ENOENT", operacao: "verificar_arquivo", pasta: pastaBackup, dbPath, destino: caminhoBackup }
    );
    console.error("[BACKUP] Erro:", err.message);
    throw err;
  }

  const caminhoBackupCompactado = `${caminhoBackup}.gz`;
  try {
    const conteudo = fs.readFileSync(caminhoBackup);
    const gzipConteudo = zlib.gzipSync(conteudo);
    fs.writeFileSync(caminhoBackupCompactado, gzipConteudo);
  } catch (err) {
    console.error("[BACKUP] Erro ao compactar backup:", err);
  }

  console.log("[BACKUP] Backup criado:", caminhoBackup);

  return {
    sucesso: true,
    arquivo: nomeBackup,
    caminho: caminhoBackup,
    compacto: caminhoBackupCompactado,
    pasta: pastaBackup,
    dbPath
  };
}

function listarHistoricoBackups(pastaBackup = null, limite = 20) {
  const folder = pastaBackup || obterPastaBackup(db.dbPath);
  if (!fs.existsSync(folder)) {
    return [];
  }
  const arquivos = fs.readdirSync(folder)
    .filter((file) => file.endsWith(".db") || file.endsWith(".db.gz"))
    .map((file) => {
      const stats = fs.statSync(path.join(folder, file));
      return {
        arquivo: file,
        caminho: path.join(folder, file),
        tamanho: stats.size,
        modificado_em: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => new Date(b.modificado_em) - new Date(a.modificado_em));

  return arquivos.slice(0, limite);
}

function aplicarRetencaoBackups(pastaBackup = null, limite = 30) {
  const arquivos = listarHistoricoBackups(pastaBackup, 1000);
  if (arquivos.length <= limite) return;
  const paraExcluir = arquivos.slice(limite);
  paraExcluir.forEach((arquivo) => {
    try {
      fs.unlinkSync(arquivo.caminho);
    } catch (err) {
      console.error("Erro ao excluir backup antigo:", arquivo.caminho, err);
    }
  });
}

module.exports = {
  fazerBackupManual,
  listarHistoricoBackups,
  aplicarRetencaoBackups,
  obterPastaBackupPadrao,
  obterPastaBackup,
  garantirPastaBackupGravavel
};
