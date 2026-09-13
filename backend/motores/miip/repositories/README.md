# repositories/

Camada de persistência SQLite do MIIP.

**Sprint 2.1:** CRUD implementado — sem regra de negócio.

Todos os repositories estendem `IRepository` e utilizam `dbHelpers.js` para operações promisificadas.

## Arquivos

| Arquivo | Tabela | Responsabilidade |
|---------|--------|------------------|
| `IRepository.js` | — | Contrato abstrato (CRUD base) |
| `dbHelpers.js` | — | Helpers SQLite compartilhados |
| `MiipAssociacoesRepository.js` | `miip_associacoes` | Vínculos item externo → produto |
| `MiipDecisoesRepository.js` | `miip_decisoes` | Auditoria de decisões |
| `MiipSinonimosRepository.js` | `miip_sinonimos` | **@deprecated RC1** — reservado para futura evolução do MIIP V2; Synonyms usa JSON |
| `MiipEstatisticasRepository.js` | `miip_estatisticas` | **@deprecated RC1** — reservado para futura evolução do MIIP V2; agregados via `MiipDecisoesRepository` |
| `MiipConfiguracoesRepository.js` | `miip_configuracoes` | Configuração runtime |
| `ProdutoRepository.js` | `produtos` | **Leitura oficial** de produtos → `ProdutoSnapshot` |
| `ProdutoMiipRepository.js` | `produtos` | Shim legado → delega ao `ProdutoRepository` |
| `index.js` | — | Barrel export |

## Contrato IRepository

| Método | Descrição |
|--------|-----------|
| `getCodigo()` | Código da tabela |
| `getDescricao()` | Descrição legível |
| `buscarPorId(id)` | SELECT por PK |
| `listar(filtros)` | SELECT com filtros e paginação |
| `inserir(dados)` | INSERT |
| `atualizar(id, dados)` | UPDATE parcial |
| `remover(id)` | DELETE |

## Uso

```javascript
const { MiipAssociacoesRepository } = require('./motores/miip/repositories');

const repo = new MiipAssociacoesRepository({ db });
const associacao = await repo.buscarPorFornecedorCodigo('12345678000199', 'PROD-001');
```

Singletons exportados usam `database` do CDS via lazy load quando `db` não é injetado.

## Validação de herança

```javascript
const { IRepository, MiipDecisoesRepository } = require('./motores/miip/repositories');

IRepository.validarHeranca(MiipDecisoesRepository.MiipDecisoesRepository);
```

Documentação do banco: [`docs/motores/miip/MIIP_BANCO_DADOS.md`](../../../docs/motores/miip/MIIP_BANCO_DADOS.md)
