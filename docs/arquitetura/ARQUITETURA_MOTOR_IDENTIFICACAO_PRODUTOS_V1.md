# ARQUITETURA OFICIAL — Motor Universal de Identificação de Produtos (MIP)

| Campo | Valor |
|-------|-------|
| **Produto** | CDS Sistemas |
| **Componente** | Motor Universal de Identificação de Produtos (MIP) |
| **Versão do contrato / runtime** | **V1.0.0** |
| **Status** | **PRODUÇÃO — HOMOLOGADO** |
| **Data** | 2026-07-19 |
| **Versão oficial** | [MIP_VERSION.md](./MIP_VERSION.md) |
| **Changelog** | [CHANGELOG_MIP.md](./CHANGELOG_MIP.md) |

Este documento é a **referência oficial** para todas as implementações relacionadas à identificação de produtos no CDS Sistemas.  
Nenhuma sprint poderá contradizer este contrato sem revisão arquitetural explícita e nova versão do documento.

> **Sprint 08 (2026-07-19):** MIP V1.0.0 homologado para produção. Extensões (Marketplace, RFID, QR, GS1 DataBar, novos fabricantes) permanecem **apenas previstas** — fora do escopo da V1.

---

## 1. Objetivo do Motor

O **Motor Universal de Identificação de Produtos (MIP)** é responsável **exclusivamente** por **localizar e identificar produtos**, independentemente da origem do identificador.

Entradas típicas:

- leitura de scanner / teclado (EAN, etiqueta de balança, QR, etc.)
- código digitado no PDV ou ERP
- dados de NF-e / XML (GTIN, cProd)
- identificadores de marketplace, RFID e futuros formatos
- PLU de balança (já interpretado ou a interpretar via strategy de etiqueta)

Saída típica:

- produto canônico (`produtos.id` + snapshot mínimo)
- método de resolução (tipo / strategy)
- metadados opcionais da leitura (ex.: valor ou peso embutido em etiqueta)

### O MIP NÃO

| Domínio | Responsável no CDS |
|---------|-------------------|
| Controlar estoque | Serviços de estoque / lotes / ajustes |
| Controlar vendas / carrinho | PDV + serviços de vendas |
| Controlar fiscal (NFC-e / NF-e / impostos) | Motor / serviços fiscais |
| Alterar preços | Cadastro de produtos / promoções |
| Controlar financeiro | Módulo financeiro |
| Comunicar com hardware de balança | **Motor Universal de Equipamentos** |

> **Regra de ouro:** o MIP **só identifica**. Quem consome o resultado decide o que fazer (vender, gravar compra, emitir XML, sincronizar PLU, etc.).

---

## 2. Responsabilidades

O MIP **deverá** ser capaz de resolver, de forma tipada e extensível:

| Identificador | Responsabilidade do MIP |
|---------------|-------------------------|
| EAN-8 / EAN-13 | Localizar produto pelo código de barras comercial |
| GTIN | Localizar produto por GTIN normalizado (GS1) |
| PLU | Localizar produto pelo código de balança |
| Código interno | Localizar por `produtos.codigo` / tipo `INTERNO` |
| Código do fornecedor | Resolver cProd (+ escopo CNPJ), em coordenação com MIIP quando aplicável |
| QR Code | Interpretar payload e resolver identificador embutido |
| GS1 DataBar | Interpretar e resolver |
| RFID | Resolver EPC/TID (ou equivalente) para produto |
| ID interno | Resolver por `produtos.id` |
| Futuros identificadores | Novas **Strategies** sem reescrever o núcleo |

Responsabilidades transversais do MIP:

- detectar o tipo de entrada (quando possível)
- normalizar códigos por tipo
- consultar catálogo de identificadores (`produto_identificadores`) com **fallback legado**
- retornar resultado padronizado (`IdentidadeResultadoDTO` ou equivalente)
- respeitar feature flags e compatibilidade

---

## 3. O que NÃO pertence ao motor

O MIP **não deverá**:

