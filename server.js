// Servidor local minimo (sem dependencias). Correr: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTA = 8000;
const RAIZ = __dirname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const ficheiro = path.join(RAIZ, rel);
  // nao deixar sair da pasta do projeto
  if (!ficheiro.startsWith(RAIZ)) {
    res.writeHead(403).end('Proibido');
    return;
  }

  fs.readFile(ficheiro, (err, dados) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado: ' + rel);
      return;
    }
    const tipo = TIPOS[path.extname(ficheiro).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
    res.end(dados);
  });
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`Roupeiro a correr em http://localhost:${PORTA}`);
  console.log('Ctrl+C para parar.');
});
