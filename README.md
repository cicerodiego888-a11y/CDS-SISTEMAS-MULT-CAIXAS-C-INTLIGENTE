# CDS Sistemas - Plataforma Inteligente de Gestão

Plataforma inteligente de gestão comercial (ERP/PDV) da CDS Sistemas.

## Funcionalidades

### 📦 Produtos
- Cadastro, edição e exclusão de produtos
- Controle de estoque
- Alertas de estoque baixo
- Histórico de preços

### 👥 Clientes
- Cadastro completo de clientes
- Controle de crédito
- Histórico de compras

### 🛒 Compras
- Registro de compras por nota fiscal
- Controle de fornecedores
- Atualização automática de estoque
- Histórico de compras

### 💰 Vendas
- PDV (Ponto de Venda) completo
- Múltiplas formas de pagamento
- Descontos
- Impressão de cupom fiscal
- Controle de crédito para clientes
- Cancelamento de vendas

### 📊 Financeiro
- Controle de receitas e despesas
- Relatórios por período
- Saldo atualizado
- Categorização de movimentações

### ⚙️ Configurações
- Personalização do sistema
- Backup de dados
- Informações da empresa

## Tecnologias Utilizadas

### Backend
- Node.js
- Express.js
- SQLite3
- REST API

### Frontend
- HTML5
- CSS3
- JavaScript (ES6+)
- Bootstrap 5
- jQuery
- Chart.js

## Pré-requisitos

- Node.js (versão 14 ou superior)
- NPM (Node Package Manager)

## Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/cds-sistemas.git
cd cds-sistemas
```

Estrutura principal:
```
├── backend/
│   ├── banco/
│   │   └── mercadao.db   # arquivo SQLite legado (nome técnico)
│   ├── rotas/
│   ├── database.js
│   └── server.js
├── frontend/
│   ├── erp/
│   ├── pdv/
│   └── shared/
├── assets/branding/
├── package.json
└── README.md
```
