# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 8083dc0
- Build: 2026-10-29T18:34:59.365Z
- Hash app.asar: `6744cddb9170dc803ef55b1644ea21e474c30372f0270c877a26847efaf600a1`
- Origem: fonte
- Data: 2026-11-07T03:21:30.480Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: fonte | asar: N/A…
✔ Login
  - user=rc4320_1794021689809 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1794021689020-P
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
  - 1.5s | mem 25.6MB | sql=16

## Estatísticas

- Tempo total: 1.5s
- Memória máxima: 25.6 MB
- CPU user: 625 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
