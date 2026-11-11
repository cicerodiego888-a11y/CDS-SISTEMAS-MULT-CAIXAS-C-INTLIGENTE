# SPRINT 51.39 — Correção do contexto F12 no PDV

**Data:** 2026-11-10  
**Escopo:** diagnóstico e correção de `GET /api/f12/contexto/:id` (403) e identificação do 400.  
**Restrições respeitadas:** sem TEF, sem NativeHost/DLL Destaxa, sem COM4, sem permit, sem gate financeiro, sem venda/recebimento, sem alteração da TX TEF id=2, sem mudança de regras fiscais, sem alteração do PDV Universal.

---

## Causa raiz do HTTP 403

**Licença comercial vencida em tolerância PDV**, com `/api/f12` **fora** da allowlist operacional `PDV_GRACE_PREFIXES`.

Fluxo:

1. `app.use('/api', apiAuthLicencaGate)` autentica o JWT com sucesso.
2. `licencaMiddleware` detecta `VENCIDA` + `emToleranciaPdv`.
3. Rotas como `/api/vendas`, `/api/caixa`, `/api/tef`, `/api/terminais` passam.
4. `GET /api/f12/contexto/2` **não** está na lista → `responderLicencaInvalida` → **HTTP 403** (`LICENCA_VENCIDA`).
5. O frontend (`F12PolicyResolver`) interpreta qualquer `!response.ok` como falha e loga `[F12] Failed to resolve contexto: 403`, caindo no fallback “Backend unreachable”.

**Evidência em `licenca_logs` (banco oficial):**

| Evento | Detalhe | Qtd |
| --- | --- | ---: |
| Licença vencida | Tentativa de uso bloqueado em rota `/api/f12/contexto/2` | **1630** |
| Licença vencida | `/api/f12/caixas` | 1 |
| Licença vencida | `/api/f12/info` | 1 |

Não houve divergência empresa/usuário/caixa: o caixa **id=2** existe (`pdv-01`). A rota de leitura de contexto **não** exige admin; o 403 não veio de autorização F12 nem de JWT (não há `[AUTH]` correspondente às centenas de falhas F12).

---

## Causa raiz do HTTP 400

Na sessão do PDV analisada (**terminal Electron audit**), **não há** log `[F12] Failed to resolve contexto: 400`. Os erros F12 observados foram **somente 403**.

O contrato da API para `GET /api/f12/contexto/:caixaId` devolve **400** com `{ error: 'caixaId inválido' }` quando `Number(caixaId)` é falsy (ex.: `abc`, `0`). Isso foi confirmado no probe pós-correção. Não há evidência de que o PDV tenha enviado caixaId inválido na sessão homologada; o 400 do contrato permanece apenas para input realmente inválido.

---

## Correção aplicada

Incluir `/api/f12` em `PDV_GRACE_PREFIXES` para que o PDV continue resolvendo o contexto fiscal oficial durante a tolerância de 5 dias — sem remover autenticação, sem usar localStorage como fonte oficial, sem afrouxar regras de autorização F12 (toggle/admin intactos).

Diagnóstico no frontend: log de falha de contexto agora inclui `erro`/`error` do JSON (ex.: `LICENCA_VENCIDA` vs `TOKEN_EXPIRADO`).

---

## Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `backend/middleware/licencaMiddleware.js` | `/api/f12` na allowlist de tolerância PDV |
| `tests/licenciamento/hotfix-tolerancia-pdv-licenca.test.js` | asserts de `/api/f12/contexto/2` e `/api/f12/info` |
| `frontend/shared/js/F12PolicyResolver.js` | log de falha com código de erro do backend |

Artefatos de probe (homologação, não código de produto): `docs/homologacao/tef/SPRINT-51.39/_probe-*.js`.

---

## Testes executados e resultados

1. **Unit — tolerância PDV** (`node --test tests/licenciamento/hotfix-tolerancia-pdv-licenca.test.js`): **8/8 pass**, incluindo liberação de `/api/f12/*` na grace.
2. **Probe HTTP** (backend local `:3001`, gate TEF OFF, sem NativeHost/DLL/COM4/venda):
   - Usuário autorizado (`Diego` SUPER_ADMIN) → `GET /api/f12/contexto/2` → **200** (`ativo`, `podeAlterar`, `controle=OPERADOR`, `caixaId=2`).
   - Operador autenticado (JWT de leitura) → **200** (leitura permitida).
   - Sem token → **401**.
   - Token inválido → **403** `TOKEN_INVALIDO`.
   - `caixaId=abc` → **400** `caixaId inválido`.
   - Caixa inexistente `999999` → **200** com `ativo:false` (contrato atual do serviço; não 404).

---

## Confirmação de isolamento

Nenhuma operação financeira ou fiscal foi executada nesta sprint: sem CRT/TX TEF, sem NativeHost, sem DLL Destaxa, sem COM4, sem emissão de permit, sem habilitação de gate, sem venda/recebimento, sem alteração da transação TEF id=2.
