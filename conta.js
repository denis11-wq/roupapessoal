// ================== INTERFACE DE CONTAS ==================
// Ecrã de bloqueio, escolha de perfil, criação/edição e sincronização.

let perfilEmFoco = null;   // perfil selecionado no ecrã de bloqueio

// ---------- ecrã de perfis / bloqueio ----------
function mostrarEcraPerfis(preSelecionado) {
  perfilEmFoco = preSelecionado && preSelecionado.cifrado ? preSelecionado : null;
  document.body.classList.add('trancado');
  $('ecraBloqueio').classList.add('aberto');
  renderEcraPerfis();
  if (perfilEmFoco) setTimeout(() => $('senhaEntrada').focus(), 120);
}

function renderEcraPerfis() {
  const semCripto = !Cripto.disponivel;
  $('bloqueioAviso').style.display = semCripto ? 'block' : 'none';

  if (perfilEmFoco) {
    $('painelPerfis').style.display = 'none';
    $('painelNuvem').style.display = 'none';
    $('painelSenha').style.display = 'block';
    $('senhaPerfilNome').textContent = `${perfilEmFoco.emoji} ${perfilEmFoco.nome}`;
    $('senhaEntrada').value = '';
    $('senhaErro').style.display = 'none';
    return;
  }
  $('painelPerfis').style.display = 'block';
  $('painelSenha').style.display = 'none';
  $('painelNuvem').style.display = 'none';
  // instalação nova: não há nada para escolher, o que há a fazer é criar a conta
  $('perfisHint').textContent = Perfis.lista.length
    ? 'Escolhe a tua conta para entrar.'
    : 'Ainda não há contas neste dispositivo. Cria uma — ou traz a tua de outro.';
  $('listaPerfis').innerHTML = Perfis.lista.map(p => `
    <button class="perfil-cartao ${p.cifrado ? '' : 'por-proteger'}" data-id="${p.id}">
      <span class="perfil-avatar">${p.emoji}</span>
      <span class="perfil-info">
        <span class="perfil-nome">${esc(p.nome)}</span>
        <span class="perfil-sub">${p.cifrado ? '🔒 Protegida' : '⚠️ Falta definir palavra-passe'}</span>
      </span>
    </button>`).join('');
  $('listaPerfis').querySelectorAll('.perfil-cartao').forEach(b =>
    b.addEventListener('click', () => escolherPerfil(b.dataset.id)));
}

async function escolherPerfil(id) {
  const p = Perfis.lista.find(x => x.id === id);
  if (!p) return;
  if (p.cifrado) { perfilEmFoco = p; renderEcraPerfis(); setTimeout(() => $('senhaEntrada').focus(), 120); return; }
  // conta antiga, ainda em claro: obriga a protegê-la antes de entrar
  await protegerContaAntiga(p);
}

// Abre a base ainda em claro, lê tudo, e regrava cifrado com a palavra-passe nova.
async function protegerContaAntiga(p) {
  Perfis.atual = p;
  Perfis.chave = null;
  DB.fechar();
  await DB.abrir(Perfis.nomeBD(p.id));
  const quantas = (await DB.todos('itens')).length;

  $('msTitulo').textContent = `Proteger a conta "${p.nome}"`;
  $('msExplica').innerHTML = `Entrar com palavra-passe passou a ser <b>obrigatório</b>. `
    + (quantas ? `As tuas <b>${quantas} peças</b> não se perdem: vão ser encriptadas neste dispositivo. ` : '')
    + 'A partir daqui, sem esta palavra-passe os dados são ilegíveis — inclusive para quem tenha acesso ao teu computador.';
  $('msSenha').value = '';
  $('msSenha2').value = '';
  avaliarSenhaMudar();
  $('modalSenha').classList.add('sem-fechar');   // passo obrigatório: só sai pelo Cancelar
  abrirModal('modalSenha');
  setTimeout(() => $('msSenha').focus(), 120);
}

