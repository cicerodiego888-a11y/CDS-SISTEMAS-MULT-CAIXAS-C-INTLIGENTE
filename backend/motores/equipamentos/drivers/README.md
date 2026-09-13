# Framework de Drivers — Motor Equipamentos

Infraestrutura de **plugins** para integração com balanças e demais equipamentos do CDS Sistemas.

**Status (Sprint 13A):** Framework completo. **1 driver carregável** (`TOLEDO_PRIX4_UNO`). Demais fabricantes catalogados aguardam implementação.

## Componentes

| Arquivo | Responsabilidade |
|---------|------------------|
| `BaseDriver.js` | Classe abstrata — 20 métodos obrigatórios |
| `DriverRegistry.js` | Registro central de classes carregadas |
| `DriverLoader.js` | Auto-load de módulos declarados no catálogo |
| `driverCatalog.js` | Metadados (6 drivers: Toledo, Filizola, Urano, Aclas, Elgin, Bematech) |

## Catálogo vs. implementação

| Código | Fabricante | Carregável |
|--------|------------|------------|
| `TOLEDO_PRIX4_UNO` | Toledo Prix 4 Uno | **Sim** |
| `FILIZOLA_PLATINA` | Filizola | Não (catalogo) |
| `URANO_POP` | Urano | Não (catalogo) |
| `ACLAS_LS2` | Aclas | Não (catalogo) |
| `ELGEN_BALANCA` | Elgin | Não (catalogo) |
| `BEMATECH_BP5` | Bematech | Não (catalogo) |

## Fluxo de carregamento

```
DriverLoader.carregarTodos()
    → lê driverCatalog (entradas com `modulo`)
    → require() do arquivo *Driver.js
    → BaseDriver.validarHeranca(Classe)
    → DriverRegistry.registrar()
```

Bootstrap no startup: `driverManager.obterRelatorioCarregamento()` (via `server.js`).

## Criar um novo driver

1. Criar pasta `fabricante/modelo/`
2. Implementar classe estendendo `BaseDriver`
3. Adicionar entrada em `driverCatalog.js` com `modulo: './...'`
4. Criar `Protocol`, `Parser`, `Validator`, `Mapper` conforme necessário

## Testes

```bash
npm run test:equipamentos-drivers
npm run test:equipamentos-toledo-prix4
```