- controlar estoque, saldos fiscais ou não fiscais
- emitir NFC-e ou NF-e
- calcular impostos, CSOSN, CFOP ou montar XML
- alterar preços, promoções ou atacado
- controlar financeiro, contas a pagar/receber ou caixa
- comunicar-se **diretamente** com equipamentos (serial, TCP, USB, Bluetooth)
- enviar/receber frames de protocolo de balança (Toledo, Filizola, etc.)
- gerenciar fila de sync de PLU para hardware
- substituir o pipeline de aprendizado do MIIP (`miip_associacoes`, scores, feedback)
- substituir a máquina de estados da Central de Entradas
- abrir compra ou gravar `vendas_itens`

Essas funções permanecem nos módulos oficiais já existentes.

---

## 4. Arquitetura

### 4.1 Fluxo oficial

```
Scanner / digitação / XML / API / etiqueta
        ↓
Motor Universal de Identificação (MIP)
        ↓
Detector de Tipo
        ↓
Strategy (formato / fabricante / layout)
        ↓
Resolver (catálogo identificadores + fallback legado)
        ↓
Produto (+ meta opcional: valor, peso, confiança)
        ↓
Consumidor (PDV, Compras, MIIP, API, …)
```

### 4.2 Diagrama de camadas

```
┌─────────────────────────────────────────────────────────────┐
│  Consumidores: PDV · Compras · MIIP · API · Fiscal* · …     │
└────────────────────────────┬────────────────────────────────┘
                             │ resolve(entrada, contexto)
┌────────────────────────────▼────────────────────────────────┐
│              ProdutoIdentidadeService (MIP)                   │
│  DetectorTipo → StrategyRegistry → Resolver → ResultadoDTO   │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
┌───────────────▼───────────────┐ ┌───────────▼───────────────┐
│ produto_identificadores       │ │ Fallback legado            │
│ (+ produtos.id)               │ │ produtos.codigo / barras   │
└───────────────────────────────┘ └───────────────────────────┘

* Fiscal consome produto já identificado; não usa MIP para emitir.
```

### 4.3 Separação oficial: MIP × Motor de Equipamentos

| Motor | Responsabilidade |
|-------|------------------|
| **Motor Universal de Equipamentos** | Comunicação com hardware: conectar, sync PLU→balança, `obterPeso`, protocolos, transportes |
| **MIP** | Interpretação e resolução de **identificadores** (incluindo layouts de etiqueta impressa) |

A balança física **não** é responsabilidade do MIP.  
A etiqueta EAN gerada pela balança (código variável prefixo `2…`) **é** responsabilidade do MIP (via Strategy de layout), tipicamente acionada pelo PDV.

### 4.4 Modelo de dados (contrato)

Conforme Auditoria 03:

- Tabela **`produto_identificadores`** = catálogo tipado de chaves (EAN, PLU, INTERNO, …)
- **`produtos.codigo` / `produtos.codigo_barras`** = projeção de compatibilidade (espelho dos principais)
- **`miip_associacoes`** = aprendizado contextual fornecedor↔produto (não substitui o catálogo MIP)

Detalhamento de colunas, índices e migração: ver Auditoria 03 e Plano Mestre (Auditoria 04).

---

## 5. Integração

Módulos que **utilizarão** o MIP (como consumidores):

| Módulo | Uso do MIP |
|--------|------------|
| **PDV** | Scanner / código digitado / etiqueta balança → produto (+ qtd se valor/peso) |
| **Compras** | Localizar produto por código/barras/nome (evolução do legado) |
| **MIIP** | GTIN e, quando aplicável, ponte para identificadores; fornecedor permanece no pipeline MIIP |
| **Motor Comercial** | Resolução de produto quando o módulo estiver ativo |
| **Fiscal** | Indireto: recebe `produto_id` já resolvido; pode consultar EAN principal para XML |
| **Marketplace** | SKU por canal (`SKU_MARKETPLACE` + escopo) |
| **Portal** | Busca/resolução via API do MIP |
| **Aplicativo** | Idem via API |
| **API** | Endpoint de resolução + CRUD de identificadores |
| **Importação XML** | Pós-parse: GTIN / códigos → produto (em conjunto com MIIP) |
| **Motor de Equipamentos** | Consome PLU já tipado no cadastro para sync; **não** interpreta EAN de etiqueta no hardware path |
| **Balança (etiqueta)** | Layouts Toledo/Filizola/… como Strategies do MIP |

---

## 6. Strategies

Cada formato de identificação **deverá** possuir sua própria **Strategy**, registrada em um registry/factory.

