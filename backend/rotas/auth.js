const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { gravarAuditoria } = require('../services/auditoria');
const db = require('../database');
const {
  JWT_SECRET,
  PERMISSOES_DISPONIVEIS,
  verificarToken,
  exigirAdmin,
  exigirSuperAdmin,
  verificarPermissaoEspecifica,
  exigirPerfilAjusteEstoque,
  buscarPermissoesUsuario
} = require('../middleware/auth');

/** RC5.1.4 — jti de tokens de supervisor já consumidos (jti → expMs). */
const supervisorJtIsUsados = new Map();

function gerarSupervisorJti() {
  return crypto.randomUUID();
}

function limparSupervisorJtIsExpirados(agora = Date.now()) {
  for (const [jti, expMs] of supervisorJtIsUsados) {
    if (expMs != null && agora > expMs) {
      supervisorJtIsUsados.delete(jti);
    }
  }
}

/**
 * RC5.1.4 — registra uso único do jti. Retorna false se já estava utilizado.
 * @param {string} jti
 * @param {number} [expMs]
 * @returns {boolean}
 */
function registrarUsoSupervisorJti(jti, expMs) {
  if (!jti) return false;
  limparSupervisorJtIsExpirados();
  if (supervisorJtIsUsados.has(jti)) return false;
  supervisorJtIsUsados.set(
    jti,
    expMs != null ? Number(expMs) : Date.now() + 15 * 60 * 1000
  );
  return true;
}

/** Uso em testes — limpa o registro de jtis consumidos. */
function limparSupervisorTokensUsados() {
  supervisorJtIsUsados.clear();
}

