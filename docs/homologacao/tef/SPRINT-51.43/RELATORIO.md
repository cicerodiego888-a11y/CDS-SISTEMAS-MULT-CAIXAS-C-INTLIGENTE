# SPRINT 51.43 — Correção do 401 no resumo NFC-e / TEF

**Data:** 2026-11-10  
**Escopo:** autenticação de `GET /api/tef/venda/:id/resumo` + fonte TEF do resumo  
**Restrições cumpridas:** sem alteração de venda 66 / TEF 2–3 / recebimentos; sem CRT/DLL/NativeHost/fiscal; sem desabilitar autenticação; sem escrita no banco oficial.

---

## 1. Causa raiz do HTTP 401

| Camada | Evidência |
| --- | --- |
| Montagem | `backend/server.js`: `app.use('/api/tef', verificarToken, tefRoutes)` |
| Middleware | `verificarToken` → sem token → **HTTP 401** `{ error: 'Acesso negado' }` |
| Frontend | `verResumoVendaFiscalTEF()` usava `fetch(...)` **sem** header `Authorization` |
| Contraste | Demais consultas ERP usam `$.ajaxSetup` (Bearer automático) ou `Authorization: Bearer ${localStorage.getItem('token')}` explícito (ex.: cancelamento em `vendas.js`) |

O 401 **não** veio de licença, empresa ou permissão de perfil: veio de **ausência de JWT** na chamada `fetch`, com a mensagem literal `Acesso negado` produzida por `backend/middleware/auth.js`.

**Lacuna adicional (pós-auth):** a query do resumo lia TEF só de `venda_pagamentos` com `tef_transacao_id IS NOT NULL`. Na venda 66 o pagamento `#79` não espelha TEF; o vínculo real está em `vendas.tef_transacao_id=3` + `tef_transacoes` (NSU 2338 / auth 211139). Sem fallback, o resumo autenticado ainda omitiria a TEF.

---

## 2. Correção aplicada

### Frontend (mesmo padrão Bearer das demais consultas)

Arquivos:

- `frontend/erp/js/vendas.js`
- `frontend/pdv/js/vendas.js`
- `frontend/pdv/js/pdv.js`

Alteração:

- Envio de `Authorization: Bearer <token>` (`localStorage` / `sessionStorage`)
- Tratamento explícito de **401** (acesso negado / sessão) e **403** (token inválido/expirado)
- Exibição de `tef_transacao_id` no alerta do resumo

### Backend (compatibilidade de fonte TEF — sem enfraquecer auth)

Arquivo: `backend/rotas/tef.js`

- Mantém `verificarToken` no mount `/api/tef` (obrigatório)
- `LEFT JOIN tef_transacoes` com `COALESCE(v.tef_transacao_id, vp.tef_transacao_id)`
- Campos TEF via `COALESCE(venda_pagamentos, tef_transacoes)`

Nenhuma exceção para a venda 66; nenhuma rota pública criada.

---

## 3. Testes executados e resultados

### Suite estática + SQL oficial

`tests/tef/tef-destaxa-51-43-resumo-auth.test.js` → **8 ok**

| Caso | Resultado |
| --- | --- |
| ERP/PDV enviam Bearer | OK |
| `verificarToken` permanece em `/api/tef` | OK |
| 401 sem token = `Acesso negado` | OK |
| SQL fallback devolve TX 3 / NSU 2338 / auth 211139 | OK |
| Venda inexistente sem linha | OK |
| Probes live ERP `:5700` | **SKIP** (ERP parado — `ECONNREFUSED`) |

### Suite middleware HTTP (harness local)

`tests/tef/tef-destaxa-51-43-resumo-middleware.test.js` → **5 ok**

| Caso | Resultado |
| --- | --- |
| Sem autenticação → **401** | OK |
| Token inválido → **403** | OK |
| JWT válido → **200** com TEF **3** / NSU **2338** / auth **211139** | OK |
| Venda inexistente autenticada → **404** | OK |
| Venda inexistente sem auth → **401** (auth primeiro) | OK |

**Nota sobre “usuário sem permissão”:** a rota `/api/tef` já era protegida apenas por JWT (`verificarToken`), sem `exigirPermissao` específico. Esse contrato foi **preservado**; token inválido continua **403**. Não foi adicionado bypass nem gate novo.

---

## 4. Confirmação de não-execução financeira/fiscal

Nesta sprint **não** foram executados:

- CRT / `TX_START` / `TX_CONTINUE` / `TX_FINALIZE`
- DLL / NativeHost / V$Pague / Destaxa
- Emissão fiscal / SEFAZ
- Escrita em venda 66, TEF 2/3, recebimentos, comprovantes ou totais
- Desabilitação de autenticação

---

## 5. Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `frontend/erp/js/vendas.js` | Bearer + tratamento 401/403 + TEF id no resumo |
| `frontend/pdv/js/vendas.js` | Idem |
| `frontend/pdv/js/pdv.js` | Idem |
| `backend/rotas/tef.js` | Fallback `tef_transacoes` no resumo |
| `tests/tef/tef-destaxa-51-43-resumo-auth.test.js` | Novo |
| `tests/tef/tef-destaxa-51-43-resumo-middleware.test.js` | Novo |
| este relatório | Entrega |

**Nenhuma sprint seguinte iniciada automaticamente.**
