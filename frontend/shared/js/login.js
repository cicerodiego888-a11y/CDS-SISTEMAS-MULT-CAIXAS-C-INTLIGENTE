/**
 * Login — autenticação.
 * Hotfix RC2.2 — primeiro acesso (admin/1234 + troca obrigatória).
 * Persistência do último acesso (usuário + senha) para login mais rápido em estação local.
 */
const API_URL = (() => {
  if (typeof window.API_URL === 'string' && window.API_URL.trim() !== '') {
    return window.API_URL;
  }

  const resolved = `${window.location.origin}/api`;
  window.API_URL = resolved;
  return resolved;
})();

const CDS_LOGIN_ULTIMO_USER_KEY = 'cds_login_ultimo_usuario';
const CDS_LOGIN_ULTIMO_PASS_KEY = 'cds_login_ultima_senha';

/** Usuário já tocou/digitou no formulário — lifecycle automático não pode roubar foco. */
let loginUsuarioInteragiu = false;

function marcarLoginUsuarioInteragiu() {
  loginUsuarioInteragiu = true;
}

function loginCampoAtivoEhFormulario() {
  const ativo = document.activeElement;
  return !!(ativo && (ativo.id === 'username' || ativo.id === 'password' || ativo.id === 'btn-entrar'));
}

function persistirChaveLogin(chave, valor) {
  const texto = String(valor == null ? '' : valor);
  try { localStorage.setItem(chave, texto); } catch (_) { /* ignore */ }
  try { sessionStorage.setItem(chave, texto); } catch (_) { /* ignore */ }
}

function lerChaveLogin(chave) {
  try {
    const local = localStorage.getItem(chave);
    if (local != null && local !== '') return local;
  } catch (_) { /* ignore */ }
  try {
    return sessionStorage.getItem(chave) || '';
  } catch (_) {
    return '';
  }
}

function salvarUltimoAcessoLogin(username, password) {
  try {
    const user = String(username || '').trim();
    if (!user) return;
    persistirChaveLogin(CDS_LOGIN_ULTIMO_USER_KEY, user);
    if (password != null && String(password) !== '') {
      persistirChaveLogin(CDS_LOGIN_ULTIMO_PASS_KEY, String(password));
    }
  } catch (_) { /* ignore quota / private mode */ }
}

function obterUltimoAcessoLogin() {
  return {
    username: lerChaveLogin(CDS_LOGIN_ULTIMO_USER_KEY),
    password: lerChaveLogin(CDS_LOGIN_ULTIMO_PASS_KEY)
  };
}

function carregarUltimoAcessoLogin() {
  try {
    if (loginUsuarioInteragiu || loginCampoAtivoEhFormulario()) return false;
    const { username, password } = obterUltimoAcessoLogin();
    if (!username && !password) return false;
    const $user = $('#username');
    const $pass = $('#password');
    if (username && $user.length && !String($user.val() || '').trim()) $user.val(username);
    if (password && $pass.length && !String($pass.val() || '')) $pass.val(password);
    return true;
  } catch (_) {
    return false;
  }
}

function lembrarCamposDigitadosLogin() {
  const username = String($('#username').val() || '').trim();
  const password = String($('#password').val() || '');
  if (!username) return;
  salvarUltimoAcessoLogin(username, password);
}

function agendarRestauracaoUltimoAcessoLogin() {
  [0, 80, 250, 600, 1200].forEach((ms) => {
    setTimeout(() => carregarUltimoAcessoLogin(), ms);
  });
}

(function redirectIfLoggedIn() {
  const token = localStorage.getItem('token');
  if (!token) return;

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {
      return {};
    }
  })();

  if (user && user.troca_senha_obrigatoria) {
    return;
  }

  const destino = typeof obterDestinoPosLogin === 'function'
    ? obterDestinoPosLogin(user)
    : '/erp';

  window.location.replace(destino);
})();

function concluirPosLogin(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));

  const destino = typeof obterDestinoPosLogin === 'function'
    ? obterDestinoPosLogin(data.user)
    : '/erp';

  if (window.LoginExperience && typeof LoginExperience.mostrarSplashEntrada === 'function') {
    LoginExperience.mostrarSplashEntrada(destino);
    return;
  }

  window.location.replace(destino);
}

function mostrarPainelPrimeiroAcesso() {
  $('#loginForm').closest('.lx-card').attr('hidden', true);
  $('#primeiroAcessoPanel').prop('hidden', false);
  if (window.LoginExperience) {
    LoginExperience.setBotaoLoading(false);
  }
  setTimeout(() => $('#novaSenha').trigger('focus'), 50);
}

