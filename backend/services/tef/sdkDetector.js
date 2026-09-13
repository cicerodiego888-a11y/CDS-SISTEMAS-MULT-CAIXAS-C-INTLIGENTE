const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  textoIndicaPpc930,
  extrairPortaCom,
  classificarDeteccaoPpc930,
  STATUS_EVIDENCIA
} = require('./pinpads/detectarPpc930');

const SITEF_DLL_NAMES = [
  'Clisitef64I.dll',
  'Clisitef32I.dll',
  'clisitef.dll',
  'libclisitef.so'
];

const PAYGO_DLL_NAMES = [
  'PayGo.dll',
  'paygo.dll',
  'libpaygo.so'
];

const SITEF_SEARCH_ROOTS = [
  'C:/CliSiTef',
  'C:/Program Files/CliSiTef',
  'C:/Program Files (x86)/CliSiTef',
  'C:/SiTef',
  'C:/TEF'
];

const PAYGO_SEARCH_ROOTS = [
  'C:/PayGo',
  'C:/Program Files/PayGo',
  'C:/Program Files (x86)/PayGo'
];

const SITEF_INI_NAMES = ['clisitef.ini', 'CliSiTef.ini'];
const PAYGO_INI_NAMES = ['paygo.ini', 'PayGo.ini'];

const GERTEC_DRIVER_PATHS = [
  'C:/Program Files/Gertec',
  'C:/Program Files (x86)/Gertec',
  'C:/Gertec',
  'C:/Program Files/Gertec/GerPCD',
  'C:/Program Files (x86)/Gertec/GerPCD'
];

const GERTEC_DRIVER_FILES = [
  'GerPCD.dll',
  'gertec.dll',
  'PPC930.dll'
];

const SITEF_SERVICO_NOMES = ['CliSiTef', 'SiTef', 'TEF'];
const PAYGO_SERVICO_NOMES = ['PayGo', 'PayGoTEF'];

class SDKDetector {
  localizarSDKs() {
    const encontrados = [];
    const vistos = new Set();

    for (const root of SITEF_SEARCH_ROOTS) {
      for (const dll of SITEF_DLL_NAMES) {
        this._adicionarSeExistir(path.join(root, dll), 'sitef', encontrados, vistos);
      }
    }

    for (const root of PAYGO_SEARCH_ROOTS) {
      for (const dll of PAYGO_DLL_NAMES) {
        this._adicionarSeExistir(path.join(root, dll), 'paygo', encontrados, vistos);
      }
    }

    return encontrados;
  }

  _adicionarSeExistir(caminho, tipo, lista, vistos) {
    const key = caminho.toLowerCase();
    if (vistos.has(key)) return;
    if (!fs.existsSync(caminho)) return;
    vistos.add(key);
    lista.push({
      tipo,
      caminho,
      encontrado: true,
      pasta: path.dirname(caminho),
      nome: path.basename(caminho)
    });
  }

  _buscarIni(pasta, nomes) {
    for (const nome of nomes) {
      const caminho = path.join(pasta, nome);
      if (fs.existsSync(caminho)) {
        return { encontrado: true, caminho, conteudo: fs.readFileSync(caminho, 'utf8') };
      }
    }
    return { encontrado: false, caminho: null, conteudo: null };
  }

  _validarIniBasico(conteudo) {
    if (!conteudo || !String(conteudo).trim()) return false;
    const texto = String(conteudo);
    return texto.includes('=') && (texto.includes('[') || texto.includes('Terminal') || texto.includes('IP'));
  }

