const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const { obterSearchService } = require('../motores/mib');
const {
  listarFornecedores,
  filtrarFornecedoresPorTermo,
  findOrCreateFornecedor
} = require('../services/FornecedorCadastroSimplesService');
const { resolverMunicipioDestinatario } = require('../services/fiscal/municipioIbge');

// LISTAR TODOS (com busca via SearchService quando há termo)
router.get('/', async (req, res) => {
  const { busca } = req.query;
  const termoSimples = String(req.query.q || '').trim();

  if (busca && String(busca).trim() !== '') {
    try {
      const user = req.user || {};
      const resultado = await obterSearchService(db).search({
        entity: 'fornecedor',
        query: String(busca).trim(),
        limite: 200,
        operador_id: user.id,
        permissoes: user.permissoes || ['fornecedores'],
        perfil: user.perfil,
        role: user.role || 'admin',
        origem: 'api.fornecedores',
        user
      });
      return res.json(resultado.itens || []);
    } catch (err) {
      console.error('Erro ao buscar fornecedores (SearchService):', err.message);
      return res.status(500).json({ error: 'Erro ao listar fornecedores.' });
    }
  }

  try {
    const lista = await listarFornecedores(db);
    return res.json(filtrarFornecedoresPorTermo(lista, termoSimples));
  } catch (err) {
    console.error('Erro ao listar fornecedores:', err.message);
    return res.status(500).json({ error: 'Erro ao listar fornecedores.' });
  }
});

