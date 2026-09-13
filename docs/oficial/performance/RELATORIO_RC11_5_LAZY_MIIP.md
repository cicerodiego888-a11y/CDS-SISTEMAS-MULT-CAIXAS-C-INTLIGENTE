# RELATÓRIO RC11.5 — DESACOPLAMENTO COMPLETO DO MIIP (LAZY)

**Data:** 2026-07-26  
**Arquitetura:** `docs/oficial/performance/BOOT_INTELIGENTE_RC11_1.md`  
**Pré-requisito:** RC11.3 (Lazy routers Grupo D)  
**Confidence:** 1.00  

---

## 1. Resumo executivo

O `MiipService` (e o grafo de engines Decision / Explain / Synonyms / Canonical / Pipeline) **não é mais carregado no boot** do CDS Sistemas.

- **Primeiro uso** (Compras, Central/parse enriquecido, ou `/api/miip`): `getMiipService()` faz `require` + cache singleton.
- **Demais usos:** reutilizam a mesma instância (Node `require.cache` + `getLazySingleton`).
- Regras de negócio, algoritmos MIIP e engines: **inalterados**.

**Prova:** após `HTTP LISTENING`, `MiipService.js` ausente de `require.cache`, nenhum engine MIIP carregado, lazy cache sem `MiipService`.

---

## 2. Fase 1 — Inventário de referências a `MiipService`

| Local | Tipo | Antes | Depois |
|-------|------|-------|--------|
| `backend/motores/miip/MiipService.js` | `new MiipService()` + export singleton | Eager no `require` do módulo | Inalterado (lazy só no *quando* require) |
| `backend/motores/miip/index.js` | `require('./MiipService')` | Barrel público | Sem uso no boot |
| `backend/rotas/compras.js` | `require` top-level | **Eager no boot** (compras eager) | `getMiipService()` sob demanda |
| `backend/shared/nfe/enriquecerParseComMiip.js` | `require` top-level | Eager via Central → Processamento | `getMiipService()` no processamento |
| `backend/rotas/miip.js` | `require` top-level | Já atrás de lazy router (RC11.3) | `getMiipService()` nos handlers |
| `backend/motores/miip/getMiipService.js` | Accessor | — | **Novo** |

Não há injeção DI formal além de `deps.miipService` opcional em `enriquecerParseComMiip` (testes/override).

### Dependências indiretas (não são `MiipService`)

| Módulo | Uso no boot | Impacto |
|--------|-------------|---------|
| `miip/utils/miipCentralRevisaoUtils` | Central Entradas (scores/pendências) | Funções puras — OK |
| `miip/repositories/dbHelpers` | MIP / repos | Sem engines — OK |
| `MiipMonitoringService` | Já lazy em `CentralDiagnosticoService` | Fora do boot |

---

## 3. Fase 2 — Acoplamentos que provocavam carga no boot

```
server.js
  ├─ rotas/compras.js  ──require──► MiipService.js  (REMOVIDO)
  │                                    └─ new → Orchestrator → Pipeline → Engines
  └─ rotas/central-entradas.js
       └─ CentralEntradasOrchestrator
            └─ CentralProcessamentoService
                 └─ enriquecerParseComMiip ──require──► MiipService.js  (REMOVIDO)
```

| Origem | Grupo | Efeito |
|--------|-------|--------|
| `compras.js` | C (eager) | Carregava MIIP completo ao montar `/api/compras` |
| `enriquecerParseComMiip` | via Central eager | Mesmo grafo ao montar Central |
| `rotas/miip` | D (já lazy RC11.3) | Só na 1ª hit `/api/miip` |
| Background Central Sync | B pós-listen | Não instancia `MiipService` no start do scheduler |

---

## 4. Fase 3 — Implementação

### `backend/boot/lazyService.js`

- Novo: `getLazySingleton(serviceId, factory)`
- Logs: `LAZY INIT` / `SERVICE CREATED` / `SERVICE REUSED`
- `wasLoaded` / `getLoadedServices` / `getServiceStats` cobrem routers **e** singletons

### `backend/motores/miip/getMiipService.js`

