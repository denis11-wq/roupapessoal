// ================== SINCRONIZAÇÃO NA NUVEM ==================
// Opcional, desligada por omissão. Usa a API REST do Supabase com fetch puro —
// sem bibliotecas, sem SDKs, sem scripts de terceiros.
//
// O QUE O SERVIDOR VÊ:  o teu email, e um bloco de texto cifrado.
// O QUE O SERVIDOR NÃO VÊ:  nem uma peça, nem uma foto, nem um nome.
//
// A cifra acontece AQUI, antes de qualquer pedido sair do dispositivo. A chave
// vem da palavra-passe do perfil, que nunca é enviada. Por isso a palavra-passe
// da CONTA (autenticação) tem de ser diferente da palavra-passe do PERFIL (cifra):
// se fossem iguais, quem gerisse o servidor conseguiria derivar a chave.

// Preenche isto UMA vez e todos os dispositivos que abram esta app já vêm
// ligados — não é preciso reconfigurar nada em cada telemóvel ou computador.
// (A chave anon é pública por design: quem manda é o RLS do lado do servidor.)
const NUVEM_PADRAO = {
  url: 'https://xdanntvncnoootzgvvvd.supabase.co',
  anonKey: 'sb_publishable_YuYT22nXNz8ak-Ouovbejg_ZOqONL_H',
};

