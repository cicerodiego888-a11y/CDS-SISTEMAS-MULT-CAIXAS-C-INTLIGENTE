# STABLE-1.0 — Certificação para Produção

**Resultado: APTO PARA PRODUÇÃO**

- Gerado em: 2026-08-04T14:27:48.606Z
- Tempo total: 2229 ms
- RAM: 7.24 → 160.23 MB
- CPU user Δ: 2188000 µs

## Critérios
- Busca < 20 ms
- Cache hit ≥ 90%
- Stress 20 operadores

## Etapas
- **e1_auditoria**: `{"findings":[],"enterpriseWarn":true,"hotPathOk":true}…`
- **e2_benchmark**: `{"porTermo":{"A":{"media":0.0168,"max":0.064,"min":0.013,"cacheHitPct":1,"fonteUltima":null},"AR":{"media":0.0183,"max":0.035,"min":0.016,"cacheHitPct":1,"fonteUltima":null},"ARR":{"media":0.0158,"max…`
- **e3_escala**: `{"10000":{"media":0.0589,"max":1.508,"min":0.008,"modo":"db+catalog","tamanho":10000},"50000":{"media":3.7374,"max":9.1651,"min":3.476,"modo":"catalog_snapshot","tamanho":50000},"100000":{"media":3.64…`
- **e4_catalog**: `{"tamanho":10000,"versao":4,"swaps":4,"rebuildSimultaneoSeguro":true,"semDuplicacao":true,"ramDeltaMb":6.74}…`
- **e5_hotcache**: `{"rebuild":{"produtos":40,"em":"2026-08-04T14:27:50.436Z"},"stats":{"tamanho":40,"max":400,"hits":100,"misses":0,"protegidos":40,"reconstruidoEm":"2026-08-04T14:27:50.436Z"},"hotHitRate":1,"adaptiveHi…`
- **e6_atualizacao**: `{"ok":true,"semRestart":true,"tamanhoAntes":10000,"tamanhoDepois":10001}…`
- **e7_stress**: `{"operadores":20,"consultas":167,"erros":0,"media":0.0691,"max":1.16,"min":0.041}…`
- **e8_plugins**: `{"smartDashboardOff":true,"businessMonitorOff":true,"ciaOk":true,"buscaOk":true}…`
- **e9_sandbox**: `{"timeoutIsolado":true,"falhaIsolada":true,"circuit":{"state":"open","failures":2,"openUntil":1785853670711},"erpOk":true}…`
- **e10_logs**: `{"unhandledRejections":0}…`
- **e11_pdv**: `{"media":0.0316,"max":1.843,"min":0.008,"segundaVendaOk":true,"consultas":500}…`

## Falhas
- Nenhuma

## Motores
- MIB: MIB-RC4.0
- CIA: CIA-RC1.0
- CIP: CIP-RC1.0
- SearchService: ProductProvider→MIB