### 6.1 Strategies de identificador (catálogo)

| Strategy | Entrada típica |
|----------|----------------|
| `Ean8Strategy` | EAN-8 |
| `Ean13Strategy` | EAN-13 comercial |
| `GtinStrategy` | GTIN normalizado |
| `PluStrategy` | PLU puro |
| `InternoStrategy` | Código interno CDS |
| `IdStrategy` | `produtos.id` |
| `FornecedorStrategy` | CNPJ + cProd (coordena com MIIP) |
| `QrStrategy` | Payload QR |
| `Gs1DataBarStrategy` | GS1 DataBar |
| `RfidStrategy` | EPC / RFID |
| `LegadoFallbackStrategy` | `produtos.codigo` / `codigo_barras` (compatibilidade) |

### 6.2 Strategies de etiqueta de balança (layouts)

| Strategy | Descrição |
|----------|-----------|
| `LegadoCdsValor56Layout` | **Default V1** — comportamento atual do PDV (`2` + 5 código + 6 valor + DV) |
| `ToledoPrix4Valor55Layout` | Caso real Prix 4 Uno — valor no código (`2` + 6 PLU + 5 valor + DV); id `toledo_prix4_valor_65` |
| `ToledoPrix4PesoLayout` | Variante peso embutido (quando configurada) |
| `Filizola*Layout` | Futuro |
| `Urano*Layout` | Futuro |
| `Elgin*Layout` | Futuro |
| Strategies futuras | Novos fabricantes **sem** alterar o núcleo do MIP |

> Layouts são configurados por equipamento/terminal (`equipamentos_configuracoes`), não hardcoded globalmente — **exceto o default legado**, que preserva clientes atuais.

### 6.3 Contrato de uma Strategy

Toda Strategy deve:

1. Declarar se aceita a entrada (`canHandle`)
2. Normalizar o código
3. Resolver para `produto_id` (ou falhar de forma explícita)
4. Opcionalmente extrair meta (valor total, peso, PLU extraído)
5. Não possuir efeitos colaterais de estoque/venda/fiscal

---

## 7. Princípios Arquiteturais

| Princípio | Aplicação no MIP |
|-----------|------------------|
| **Single Responsibility** | MIP só identifica; Equipamentos só comunicam hardware; PDV só vende |
| **Open/Closed** | Novos formatos = novas Strategies; núcleo fechado para modificação casual |
| **Strategy Pattern** | Um algoritmo por tipo/layout de identificador |
| **Factory / Registry Pattern** | Registro e seleção de Strategies em runtime |
| **Dependency Injection** | Service recebe repository/normalizer/registry (testável) |
| **Backward Compatibility** | Fallback legado + espelho `codigo`/`codigo_barras` |
| **Feature Flags** | Ex.: `produto_identidade_enabled`; off = caminho atual |
| **Zero Breaking Changes** | Nenhum contrato de API/UI existente removido na V1 |

Princípios adicionais obrigatórios:

- **Um único ponto de resolução** para consumidores (`resolve`)
- **Default seguro** = comportamento pré-MIP
- **Sem SQL** dentro das Strategies de domínio (acesso via Repository)
- **Observabilidade**: método, tipo, strategy e confiança no resultado

---

## 8. Compatibilidade

Nenhuma implementação do MIP poderá quebrar clientes existentes.

Garantias oficiais V1:

1. Colunas `produtos.codigo` e `produtos.codigo_barras` **permanecem**.  
2. Endpoints atuais de produtos/PDV/MIIP **permanecem**.  
3. Parser atual de etiqueta do PDV permanece como **layout default** até validação completa.  
4. Feature flag desligada = sistema idêntico ao pré-MIP.  
5. Layouts novos (ex.: Toledo Valor 5+5) **somente** via configuração explícita.  
6. `miip_associacoes` **não é apagada nem substituída** pelo catálogo de identificadores.  
7. Rollback = flag off + default legado.

Validação obrigatória antes de ativação ampla em produção: matriz de testes do Plano Mestre (produto comum, EAN, PLU, etiqueta legado, etiqueta Toledo, MIIP GTIN, fiscal prefixo `2`).

---

## 9. Roadmap e referências

A evolução arquitetural até este contrato:

