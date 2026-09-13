# Branding Oficial 1.0 — CDS Sistemas

**Tipo:** Identidade visual (sem alteração funcional)  
**Data:** 2026-07-10

---

## Estrutura

```
assets/branding/
  logo-oficial.png
  logo-auxiliar.png
  favicon.ico
  icon.ico
  splash.png
  login-background.png
  marca-dagua.png
  BrandService.js      ← Node / Electron
  README.md
```

URL Web: `/branding/<arquivo>`  
Legado: `/shared/img/logo-cds-sistemas.png` → redireciona para logo oficial

---

## BrandService

| Ambiente | Caminho |
|---|---|
| Node / Electron | `assets/branding/BrandService.js` |
| Web / Renderer | `frontend/shared/js/brand-service.js` → `window.BrandService` |

Centraliza:

- Nome da plataforma (`CDS Sistemas`)
- Slogan oficial
- Caminhos de logos, favicon, splash, login background, marca d'água

---

## Referências atualizadas

- Login, ERP, PDV (favicon + scripts)
- Sidebar padrão (logo auxiliar)
- Dashboard (slogan via BrandService)
- Electron (`electron.js`, `electron-common.js`)
- electron-builder (`package.json`, erp, pdv)
- `backend/server.js` — static `/branding` + redirect legado

---

## Compatibilidade

| Canal | Status |
|---|---|
| Electron (ícone janela / instalador) | `assets/branding/icon.ico` |
| Web (favicon + assets) | `/branding/*` |
| URL legada da logo | Mantida (zero links quebrados) |
| `assets/icon.ico` | Cópia de compatibilidade |

---

## Branding Oficial 1.0 concluído.

Nenhuma regra de negócio, API ou banco foi alterada — apenas consolidação da identidade visual.
