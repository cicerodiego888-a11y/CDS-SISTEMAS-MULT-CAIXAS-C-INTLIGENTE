const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const cfgTransferenciaPdv = require('../services/estoque/pdvTransferenciaNaoFiscalFiscalConfig');
const cfgEditarPrecoUnitarioPdv = require('../services/estoque/pdvEditarPrecoUnitarioConfig');
const cfgExigirNcmPdv = require('../services/estoque/pdvExigirNcmCadastroConfig');
const cfgImprimirCupomPdv = require('../services/estoque/pdvImprimirCupomConfig');
const cfgValidadeEmpresa = require('../services/estoque/empresaControlaValidadeConfig');
const cfgVendaSemEstoque = require('../services/estoque/empresaPermiteVendaSemEstoqueConfig');
const cfgFechamentoFiscalDia = require('../services/fechamento-fiscal/fechamentoFiscalModuloConfig');
const {
  garantirPastaBackupGravavel,
  obterPastaBackupPadrao
} = require('../services/backupManual');

function chaveReservadaSuperAdmin(chave) {
  return cfgTransferenciaPdv.ehChave(chave)
    || cfgEditarPrecoUnitarioPdv.ehChave(chave)
    || cfgExigirNcmPdv.ehChave(chave)
    || cfgImprimirCupomPdv.ehChave(chave)
    || cfgValidadeEmpresa.ehChave(chave)
    || cfgVendaSemEstoque.ehChave(chave)
    || cfgFechamentoFiscalDia.ehChave(chave)
    || String(chave || '') === 'imprimir_cupom';
}

function auditarConfiguracao(req, acao, chave, detalhes = {}) {
  const usuario = req.user || {};
  gravarAuditoria({
    usuario_id: usuario.id || null,
    usuario_nome: usuario.username || usuario.nome || null,
    modulo: 'configuracoes',
    acao,
    referencia_tipo: 'configuracao',
    referencia_id: chave || null,
    detalhes: { chave, ...detalhes, ip: req.ip || null },
    ip_requisicao: req.ip || null
  }).catch((auditErr) => console.error('Erro ao gravar auditoria de configuração:', auditErr));
}

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

const appDataPath = getWritableStoragePath();
const logoStoragePath = path.join(appDataPath, 'storage', 'logos');
const loginBgStoragePath = path.join(appDataPath, 'storage', 'login-backgrounds');

fs.mkdirSync(logoStoragePath, { recursive: true });
fs.mkdirSync(loginBgStoragePath, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoStoragePath),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `logo_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Tipo de arquivo inválido. Use PNG, JPG, JPEG, GIF ou SVG.'));
    }
    cb(null, true);
  }
});

const loginBgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, loginBgStoragePath),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `login_bg_${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Tipo de arquivo inválido. Use PNG, JPG, JPEG, GIF ou WEBP.'));
    }
    cb(null, true);
  }
});

const LEGACY_LOGO_CONFIG_KEY = 'caminho_logomarca';