const Nuvem = {
  cfg: null,        // { url, anonKey }
  sessao: null,     // { access_token, refresh_token, email }

  // ---------- configuração ----------
  carregarCfg() {
    try { Nuvem.cfg = JSON.parse(localStorage.getItem('nuvemCfg') || 'null'); } catch { Nuvem.cfg = null; }
    // sem configuração local, usa a que vem com a app
    if ((!Nuvem.cfg || !Nuvem.cfg.url) && NUVEM_PADRAO.url) Nuvem.cfg = { ...NUVEM_PADRAO };
    try { Nuvem.sessao = JSON.parse(localStorage.getItem('nuvemSessao') || 'null'); } catch { Nuvem.sessao = null; }
    return Nuvem.cfg;
  },

  // ---------- entrar com email + palavra-passe ----------
  // A palavra-passe nunca sai daqui: o que vai para o servidor é uma prova
  // derivada dela por um caminho separado do da chave de cifra.
  async entrarComEmail(email, senha) {
    return Nuvem.entrar(Cripto.normalizarEmail(email), await Cripto.senhaServidor(senha, email));
  },
  async registarComEmail(email, senha) {
    return Nuvem.registar(Cripto.normalizarEmail(email), await Cripto.senhaServidor(senha, email));
  },
  guardarCfg(cfg) {
    Nuvem.cfg = cfg;
    localStorage.setItem('nuvemCfg', JSON.stringify(cfg));
  },
  guardarSessao(s) {
    Nuvem.sessao = s;
    if (s) localStorage.setItem('nuvemSessao', JSON.stringify(s));
    else localStorage.removeItem('nuvemSessao');
  },
  ativa() { return !!(Nuvem.cfg && Nuvem.cfg.url && Nuvem.cfg.anonKey); },
  ligada() { return !!(Nuvem.ativa() && Nuvem.sessao && Nuvem.sessao.access_token); },

  // ---------- pedidos ----------
  async pedir(caminho, opcoes = {}) {
    if (!Nuvem.ativa()) throw new Error('Nuvem não configurada');
    const cabecalhos = {
      'apikey': Nuvem.cfg.anonKey,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    };
    if (Nuvem.sessao && Nuvem.sessao.access_token && !opcoes.semAuth)
      cabecalhos['Authorization'] = 'Bearer ' + Nuvem.sessao.access_token;

    const r = await fetch(Nuvem.cfg.url.replace(/\/$/, '') + caminho, { ...opcoes, headers: cabecalhos });
    const texto = await r.text();
    let corpo = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = texto; }
    if (!r.ok) {
      const msg = (corpo && (corpo.msg || corpo.message || corpo.error_description || corpo.error)) || r.status;
      throw new Error(msg);
    }
    return corpo;
  },

  // ---------- autenticação ----------
  async registar(email, senha) {
    const d = await Nuvem.pedir('/auth/v1/signup', {
      method: 'POST', semAuth: true,
      body: JSON.stringify({ email, password: senha }),
    });
    if (d && d.access_token) Nuvem.guardarSessao({ access_token: d.access_token, refresh_token: d.refresh_token, email });
    return d;
  },
  async entrar(email, senha) {
    const d = await Nuvem.pedir('/auth/v1/token?grant_type=password', {
      method: 'POST', semAuth: true,
      body: JSON.stringify({ email, password: senha }),
    });
    Nuvem.guardarSessao({ access_token: d.access_token, refresh_token: d.refresh_token, email });
    return d;
  },
  async renovar() {
    if (!Nuvem.sessao || !Nuvem.sessao.refresh_token) return false;
    try {
      const d = await Nuvem.pedir('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', semAuth: true,
        body: JSON.stringify({ refresh_token: Nuvem.sessao.refresh_token }),
      });
      Nuvem.guardarSessao({ access_token: d.access_token, refresh_token: d.refresh_token, email: Nuvem.sessao.email });
      return true;
    } catch { return false; }
  },
  sair() { Nuvem.guardarSessao(null); },

  // tenta o pedido; se o token expirou, renova uma vez e repete
  async comSessao(fn) {
    try { return await fn(); }
    catch (e) {
      if (!/JWT|token|401|expired/i.test(String(e.message))) throw e;
      if (!await Nuvem.renovar()) throw new Error('Sessão expirada — entra outra vez');
      return fn();
    }
  },

  // ---------- dados ----------
  // `comBlob` decide se o roupeiro inteiro vem no pedido. Por omissão NÃO vem:
  // quase todas as leituras só querem saber o número da versão, e arrastar
  // megabytes de fotos para comparar um inteiro é desperdício puro de quota.
  async lerRemoto(perfilId, comBlob = false) {
    const filtro = perfilId ? `&perfil=eq.${encodeURIComponent(perfilId)}` : '';
    const campos = 'perfil,nome,emoji,salt,iteracoes,verificador,versao,atualizado'
      + (comBlob && perfilId ? ',blob' : '');
    const linhas = await Nuvem.comSessao(() =>
      Nuvem.pedir(`/rest/v1/roupeiros?select=${campos}${filtro}`));
    return linhas || [];
  },

  async enviar(perfil, forcar) {
    if (!Perfis.chave)
      throw new Error('Este perfil não tem palavra-passe. Protege-o primeiro — não envio dados sem cifra.');

    const versaoLocal = (await DB.metaGet('nuvemVersao')) || 0;
    const remotos = await Nuvem.lerRemoto(perfil.id);   // só a versão, sem o blob
    const remoto = remotos[0];
    if (remoto && remoto.versao > versaoLocal && !forcar)
      return { conflito: true, remoto };

    const dados = await DB.exportarBruto();
    const pacote = await Cripto.cifrar(Perfis.chave, dados);
    const linha = {
      perfil: perfil.id,
      nome: perfil.nome,
      emoji: perfil.emoji,
      salt: perfil.salt,
      iteracoes: perfil.iteracoes || Cripto.ITERACOES,
      verificador: perfil.verificador,
      blob: JSON.stringify(pacote),
      versao: Math.max(versaoLocal, remoto ? remoto.versao : 0) + 1,
      atualizado: new Date().toISOString(),
    };
    await Nuvem.comSessao(() => Nuvem.pedir('/rest/v1/roupeiros', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(linha),
    }));
    await DB.por('meta', linha.versao, 'nuvemVersao');
    Nuvem.limparPendente(perfil.id);
    return { versao: linha.versao, tamanho: linha.blob.length };
  },

  // ---------- alterações por enviar ----------
  // Sem isto, ao trazer uma versão mais recente da nuvem eu não saberia se estava
  // a apagar trabalho feito offline neste dispositivo.
  chavePendente(id) { return 'nuvemPendente:' + id; },
  marcarPendente(id) { try { localStorage.setItem(Nuvem.chavePendente(id), '1'); } catch {} },
  limparPendente(id) { try { localStorage.removeItem(Nuvem.chavePendente(id)); } catch {} },
  temPendente(id) { try { return localStorage.getItem(Nuvem.chavePendente(id)) === '1'; } catch { return false; } },

  // Traz o perfil da nuvem. Precisa da palavra-passe do perfil para decifrar —
  // o servidor entrega o bloco, mas só este dispositivo o consegue abrir.
  async receber(perfilId, senha) {
    const linhas = await Nuvem.lerRemoto(perfilId, true);
    if (!linhas.length) throw new Error('Não há nada na nuvem para este perfil');
    const r = linhas[0];
    const chave = await Cripto.derivarChave(senha, r.salt, r.iteracoes || Cripto.ITERACOES_LEGADO);
    if (!await Cripto.validarChave(chave, r.verificador))
      throw new Error('Palavra-passe errada para este perfil');

    let dados;
    try { dados = await Cripto.decifrar(chave, JSON.parse(r.blob)); }
    catch { throw new Error('O bloco veio corrompido — não consegui decifrar'); }
    return { dados, chave, linha: r };
  },
};

