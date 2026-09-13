/**
 * Seed de categorias/subcategorias oficiais para testes do Importador.
 * Espelha o cadastro tipo=produto ativo=1 — não cria tabela nova.
 */
'use strict';

const CATALOGO_OFICIAL = [
  {
    categoria: 'Hidráulica',
    subs: [
      'Banheiro',
      'Conexões e Acessórios',
      'Louças e Caixas Acopladas',
      'Mangueiras',
      'Pias',
      'Reservatórios',
      'Tubos e Conexões',
      'Vedação'
    ]
  },
  {
    categoria: 'Elétrica',
    subs: [
      'Cabos e Fios',
      'Interruptores e Tomadas',
      'Isoladores e Roldanas',
      'Materiais Elétricos',
      'Plugues e Conectores',
      'Quadros de Distribuição'
    ]
  },
  { categoria: 'Diversos', subs: ['Diversos'] },
  {
    categoria: 'Ferramentas',
    subs: [
      'Acessórios para Ferramentas',
      'Discos e Abrasivos',
      'Ferramentas e Acessórios',
      'Medição',
      'Peneiras',
      'Serras e Lâminas',
      'Solda'
    ]
  },
  { categoria: 'Tintas e Químicos', subs: ['Tintas/Químicos'] },
  {
    categoria: 'Ferragens',
    subs: ['Abraçadeiras', 'Cadeados', 'Ferrolhos', 'Ganchos e Pitões', 'Pregos', 'Rebites']
  },
  {
    categoria: 'Materiais de Construção',
    subs: ['Arames e Grampos', 'Cordas e Linhas', 'Rejuntes', 'Telhas e Coberturas']
  },
  { categoria: 'Ferragens e Utilidades', subs: [] },
  { categoria: 'Esquadrias', subs: [] },
  { categoria: 'Carrinhos de Mão', subs: [] },
  { categoria: 'Pintura e Adesivos', subs: ['Fitas'] },
  { categoria: 'EPI', subs: ['Calçados de Proteção'] },
  { categoria: 'Utilidades', subs: ['Organização'] }
];

async function seedParCategoriaSub(db, run, get, catNome, subNome, tipo = 'produto') {
  await run(db, `INSERT OR IGNORE INTO categorias (nome, tipo, ativo) VALUES (?, ?, 1)`, [catNome, tipo]);
  const cat = await get(db, `SELECT id FROM categorias WHERE nome = ?`, [catNome]);
  if (subNome && cat) {
    const existe = await get(
      db,
      `SELECT id FROM subcategorias WHERE nome = ? AND categoria_id = ?`,
      [subNome, cat.id]
    );
    if (!existe) {
      await run(db, `INSERT INTO subcategorias (nome, categoria_id, ativo) VALUES (?, ?, 1)`, [subNome, cat.id]);
    }
  }
  return cat;
}

async function seedCatalogoOficialImportacao(db, run, get) {
  for (const item of CATALOGO_OFICIAL) {
    await seedParCategoriaSub(db, run, get, item.categoria, null);
    for (const sub of item.subs) {
      await seedParCategoriaSub(db, run, get, item.categoria, sub);
    }
  }
}

module.exports = {
  CATALOGO_OFICIAL,
  seedParCategoriaSub,
  seedCatalogoOficialImportacao
};
