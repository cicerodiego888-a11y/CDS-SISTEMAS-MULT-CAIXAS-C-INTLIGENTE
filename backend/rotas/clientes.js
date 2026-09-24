const express = require('express');
const router = express.Router();
const db = require('../database');
const { verificarToken: autenticarToken } = require('../middleware/auth');
const { gravarAuditoria } = require('../services/auditoria');
const { obterSearchService } = require('../motores/mib');
const {
  prepararDocumentoCadastro,
  apenasDigitos,
  sqlColunaSomenteDigitos
} = require('../services/cadastro/documentoCpfCnpj');
const { validarLimiteCreditoCadastro } = require('../services/cadastro/limiteCreditoCliente');
const { resolverMunicipioDestinatario } = require('../services/fiscal/municipioIbge');

/**
 * Normaliza cpf_cnpj no cadastro de cliente (mesma política POST/PUT).
 * CNPJ (14) → dígitos + validação DV; CPF (11) → só dígitos; vazio → ''.
 */
function normalizarDocumentoCliente(valor) {
  const bruto = valor == null ? '' : String(valor).trim();
  if (!bruto) return { ok: true, valor: '' };

  const digitos = apenasDigitos(bruto);
  if (digitos.length === 14) {
    const doc = prepararDocumentoCadastro(digitos);
    if (!doc.ok) return doc;
    return { ok: true, valor: doc.valor };
  }

  return { ok: true, valor: digitos };
}

function textoOuNull(valor) {
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

function montarCamposCliente(body) {
  const cidade = textoOuNull(body.cidade);
  const uf = textoOuNull(body.uf);
  const ufLimpa = uf ? uf.toUpperCase() : null;
  const codigoInformado = textoOuNull(body.codigo_municipio);

  let codigoMunicipio = null;
  try {
    codigoMunicipio = resolverMunicipioDestinatario({
      cidade,
      uf: ufLimpa,
      codigoMunicipio: codigoInformado
    });
  } catch (_) {
    codigoMunicipio = null;
  }

  return {
    nome: String(body.nome || '').trim(),
    razao_social: textoOuNull(body.razao_social),
    telefone: textoOuNull(body.telefone),
    email: textoOuNull(body.email),
    contato: textoOuNull(body.contato),
    cep: textoOuNull(body.cep),
    rua: textoOuNull(body.rua || body.logradouro),
    numero: textoOuNull(body.numero),
    bairro: textoOuNull(body.bairro),
    cidade,
    uf: ufLimpa,
    codigo_municipio: codigoMunicipio,
    inscricao_estadual: textoOuNull(body.inscricao_estadual),
    observacoes: textoOuNull(body.observacoes)
  };
}

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
    if (row) {
      row.cep = row.cep || '';
      row.rua = row.rua || '';
      row.numero = row.numero || '';
      row.bairro = row.bairro || '';
      row.cidade = row.cidade || '';
      row.uf = row.uf || '';
      row.inscricao_estadual = row.inscricao_estadual || '';
      row.codigo_municipio = row.codigo_municipio || '';
      row.razao_social = row.razao_social || '';
      row.contato = row.contato || '';
      row.observacoes = row.observacoes || '';
      row.utiliza_limite_credito = Number(row.utiliza_limite_credito) === 1 ? 1 : 0;
    }
    res.json(row);
  });
});

