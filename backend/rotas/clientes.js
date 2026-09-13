const express = require('express');
const router = express.Router();
const db = require('../database');
const { verificarToken: autenticarToken } = require('../middleware/auth');
const { gravarAuditoria } = require('../services/auditoria');
const { obterSearchService } = require('../motores/mib');

// Listar todos os clientes
router.get('/', (req, res) => {
  db.all('SELECT * FROM clientes ORDER BY nome', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Buscar clientes por termo — via SearchService (MIB-RC3.0)
router.get('/buscar', autenticarToken, async (req, res) => {
  const termo = (req.query.termo || '').trim();
  if (!termo) {
    return res.json([]);
  }

  try {
    const user = req.user || {};
    const resultado = await obterSearchService(db).search({
      entity: 'cliente',
      query: termo,
      limite: 20,
      operador_id: user.id,
      permissoes: user.permissoes || ['clientes'],
      perfil: user.perfil,
      role: user.role || 'admin',
      origem: 'api.clientes.buscar',
      user
    });
    const itens = (resultado.itens || []).map((c) => ({
      id: c.id,
      nome: c.nome,
      cpf_cnpj: c.cpf_cnpj,
      telefone: c.telefone
    }));
    return res.json(itens);
  } catch (err) {
    console.error('Erro ao buscar clientes (SearchService):', err);
    return res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

// Vendas do cliente (histórico de compras)
router.get('/:id/vendas', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT v.*, (SELECT COUNT(*) FROM vendas_itens WHERE venda_id = v.id) as total_itens
    FROM vendas v
    WHERE v.cliente_id = ? AND v.status = 'concluida'
    ORDER BY v.data_venda DESC, v.id DESC
  `, [id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Buscar cliente por ID
router.get('/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM clientes WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    // Garante que todos os campos de endereço existam (evita undefined)
    if (row) {
      row.cep = row.cep || '';
      row.rua = row.rua || '';
      row.numero = row.numero || '';
      row.bairro = row.bairro || '';
      row.cidade = row.cidade || '';
      row.uf = row.uf || '';
    }
    res.json(row);
  });
});

// Criar cliente
router.post('/', (req, res) => {
  const { nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito } = req.body;
  // Validação básica
  if (!nome) {
    return res.status(400).json({ error: 'O campo nome é obrigatório.' });
  }

  // Validação de CPF/CNPJ duplicado
  const cpfCnpjLimpo = String(req.body.cpf_cnpj || '').replace(/\D/g, '');

  if (cpfCnpjLimpo) {
    db.get(
      'SELECT id, nome, cpf_cnpj FROM clientes WHERE REPLACE(REPLACE(REPLACE(cpf_cnpj, ".", ""), "-", ""), "/", "") = ?',
      [cpfCnpjLimpo],
      (err, clienteExistente) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao verificar CPF/CNPJ: ' + err.message });
        }

        if (clienteExistente) {
          return res.status(409).json({
            success: false,
            message: `Já existe um cliente cadastrado com este CPF/CNPJ: ${clienteExistente.nome}`
          });
        }

        req.body.cpf_cnpj = cpfCnpjLimpo;
        inserirCliente(req, res);
      }
    );
  } else {
    inserirCliente(req, res);
  }
});

function inserirCliente(req, res) {
  const { nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito } = req.body;

  // Garante que limite_credito seja número
  let limiteCreditoNum = parseFloat(limite_credito);
  if (isNaN(limiteCreditoNum)) limiteCreditoNum = 0;
  db.run(`
    INSERT INTO clientes (nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito, credito_atual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `, [nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limiteCreditoNum],
    function(err) {
      if (err) {
        res.status(500).json({ error: 'Erro ao criar cliente: ' + err.message });
        return;
      }
      // auditoria de criação de cliente
      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'clientes',
        acao: 'criar_cliente',
        referencia_tipo: 'cliente',
        referencia_id: this.lastID,
        detalhes: { nome },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de cliente:', auditErr));

      res.json({ id: this.lastID, message: 'Cliente criado com sucesso' });
    });
}

// Atualizar cliente
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limite_credito } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'O campo nome é obrigatório.' });
  }
  let limiteCreditoNum = parseFloat(limite_credito);
  if (isNaN(limiteCreditoNum)) limiteCreditoNum = 0;
  db.run(`
    UPDATE clientes 
    SET nome = ?, cpf_cnpj = ?, telefone = ?, email = ?, cep = ?, rua = ?, numero = ?, bairro = ?, cidade = ?, uf = ?, limite_credito = ?
    WHERE id = ?
  `, [nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, limiteCreditoNum, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: 'Erro ao atualizar cliente: ' + err.message });
        return;
      }
      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'clientes',
        acao: 'atualizar_cliente',
        referencia_tipo: 'cliente',
        referencia_id: id,
        detalhes: { antes: null, depois: req.body },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de cliente:', auditErr));

      res.json({ message: 'Cliente atualizado com sucesso' });
    });
});

// Deletar cliente
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    'SELECT COUNT(*) as total FROM vendas WHERE cliente_id = ?',
    [id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (row && row.total > 0) {
        return res.status(400).json({
          error: 'Não é possível excluir o cliente, pois existem vendas vinculadas a este cadastro.'
        });
      }

      db.run('DELETE FROM clientes WHERE id = ?', [id], function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        gravarAuditoria({
          usuario_id: req.user?.id || null,
          usuario_nome: req.user?.nome || req.user?.username || null,
          modulo: 'clientes',
          acao: 'excluir_cliente',
          referencia_tipo: 'cliente',
          referencia_id: id,
          detalhes: {},
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de cliente:', auditErr));

        res.json({ message: 'Cliente deletado com sucesso' });
      });
    }
  );
});

module.exports = router;
