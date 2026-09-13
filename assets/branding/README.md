# Branding Oficial CDS Sistemas — 1.0

Pasta canônica da identidade visual.

| Arquivo | Uso |
|---|---|
| `logo-oficial.png` | Logo principal (login, splash, marca) |
| `logo-auxiliar.png` | Sidebar / usos secundários |
| `favicon.ico` | Favicon Web |
| `icon.ico` | Ícone Electron / instalador |
| `icon-master.png` | Fonte HD (1024px) para regenerar ícones |
| `splash.png` | Splash de carregamento |
| `login-background.png` | Fundo padrão do login |
| `marca-dagua.png` | Marca d'água / documentos |
| `BrandService.js` | Serviço Node/Electron |

URL Web (após `express.static`): `/branding/<arquivo>`

API: `BrandService` (Node) e `window.BrandService` (Web via `frontend/shared/js/brand-service.js`).

### Regenerar ícones (.ico)

Após alterar `icon-master.png`:

```bash
npm run branding:icones
```

Gera `icon.ico` e `favicon.ico` com resoluções 16–256px (Lanczos).
