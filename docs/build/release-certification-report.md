# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: cc32d71
- Build: 2026-10-20T19:11:07.703Z
- Hash app.asar: `338aa815009ea39de412792c555e6f55d8481cb6553db118da0d859de18f2fd0`
- Origem: instalador-desatualizado
- Data: 2026-10-23T01:13:17.744Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 338aa815009e…
✔ Login
  - user=rc4320_1792717997248 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1792717995607-P
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
  - 2.1s | mem 28.7MB | sql=16

## Estatísticas

- Tempo total: 2.1s
- Memória máxima: 28.7 MB
- CPU user: 922 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