function round3Escopo(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

/**
 * RC5.1.5 — normaliza escopo do token / operação.
 * Claims: pedido_id, produtos[], quantidades[] (aprovadas).
 * @param {object} raw
 * @returns {{ pedido_id: number|null, produtos: number[], quantidades: number[] }}
 */
function normalizarEscopoSupervisor(raw = {}) {
  const pedidoRaw = raw.pedido_id != null ? raw.pedido_id : raw.pedidoId;
  const pedidoId = pedidoRaw != null ? Number(pedidoRaw) : null;

  const pares = [];
  if (Array.isArray(raw.itens) && raw.itens.length) {
    for (const item of raw.itens) {
      pares.push({
        produto_id: Number(item.produto_id || item.produtoId),
        quantidade: round3Escopo(item.quantidade ?? item.quantidade_aprovada)
      });
    }
  } else {
    const produtos = Array.isArray(raw.produtos) ? raw.produtos : [];
    const quantidades = Array.isArray(raw.quantidades)
      ? raw.quantidades
      : (Array.isArray(raw.quantidades_aprovadas) ? raw.quantidades_aprovadas : []);
    for (let i = 0; i < produtos.length; i += 1) {
      const p = produtos[i];
      const q = quantidades[i];
      pares.push({
        produto_id: Number(p && typeof p === 'object' ? (p.produto_id || p.produtoId) : p),
        quantidade: round3Escopo(q && typeof q === 'object' ? (q.quantidade ?? q.quantidade_aprovada) : q)
      });
    }
  }

  const map = new Map();
  for (const par of pares) {
    if (!Number.isInteger(par.produto_id) || par.produto_id <= 0) continue;
    map.set(par.produto_id, round3Escopo((map.get(par.produto_id) || 0) + par.quantidade));
  }

  const agregados = [...map.entries()]
    .map(([produto_id, quantidade]) => ({ produto_id, quantidade }))
    .sort((a, b) => a.produto_id - b.produto_id);

  return {
    pedido_id: Number.isInteger(pedidoId) && pedidoId > 0 ? pedidoId : null,
    produtos: agregados.map((p) => p.produto_id),
    quantidades: agregados.map((p) => p.quantidade)
  };
}

function escoposSupervisorIguais(a, b) {
  if (!a || !b) return false;
  if (a.pedido_id !== b.pedido_id) return false;
  if (a.produtos.length !== b.produtos.length) return false;
  for (let i = 0; i < a.produtos.length; i += 1) {
    if (a.produtos[i] !== b.produtos[i]) return false;
    if (Math.abs(Number(a.quantidades[i]) - Number(b.quantidades[i])) > 1e-9) return false;
  }
  return true;
}

/**
 * RC5.1.5 — compara claims do token com a operação em execução.
 * @param {object} userPayload
 * @param {object} escopoOperacao
 */
function assertEscopoSupervisorToken(userPayload, escopoOperacao) {
  const tokenEscopo = normalizarEscopoSupervisor({
    pedido_id: userPayload.pedido_id,
    produtos: userPayload.produtos,
    quantidades: userPayload.quantidades != null
      ? userPayload.quantidades
      : userPayload.quantidades_aprovadas
  });
  const operacao = normalizarEscopoSupervisor(escopoOperacao);
  if (!escoposSupervisorIguais(tokenEscopo, operacao)) {
    const err = new Error('Token de autorização fora do escopo da operação.');
    err.code = 'TOKEN_FORA_DO_ESCOPO';
    throw err;
  }
}

function parsePositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function auditarAcaoUsuario(req, acao, referenciaId, detalhes = {}) {
  const usuario = req.user || {};
  gravarAuditoria({
    usuario_id: usuario.id || null,
    usuario_nome: usuario.username || usuario.nome || null,
    modulo: 'usuarios',
    acao,
    referencia_tipo: 'usuario',
    referencia_id: referenciaId,
    detalhes: { ...detalhes, ip: req.ip || null },
    ip_requisicao: req.ip || null
  }).catch((auditErr) => console.error(`Erro ao gravar auditoria (${acao}):`, auditErr));
}

function responderErroInternoLogin(res, contexto, err) {
  console.error(`[LOGIN] ${contexto}:`, err);
  const mensagemBusy = err && /SQLITE_BUSY/i.test(String(err.message || ''));
  return res.status(mensagemBusy ? 503 : 500).json({
    error: mensagemBusy
      ? 'Banco de dados ocupado. Aguarde alguns segundos e tente novamente.'
      : 'Erro interno do servidor. Tente novamente.'
  });
}

function dbGetComRetry(sql, params, tentativasRestantes, callback) {
  db.get(sql, params, (err, row) => {
    if (err && /SQLITE_BUSY/i.test(String(err.message || '')) && tentativasRestantes > 0) {
      return setTimeout(
        () => dbGetComRetry(sql, params, tentativasRestantes - 1, callback),
        250
      );
    }
    callback(err, row);
  });
}

function finalizarLoginComUsuario(req, res, usuario) {
  buscarPermissoesUsuario(usuario.id, (errPerm, permissoes) => {
    if (errPerm) {
      return responderErroInternoLogin(res, 'ERRO PERMISSÕES', errPerm);
    }

    if (usuario.role === 'admin') {
      permissoes = PERMISSOES_DISPONIVEIS;
    }

    const terminalId = parsePositiveInteger(req.body?.terminal_id);
    const caixaSessaoId = parsePositiveInteger(req.body?.caixa_sessao_id);

    try {
      const token = jwt.sign(
        {
          id: usuario.id,
          usuario_id: usuario.id,
          username: usuario.username,
          nome: usuario.nome || usuario.username,
          role: usuario.role,
          perfil: usuario.perfil || 'USUARIO',
          permissoes,
          terminal_id: terminalId,
          caixa_sessao_id: caixaSessaoId
        },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.json({
        token,
        user: {
          id: usuario.id,
          usuario_id: usuario.id,
          username: usuario.username,
          role: usuario.role,
          perfil: usuario.perfil || 'USUARIO',
          nome: usuario.nome || usuario.username,
          permissoes,
          terminal_id: terminalId,
          caixa_sessao_id: caixaSessaoId,
          troca_senha_obrigatoria: Number(usuario.troca_senha_obrigatoria) === 1
        },
        troca_senha_obrigatoria: Number(usuario.troca_senha_obrigatoria) === 1
      });

      gravarAuditoria({
        usuario_id: usuario.id,
        usuario_nome: usuario.username,
        modulo: 'auth',
        acao: 'login',
        referencia_tipo: 'usuario',
        referencia_id: usuario.id,
        detalhes: { ip: req.ip, username: usuario.username },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => {
        console.error('Erro ao gravar auditoria de login:', auditErr);
      });
    } catch (tokenErr) {
      responderErroInternoLogin(res, 'ERRO TOKEN', tokenErr);
    }
  });
}

function isSupervisorPerfil(usuario) {
  const perfil = String(usuario?.perfil || '').trim().toUpperCase();
  return usuario?.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
}

function verificarSupervisorToken(token, escopoOperacao = null) {
  return new Promise((resolve, reject) => {
    if (!token) {
      const err = new Error('Token de supervisor ausente.');
      err.code = 'AUTORIZACAO_REJEITADA';
      return reject(err);
    }

    // Verificação síncrona para check-and-set atômico do jti (RC5.1.4)
    let user;
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      const err = new Error('Token de supervisor inválido ou expirado.');
      err.code = 'AUTORIZACAO_REJEITADA';
      return reject(err);
    }

    if (!isSupervisorPerfil(user)) {
      const err = new Error('Usuário não possui permissão de supervisor.');
      err.code = 'AUTORIZACAO_REJEITADA';
      return reject(err);
    }

    const jti = user.jti;
    if (!jti) {
      const err = new Error('Token de supervisor sem identificador único.');
      err.code = 'AUTORIZACAO_REJEITADA';
      return reject(err);
    }

    // RC5.1.5 — valida escopo antes de consumir o jti
    if (escopoOperacao != null) {
      try {
        assertEscopoSupervisorToken(user, escopoOperacao);
      } catch (escopoErr) {
        return reject(escopoErr);
      }
    }

    const expMs = user.exp != null ? Number(user.exp) * 1000 : undefined;
    if (!registrarUsoSupervisorJti(jti, expMs)) {
      const err = new Error('Token de autorização já utilizado.');
      err.code = 'TOKEN_JA_UTILIZADO';
      return reject(err);
    }

    resolve(user);
  });
}

router.post('/supervisor/authorize', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  db.get(
    `SELECT * FROM usuarios WHERE username = ? AND COALESCE(ativo, 1) = 1`,
    [username],
    (err, usuario) => {
      if (err) {
        console.error('ERRO SQL LOGIN:', err);
        return res.status(500).json({
          error: 'Erro interno ao autenticar.'
        });
      }

      if (!usuario) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      const senhaValida = bcrypt.compareSync(password, usuario.password_hash);

      if (!senhaValida) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      if (!isSupervisorPerfil(usuario)) {
        return res.status(403).json({ error: 'Apenas supervisor pode autorizar este desconto.' });
      }

      const terminalId = parsePositiveInteger(req.body?.terminal_id);
      const caixaSessaoId = parsePositiveInteger(req.body?.caixa_sessao_id);

      // RC5.1.5 — escopo da operação autorizada (pedido + produtos + quantidades)
      const escopo = normalizarEscopoSupervisor(req.body || {});

      // RC5.1.4 — jti único; expiresIn permanece 15m
      const token = jwt.sign(
        {
          id: usuario.id,
          usuario_id: usuario.id,
          username: usuario.username,
          nome: usuario.nome || usuario.username,
          role: usuario.role,
          perfil: usuario.perfil || 'USUARIO',
          terminal_id: terminalId,
          caixa_sessao_id: caixaSessaoId,
          pedido_id: escopo.pedido_id,
          produtos: escopo.produtos,
          quantidades: escopo.quantidades
        },
        JWT_SECRET,
        { expiresIn: '15m', jwtid: gerarSupervisorJti() }
      );

      res.json({
        token,
        user: {
          id: usuario.id,
          usuario_id: usuario.id,
          username: usuario.username,
          nome: usuario.nome || usuario.username,
          role: usuario.role,
          perfil: usuario.perfil || 'USUARIO',
          terminal_id: terminalId,
          caixa_sessao_id: caixaSessaoId
        },
        escopo
      });
    }
  );
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  if (typeof db.whenReady === 'function' && typeof db.isReady === 'function' && !db.isReady()) {
    return res.status(503).json({
      error: 'Sistema ainda inicializando. Aguarde alguns segundos e tente novamente.'
    });
  }

  dbGetComRetry(
    `SELECT * FROM usuarios WHERE username = ? AND COALESCE(ativo, 1) = 1`,
    [username],
    5,
    (err, usuario) => {
      if (err) {
        return responderErroInternoLogin(res, 'ERRO SQL LOGIN', err);
      }

      if (!usuario) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      if (!usuario.password_hash) {
        console.error('[LOGIN] Usuário sem password_hash:', usuario.username);
        return res.status(500).json({
          error: 'Conta de usuário incompleta. Contate o administrador.'
        });
      }

      let senhaValida = false;
      try {
        senhaValida = bcrypt.compareSync(password, usuario.password_hash);
      } catch (compareErr) {
        return responderErroInternoLogin(res, 'ERRO BCRYPT', compareErr);
      }

      if (!senhaValida) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      finalizarLoginComUsuario(req, res, usuario);
    }
  );
});

/**
 * Hotfix RC2.2 — detecta instalação em primeiro acesso (admin com troca obrigatória).
 * Público: usado pela tela de login para pré-preencher admin/1234.
 */
router.get('/primeiro-acesso', (req, res) => {
  db.get(
    `
      SELECT id, username
      FROM usuarios
      WHERE COALESCE(ativo, 1) = 1
        AND COALESCE(troca_senha_obrigatoria, 0) = 1
        AND LOWER(TRIM(username)) = 'admin'
      LIMIT 1
    `,
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao verificar primeiro acesso.' });
      }
      res.json({
        primeiro_acesso: Boolean(row),
        username: row ? 'admin' : null
      });
    }
  );
});