  _detectarServicosWindows(nomes) {
    if (process.platform !== 'win32') {
      return { verificado: false, servicos: [] };
    }

    const encontrados = [];
    for (const nome of nomes) {
      try {
        const saida = execSync(`sc query "${nome}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (/STATE\s+:\s+\d+\s+RUNNING/i.test(saida)) {
          encontrados.push({ nome, status: 'RUNNING' });
        } else if (/STATE/i.test(saida)) {
          encontrados.push({ nome, status: 'INSTALADO' });
        }
      } catch {
        // serviço não existe
      }
    }

    return { verificado: true, servicos: encontrados };
  }

  detectarSitef() {
    const sdks = this.localizarSDKs().filter((s) => s.tipo === 'sitef');
    const dll = sdks[0] || null;
    const pasta = dll?.pasta || SITEF_SEARCH_ROOTS[0];
    const ini = dll ? this._buscarIni(dll.pasta, SITEF_INI_NAMES) : this._buscarIni(pasta, SITEF_INI_NAMES);
    const servicos = this._detectarServicosWindows(SITEF_SERVICO_NOMES);

    return {
      sitefInstalado: Boolean(dll),
      dllEncontrada: Boolean(dll),
      caminho: dll?.caminho || null,
      pasta: dll?.pasta || null,
      ini,
      configuracaoValida: ini.encontrado && this._validarIniBasico(ini.conteudo),
      servicosWindows: servicos,
      sdks: sdks
    };
  }

  detectarPaygo() {
    const sdks = this.localizarSDKs().filter((s) => s.tipo === 'paygo');
    const dll = sdks[0] || null;
    const pasta = dll?.pasta || PAYGO_SEARCH_ROOTS[0];
    const ini = dll ? this._buscarIni(dll.pasta, PAYGO_INI_NAMES) : this._buscarIni(pasta, PAYGO_INI_NAMES);
    const servicos = this._detectarServicosWindows(PAYGO_SERVICO_NOMES);

    return {
      paygoInstalado: Boolean(dll),
      dllEncontrada: Boolean(dll),
      caminho: dll?.caminho || null,
      pasta: dll?.pasta || null,
      ini,
      configuracaoValida: ini.encontrado && this._validarIniBasico(ini.conteudo),
      servicosWindows: servicos,
      sdks: sdks
    };
  }

  diagnosticarCompleto() {
    const sitef = this.detectarSitef();
    const paygo = this.detectarPaygo();
    const gertecPPC930 = this.detectarGertecPPC930();

    return {
      sitefInstalado: sitef.sitefInstalado,
      paygoInstalado: paygo.paygoInstalado,
      dllEncontrada: sitef.dllEncontrada || paygo.dllEncontrada,
      caminho: sitef.caminho || paygo.caminho || null,
      configuracaoValida: sitef.configuracaoValida || paygo.configuracaoValida,
      sitef,
      paygo,
      gertecPPC930,
      plataforma: process.platform,
      timestamp: new Date().toISOString()
    };
  }

  _listarPortasCOM() {
    if (process.platform !== 'win32') {
      return [];
    }

    const porPorta = new Map();

    const registrar = (item) => {
      if (!item) return;
      const porta = item.porta ? String(item.porta).toUpperCase() : extrairPortaCom(`${item.nome || ''} ${item.descricao || ''}`);
      if (!porta) return;
      const atual = porPorta.get(porta) || { porta, nome: '', descricao: '' };
      // Prefere nome mais descritivo (ex.: PPC-920/930...) sobre genérico
      if ((item.nome || '').length > (atual.nome || '').length) {
        atual.nome = item.nome || '';
      }
      if ((item.descricao || '').length > (atual.descricao || '').length) {
        atual.descricao = item.descricao || '';
      }
      if (!atual.nome) atual.nome = item.nome || '';
      if (!atual.descricao) atual.descricao = item.descricao || atual.nome;
      porPorta.set(porta, atual);
    };

    // 1) Win32_SerialPort
    try {
      const saida = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Description | ConvertTo-Json -Compress"',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }
      );
      const parsed = JSON.parse(saida || '[]');
      const lista = Array.isArray(parsed) ? parsed : [parsed];
      lista.filter(Boolean).forEach((item) => {
        registrar({
          porta: item.DeviceID || null,
          nome: item.Name || '',
          descricao: item.Description || ''
        });
      });
    } catch {
      // continua com fallback PnP
    }

    // 2) PnP Ports / nomes com (COMx) — captura CDC USB-to-Serial que às vezes não vem em Win32_SerialPort completo
    try {
      const script = [
        "Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |",
        "Where-Object { $_.Name -match '\\(COM\\d+\\)' } |",
        "Select-Object Name, DeviceID, Description, Manufacturer |",
        "ConvertTo-Json -Compress"
      ].join(' ');
      const pnp = execSync(
        `powershell -NoProfile -Command "${script}"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 }
      );
      const dispositivos = JSON.parse(pnp || '[]');
      const lista = Array.isArray(dispositivos) ? dispositivos : (dispositivos ? [dispositivos] : []);
      lista.filter(Boolean).forEach((d) => {
        const nome = d.Name || '';
        registrar({
          porta: extrairPortaCom(nome),
          nome,
          descricao: d.Description || nome,
          manufacturer: d.Manufacturer || ''
        });
      });
    } catch {
      // ignore
    }

    return Array.from(porPorta.values());
  }

