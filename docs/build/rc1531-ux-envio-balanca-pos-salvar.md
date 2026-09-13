# RC15.3.1 — UX do Cadastro com Envio para Balança

## Problema

Após salvar produto pesável, o modal permanecia aberto e quebrava o fluxo padrão do cadastro.

## Solução

1. **Salvar** sempre fecha o modal e atualiza a listagem.
2. Se o produto for pesável (ativo + PLU válido), exibe diálogo opcional:

   > Deseja enviar este produto para a balança agora?  
   > **[ Enviar Agora ]** **[ Depois ]**

3. **Depois** — fecha o diálogo; fluxo normal do ERP.
4. **Enviar Agora** — `POST /upload-produto` → `ToledoPluEngine.uploadOne` → fecha diálogo → toast *"Produto enviado para a balança."*

## Regras

- Nunca manter o modal de cadastro aberto após salvar.
- Sem alteração no Driver nem no Motor Universal.

## Teste

```
npm run test:upload-produto-cadastro
```