// Criar cliente
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.nome || !String(body.nome).trim()) {
    return res.status(400).json({ error: 'O campo nome é obrigatório.' });
  }

  const doc = normalizarDocumentoCliente(body.cpf_cnpj != null ? body.cpf_cnpj : body.documento);
  if (!doc.ok) {
    return res.status(doc.status || 400).json({ error: doc.error });
  }

  const limite = validarLimiteCreditoCadastro(body);
  if (!limite.ok) {
    return res.status(limite.status || 400).json({ error: limite.error });
  }

  const cpfCnpjLimpo = doc.valor;
  const campos = montarCamposCliente(body);

  const inserir = () => {
    db.run(`
      INSERT INTO clientes (
        nome, razao_social, cpf_cnpj, telefone, email, contato, cep, rua, numero, bairro, cidade, uf,
        limite_credito, credito_atual, utiliza_limite_credito, codigo_municipio, inscricao_estadual, observacoes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `, [
      campos.nome,
      campos.razao_social,
      cpfCnpjLimpo,
      campos.telefone,
      campos.email,
      campos.contato,
      campos.cep,
      campos.rua,
      campos.numero,
      campos.bairro,
      campos.cidade,
      campos.uf,
      limite.limite,
      limite.utiliza,
      campos.codigo_municipio,
      campos.inscricao_estadual,
      campos.observacoes
    ], function onInsert(err) {
      if (err) {
        if (String(err.message || '').includes('UNIQUE constraint failed: clientes.cpf_cnpj')) {
          return res.status(409).json({
            success: false,
            message: 'Já existe um cliente cadastrado com este CPF/CNPJ.'
          });
        }
        return res.status(500).json({ error: 'Erro ao criar cliente: ' + err.message });
      }

      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'clientes',
        acao: 'criar_cliente',
        referencia_tipo: 'cliente',
        referencia_id: this.lastID,
        detalhes: { nome: campos.nome, cpf_cnpj: cpfCnpjLimpo },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de cliente:', auditErr));

      res.json({ id: this.lastID, message: 'Cliente criado com sucesso' });
    });
  };

  if (!cpfCnpjLimpo) {
    return inserir();
  }

  db.get(
    `SELECT id, nome, cpf_cnpj FROM clientes WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?`,
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
      return inserir();
    }
  );
});

// Atualizar cliente
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  if (!body.nome || !String(body.nome).trim()) {
    return res.status(400).json({ error: 'O campo nome é obrigatório.' });
  }

  const doc = normalizarDocumentoCliente(body.cpf_cnpj != null ? body.cpf_cnpj : body.documento);
  if (!doc.ok) {
    return res.status(doc.status || 400).json({ error: doc.error });
  }

  const limite = validarLimiteCreditoCadastro(body);
  if (!limite.ok) {
    return res.status(limite.status || 400).json({ error: limite.error });
  }

  const cpfCnpjLimpo = doc.valor;
  const campos = montarCamposCliente(body);

  const executarUpdate = () => {
    db.run(`
      UPDATE clientes
      SET nome = ?, razao_social = ?, cpf_cnpj = ?, telefone = ?, email = ?, contato = ?,
          cep = ?, rua = ?, numero = ?, bairro = ?, cidade = ?, uf = ?,
          limite_credito = ?, utiliza_limite_credito = ?,
          codigo_municipio = ?, inscricao_estadual = ?, observacoes = ?
      WHERE id = ?
    `, [
      campos.nome,
      campos.razao_social,
      cpfCnpjLimpo,
      campos.telefone,
      campos.email,
      campos.contato,
      campos.cep,
      campos.rua,
      campos.numero,
      campos.bairro,
      campos.cidade,
      campos.uf,
      limite.limite,
      limite.utiliza,
      campos.codigo_municipio,
      campos.inscricao_estadual,
      campos.observacoes,
      id
    ], function onUpdate(err) {
      if (err) {
        if (String(err.message || '').includes('UNIQUE constraint failed: clientes.cpf_cnpj')) {
          return res.status(409).json({
            success: false,
            message: 'Já existe um cliente cadastrado com este CPF/CNPJ.'
          });
        }
        return res.status(500).json({ error: 'Erro ao atualizar cliente: ' + err.message });
      }

      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.nome || req.user?.username || null,
        modulo: 'clientes',
        acao: 'atualizar_cliente',
        referencia_tipo: 'cliente',
        referencia_id: id,
        detalhes: {
          cpf_cnpj: cpfCnpjLimpo,
          utiliza_limite_credito: limite.utiliza,
          limite_credito: limite.limite
        },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de cliente:', auditErr));

      res.json({ message: 'Cliente atualizado com sucesso' });
    });
  };

  if (!cpfCnpjLimpo) {
    return executarUpdate();
  }

  db.get(
    `SELECT id, nome, cpf_cnpj FROM clientes
     WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ? AND id != ?`,
    [cpfCnpjLimpo, id],
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
      return executarUpdate();
    }
  );
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

      db.run('DELETE FROM clientes WHERE id = ?', [id], function onDelete(err) {
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