/**
 * Hotfix RC2.2 — troca de senha obrigatória no primeiro acesso.
 */
router.post('/primeiro-acesso/trocar-senha', verificarToken, (req, res) => {
  const usuarioId = req.user?.id || req.user?.usuario_id;
  const novaSenha = String(req.body?.nova_senha || req.body?.password || '').trim();
  const confirmar = String(req.body?.confirmar_senha || req.body?.confirmacao || '').trim();

  if (!usuarioId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  if (!novaSenha || novaSenha.length < 4) {
    return res.status(400).json({ error: 'Nova senha deve ter pelo menos 4 caracteres.' });
  }
  if (novaSenha !== confirmar) {
    return res.status(400).json({ error: 'Confirmação de senha não confere.' });
  }
  if (novaSenha === '1234') {
    return res.status(400).json({ error: 'Escolha uma senha diferente da senha inicial.' });
  }

  db.get(
    `SELECT id, username, troca_senha_obrigatoria FROM usuarios WHERE id = ? AND COALESCE(ativo, 1) = 1`,
    [usuarioId],
    (err, usuario) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao carregar usuário.' });
      }
      if (!usuario) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      if (Number(usuario.troca_senha_obrigatoria) !== 1) {
        return res.status(400).json({ error: 'Troca de senha no primeiro acesso não é necessária.' });
      }

      const hash = bcrypt.hashSync(novaSenha, 10);
      db.run(
        `UPDATE usuarios SET password_hash = ?, troca_senha_obrigatoria = 0 WHERE id = ?`,
        [hash, usuarioId],
        function updateErr(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Falha ao atualizar senha.' });
          }

          gravarAuditoria({
            usuario_id: usuarioId,
            usuario_nome: usuario.username,
            modulo: 'auth',
            acao: 'primeiro_acesso_trocar_senha',
            referencia_tipo: 'usuario',
            referencia_id: usuarioId,
            detalhes: { username: usuario.username },
            ip_requisicao: req.ip || null
          }).catch(() => {});

          res.json({
            success: true,
            troca_senha_obrigatoria: false,
            message: 'Senha alterada com sucesso.'
          });
        }
      );
    }
  );
});

