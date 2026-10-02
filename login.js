const { webcrypto } = require('node:crypto');
if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto;
}

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = 5611; // Dùng port khác để không đụng server chính

app.use(cors());
app.use(express.json());

// --- Utilities ---
function normalizeProxyUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^(https?|socks5):\/\//i.test(raw)) return raw;
  const atIndex = raw.lastIndexOf('@');
  if (atIndex === -1) {
    if (/^[\w.-]+:\d+$/.test(raw)) return `http://${raw}`;
    return raw;
  }
  const credentials = raw.slice(0, atIndex);
  const hostPort = raw.slice(atIndex + 1);
  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1 || !hostPort.includes(':')) return raw;
  const username = credentials.slice(0, colonIndex);
  const password = credentials.slice(colonIndex + 1);
  const portSep = hostPort.lastIndexOf(':');
  const host = hostPort.slice(0, portSep);
  const port = hostPort.slice(portSep + 1);
  if (!username || !password || !host || !port) return raw;
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

function createAxiosProxyConfig(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return {};
  const agent = new HttpsProxyAgent(normalized);
  return {
    proxy: false,
    httpAgent: agent,
    httpsAgent: agent,
    insecureHTTPParser: true
  };
}

function generateDeviceId(length = 16) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i += 1) result += chars[Math.floor(Math.random() * 16)];
  return result;
}

function generateLoginHash(username, password, deviceId, platformId, hsk) {
  return CryptoJS.MD5(`${username}${password}${platformId}${deviceId}${hsk}`).toString();
}

const defaultConfig = {
  platformId: Number(process.env.SUNWIN_PLATFORM_ID || 2),
  brand: process.env.SUNWIN_BRAND || 'sun.win',
  hsk: process.env.SUNWIN_HSK || 'domaytimduocday',
  loginUrl: process.env.SUNWIN_LOGIN_URL || 'https://api.azhkthg1.net/id',
  timeoutMs: Number(process.env.SUNWIN_TIMEOUT_MS || 10000),
  defaultProxyUrl: process.env.SUNWIN_PROXY_URL || ''
};

class SunwinClient {
  constructor(options = {}) {
    this.config = { ...defaultConfig, ...(options.config || {}) };
    this.proxyUrl = normalizeProxyUrl(options.proxyUrl || this.config.defaultProxyUrl || '');
  }

  getAxiosConfig(options = {}) {
    const proxyUrl = normalizeProxyUrl(options.proxyUrl || this.proxyUrl);
    return {
      timeout: options.timeoutMs || this.config.timeoutMs,
      ...createAxiosProxyConfig(proxyUrl)
    };
  }

  buildLoginPayload({ username, password, deviceId = generateDeviceId() }) {
    return {
      command: 'loginHash',
      username,
      password,
      platformId: this.config.platformId,
      advId: '',
      deviceId,
      hash: generateLoginHash(username, password, deviceId, this.config.platformId, this.config.hsk),
      brand: this.config.brand,
      sessionId: ''
    };
  }

  async login({ username, password, proxyUrl, timeoutMs } = {}) {
    const payload = this.buildLoginPayload({ username, password });
    const res = await axios.post(this.config.loginUrl, payload, this.getAxiosConfig({ proxyUrl, timeoutMs }));
    return res.data;
  }
}

// --- Express Route ---
function createClient(proxyUrl) {
  return new SunwinClient({ proxyUrl: normalizeProxyUrl(proxyUrl || '') });
}

function pickCommon(body) {
  return {
    username: body.username,
    password: body.password,
    proxyUrl: normalizeProxyUrl(body.proxyUrl || '')
  };
}

app.post('/api/login', async (req, res) => {
  try {
    const client = createClient(req.body.proxyUrl);
    const data = await client.login(pickCommon(req.body));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Standalone Login API server running at http://localhost:${PORT}`);
});
