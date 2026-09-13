'use strict';

const BaseSqlProvider = require('./BaseSqlProvider');

/**
 * Funcionários / usuários / vendedores — tabela usuarios.
 */
class EmployeeProvider extends BaseSqlProvider {
  constructor(db) {
    super(db, {
      entity: 'usuario',
      aliases: [
        'usuarios', 'funcionario', 'funcionarios', 'employee',
        'vendedor', 'vendedores', 'operador', 'operadores'
      ],
      permissao: 'usuarios',
      tabela: 'usuarios',
      select: 'id, username, role',
      camposTexto: ['username', 'role'],
      camposNumero: [],
      whereBase: '1=1',
      orderBy: 'username ASC',
      mapRow: (r) => ({
        id: r.id,
        nome: r.username,
        username: r.username,
        role: r.role
      })
    });
  }

  autorizar(ctx) {
    const perfil = String(ctx.perfil || ctx.user?.perfil || '').toUpperCase();
    const role = String(ctx.role || ctx.user?.role || '').toLowerCase();
    if (role === 'admin' || perfil === 'SUPER_ADMIN' || perfil === 'ADMIN') return true;
    const perms = Array.isArray(ctx.permissoes) ? ctx.permissoes : [];
    return perms.includes('usuarios');
  }
}

module.exports = EmployeeProvider;