async function submeterSenha() {
  const senha = $('senhaEntrada').value;
  if (!senha) return;
  const btn = $('btnEntrar');
  btn.disabled = true; btn.textContent = '⏳ A verificar...';
  // a derivação é lenta de propósito — é isso que trava a força bruta
  const ok = await Perfis.desbloquear(perfilEmFoco, senha);
  if (!ok) {
    btn.disabled = false; btn.textContent = '🔓 Entrar';
    $('senhaErro').style.display = 'block';
    $('senhaEntrada').value = '';
    $('senhaEntrada').focus();
    return;
  }
  btn.textContent = '⏳ A ligar...';
  try {
    await ligarNuvemEmSilencio(perfilEmFoco, senha);
    await entrarNoPerfil(perfilEmFoco);
  } catch (e) {
    // sem isto, uma falha a abrir a base deixava o ecrã de bloqueio mudo e o
    // botão preso em "A ligar..."
    Perfis.trancar();
    toast('⚠️ Não consegui abrir este roupeiro: ' + (e && e.message ? e.message : 'erro'));
  } finally {
    btn.disabled = false; btn.textContent = '🔓 Entrar';
  }
}

// Cria a conta no servidor com a mesma identidade. Se a nuvem não estiver
// configurada ou estiver em baixo, a conta local fica na mesma — só não
// sincroniza ainda. Nunca deixo isto impedir a criação.
async function registarNaNuvem(email, senha) {
  if (!Nuvem.ativa()) return false;
  try {
    await Nuvem.registarComEmail(email, senha);
    // sem sessão imediata = o Supabase exige confirmação por email
    if (!Nuvem.ligada()) toast('📧 Confirma o email para a sincronização arrancar');
    return Nuvem.ligada();
  } catch (e) {
    // email já registado: tenta simplesmente entrar
    try { await Nuvem.entrarComEmail(email, senha); return true; }
    catch { toast('⚠️ Conta criada localmente, mas a nuvem falhou: ' + (e.message || 'erro')); return false; }
  }
}

// Abre sessão na nuvem em silêncio, com a palavra-passe que acabaste de
// escrever. É isto que faz a sincronização funcionar sem um segundo login.
async function ligarNuvemEmSilencio(perfil, senha) {
  if (!Nuvem.ativa() || !perfil.email || Nuvem.ligada()) return;
  try { await Nuvem.entrarComEmail(perfil.email, senha); }
  catch { /* offline ou conta ainda não existe no servidor: não estraga a entrada */ }
}

// ---------- trazer a conta de outro dispositivo (a partir do ecrã de entrada) ----------
let senhaNuvemEmMemoria = null;   // só durante este ecrã, para decifrar sem voltar a pedir

function mostrarPainelNuvem() {
  Nuvem.carregarCfg();
  perfilEmFoco = null;
  $('painelPerfis').style.display = 'none';
  $('painelSenha').style.display = 'none';
  $('painelNuvem').style.display = 'block';
  $('blRemotos').innerHTML = Nuvem.ativa() ? '' :
    '<p class="hint" style="color:var(--warning)">⚠️ A sincronização ainda não está configurada nesta app.</p>';
  if (Nuvem.ligada()) $('blEmail').value = Nuvem.sessao.email || '';
  setTimeout(() => $('blEmail').focus(), 120);
}

async function entrarComNuvem() {
  const btn = $('btnBlEntrarNuvem');
  if (!Nuvem.ativa()) { toast('⚠️ Sincronização não configurada'); return; }
  const email = $('blEmail').value.trim();
  const senha = $('blSenhaConta').value;
  if (!email || !senha) { toast('⚠️ Escreve o email e a palavra-passe'); return; }

  btn.disabled = true; btn.textContent = '⏳ A entrar...';
  try {
    await Nuvem.entrarComEmail(email, senha);
    senhaNuvemEmMemoria = senha;
    $('blSenhaConta').value = '';
    await listarRemotosNoBloqueio();
  } catch (e) {
    toast('⚠️ ' + (/invalid|credential|grant/i.test(String(e.message))
      ? 'Email ou palavra-passe errados' : (e.message || 'não consegui entrar')));
  } finally {
    btn.disabled = false; btn.textContent = '☁️ Entrar';
  }
}

