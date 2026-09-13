const express = require("express");
const db = require("../database");
const {
  fazerBackupManual,
  listarHistoricoBackups,
  aplicarRetencaoBackups,
  obterPastaBackupPadrao
} = require("../services/backupManual");
const {
  isElectronRuntime,
  selecionarPastaBackup
} = require("../services/electronDialogoService");

const router = express.Router();

router.post("/selecionar-pasta", (req, res) => {
  if (!isElectronRuntime()) {
    return res.status(501).json({
      sucesso: false,
      erro: "NOT_ELECTRON",
      mensagem: "Seletor de pasta disponível apenas no aplicativo desktop."
    });
  }

  try {
    const resultado = selecionarPastaBackup();

    if (resultado.cancelado) {
      return res.json({ sucesso: false, cancelado: true });
    }

    if (!resultado.sucesso) {
      return res.status(500).json({
        sucesso: false,
        mensagem: resultado.erro || "Não foi possível abrir o seletor de pasta.",
        erro: resultado.erro || null
      });
    }

    console.log("[BACKUP CONFIG] Pasta selecionada (API):", resultado.caminho);
    res.json({ sucesso: true, caminho: resultado.caminho });
  } catch (error) {
    console.error("[BACKUP] Erro ao selecionar pasta:", error);
    res.status(500).json({
      sucesso: false,
      mensagem: error.message || "Erro ao selecionar pasta."
    });
  }
});

router.post("/manual", (req, res) => {
  const dbPath = db.dbPath;
  if (!dbPath) {
    return res.status(500).json({
      sucesso: false,
      mensagem: "Caminho do banco oficial indisponível.",
      erro: "DB_PATH_AUSENTE"
    });
  }

  db.get(
    "SELECT valor FROM configuracoes WHERE chave = 'backup_path'",
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({
          sucesso: false,
          mensagem: err.message,
          erro: err.message
        });
      }

      const configurado = row?.valor && String(row.valor).trim() ? String(row.valor).trim() : null;
      const pasta = configurado || obterPastaBackupPadrao(dbPath);

      try {
        console.log("[BACKUP] Banco utilizado:", dbPath);
        console.log("[BACKUP] Pasta utilizada:", pasta);
        const resultado = fazerBackupManual(dbPath, pasta);

        res.json({
          sucesso: true,
          backup: resultado
        });
        aplicarRetencaoBackups(pasta, 30);
      } catch (error) {
        console.error("[BACKUP] Erro:", error.message, "codigo:", error.code);
        res.status(500).json({
          sucesso: false,
          mensagem: error.message,
          erro: error.message,
          codigo: error.code || null,
          operacao: error.operacao || null,
          pasta: error.pasta || pasta,
          dbPath: error.dbPath || dbPath
        });
      }
    }
  );
});

router.get('/history', (req, res) => {
  const pastaBackup = req.query.pasta || null;
  try {
    const historico = listarHistoricoBackups(
      pastaBackup || obterPastaBackupPadrao(db.dbPath),
      Number(req.query.limite) || 50
    );
    res.json({ sucesso: true, historico });
  } catch (err) {
    console.error('Erro ao listar histórico de backups:', err);
    res.status(500).json({ sucesso: false, mensagem: err.message });
  }
});

module.exports = router;