router.post('/verificar', verificarToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

router.post('/logout', verificarToken, (req, res) => {
  const usuario = req.user;
  gravarAuditoria({
    usuario_id: usuario?.id || null,
    usuario_nome: usuario?.username || usuario?.nome || null,
    modulo: 'auth',
    acao: 'logout',
    referencia_tipo: 'usuario',
    referencia_id: usuario?.id || null,
    detalhes: { ip: req.ip },
    ip_requisicao: req.ip || null
  }).catch((auditErr) => {
    console.error('Erro ao gravar auditoria de logout:', auditErr);
  });

  res.json({ message: 'Logout realizado com sucesso' });
});

router.get('/permissoes-disponiveis', exigirAdmin, (req, res) => {
  res.json(PERMISSOES_DISPONIVEIS);
});

function filtroStatusUsuarios(status) {
  const s = String(status || 'ativos').toLowerCase();
  if (s === 'inativos') return 'WHERE COALESCE(ativo, 1) = 0';
  if (s === 'todos') return '';
  return 'WHERE COALESCE(ativo, 1) = 1';
}

router.get('/usuarios', verificarToken, (req, res) => {
  const filtroStatus = filtroStatusUsuarios(req.query.status);

  const responderLista = (perfilLogado) => {
    const perfil = String(perfilLogado || 'USUARIO').toUpperCase();
    // ADMIN (e demais) não enxergam SUPER_ADMIN na listagem.
    const ocultarSuperAdmin = perfil !== 'SUPER_ADMIN';
    let filtro = filtroStatus;
    if (ocultarSuperAdmin) {
      const clausulaSuper = `UPPER(TRIM(COALESCE(u.perfil, ''))) != 'SUPER_ADMIN'`;
      filtro = filtro
        ? `${filtro} AND ${clausulaSuper}`
        : `WHERE ${clausulaSuper}`;
    }

    db.all(
      `SELECT
          u.id,
          u.username,
          u.role,
          COALESCE(u.perfil, 'USUARIO') as perfil,
          COALESCE(u.pode_alterar_senhas, 0) as pode_alterar_senhas,
          COALESCE(u.ativo, 1) AS ativo,
          u.created_at,
          COALESCE(GROUP_CONCAT(up.permissao), '') AS permissoes
       FROM usuarios u
       LEFT JOIN usuario_permissoes up ON up.usuario_id = u.id AND up.permitido = 1
       ${filtro}
       GROUP BY u.id
       ORDER BY u.username`,
      [],
      (err, usuarios) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao listar usuários.' });
        }

        const usuariosComPermissoes = (usuarios || []).map(u => ({
          ...u,
          permissoes: u.permissoes ? u.permissoes.split(',') : []
        }));

        res.json(usuariosComPermissoes);
      }
    );
  };

  // Perfil atual do banco (não confiar só no JWT antigo)
  db.get(
    `SELECT COALESCE(perfil, 'USUARIO') AS perfil FROM usuarios WHERE id = ?`,
    [req.user?.id],
    (errPerfil, row) => {
      if (errPerfil) {
        return res.status(500).json({ error: 'Erro ao listar usuários.' });
      }
      responderLista(row?.perfil || req.user?.perfil || 'USUARIO');
    }
  );
});

