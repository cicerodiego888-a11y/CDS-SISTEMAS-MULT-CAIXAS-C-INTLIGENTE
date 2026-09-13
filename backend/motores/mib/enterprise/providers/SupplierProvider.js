'use strict';

const BaseSqlProvider = require('./BaseSqlProvider');

class SupplierProvider extends BaseSqlProvider {
  constructor(db) {
    super(db, {
      entity: 'fornecedor',
      aliases: ['fornecedores', 'supplier', 'suppliers'],
      permissao: 'fornecedores',
      tabela: 'fornecedores',
      select: 'id, nome, razao_social, cpf_cnpj, telefone, email, cidade, uf',
      camposTexto: ['nome', 'razao_social', 'email', 'contato', 'cidade'],
      camposNumero: ['cpf_cnpj', 'telefone'],
      orderBy: 'nome ASC'
    });
  }
}

module.exports = SupplierProvider;
