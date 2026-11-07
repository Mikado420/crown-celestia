// PeerJS（WebRTC）を使ったP2P通信。サーバーを用意しなくても、ブラウザ同士が直接つながる。
// 接続の仲介だけは PeerJS の公開サーバーを使う。
const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'crown-celestia-tavern-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let loading = null;

function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PEER_SRC;
    script.onload = () => resolve(window.Peer);
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('通信ライブラリを読み込めませんでした。ネット接続を確認してください'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function makeCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function openPeer(Peer, id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    const onError = (err) => {
      peer.destroy();
      reject(err);
    };
    peer.once('open', () => {
      peer.off('error', onError);
      resolve(peer);
    });
    peer.once('error', onError);
  });
}

// 部屋を作る。返り値の send(connId, msg) で各参加者に送る。
export async function hostRoom({ onMessage, onDisconnect, onError }) {
  const Peer = await loadPeer();
  let peer = null;
  let code = '';
  for (let attempt = 0; attempt < 4 && !peer; attempt++) {
    code = makeCode();
    try {
      peer = await openPeer(Peer, PREFIX + code);
    } catch (err) {
      if (err?.type !== 'unavailable-id') throw new Error('部屋を作れませんでした。時間をおいて試してください');
    }
  }
  if (!peer) throw new Error('部屋を作れませんでした。時間をおいて試してください');

  const conns = new Map();
  peer.on('connection', (conn) => {
    const connId = `${conn.peer}:${conn.connectionId}`;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      conns.delete(connId);
      onDisconnect(connId);
    };
    conn.on('open', () => conns.set(connId, conn));
    conn.on('data', (data) => onMessage(connId, data));
    conn.on('close', close);
    conn.on('error', close);
  });
  // 仲介サーバーとの接続が切れても、すでにつながった参加者とは遊び続けられる
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });
  peer.on('error', (err) => onError?.(err));

  return {
    code,
    send(connId, msg) {
      const conn = conns.get(connId);
      if (conn?.open) conn.send(msg);
    },
    close() {
      peer.destroy();
    },
  };
}

// 部屋に入る
export async function joinRoom(code, { onMessage, onClose }) {
  const Peer = await loadPeer();
  const peer = await openPeer(Peer, null).catch(() => {
    throw new Error('通信を始められませんでした。時間をおいて試してください');
  });
  return new Promise((resolve, reject) => {
    let opened = false;
    const fail = (message) => {
      if (opened) return;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('部屋に入れませんでした。コードを確認してください'), 12000);
    peer.on('error', (err) => {
      if (err?.type === 'peer-unavailable') fail(`部屋「${code}」が見つかりません。コードを確認してください`);
      else fail('部屋に入れませんでした。時間をおいて試してください');
    });
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        send(msg) {
          if (conn.open) conn.send(msg);
        },
        close() {
          peer.destroy();
        },
      });
    });
    conn.on('data', (data) => onMessage(data));
    conn.on('close', () => {
      if (opened) onClose?.();
    });
  });
}