const saveLogoConfig = (req, res) => {
  if (!req.file) {
    console.error('[LOGO] Arquivo não enviado');
    return res.status(400).json({ error: 'Arquivo de logo não enviado.' });
  }

  console.log('[LOGO] Arquivo recebido:', req.file.filename, 'Tamanho:', req.file.size);

  const logoPath = `/storage/logos/${req.file.filename}`;
  db.run(
    `UPDATE configuracoes SET valor = ?, updated_at = datetime('now', 'localtime') WHERE chave = 'logo'`,
    [logoPath],
    function(err) {
      if (err) {
        console.error('[LOGO] Erro ao atualizar DB:', err);
        return res.status(500).json({ error: 'Erro ao salvar logo: ' + err.message });
      }

      if (this.changes === 0) {
        db.get(
          `SELECT id FROM configuracoes WHERE chave = ?`,
          [LEGACY_LOGO_CONFIG_KEY],
          (legacyErr, legacyRow) => {
            if (legacyErr) {
              console.error('[LOGO] Erro ao buscar logo legada:', legacyErr);
              return res.status(500).json({ error: 'Erro ao salvar logo: ' + legacyErr.message });
            }

            if (legacyRow) {
              db.run(
                `UPDATE configuracoes SET chave = 'logo', valor = ?, tipo = 'text', descricao = 'Logo do cliente', updated_at = datetime('now', 'localtime') WHERE id = ?`,
                [logoPath, legacyRow.id],
                function(updateLegacyErr) {
                  if (updateLegacyErr) {
                    console.error('[LOGO] Erro ao migrar logo legada:', updateLegacyErr);
                    return res.status(500).json({ error: 'Erro ao salvar logo: ' + updateLegacyErr.message });
                  }
                  console.log('[LOGO] Logo legada migrada e salva com sucesso:', logoPath);
                  auditarConfiguracao(req, 'atualizar_logo', 'logo', { path: logoPath });
                  res.json({ success: true, path: logoPath });
                }
              );
              return;
            }

            db.run(
              `INSERT INTO configuracoes (chave, valor, tipo, descricao) VALUES ('logo', ?, 'text', 'Logo do cliente')`,
              [logoPath],
              function(insertErr) {
                if (insertErr) {
                  console.error('[LOGO] Erro ao inserir DB:', insertErr);
                  return res.status(500).json({ error: 'Erro ao salvar logo: ' + insertErr.message });
                }
                console.log('[LOGO] Logo salva com sucesso:', logoPath);
                auditarConfiguracao(req, 'atualizar_logo', 'logo', { path: logoPath });
                res.json({ success: true, path: logoPath });
              }
            );
          }
        );
        return;
      }

      console.log('[LOGO] Logo atualizada com sucesso:', logoPath);
      auditarConfiguracao(req, 'atualizar_logo', 'logo', { path: logoPath });
      res.json({ success: true, path: logoPath });
    }
  );
};

const saveLoginBackgroundConfig = (req, res) => {
  if (!req.file) {
    console.error('[LOGIN_BG] Arquivo não enviado');
    return res.status(400).json({ error: 'Arquivo de imagem não enviado.' });
  }

  console.log('[LOGIN_BG] Arquivo recebido:', req.file.filename, 'Tamanho:', req.file.size);

  const bgPath = `/storage/login-backgrounds/${req.file.filename}`;
  db.run(
    `UPDATE configuracoes SET valor = ?, updated_at = datetime('now', 'localtime') WHERE chave = 'login_background'`,
    [bgPath],
    function(err) {
      if (err) {
        console.error('[LOGIN_BG] Erro ao atualizar DB:', err);
        return res.status(500).json({ error: 'Erro ao salvar imagem: ' + err.message });
      }

      if (this.changes === 0) {
        db.run(
          `INSERT INTO configuracoes (chave, valor, tipo, descricao) VALUES ('login_background', ?, 'text', 'Imagem de fundo da tela de login')`,
          [bgPath],
          function(insertErr) {
            if (insertErr) {
              console.error('[LOGIN_BG] Erro ao inserir DB:', insertErr);
              return res.status(500).json({ error: 'Erro ao salvar imagem: ' + insertErr.message });
            }
            console.log('[LOGIN_BG] Imagem salva com sucesso:', bgPath);
            auditarConfiguracao(req, 'atualizar_login_background', 'login_background', { path: bgPath });
            res.json({ success: true, path: bgPath });
          }
        );
        return;
      }

      console.log('[LOGIN_BG] Imagem atualizada com sucesso:', bgPath);
      auditarConfiguracao(req, 'atualizar_login_background', 'login_background', { path: bgPath });
      res.json({ success: true, path: bgPath });
    }
  );
};

