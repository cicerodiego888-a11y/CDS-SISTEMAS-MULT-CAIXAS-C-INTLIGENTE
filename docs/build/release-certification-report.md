# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 2d4967c
- Build: 2026-11-11T18:02:13.569Z
- Hash app.asar: `f47494ebb09d336a9c10ed54c52a2494d53cdb27c78a78f7037c1d5ed4a7b9f3`
- Origem: instalador-desatualizado
- Data: 2026-11-11T19:04:07.098Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: f47494ebb09d…
✔ Login
  - user=rc4320_1794423846303 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1794423844746-P
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
  - 2.4s | mem 28.7MB | sql=16

## Estatísticas

- Tempo total: 2.4s
- Memória máxima: 28.7 MB
- CPU user: 1531 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
