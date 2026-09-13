# Relatório de Homologação — RC7.5 Confirmar Produto (MIIP)

**Sprint:** RC7.5 — Correção do fluxo "Confirmar Produto"  
**Data:** 2026-07-27  
**Escopo:** Central de Revisão MIIP (`frontend/erp/js/miip-central-revisao.js`)  
**Fora de escopo:** Motor MIRX, regras fiscais, alterações de navegação na Central de Entradas  

---

## 1. Problema

O botão **Confirmar Produto** (e o atalho Enter) desviava o operador do fluxo de revisão XML:

1. Sem candidato, chamava `cadastrarNovo()` (abria cadastro de produto).
2. Ao zerar pendências, a tela final exibia **“Abrir tela de Compras”**, sugerindo navegação comercial a partir da revisão MIIP.
3. Bug residual: `mostrarTelaFinal()` era chamado, mas a função existente era `renderTelaFinal()` — fluxo de fim inconsistente.

---

## 2. Ponto exato da correção de navegação

| O quê | Onde |
|-------|------|
| Remoção da abertura de cadastro no Confirmar | `confirmarAtual()` em `frontend/erp/js/miip-central-revisao.js` |
| Remoção da UI “Abrir tela de Compras” | Eliminados `renderTelaFinal` / botão `#miipCentralBtnConcluir` |
| Encerramento automático sem Compra/Pedido | `encerrarRevisaoAutomaticamente()` → `concluirRevisao({ navegacao.abrirCompra: false })` |

Trecho crítico (antes → depois):

**Antes (incorreto):**
```js
if (!produtoId) {
  notificar('…Abrindo cadastro…');
  cadastrarNovo(); // ← navegação indevida a partir de Confirmar
  return;
}
```

**Depois (RC7.5):**
```js
if (!produtoId) {
  notificar('Selecione um produto para continuar.', 'warning');
  return;
}
```

Cadastro continua disponível apenas por **F3 / “Cadastrar Novo”**, nunca pelo botão Confirmar.

---

## 3. Comportamento homologado

| Passo | Resultado |
|-------|-----------|
| Confirmar sem produto | Mensagem: *Selecione um produto para continuar.* |
| Confirmar com candidato | Persiste vínculo + aprendizado (`origem = Confirmacao Manual`) |
| Item | Marcado `confirmado` / sai da lista lateral |
| Indicadores | Atualizam (confirmação, cadastro, precisão) sem fechar a tela |
| Próximo | Seleção automática da próxima pendência |
| Enter | Dispara o mesmo fluxo de Confirmar |
| Último item | Encerra revisão e devolve ao `onConcluir` da Central |
| Compra/Pedido | **Não** abertos por Confirmar Produto |

O `onConcluir` já existente em `central-entradas.js` (`revisar/concluir` + refresh do documento) **não** chama `loadPage('compras')`. Compra só ocorre por `abrirCompraDesdeCentral` quando o fluxo da Central determinar.

---

## 4. Aprendizado MIIP

`POST /api/miip/feedback` com:

- Fornecedor / CNPJ  
- Código do fornecedor  
- Código de barras (quando houver)  
- Descrição XML  
- Produto CDS  
- Usuário  
- `origem: "Confirmacao Manual"`  

---

## 5. Testes

```bash
node tests/miip/rc75-confirmar-produto.test.js
node tests/miip/miip-central-revisao.test.js
```

Cobertura RC7.5: um item, vários itens, último item, XML sem pendências, produto aprendido, sem candidato, Enter, ausência de navegação Compra/Pedido no fonte.

---

## 6. Critério de aceite

✔ Central MIIP = fluxo contínuo de resolução de pendências  
✔ Confirmar Produto só confirma, aprende e avança  
✔ Pedido/Compra nunca abertos por essa ação  
