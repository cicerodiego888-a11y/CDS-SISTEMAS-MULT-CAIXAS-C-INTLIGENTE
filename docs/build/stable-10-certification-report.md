# STABLE-1.0 — Certificação para Produção

**Resultado: APTO PARA PRODUÇÃO**

- Gerado em: 2026-10-11T23:29:16.693Z
- Tempo total: 2757 ms
- RAM: 7.92 → 136.95 MB
- CPU user Δ: 2859000 µs

## Critérios
- Busca < 20 ms
- Cache hit ≥ 90%
- Stress 20 operadores

## Etapas
- **e1_auditoria**: `{"findings":[],"enterpriseWarn":true,"hotPathOk":true}…`
- **e2_benchmark**: `{"porTermo":{"A":{"media":0.1875,"max":0.854,"min":0.112,"cacheHitPct":1,"fonteUltima":null},"AR":{"media":0.1485,"max":0.739,"min":0.118,"cacheHitPct":1,"fonteUltima":null},"ARR":{"media":0.1396,"max…`
- **e3_escala**: `{"10000":{"media":1.027,"max":26.688,"min":0.128,"modo":"db+catalog","tamanho":10000},"50000":{"media":2.9223,"max":7.2544,"min":2.5241,"modo":"catalog_snapshot","tamanho":50000},"100000":{"media":3.4…`
- **e4_catalog**: `{"tamanho":10000,"versao":4,"swaps":4,"rebuildSimultaneoSeguro":true,"semDuplicacao":true,"ramDeltaMb":23.27}…`
- **e5_hotcache**: `{"rebuild":{"produtos":40,"em":"2026-10-11T23:29:18.845Z"},"stats":{"tamanho":40,"max":400,"hits":100,"misses":0,"protegidos":40,"reconstruidoEm":"2026-10-11T23:29:18.845Z"},"hotHitRate":1,"adaptiveHi…`
- **e6_atualizacao**: `{"ok":true,"semRestart":true,"tamanhoAntes":10000,"tamanhoDepois":10001}…`
- **e7_stress**: `{"operadores":20,"consultas":251,"erros":0,"media":0.0958,"max":0.317,"min":0.053}…`
- **e8_plugins**: `{"smartDashboardOff":true,"businessMonitorOff":true,"ciaOk":true,"buscaOk":true}…`
- **e9_sandbox**: `{"timeoutIsolado":true,"falhaIsolada":true,"circuit":{"state":"open","failures":2,"openUntil":1791761359271},"erpOk":true}…`
- **e10_logs**: `{"unhandledRejections":0}…`
- **e11_pdv**: `{"media":0.1145,"max":0.632,"min":0.091,"segundaVendaOk":true,"consultas":500}…`

## Falhas
- Nenhuma

## Motores
- MIB: MIB-RC4.0
- CIA: CIA-RC1.0
- CIP: CIP-RC1.0
- SearchService: ProductProvider→MIB