| Ref. | Documento / entrega | Conteúdo |
|------|---------------------|----------|
| **Auditoria 01** | Motor Universal de Balança + Cadastro + PDV | Parser no PDV; Equipamentos ≠ etiqueta; caso Toledo Prix 4 Uno (valor) |
| **Auditoria 02** | Motor de Identificação de Produtos | Lookups espalhados; MIIP parcial; sem serviço global |
| **Auditoria 03** | Modelo de Dados | `produto_identificadores` + espelho de compatibilidade |
| **Auditoria 04** | Plano Mestre de Implementação | Fases 1–4, arquivos, APIs, testes, ordem |
| **Este documento** | **Arquitetura Oficial MIP V1** | Contrato de desenvolvimento |

### Roadmap de implementação (resumo)

| Fase | Nome | Entrega | Status |
|------|------|---------|--------|
| 1 | Fundação de dados | Tabela + dual-write + backfill | **Feito (Sprint 01)** |
| 2 | Núcleo MIP | Service + detector + strategies + flag | **Feito (Sprint 02)** |
| 3 | Etiquetas / balança | Layouts legado + Toledo; PDV consome MIP | **Feito (Sprints 04–05)** |
| 4 | Adoção | UI PLU, Compras/XML/Central, cadastro | **Feito (Sprints 06–07)** |
| 5 | Hardening | Métricas, logs, benchmark, homologação | **Feito (Sprint 08) → V1.0.0 PRODUÇÃO** |
| 6+ | Extensão | Marketplace, RFID, QR, DataBar, novos layouts | **Futuro (não V1)** |

A ordem **não** pode inverter: dados → núcleo → layouts → adoção → hardening.

---

## 10. Contratos de interface (normativos para sprints)

### 10.1 Entrada (`resolve`)

```text
entrada: {
  codigo: string,              // bruto (scanner, digitação, etc.)
  contexto?: {
    origem?: 'pdv' | 'compras' | 'miip' | 'api' | 'xml' | …,
    terminalId?: number,
    equipamentoId?: number,
    fornecedorCnpj?: string,
    layoutStrategy?: string,   // override; senão config/default
  }
}
```

### 10.2 Saída

```text
resultado: {
  encontrado: boolean,
  produtoId?: number,
  produto?: { id, codigo, codigo_barras, nome, unidade, preco_venda, … },
  metodo?: 'INTERNO' | 'EAN13' | 'GTIN' | 'PLU' | 'ID' | 'FORNECEDOR' | 'ETIQUETA_BALANCA' | 'LEGADO' | …,
  strategy?: string,
  meta?: {
    plu?: string,
    valorTotal?: number,
    peso?: number,
    codigoOriginal?: string,
  },
  confianca?: 'ALTA' | 'MEDIA' | 'BAIXA',
}
```

Consumidores **não** devem reinterpretar o código após o MIP, exceto para UX (exibir mensagem).

---

## 11. Fronteiras com outros motores oficiais

| Motor / módulo | Relação com MIP |
|----------------|-----------------|
| Motor de Equipamentos | Hardware e sync; MIP interpreta identificadores/etiquetas |
| MIIP | Inteligência de match XML/fornecedor; MIP é catálogo/resolução pontual |
| Central de Entradas | Usa produto já identificado no fluxo de compras |
| PDV | Principal consumidor de `resolve` em tempo real |
| Fiscal | Usa produto identificado; regras GTIN próprias |

---

## 12. Declaração de contrato

Fica estabelecido que:

1. O **MIP V1.0.0** é o único motor oficial de **identificação** de produtos multi-origem.  
2. Implementações que ignorem Strategies, flags ou compatibilidade **violam** este contrato.  
3. Este arquivo (`docs/ARQUITETURA_MOTOR_IDENTIFICACAO_PRODUTOS_V1.md`) prevalece sobre decisões informais de sprint.  
4. Evoluções = **V1.1+** com adendo ou novo documento versionado.  
5. Status **PRODUÇÃO** a partir de **19/07/2026** (Sprint 08), com feature flag default OFF.

**Status: OFICIAL — PRODUÇÃO (V1.0.0).**  
**Referência de versão:** `docs/MIP_VERSION.md`.

---

*Contrato arquitetural criado pré–Sprint 1; implementado nas Sprints 01–07; homologado na Sprint 08.*