// ---------- sincronização automática ----------
// Sem isto, "não perder dados" depende de te lembrares de carregar num botão.
// Guardar uma peça marca o perfil como sujo e agenda um envio daí a 25 s.
Nuvem.temporizador = null;
Nuvem.aSincronizar = false;
Nuvem.agendar = function () {
  // marca-se sempre, mesmo sem nuvem ligada: se ligares mais tarde, eu sei que
  // este dispositivo tem alterações que ainda não subiram
  if (Perfis.atual) Nuvem.marcarPendente(Perfis.atual.id);
  if (!Nuvem.ligada() || !Perfis.chave || !Perfis.atual || Nuvem.aSincronizar) return;
  clearTimeout(Nuvem.temporizador);
  Nuvem.temporizador = setTimeout(() => Nuvem.sincronizarAgora(true), 25000);
};
Nuvem.sincronizarAgora = async function (silencioso) {
  if (!Nuvem.ligada() || !Perfis.chave || Nuvem.aSincronizar) return;
  Nuvem.aSincronizar = true;                       // evita que o próprio envio se reagende
  try {
    const r = await Nuvem.enviar(Perfis.atual, false);
    if (r.conflito) { if (!silencioso) toast('⚠️ A nuvem tem uma versão mais recente — abre ⚙️ → ☁️'); }
    else if (!silencioso) toast(`☁️ Guardado na nuvem (versão ${r.versao})`);
    else marcarEstadoNuvem('ok');
  } catch (e) {
    if (!silencioso) toast('⚠️ ' + (e.message || 'falhou'));
    else marcarEstadoNuvem('erro');
  } finally {
    Nuvem.aSincronizar = false;
  }
};

// ---------- descarga automática ----------
// É isto que faz "a minha conta noutro dispositivo" funcionar de verdade: ao
// entrares, se outro dispositivo guardou uma versão mais recente, ela vem para cá.
// A chave já está em memória (acabaste de escrever a palavra-passe), por isso
// não é preciso perguntar nada.
Nuvem.puxarSeMaisRecente = async function () {
  if (!Nuvem.ligada() || !Perfis.chave || !Perfis.atual) return false;
  const perfil = Perfis.atual;
  try {
    const versaoLocal = (await DB.metaGet('nuvemVersao')) || 0;
    // primeiro só a versão: na esmagadora maioria das entradas não há nada novo
    // e o pedido fica em bytes em vez de megabytes
    const cabecalho = (await Nuvem.lerRemoto(perfil.id))[0];
    if (!cabecalho || cabecalho.versao <= versaoLocal) return false;

    // conflito real: este dispositivo tem alterações que nunca subiram
    if (Nuvem.temPendente(perfil.id)) {
      const quando = new Date(cabecalho.atualizado).toLocaleString('pt-PT');
      const trazer = confirm(
        `A nuvem tem uma versão mais recente (${quando}, versão ${cabecalho.versao}), mas este dispositivo `
        + `também tem alterações que nunca chegaram a subir.\n\n`
        + `OK = ficar com a versão da nuvem (perdes as alterações locais)\n`
        + `Cancelar = manter este dispositivo e enviá-lo por cima`);
      if (!trazer) { await Nuvem.sincronizarAgora(false); return false; }
    }

    // só agora é que vale a pena descarregar o roupeiro inteiro
    const r = (await Nuvem.lerRemoto(perfil.id, true))[0];
    if (!r || !r.blob) return false;
    const dados = await Cripto.decifrar(Perfis.chave, JSON.parse(r.blob));
    await DB.importarBruto(dados);
    await DB.por('meta', r.versao, 'nuvemVersao');
    Nuvem.limparPendente(perfil.id);
    await recarregarDados();
    renderTudo();
    marcarEstadoNuvem('ok');
    toast(`⬇️ Atualizado a partir de outro dispositivo (versão ${r.versao})`);
    return true;
  } catch (e) {
    // offline ou sessão expirada não é motivo para bloquear a entrada
    marcarEstadoNuvem('erro');
    return false;
  }
};

