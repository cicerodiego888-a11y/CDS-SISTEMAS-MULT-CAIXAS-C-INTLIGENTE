# RC14.13.1 — Auditoria: combo Driver vazio em Nova Balança

**Escopo:** somente leitura — nenhum código alterado.  
**Tela:** Configurações → Equipamentos / Balanças → **Nova balança** (`#eqDriverCodigo`).

---

## Veredito

| Item | Valor |
|------|--------|
| **Causa principal** | Contrato de campos incompatível entre API SDK e front |
| **Arquivo** | `frontend/erp/js/equipamentos.js` |
| **Linha** | **751–752** |
| **Função** | `abrirModalEquipamento` |
| **Motivo** | O front lê `d.nome_exibicao` (snake_case legado); a API SDK devolve `nomeExibicao` (camelCase) |
| **Efeito no select** | Options são geradas, mas o **texto visível fica vazio** → combo aparenta “não preenchido” |

Causa secundária de contrato: `codigo` na API é `toledo-prix4`, não `TOLEDO_PRIX4_UNO` (este só aparece em `meta.catalogoLegado`).

---

## 1. Fonte de dados

O select **não** usa lista estática nem `DriverFactory`.

| Camada | Fonte |
|--------|--------|
| Front | Cache `driversCache` preenchido por API |
| Endpoint | `GET /api/equipamentos/drivers` |
| Handler | `sdk/DriverSdkController.listar` |
| Registry | `sdk/DriverRegistry` (Device Profile SDK 15.7) |
| Loader | `sdk/DriverLoader.carregarTodos()` |

Rota:

```10:10:backend/rotas/equipamentos.js
router.get('/drivers', require('../motores/equipamentos/sdk/DriverSdkController').listar);
```

**Nota:** `equipamentosController.listarDrivers` (fallback legado / `DriverManager`) **não** atende mais essa rota.

---

## 2. Fluxo e onde “quebra” a UX

```text
loadPage('equipamentos')
  ↓
carregarEquipamentosDados()          // equipamentos.js ~60
  ↓
GET /api/equipamentos/drivers        // OK — retorna drivers
  ↓
driversCache = drivers.drivers || [] // OK — array com 3 itens
  ↓
abrirModalEquipamento()              // ~737 (botão Nova balança)
  ↓
optionsDrivers = driversCache.map(d =>
  `<option ...>${d.nome_exibicao}</option>`   // ← AQUI
)
  ↓
<select id="eqDriverCodigo">
  <option value="">— Selecione —</option>
  <option value="toledo-prix4"></option>      // label VAZIO
  <option value="filizola-platina"></option>  // label VAZIO
  <option value="generico-serial"></option>   // label VAZIO
</select>
```

O fluxo **não** interrompe por falta de chamada HTTP nem por array vazio (no cenário normal após load).  
Interrompe a **exibição**: o label usa campo inexistente na resposta atual.

Trecho:

```751:775:frontend/erp/js/equipamentos.js
    const optionsDrivers = driversCache.map((d) =>
        `<option value="${escapeHtmlEquipamentos(d.codigo)}" data-id="${d.id}" data-fab="${escapeHtmlEquipamentos(d.fabricante)}" data-mod="${escapeHtmlEquipamentos(d.modelo)}" ${eq.driver_codigo === d.codigo ? 'selected' : ''}>${escapeHtmlEquipamentos(d.nome_exibicao)}</option>`
    ).join('');
    ...
                                <select class="form-select" id="eqDriverCodigo" ...>
                                    <option value="">— Selecione —</option>
                                    ${optionsDrivers}
                                </select>
```

`escapeHtmlEquipamentos(undefined)` → `''` (linhas 18–24).

---

## 3. Backend — registries e drivers

### Existem

| Componente | Caminho | Uso no combo |
|------------|---------|--------------|
| **SDK DriverRegistry** | `sdk/DriverRegistry.js` | **Sim** (API `/drivers`) |
| **SDK DriverLoader** | `sdk/DriverLoader.js` | Sim |
| **Device Profiles** | `sdk/profiles/*.js` + `drivers/**/device.profile.js` | Sim |
| **Legacy DriverRegistry** | `drivers/DriverRegistry.js` | Discovery / plugins — **não** alimenta o combo |
| **DriverManager** | `core/DriverManager.js` | Legado — rota atual não usa |
| **driverCatalog.js** | `drivers/driverCatalog.js` | Catálogo estático legado |
| **Tabela DB** | `equipamentos_drivers` | Seed com `TOLEDO_PRIX4_UNO` — **não** usada pela rota SDK |

### Drivers registrados no SDK (evidência runtime)

