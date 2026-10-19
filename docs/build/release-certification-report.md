# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 6271dca
- Build: 2026-10-19T12:19:05.699Z
- Hash app.asar: `d9c3e464d20772f4a6fa495a898c7165120fcdc3471b0590fd0c598e65013d82`
- Origem: instalador-desatualizado
- Data: 2026-10-19T12:59:05.431Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: d9c3e464d207…
✔ Login
  - user=rc4320_1792414744639 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1792414741475-P
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
  - 4s | mem 28.8MB | sql=16

## Estatísticas

- Tempo total: 4s
- Memória máxima: 28.8 MB
- CPU user: 1844 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