// pequeno indicador no cabeçalho, para saberes se está mesmo guardado
function marcarEstadoNuvem(estado) {
  const el = document.getElementById('estadoNuvem');
  if (!el) return;
  el.style.display = 'inline-flex';
  el.textContent = estado === 'ok' ? '☁️' : '⚠️';
  el.title = estado === 'ok'
    ? 'Cópia cifrada guardada na nuvem'
    : 'Falhou o envio para a nuvem — os dados estão seguros neste dispositivo';
  el.className = 'btn btn-icon nuvem-estado ' + estado;
}

// ================== INTERFACE DA NUVEM ==================
function abrirNuvem() {
  Nuvem.carregarCfg();
  $('nvUrl').value = (Nuvem.cfg && Nuvem.cfg.url) || '';
  $('nvChave').value = (Nuvem.cfg && Nuvem.cfg.anonKey) || '';
  atualizarEstadoNuvem();
  fecharModal('modalDefinicoes');
  abrirModal('modalNuvem');
}

function atualizarEstadoNuvem() {
  const configurada = Nuvem.ativa();
  const ligada = Nuvem.ligada();
  $('nvPassoConfig').open = !configurada;
  $('nvSecaoConta').style.display = configurada ? 'block' : 'none';
  $('nvSecaoSync').style.display = ligada ? 'block' : 'none';
  $('nvEstado').innerHTML = !configurada
    ? '<span class="chip">⚙️ Por configurar</span>'
    : ligada
      ? `<span class="chip" style="border-color:var(--success)">✅ Ligado como ${esc(Nuvem.sessao.email)}</span>`
      : '<span class="chip" style="border-color:var(--warning)">🔌 Configurado, sessão fechada</span>';

  const p = Perfis.atual;
  $('nvAvisoCifra').style.display = (p && !p.cifrado) ? 'block' : 'none';
  $('btnNvEnviar').disabled = !(p && p.cifrado);
}

async function comBotao(btn, texto, fn) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = texto;
  try { await fn(); }
  catch (e) { toast('⚠️ ' + (e.message || 'falhou')); }
  finally { btn.disabled = false; btn.textContent = original; }
}

Nuvem.ligarEventos = function () {
  $('btnNvGuardarCfg').addEventListener('click', () => {
    const url = $('nvUrl').value.trim().replace(/\/$/, '');
    const chave = $('nvChave').value.trim();
    if (!/^https:\/\/.+\.supabase\.co$/.test(url)) { toast('⚠️ URL inválido (deve ser https://xxx.supabase.co)'); return; }
    if (chave.length < 30) { toast('⚠️ Chave anon parece inválida'); return; }
    Nuvem.guardarCfg({ url, anonKey: chave });
    atualizarEstadoNuvem();
    toast('✔ Ligação guardada');
  });


  $('btnNvRegistar').addEventListener('click', () => comBotao($('btnNvRegistar'), '⏳...', async () => {
    const email = $('nvEmail').value.trim(), senha = $('nvSenhaConta').value;
    if (!email || senha.length < 8) { toast('⚠️ Email e palavra-passe (8+) obrigatórios'); return; }
    const d = await Nuvem.registarComEmail(email, senha);
    atualizarEstadoNuvem();
    toast(d && d.access_token ? '✔ Conta criada e sessão iniciada' : '📧 Conta criada — confirma o email e depois entra');
  }));

  $('btnNvEntrar').addEventListener('click', () => comBotao($('btnNvEntrar'), '⏳...', async () => {
    await Nuvem.entrarComEmail($('nvEmail').value.trim(), $('nvSenhaConta').value);
    atualizarEstadoNuvem();
    toast('✔ Sessão iniciada');
  }));

  $('btnNvSair').addEventListener('click', () => { Nuvem.sair(); atualizarEstadoNuvem(); toast('Sessão fechada'); });

  $('btnNvEnviar').addEventListener('click', () => comBotao($('btnNvEnviar'), '⏳ A cifrar e enviar...', async () => {
    let r = await Nuvem.enviar(Perfis.atual, false);
    if (r.conflito) {
      const quando = new Date(r.remoto.atualizado).toLocaleString('pt-PT');
      if (!confirm(`A nuvem tem uma versão MAIS RECENTE (guardada em ${quando}, versão ${r.remoto.versao}).\n\nSe continuares, substituis essa versão pela deste dispositivo e perdes o que lá está.\n\nContinuar mesmo assim?`)) return;
      r = await Nuvem.enviar(Perfis.atual, true);
    }
    toast(`☁️ Enviado cifrado (${(r.tamanho / 1048576).toFixed(1)} MB, versão ${r.versao})`);
  }));

  $('btnNvListar').addEventListener('click', () => comBotao($('btnNvListar'), '⏳...', async () => {
    const linhas = await Nuvem.lerRemoto(null);
    $('nvRemotos').innerHTML = linhas.length ? linhas.map(l => `
      <div class="perfil-linha">
        <span class="perfil-avatar sm">${l.emoji || '👤'}</span>
        <span class="perfil-info">
          <span class="perfil-nome">${esc(l.nome || l.perfil)}</span>
          <span class="perfil-sub">versão ${l.versao} · ${new Date(l.atualizado).toLocaleString('pt-PT')}</span>
        </span>
        <button class="btn btn-primary btn-sm" data-perfil="${esc(l.perfil)}" data-nome="${esc(l.nome || '')}" data-emoji="${esc(l.emoji || '👤')}">⬇️ Trazer</button>
      </div>`).join('') : '<p class="hint">Nada na nuvem ainda. Envia primeiro a partir de um dispositivo.</p>';
    $('nvRemotos').querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => trazerDaNuvem(b.dataset.perfil, b.dataset.nome, b.dataset.emoji)));
  }));
};

