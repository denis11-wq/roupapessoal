// ================== CAMADA DE SEGURANÇA ==================
// Encriptação real, feita no dispositivo, com a WebCrypto do browser.
//
// Regras que este ficheiro respeita:
//  1. A palavra-passe NUNCA é guardada em lado nenhum.
//  2. A chave só existe em memória. Fecha a aba, desaparece.
//  3. O que vai para o disco (e para a nuvem, se ativares) é sempre cifrado.
//  4. Não há recuperação. Se esqueceres a palavra-passe, os dados morrem com ela.
//     Isto não é um defeito: é a única forma de ninguém além de ti conseguir ler.

const Cripto = {
  // Recomendação OWASP para PBKDF2-SHA256. O número é guardado em cada perfil,
  // por isso subi-lo no futuro não parte os dados já cifrados com o valor antigo.
  ITERACOES: 600000,
  ITERACOES_LEGADO: 210000,
  disponivel: !!(globalThis.crypto && globalThis.crypto.subtle),

  // ---------- utilitários base64 ----------
  paraB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  deB64(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  },
  aleatorio(n) { return crypto.getRandomValues(new Uint8Array(n)); },
  novoSalt() { return Cripto.paraB64(Cripto.aleatorio(16)); },

  // ---------- derivação da chave ----------
  // PBKDF2 com 210k iterações: torna a força bruta cara mesmo com a base de dados roubada.
  async derivarChave(senha, saltB64, iteracoes = Cripto.ITERACOES) {
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: Cripto.deB64(saltB64), iterations: iteracoes, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,                       // não extraível: nem o próprio código consegue lê-la
      ['encrypt', 'decrypt']
    );
  },

  // ---------- email como salt ----------
  // Um salt aleatório obrigaria o segundo dispositivo a descarregá-lo ANTES de
  // conseguir autenticar-se — e para descarregar é preciso estar autenticado.
  // Derivar o salt do email quebra esse nó: é conhecido em qualquer dispositivo
  // logo que escreves o email. Continua a cumprir o papel de salt, porque é
  // único por pessoa (é para isso que serve, não para ser secreto).
  normalizarEmail(email) { return (email || '').trim().toLowerCase(); },
  saltDeEmail(email) {
    return Cripto.paraB64(new TextEncoder().encode('roupeiro-v1:' + Cripto.normalizarEmail(email)));
  },

  // A prova que vai para o servidor. Sai da mesma palavra-passe que a chave de
  // cifra, mas por um caminho separado (salt diferente): conhecer esta não dá
  // nenhum atalho para a outra. O que o servidor guarda é o hash disto — nunca
  // a palavra-passe, nunca a chave.
  async senhaServidor(senha, email) {
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('roupeiro-auth-v1:' + Cripto.normalizarEmail(email)),
        iterations: Cripto.ITERACOES,
        hash: 'SHA-256',
      }, material, 256);
    return Cripto.paraB64(bits);
  },

  // ---------- cifrar / decifrar ----------
  // AES-GCM: além de cifrar, autentica. Se alguém adulterar um byte, a decifragem falha
  // em vez de devolver lixo silenciosamente.
  async cifrar(chave, valor) {
    const iv = Cripto.aleatorio(12);
    const dados = new TextEncoder().encode(JSON.stringify(valor === undefined ? null : valor));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, dados);
    return { v: 1, iv: Cripto.paraB64(iv), ct: Cripto.paraB64(ct) };
  },

  async decifrar(chave, pacote) {
    const claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Cripto.deB64(pacote.iv) }, chave, Cripto.deB64(pacote.ct));
    return JSON.parse(new TextDecoder().decode(claro));
  },

  // ---------- verificador de palavra-passe ----------
  // Guardamos uma frase conhecida cifrada. Se decifrar, a palavra-passe está certa.
  // Não permite descobrir a palavra-passe — só confirmá-la.
  FRASE: 'roupeiro-ok',
  async criarVerificador(chave) { return Cripto.cifrar(chave, Cripto.FRASE); },
  async validarChave(chave, verificador) {
    try { return (await Cripto.decifrar(chave, verificador)) === Cripto.FRASE; }
    catch { return false; }
  },

  // ---------- força da palavra-passe ----------
  // Heurística honesta: comprimento manda muito mais que "usar um símbolo".
  forcaSenha(senha) {
    const s = senha || '';
    if (!s) return { nivel: 0, texto: '', cor: 'var(--muted)' };
    let bits = 0;
    const variedade = (/[a-z]/.test(s) ? 26 : 0) + (/[A-Z]/.test(s) ? 26 : 0)
      + (/[0-9]/.test(s) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(s) ? 32 : 0);
    if (variedade) bits = s.length * Math.log2(variedade);
    // penaliza repetições e sequências óbvias
    if (/^(.)\1+$/.test(s)) bits *= 0.3;
    if (/1234|abcd|qwer|password|palavra|admin/i.test(s)) bits *= 0.4;

    if (s.length < 8) return { nivel: 1, texto: 'Demasiado curta (mínimo 8)', cor: 'var(--danger)' };
    if (bits < 45) return { nivel: 1, texto: 'Fraca — adivinha-se depressa', cor: 'var(--danger)' };
    if (bits < 65) return { nivel: 2, texto: 'Razoável — podias fazer melhor', cor: 'var(--warning)' };
    if (bits < 90) return { nivel: 3, texto: 'Boa', cor: 'var(--success)' };
    return { nivel: 4, texto: 'Excelente', cor: 'var(--success)' };
  },

  // sugere uma frase-passe: mais fácil de decorar e mais forte que "Xk9!p2"
  PALAVRAS: ['casaco','janela','peixe','vento','livro','pedra','nuvem','faca','relva','ponte',
             'lampada','tigre','areia','moinho','laranja','sino','barco','folha','cobre','trovao'],
  sugerirFrase() {
    const n = 4;
    const escolhidas = [];
    const idx = crypto.getRandomValues(new Uint32Array(n));
    for (let i = 0; i < n; i++) escolhidas.push(Cripto.PALAVRAS[idx[i] % Cripto.PALAVRAS.length]);
    return escolhidas.join('-') + '-' + (idx[0] % 90 + 10);
  },
};