function esconderErroPrimeiroAcesso() {
  $('#primeiro-acesso-error').removeClass('is-visible').text('');
}

$('#loginForm').on('submit', function (e) {
  e.preventDefault();
  const username = $('#username').val().trim();
  const password = $('#password').val();
  salvarUltimoAcessoLogin(username, password);
  const loginStartedAt = (window.CdsObsRum && typeof window.CdsObsRum.now === 'function')
    ? window.CdsObsRum.now()
    : Date.now();

  if (window.LoginExperience) {
    LoginExperience.limparErroLogin();
    LoginExperience.setBotaoLoading(true);
  } else {
    $('#login-error').addClass('d-none').text('');
    $('#btn-entrar').prop('disabled', true);
  }

  function publicarLoginDuration(ok, errorKind) {
    try {
      if (!window.CdsObsRum || typeof window.CdsObsRum.publish !== 'function') return;
      const endedAt = window.CdsObsRum.now();
      window.CdsObsRum.publish(window.CdsObsRum.EVENT.AUTH_LOGIN_DURATION, {
        origem: 'frontend.login',
        duracao_ms: endedAt - loginStartedAt,
        resultado: ok ? 'ok' : 'erro',
        ok: !!ok,
        payload: {
          phase: 'auth_login',
          ok: !!ok,
          error_kind: ok ? undefined : String(errorKind || 'login_failed').slice(0, 40)
        }
      });
    } catch (_) { /* RUM never blocks login */ }
  }

  $.ajax({
    url: `${API_URL}/auth/login`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ username, password }),
    success: function (data) {
      salvarUltimoAcessoLogin(username, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      publicarLoginDuration(true);

      const precisaTrocar = !!(
        data.troca_senha_obrigatoria
        || (data.user && data.user.troca_senha_obrigatoria)
      );

      if (precisaTrocar) {
        mostrarPainelPrimeiroAcesso();
        return;
      }

      concluirPosLogin(data);
    },
    error: function (xhr) {
      publicarLoginDuration(false, xhr && xhr.status ? `http_${xhr.status}` : 'network');
      const msg = xhr.responseJSON && xhr.responseJSON.error
        ? xhr.responseJSON.error
        : 'Não foi possível entrar. Verifique o servidor.';

      if (window.LoginExperience) {
        LoginExperience.mostrarErroLogin(msg);
        LoginExperience.setBotaoLoading(false);
      } else {
        $('#login-error').removeClass('d-none').text(msg);
        $('#btn-entrar').prop('disabled', false);
      }
    },
    complete: function () {
      /* Botão permanece em loading no sucesso até o splash redirecionar. */
    }
  });
});

$('#primeiroAcessoForm').on('submit', function (e) {
  e.preventDefault();
  esconderErroPrimeiroAcesso();

  const nova = String($('#novaSenha').val() || '');
  const conf = String($('#confirmarSenha').val() || '');
  const token = localStorage.getItem('token') || '';

  if (nova.length < 4) {
    $('#primeiro-acesso-error').addClass('is-visible').text('Nova senha deve ter pelo menos 4 caracteres.');
    return;
  }
  if (nova !== conf) {
    $('#primeiro-acesso-error').addClass('is-visible').text('Confirmação de senha não confere.');
    return;
  }
  if (nova === '1234') {
    $('#primeiro-acesso-error').addClass('is-visible').text('Escolha uma senha diferente da senha inicial.');
    return;
  }

  $('#btn-salvar-senha').prop('disabled', true);

  $.ajax({
    url: `${API_URL}/auth/primeiro-acesso/trocar-senha`,
    method: 'POST',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    data: JSON.stringify({ nova_senha: nova, confirmar_senha: conf }),
    success: function () {
      const user = (() => {
        try {
          return JSON.parse(localStorage.getItem('user') || '{}');
        } catch (err) {
          return {};
        }
      })();
      user.troca_senha_obrigatoria = false;
      localStorage.setItem('user', JSON.stringify(user));
      // Persiste a nova senha como último acesso
      salvarUltimoAcessoLogin(
        $('#username').val() || user.username || localStorage.getItem(CDS_LOGIN_ULTIMO_USER_KEY) || '',
        nova
      );
      concluirPosLogin({ token, user });
    },
    error: function (xhr) {
      const msg = (xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.mensagem))
        || 'Não foi possível alterar a senha.';
      $('#primeiro-acesso-error').addClass('is-visible').text(msg);
      $('#btn-salvar-senha').prop('disabled', false);
    }
  });
});

