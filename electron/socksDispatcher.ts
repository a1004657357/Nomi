// SOCKS 代理的 undici dispatcher（**不引 electron**，故可纯 Node 单测，同 systemProxy/proxyProbe）。
//
// 为什么自己写而不是装现成的：
//  - undici 从 **7.25.0** 才内置 `Socks5ProxyAgent`，而 Electron 31 内置的是 undici **6.19.8**，
//    package.json 也刻意钉同版（全局 fetch 用的是 Electron 内置那份，靠
//    `Symbol.for('undici.globalDispatcher.1')` 桥接；符号在 undici 7.27 翻成 `.2`）。
//    升上去 = undici 7 的 agent 被 undici 6 的 fetch 以 v6 handler 调用 → 炸所有网络请求。
//  - `fetch-socks` 声明 `undici: >=7`，同理用不了。
// 所以只能留在 undici 6 上，用 `socks`（MIT，成熟，本来就在依赖树里）自己接 `Agent({ connect })`。
// 做法与 fetch-socks 内部一致：SOCKS 隧道拿到裸 socket，https 目标再交给 undici 自己的
// connector 做 TLS 升级（`httpSocket` 复用）——TLS 绝不自己手搓。
import { Agent, buildConnector, type Dispatcher } from "undici";
import { SocksClient, type SocksProxy } from "socks";

/** 建 SOCKS 隧道本身的超时（不是整条请求的）。慢梯子握手也够。 */
const SOCKS_CONNECT_TIMEOUT_MS = 10000;

/**
 * `socks5://user:pass@host:1080` / `socks://h:p` / `socks4://h:p` → SocksProxy。
 * 认不出返回 null（调用方据此判 unsupported，绝不静默按直连跑）。纯函数，直测。
 */
export function parseSocksProxyUrl(raw: string): SocksProxy | null {
  const value = String(raw || "").trim();
  if (!/^socks/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  // socks4 与 socks4a 都按 4 走；socks / socks5 / socks5h 按 5（h = 由代理做 DNS，socks 库默认如此）。
  const type: SocksProxy["type"] = scheme === "socks4" || scheme === "socks4a" ? 4 : 5;
  const host = url.hostname;
  const port = Number(url.port);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const proxy: SocksProxy = { host, port, type };
  if (url.username) proxy.userId = decodeURIComponent(url.username);
  if (url.password) proxy.password = decodeURIComponent(url.password);
  return proxy;
}

/**
 * undici connector：先经 SOCKS 连到目标 host:port，https 再做 TLS 升级。
 * `tlsUpgrade` 用 undici 自己的 buildConnector（把隧道 socket 当 `httpSocket` 传进去），
 * 证书校验/ALPN/会话复用全走它的既有实现，我们不碰。
 */
export function socksConnector(
  proxy: SocksProxy,
  tlsOptions: buildConnector.BuildOptions = {},
): buildConnector.connector {
  const tlsUpgrade = buildConnector(tlsOptions);
  return (options, callback) => {
    const { protocol, hostname, port, httpSocket } = options;
    const targetPort = Number(port) || (protocol === "https:" ? 443 : 80);
    SocksClient.createConnection({
      proxy,
      command: "connect",
      destination: { host: hostname, port: targetPort },
      timeout: SOCKS_CONNECT_TIMEOUT_MS,
      ...(httpSocket ? { existing_socket: httpSocket } : {}),
    })
      .then(({ socket }) => {
        if (protocol !== "https:") {
          callback(null, socket.setNoDelay());
          return;
        }
        // https：把隧道 socket 交给 undici 的 TLS connector 升级（servername 缺省用目标域名）。
        tlsUpgrade({ ...options, httpSocket: socket }, callback);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), null);
      });
  };
}

/** SOCKS 版的 Agent，可直接当 dispatcher 用（塞进 SelectiveProxyDispatcher 的代理档）。 */
export function createSocksDispatcher(proxy: SocksProxy): Dispatcher {
  return new Agent({ connect: socksConnector(proxy) });
}