// Middleware para tratamento de erros do multer
const handleMulterError = (err, req, res, next) => {
  if (err) {
    console.error('[LOGO] Erro multer:', err.message);
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(413).json({ error: 'Arquivo muito grande. Máximo: 5MB' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo muito grande. Máximo: 5MB' });
    }
    if (err.message.includes('Tipo de arquivo inválido')) {
      return res.status(415).json({ error: err.message });
    }
    return res.status(400).json({ error: 'Erro ao enviar arquivo: ' + err.message });
  }
  next();
};

router.post('/logo', logoUpload.single('logo'), handleMulterError, saveLogoConfig);
router.post('/upload-logo', logoUpload.single('logo'), handleMulterError, saveLogoConfig);
router.post('/upload-login-background', loginBgUpload.single('imagem'), handleMulterError, saveLoginBackgroundConfig);

// salvar pasta backup
router.post('/backup-path', (req, res) => {
  const bruto = req.body?.caminho;

  if (bruto == null || typeof bruto !== 'string' || !String(bruto).trim()) {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'Caminho inválido',
      erro: 'Caminho inválido'
    });
  }

  const validacao = garantirPastaBackupGravavel(bruto);
  if (!validacao.sucesso) {
    console.error('[BACKUP CONFIG] Pasta rejeitada:', validacao.pasta, validacao.codigo, validacao.detalhe);
    return res.status(400).json({
      sucesso: false,
      erro: validacao.erro || 'Não foi possível acessar ou criar a pasta de backup.',
      mensagem: validacao.erro || 'Não foi possível acessar ou criar a pasta de backup.',
      codigo: validacao.codigo || null,
      pasta: validacao.pasta || null,
      detalhe: validacao.detalhe || null
    });
  }

  const caminho = validacao.caminho;
  console.log('[BACKUP CONFIG] Pasta salva (validada):', caminho);

  const query = `
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES ('backup_path', ?, 'text', 'Caminho da pasta de backup manual')
    ON CONFLICT(chave) DO UPDATE SET
      valor = excluded.valor,
      updated_at = datetime('now', 'localtime')
  `;

  db.run(query, [caminho], function (err) {
    if (err) {
      return res.status(500).json({ sucesso: false, erro: err.message, mensagem: err.message });
    }

    auditarConfiguracao(req, 'atualizar_backup_path', 'backup_path', { caminho });

    db.get(
      "SELECT valor FROM configuracoes WHERE chave = 'backup_path'",
      [],
      (readErr, row) => {
        if (readErr) {
          return res.status(500).json({ sucesso: false, erro: readErr.message });
        }
        const salvo = row?.valor || null;
        console.log('[BACKUP CONFIG] Pasta confirmada no banco:', salvo);
        return res.json({
          sucesso: true,
          mensagem: 'Pasta de backup configurada com sucesso.',
          caminho: salvo
        });
      }
    );
  });
});

// buscar pasta backup
router.get('/backup-path', (req, res) => {
  db.get(
    "SELECT valor FROM configuracoes WHERE chave = 'backup_path'",
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ sucesso: false });
      }

      const configurado = row?.valor && String(row.valor).trim() ? String(row.valor).trim() : null;
      res.json({
        sucesso: true,
        caminho: configurado,
        fallback: configurado ? null : obterPastaBackupPadrao(db.dbPath)
      });
    }
  );
});

// buscar impressora configurada
router.get('/impressora_cupom', (req, res) => {
  db.get(
    "SELECT valor FROM configuracoes WHERE chave = 'impressora_cupom'",
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ sucesso: false });
      }

      res.json({
        sucesso: true,
        caminho: row?.valor || null
      });
    }
  );
});

// salvar impressora configurada
router.post('/impressora_cupom', (req, res) => {
  const { caminho } = req.body;

  if (!caminho) {
    return res.status(400).json({ sucesso: false, mensagem: 'Nome da impressora inválido' });
  }

  const query = `
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES ('impressora_cupom', ?, 'text', 'Impressora de cupom fiscal')
    ON CONFLICT(chave) DO UPDATE SET
      valor = excluded.valor,
      updated_at = datetime('now', 'localtime')
  `;

  db.run(query, [caminho], function (err) {
    if (err) {
      return res.status(500).json({ sucesso: false, erro: err.message });
    }

    auditarConfiguracao(req, 'atualizar_impressora_cupom', 'impressora_cupom', { caminho });

    res.json({ sucesso: true, mensagem: 'Impressora salva!' });
  });
});

router.get('/pdv_permitir_transferencia_nao_fiscal_fiscal', (req, res) => {
  cfgTransferenciaPdv.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.put(
  '/pdv_permitir_transferencia_nao_fiscal_fiscal',
  cfgTransferenciaPdv.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgTransferenciaPdv.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgTransferenciaPdv.CHAVE, {
        valor: dados.valor
      });
      res.json({
        message: 'Configuração atualizada com sucesso',
        ...dados
      });
    });
  }
);

router.get('/pdv_permitir_editar_preco_unitario', (req, res) => {
  cfgEditarPrecoUnitarioPdv.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.put(
  '/pdv_permitir_editar_preco_unitario',
  cfgEditarPrecoUnitarioPdv.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgEditarPrecoUnitarioPdv.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgEditarPrecoUnitarioPdv.CHAVE, {
        valor: dados.valor
      });
      res.json({
        message: 'Configuração atualizada com sucesso',
        ...dados
      });
    });
  }
);