function aplicarAutofillPrimeiroAcesso() {
  $.ajax({
    url: `${API_URL}/auth/primeiro-acesso`,
    method: 'GET',
    success: function (data) {
      if (loginUsuarioInteragiu || loginCampoAtivoEhFormulario()) return;
      const ultimo = obterUltimoAcessoLogin();
      if (ultimo.username) {
        carregarUltimoAcessoLogin();
        return;
      }
      if (!data || !data.primeiro_acesso) {
        carregarUltimoAcessoLogin();
        return;
      }
      if (!$('#username').val()) $('#username').val(data.username || 'admin');
      if (!$('#password').val()) $('#password').val('1234');
      if (loginUsuarioInteragiu || loginCampoAtivoEhFormulario()) return;
      const btn = document.getElementById('btn-entrar');
      const pwd = document.getElementById('password');
      const user = document.getElementById('username');
      if (user && !String(user.value || '').trim()) {
        user.focus();
      } else if (pwd && !String(pwd.value || '')) {
        pwd.focus();
      } else if (btn && typeof btn.focus === 'function' && !loginUsuarioInteragiu) {
        btn.focus();
      }
    },
    error: function () {
      if (!loginUsuarioInteragiu) carregarUltimoAcessoLogin();
    }
  });
}

function veioDeSaidaSessaoLogin() {
  try {
    const from = new URLSearchParams(window.location.search).get('from');
    return from === 'logout' || from === 'sessao';
  } catch (_) {
    return false;
  }
}

function removerOverlayResidualLogin() {
  const intro = document.getElementById('cdsIntroRoot');
  if (intro && intro.parentNode) intro.parentNode.removeChild(intro);

  const splash = document.getElementById('loginBootSplash');
  if (splash) {
    splash.hidden = true;
    splash.classList.remove('is-active');
    splash.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('.modal-backdrop, .cds-ui-loader-overlay').forEach((el) => el.remove());
  document.body.classList.remove('modal-open', 'pdv-mode', 'menu-open', 'intro-active');
  document.body.classList.add('intro-done', 'lx-ready');
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');
  document.body.style.removeProperty('pointer-events');
  document.documentElement.style.removeProperty('pointer-events');

  const shell = document.querySelector('.lx-shell');
  if (shell) shell.style.removeProperty('pointer-events');

  ['username', 'password', 'btn-entrar'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('disabled');
    el.removeAttribute('readonly');
    el.removeAttribute('aria-disabled');
    if (el.tabIndex < 0) el.tabIndex = id === 'username' ? 1 : id === 'password' ? 2 : 3;
  });
}

function focarCampoLoginPronto() {
  if (loginUsuarioInteragiu) return;
  const ativo = document.activeElement;
  if (ativo && (ativo.id === 'username' || ativo.id === 'password' || ativo.id === 'btn-entrar')) {
    return;
  }
  const user = document.getElementById('username');
  const pass = document.getElementById('password');
  const btn = document.getElementById('btn-entrar');
  if (user && !String(user.value || '').trim()) {
    user.focus();
  } else if (pass && !String(pass.value || '')) {
    pass.focus();
  } else if (btn && !loginUsuarioInteragiu) {
    btn.focus();
  }
}

function liberarTelaLogin() {
  removerOverlayResidualLogin();
  if (window.LoginExperience && typeof LoginExperience.setBotaoLoading === 'function') {
    LoginExperience.setBotaoLoading(false);
  }
  if (window.electronAPI && typeof window.electronAPI.forcarReflow === 'function') {
    window.electronAPI.forcarReflow();
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(focarCampoLoginPronto));
  } else {
    focarCampoLoginPronto();
  }
}

$(document).ready(function () {
  loginUsuarioInteragiu = false;
  carregarUltimoAcessoLogin();
  agendarRestauracaoUltimoAcessoLogin();
  aplicarAutofillPrimeiroAcesso();

  $('#username, #password, #btn-entrar').on('keydown.loginFocus input.loginFocus mousedown.loginFocus', marcarLoginUsuarioInteragiu);
  $('#username, #password').on('input change blur', lembrarCamposDigitadosLogin);
  $(window).on('pagehide beforeunload', lembrarCamposDigitadosLogin);

  if (veioDeSaidaSessaoLogin() || document.body.classList.contains('intro-done')) {
    liberarTelaLogin();
  } else if (window.IntroExperience && typeof window.IntroExperience.onComplete === 'function') {
    window.IntroExperience.onComplete(liberarTelaLogin);
  } else {
    liberarTelaLogin();
  }
});