  _listarDispositivosPnpPpc() {
    if (process.platform !== 'win32') {
      return { verificado: false, dispositivos: [] };
    }

    try {
      const script = [
        "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |",
        "Where-Object {",
        "  $_.FriendlyName -match 'Gertec|PPC[\\s\\-]?930|PPC[\\s\\-]?920\\s*/\\s*930|PPC920\\s*/\\s*930'",
        "} |",
        "Select-Object FriendlyName,Status,InstanceId,Manufacturer,Class |",
        "ConvertTo-Json -Compress"
      ].join(' ');
      const pnp = execSync(
        `powershell -NoProfile -Command "${script}"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 }
      );
      const dispositivos = JSON.parse(pnp || '[]');
      const lista = Array.isArray(dispositivos) ? dispositivos : (dispositivos ? [dispositivos] : []);
      return {
        verificado: true,
        dispositivos: lista.filter(Boolean).map((d) => ({
          FriendlyName: d.FriendlyName || '',
          nome: d.FriendlyName || '',
          Status: d.Status || '',
          InstanceId: d.InstanceId || '',
          Manufacturer: d.Manufacturer || '',
          Class: d.Class || '',
          porta: extrairPortaCom(d.FriendlyName || '')
        }))
      };
    } catch {
      return { verificado: false, dispositivos: [] };
    }
  }

  _verificarDriversGertec() {
    const encontrados = [];

    for (const root of GERTEC_DRIVER_PATHS) {
      if (!fs.existsSync(root)) continue;
      encontrados.push({ tipo: 'pasta', caminho: root });
      for (const arquivo of GERTEC_DRIVER_FILES) {
        const caminho = path.join(root, arquivo);
        if (fs.existsSync(caminho)) {
          encontrados.push({ tipo: 'dll', caminho });
        }
      }
    }

    const dllOuPastaGertec = encontrados.some((i) => i.tipo === 'dll' || i.tipo === 'pasta');

    return {
      // true somente com evidência positiva de driver/pasta Gertec
      confirmado: dllOuPastaGertec,
      // null = não confirmado (nunca false por ausência de pasta)
      instalado: dllOuPastaGertec ? true : null,
      itens: encontrados
    };
  }

  /**
   * Detecção física do Gertec PPC930 (TEF-02).
   * Não altera configuração TEF; não exige middleware/SDK/DLL.
   * @param {object} [opcoes]
   * @param {string} [opcoes.portaConfigurada]
   */
  detectarGertecPPC930(opcoes = {}) {
    const portas = this._listarPortasCOM();
    const pnp = this._listarDispositivosPnpPpc();
    const drivers = this._verificarDriversGertec();

    const usbConfirmado = pnp.verificado
      ? pnp.dispositivos.some((d) => {
        const id = String(d.InstanceId || '');
        const classe = String(d.Class || '');
        return textoIndicaPpc930(d.FriendlyName || d.nome) &&
          (/USB\\VID_/i.test(id) || /usb/i.test(classe));
      })
      : null;

    const resultado = classificarDeteccaoPpc930(portas, {
      portaConfigurada: opcoes.portaConfigurada || null,
      dispositivosPnp: pnp.dispositivos,
      driverConfirmado: drivers.confirmado === true ? true : null,
      usbConfirmado: usbConfirmado === true ? true : null,
      verificacaoDriverDisponivel: true,
      verificacaoUsbDisponivel: pnp.verificado
    });

    return {
      ...resultado,
      // Compatibilidade com consumidores anteriores
      driver: resultado.driver,
      usb: resultado.usb,
      portasCOM: portas,
      drivers: drivers.itens,
      pnp: {
        verificado: pnp.verificado,
        dispositivos: pnp.dispositivos
      },
      statuses: {
        driver: resultado.driverStatus || STATUS_EVIDENCIA.NAO_CONFIRMADO,
        usb: resultado.usbStatus || STATUS_EVIDENCIA.NAO_CONFIRMADO,
        deteccao: resultado.estado
      }
    };
  }

  /**
   * API pública — reutilizada pelo Discovery Engine (RC2).
   * @returns {Array<{ porta: string|null, nome: string, descricao: string }>}
   */
  listarPortasCOM() {
    return this._listarPortasCOM();
  }

  /**
   * Enumera dispositivos USB/PnP com VID/PID quando disponíveis (Windows).
   * Reutiliza a mesma abordagem PowerShell do detector TEF.
   * @returns {Array<Object>}
   */
  listarDispositivosUsb() {
    if (process.platform !== 'win32') {
      return [];
    }

    try {
      const script = [
        "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |",
        "Where-Object { $_.InstanceId -match 'USB\\\\VID_' -or $_.Class -match 'USB|Ports' } |",
        "Select-Object FriendlyName, InstanceId, Manufacturer, Status, Class |",
        "ConvertTo-Json -Compress"
      ].join(' ');
      const pnp = execSync(
        `powershell -NoProfile -Command "${script}"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }
      );
      const dispositivos = JSON.parse(pnp || '[]');
      const lista = Array.isArray(dispositivos) ? dispositivos : (dispositivos ? [dispositivos] : []);

      return lista.filter(Boolean).map((d) => {
        const instanceId = String(d.InstanceId || '');
        const vidMatch = /VID_([0-9A-Fa-f]{4})/i.exec(instanceId);
        const pidMatch = /PID_([0-9A-Fa-f]{4})/i.exec(instanceId);
        const serialMatch = /\\([0-9A-Fa-f\-]+)$/i.exec(instanceId);
        return {
          nome: d.FriendlyName || '',
          caminho_dispositivo: instanceId || null,
          manufacturer: d.Manufacturer || '',
          product: d.FriendlyName || '',
          status: d.Status || '',
          classe: d.Class || '',
          vid: vidMatch ? vidMatch[1].toUpperCase() : null,
          pid: pidMatch ? pidMatch[1].toUpperCase() : null,
          serial_number: serialMatch && !/^VID_/i.test(serialMatch[1]) ? serialMatch[1] : null
        };
      });
    } catch {
      return [];
    }
  }
}

module.exports = new SDKDetector();
