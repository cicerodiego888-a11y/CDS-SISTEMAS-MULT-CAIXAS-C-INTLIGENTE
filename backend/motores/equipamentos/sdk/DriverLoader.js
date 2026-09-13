/**
 * Sprint 15.7 — DriverLoader (SDK)
 *
 * Fluxo: Inicialização → Scan → Manifest → Registry → Driver disponível
 */

'use strict';

const fs = require('fs');
const path = require('path');
const DeviceProfile = require('./DeviceProfile');
const registry = require('./DriverRegistry');
const { validarDriver } = require('./DriverValidator');

class DriverLoader {
  constructor(deps = {}) {
    this._registry = deps.registry || registry;
    this._profilesDir = deps.profilesDir || path.join(__dirname, 'profiles');
    this._extraDirs = Array.isArray(deps.extraDirs) ? deps.extraDirs : [];
    this._carregado = false;
    this._ultimoRelatorio = null;
  }

  /**
   * Diretórios escaneados: sdk/profiles + drivers (device.profile.js)
   */
  _resolverCandidatos() {
    const arquivos = [];

    const coletarDir = (dir) => {
      if (!dir || !fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          coletarDir(full);
          continue;
        }
        if (!ent.isFile()) continue;
        if (/device\.profile\.js$/i.test(ent.name) || (/^[a-z0-9_-]+\.js$/i.test(ent.name) && dir === this._profilesDir)) {
          arquivos.push(full);
        }
      }
    };

    coletarDir(this._profilesDir);
    this._extraDirs.forEach(coletarDir);

    // Scan padrão em drivers/
    const driversRoot = path.join(__dirname, '..', 'drivers');
    if (fs.existsSync(driversRoot)) {
      const walk = (dir, depth = 0) => {
        if (depth > 4) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full, depth + 1);
          else if (ent.isFile() && /device\.profile\.js$/i.test(ent.name)) arquivos.push(full);
        }
      };
      walk(driversRoot);
    }

    return [...new Set(arquivos)];
  }

  _carregarModulo(arquivo) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(arquivo);
    return mod.default || mod.profile || mod.manifest || mod;
  }

  _tentarClasse(manifesto, arquivoPerfil) {
    if (!manifesto.driverModule && !manifesto.modulo) return null;
    const rel = manifesto.driverModule || manifesto.modulo;
    const base = path.dirname(arquivoPerfil);
    const candidatos = [
      path.isAbsolute(rel) ? rel : path.join(base, rel),
      path.join(__dirname, '..', 'drivers', rel.replace(/^\.\//, '')),
      path.join(base, '..', rel)
    ];
    for (const c of candidatos) {
      try {
        // eslint-disable-next-line import/no-dynamic-require, global-require
        const exp = require(c);
        const Classe = exp.default || exp.DRIVER || exp;
        if (typeof Classe === 'function') return Classe;
        if (Classe && typeof Classe.default === 'function') return Classe.default;
      } catch {
        /* próximo candidato */
      }
    }
    return null;
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Object} relatório
   */
  carregarTodos(opcoes = {}) {
    const forcar = opcoes.forcar === true;
    if (this._carregado && !forcar && this._ultimoRelatorio) {
      return this._ultimoRelatorio;
    }

    if (forcar) this._registry.limpar();

    const inicioTotal = Date.now();
    const carregados = [];
    const ignorados = [];
    const erros = [];
    const candidatos = this._resolverCandidatos();

    for (const arquivo of candidatos) {
      const t0 = Date.now();
      try {
        // Limpa cache para reload
        if (forcar && require.cache[require.resolve(arquivo)]) {
          delete require.cache[require.resolve(arquivo)];
        }
      } catch { /* ignore */ }

      try {
        const raw = this._carregarModulo(arquivo);
        const Classe = this._tentarClasse(raw, arquivo);
        const validacao = validarDriver({
          manifest: raw,
          Classe,
          soft: true,
          classeObrigatoria: false
        });

        if (!validacao.valido) {
          erros.push({
            arquivo,
            id: validacao.manifesto?.id || null,
            erros: validacao.erros
          });
          continue;
        }

        const id = validacao.manifesto.id;
        if (this._registry.buscar(id) && !forcar) {
          ignorados.push({ id, motivo: 'Já registrado', arquivo });
          continue;
        }

        const tempoCargaMs = Date.now() - t0;
        const profile = DeviceProfile.fromManifest(validacao.manifesto, {
          origem: arquivo.includes(`${path.sep}sdk${path.sep}profiles`) ? 'sdk/profiles' : 'drivers',
          caminho: arquivo,
          Classe,
          validacao: {
            valido: true,
            avisos: validacao.avisos,
            erros: []
          },
          compatibilidade: validacao.compatibilidade,
          tempoCargaMs,
          estado: Classe ? 'pronto' : 'manifesto',
          erros: []
        });

        this._registry.registrar(profile);
        carregados.push({
          id: profile.id,
          fabricante: profile.fabricante,
          modelo: profile.modelo,
          versao: profile.versao,
          categoria: profile.categoria,
          capabilities: profile.capabilitiesLista,
          tempoCargaMs,
          estado: profile.estado,
          arquivo
        });
      } catch (error) {
        erros.push({ arquivo, erro: error.message });
      }
    }

    this._ultimoRelatorio = {
      carregados,
      ignorados,
      erros,
      totalCandidatos: candidatos.length,
      totalRegistrados: this._registry.tamanho(),
      tempoTotalMs: Date.now() - inicioTotal,
      timestamp: new Date().toISOString()
    };
    this._registry.definirRelatorio(this._ultimoRelatorio);
    this._carregado = true;
    return this._ultimoRelatorio;
  }

  reload() {
    this._carregado = false;
    return this.carregarTodos({ forcar: true });
  }

  obterRelatorio() {
    return this._ultimoRelatorio;
  }

  estaCarregado() {
    return this._carregado;
  }
}

const driverLoader = new DriverLoader();

module.exports = driverLoader;
module.exports.DriverLoader = DriverLoader;
