'use strict';

const ProductProvider = require('./ProductProvider');
const ClientProvider = require('./ClientProvider');
const SupplierProvider = require('./SupplierProvider');
const EmployeeProvider = require('./EmployeeProvider');
const CategoryProvider = require('./CategoryProvider');
const BrandProvider = require('./BrandProvider');
const FinancialProvider = require('./FinancialProvider');
const FiscalProvider = require('./FiscalProvider');

/**
 * Registra todos os providers oficiais RC3.0.
 * @param {import('sqlite3').Database} db
 * @param {import('../../MibService')} mib
 * @returns {Map<string, import('./ISearchProvider')>}
 */
function criarProviders(db, mib) {
  const lista = [
    new ProductProvider(mib),
    new ClientProvider(db),
    new SupplierProvider(db),
    new EmployeeProvider(db),
    new CategoryProvider(db),
    new BrandProvider(db),
    new FinancialProvider(db),
    new FiscalProvider(db)
  ];

  /** @type {Map<string, import('./ISearchProvider')>} */
  const mapa = new Map();
  for (const p of lista) {
    mapa.set(p.entity, p);
    for (const a of p.aliases || []) {
      mapa.set(String(a).toLowerCase(), p);
    }
  }
  return mapa;
}

module.exports = {
  criarProviders,
  ProductProvider,
  ClientProvider,
  SupplierProvider,
  EmployeeProvider,
  CategoryProvider,
  BrandProvider,
  FinancialProvider,
  FiscalProvider
};
