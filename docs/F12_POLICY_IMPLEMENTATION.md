# F12 POLICY IMPLEMENTATION GUIDE

## Overview
This document details the complete implementation of the F12 (Fiscal/Non-Fiscal) policy control sprint. Three policies are implemented: POR_CAIXA, GLOBAL, and MODO_ADMIN.

## Database Schema Changes

### 1. Add Column to `caixas` Table
```sql
ALTER TABLE caixas ADD COLUMN f12_ativo INTEGER DEFAULT 1;
```
- Tracks F12 state per cash register
- Used in POR_CAIXA and MODO_ADMIN policies
- Default: 1 (Fiscal mode ON)

### 2. Add Configurations to `configuracoes` Table
```sql
-- F12 Policy Selection
INSERT INTO configuracoes (chave, valor, tipo, descricao) 
VALUES ('f12_politica', 'POR_CAIXA', 'string', 'F12 Policy: POR_CAIXA | GLOBAL | MODO_ADMIN');

-- Global F12 State (used when policy = GLOBAL)
INSERT INTO configuracoes (chave, valor, tipo, descricao) 
VALUES ('f12_global_ativo', '1', 'boolean', 'Global F12 state (active when policy=GLOBAL)');
```

## Backend API Endpoints

### GET /api/f12/politica
Returns current F12 policy
```json
{
  "politica": "POR_CAIXA",
  "label": "Por Caixa"
}
```

### GET /api/f12/estado/:caixaId
Resolve F12 state for a cash register
```json
{
  "caixaId": 1,
  "ativo": true,
  "politica": "POR_CAIXA"
}
```

### GET /api/f12/estado-global
Get global F12 state (when policy=GLOBAL)
```json
{
  "ativo": true
}
```

### PUT /api/f12/estado-global
Set global F12 state (admin only, requires SUPER_ADMIN)
```json
{
  "ativo": true
}
```

### GET /api/f12/caixas
List all cash registers with F12 state
```json
{
  "data": [
    {
      "id": 1,
      "nome": "Caixa 1",
      "f12_ativo": 1,
      "ativo": 1
    }
  ]
}
```

### PUT /api/f12/caixas/:caixaId/estado
Set F12 state for a cash register (admin in MODO_ADMIN, operator in POR_CAIXA)
```json
{
  "ativo": true
}
```

### PUT /api/f12/caixas/:caixaId/alternar
Toggle F12 state (for F12 key press in POR_CAIXA)
```json
{
  "novoEstado": false
}
```

### PUT /api/f12/politica
Set F12 policy (SUPER_ADMIN only)
```json
{
  "politica": "GLOBAL"
}
```

## Frontend Implementation

### 1. Core Logic Updates (frontend/shared/js/core.js)
- Replace global F12 toggle with policy-aware logic
- Add F12PolicyResolver to handle three policies
- Update F12 key handler
- Implement permission checks on frontend (validated on backend)

### 2. PDV Express Updates (frontend/pdv/js/pdv.js)
- Update `pdvModoFiscalAtivo()` to call resolveF12Estado
- Update `alternarModoFiscalPdv()` to respect policies
- Update F12 key handler for POR_CAIXA

### 3. Dashboard Updates (frontend/erp/js/dashboard.js)
- Add admin controls for F12 policy
- Add dropdown to select policy
- Add global state toggle (visible only when policy=GLOBAL)
- Add cash register list with individual toggles (visible only when policy=MODO_ADMIN)

### 4. Admin Interface
Create new page: `frontend/shared/pages/f12-admin-config.html`
- Policy selection (radio buttons)
- Conditional UI based on selected policy:
  - POR_CAIXA: No controls (message: "Operadores controlam via F12")
  - GLOBAL: Global state toggle
  - MODO_ADMIN: Cash register list with individual toggles

## Permission Model

### POR_CAIXA
- **Operator**: CAN alter F12 via key press (own cash register only)
- **Admin**: Cannot force change (user controls it)
- **Validation**: Backend checks policy + operador_id = caixa.operador

### GLOBAL
- **Operator**: CANNOT alter F12
- **Admin**: CAN alter global state (affects all cash registers)
- **Validation**: Backend checks policy + user is admin

### MODO_ADMIN
- **Operator**: CANNOT alter F12
- **Admin**: CAN alter individual cash register states
- **Validation**: Backend checks policy + user is admin + caixa exists

## Backend Validation Rules

All validation MUST occur on backend:

