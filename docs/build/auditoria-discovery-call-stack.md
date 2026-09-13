# Auditoria — Maximum call stack size exceeded no Discovery

**Escopo:** fluxo `🔍 Procurar Equipamentos` apenas.  
**Fora de escopo:** Diagnóstico RC14.12.x (desconsiderado).  
**Ação:** somente leitura — nenhum código alterado.

---

## Veredito

| Item | Valor |
|------|--------|
| **Causa exata** | Recursão infinita no export de `descobrir` |
| **Arquivo** | `backend/motores/equipamentos/discovery/DiscoveryManager.js` |
| **Linha** | **208** (wrapper; crash na mesma linha) |
| **Função** | `module.exports.descobrir` (wrapper que sobrescreve o método da instância) |
| **Erro** | `RangeError: Maximum call stack size exceeded` |
| **Confiança** | **100%** (reproduzido em Node) |

---

## 1. Stack Trace (reproduzida)

```text
RangeError: Maximum call stack size exceeded
    at module.exports.descobrir (...\DiscoveryManager.js:208:28)
    at module.exports.descobrir (...\DiscoveryManager.js:208:58)
    at module.exports.descobrir (...\DiscoveryManager.js:208:58)
    at module.exports.descobrir (...\DiscoveryManager.js:208:58)
    … (repete indefinidamente)
```

| Campo | Valor |
|-------|--------|
| Arquivo | `DiscoveryManager.js` |
| Linha | `208` |
| Função | `module.exports.descobrir` |
| Sequência | mesma função → mesma função → … |

Não há frames de `NetworkScanner`, `PortScanner`, `ProbeExecutor` nem do front — o overflow ocorre **antes** do scan.

---

## 2. Fluxo real até a falha

```text
Botão Procurar Equipamentos
  onclick → centralEqProcurarEquipamentos()
    frontend/erp/js/central-equipamentos.js (~1617)
      ↓
POST /api/equipamentos/discovery/all
      ↓
DiscoveryController.discoveryAll
  DiscoveryController.js (~143–146)
      ↓
discoveryManager.descobrir(body)
      ↓
❌ DiscoveryManager.js:208 — wrapper recursivo
      ↓
(nunca chega)
  DiscoveryManager.prototype.descobrir
  EthernetDiscovery / NetworkScanner / PortScanner / TcpScanner
  CandidateBuilder / renderização de resultados
```

Trecho do controller:

```143:146:backend/motores/equipamentos/discovery/DiscoveryController.js
async function discoveryAll(req, res) {
  ...
    const resultado = await discoveryManager.descobrir(body);
```

Trecho do front (entrada):

```1664:1674:frontend/erp/js/central-equipamentos.js
    const respAll = await fetch(`${api}/equipamentos/discovery/all`, {
      method: 'POST',
      ...
      body: JSON.stringify({ transportes, timeoutTcpMs: 200, concorrencia: 50, meta: true, lab: true })
    });
```

---

## 3. Motivo do stack overflow

Código problemático:

```204:209:backend/motores/equipamentos/discovery/DiscoveryManager.js
const discoveryManager = new DiscoveryManager();

module.exports = discoveryManager;
module.exports.DiscoveryManager = DiscoveryManager;
module.exports.descobrir = (...args) => discoveryManager.descobrir(...args);
module.exports.descobrirEthernet = (...args) => discoveryManager.descobrirEthernet(...args);
```

1. `module.exports = discoveryManager` exporta a **mesma instância**.
2. `module.exports.descobrir = (...) => discoveryManager.descobrir(...)` **substitui** o método `descobrir` dessa instância pelo wrapper.
3. Como `module.exports === discoveryManager`, a chamada `discoveryManager.descobrir(...)` passa a invocar o **próprio wrapper**.
4. Resultado: recursão infinita → `Maximum call stack size exceeded`.

Não é serialização circular (`JSON.stringify` de `req`/`socket`/etc.). É **recursão de chamada de função**.

---

## 4. Checklist da auditoria

| Verificação | Resultado |
|-------------|-----------|
| Serialização circular (`req`, `res`, `socket`, `ConnectionManager`, `DeviceCandidate`, `DiscoveryResult`) | **Não é a causa** neste clique |
| Renderização chamando de novo `discovery` / `refresh` / `loadEquipamentos` | **Não** — a API já falha; o painel não entra em loop de render |
| Duplicidade de `onclick` / `addEventListener` | **Não** — um `onclick` no botão + binding em `window` |
| Recursão em NetworkScanner / PortScanner | **Não alcançados** |
| Onde ocorre a recursão | **Somente** `DiscoveryManager.js:208` |

---

## 5. Anti-padrão latente (mesmo padrão)

Mesmo overwrite após `module.exports = instância`:

| Arquivo | Linha (aprox.) | Método |
|---------|----------------|--------|
| `EthernetDiscovery.js` | ~329 | `executar` |
| `DiscoveryEngineV1.js` | ~210–211 | `executar` / `listarEquipamentos` |

Se `DiscoveryManager.descobrir` for corrigido e ainda chamar `ethernetDiscovery.executar` via o export mutado, o próximo overflow pode aparecer em `EthernetDiscovery.js`.

`DiscoveryService.js` **não** usa esse padrão.

---

## 6. Conclusão

O botão **Procurar Equipamentos** quebra no backend, no export quebrado de `DiscoveryManager.descobrir`, por auto-invocação infinita do wrapper. Scanners, probes e UI de resultados não participam do crash.

Diagnóstico e RC14.12.x não estão envolvidos.
