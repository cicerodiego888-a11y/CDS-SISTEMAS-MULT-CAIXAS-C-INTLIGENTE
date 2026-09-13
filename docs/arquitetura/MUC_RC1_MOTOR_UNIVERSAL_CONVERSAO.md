# MUC RC1 — Motor Universal de Conversão

**Sprint:** MUC-25  
**Status:** Arquitetura Oficial Congelada  
**Versão:** RC1

## Conceito

`ProdutoEmbalagem` evolui conceptualmente para **`ProdutoApresentacao`**.

| Camada | Nome |
|--------|------|
| Tabela física (compat.) | `produto_embalagens` |
| DTO / Service / API | `ProdutoApresentacao` |
| Motor | `backend/motores/muc/` |

Nem toda apresentação é embalagem: UN, KG, SERVIÇO, CX, FD, BOBINA, etc.

## Estrutura MUC

```
backend/motores/muc/
├── index.js                    # Facade MotorUniversalConversao
├── version.js                  # RC1 congelado
├── constants/
│   ├── tiposApresentacao.js
│   └── tiposConversao.js       # UNIDADE, MULTIPLICADOR, PESO, LINEAR, KIT…
├── dto/
│   ├── ConversaoDTO.js
│   └── ResultadoConversaoDTO.js  # Objeto imutável único
├── core/
│   ├── ParserApresentacoes.js
│   ├── MotorInferencia.js
│   └── MotorConversao.js       # Único ponto de cálculo
├── repositorios/
│   ├── RepositorioApresentacoes.js
│   └── RepositorioHistorico.js
├── aprendizado/
│   └── MotorAprendizado.js     # MIIP: Produto+Apresentação+GTIN+Conversão
├── auditoria/
│   └── AuditoriaConversao.js
└── schema/
    └── mucSchema.js
```

## ResultadoConversaoDTO (imutável)

Todo módulo (Compras, Estoque, Financeiro, Precificação) consome este objeto.
Nenhum módulo recalcula conversões.

```json
{
  "produtoId": 1,
  "apresentacaoId": 3,
  "origem": "COMPRA",
  "quantidadeCompra": 10,
  "unidadeCompra": "CX",
  "fatorConversao": 12,
  "quantidadeEstoque": 120,
  "custoUnitario": 3.3333,
  "custoTotal": 400,
  "tipoConversao": "MULTIPLICADOR",
  "confianca": 100,
  "metodoInferencia": "APRESENTACAO_ID",
  "hash": "a1b2c3..."
}
```

## Integrações

| Módulo | Integração |
|--------|------------|
| Compras | `obterMuc(db).processarItemCompra()` → grava `resultado_conversao_json` |
| Cadastro | `ProdutoApresentacaoService` → `produto_embalagens` |
| MIIP | `MotorAprendizado.buscar()` / `registrar()` |
| Legado | `motorConversaoUnidades.js` mantido; math interna via MUC |

## Certificação

```bash
node tests/muc/muc-rc1-certificacao.test.js
node tests/produtos/produto-embalagens.test.js
node tests/compras/rc842-compra-por-embalagem.test.js
```