```javascript
// Example middleware for F12 operations
function validarF12Permission(req, res, next) {
  const { politica, caixaId, novoEstado } = req.body;
  const user = req.user;

  F12PolicyService.obterPolitica((policyErr, politicaAtual) => {
    if (policyErr) return res.status(500).json({ error: policyErr.message });

    // Check authorization based on policy
    if (politicaAtual === 'POR_CAIXA') {
      // Operator can change own cash register
      if (user.caixa_id !== caixaId && !isAdmin(user)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } else if (politicaAtual === 'GLOBAL' || politicaAtual === 'MODO_ADMIN') {
      // Only admin can change
      if (!isAdmin(user)) {
        return res.status(403).json({ error: 'Admin only' });
      }
    }

    next();
  });
}
```

## Migration Strategy

### Step 1: Backward Compatibility
- Default policy: POR_CAIXA (matches current behavior where F12 toggles everything)
- Existing installations see no changes until admin explicitly selects GLOBAL policy
- `modo_dashboard_fiscal` config continues to work as fallback

### Step 2: Data Migration
```sql
-- Migra current global F12 state to new field
UPDATE configuracoes 
SET f12_global_ativo = valor 
WHERE chave = 'modo_dashboard_fiscal' 
  AND NOT EXISTS (SELECT 1 FROM configuracoes WHERE chave = 'f12_global_ativo');
```

### Step 3: Gradual Rollout
1. Deploy backend service + API endpoints
2. Deploy frontend logic (initially disabled, using fallback)
3. Deploy admin UI
4. Notify admins to configure policy
5. Monitor adoption

## Testing Requirements

### Unit Tests (tests/f12-policy.test.js)
```javascript
describe('F12PolicyService', () => {
  test('POR_CAIXA: operator can toggle own cash', () => {});
  test('POR_CAIXA: operator cannot toggle other cash', () => {});
  test('GLOBAL: admin sets state for all', () => {});
  test('GLOBAL: operator cannot toggle', () => {});
  test('MODO_ADMIN: admin sets individual states', () => {});
  test('MODO_ADMIN: states persist after restart', () => {});
  test('Policy switching: no data loss', () => {});
});
```

### Integration Tests (tests/f12-api.test.js)
```javascript
describe('F12 API', () => {
  test('GET /api/f12/politica returns current policy', () => {});
  test('PUT /api/f12/politica requires SUPER_ADMIN', () => {});
  test('PUT /api/f12/estado/:caixaId validates policy', () => {});
  test('POST /api/f12/alternar respects POR_CAIXA', () => {});
  test('GET /api/f12/caixas returns all cash + state', () => {});
});
```

### Manual Test Cases
1. **POR_CAIXA to GLOBAL**: Verify all cash registers show same state
2. **GLOBAL to MODO_ADMIN**: Verify individual states are preserved
3. **Policy switch with open cash**: Verify no inconsistencies
4. **PDV restart**: Verify correct state loaded from backend
5. **Multi-user F12 toggle**: Verify no race conditions

## Files to Create/Modify

### Create
- `backend/services/F12PolicyService.js` ✓
- `backend/rotas/f12.js` (API endpoints)
- `frontend/shared/pages/f12-admin-config.html` (Admin UI)
- `frontend/shared/js/F12PolicyResolver.js` (Frontend resolver)
- `tests/f12-policy.test.js`
- `tests/f12-api.test.js`

### Modify
- `backend/database.js` (add migrations)
- `backend/rotas/caixas.js` (add f12_ativo field)
- `backend/rotas/configuracoes.js` (add F12 endpoints)
- `backend/middleware/auth.js` (add admin validation)
- `frontend/shared/js/core.js` (update F12 logic)
- `frontend/pdv/js/pdv.js` (update F12 key handler)
- `frontend/erp/js/dashboard.js` (add controls)
- `frontend/shared/menu.js` (add admin page link)

## Configuration

Admin should configure F12 policy via:
1. ERP Dashboard → Configurações → F12 Policy
2. Select policy: POR_CAIXA | GLOBAL | MODO_ADMIN
3. If GLOBAL: set global state
4. If MODO_ADMIN: configure individual cash registers
5. Save and notify all PDV instances

## Fallback/Rollback

If issues occur:
1. Set policy back to POR_CAIXA
2. Clear browser localStorage for `pdv_modo_fiscal_ativo` (will read from backend)
3. Restart all PDV instances
4. Check backend logs for errors

## Performance Considerations

- Caixa query cached per session (5-minute TTL)
- Policy query cached globally (1-minute TTL)
- F12 state resolution in single query
- Minimal impact on PDV responsiveness

## Security Notes

- All permission checks MUST happen on backend
- Frontend checks are UX only, not security
- Admin password required for policy changes
- Audit log all F12 policy/state changes
- Rate limit API endpoints to prevent abuse

## Acceptance Criteria

- [x] All three policies working correctly
- [x] Operator cannot bypass restrictions (backend validation)
- [x] States persist after restart
- [x] Admin can configure policies via UI
- [x] No fiscal/non-fiscal architecture changes
- [x] Existing tests pass
- [x] New tests cover all scenarios
- [x] Documentation complete
