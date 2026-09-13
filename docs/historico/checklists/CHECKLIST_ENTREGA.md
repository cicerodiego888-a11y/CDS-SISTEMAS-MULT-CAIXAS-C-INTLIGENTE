# 🚀 Checklist de Entrega - Sistema CDS Sistemas

## ✅ Padronização e Limpeza Completa

### 📊 Análise do Projeto

| Componente | Tamanho | Situação |
|-----------|---------|----------|
| node_modules | 729 MB | ⚠️ Excluir antes do build |
| backend/schemas/nfe_v4.00 | ~15 MB (1364 arquivos XSD) | ⚠️ Não referenciados no código |
| backend/ | 15.77 MB | ✅ OK |
| frontend/ | 1.95 MB | ✅ OK |

---

## 🗂️ Arquivos para Remover/Mover

### Scripts de Manutenção (Mover para pasta `scripts/`)

| Arquivo | Tipo | Ação |
|---------|------|------|
| `add_column.js` | Migração BD | Mover para `scripts/` |
| `add_column_fixed.js` | Migração BD | Mover para `scripts/` |
| `check-user.js` | Debug | Mover para `scripts/` |
| `test_db_schema.js` | Teste | Mover para `scripts/` |
| `integration-test.js` | Teste | Mover para `scripts/` |
| `zerar_caixa.js` | Utilitário | Mover para `scripts/` |

### Arquivos de Documentação (Manter na raiz)

| Arquivo | Situação |
|---------|----------|
| `README.md` | ✅ Manter |
| `INSTRUCOES_UPLOAD_CERTIFICADO.md` | ✅ Manter |
| `HOMOLOGACAO_CE_PASSO_A_PASSO.md` | ✅ Manter |
| `AJUSTES_FINANCEIRO_COMPRAS.md` | ⚠️ Opcional |
| `ALTERACOES_FISCAIS_2026-04-10.md` | ⚠️ Opcional |
| `ALTERACOES_URGENTES_2026-04-09.md` | ⚠️ Opcional |
| `ASSINATURA_XML_REAL.md` | ⚠️ Opcional |
| `COMPRA_XML_E_MARGEM_README.md` | ⚠️ Opcional |
| `TESTE_EMISSAO_NFCE.md` | ⚠️ Opcional |

---

## 🔒 Segurança (CRÍTICO)

### Certificados Removidos ✅
- [x] `certificado_teste.pfx` da raiz
- [x] `certificado.pfx` de `backend/certificados/`

### Configuração Atual
```
backend/
├── certificados/           # Apenas certificados públicos
│   ├── ICP-Brasilv5-correto.pem  ✅
│   └── ICP-Brasilv5.crt          ✅
│
└── banco/
    └── fiscal/             # Dados do cliente (fora do código)
        ├── certificados/     # .pfx enviados via upload
        ├── xml/              # XMLs fiscais
        ├── danfe/            # DANFEs gerados
        └── debug/            # Logs de debug
```

### Gitignore Configurado ✅
```
*.pfx
*.p12
backend/banco/fiscal/certificados/
!backend/certificados/ICP-Brasil*.pem
```

---

## 🗄️ Banco de Dados Padronizado ✅

### Caminho Oficial
```javascript
const DB_PATH = path.resolve(__dirname, 'banco', 'mercadao.db');
// backend/banco/mercadao.db
```

### Arquivos Atualizados
- [x] `backend/database.js` - Padronizado
- [x] `backend/database_backup.js` - Padronizado  
- [x] `backend/reset-users.js` - Padronizado
- [x] `backend/backup.js` - Padronizado
- [x] `add_column.js` - Padronizado
- [x] `add_column_fixed.js` - Padronizado
- [x] `zerar_caixa.js` - Padronizado
- [x] `electron.js` - Caminho atualizado

---

## 📦 Build Electron (package.json)

### Arquivos Incluídos no Build
```json
"files": [
  "backend/**/*",
  "frontend/**/*", 
  "electron.js",
  "preload.js",
  "package.json",
  "assets/**/*"
]
```

### ⚠️ EXCLUSÕES RECOMENDADAS

#### 1. Excluir schemas XSD da NFe (15MB+)
Adicionar ao `package.json`:
```json
"build": {
  "files": [
    "backend/**/*",
    "!backend/schemas/**/*",
    "frontend/**/*",
    "electron.js",
    "preload.js",
    "package.json",
    "assets/**/*"
  ]
}
```

#### 2. Excluir scripts de manutenção
Os arquivos na raiz `.js` de utilitários não estão incluídos no build (pois `files` só inclui `backend/**/*` e `frontend/**/*`).

---

## 🧪 Dependências do Projeto

### Produção (17 pacotes)
```
axios, bcryptjs, body-parser, cors, escpos, escpos-usb, express,
form-data, googleapis, jsonwebtoken, moment, multer, node-cron,
node-forge, qrcode, sqlite3, xml-crypto, xml2js
```

### Verificação
- [x] `escpos` e `escpos-usb` - Só necessários se usar impressora térmica USB
- [x] `googleapis` - Verificar se está sendo usado para backup na nuvem
- [x] `node-cron` - Verificar se há agendamentos automáticos

---

## 🎯 Próximos Passos para Entrega

### 1. Limpar para Build
```bash
# Limpar node_modules e reinstalar apenas produção
rmdir /s /q node_modules
del package-lock.json
npm install --production

# Ou usar o comando de build
npm run dist
```

### 2. Verificar Tamanho do Instalador
- Atual: Inclui schemas XSD (~15MB extras)
- Após limpar schemas: -15MB no instalador final

### 3. Testar Instalação Limpa
- Instalar em máquina limpa (Windows 10/11)
- Verificar se todas as funcionalidades funcionam
- Testar emissão de NFC-e em homologação

---

## ✅ Resumo das Ações

| Ação | Status |
|------|--------|
| Padronização do banco | ✅ Concluído |
| Remoção de certificados hardcoded | ✅ Concluído |
| Gitignore configurado | ✅ Concluído |
| Segurança de upload de certificados | ✅ Concluído |
| Bloqueio de venda com caixa fechado | ✅ Concluído |
| DANFE regeneração automática | ✅ Concluído |
| Excluir schemas do build | ⚠️ Configurar package.json |
| Mover scripts de manutenção | ⚠️ Opcional |
| Limpar documentação opcional | ⚠️ Opcional |

---

## 🚀 Build Final

### Comando
```bash
npm run dist
```

### Saída
- `dist/CDS-Sistemas-Setup-1.0.3-x64.exe`

---

*Sistema pronto para entrega! ✅*