| id / codigo | nomeExibicao | Observação |
|-------------|--------------|------------|
| `toledo-prix4` | Toledo Prix IV Uno | Homologado; `meta.catalogoLegado = TOLEDO_PRIX4_UNO` |
| `filizola-platina` | Filizola Platina | Scaffold |
| `generico-serial` | (perfil genérico) | SDK profiles |

**Não** há registro com `codigo: "TOLEDO_PRIX4_UNO"` no SDK Registry.  
O código legado `TOLEDO_PRIX4_UNO` existe em DB (`database.js` seed) e em `driverCatalog.js` / `ToledoPrix4Constants.js`.

Perfil Toledo:

```7:40:backend/motores/equipamentos/sdk/profiles/toledo-prix4.js
module.exports = {
  id: 'toledo-prix4',
  ...
  nomeExibicao: 'Toledo Prix IV Uno',
  meta: {
    catalogoLegado: 'TOLEDO_PRIX4_UNO',
    fingerprintDriver: 'TOLEDO_PRIX4'
  }
};
```

`parseManifest` define `codigo: id` → sempre `toledo-prix4`.

---

## 4. Front-end

| Função esperada | Situação |
|-----------------|----------|
| `loadDrivers()` | **Não existe** com esse nome |
| Equivalente | `carregarEquipamentosDados()` (~60) |
| `populateDrivers()` / `renderDrivers()` | **Não existem**; options montadas em `abrirModalEquipamento` |
| API chamada? | **Sim**, no load da página |
| API vazia? | **Não** (3 drivers no SDK) |
| Erro JS fatal? | **Não** necessário — HTML inválido visualmente |
| Select limpo após preencher? | **Não** — options entram sem texto |

Fallback legado esperado pelo front (`nome_exibicao`, `codigo` UPPER_SNAKE) **não** é o payload do SDK.

---

## 5. API — retorno real

`GET /api/equipamentos/drivers` → `DriverSdkController.listar` (~70).

Formato típico:

```json
{
  "success": true,
  "drivers": [
    {
      "id": "toledo-prix4",
      "codigo": "toledo-prix4",
      "fabricante": "Toledo",
      "modelo": "Prix IV Uno",
      "nomeExibicao": "Toledo Prix IV Uno",
      "transportes": ["ethernet", "serial"],
      "categoria": "balanca",
      "status": "homologacao",
      "meta": { "catalogoLegado": "TOLEDO_PRIX4_UNO", "fingerprintDriver": "TOLEDO_PRIX4" },
      "implementado": true,
      "registrado": true
    }
  ],
  "total": 3
}
```

**Diferenças vs esperado da RC:**

| Esperado | Atual |
|----------|--------|
| `codigo: "TOLEDO_PRIX4_UNO"` | `codigo: "toledo-prix4"` |
| `nome` / `nome_exibicao` | `nomeExibicao` |
| `transporte` (string) | `transportes` (array) |
| `ativo: true` | ausente (`status`, `estado`) |

---

## 6. Registry — Toledo está registrado?

**Sim**, no **SDK** `DriverRegistry`, via profile `sdk/profiles/toledo-prix4.js` carregado por `DriverLoader` (não via `DriverRegistry.register(new ToledoPrixIVDriver())`).

Há também o driver runtime Sprint 14 (`TOLEDO_PRIX4` / `ToledoPrixIVDriver`) em `drivers/toledo/`, usado por connect/diagnostics — **outro pipeline**, desconectado do combo de cadastro.

---

## Checklist da auditoria

| Verificação | Resultado |
|-------------|-----------|
| Endpoint existe | ✔ `GET /api/equipamentos/drivers` |
| API retorna vazio | ✖ Retorna 3 drivers |
| API não chamada | ✖ É chamada em `carregarEquipamentosDados` |
| Toledo no SDK Registry | ✔ `toledo-prix4` |
| Codigo `TOLEDO_PRIX4_UNO` no combo | ✖ Só em DB/legado/meta |
| Motivo do select “vazio” | **Mismatch `nome_exibicao` vs `nomeExibicao`** |

---

## Conclusão

O combo não fica sem dados no cache: a API e o Registry SDK entregam Toledo e outros perfis.  
A tela **Nova balança** monta `<option>` com `d.nome_exibicao`, campo que a resposta SDK **não envia**, gerando opções sem rótulo (e com `codigo` em formato SDK, não `TOLEDO_PRIX4_UNO`).

Correção futura (fora desta RC): alinhar contrato (adapter na API **ou** front aceitar `nomeExibicao` / `meta.catalogoLegado`) e unificar códigos legado ↔ SDK.