router.post('/usuarios', exigirAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'operador';
  const perfil = ['SUPER_ADMIN', 'ADMIN', 'USUARIO'].includes(req.body?.perfil) ? req.body.perfil : 'USUARIO';
  const podeAlterarSenhas = req.body?.pode_alterar_senhas === 1 || req.body?.pode_alterar_senhas === true ? 1 : 0;
  const permissoes = Array.isArray(req.body?.permissoes) ? req.body.permissoes : [];

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
  }

  // Verificar se o usuário logado pode criar este perfil
  const perfilLogado = req.user?.perfil || 'USUARIO';
  if (perfil === 'SUPER_ADMIN' && perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Apenas SUPER_ADMIN pode criar outros SUPER_ADMINs.' });
  }

  db.get(
    'SELECT id, COALESCE(ativo, 1) AS ativo FROM usuarios WHERE username = ?',
    [username],
    (errBusca, existente) => {
    if (errBusca) {
      return res.status(500).json({ error: 'Erro ao validar usuário.' });
    }

    if (existente && existente.ativo === 1) {
      return res.status(409).json({ error: 'Já existe um usuário ativo com esse login.' });
    }

    const hash = bcrypt.hashSync(password, 10);

    const finalizarCadastro = (usuarioId) => {
      const detalhesCadastro = {
        username,
        role,
        perfil,
        reativado: !!(existente && existente.ativo === 0)
      };

      if (role === 'admin') {
        auditarAcaoUsuario(req, 'criar_usuario', usuarioId, detalhesCadastro);
        return res.json({
          id: usuarioId,
          username,
          role,
          perfil,
          pode_alterar_senhas: podeAlterarSenhas,
          permissoes: PERMISSOES_DISPONIVEIS,
          message: existente
            ? 'Usuário reativado com sucesso.'
            : 'Usuário administrador cadastrado com sucesso.'
        });
      }

      salvarPermissoes(usuarioId, permissoes, () => {
        auditarAcaoUsuario(req, 'criar_usuario', usuarioId, { ...detalhesCadastro, permissoes });
        res.json({
          id: usuarioId,
          username,
          role,
          perfil,
          pode_alterar_senhas: podeAlterarSenhas,
          permissoes,
          message: existente
            ? 'Usuário reativado com sucesso.'
            : 'Usuário cadastrado com sucesso.'
        });
      });
    };

    if (existente && existente.ativo === 0) {
      return db.run(
        `UPDATE usuarios
         SET password_hash = ?, role = ?, nome = ?, perfil = ?, pode_alterar_senhas = ?, ativo = 1
         WHERE id = ?`,
        [hash, role, username, perfil, podeAlterarSenhas, existente.id],
        function (errUpdate) {
          if (errUpdate) {
            return res.status(500).json({ error: 'Erro ao reativar usuário.' });
          }
          finalizarCadastro(existente.id);
        }
      );
    }

    db.run(
      `INSERT INTO usuarios (username, password_hash, role, nome, perfil, pode_alterar_senhas, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [username, hash, role, username, perfil, podeAlterarSenhas],
      function (errInsert) {
        if (errInsert) {
          return res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
        }

        finalizarCadastro(this.lastID);
      }
    );
  });
});

router.put('/usuarios/:id', exigirAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role === 'admin' ? 'admin' : 'operador';
  const perfil = ['SUPER_ADMIN', 'ADMIN', 'USUARIO'].includes(req.body?.perfil) ? req.body.perfil : 'USUARIO';
  const podeAlterarSenhas = req.body?.pode_alterar_senhas === 1 || req.body?.pode_alterar_senhas === true ? 1 : 0;
  const permissoes = Array.isArray(req.body?.permissoes) ? req.body.permissoes : [];
  const password = String(req.body?.password || '');

  if (!id) {
    return res.status(400).json({ error: 'ID inválido.' });
  }

  // Verificar se o usuário logado pode alterar para este perfil
  const perfilLogado = req.user?.perfil || 'USUARIO';
  if (perfil === 'SUPER_ADMIN' && perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Apenas SUPER_ADMIN pode definir perfil SUPER_ADMIN.' });
  }

  db.get('SELECT * FROM usuarios WHERE id = ?', [id], (errBusca, usuario) => {
    if (errBusca) {
      return res.status(500).json({ error: 'Erro ao localizar usuário.' });
    }

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Impedir que um ADMIN altere um SUPER_ADMIN (inclui troca de senha no PUT)
    if (String(usuario.perfil || '').toUpperCase() === 'SUPER_ADMIN' && String(perfilLogado).toUpperCase() !== 'SUPER_ADMIN') {
      return res.status(403).json({
        error: 'Apenas SUPER_ADMIN pode alterar outro SUPER_ADMIN.',
        mensagem: 'Apenas SUPER_ADMIN pode alterar a senha ou os dados de um Super Administrador.'
      });
    }

    const finalizar = () => {
      const detalhesAtualizacao = { role, perfil, pode_alterar_senhas: podeAlterarSenhas, senha_alterada: !!password };
      if (role === 'admin') {
        auditarAcaoUsuario(req, 'atualizar_usuario', id, detalhesAtualizacao);
        return res.json({
          message: 'Usuário atualizado com sucesso.',
          perfil,
          pode_alterar_senhas: podeAlterarSenhas
        });
      }

      salvarPermissoes(id, permissoes, () => {
        auditarAcaoUsuario(req, 'atualizar_usuario', id, { ...detalhesAtualizacao, permissoes });
        res.json({
          message: 'Usuário atualizado com sucesso.',
          perfil,
          pode_alterar_senhas: podeAlterarSenhas
        });
      });
    };

    if (password && password.length < 4) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres.' });
    }

    if (password) {
      const hash = bcrypt.hashSync(password, 10);

      db.run(
        `UPDATE usuarios SET role = ?, perfil = ?, pode_alterar_senhas = ?, password_hash = ? WHERE id = ?`,
        [role, perfil, podeAlterarSenhas, hash, id],
        (errUpdate) => {
          if (errUpdate) {
            return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
          }

          finalizar();
        }
      );
    } else {
      db.run(
        `UPDATE usuarios SET role = ?, perfil = ?, pode_alterar_senhas = ? WHERE id = ?`,
        [role, perfil, podeAlterarSenhas, id],
        (errUpdate) => {
          if (errUpdate) {
            return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
          }

          finalizar();
        }
      );
    }
  });
});

router.patch('/usuarios/:id/desativar', verificarToken, exigirSuperAdmin, (req, res) => {
  const idUsuario = req.params.id;
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();

  if (String(req.user.id) === String(idUsuario)) {
    return res.status(400).json({
      erro: 'Você não pode desativar seu próprio usuário.'
    });
  }

  db.run(
    `UPDATE usuarios SET ativo = 0 WHERE id = ?`,
    [idUsuario],
    function (err) {
      if (err) {
        console.error('Erro ao desativar usuário:', err);
        return res.status(500).json({ erro: 'Erro ao desativar usuário.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Usuário não encontrado.' });
      }

      auditarAcaoUsuario(req, 'desativar_usuario', idUsuario, { perfil_executor: perfilLogado });

      res.json({
        sucesso: true,
        mensagem: 'Usuário desativado com sucesso.'
      });
    }
  );
});

router.patch('/usuarios/:id/ativar', verificarToken, exigirSuperAdmin, (req, res) => {
  const idUsuario = req.params.id;
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();

  db.run(
    `UPDATE usuarios SET ativo = 1 WHERE id = ?`,
    [idUsuario],
    function (err) {
      if (err) {
        console.error('Erro ao reativar usuário:', err);
        return res.status(500).json({ erro: 'Erro ao reativar usuário.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Usuário não encontrado.' });
      }

      auditarAcaoUsuario(req, 'reativar_usuario', idUsuario, { perfil_executor: perfilLogado });

      res.json({
        sucesso: true,
        mensagem: 'Usuário reativado com sucesso.'
      });
    }
  );
});

router.delete('/usuarios/:id', verificarToken, exigirSuperAdmin, (req, res) => {
  const idUsuario = req.params.id;
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();

  if (String(req.user.id) === String(idUsuario)) {
    return res.status(400).json({
      erro: 'Você não pode excluir seu próprio usuário.'
    });
  }

  db.serialize(() => {
    db.run(`DELETE FROM usuario_permissoes WHERE usuario_id = ?`, [idUsuario]);
    db.run(`UPDATE caixa_movimentacoes SET usuario_id = NULL WHERE usuario_id = ?`, [idUsuario]);
    db.run(`UPDATE vendas_canceladas SET usuario_id = NULL WHERE usuario_id = ?`, [idUsuario]);

    db.run(`DELETE FROM usuarios WHERE id = ?`, [idUsuario], function (err) {
      if (err) {
        console.error('Erro ao excluir usuário:', err);
        return res.status(500).json({ erro: 'Erro ao excluir usuário.' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Usuário não encontrado.' });
      }

      auditarAcaoUsuario(req, 'excluir_usuario', idUsuario, { perfil_executor: perfilLogado });

      res.json({
        sucesso: true,
        mensagem: 'Usuário excluído permanentemente.'
      });
    });
  });
});

// Rota para alterar senha com verificação de permissões de perfil
router.post('/usuarios/alterar-senha', verificarToken, async (req, res) => {
  const { usuarioAlvoId, novaSenha } = req.body;
  const usuarioLogadoId = req.user?.id;

  if (!usuarioAlvoId || !novaSenha) {
    return res.status(400).json({ sucesso: false, mensagem: 'Dados incompletos.' });
  }

  if (novaSenha.length < 4) {
    return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter pelo menos 4 caracteres.' });
  }

  try {
    // Buscar dados do usuário logado
    const logado = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM usuarios WHERE id = ?', [usuarioLogadoId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!logado) {
      return res.status(401).json({ sucesso: false, mensagem: 'Usuário logado inválido.' });
    }

    // Buscar dados do usuário alvo
    const alvo = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM usuarios WHERE id = ?', [usuarioAlvoId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!alvo) {
      return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });
    }

    // Verificar permissões
    const perfilLogado = String(logado.perfil || 'USUARIO').toUpperCase();
    const perfilAlvo = String(alvo.perfil || 'USUARIO').toUpperCase();
    const podeAlterarSenhas = logado.pode_alterar_senhas === 1;

    // ADMIN nunca altera senha de SUPER_ADMIN (nem com pode_alterar_senhas).
    if (perfilAlvo === 'SUPER_ADMIN' && perfilLogado !== 'SUPER_ADMIN') {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Apenas SUPER_ADMIN pode alterar a senha de um Super Administrador.'
      });
    }

    let podeAlterar = false;

    if (perfilLogado === 'SUPER_ADMIN') {
      // SUPER_ADMIN pode alterar qualquer usuário
      podeAlterar = true;
    } else if (perfilLogado === 'ADMIN' && podeAlterarSenhas) {
      // ADMIN com permissão pode alterar USUARIO comum (nunca SUPER_ADMIN/ADMIN)
      if (perfilAlvo === 'USUARIO') {
        podeAlterar = true;
      }
    }

    // Usuário pode alterar sua própria senha (exceto o bloqueio SUPER_ADMIN acima)
    if (Number(usuarioLogadoId) === Number(usuarioAlvoId)) {
      podeAlterar = true;
    }

    if (!podeAlterar) {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Você não tem permissão para alterar esta senha.'
      });
    }

    // Criptografar nova senha
    const senhaHash = bcrypt.hashSync(novaSenha, 10);

    // Atualizar senha
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE usuarios SET password_hash = ?, troca_senha_obrigatoria = 0 WHERE id = ?',
        [senhaHash, usuarioAlvoId],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });

    auditarAcaoUsuario(req, 'alterar_senha', usuarioAlvoId, {
      alvo_username: alvo.username,
      propria_senha: usuarioLogadoId === usuarioAlvoId
    });

    res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso.' });

  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    res.status(500).json({ sucesso: false, mensagem: 'Erro interno do servidor.' });
  }
});

// Rota para obter perfil do usuário logado
router.get('/meu-perfil', verificarToken, (req, res) => {
  const usuarioId = req.user?.id;

  db.get(
    'SELECT id, username, nome, role, perfil, pode_alterar_senhas FROM usuarios WHERE id = ?',
    [usuarioId],
    (err, usuario) => {
      if (err || !usuario) {
        return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });
      }

      res.json({
        sucesso: true,
        perfil: usuario.perfil || 'USUARIO',
        podeAlterarSenhas: usuario.pode_alterar_senhas === 1,
        usuario: {
          id: usuario.id,
          username: usuario.username,
          nome: usuario.nome,
          role: usuario.role
        }
      });
    }
  );
});

const { obterRelatorioUsuario } = require('../services/usuarioRelatorioService');

router.get('/usuarios/:id/relatorio', verificarToken, exigirAdmin, async (req, res) => {
  const usuarioId = parsePositiveInteger(req.params.id);
  if (!usuarioId) {
    return res.status(400).json({ error: 'ID de usuário inválido.' });
  }

  try {
    const relatorio = await obterRelatorioUsuario(usuarioId, {
      inicio: req.query.inicio || null,
      fim: req.query.fim || null
    });
    res.json(relatorio);
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Erro ao gerar relatório do usuário:', err);
    res.status(500).json({ error: 'Erro ao gerar relatório do usuário.' });
  }
});

function salvarPermissoes(usuarioId, permissoes, callback) {
  const permissoesValidas = permissoes.filter(p => PERMISSOES_DISPONIVEIS.includes(p));

  db.serialize(() => {
    db.run(`DELETE FROM usuario_permissoes WHERE usuario_id = ?`, [usuarioId]);

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO usuario_permissoes 
      (usuario_id, permissao, permitido) 
      VALUES (?, ?, 1)
    `);

    permissoesValidas.forEach(p => {
      stmt.run(usuarioId, p);
    });

    stmt.finalize(() => callback && callback());
  });
}

module.exports = {
  router,
  verificarToken,
  exigirAdmin,
  exigirSuperAdmin,
  exigirPerfilAjusteEstoque,
  verificarSupervisorToken,
  isSupervisorPerfil,
  limparSupervisorTokensUsados,
  normalizarEscopoSupervisor,
  assertEscopoSupervisorToken,
  PERMISSOES_DISPONIVEIS,
  buscarPermissoesUsuario,
  verificarPermissaoEspecifica
};