```js
function getMiipService() {
  return getLazySingleton('MiipService', () => require('./MiipService'));
}
```

### Call sites

| Arquivo | Mudança |
|---------|---------|
| `rotas/compras.js` | Remove require eager; `getMiipService()` em `ensureProductForItem` |
| `shared/nfe/enriquecerParseComMiip.js` | Lazy service + lazy `MiipImportacaoXmlService` no fluxo |
| `rotas/miip.js` | Handlers via `miip()` → `getMiipService()` |

**Não alterados:** Decision Engine, Explain Engine, Synonyms Engine, Canonical Engine, `MiipService` internals, contratos HTTP.

---

## 5. Fase 4 — Validação (listen)

Script: `scripts/rc11-5-validar-lazy-miip.js`

| Check | Resultado |
|-------|-----------|
| `MiipService.js` em `require.cache` no listen | **Ausente** |
| Engines / Pipeline / Orchestrator no cache | **[]** |
| `wasLoaded('MiipService')` no listen | **false** |
| Lazy loaded services no listen | **[]** |
| Após `getMiipService()` | presente + engines carregados |
| 2ª chamada | mesma instância (`sameInstance: true`, `reuses ≥ 1`) |

---

## 6. Fase 5 — Testes

| Suíte | Resultado |
|-------|-----------|
| `test:miip-readiness` | 42/42 |
| `test:miip-decision` | 69/69 |
| `test:miip-explain` | 40/40 |
| `test:miip-canonical` | OK |
| `test:miip-synonyms` | 77/77 |
| `test:miip-importacao-xml` / paridade | OK |
| `test:miip-central-revisao` / `test:central-entradas-sprint5` | 7/7 (lazy CREATE + REUSE observados) |
| `test:nfe-parser` | 6/6 |
| `test:mip-sprint07` (Compras/XML/Central) | 9/9 |
| `test:equipamentos-contracts` | 28/28 |
| `test:rc3165-electron` | OK |
| `tests/faturamento/rc410-congelamento-v4.test.js` | 6/6 |
| `node --check` nos arquivos tocados | OK |

---

## 7. Métricas

| Métrica | Valor |
|---------|-------|
| Imports/`require` de `MiipService` removidos do caminho de boot | **2** (`compras.js`, `enriquecerParseComMiip.js`) + alinhamento em `miip.js` (já fora do boot via RC11.3) |
| Tempo economizado no boot (adiamento do require+construct) | **~34 ms** (`createdMs` medido no 1º uso) |
| Memória economizada no boot (heap do 1º load) | **~4.2 MB** (heap delta 1º `getMiipService`) |
| Tempo do primeiro carregamento | **~33–34 ms** |
| Tempo das reutilizações | **~0 ms** (cache hit) |
| Engines carregados no boot | **0** |
| Engines após 1º uso (amostra) | **9** entradas de cache relacionadas |

*Nota:* tempos/heap variam com máquina e cold cache do Node; valores acima são da medição RC11.5 nesta sessão.

---

## 8. Checklist de sucesso

| Critério | Status |
|----------|--------|
| Boot sem qualquer carga do `MiipService` | ✓ |
| Primeiro uso cria o serviço | ✓ |
| Reutilização garantida (singleton) | ✓ |
| Testes aprovados | ✓ |
| Sem alteração de regras/algoritmos/engines | ✓ |

---

## 9. Arquivos

| Arquivo | Ação |
|---------|------|
| `backend/boot/lazyService.js` | `getLazySingleton` + stats unificados |
| `backend/motores/miip/getMiipService.js` | **Criado** |
| `backend/rotas/compras.js` | Lazy |
| `backend/shared/nfe/enriquecerParseComMiip.js` | Lazy |
| `backend/rotas/miip.js` | Lazy accessor |
| `scripts/rc11-5-validar-lazy-miip.js` | Validação boot/métricas |
| `docs/oficial/performance/RELATORIO_RC11_5_LAZY_MIIP.md` | Este relatório |

*Fim do RELATORIO_RC11_5_LAZY_MIIP.md*