router.get('/pdv_exigir_ncm_cadastro', (req, res) => {
  cfgExigirNcmPdv.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.get('/pdv_imprimir_cupom', (req, res) => {
  cfgImprimirCupomPdv.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.put(
  '/pdv_imprimir_cupom',
  cfgImprimirCupomPdv.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgImprimirCupomPdv.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgImprimirCupomPdv.CHAVE, {
        valor: dados.valor
      });
      res.json({
        message: dados.valor === 'ATIVADO'
          ? 'Impressão automática de cupom ATIVADA.'
          : 'Impressão automática de cupom DESATIVADA.',
        ...dados
      });
    });
  }
);

router.put(
  '/pdv_exigir_ncm_cadastro',
  cfgExigirNcmPdv.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgExigirNcmPdv.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgExigirNcmPdv.CHAVE, {
        valor: dados.valor
      });
      res.json({
        message: dados.valor === 'ATIVADO'
          ? 'PDV vai pedir NCM e gravar no cadastro quando o produto não tiver.'
          : 'Pedido de NCM no PDV DESATIVADO.',
        ...dados
      });
    });
  }
);

router.get('/fechamento_fiscal_do_dia', (req, res) => {
  cfgFechamentoFiscalDia.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.put(
  '/fechamento_fiscal_do_dia',
  cfgFechamentoFiscalDia.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgFechamentoFiscalDia.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgFechamentoFiscalDia.CHAVE, {
        valor: dados.valor
      });
      res.json({
        message: 'Configuração atualizada com sucesso',
        ...dados
      });
    });
  }
);

router.get('/empresa_controla_validade', (req, res) => {
  cfgValidadeEmpresa.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.put(
  '/empresa_controla_validade',
  cfgValidadeEmpresa.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgValidadeEmpresa.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgValidadeEmpresa.CHAVE, {
        valor: dados.valor,
        produtos_desmarcados: dados.produtos_desmarcados
      });
      res.json({
        message: dados.valor === 'DESATIVADO'
          ? `Validade DESATIVADA. ${dados.produtos_desmarcados} produto(s) desmarcado(s).`
          : 'Controle de validade da empresa ATIVADO.',
        ...dados
      });
    });
  }
);

router.get('/empresa_permite_venda_sem_estoque', (req, res) => {
  cfgVendaSemEstoque.ler(db, (err, dados) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(dados);
  });
});

router.put(
  '/empresa_permite_venda_sem_estoque',
  cfgVendaSemEstoque.exigirSuperAdminAlteracao,
  (req, res) => {
    cfgVendaSemEstoque.salvar(db, req.body && req.body.valor, (err, dados) => {
      if (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message });
      }
      auditarConfiguracao(req, 'atualizar_configuracao', cfgVendaSemEstoque.CHAVE, {
        valor: dados.valor
      });
      res.json({
        message: dados.valor === 'ATIVADO'
          ? 'Venda sem estoque ATIVADA. A baixa continua; o saldo pode ficar negativo.'
          : 'Venda sem estoque DESATIVADA. Volta a bloquear saldo insuficiente.',
        ...dados
      });
    });
  }
);

router.get('/', (req, res) => {
  db.all('SELECT * FROM configuracoes ORDER BY chave', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const perfil = String(req.user?.perfil || '').toUpperCase();
    const lista = perfil === 'SUPER_ADMIN'
      ? (rows || [])
      : (rows || []).filter((row) => !chaveReservadaSuperAdmin(row.chave));
    res.json(lista);
  });
});