// Traz um perfil da nuvem para ESTE dispositivo. Se já existir localmente,
// substitui; se não, cria um perfil novo com o mesmo salt (para a mesma
// palavra-passe continuar a servir).
// `senhaSabida` chega preenchida quando vens do ecrã de entrada — aí já
// escreveste a palavra-passe e não faz sentido pedi-la outra vez.
async function trazerDaNuvem(perfilId, nome, emoji, senhaSabida) {
  let senha = senhaSabida !== undefined ? senhaSabida
    : prompt(`Palavra-passe do roupeiro "${nome || perfilId}"`);
  if (senha === null) return;
  try {
    toast('⏳ A descarregar e decifrar...');
    let recebido;
    try {
      recebido = await Nuvem.receber(perfilId, senha);
    } catch (e) {
      // contas antigas foram cifradas com uma palavra-passe diferente da do
      // servidor: aí, e só aí, ainda é preciso perguntar
      if (senhaSabida === undefined || !/errada/i.test(String(e.message))) throw e;
      senha = prompt(`Este roupeiro foi criado com uma palavra-passe própria.\n\nPalavra-passe do roupeiro "${nome || perfilId}":`);
      if (senha === null) return;
      recebido = await Nuvem.receber(perfilId, senha);
    }
    const { dados, chave, linha } = recebido;

    let local = Perfis.lista.find(p => p.id === perfilId);
    if (local) {
      if (!confirm(`Já tens o perfil "${local.nome}" neste dispositivo.\n\nSubstituir os dados locais pelos da nuvem?`)) return;
      local.salt = linha.salt; local.iteracoes = linha.iteracoes; local.verificador = linha.verificador; local.cifrado = true;
      local.nome = linha.nome || local.nome; local.emoji = linha.emoji || local.emoji;
      local.email = local.email || (Nuvem.sessao && Nuvem.sessao.email) || null;
      await Perfis.gravar(local);
    } else {
      local = {
        id: perfilId, nome: linha.nome || 'Importado', emoji: linha.emoji || '👤',
        email: (Nuvem.sessao && Nuvem.sessao.email) || null,
        cifrado: true, salt: linha.salt, iteracoes: linha.iteracoes, verificador: linha.verificador,
        criado: hojeStr(),
      };
      await Perfis.gravar(local);
      Perfis.lista.push(local);
    }

    Perfis.trancar();
    Perfis.atual = local;
    Perfis.chave = chave;
    DB.fechar();
    await DB.abrir(Perfis.nomeBD(local.id));
    await DB.importarBruto(dados);
    await DB.por('meta', linha.versao, 'nuvemVersao');
    Nuvem.limparPendente(local.id);   // acabou de chegar da nuvem: não há nada por enviar
    await entrarNoPerfil(local);

    fecharModal('modalNuvem');
    toast(`⬇️ "${local.nome}" trazido da nuvem: ${itens.length} peças`);
  } catch (e) {
    toast('⚠️ ' + (e.message || 'falhou'));
  }
}
