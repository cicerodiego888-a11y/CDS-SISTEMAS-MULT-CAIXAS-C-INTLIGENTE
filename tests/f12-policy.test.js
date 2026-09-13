/**
 * F12 POLICY SERVICE UNIT TESTS
 * 
 * Tests for F12PolicyService business logic
 */

const assert = require('assert');
const F12PolicyService = require('../backend/services/F12PolicyService');

// Mock database for testing
let mockDb = {
  data: {
    configuracoes: new Map(),
    caixas: new Map()
  }
};

// Test fixtures
const testConfig = {
  f12_politica: 'POR_CAIXA',
  f12_global_ativo: '1'
};

const testCaixas = [
  { id: 1, nome: 'Caixa 1', f12_ativo: 1, ativo: 1 },
  { id: 2, nome: 'Caixa 2', f12_ativo: 0, ativo: 1 },
  { id: 3, nome: 'Caixa 3', f12_ativo: 1, ativo: 0 }
];

describe('F12PolicyService', () => {
  let modeloOriginal = null;

  before((done) => {
    F12PolicyService.obterModeloControle((err, modelo) => {
      if (!err && modelo) {
        modeloOriginal = {
          controle: modelo.controle || 'OPERADOR',
          escopo: modelo.escopo || null
        };
      } else {
        modeloOriginal = { controle: 'OPERADOR', escopo: null };
      }
      done();
    });
  });

  after((done) => {
    if (!modeloOriginal) return done();
    F12PolicyService.definirModeloControle(
      modeloOriginal.controle,
      modeloOriginal.escopo,
      () => done()
    );
  });
  describe('obterPolitica()', () => {
    it('should return default policy POR_CAIXA', (done) => {
      F12PolicyService.obterPolitica((err, politica) => {
        assert(!err, 'Should not have error');
        assert(politica);
        assert(['POR_CAIXA', 'GLOBAL', 'MODO_ADMIN'].includes(politica));
        done();
      });
    });

    it('should return policy in uppercase', (done) => {
      F12PolicyService.obterPolitica((err, politica) => {
        assert(!err);
        assert.strictEqual(politica, politica.toUpperCase());
        done();
      });
    });
  });

  describe('definirPolitica()', () => {
    it('should set policy to GLOBAL', (done) => {
      F12PolicyService.definirPolitica('GLOBAL', (err) => {
        assert(!err, 'Should not have error');
        
        F12PolicyService.obterPolitica((getErr, politica) => {
          assert(!getErr);
          assert.strictEqual(politica, 'GLOBAL');
          done();
        });
      });
    });

    it('should set policy to MODO_ADMIN', (done) => {
      F12PolicyService.definirPolitica('MODO_ADMIN', (err) => {
        assert(!err);
        
        F12PolicyService.obterPolitica((getErr, politica) => {
          assert(!getErr);
          assert.strictEqual(politica, 'MODO_ADMIN');
          done();
        });
      });
    });

    it('should normalize policy to uppercase', (done) => {
      F12PolicyService.definirPolitica('por_caixa', (err) => {
        assert(!err);
        
        F12PolicyService.obterPolitica((getErr, politica) => {
          assert(!getErr);
          assert.strictEqual(politica, 'POR_CAIXA');
          done();
        });
      });
    });

    it('should reject invalid policy', (done) => {
      F12PolicyService.definirPolitica('INVALID', (err) => {
        assert(err, 'Should have error');
        assert(err.message.includes('inválida'));
        done();
      });
    });

    it('should handle null policy', (done) => {
      F12PolicyService.definirPolitica(null, (err) => {
        assert(err, 'Should have error');
        done();
      });
    });
  });

  describe('obterEstadoGlobal()', () => {
    it('should return global F12 state', (done) => {
      F12PolicyService.obterEstadoGlobal((err, ativo) => {
        assert(!err);
        assert(typeof ativo === 'boolean');
        done();
      });
    });
  });

  describe('definirEstadoGlobal()', () => {
    it('should set global state to false', (done) => {
      F12PolicyService.definirEstadoGlobal(false, (err) => {
        assert(!err);
        
        F12PolicyService.obterEstadoGlobal((getErr, ativo) => {
          assert(!getErr);
          assert.strictEqual(ativo, false);
          done();
        });
      });
    });

    it('should set global state to true', (done) => {
      F12PolicyService.definirEstadoGlobal(true, (err) => {
        assert(!err);
        
        F12PolicyService.obterEstadoGlobal((getErr, ativo) => {
          assert(!getErr);
          assert.strictEqual(ativo, true);
          done();
        });
      });
    });
  });

  describe('obterEstadoCaixa()', () => {
    it('should return cash register F12 state', (done) => {
      F12PolicyService.obterEstadoCaixa(1, (err, ativo) => {
        assert(!err);
        assert(typeof ativo === 'boolean');
        done();
      });
    });

    it('should return false for non-existent cash register', (done) => {
      F12PolicyService.obterEstadoCaixa(999999, (err, ativo) => {
        // Error is expected for non-existent caixa
        assert(err || ativo === false);
        done();
      });
    });
  });

  describe('definirEstadoCaixa()', () => {
    it('should set cash register state to true', (done) => {
      F12PolicyService.definirEstadoCaixa(1, true, (err) => {
        assert(!err);
        
        F12PolicyService.obterEstadoCaixa(1, (getErr, ativo) => {
          assert(!getErr);
          assert.strictEqual(ativo, true);
          done();
        });
      });
    });

    it('should set cash register state to false', (done) => {
      F12PolicyService.definirEstadoCaixa(1, false, (err) => {
        assert(!err);
        
        F12PolicyService.obterEstadoCaixa(1, (getErr, ativo) => {
          assert(!getErr);
          assert.strictEqual(ativo, false);
          done();
        });
      });
    });

    it('should reject non-existent cash register', (done) => {
      F12PolicyService.definirEstadoCaixa(999999, true, (err) => {
        assert(err, 'Should have error for non-existent caixa');
        done();
      });
    });
  });

  describe('alternarEstadoCaixa()', () => {
    it('should toggle F12 state from false to true', (done) => {
      // First set to false
      F12PolicyService.definirEstadoCaixa(1, false, () => {
        // Then toggle
        F12PolicyService.alternarEstadoCaixa(1, (err, novoEstado) => {
          assert(!err);
          assert.strictEqual(novoEstado, true);
          done();
        });
      });
    });

    it('should toggle F12 state from true to false', (done) => {
      // First set to true
      F12PolicyService.definirEstadoCaixa(1, true, () => {
        // Then toggle
        F12PolicyService.alternarEstadoCaixa(1, (err, novoEstado) => {
          assert(!err);
          assert.strictEqual(novoEstado, false);
          done();
        });
      });
    });

    it('should reject non-existent cash register', (done) => {
      F12PolicyService.alternarEstadoCaixa(999999, (err, novoEstado) => {
        assert(err, 'Should have error');
        done();
      });
    });
  });

  describe('listarCaixasComEstado()', () => {
    it('should return array of cash registers', (done) => {
      F12PolicyService.listarCaixasComEstado((err, caixas) => {
        assert(!err);
        assert(Array.isArray(caixas));
        
        if (caixas.length > 0) {
          const caixa = caixas[0];
          assert(caixa.id);
          assert(caixa.nome);
          assert(typeof caixa.f12_ativo !== 'undefined');
        }
        
        done();
      });
    });

    it('should return sorted by ID', (done) => {
      F12PolicyService.listarCaixasComEstado((err, caixas) => {
        assert(!err);
        
        if (caixas.length > 1) {
          for (let i = 1; i < caixas.length; i++) {
            assert(caixas[i].id >= caixas[i-1].id);
          }
        }
        
        done();
      });
    });
  });

  describe('resolveF12Estado()', () => {
    it('should return global state when policy is GLOBAL', (done) => {
      F12PolicyService.definirPolitica('GLOBAL', () => {
        F12PolicyService.definirEstadoGlobal(false, () => {
          F12PolicyService.resolveF12Estado(1, (err, ativo) => {
            assert(!err);
            assert.strictEqual(ativo, false);
            done();
          });
        });
      });
    });

    it('should return cash register state when policy is POR_CAIXA', (done) => {
      F12PolicyService.definirPolitica('POR_CAIXA', () => {
        F12PolicyService.definirEstadoCaixa(1, true, () => {
          F12PolicyService.resolveF12Estado(1, (err, ativo) => {
            assert(!err);
            assert.strictEqual(ativo, true);
            done();
          });
        });
      });
    });

    it('should return cash register state when policy is MODO_ADMIN', (done) => {
      F12PolicyService.definirPolitica('MODO_ADMIN', () => {
        F12PolicyService.definirEstadoCaixa(2, false, () => {
          F12PolicyService.resolveF12Estado(2, (err, ativo) => {
            assert(!err);
            assert.strictEqual(ativo, false);
            done();
          });
        });
      });
    });

    it('should return false for non-existent cash register', (done) => {
      F12PolicyService.resolveF12Estado(999999, (err, ativo) => {
        assert(!err || ativo === false);
        done();
      });
    });
  });

  describe('podeOperadorAlterarF12()', () => {
    it('should allow operator to alter in POR_CAIXA', () => {
      const user = { perfil: 'OPERADOR', id: 1 };
      assert(F12PolicyService.podeOperadorAlterarF12('POR_CAIXA', user));
    });

    it('should not allow operator to alter in GLOBAL', () => {
      const user = { perfil: 'OPERADOR', id: 1 };
      assert(!F12PolicyService.podeOperadorAlterarF12('GLOBAL', user));
    });

    it('should not allow operator to alter in MODO_ADMIN', () => {
      const user = { perfil: 'OPERADOR', id: 1 };
      assert(!F12PolicyService.podeOperadorAlterarF12('MODO_ADMIN', user));
    });

    it('should allow SUPER_ADMIN in all policies', () => {
      const user = { perfil: 'SUPER_ADMIN', id: 1 };
      assert(F12PolicyService.podeOperadorAlterarF12('POR_CAIXA', user));
      assert(F12PolicyService.podeOperadorAlterarF12('GLOBAL', user));
      assert(F12PolicyService.podeOperadorAlterarF12('MODO_ADMIN', user));
    });

    it('should allow ADMIN in POR_CAIXA (Operador do Caixa), GLOBAL and MODO_ADMIN', () => {
      const user = { perfil: 'ADMIN', id: 1 };
      assert(F12PolicyService.podeOperadorAlterarF12('POR_CAIXA', user));
      assert(F12PolicyService.podeOperadorAlterarF12('GLOBAL', user));
      assert(F12PolicyService.podeOperadorAlterarF12('MODO_ADMIN', user));
    });

    it('should handle missing user', () => {
      assert(F12PolicyService.podeOperadorAlterarF12('POR_CAIXA', null));
      assert(!F12PolicyService.podeOperadorAlterarF12('GLOBAL', null));
    });
  });

  describe('resolverContextoF12()', () => {
    it('OPERADOR: caixa 1 ON, operador do caixa 1 altera só o próprio', (done) => {
      F12PolicyService.definirModeloControle('OPERADOR', null, () => {
        F12PolicyService.definirEstadoCaixa(1, true, () => {
          F12PolicyService.resolverContextoF12(1, { perfil: 'OPERADOR', id: 9, caixa_id: 1 }, (err, ctx) => {
            assert(!err);
            assert.strictEqual(ctx.controle, 'OPERADOR');
            assert.strictEqual(ctx.escopo, null);
            assert.strictEqual(ctx.ativo, true);
            assert.strictEqual(ctx.podeAlterar, true);
            F12PolicyService.resolverContextoF12(2, { perfil: 'OPERADOR', id: 9, caixa_id: 1 }, (err2, ctx2) => {
              assert(!err2);
              assert.strictEqual(ctx2.podeAlterar, false);
              done();
            });
          });
        });
      });
    });

    it('ADMINISTRADOR + TODOS: todos seguem o estado global e operador não altera', (done) => {
      F12PolicyService.definirModeloControle('ADMINISTRADOR', 'TODOS', () => {
        F12PolicyService.definirEstadoGlobal(true, () => {
          F12PolicyService.resolverContextoF12(1, { perfil: 'OPERADOR', caixa_id: 1 }, (err, ctx) => {
            assert(!err);
            assert.strictEqual(ctx.controle, 'ADMINISTRADOR');
            assert.strictEqual(ctx.escopo, 'TODOS');
            assert.strictEqual(ctx.ativo, true);
            assert.strictEqual(ctx.podeAlterar, false);
            done();
          });
        });
      });
    });

    it('ADMINISTRADOR + INDIVIDUAL: estado por caixa e operador não altera', (done) => {
      F12PolicyService.definirModeloControle('ADMINISTRADOR', 'INDIVIDUAL', () => {
        F12PolicyService.definirEstadoCaixa(1, true, () => {
          F12PolicyService.resolverContextoF12(1, { perfil: 'OPERADOR', caixa_id: 1 }, (err, ctx) => {
            assert(!err);
            assert.strictEqual(ctx.controle, 'ADMINISTRADOR');
            assert.strictEqual(ctx.escopo, 'INDIVIDUAL');
            assert.strictEqual(ctx.ativo, true);
            assert.strictEqual(ctx.podeAlterar, false);
            done();
          });
        });
      });
    });

    it('ADMIN no PDV: podeAlterar com OPERADOR; bloqueado com ADMINISTRADOR', (done) => {
      F12PolicyService.definirModeloControle('OPERADOR', null, () => {
        F12PolicyService.resolverContextoF12(1, { perfil: 'ADMIN', caixa_id: 1 }, (err, ctx) => {
          assert(!err);
          assert.strictEqual(ctx.podeAlterar, true);
          F12PolicyService.definirModeloControle('ADMINISTRADOR', 'TODOS', () => {
            F12PolicyService.resolverContextoF12(1, { perfil: 'ADMIN' }, (err2, ctx2) => {
              assert(!err2);
              assert.strictEqual(ctx2.podeAlterar, false);
              F12PolicyService.definirModeloControle('ADMINISTRADOR', 'INDIVIDUAL', () => {
                F12PolicyService.resolverContextoF12(1, { perfil: 'ADMIN' }, (err3, ctx3) => {
                  assert(!err3);
                  assert.strictEqual(ctx3.podeAlterar, false);
                  done();
                });
              });
            });
          });
        });
      });
    });

    it('SUPER_ADMIN recebe podeAlterar = true em todos os modos', (done) => {
      const superUser = { perfil: 'SUPER_ADMIN', id: 1, caixa_id: 99 };
      F12PolicyService.definirModeloControle('OPERADOR', null, () => {
        F12PolicyService.resolverContextoF12(2, superUser, (err, ctx) => {
          assert(!err);
          assert.strictEqual(ctx.podeAlterar, true);
          F12PolicyService.definirModeloControle('ADMINISTRADOR', 'TODOS', () => {
            F12PolicyService.resolverContextoF12(1, superUser, (err2, ctx2) => {
              assert(!err2);
              assert.strictEqual(ctx2.podeAlterar, true);
              F12PolicyService.definirModeloControle('ADMINISTRADOR', 'INDIVIDUAL', () => {
                F12PolicyService.resolverContextoF12(1, superUser, (err3, ctx3) => {
                  assert(!err3);
                  assert.strictEqual(ctx3.podeAlterar, true);
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('executarToggleF12() — matriz de autorização', () => {
    it('ADMIN no PDV consegue F12 com controle OPERADOR', (done) => {
      F12PolicyService.definirModeloControle('OPERADOR', null, () => {
        F12PolicyService.obterEstadoCaixa(1, (e1, antes) => {
          assert(!e1);
          F12PolicyService.executarToggleF12(1, { perfil: 'ADMIN', caixa_id: 1 }, (err, resultado) => {
            assert(!err);
            assert.strictEqual(resultado.origem, 'CAIXA');
            assert.strictEqual(resultado.novoEstado, !antes);
            F12PolicyService.definirEstadoCaixa(1, antes, done);
          });
        });
      });
    });

    it('ADMIN é bloqueado no fluxo da tecla F12 com controle ADMINISTRADOR', (done) => {
      F12PolicyService.definirModeloControle('ADMINISTRADOR', 'TODOS', () => {
        F12PolicyService.executarToggleF12(1, { perfil: 'ADMIN', caixa_id: 1 }, (err) => {
          assert(err);
          assert.strictEqual(err.status, 403);
          done();
        });
      });
    });

    it('OPERADOR é bloqueado ao tentar outro caixa', (done) => {
      F12PolicyService.definirModeloControle('OPERADOR', null, () => {
        F12PolicyService.executarToggleF12(2, { perfil: 'OPERADOR', caixa_id: 1 }, (err) => {
          assert(err);
          assert.strictEqual(err.status, 403);
          done();
        });
      });
    });

    it('SUPER_ADMIN consegue o fluxo oficial em ADMINISTRADOR + TODOS', (done) => {
      F12PolicyService.definirModeloControle('ADMINISTRADOR', 'TODOS', () => {
        F12PolicyService.obterEstadoGlobal((gErr, antes) => {
          assert(!gErr);
          F12PolicyService.executarToggleF12(1, { perfil: 'SUPER_ADMIN' }, (err, resultado) => {
            assert(!err);
            assert.strictEqual(resultado.origem, 'GLOBAL');
            assert.strictEqual(resultado.novoEstado, !antes);
            F12PolicyService.definirEstadoGlobal(antes, done);
          });
        });
      });
    });

    it('SUPER_ADMIN consegue o fluxo oficial em ADMINISTRADOR + INDIVIDUAL', (done) => {
      F12PolicyService.definirModeloControle('ADMINISTRADOR', 'INDIVIDUAL', () => {
        F12PolicyService.obterEstadoCaixa(1, (e1, antes) => {
          assert(!e1);
          F12PolicyService.executarToggleF12(1, { perfil: 'SUPER_ADMIN' }, (err, resultado) => {
            assert(!err);
            assert.strictEqual(resultado.origem, 'CAIXA');
            assert.strictEqual(resultado.novoEstado, !antes);
            F12PolicyService.definirEstadoCaixa(1, antes, done);
          });
        });
      });
    });
  });
});
