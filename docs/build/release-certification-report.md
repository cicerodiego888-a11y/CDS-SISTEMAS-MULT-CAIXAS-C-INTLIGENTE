# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 896a8e8
- Build: 2026-10-06T11:39:03.535Z
- Hash app.asar: `3408efaf5b92d074bc8c608d9188c5883d49c1e658d1c7ec6b765380edf8d19e`
- Origem: instalador-desatualizado
- Data: 2026-10-06T19:58:47.089Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 3408efaf5b92…
✔ Login
  - user=rc4320_1791316726172 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1791316723119-P
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
  - 4s | mem 28.7MB | sql=16

## Estatísticas

- Tempo total: 4s
- Memória máxima: 28.7 MB
- CPU user: 1843 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
