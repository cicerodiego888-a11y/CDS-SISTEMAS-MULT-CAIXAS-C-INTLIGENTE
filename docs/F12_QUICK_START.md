# F12 POLICY - QUICK START GUIDE FOR DEVELOPERS

**Quick Reference for Integration**

## 3-Minute Overview

F12 Policy Control allows three modes of controlling Fiscal/Non-Fiscal mode:

| Mode | Who Controls | How | Key Press Works? |
|------|--------------|-----|-----------------|
| **POR_CAIXA** | Operator | F12 key press on own cash | ✓ Yes |
| **GLOBAL** | Admin | One toggle affects all | ✗ No (operator can't use F12) |
| **MODO_ADMIN** | Admin | Per-cash-register toggle | ✗ No (operator can't use F12) |

---

## 5 Essential Files to Know

1. **backend/services/F12PolicyService.js** - Core logic
2. **backend/rotas/f12.js** - API endpoints
3. **frontend/shared/js/F12PolicyResolver.js** - Frontend client
4. **docs/F12_INTEGRATION_CHECKLIST.md** - Step-by-step guide
5. **docs/F12_POLICY_IMPLEMENTATION.md** - Technical reference

---

## Integration Checklist (Copy-Paste Ready)

### Step 1: Database (5 min)
```javascript
// In backend/database.js, add at the top:
const { executarMigracaoF12Policy } = require('./lib/migracaoF12Policy');

// In initialization, add after table creation:
if (typeof executarMigracaoF12Policy === 'function') {
  executarMigracaoF12Policy(db, (migErr) => {
    if (migErr) console.error('[F12] Migration error:', migErr);
    else console.log('[F12] Migration complete');
  });
}
```

### Step 2: API Routes (2 min)
```javascript
// In backend/server.js, add at top:
const f12Routes = require('./rotas/f12');

// Add in route mounting section:
app.use('/api/f12', f12Routes);
```

### Step 3: Frontend Script (2 min)
Add to all HTML files that need F12:
```html
<script src="../shared/js/F12PolicyResolver.js"></script>
```

### Step 4: F12 Key Handler (10 min)
Update `frontend/shared/js/core.js` F12 key handler:
```javascript
if (event.key === 'F12' || keyCode === 123) {
  event.preventDefault();
  const caixaId = window.caixaIdAtual || 1;
  
  F12PolicyResolver.obterInfo().then(info => {
    if (!info.podeOperadorAlterar) return;
    
    F12PolicyResolver.alternarF12(caixaId).then(result => {
      if (result.success) {
        mostrarNotificacao('Modo: ' + (result.novoEstado ? 'Fiscal' : 'Completo'));
      }
    });
  });
}
```

### Step 5: Admin UI (30 min)
Create `frontend/shared/pages/f12-admin-config.html` - Use template from F12_INTEGRATION_CHECKLIST.md

---

## API Quick Reference

### Get Current Policy
```bash
curl -H "Authorization: Bearer TOKEN" http://localhost:3001/api/f12/politica
# Returns: {"politica":"POR_CAIXA","label":"Por Caixa"}
```

### Get F12 State for Cash
```bash
curl -H "Authorization: Bearer TOKEN" http://localhost:3001/api/f12/estado/1
# Returns: {"caixaId":1,"ativo":true,"politica":"POR_CAIXA"}
```

### Set F12 Policy (Admin Only)
```bash
curl -X PUT -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"politica":"GLOBAL"}' \
  http://localhost:3001/api/f12/politica
```

### Set Global State (Admin Only)
```bash
curl -X PUT -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ativo":false}' \
  http://localhost:3001/api/f12/estado-global
```

### Toggle Cash Register (POR_CAIXA Only)
```bash
curl -X PUT -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3001/api/f12/caixas/1/alternar
# Returns: {"success":true,"novoEstado":false}
```

---

## Frontend Usage

```javascript
// Check if operator can alter F12
const info = await F12PolicyResolver.obterInfo();
console.log(info.podeOperadorAlterar); // true/false

// Get F12 state for cash
const ativo = await F12PolicyResolver.resolveF12Estado(1);
console.log(ativo); // true = Fiscal, false = Completo

// Toggle F12 (for F12 key)
const result = await F12PolicyResolver.alternarF12(1);
console.log(result.novoEstado);

// Get all cash registers
const caixas = await F12PolicyResolver.listarCaixas();
caixas.forEach(c => console.log(c.nome, c.f12_ativo));

// Admin: Set cash register state
await F12PolicyResolver.definirEstadoCaixa(1, true);

// Admin: Set global state
await F12PolicyResolver.definirEstadoGlobal(false);
```

---

## Testing

### Run Unit Tests
```bash
npm test -- tests/f12-policy.test.js
```

### Run API Tests
```bash
npm test -- tests/f12-api.test.js
```

### Manual Browser Test
```javascript
// In browser console:
F12PolicyResolver.obterPolitica().then(p => console.log('Policy:', p));
F12PolicyResolver.obterInfo().then(i => console.log('Info:', i));
F12PolicyResolver.resolveF12Estado(1).then(s => console.log('State:', s));
```

---

## Permission Matrix

| Operation | POR_CAIXA | GLOBAL | MODO_ADMIN |
|-----------|-----------|--------|-----------|
| Operator presses F12 | ✓ Works | ✗ Denied | ✗ Denied |
| Operator changes own cash | ✓ Allowed | - | ✗ Denied |
| Admin sets global | - | ✓ Allowed | - |
| Admin sets per-cash | - | - | ✓ Allowed |
| Admin changes policy | ✓ Allowed | ✓ Allowed | ✓ Allowed |

---

## Common Issues

### F12 key not working
- Verify F12PolicyResolver.js is loaded
- Check browser console for errors
- Verify token is valid
- Check backend logs for permission errors

### API returning 404
- Verify routes mounted: `app.use('/api/f12', f12Routes)`
- Check path: must be `/api/f12/...`
- Restart server

### Database migration didn't run
- Check `backend/database.js` has import
- Look for error in console
- Check if f12_ativo column already exists
- Can run manually: `ALTER TABLE caixas ADD COLUMN f12_ativo INTEGER DEFAULT 1;`

### Permission denied errors
- Verify user role (SUPER_ADMIN for policy changes)
- Check token hasn't expired
- Verify auth middleware properly validates

---

## File Locations

```
✓ backend/services/F12PolicyService.js      - Core service
✓ backend/rotas/f12.js                      - API routes
✓ backend/lib/migracaoF12Policy.js          - Migration
✓ frontend/shared/js/F12PolicyResolver.js   - Frontend client
✓ frontend/shared/pages/f12-admin-config.html - Admin UI
✓ tests/f12-policy.test.js                  - Unit tests
✓ tests/f12-api.test.js                     - API tests
✓ docs/F12_INTEGRATION_CHECKLIST.md         - Detailed guide
✓ docs/F12_POLICY_IMPLEMENTATION.md         - Technical spec
✓ docs/F12_DELIVERABLES_SUMMARY.md          - Overview
```

---

## Before Deployment

- [ ] Run all tests: `npm test`
- [ ] Verify no console errors
- [ ] Test F12 key in each policy
- [ ] Test admin UI
- [ ] Check audit logs
- [ ] Verify backward compatibility (default: POR_CAIXA)
- [ ] Backup database

---

## Support

**Documentation:**
- Detailed guide: docs/F12_INTEGRATION_CHECKLIST.md
- Technical spec: docs/F12_POLICY_IMPLEMENTATION.md
- API reference: docs/F12_POLICY_IMPLEMENTATION.md (API section)

**Code Files:**
- Core logic: backend/services/F12PolicyService.js
- API: backend/rotas/f12.js
- Frontend: frontend/shared/js/F12PolicyResolver.js

**Questions?**
- Check F12_INTEGRATION_CHECKLIST.md Troubleshooting section
- Review test files for usage examples
- Check existing F12 implementation in core.js for patterns

---

**Total Setup Time: ~1 hour | Total Testing Time: ~2 hours | Total: ~3 hours**
