import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    const n = length | 0x8000;
    return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
  }
  if (length < 0x200000) {
    const n = length | 0xC00000;
    return Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  }
  if (length < 0x10000000) {
    const n = (length | 0xE0000000) >>> 0;
    return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }
  return Buffer.from([0xF0, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]);
}

function encodeWord(word) {
  const body = Buffer.from(String(word), 'utf8');
  return Buffer.concat([encodeLength(body.length), body]);
}

function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

class SentenceDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.sentence = [];
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const sentences = [];
    let offset = 0;

    while (offset < this.buffer.length) {
      const decoded = this.#readLength(offset);
      if (!decoded) break;
      const { length, bytes } = decoded;
      if (this.buffer.length < offset + bytes + length) break;
      offset += bytes;
      if (length === 0) {
        sentences.push(this.sentence);
        this.sentence = [];
        continue;
      }
      this.sentence.push(this.buffer.subarray(offset, offset + length).toString('utf8'));
      offset += length;
    }

    this.buffer = this.buffer.subarray(offset);
    // Uma resposta completa da API sempre termina a sentença. Se sobrar uma
    // sentença parcial, ela ainda está no buffer e será reconstruída no próximo push.
    return sentences;
  }

  #readLength(offset) {
    if (offset >= this.buffer.length) return null;
    const b0 = this.buffer[offset];
    if ((b0 & 0x80) === 0) return { length: b0, bytes: 1 };
    if ((b0 & 0xC0) === 0x80) {
      if (offset + 2 > this.buffer.length) return null;
      return { length: ((b0 & 0x3F) << 8) | this.buffer[offset + 1], bytes: 2 };
    }
    if ((b0 & 0xE0) === 0xC0) {
      if (offset + 3 > this.buffer.length) return null;
      return { length: ((b0 & 0x1F) << 16) | (this.buffer[offset + 1] << 8) | this.buffer[offset + 2], bytes: 3 };
    }
    if ((b0 & 0xF0) === 0xE0) {
      if (offset + 4 > this.buffer.length) return null;
      const length = (((b0 & 0x0F) * 0x1000000) + (this.buffer[offset + 1] << 16) + (this.buffer[offset + 2] << 8) + this.buffer[offset + 3]);
      return { length, bytes: 4 };
    }
    if (b0 === 0xF0) {
      if (offset + 5 > this.buffer.length) return null;
      const length = this.buffer.readUInt32BE(offset + 1);
      return { length, bytes: 5 };
    }
    throw new Error(`RouterOS API: byte de controle não suportado 0x${b0.toString(16)}`);
  }
}

function parseSentence(words) {
  const type = words[0] || '';
  const attrs = {};
  for (const word of words.slice(1)) {
    if (word.startsWith('=')) {
      const second = word.indexOf('=', 1);
      if (second > 1) attrs[word.slice(1, second)] = word.slice(second + 1);
    } else if (word.startsWith('.')) {
      const eq = word.indexOf('=');
      if (eq > 0) attrs[word.slice(0, eq)] = word.slice(eq + 1);
    }
  }
  return { type, attrs, words };
}

function attrWords(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `=${key}=${String(value)}`);
}

function normalizeTrap(sentence) {
  const message = sentence?.attrs?.message || sentence?.attrs?.category || 'RouterOS recusou o comando';
  const error = new Error(message);
  error.routeros = sentence;
  return error;
}

export class RouterOSApiClient {
  constructor({ host, port, username, password, useTls = false, rejectUnauthorized = true, timeoutMs = 5000 }) {
    this.host = host;
    this.port = Number(port || (useTls ? 8729 : 8728));
    this.username = username;
    this.password = password;
    this.useTls = Boolean(useTls);
    this.rejectUnauthorized = Boolean(rejectUnauthorized);
    this.timeoutMs = Number(timeoutMs || 5000);
  }

  async command(command, attrs = {}, queries = []) {
    const socket = await this.#connect();
    try {
      const reader = this.#makeReader(socket);
      await this.#login(socket, reader);
      socket.write(encodeSentence([command, ...attrWords(attrs), ...queries]));
      const rows = [];
      while (true) {
        const parsed = parseSentence(await reader.next());
        if (parsed.type === '!re') rows.push(parsed.attrs);
        else if (parsed.type === '!trap' || parsed.type === '!fatal') throw normalizeTrap(parsed);
        else if (parsed.type === '!done') return { rows, done: parsed.attrs };
      }
    } finally {
      socket.destroy();
    }
  }

  async #connect() {
    const options = { host: this.host, port: this.port };
    const socket = this.useTls
      ? tls.connect({ ...options, rejectUnauthorized: this.rejectUnauthorized, servername: net.isIP(this.host) ? undefined : this.host })
      : net.createConnection(options);

    socket.setTimeout(this.timeoutMs);
    return await new Promise((resolve, reject) => {
      const event = this.useTls ? 'secureConnect' : 'connect';
      const cleanup = () => {
        socket.off(event, onConnect);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
      };
      const onConnect = () => { cleanup(); resolve(socket); };
      const onError = error => { cleanup(); socket.destroy(); reject(error); };
      const onTimeout = () => { cleanup(); socket.destroy(); reject(new Error(`Timeout conectando à MikroTik ${this.host}:${this.port}`)); };
      socket.once(event, onConnect);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
    });
  }

  #makeReader(socket) {
    const decoder = new SentenceDecoder();
    const queue = [];
    const waiters = [];
    let terminalError = null;

    const flush = sentence => {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(sentence);
      else queue.push(sentence);
    };
    socket.on('data', chunk => {
      try { decoder.push(chunk).forEach(flush); }
      catch (error) {
        terminalError = error;
        while (waiters.length) waiters.shift().reject(error);
      }
    });
    socket.on('error', error => {
      terminalError = error;
      while (waiters.length) waiters.shift().reject(error);
    });
    socket.on('timeout', () => {
      terminalError = new Error('Timeout aguardando resposta da MikroTik');
      while (waiters.length) waiters.shift().reject(terminalError);
      socket.destroy();
    });
    socket.on('close', () => {
      if (!terminalError) terminalError = new Error('Conexão com a MikroTik foi encerrada');
      while (waiters.length) waiters.shift().reject(terminalError);
    });

    return {
      next: () => {
        if (queue.length) return Promise.resolve(queue.shift());
        if (terminalError) return Promise.reject(terminalError);
        return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      }
    };
  }

  async #login(socket, reader) {
    // RouterOS 6.43+ aceita usuário/senha diretamente. Mantemos fallback para
    // o desafio MD5 legado para facilitar testes com versões v6 antigas.
    socket.write(encodeSentence(['/login', `=name=${this.username}`, `=password=${this.password}`]));
    let response = parseSentence(await reader.next());
    if (response.type === '!trap' || response.type === '!fatal') throw normalizeTrap(response);
    if (response.type !== '!done') {
      while (response.type !== '!done') response = parseSentence(await reader.next());
    }
    if (!response.attrs.ret) return;

    const challenge = Buffer.from(response.attrs.ret, 'hex');
    const digest = crypto.createHash('md5')
      .update(Buffer.concat([Buffer.from([0]), Buffer.from(this.password, 'utf8'), challenge]))
      .digest('hex');
    socket.write(encodeSentence(['/login', `=name=${this.username}`, `=response=00${digest}`]));
    response = parseSentence(await reader.next());
    if (response.type === '!trap' || response.type === '!fatal') throw normalizeTrap(response);
    while (response.type !== '!done') response = parseSentence(await reader.next());
  }
}
