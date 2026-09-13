# RC14.15.5-AUDIT — Auditoria Profunda MGV6 / TXITENS.TXT

**Tipo:** SOMENTE LEITURA  
**Data:** 2026-08-10  
**Alterações de código/banco:** NENHUMA  

**Estado auditado:** código atual após RC14.13.2 → RC14.15.4 **e** implementação já presente da RC14.15.5 (layout REAL-CLIENT-V1) no repositório.

**Arquivo real `TXITENS(2).TXT`:** **NÃO LOCALIZADO** no disco (Downloads/Desktop/Documents/workspace/`Program Files...\MGV6\TXT\`).  
Comparação com o real usou: (a) trechos fornecidos nesta auditoria; (b) fixtures do repo; (c) geração pelo `MGV6FileBuilder` atual.

---

## 1. Veredito executivo

O Bridge MGV6 do CDS **já gera** `TXITENS.TXT` com estrutura física **compatível** com os exemplos do sistema antigo para:

- nome do arquivo (`TXITENS.TXT`);
- registro de **320 caracteres** + CRLF;
- prefixo `01` + código 9 + campo preço 9 + descrição + espaços;
- fórmula de preço (`R$ X,YZ` → `0` + 5 centavos + `000`);
- encoding WINDOWS-1252;
- exclusividade `modo_envio` (MGV6 sem TCP / TCP sem MGV6) no código.

Porém, a **identidade do produto** (o “Gtin”/código de 9 dígitos do MGV6) **não está mapeada como GTIN**. O CDS usa:

**PLU → codigo_balanca → codigo**

e **não** lê EAN13/GTIN para o campo do TX.

Isso explica o risco principal de “TXT gerado / MGV6 abre, mas produto não aparece na balança”: o MGV6 pode receber um código diferente do cadastro esperado na balança, **ou** o arquivo pode nunca ser importado/transmitido (etapas C–G não são comprovadas pelo CDS).

**Compatibilidade estrutural estimada com o arquivo real (amostras):** ~**75–85%**  
**Compatibilidade operacional física (CDS → balança):** **não comprovada** (~**0% de evidência** nas etapas pós-arquivo).

---

## 2. Fluxo atual (mapa)

```
Produto CDS (produtos + produto_identificadores)
  ↓ (UI: só pesáveis em enviar-produtos-balanca.js)
Seleção de IDs / PLUs
  ↓
Equipamento.modo_envio  (equipamentos_configuracoes.chave = 'modo_envio')
  ├─ TCP  → POST /api/equipamentos/:id/upload-plus  → ToledoPluEngine → Driver → TCP
  └─ MGV6 → POST /api/equipamentos/mgv6/export
              ↓
         MGV6Controller.exportar
              ↓
         MGV6SyncService.exportarPorIds / syncProdutos
              ↓
         MGV6FileBuilder.buildProdutos (320 chars)
              ↓
         MGV6Exporter.exportarProdutos (tmp + rename → TXITENS.TXT)
              ↓
         [opcional] MGV6Launcher.launch → MGV6.exe (sem args)
              ↓
         (fora do CDS) MGV6 importa? processa? transmite? balança recebe?
```

| Etapa | Arquivo | Função | Entrada → Saída |
|-------|---------|--------|-----------------|
| UI operacional | `frontend/erp/js/enviar-produtos-balanca.js` | `epbEnviarSelecionados` / `epbEnviarSelecionadosMGV6` (~485+) | IDs selecionados → `POST .../mgv6/export` |
| UI cadastro produto | `frontend/erp/js/produtos.js` | `enviarProdutoParaBalancaPorId` (~279+) | produtoId → export ou upload-produto |
| UI config | `frontend/erp/js/equipamentos.js` | seção Método de Envio / MGV6 | `modo_envio` + `mgv6.config` |
| API | `backend/.../mgv6/MGV6Controller.js` | `exportar` | body.produtoIds → SyncService |
| Orquestração | `MGV6SyncService.js` | `exportarPorIds` / `syncProdutos` | IDs → produtos → export + hist |
| Identidade SQL | `MGV6SyncService.js` ~L54–80 | subquery PLU / BALANCA | row → `{plu, codigo_balanca, codigo}` |
| Resolução código | `MGV6Validator.js` ~L20–31 | `resolverCodigoProduto` | PLU→balança→codigo |
| Layout | `MGV6FileBuilder.js` | `buildRecord` / `formatarCampoNumericoMgv6` | produto → string 320 |
| Escrita | `MGV6Exporter.js` | `exportarProdutos` / `escreverAtomico` | buffer → TXITENS.TXT |
| Launch | `MGV6Launcher.js` | `launch` | cfg → spawn(exe,[],{shell:false}) |
| Barreira TCP | `PluController.js` ~L242 / ~L410 | `garantirModoTcp` | bloqueia upload se MGV6 |
| Barreira MGV6 | `MGV6ModoEnvio.js` / SyncService | `assertPermitidoExportMgv6` | bloqueia export se TCP |

---

## 3. Identidade atual do produto (ponto crítico)

### Prioridade efetiva hoje

Definida em `MGV6Validator.resolverCodigoProduto`:

1. `produto.plu`
2. `produto.codigo_balanca` / `codigoBalanca`
3. `produto.codigo`

**Não utilizados** no campo de 9 dígitos do TX:

- EAN13 / GTIN (`produto_identificadores.tipo = 'EAN13'`)
- `codigo_barras` da tabela `produtos`
- campo dedicado “código MGV6”
- Product Identity Motor (MIP) no caminho MGV6

### Como o SyncService carrega o PLU

`MGV6SyncService` SQL (~L63–78):

- `plu` = último/principal identificador com `tipo = 'PLU'`
- `codigo_balanca` = tipos `BALANCA` | `CODIGO_BALANCA` | `SCALE`
- `codigo` = `produtos.codigo`

Tipos presentes no banco oficial no momento da auditoria:

| tipo | quantidade |
|------|------------|
| INTERNO | 7 |
| EAN13 | 3 |
| PLU | 3 |

**Conclusão:** o “Gtin” da lista do cliente **não é lido como GTIN** pelo Bridge. Se o antigo MGV6 chama de “Gtin” o código do item na balança, no CDS isso precisa estar em **PLU** (ou codigo_balanca / codigo).

---

## 4. Produto “TESTE CDS SISTEMAS”

### No banco oficial (`mercadao.db`)

**Não encontrado** produto com nome `TESTE CDS SISTEMAS`.

Equipamentos cadastrados: **0**  
Config `modo_envio` / `mgv6.config`: **vazia**

### No golden de teste (RC14.15.5)

| Item | Valor |
|------|--------|
| Fonte | `tests/fixtures/mgv6/real-client/` + builder |
| PLU usado no teste | `99` |
| Preço | `2.99` |
| Descrição | `TESTE CDS SISTEMAS` |
| TX gerado | `01000000099000299000TESTE CDS SISTEMAS` + pad 320 + CRLF |

Representação:

```
Produto CDS:        (não existe no DB operacional; só fixture/teste)
Campo utilizado:    plu = "99"
Valor:              99
Valor no TX:        000000099
Valor esperado:     000000099 (conforme amostra RC14.15.5 / TXITENS(1))
Conclusão:          OK no teste estrutural | N/A no cadastro real
```

---

## 5. Formato TXITENS.TXT (CDS atual)

| Item | Valor atual |
|------|-------------|
| Nome | `TXITENS.TXT` (CDS.TXT legado normalizado) |
| Encoding | WINDOWS-1252 |
| Terminador | CRLF (`\r\n`) — **fora** dos 320 |
| Registro | **exatamente 320** chars |
| Pos 0–1 | `01` |
| Pos 2–10 | código 9 dígitos zero-pad |
| Pos 11–19 | campo numérico 9 = `0` + centavos(5) + `000` |
| Pos 20–319 | descrição + espaços (área 300) |
| Layout ID | `MGV6-REAL-CLIENT-V1` |

Medição em fixtures do repo:

| Arquivo | Bytes | Registros | Todos 320? |
|---------|-------|-----------|------------|
| `real-client/TXITENS.TXT` | 322 | 1 | sim |
| `expected.TXITENS.TXT` | 966 | 3 | sim |
| `expected-101.TXITENS.TXT` | 32522 | 101 | sim |

Fórmula: `N×320 + N×2` (CRLF) = bytes do arquivo.

---

## 6. Comparação com amostras do arquivo real (TXITENS(2))

Amostras fornecidas na auditoria vs builder CDS:

| Exemplo antigo | CDS gera (mesmo plu/preço/nome) | Resultado |
|----------------|----------------------------------|-----------|
| `01000000001001150000Frango Do Dia Kg` (R$ 11,50) | `01000000001001150000Frango Do Dia Kg` + pad | **OK** |
| `01000000002002899000Picadinho Kg` (R$ 28,99) | igual | **OK** |
| `01000000003002199000Costela Bovina Kg` (R$ 21,99) | igual | **OK** |
| `01000013007004199000Carne Congelada...Alca` | CDS escreveria nome **completo** se ≤300 (`...Alcatra - Qtde`) | **DIVERGENTE na descrição** |
| Código “Gtin” 12746 = Milho Grao | CDS produto Milho id 1192 → PLU `39` → `000000039` | **DIVERGENTE na identidade** |

### Exemplo concreto — Milho (banco atual)

```
Produto CDS:        id 1192 / "Milho em Grão KG" / codigo=000039
Identificadores:    INTERNO 000039 | PLU 39 | EAN13 000039
Campo utilizado:    PLU → "39"
Valor no TX:        000000039
Valor esperado (TX real citado): 000012746 ("Milho Grao")
Conclusão:          DIVERGENTE
```

---

## 7. Preço

Fórmula atual (`formatarCampoNumericoMgv6` / centavos):

```
preco_venda → centavos inteiros (×100, exatos)
→ "0" + padStart(5,'0') + "000"
```

| Original | Centavos | Serializado | Real antigo | Match |
|----------|----------|-------------|-------------|-------|
| 11,50 | 1150 | `001150000` | `001150000` | OK |
| 28,99 | 2899 | `002899000` | `002899000` | OK |
| 21,99 | 2199 | `002199000` | `002199000` | OK |
| 2,99 | 299 | `000299000` | `000299000` | OK |

Arredondamento: rejeita preço não representável em centavos exatos (não arredonda silenciosamente).

---

## 8. Descrição

| Aspecto | CDS atual | Real (amostra longa) |
|---------|-----------|----------------------|
| Fonte | `produto.nome` (SyncService mapeia `descricao: row.nome`) | nome do sistema antigo |
| Limite | **300** chars (pos 20–319); overflow → erro (não trunca) | amostra truncada a **50** chars (`...Alca`) |
| Padding | espaços até 320 | espaços (inferido) |
| Acentos | WINDOWS-1252 (ex.: `Pêra` ok se representável) | presente no real |
| Truncamento silencioso | **Não** | **Sim** na amostra longa |

**Risco:** nomes longos no CDS geram registro estruturalmente válido (320), mas **conteúdo diferente** do TXT antigo → possível impacto no display/importação MGV6 se o app legado esperava corte.

---

## 9. Quantidade de registros / filtro pesável

| Caminho | 1 produto | N produtos | Filtro pesável |
|---------|-----------|------------|----------------|
| UI Enviar Produtos | 1 registro | N registros (1 arquivo) | **Sim** (`epbElegivelBalanca`) |
| `export` por IDs (API) | 1..N | 1 arquivo | **Não** no SyncService |
| `export-all` | todos ativos com código | 1 arquivo | **Não** (`produto_fracionado` ignorado) |

Builder não gera registros extras por produto; 1 produto → 1 linha de 320.

---

## 10. modo_envio

| Modo | Comportamento no código |
|------|-------------------------|
| default (ausente) | **TCP** |
| MGV6 | UI/API → `/mgv6/export`; `upload-plus`/`upload-produto` bloqueados (`MODO_ENVIO_MGV6`) **antes** de `connectionManager.connect` |
| TCP | pipeline Toledo; `/mgv6/export` bloqueado (`MODO_ENVIO_TCP`) |

Evidência: `PluController` chama `garantirModoTcp` antes do connect; SyncService chama `assertPermitidoExportMgv6`.

**No banco atual:** nenhum equipamento / nenhuma chave `modo_envio` gravada → ambiente operacional **não configurado** para prova física.

---

## 11. Configuração MGV6 vs pasta antiga

| Item | Sistema antigo (informado) | CDS default / config |
|------|----------------------------|----------------------|
| Pasta | `C:\Program Files (x86)\Toledo do Brasil\MGV6\TXT\` | vazia até configurar por equipamento |
| EXE | `...\MGV6\MGV6.exe` | vazio até configurar |
| Arquivo | TXITENS.TXT | TXITENS.TXT |
| Encoding | (compatível Windows-1252) | WINDOWS-1252 |
| Terminador | CRLF | CRLF |
| autoLaunch | — | **false** |
| digitosPlu (etiqueta) | — | 6 (UI; **não** altera os 9 dígitos do TX) |
| prefixo etiqueta | — | 2 (UI; **não** é o `01` do registro) |

Persistência:

- `modo_envio` → `equipamentos_configuracoes`
- detalhe MGV6 → `equipamentos_configuracoes` chave `mgv6.config` (JSON)
- histórico → `equipamentos_mgv6_exports`

---

## 12. Auto-launch

`MGV6Launcher.launch`:

- só se `autoLaunch === true`
- `spawn(exeAbs, [], { shell: false, cwd: pastaExport, detached: true, stdio: 'ignore' })`
- **sem argumentos**
- não espera fim do MGV6
- não valida se o MGV6 leu o TXT

CDS comprova no máximo: **processo spawnado** (`iniciado: true`, pid).  
Não comprova importação nem envio à balança.

---

## 13. Por que o produto pode não chegar à balança

Cadeia e o que o CDS prova hoje:

| Etapa | Descrição | CDS comprova? |
|-------|-----------|---------------|
| A | Gera TXITENS.TXT | **Sim** (testes + exporter) |
| B | Abre MGV6.exe | Só se autoLaunch+path válido |
| C | MGV6 importa arquivo | **Não** |
| D | MGV6 processa produto | **Não** |
| E | MGV6 transmite à balança | **Não** |
| F | Balança recebe | **Não** |
| G | PLU aparece | **Não** |

### Causas prováveis (ordenadas)

1. **Identidade divergente:** código no TX ≠ código que a balança/MGV6 espera (ex.: CDS PLU `39` vs Gtin antigo `12746`).
2. **Pasta/arquivo não é a que o MGV6 monitora** (config vazia / path errado).
3. **autoLaunch=false** → TXT gerado, MGV6 não aberto; operador não importa manualmente.
4. **MGV6.exe aberto sem args** → pode não processar automaticamente o TXITENS.
5. **Descrição/nome** diferente do legado (truncamento) — risco menor se o código estiver certo.
6. Ambiente atual **sem equipamento** configurado → envio operacional real não exercitado neste DB.

---

## 14. Tabela comparativa

| Item | Sistema antigo | CDS atual | Resultado |
|------|----------------|-----------|-----------|
| Nome arquivo | TXITENS.TXT | TXITENS.TXT | OK |
| Registros (amostra 101) | 101 | builder suporta N×320 | OK estrutural |
| Registro | 320 chars | 320 chars | OK |
| Código | “Gtin” MGV6 (1,2,…,12746…) | PLU → balança → codigo | **RISCO / DIVERGENTE** |
| Preço | `0ccccc000` | mesma fórmula | OK |
| Descrição | pode truncar (ex. 50) | até 300, sem truncar | **DIVERGENTE** |
| Encoding | Windows (inferido) | WINDOWS-1252 | OK |
| CRLF | sim | sim | OK |
| Pasta | `...\MGV6\TXT\` | configurável (vazia no DB) | pendente config |
| MGV6.exe | path antigo | configurável + spawn sem args | parcial |
| Modo | arquivo | modo_envio MGV6 | OK no código |
| TCP | não participa | bloqueado em MGV6 | OK no código |

---

## 15. Implementações / duplicidade

| Área | Achado |
|------|--------|
| Bridge único | `backend/motores/equipamentos/mgv6/*` — sem segundo FileBuilder |
| CDS.TXT | só legado normalizado → TXITENS; fixture antiga `expected.CDS.TXT` pode existir como histórico |
| Envio UI | `enviar-produtos-balanca.js` bifurca TCP/MGV6 |
| produtos.js | respeita modo_envio |
| Central equipamentos | sync PLU lab ainda TCP por host/porta (diagnóstico; não é o botão operacional MGV6) |
| PluController TCP | protegido por `garantirModoTcp` |

Não há chamada escondida a TCP dentro de `MGV6FileBuilder` / `MGV6Exporter` / `MGV6SyncService`.

---

## 16. Banco — onde mora a identidade

| Dado | Onde |
|------|------|
| Código interno | `produtos.codigo` |
| EAN | `produtos.codigo_barras` e/ou `produto_identificadores` tipo EAN13 |
| PLU | `produto_identificadores.tipo='PLU'` ← **usado no TX** |
| Código balança | tipos BALANCA/CODIGO_BALANCA/SCALE ← 2ª prioridade |
| GTIN dedicado MGV6 | **não existe** |
| modo_envio | `equipamentos_configuracoes.chave='modo_envio'` |
| Config MGV6 | `equipamentos_configuracoes.chave='mgv6.config'` |
| Histórico export | `equipamentos_mgv6_exports` |

---

## 17. Testes executados nesta auditoria

| Suite | Resultado | Natureza |
|-------|-----------|----------|
| `test:mgv6-v1` | **20/20** | estrutural / bridge |
| `test:mgv6-operational-v1` | **19/19** | operacional (modo + export mock) |
| `test:mgv6-txitens-v1` | **16/16** | arquivo 320 / TXITENS |
| `test:mgv6-txitens-real-v1` | **11/11** | golden TESTE CDS (PLU 99) |

**Teste verde ≠ homologação física na balança.**

Separação:

- estrutural: OK  
- arquivo: OK (fixtures)  
- operacional de modo: OK (código)  
- físico CDS→MGV6→balança: **não comprovado**

---

## 18. Pontos corretos

- Layout 01 + 9 + 9 + desc + pad 320
- Preço idêntico às amostras R$ 11,50 / 28,99 / 21,99 / 2,99
- TXITENS.TXT + CRLF + WINDOWS-1252
- Escrita atômica
- Mutual exclusivity TCP × MGV6 no backend
- UI operacional não chama connect/upload-plus em modo MGV6

## 19. Pontos divergentes / riscos

1. Identidade: PLU/codigo ≠ “Gtin” MGV6 do cliente  
2. Descrição: sem truncamento legado  
3. `export-all` sem filtro pesável  
4. autoLaunch sem prova de importação  
5. Sem equipamento/config no DB oficial agora  
6. Arquivo `TXITENS(2).TXT` não disponível para diff byte-a-byte dos 101 registros

## 20. Recomendações para próxima RC (sem implementar aqui)

1. Obter e versionar `TXITENS(2).TXT` real (101 regs) como golden físico.  
2. Definir campo de autoridade do código MGV6 (PLU vs GTIN vs codigo_balanca) e alinhar cadastro (ex.: Milho `12746`).  
3. Decidir política de descrição: truncar como legado vs rejeitar vs 300.  
4. Filtrar pesáveis no SyncService `export-all`.  
5. Homologar cadeia A→G com pasta/EXE reais e checklist na balança.  
6. Não declarar “MGV6 homologado” até G comprovado.

---

## Alterações realizadas

**NENHUMA** (somente este relatório).
