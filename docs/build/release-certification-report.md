# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 525c64e
- Build: 2026-11-11T11:59:52.192Z
- Hash app.asar: `5d3dfc42af38da30a4224353679c89aa3833338b54690f58a0d4cba2c9d44cdc`
- Origem: fonte
- Data: 2026-11-11T13:06:25.539Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: fonte | asar: N/A…
✔ Login
  - user=rc4320_1794402384746 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1794402383746-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=0
✔ Estoque
  - fiscal=6+3 | total=15 UN
✔ MIIP
  - MUC 10×12 → 120 UN (MULTIPLICADOR)
✔ Central Inteligente
  - documento 000064 processado
✔ NFC-e
  - homologação dest.xNome + módulo emissor presente
✔ NF-e
  - autorização cStat=100 | protocolo=123
✔ Relatórios
  - compras=0 fin=0 prod=0
✔ Performance
  - 1.8s | mem 25.6MB | sql=16

## Estatísticas

- Tempo total: 1.8s
- Memória máxima: 25.6 MB
- CPU user: 1031 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
