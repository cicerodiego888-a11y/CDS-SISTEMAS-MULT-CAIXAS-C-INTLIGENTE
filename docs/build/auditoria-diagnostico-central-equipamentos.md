# AUDITORIA — Diagnóstico da Central de Equipamentos

**Data:** 2026-08-05  
**Escopo:** funcionalidade “Diagnóstico” na Central de Equipamentos  
**Modo:** somente leitura — **nenhuma correção implementada**

---

## 1. Sintoma observado

Ao clicar em **Diagnóstico** (botão por equipamento na grade), o sistema exibe apenas:

> Diagnóstico concluído

Nenhuma informação detalhada aparece na interface.

---

## 2. Há dois fluxos distintos (ponto crítico)

| # | Onde na UI | Handler JS | Endpoint | Renderiza painel? |
|---|------------|------------|----------|-------------------|
| A | Botão toolbar **“Diagnóstico”** (topo) | `centralEqMostrarDiag()` → `centralEqDiagAtualizar()` | `GET /api/equipamentos/driver/toledo/diagnostics` | **Sim** — painel `#centralEqDiagPainel` |
| B | Botão 🩺 **por linha** da lista (cadastrado) | `centralEqDiagnostico(id)` | `POST /api/central-equipamentos/:id/diagnostico` | **Não** — só `showNotification` |

A mensagem literal `"Diagnóstico concluído"` existe **somente** no fluxo **B** (`central-equipamentos.js` ~L4084–4087).

Conclusão: o teste do usuário bate com o **botão da linha**, não com o painel V2.0 do toolbar.

---

## 3. Front-end

### 3.1 Botão da linha (fluxo quebrado na UI)

**Arquivo:** `frontend/erp/js/central-equipamentos.js`

```js
// ~L1022 — botão na grade
onclick="centralEqDiagnostico(${it.equipamento_id})"

// ~L4084–4090
async function centralEqDiagnostico(id) {
  await centralEqFetch(`/${id}/diagnostico`, { method: 'POST', body: '{}' });
  showNotification('Diagnóstico concluído', 'info'); // ← fixo; body ignorado
}
```

| Pergunta | Resposta |
|----------|----------|
| Chama API correta para o painel rico? | **Não.** Chama Central (`/central-equipamentos/...`), não Toledo diagnostics. |
| Endpoint | `POST /api/central-equipamentos/:equipamentoId/diagnostico` via `centralEqFetch` |
| Resposta recebida? | Sim (await do fetch), mas **descartada** |
| Resposta armazenada? | **Não** |
| Componente de renderização? | **Não** para este handler |
| Erro de renderização? | Não — simplesmente **não há render** |
| Exceção ocultando dados? | Só em `catch` (toast danger). No sucesso, dados nunca vão para o DOM |

### 3.2 Botão toolbar (fluxo com painel)

| Item | Detalhe |
|------|---------|
| Handler | `centralEqMostrarDiag()` (~L3477) |
| Ação | Exibe `#centralEqDiagPainel` (`display:''`) e chama `centralEqDiagAtualizar()` |
| Endpoint | `GET /api/equipamentos/driver/toledo/diagnostics?host=&porta=` |
| Render | Preenche `diagDriver`, `diagVersao`, `diagModelo`, `diagFirmware`, `diagStatus`, uptime, latência, checklist etc. |
| Painel HTML | Existe (~L674–717), inicia com `style="display:none"` |

Se o usuário só usa o ícone da linha, **nunca** vê esse painel.

---

## 4. Backend

### 4.1 `GET /api/equipamentos/driver/toledo/diagnostics`

| Item | Status |
|------|--------|
| Implementado? | **Sim** — `backend/rotas/equipamentos.js` L35 |
| Controller | `DiagnosticsController.diagnostics` |
| Motor | `ToledoDiagnostics.diagnostics()` |
| Retorno | Objeto **completo** (`success: true` + vários blocos), não só um status genérico |

**Campos principais retornados:**

