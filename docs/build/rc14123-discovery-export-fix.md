# RC14.12.3 — Correção sistêmica dos exports recursivos do Discovery

## Motivo

`RangeError: Maximum call stack size exceeded` ao clicar em **Procurar Equipamentos**, causado por wrappers que sobrescreviam métodos da própria instância exportada:

```js
module.exports = discoveryManager;
module.exports.descobrir = (...args) => discoveryManager.descobrir(...args);
// module.exports === discoveryManager → recursão infinita
```

## Padrão adotado

```js
module.exports = instancia;
module.exports.Classe = Classe;
// helpers estáticos OK (ex.: coletarDriversEthernet)
// NUNCA: module.exports.metodo = (...args) => instancia.metodo(...args)
```

## Arquivos corrigidos

| Arquivo | Removido |
|---------|----------|
| `DiscoveryManager.js` | wrappers `descobrir`, `descobrirEthernet` |
| `EthernetDiscovery.js` | wrapper `executar` |
| `DiscoveryEngineV1.js` | wrappers `executar`, `listarEquipamentos` |

## Já seguros (sem alteração)

- `DiscoveryService.js` — instância + classe + constantes
- `DiscoveryController.js` — export de funções
- `ConnectionManager.js` — instância + classe + constantes (sem wrappers de método)
- `ToledoOperationEngine.js` — mesmo padrão seguro

## Impacto

- Sem mudança de negócio, protocolo, Driver Toledo ou scanners
- `descobrir()` executa o método do prototype **uma vez**
- NetworkScanner / PortScanner voltam a ser alcançados

## Testes

```bash
npm run test:discovery-export-fix   # 6/6
npm run test:discovery-all           # export-fix + v1 + ethernet-v15 — OK
npm run test:discovery-v1            # 4/4
```

Regressão (sem falha relacionada a exports):

```bash
npm run test:fingerprint-v1
npm run test:connection-v1
npm run test:connection-manager-v2
npm run test:operations-v1
npm run test:monitor-v1
npm run test:certification-v2
npm run test:diagnostics-unification
npm run test:diagnostics-panel-v1
```

Evidência manual: `discoveryManager.descobrir({ hosts:['127.0.0.1'], portas:[1], ... })` → `{ sucesso: true, cand: 0, stack: false }`.

Nota: `test:driver-toledo-v1` falha em asserts de `capabilities.uploadPLU === false` (hoje `true`) — pré-existente / fora do escopo desta RC de exports.