async function listarRemotosNoBloqueio() {
  const caixa = $('blRemotos');
  caixa.innerHTML = '<p class="hint">⏳ A procurar roupeiros...</p>';
  try {
    const linhas = await Nuvem.lerRemoto(null);
    if (!linhas.length) {
      caixa.innerHTML = '<p class="hint">Esta conta ainda não tem nada na nuvem. '
        + 'Vai ao dispositivo onde tens as peças e envia-as primeiro (⚙️ → ☁️).</p>';
      return;
    }
    caixa.innerHTML = linhas.map(l => `
      <button class="perfil-cartao" data-perfil="${esc(l.perfil)}" data-nome="${esc(l.nome || '')}" data-emoji="${esc(l.emoji || '👤')}">
        <span class="perfil-avatar">${l.emoji || '👤'}</span>
        <span class="perfil-info">
          <span class="perfil-nome">${esc(l.nome || l.perfil)}</span>
          <span class="perfil-sub">⬇️ trazer · versão ${l.versao} · ${new Date(l.atualizado).toLocaleDateString('pt-PT')}</span>
        </span>
      </button>`).join('');
    // a palavra-passe é a mesma que acabaste de escrever: não a peço outra vez
    caixa.querySelectorAll('.perfil-cartao').forEach(b => b.addEventListener('click',
      () => trazerDaNuvem(b.dataset.perfil, b.dataset.nome, b.dataset.emoji, senhaNuvemEmMemoria ?? undefined)));
  } catch (e) {
    caixa.innerHTML = `<p class="hint" style="color:var(--danger)">⚠️ ${esc(e.message || 'falhou')}</p>`;
  }
}

function atualizarChipPerfil() {
  const p = Perfis.atual;
  if (!p) return;
  $('chipPerfil').innerHTML = `${p.emoji}<span class="hide-sm">${esc(p.nome)}</span>${p.cifrado ? ' 🔒' : ''}`;
  $('btnTrancar').style.display = p.cifrado ? 'inline-flex' : 'none';
}

// ---------- criar / editar perfil ----------
const EMOJIS_PERFIL = ['👤','😀','🧑','👩','👨','🧒','🐱','🐶','🌸','⚡','🎧','🍀','🔥','🌙'];