| Campo | Origem | Observação |
|-------|--------|------------|
| `version` | `ToledoVersion.getVersion()` | Versão **do driver** (estática) |
| `equipamento.fabricante/modelo/firmware/driver` | Constantes `ToledoProtocol` | **Não lidos do hardware** |
| `capabilities` | `ToledoCapabilities` | Flags estáticas |
| `health` | `health()` + ConnectionManager (se host/porta) | `online` pode ser `null` sem conexão |
| `performance` | latências em memória do processo | Muitas vezes `null` (sem amostras) |
| `estatisticas` | contadores em memória | Zerados após restart |
| `arquitetura` / `checklist` / `homologacao` | Auditoria + checklist V2 | |
| `generatedAt` | timestamp | |

**Campos tipicamente nulos / fracos sem sessão ativa:**

- `health.online` → `null` se host/porta não batem com pool
- `performance.*.Ms` → `null` sem operações gravadas
- **Número de série** → **não existe** no payload
- **Porta COM / IP reais do equipamento cadastrado** → só se passados em query (`host`/`porta`); o painel não usa o `equipamento_id` da linha

### 4.2 `POST /api/central-equipamentos/:equipamentoId/diagnostico`

| Item | Status |
|------|--------|
| Implementado? | **Sim** — `backend/rotas/central-equipamentos.js` L17 |
| Controller | `centralEquipamentosController.diagnostico` |
| Serviço | `CentralEquipamentosService.diagnosticar` → `EquipamentosService.diagnosticarEquipamento` |
| Retorno típico | `{ success: true, diagnostico: { sucesso, mensagem, equipamento, diagnostico: { ping, ip, porta, driver, ... }, timestamp } }` |

Este endpoint **devolve dados úteis** (ping Ethernet, IP, driver, etc.), mas o front **não os exibe**.

Há ainda um caminho legado `DiagnosticoService.diagnosticarEquipamento` com mensagem *“Diagnóstico simulado — comunicação hardware não implementada”* — usado em outros fluxos/`executarDiagnostico*`, não necessariamente neste path da Central (o da Central usa `EquipamentosService.diagnosticarEquipamento`, que tenta ping TCP se houver IP).

---

## 5. Driver Toledo — o que fornece no diagnóstico V2

| Requisito | Presente em `ToledoDiagnostics.diagnostics()`? | Natureza |
|-----------|-----------------------------------------------|----------|
| modelo | Sim (`MODELO` = Prix IV Uno) | Constante de software |
| firmware | Sim (`FIRMWARE_ALVO` = 90AX) | Alvo/constante, não leitura live |
| número de série | **Não** | Ausente |
| versão | Sim (`driverVersion` etc.) | Versão do **driver** |
| porta | Só via query/health da conexão | Não no bloco `equipamento` fixo |
| IP | Só via query `host` | Idem |
| connected / online | Em `health.online` / status | Depende do ConnectionManager |
| capabilities | Sim | Estático |
| heartbeat | Via CM `health.heartbeat` (não espelhado explicitamente no topo do relatório; está dentro do objeto CM se consultado) | Parcial |
| health | Sim (`health` completo do módulo) | Sim |

**O Driver V2.0 NÃO executa um diagnóstico interativo completo no hardware** neste endpoint: monta relatório a partir de constantes, capabilities estáticas, checklist/arquitetura e, opcionalmente, estado do **ConnectionManager** se `host`+`porta` forem informados.

---

## 6. Fluxo completo mapeado

### Fluxo B — botão da linha (o do sintoma)

```
UI (ícone Diagnóstico na linha)
  ↓
centralEqDiagnostico(equipamento_id)
  ↓
POST /api/central-equipamentos/:id/diagnostico
  ↓
centralEquipamentosController.diagnostico
  ↓
CentralEquipamentosService.diagnosticar
  ↓
EquipamentosService.diagnosticarEquipamento
  ↓  (ping Ethernet opcional; NÃO passa por ToledoDiagnostics V2)
Resposta JSON { success, diagnostico: {...} }
  ↓
★ FALHA AQUI: front descarta o body
  ↓
showNotification('Diagnóstico concluído')
  ↓
Renderização: inexistente
```

**Etapa em que as informações “deixam de existir” para o usuário:**  
**após a resposta da API, no handler front-end** — dados existem no JSON, mas nunca entram no DOM.

### Fluxo A — toolbar (painel V2)

```
UI (Diagnóstico topo)
  ↓
centralEqMostrarDiag → exibe #centralEqDiagPainel
  ↓
GET /api/equipamentos/driver/toledo/diagnostics
  ↓
DiagnosticsController → ToledoDiagnostics.diagnostics
  ↓
(ConnectionManager.health opcional)
  ↓
Renderização nos spans diag*
```

