# Auditoria e Alertas

Endpoints implementados:

- `GET /api/auditoria` — retorna logs (compatibilidade), exige permissão `auditoria`.
- `GET /api/auditoria/list?page=1&pageSize=50&modulo=&acao=&usuario_nome=&inicio=&fim=` — listagem paginada e filtrável (exige permissão `auditoria`).
- `GET /api/dashboard/resumo` — já existente; agora inclui campo `alerts` com detecções e alertas persistentes.

Banco de dados:

- Nova tabela `auditoria_alertas` para guardar alertas persistentes:
  - `id, tipo, descricao, dados (JSON), resolvido (0/1), criado_em, resolvido_em`

Como testar localmente:

1. Inicie o servidor (ex: `npm start` ou conforme instruções do projeto).
2. Exporte um token válido no ambiente (usuário com permissão `auditoria`):

```powershell
$env:TEST_TOKEN = "ey..."
$env:TEST_API_URL = "http://localhost:3000/api"
node tests/test_auditoria_api.js
node tests/test_dashboard_alerts.js
```

Observações:

- A interface do dashboard mostrará alertas persistentes (não resolvidos) no card de alertas.
- O menu principal foi atualizado para exibir a entrada `Auditoria` e ela será ocultada automaticamente para usuários sem permissão.
- Para marcar um alerta como resolvido, execute um `UPDATE auditoria_alertas SET resolvido = 1, resolvido_em = CURRENT_TIMESTAMP WHERE id = ?` no banco de dados.

Se quiser, posso adicionar endpoints para listar/arquivar/arquivar alertas via API e uma UI para resolver alertas diretamente pelo painel.