// Smart Select — encontra ou cria pelo nome (campo opcional no cadastro de produto)
router.post('/find-or-create', async (req, res) => {
  try {
    const resultado = await findOrCreateFornecedor(db, req.body?.nome, {
      auditar: (acao, fornecedorId, detalhes) => {
        gravarAuditoria({
          usuario_id: req.user?.id || null,
          usuario_nome: req.user?.nome || req.user?.username || null,
          modulo: 'fornecedores',
          acao,
          referencia_tipo: 'fornecedor',
          referencia_id: fornecedorId || null,
          detalhes,
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria de fornecedor:', auditErr));
      }
    });
    const status = resultado.criado ? 201 : 200;
    return res.status(status).json({
      ...resultado.fornecedor,
      criado: resultado.criado
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Erro ao processar fornecedor' });
  }
});

// BUSCAR POR ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM fornecedores WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Erro ao buscar fornecedor:', err.message);
      return res.status(500).json({ error: 'Erro ao buscar fornecedor.' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    }

    res.json(row);
  });
});

// CRIAR
router.post('/', (req, res) => {
  const {
    nome,
    razao_social,
    cpf_cnpj,
    inscricao_estadual,
    telefone,
    email,
    contato,
    cep,
    rua,
    numero,
    bairro,
    cidade,
    uf,
    observacoes
  } = req.body || {};

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'O nome do fornecedor é obrigatório.' });
  }

  const nomeLimpo = String(nome).trim();
  const razaoSocialLimpa = razao_social ? String(razao_social).trim() : null;
  const cpfCnpjLimpo = cpf_cnpj ? String(cpf_cnpj).trim() : null;
  const inscricaoEstadualLimpa = inscricao_estadual ? String(inscricao_estadual).trim() : null;
  const telefoneLimpo = telefone ? String(telefone).trim() : null;
  const emailLimpo = email ? String(email).trim() : null;
  const contatoLimpo = contato ? String(contato).trim() : null;
  const cepLimpo = cep ? String(cep).trim() : null;
  const ruaLimpa = rua ? String(rua).trim() : null;
  const numeroLimpo = numero ? String(numero).trim() : null;
  const bairroLimpo = bairro ? String(bairro).trim() : null;
  const cidadeLimpa = cidade ? String(cidade).trim() : null;
  const ufLimpa = uf ? String(uf).trim().toUpperCase() : null;
  const observacoesLimpas = observacoes ? String(observacoes).trim() : null;

  db.run(`
    INSERT INTO fornecedores (
      nome,
      razao_social,
      cpf_cnpj,
      inscricao_estadual,
      telefone,
      email,
      contato,
      cep,
      rua,
      numero,
      bairro,
      cidade,
      uf,
      codigo_municipio,
      observacoes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    nomeLimpo,
    razaoSocialLimpa,
    cpfCnpjLimpo,
    inscricaoEstadualLimpa,
    telefoneLimpo,
    emailLimpo,
    contatoLimpo,
    cepLimpo,
    ruaLimpa,
    numeroLimpo,
    bairroLimpo,
    cidadeLimpa,
    ufLimpa,
    resolverMunicipioDestinatario({ cidade: cidadeLimpa, uf: ufLimpa }),
    observacoesLimpas
  ], function (err) {
    if (err) {
      console.error('Erro ao criar fornecedor:', err.message);

      if (err.message.includes('UNIQUE constraint failed: fornecedores.cpf_cnpj')) {
        return res.status(400).json({
          error: 'Já existe um fornecedor com este CPF/CNPJ.'
        });
      }

      return res.status(500).json({
        error: 'Erro ao cadastrar fornecedor: ' + err.message
      });
    }

    // registrar auditoria
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'fornecedores',
      acao: 'criar_fornecedor',
      referencia_tipo: 'fornecedor',
      referencia_id: this.lastID,
      detalhes: { nome: nomeLimpo, cpf_cnpj: cpfCnpjLimpo },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de fornecedor:', auditErr));

    res.json({
      id: this.lastID,
      message: 'Fornecedor cadastrado com sucesso.'
    });
  });
});

// ATUALIZAR
router.put('/:id', (req, res) => {
  const { id } = req.params;

  const {
    nome,
    razao_social,
    cpf_cnpj,
    inscricao_estadual,
    telefone,
    email,
    contato,
    cep,
    rua,
    numero,
    bairro,
    cidade,
    uf,
    observacoes
  } = req.body || {};

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'O nome do fornecedor é obrigatório.' });
  }

  const nomeLimpo = String(nome).trim();
  const razaoSocialLimpa = razao_social ? String(razao_social).trim() : null;
  const cpfCnpjLimpo = cpf_cnpj ? String(cpf_cnpj).trim() : null;
  const inscricaoEstadualLimpa = inscricao_estadual ? String(inscricao_estadual).trim() : null;
  const telefoneLimpo = telefone ? String(telefone).trim() : null;
  const emailLimpo = email ? String(email).trim() : null;
  const contatoLimpo = contato ? String(contato).trim() : null;
  const cepLimpo = cep ? String(cep).trim() : null;
  const ruaLimpa = rua ? String(rua).trim() : null;
  const numeroLimpo = numero ? String(numero).trim() : null;
  const bairroLimpo = bairro ? String(bairro).trim() : null;
  const cidadeLimpa = cidade ? String(cidade).trim() : null;
  const ufLimpa = uf ? String(uf).trim().toUpperCase() : null;
  const observacoesLimpas = observacoes ? String(observacoes).trim() : null;

  db.run(`
    UPDATE fornecedores SET
      nome = ?,
      razao_social = ?,
      cpf_cnpj = ?,
      inscricao_estadual = ?,
      telefone = ?,
      email = ?,
      contato = ?,
      cep = ?,
      rua = ?,
      numero = ?,
      bairro = ?,
      cidade = ?,
      uf = ?,
      codigo_municipio = ?,
      observacoes = ?
    WHERE id = ?
  `, [
    nomeLimpo,
    razaoSocialLimpa,
    cpfCnpjLimpo,
    inscricaoEstadualLimpa,
    telefoneLimpo,
    emailLimpo,
    contatoLimpo,
    cepLimpo,
    ruaLimpa,
    numeroLimpo,
    bairroLimpo,
    cidadeLimpa,
    ufLimpa,
    resolverMunicipioDestinatario({ cidade: cidadeLimpa, uf: ufLimpa }),
    observacoesLimpas,
    id
  ], function (err) {
    if (err) {
      console.error('Erro ao atualizar fornecedor:', err.message);

      if (err.message.includes('UNIQUE constraint failed: fornecedores.cpf_cnpj')) {
        return res.status(400).json({
          error: 'Já existe outro fornecedor com este CPF/CNPJ.'
        });
      }

      return res.status(500).json({
        error: 'Erro ao atualizar fornecedor: ' + err.message
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    }

    // auditoria de atualização
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'fornecedores',
      acao: 'atualizar_fornecedor',
      referencia_tipo: 'fornecedor',
      referencia_id: id,
      detalhes: { antes: null, depois: { nome: nomeLimpo, cpf_cnpj: cpfCnpjLimpo } },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de fornecedor:', auditErr));

    res.json({ message: 'Fornecedor atualizado com sucesso.' });
  });
});

// EXCLUIR
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM fornecedores WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Erro ao excluir fornecedor:', err.message);
      return res.status(500).json({ error: 'Erro ao excluir fornecedor.' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    }

    // auditoria de exclusão
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.nome || req.user?.username || null,
      modulo: 'fornecedores',
      acao: 'excluir_fornecedor',
      referencia_tipo: 'fornecedor',
      referencia_id: id,
      detalhes: {},
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de fornecedor:', auditErr));

    res.json({ message: 'Fornecedor excluído com sucesso.' });
  });
});

module.exports = router;