Este fluxo **pode** mostrar dados; não é o que gera a mensagem fixa observada.

---

## 7. Fluxo atual vs esperado

### Atual (botão linha)

1. Chama diagnóstico da Central por ID  
2. Backend monta objeto com ping/IP/driver  
3. Front ignora payload  
4. Toast genérico  

### Esperado (comportamento desejável)

1. Disparar diagnóstico (Central e/ou Toledo V2 com host/porta do equipamento)  
2. Receber objeto completo  
3. Abrir painel / modal e renderizar modelo, firmware, IP, porta, online, capabilities, health, etc.  
4. Manter toast apenas como feedback secundário  

---

## 8. O que funciona / o que não funciona

### Funciona

- Endpoint Central `POST .../diagnostico` implementado e retorna payload  
- Endpoint Toledo `GET .../driver/toledo/diagnostics` implementado e retorna relatório rico  
- Painel HTML `#centralEqDiagPainel` + binder `centralEqDiagAtualizar`  
- ConnectionManager expõe health/heartbeat/métricas  
- Toolbar “Diagnóstico” amarra o painel V2  

### Não funciona (para o usuário do botão da linha)

- Ligação botão-linha → painel de UI  
- Persistência/exibição do JSON retornado  
- Uso do diagnóstico Toledo V2 a partir do `equipamento_id` da linha  
- Número de série e firmware **reais** do dispositivo no relatório V2  

---

## 9. Causa provável (resumo executivo)

**Causa principal (UI):**  
`centralEqDiagnostico` consome a API, mas **não renderiza** o resultado — apenas notificação fixa `"Diagnóstico concluído"`.

**Causa secundária (produto/arquitetura):**  
Dois pipelines de diagnóstico coexistentes e desconectados (Central por ID vs Toledo V2 por host/porta), gerando expectativa de um relatório rico no botão errado.

**Limitação do Driver V2 neste endpoint:**  
Muitos campos são **constantes/simulação de homologação**, não telemetria live do equipamento (série ausente; firmware = alvo).

---

## 10. Arquivos envolvidos

| Camada | Arquivo |
|--------|---------|
| UI / handlers | `frontend/erp/js/central-equipamentos.js` |
| Rota Central | `backend/rotas/central-equipamentos.js` |
| Controller Central | `backend/controllers/centralEquipamentosController.js` |
| Serviço Central | `backend/motores/equipamentos/central/CentralEquipamentosService.js` |
| Diagnóstico por ID | `backend/motores/equipamentos/services/EquipamentosService.js` |
| Diagnóstico simulado legado | `backend/motores/equipamentos/diagnostics/DiagnosticoService.js` |
| Rota Toledo V2 | `backend/rotas/equipamentos.js` |
| Controller V2 | `backend/motores/equipamentos/drivers/toledo/certificacao/DiagnosticsController.js` |
| Motor V2 | `backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js` |
| Versão / caps | `ToledoVersion.js`, `ToledoCapabilities.js`, `ToledoProtocol.js` |
| Conexão | `backend/motores/equipamentos/connection/ConnectionManager.js` |

---

## 11. Nível de impacto

| Dimensão | Nível | Nota |
|----------|-------|------|
| Operacional (homologação / suporte) | **Alto** | Operador não vê diagnóstico útil |
| Integridade fiscal / NFC-e | Nenhum | Sem relação |
| Dados no backend | Baixo | API ainda retorna payload |
| Driver / ConnectionManager | Médio | V2 incompleto em série/firmware live; CM ok se conectado |
| UX / confiança no produto | **Alto** | “Concluído” sem conteúdo parece bug |

**Classificação geral:** falha de **integração UI ↔ resposta API** (descartes do payload) + **desalinhamento de endpoints**, com limitação adicional do relatório V2 (dados majoritariamente estáticos).

---

## 12. Evidência da mensagem

Trecho único no código da Central de Equipamentos com o texto exato do sintoma:

- `frontend/erp/js/central-equipamentos.js` → `centralEqDiagnostico` → `showNotification('Diagnóstico concluído', 'info')`

---

*Fim da auditoria — sem alterações de código.*
