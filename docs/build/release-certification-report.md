# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 896a8e8
- Build: 2026-10-06T19:58:47.412Z
- Hash app.asar: `063958be1c393ebf44794f8bb3cb78a45cb8b7dc8fecb09ffb5c014a8340b5cc`
- Origem: instalador-desatualizado
- Data: 2026-10-07T01:29:24.454Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 063958be1c39…
✔ Login
  - user=rc4320_1791336563970 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1791336562447-P
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
  - compras=1 fin=0 prod=0
✔ Performance
  - 2s | mem 28.7MB | sql=16

## Estatísticas

- Tempo total: 2s
- Memória máxima: 28.7 MB
- CPU user: 1000 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