function abrirNovoPerfil() {
  $('npNome').value = '';
  $('npEmail').value = '';
  $('npSenha').value = '';
  $('npSenha2').value = '';
  $('npEmoji').innerHTML = EMOJIS_PERFIL.map((e, n) =>
    `<button type="button" class="emoji-op ${n === 0 ? 'active' : ''}" data-e="${e}">${e}</button>`).join('');
  $('npEmoji').querySelectorAll('.emoji-op').forEach(b => b.addEventListener('click', () => {
    $('npEmoji').querySelectorAll('.emoji-op').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
  avaliarSenhaNova();
  abrirModal('modalNovoPerfil');
}

function avaliarSenhaNova() {
  const f = Cripto.forcaSenha($('npSenha').value);
  const barra = $('npForca');
  barra.style.width = (f.nivel * 25) + '%';
  barra.style.background = f.cor;
  $('npForcaTexto').textContent = f.texto;
  $('npForcaTexto').style.color = f.cor;
}

async function criarPerfil() {
  const nome = $('npNome').value.trim();
  const email = $('npEmail').value.trim();
  const senha = $('npSenha').value;
  const senha2 = $('npSenha2').value;
  if (!nome) { toast('⚠️ Dá um nome à conta'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('⚠️ Escreve um email válido'); return; }
  if (Perfis.lista.some(p => p.email === Cripto.normalizarEmail(email))) {
    toast('⚠️ Já existe uma conta com esse email neste dispositivo'); return;
  }
  if (!senha) { toast('⚠️ A palavra-passe é obrigatória'); return; }
  if (senha !== senha2) { toast('⚠️ As palavras-passe não coincidem'); return; }
  if (Cripto.forcaSenha(senha).nivel < 2) { toast('⚠️ Palavra-passe demasiado fraca'); return; }
  if (!confirm('IMPORTANTE: se esqueceres esta palavra-passe, os dados desta conta são impossíveis de recuperar. Nem por mim, nem por ninguém.\n\nGuardaste-a num sítio seguro?')) return;

  const emojiAtivo = $('npEmoji').querySelector('.emoji-op.active');
  const btn = $('btnNpCriar');
  btn.disabled = true; btn.textContent = '⏳ A criar...';
  try {
    const p = await Perfis.criar({ nome, email, emoji: emojiAtivo ? emojiAtivo.dataset.e : '👤', senha });
    Perfis.chave = await Cripto.derivarChave(senha, p.salt, p.iteracoes);
    fecharModal('modalNovoPerfil');
    fecharModal('modalPerfis');

    // a mesma conta também na nuvem, para poderes usá-la noutro dispositivo
    const naNuvem = await registarNaNuvem(email, senha);
    await entrarNoPerfil(p);
    toast(naNuvem
      ? `✔ Conta "${p.nome}" criada — entra noutro dispositivo com ${email}`
      : `✔ Conta "${p.nome}" criada e encriptada neste dispositivo`);
  } catch (e) {
    toast('⚠️ ' + (e.message || 'falhou'));
  } finally {
    btn.disabled = false; btn.textContent = 'Criar conta';
  }
}

// ---------- gestão (modal de definições) ----------
function abrirGestaoPerfis() {
  const listaHtml = Perfis.lista.map(p => `
    <div class="perfil-linha">
      <span class="perfil-avatar sm">${p.emoji}</span>
      <span class="perfil-info">
        <span class="perfil-nome">${esc(p.nome)}${p.id === (Perfis.atual || {}).id ? ' <span class="chip-mini">atual</span>' : ''}</span>
        <span class="perfil-sub">${p.cifrado ? '🔒 Protegido' : '🔓 Sem palavra-passe'} · criado em ${p.criado}</span>
      </span>
      ${p.id === (Perfis.atual || {}).id
        ? `<button class="btn btn-secondary btn-sm" data-acao="senha" data-id="${p.id}">🔑 Palavra-passe</button>`
        : `<button class="btn btn-secondary btn-sm" data-acao="trocar" data-id="${p.id}">Entrar</button>`}
      ${Perfis.lista.length > 1 ? `<button class="btn btn-danger btn-sm" data-acao="apagar" data-id="${p.id}">🗑️</button>` : ''}
    </div>`).join('');
  $('listaGestaoPerfis').innerHTML = listaHtml;
  $('listaGestaoPerfis').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => acaoPerfil(b.dataset.acao, b.dataset.id)));
  abrirModal('modalPerfis');
}

async function acaoPerfil(acao, id) {
  const p = Perfis.lista.find(x => x.id === id);
  if (!p) return;
  if (acao === 'trocar') {
    fecharModal('modalPerfis');
    Perfis.trancar();
    DB.fechar();
    if (p.cifrado) { perfilEmFoco = p; mostrarEcraPerfis(p); }
    else { Perfis.chave = null; await entrarNoPerfil(p); }
  } else if (acao === 'apagar') {
    if (!confirm(`Apagar o perfil "${p.nome}" e TODAS as suas peças, outfits e histórico?\n\nIsto não pode ser desfeito.`)) return;
    if (!confirm('Última confirmação. Exportaste um backup deste perfil?')) return;
    await Perfis.apagar(id);
    toast(`🗑️ Perfil "${p.nome}" apagado`);
    if ((Perfis.atual || {}).id === id) { await Perfis.carregar(); trancarApp(); }
    else abrirGestaoPerfis();
  } else if (acao === 'senha') {
    abrirMudarSenha();
  }
}

function abrirMudarSenha() {
  $('msTitulo').textContent = 'Mudar palavra-passe';
  $('msExplica').innerHTML = 'Vou decifrar tudo com a chave atual e voltar a cifrar com a nova. '
    + 'Pode demorar uns segundos se tiveres muitas fotos.';
  $('msSenha').value = '';
  $('msSenha2').value = '';
  avaliarSenhaMudar();
  $('modalSenha').classList.remove('sem-fechar');  // mudança voluntária: pode cancelar-se
  fecharModal('modalPerfis');
  abrirModal('modalSenha');
}

function avaliarSenhaMudar() {
  const f = Cripto.forcaSenha($('msSenha').value);
  $('msForca').style.width = (f.nivel * 25) + '%';
  $('msForca').style.background = f.cor;
  $('msForcaTexto').textContent = f.texto;
  $('msForcaTexto').style.color = f.cor;
}

async function aplicarMudancaSenha() {
  const senha = $('msSenha').value;
  if (senha !== $('msSenha2').value) { toast('⚠️ As palavras-passe não coincidem'); return; }
  if (Cripto.forcaSenha(senha).nivel < 2) { toast('⚠️ Palavra-passe demasiado fraca'); return; }
  if (!confirm('IMPORTANTE: se esqueceres esta palavra-passe, os dados desta conta ficam irrecuperáveis. Não há "esqueci-me da palavra-passe".\n\nGuardaste-a num sítio seguro?')) return;

  const eraEmClaro = !Perfis.atual.cifrado;
  const btn = $('btnMsGuardar');
  btn.disabled = true; btn.textContent = '⏳ A cifrar tudo...';
  try {
    await Perfis.mudarSenha(Perfis.atual, senha);
    fecharModal('modalSenha');
    // o que está na nuvem ficou cifrado com a chave antiga: tem de ser reenviado
    Nuvem.agendar();
    if (eraEmClaro) await entrarNoPerfil(Perfis.atual);   // acabou de proteger: entra já
    else atualizarChipPerfil();
    toast('🔒 Conta protegida e encriptada');
  } catch (e) {
    toast('⚠️ Falhou: ' + (e.message || 'erro'));
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

// ---------- eventos ----------
function ligarEventosConta() {
  $('btnEntrar').addEventListener('click', submeterSenha);
  $('senhaEntrada').addEventListener('keydown', e => { if (e.key === 'Enter') submeterSenha(); });
  $('btnVoltarPerfis').addEventListener('click', () => { perfilEmFoco = null; renderEcraPerfis(); });
  $('btnNovoPerfilBloqueio').addEventListener('click', abrirNovoPerfil);
  $('btnEntrarNuvem').addEventListener('click', mostrarPainelNuvem);
  $('btnBlVoltar').addEventListener('click', () => { perfilEmFoco = null; renderEcraPerfis(); });
  $('btnBlEntrarNuvem').addEventListener('click', entrarComNuvem);
  $('blSenhaConta').addEventListener('keydown', e => { if (e.key === 'Enter') entrarComNuvem(); });
  $('btnTrancar').addEventListener('click', trancarApp);
  $('chipPerfil').addEventListener('click', abrirGestaoPerfis);

  $('btnGerirPerfis').addEventListener('click', () => { fecharModal('modalDefinicoes'); abrirGestaoPerfis(); });
  $('btnPerfisFechar').addEventListener('click', () => fecharModal('modalPerfis'));
  $('btnNovoPerfil').addEventListener('click', abrirNovoPerfil);
  $('btnNpCancelar').addEventListener('click', () => fecharModal('modalNovoPerfil'));
  $('btnNpCriar').addEventListener('click', criarPerfil);
  $('npSenha').addEventListener('input', avaliarSenhaNova);
  $('btnNpSugerir').addEventListener('click', () => {
    const f = Cripto.sugerirFrase();
    $('npSenha').value = f; $('npSenha2').value = f;
    avaliarSenhaNova();
    toast('🎲 Frase gerada — copia-a para um sítio seguro AGORA');
  });

  // proteger uma conta antiga não é opcional: cancelar volta ao ecrã de contas
  $('btnMsCancelar').addEventListener('click', () => {
    fecharModal('modalSenha');
    // desistir de proteger tem de largar mesmo a conta: ficar com a base aberta
    // em claro e Perfis.atual preenchido por trás do ecrã de bloqueio é pior
    if (Perfis.atual && !Perfis.atual.cifrado) {
      Perfis.trancar();
      DB.fechar();
      perfilEmFoco = null;
      mostrarEcraPerfis(null);
    }
  });
  $('btnMsGuardar').addEventListener('click', () => aplicarMudancaSenha());
  $('msSenha').addEventListener('input', avaliarSenhaMudar);
  $('msSenha2').addEventListener('keydown', e => { if (e.key === 'Enter') aplicarMudancaSenha(); });

  $('btnNuvem').addEventListener('click', abrirNuvem);
  $('btnNuvemFechar').addEventListener('click', () => fecharModal('modalNuvem'));
  Nuvem.ligarEventos();
}
