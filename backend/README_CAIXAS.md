# Módulo de Gerenciamento de Caixas

## Visão Geral

Módulo administrativo completo para gerenciamento de caixas (pontos de venda) no sistema. Permite criar, editar, desativar e reativar caixas com suporte a vinculação de terminais.

## Estrutura

### Backend

**Arquivo:** `backend/rotas/caixas.js`

**Endpoints:**

| Método | Rota | Descrição | Permissão |
|--------|------|-----------|-----------|
| GET | `/api/caixas` | Listar caixas (com filtros) | Pública |
| GET | `/api/caixas/:id` | Buscar caixa por ID | Pública |
| POST | `/api/caixas` | Criar novo caixa | SUPER_ADMIN, ADMIN |
| PUT | `/api/caixas/:id` | Editar caixa | SUPER_ADMIN, ADMIN |
| DELETE | `/api/caixas/:id` | Desativar caixa (soft delete) | SUPER_ADMIN, ADMIN |
| PUT | `/api/caixas/:id/reativar` | Reativar caixa | SUPER_ADMIN, ADMIN |

### Frontend

**Página:** `frontend/caixas.html`

**Script:** `frontend/js/caixas.js`

**Funcionalidades:**
- Listagem paginada e filtrada de caixas
- Busca por nome, descrição e terminal
- Filtro por status (ativo/inativo)
- Cards de resumo (total, ativos, inativos, terminais vinculados)
- Modal para criar/editar caixa
- Ações: editar, desativar, reativar
- Auditoria de todas as ações

## Uso

### Acessar o módulo

1. No menu lateral, clique em **"Gerenciar Caixas"**
2. O sistema carregará a página de gerenciamento

### Criar um novo caixa

1. Clique no botão **"+ Novo Caixa"**
2. Preencha os campos:
   - **Nome** (obrigatório): Ex. "Caixa 01"
   - **Descrição** (opcional): Ex. "Frente da Loja"
   - **Terminal** (obrigatório): Identificador do terminal (Ex. "PDV-01")
   - **Status**: Ativo ou Inativo
3. Clique em **"Salvar"**

### Editar um caixa

1. Clique no ícone **"Editar"** (lápis) na linha do caixa
2. Altere os dados conforme necessário
3. Clique em **"Salvar"**

### Desativar um caixa

1. Clique no ícone **"Desativar"** (proibido) na linha do caixa
2. Confirme a ação
3. O caixa será marcado como inativo

**Restrições:**
- Não é possível desativar um caixa com status "aberto"
- A auditoria registra cada desativação

### Reativar um caixa

1. Filtrar por **"Inativos"** para visualizar caixas desativados
2. Clique no ícone **"Reativar"** (checkmark) na linha do caixa
3. Confirme a ação
4. O caixa voltará a ficar ativo

## API

### GET /api/caixas

**Parâmetros de Query:**
- `busca` (string, opcional): Busca por nome, descrição ou terminal
- `status` (string, opcional): Filtro por status ("ativo" ou "inativo")

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3001/api/caixas?busca=Caixa&status=ativo"
```

**Resposta:**
```json
{
  "data": [
    {
      "id": 1,
      "nome": "Caixa 01",
      "descricao": "Frente da Loja",
      "ativo": 1,
      "qtd_terminais": 1,
      "created_at": "2026-06-12T10:30:00Z",
      "updated_at": "2026-06-12T10:30:00Z"
    }
  ],
  "total": 1
}
```

### GET /api/caixas/:id

**Exemplo:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3001/api/caixas/1"
```

### POST /api/caixas

**Body:**
```json
{
  "nome": "Caixa 03",
  "descricao": "Açougue",
  "terminal_identificador": "PDV-ACOUGUE",
  "ativo": 1
}
```

**Validações:**
- Nome é obrigatório
- Terminal é obrigatório
- Nome não pode ser duplicado
- Terminal não pode estar vinculado a outro caixa

### PUT /api/caixas/:id

**Body:**
```json
{
  "nome": "Caixa 03 - Atualizado",
  "descricao": "Açougue - Principal",
  "terminal_identificador": "PDV-ACOUGUE",
  "ativo": 1
}
```

### DELETE /api/caixas/:id

Remove logicamente o caixa (soft delete).

**Validação:**
- Não é possível desativar um caixa com status "aberto"

### PUT /api/caixas/:id/reativar

Reativa um caixa desativado.

## Auditoria

Todas as ações são registradas na tabela `auditoria`:

- **Criar**: Ação "criar", módulo "caixas"
- **Editar**: Ação "editar", módulo "caixas"
- **Desativar**: Ação "desativar", módulo "caixas"
- **Reativar**: Ação "reativar", módulo "caixas"

**Exemplo:**
```sql
SELECT * FROM auditoria WHERE modulo = 'caixas' ORDER BY criado_em DESC;
```

## Banco de Dados

**Tabela:** `caixas`

```sql
CREATE TABLE IF NOT EXISTS caixas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terminais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  caixa_id INTEGER,
  ativo INTEGER DEFAULT 1,
  ultima_conexao DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caixa_id) REFERENCES caixas(id)
);
```

## Testes

**Arquivo:** `tests/test_caixas_api.js`

**Uso:**
```bash
node tests/test_caixas_api.js
```

**O que testa:**
- Listar caixas
- Criar novo caixa
- Buscar caixa por ID
- Editar caixa
- Desativar caixa
- Reativar caixa
- Filtros e busca

## Segurança

- Apenas usuários com perfil **SUPER_ADMIN** ou **ADMIN** podem criar, editar, desativar e reativar caixas
- Todas as ações são registradas em auditoria
- Suporte a autenticação via JWT

## Padrão Visual

Segue o padrão visual do sistema:
- Cards de resumo (dashboard style)
- Tabela responsiva com ações
- Modal Bootstrap para criar/editar
- Badges de status
- Notificações de sucesso/erro

## Menu

O módulo é acessível via:
- **Menu Lateral** → "Gerenciar Caixas"
- Data-page: `caixas`

## Integração com PDV

O módulo **não interfere** com o funcionamento atual do PDV ou das operações de abertura/fechamento de caixa.

Funciona como um painel administrativo separado para gerenciar a configuração dos caixas disponíveis.

## Próximas Melhorias (Futuro)

- [ ] Relatório de uso de caixas
- [ ] Gráfico de atividade por caixa
- [ ] Exportação de dados
- [ ] Bulk operations (editar múltiplos caixas)
- [ ] Histórico de alterações de terminal por caixa
