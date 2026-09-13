# RELATÓRIO RC11.3 — LAZY SERVICES (GRUPO D)

**Data:** 2026-07-26  
**Arquitetura:** `docs/oficial/performance/BOOT_INTELIGENTE_RC11_1.md`  
**Confidence:** 1.00  

---

## 1. Resumo executivo

Implementado **Lazy Initialization** para routers do **Grupo D**, via `backend/boot/lazyService.js` e montagem em `backend/server.js`.

- Serviços **não** são `require()`d no boot.
- Na **primeira** requisição ao path correspondente: instancia + cache singleton.
- Requisições seguintes: **reutilizam** a mesma instância.
- Contratos de API, auth, licença, banco e regras de negócio: **inalterados**.

**Prova de boot limpo:** após `HTTP LISTENING`, `getLoadedServices() === []` e nenhum dos módulos Grupo D estava em `require.cache`.

---

## 2. Inventário e dependências

| Serviço | Rota API | Quem instancia (antes) | Quando é usado | Lazy? |
|---------|----------|------------------------|----------------|-------|
| MIIP | `/api/miip` | `server.js` require eager | Central revisão / identificação | **Sim** |
| Laboratório | `/api/laboratorio-equipamentos` | eager | Lab de equipamentos | **Sim** |
| Engenharia Reversa | `/api/engenharia-reversa` | eager | Ferramenta Toledo/ER | **Sim** |
| Auditoria (consulta UI) | `/api/auditoria` | eager | Tela de logs | **Sim** |
| Backup (ferramentas) | `/api/backup` | eager | Backup manual | **Sim** |
| Homologação | *(sem router dedicado)* | UI em Central Entradas | — | N/A nesta RC |

### Residual (fora do escopo desta RC)

`backend/rotas/compras.js` ainda faz `require('../motores/miip/MiipService')` no load da rota de compras (Grupo C eager). Isso **não** carrega `rotas/miip`, mas mantém acoplamento do motor MIIP ao grafo de compras. Candidato a RC11.5 (Lazy MIIP profundo).

---

## 3. Implementação

### Novo módulo

`backend/boot/lazyService.js`

- `createLazyRouter(serviceId, factory)`
- Cache `Map` singleton
- Logs: `LAZY INIT`, `SERVICE CREATED`, `SERVICE REUSED` (1ª reutilização), `SERVICE ERROR`
- `createdMs` por serviço

### Alteração em `server.js`

Removidos requires eager de:

- `./rotas/miip`
- `./rotas/auditoria`
- `./rotas/laboratorioEquipamentos`
- `./rotas/engenhariaReversa`
- `./rotas/backup`

Substituídos por:

```js
const miipRoutes = createLazyRouter('miip', () => require('./rotas/miip'));
// ... idem para os demais
```

`app.use('/api/...', verificarToken, …)` permanece idêntico (paths e middlewares iguais).

---

## 4. Cache / singleton

| Chamada | Comportamento |
|---------|---------------|
| 1ª | `LAZY INIT` → `factory()` → `SERVICE CREATED` → atende request |
| 2ª+ | Reutiliza router em cache; log `SERVICE REUSED` na primeira reutilização |

Node é single-threaded no require síncrono → sem dupla criação concorrente.

---

## 5. Métricas

| Métrica | Valor |
|---------|-------|
| Serviços convertidos | **5** |
| Tempo economizado no boot (require agregado Grupo D, processo isolado) | **~268 ms** (inclui side-effects de deps; ordem de grandeza do adiamento) |
| Módulos Grupo D em `require.cache` no listen | **0 / 5** |
| Lazy cache no listen | **vazio** |
| Tempo médio 1ª carga (helper, backup) | **~0–1 ms** (módulo leve; MIIP será maior na 1ª hit real) |
| Reutilização | **singleton** confirmado (`reuses ≥ 1`) |
| Memória economizada no boot | Evita carregar grafo MIIP routes + lab + ER + auditoria + backup até o uso (ganho proporcional ao heap desses módulos e deps exclusivas) |

---

## 6. Validação

| Check | Resultado |
|-------|-----------|
| Boot sem Grupo D em cache | **OK** (`BOOT_LAZY_EMPTY true`) |
| `node --check` server + lazyService + electron | OK |
| `test:equipamentos-contracts` | 28/28 |
| `test:nfe-parser` | 6/6 |
| `miip-readiness` | 42/42 |
| `rc410-congelamento-v4` | 6/6 |
| package.json / Electron / APIs públicas | não alterados |

---

## 7. Checklist de sucesso

| Critério | Status |
|----------|--------|
| Boot sem carregar serviços opcionais (Grupo D routers) | ✓ |
| Criação apenas no primeiro uso | ✓ |
| Singleton garantido | ✓ |
| Testes principais aprovados | ✓ |
| Sem mudança de comportamento de API | ✓ |

---

## 8. Arquivos

| Arquivo | Ação |
|---------|------|
| `backend/boot/lazyService.js` | **Criado** |
| `backend/server.js` | Requires Grupo D → lazy |
| `docs/oficial/performance/RELATORIO_RC11_3_LAZY_SERVICES.md` | Este relatório |

*Próximo:* RC11.4 Lazy ERP (frontend) e/ou RC11.5 Lazy MIIP profundo (desacoplar `compras.js` → MiipService).

*Fim do RELATORIO_RC11_3_LAZY_SERVICES.md*