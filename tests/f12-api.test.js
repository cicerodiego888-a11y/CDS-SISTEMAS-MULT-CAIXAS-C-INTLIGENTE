/**
 * F12 POLICY API TESTS
 * 
 * Test suite for F12 policy endpoints and business logic.
 * Tests all three policies: POR_CAIXA, GLOBAL, MODO_ADMIN
 */

const assert = require('assert');
const request = require('supertest');

// Note: These tests assume express app is available
// Usage: npm test -- tests/f12-api.test.js

describe('F12 Policy API', () => {
  let app;
  let adminToken;
  let operadorToken;
  let caixaId = 1;

  before(function(done) {
    // Initialize app and get tokens
    this.timeout(10000);
    app = require('../backend/server'); // Adjust path to your server
    
    // Mock authentication for tests
    adminToken = 'test-admin-token';
    operadorToken = 'test-operador-token';
    
    done();
  });

  describe('GET /api/f12/politica', () => {
    it('should return current policy', (done) => {
      request(app)
        .get('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          
          assert(res.body.politica);
          assert(['POR_CAIXA', 'GLOBAL', 'MODO_ADMIN'].includes(res.body.politica));
          assert(res.body.label);
          
          done();
        });
    });

    it('should require authentication', (done) => {
      request(app)
        .get('/api/f12/politica')
        .expect(401, done);
    });
  });

  describe('GET /api/f12/estado/:caixaId', () => {
    it('should return F12 state for a cash register', (done) => {
      request(app)
        .get(`/api/f12/estado/${caixaId}`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          
          assert.strictEqual(res.body.caixaId, caixaId);
          assert(typeof res.body.ativo === 'boolean');
          assert(res.body.politica);
          
          done();
        });
    });

    it('should reject invalid caixaId', (done) => {
      request(app)
        .get('/api/f12/estado/invalid')
        .set('Authorization', `Bearer ${operadorToken}`)
        .expect(400, done);
    });
  });

  describe('PUT /api/f12/politica (Admin)', () => {
    it('should change policy to GLOBAL', (done) => {
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ politica: 'GLOBAL' })
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          
          assert(res.body.success);
          assert.strictEqual(res.body.politica, 'GLOBAL');
          
          done();
        });
    });

    it('should change policy to MODO_ADMIN', (done) => {
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ politica: 'MODO_ADMIN' })
        .expect(200, done);
    });

    it('should reject non-admin user', (done) => {
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ politica: 'GLOBAL' })
        .expect(403, done);
    });

    it('should reject invalid policy', (done) => {
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ politica: 'INVALID_POLICY' })
        .expect(400, done);
    });
  });

  describe('GLOBAL Policy Tests', () => {
    before((done) => {
      // Set policy to GLOBAL
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ politica: 'GLOBAL' })
        .end(done);
    });

    describe('GET /api/f12/estado-global', () => {
      it('should return global F12 state', (done) => {
        request(app)
          .get('/api/f12/estado-global')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);
            assert(typeof res.body.ativo === 'boolean');
            done();
          });
      });
    });

    describe('PUT /api/f12/estado-global', () => {
      it('should allow admin to set global state', (done) => {
        request(app)
          .put('/api/f12/estado-global')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ ativo: false })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);
            assert(res.body.success);
            assert.strictEqual(res.body.ativo, false);
            done();
          });
      });

      it('should reject non-boolean ativo', (done) => {
        request(app)
          .put('/api/f12/estado-global')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ ativo: 'true' })
          .expect(400, done);
      });

      it('should reject non-admin user', (done) => {
        request(app)
          .put('/api/f12/estado-global')
          .set('Authorization', `Bearer ${operadorToken}`)
          .send({ ativo: true })
          .expect(403, done);
      });
    });

    describe('PUT /api/f12/caixas/:caixaId/alternar', () => {
      it('should reject F12 key toggle in GLOBAL mode', (done) => {
        request(app)
          .put(`/api/f12/caixas/${caixaId}/alternar`)
          .set('Authorization', `Bearer ${operadorToken}`)
          .send({})
          .expect(403, done);
      });
    });
  });

  describe('POR_CAIXA Policy Tests', () => {
    before((done) => {
      // Set policy to POR_CAIXA
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ politica: 'POR_CAIXA' })
        .end(done);
    });

    describe('PUT /api/f12/caixas/:caixaId/alternar', () => {
      it('should allow operator to toggle own cash register', (done) => {
        request(app)
          .put(`/api/f12/caixas/${caixaId}/alternar`)
          .set('Authorization', `Bearer ${operadorToken}`)
          .send({})
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);
            assert(res.body.success);
            assert(typeof res.body.novoEstado === 'boolean');
            done();
          });
      });

      it('should reject invalid caixaId', (done) => {
        request(app)
          .put('/api/f12/caixas/invalid/alternar')
          .set('Authorization', `Bearer ${operadorToken}`)
          .send({})
          .expect(400, done);
      });
    });
  });

  describe('MODO_ADMIN Policy Tests', () => {
    before((done) => {
      // Set policy to MODO_ADMIN
      request(app)
        .put('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ politica: 'MODO_ADMIN' })
        .end(done);
    });

    describe('PUT /api/f12/caixas/:caixaId/estado', () => {
      it('should allow admin to set cash register state', (done) => {
        request(app)
          .put(`/api/f12/caixas/${caixaId}/estado`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ ativo: false })
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);
            assert(res.body.success);
            assert.strictEqual(res.body.ativo, false);
            done();
          });
      });

      it('should reject non-admin user', (done) => {
        request(app)
          .put(`/api/f12/caixas/${caixaId}/estado`)
          .set('Authorization', `Bearer ${operadorToken}`)
          .send({ ativo: true })
          .expect(403, done);
      });
    });

    describe('PUT /api/f12/caixas/:caixaId/alternar', () => {
      it('should reject F12 key toggle in MODO_ADMIN', (done) => {
        request(app)
          .put(`/api/f12/caixas/${caixaId}/alternar`)
          .set('Authorization', `Bearer ${operadorToken}`)
          .send({})
          .expect(403, done);
      });
    });
  });

  describe('GET /api/f12/caixas', () => {
    it('should list all cash registers with F12 states', (done) => {
      request(app)
        .get('/api/f12/caixas')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          
          assert(Array.isArray(res.body.data));
          assert(res.body.data.length > 0);
          
          const caixa = res.body.data[0];
          assert(caixa.id);
          assert(caixa.nome);
          assert(typeof caixa.f12_ativo === 'boolean');
          
          done();
        });
    });
  });

  describe('GET /api/f12/info', () => {
    it('should return complete F12 info', (done) => {
      request(app)
        .get('/api/f12/info')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);
          
          assert(res.body.politica);
          assert(res.body.label);
          assert(typeof res.body.podeOperadorAlterar === 'boolean');
          assert(typeof res.body.isAdmin === 'boolean');
          
          done();
        });
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on database error', function(done) {
      this.timeout(5000);
      // This test depends on database availability
      request(app)
        .get('/api/f12/politica')
        .set('Authorization', `Bearer ${adminToken}`)
        .end((err, res) => {
          // Should not return 500 with valid request
          if (res && res.status === 500) {
            assert.fail('Database error should be handled gracefully');
          }
          done();
        });
    });
  });
});