router.get('/:chave', (req, res) => {
  const { chave } = req.params;
  db.get('SELECT * FROM configuracoes WHERE chave = ?', [chave], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});

router.put('/:chave', (req, res) => {
  const { chave } = req.params;
  const { valor } = req.body;

  if (cfgTransferenciaPdv.ehChave(chave)) {
    return cfgTransferenciaPdv.exigirSuperAdminAlteracao(req, res, () => {
      cfgTransferenciaPdv.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'atualizar_configuracao', chave, { valor: dados.valor });
        res.json({ message: 'Configuração atualizada com sucesso', ...dados });
      });
    });
  }

  if (cfgEditarPrecoUnitarioPdv.ehChave(chave)) {
    return cfgEditarPrecoUnitarioPdv.exigirSuperAdminAlteracao(req, res, () => {
      cfgEditarPrecoUnitarioPdv.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'atualizar_configuracao', chave, { valor: dados.valor });
        res.json({ message: 'Configuração atualizada com sucesso', ...dados });
      });
    });
  }

  if (cfgExigirNcmPdv.ehChave(chave)) {
    return cfgExigirNcmPdv.exigirSuperAdminAlteracao(req, res, () => {
      cfgExigirNcmPdv.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'atualizar_configuracao', chave, { valor: dados.valor });
        res.json({ message: 'Configuração atualizada com sucesso', ...dados });
      });
    });
  }

  if (cfgImprimirCupomPdv.ehChave(chave)) {
    return cfgImprimirCupomPdv.exigirSuperAdminAlteracao(req, res, () => {
      cfgImprimirCupomPdv.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'atualizar_configuracao', chave, { valor: dados.valor });
        res.json({ message: 'Configuração atualizada com sucesso', ...dados });
      });
    });
  }

  if (cfgValidadeEmpresa.ehChave(chave)) {
    return cfgValidadeEmpresa.exigirSuperAdminAlteracao(req, res, () => {
      cfgValidadeEmpresa.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'atualizar_configuracao', chave, {
          valor: dados.valor,
          produtos_desmarcados: dados.produtos_desmarcados
        });
        res.json({ message: 'Configuração atualizada com sucesso', ...dados });
      });
    });
  }

  if (cfgVendaSemEstoque.ehChave(chave)) {
    return cfgVendaSemEstoque.exigirSuperAdminAlteracao(req, res, () => {
      cfgVendaSemEstoque.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'atualizar_configuracao', chave, { valor: dados.valor });
        res.json({ message: 'Configuração atualizada com sucesso', ...dados });
      });
    });
  }

  console.log(`[CONFIG] Salvando configuração: chave=${chave}, valor=${valor}`);

  const query = `
    INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
    VALUES (?, ?, 'text', '', datetime('now', 'localtime'))
    ON CONFLICT(chave) DO UPDATE SET
      valor = excluded.valor,
      updated_at = excluded.updated_at
  `;

  db.run(query, [chave, valor], function(err) {
    if (err) {
      console.error(`[CONFIG] Erro ao salvar configuração ${chave}:`, err);
      res.status(500).json({ error: err.message });
      return;
    }

    console.log(`[CONFIG] Configuração ${chave} salva com sucesso. Changes: ${this.changes}`);

    if (chave === 'produto_identidade_enabled') {
      try {
        const { setProdutoIdentidadeEnabled } = require('../motores/produto-identidade/config/produtoIdentidadeFlags');
        const v = String(valor || '').toLowerCase();
        setProdutoIdentidadeEnabled(v === '1' || v === 'true' || v === 'sim');
      } catch (e) {
        console.warn('[CONFIG] Falha ao sincronizar flag MIP em memória:', e.message);
      }
    }

    auditarConfiguracao(req, 'atualizar_configuracao', chave, { valor });
    res.json({ message: 'Configuração atualizada com sucesso' });
  });
});

router.post('/', (req, res) => {
  const { chave, valor, tipo, descricao } = req.body;

  if (cfgTransferenciaPdv.ehChave(chave)) {
    return cfgTransferenciaPdv.exigirSuperAdminAlteracao(req, res, () => {
      cfgTransferenciaPdv.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'criar_configuracao', chave, { valor: dados.valor, tipo, descricao });
        res.json({ message: 'Configuração criada com sucesso', ...dados });
      });
    });
  }

  if (cfgValidadeEmpresa.ehChave(chave)) {
    return cfgValidadeEmpresa.exigirSuperAdminAlteracao(req, res, () => {
      cfgValidadeEmpresa.salvar(db, valor, (err, dados) => {
        if (err) {
          const status = err.status || 500;
          return res.status(status).json({ error: err.message });
        }
        auditarConfiguracao(req, 'criar_configuracao', chave, {
          valor: dados.valor,
          produtos_desmarcados: dados.produtos_desmarcados,
          tipo,
          descricao
        });
        res.json({ message: 'Configuração criada com sucesso', ...dados });
      });
    });
  }

  db.run(`
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES (?, ?, ?, ?)
  `, [chave, valor, tipo, descricao], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    auditarConfiguracao(req, 'criar_configuracao', chave, { valor, tipo, descricao });
    res.json({ id: this.lastID, message: 'Configuração criada com sucesso' });
  });
});

module.exports = router;
