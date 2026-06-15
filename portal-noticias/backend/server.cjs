var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
async function fetchWithRetry(url, options, retries = 3) {
  let lastError = null;
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Server Fetch] Fetching ${url} (Attempt ${i + 1}/${retries})...`);
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await new Promise((resolve) => setTimeout(resolve, i === 0 ? 500 : 1500));
  }
  throw lastError || new Error(`Failed to fetch ${url} after ${retries} retries`);
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.get("/api/news", async (req, res) => {
    try {
      const q = req.query.q;
      const url = q ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=US&ceid=US:es` : "https://news.google.com/rss?hl=es-419&gl=US&ceid=US:es";
      const response = await fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const text = await response.text();
      res.header("Content-Type", "application/xml; charset=utf-8");
      res.send(text);
    } catch (err) {
      console.error("[Server API] Google News RSS error:", err.message || err);
      res.status(500).json({ error: err.message || "Failed to fetch Google News" });
    }
  });
  app.get("/api/chart", async (req, res) => {
    try {
      const ticker = req.query.ticker;
      const range = req.query.range || "7d";
      const interval = req.query.interval || "1h";
      if (!ticker) {
        return res.status(400).json({ error: "ticker query parameter is required" });
      }
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
      const response = await fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const data = await response.json();
      res.json(data);
    } catch (err) {
      console.error("[Server API] Yahoo Chart error:", err.message || err);
      res.status(500).json({ error: err.message || "Failed to fetch chart" });
    }
  });
  async function getIndexSummary(name, ticker) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=2d&interval=1d`;
      const response = await fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      }, 2);
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("No chart result found");
      const meta = result.meta;
      let price = meta.regularMarketPrice;
      let prevClose = meta.chartPreviousClose || meta.previousClose;
      const quote = result.indicators?.quote?.[0];
      const closes = quote?.close || [];
      if (price === void 0 || price === null) {
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] !== null && closes[i] !== void 0) {
            price = closes[i];
            break;
          }
        }
      }
      if (prevClose === void 0 || prevClose === null) {
        if (closes.length >= 2) {
          prevClose = closes[closes.length - 2];
        } else {
          prevClose = price;
        }
      }
      if (price === void 0 || price === null || !prevClose) {
        throw new Error("Unable to parse price points");
      }
      const changeAmount = price - prevClose;
      const changePct = changeAmount / prevClose * 100;
      const isUp = changeAmount >= 0;
      return {
        name,
        value: price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        change: `${changeAmount >= 0 ? "+" : ""}${changeAmount.toFixed(2)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`,
        isUp
      };
    } catch (err) {
      console.warn(`[Index Fetch Error] Failed for ${name} (${ticker}):`, err.message || err);
      const fallbackMap = {
        "S&P 500": { value: "5,431.60", change: "+35.40 (+0.65%)", isUp: true },
        "Dow Jones": { value: "39,086.40", change: "-84.10 (-0.21%)", isUp: false },
        "Nasdaq 100": { value: "19,659.80", change: "+148.50 (+0.76%)", isUp: true },
        "IBEX 35": { value: "11,061.20", change: "-42.30 (-0.38%)", isUp: false }
      };
      return {
        name,
        ...fallbackMap[name] || { value: "---", change: "---", isUp: true }
      };
    }
  }
  app.get("/api/indices", async (req, res) => {
    try {
      const items = [
        { name: "S&P 500", ticker: "^GSPC" },
        { name: "Dow Jones", ticker: "^DJI" },
        { name: "Nasdaq 100", ticker: "^IXIC" },
        { name: "IBEX 35", ticker: "^IBEX" }
      ];
      const results = await Promise.all(
        items.map((item) => getIndexSummary(item.name, item.ticker))
      );
      res.json(results);
    } catch (err) {
      console.error("[Server API] Indices error:", err.message || err);
      res.status(500).json({ error: "Failed to fetch stock indices" });
    }
  });
  app.get("/api/financials", async (req, res) => {
    try {
      const indexItems = [
        { name: "S&P 500", ticker: "^GSPC" },
        { name: "Dow Jones", ticker: "^DJI" },
        { name: "Nasdaq 100", ticker: "^IXIC" },
        { name: "IBEX 35", ticker: "^IBEX" }
      ];
      const indices = await Promise.all(
        indexItems.map((item) => getIndexSummary(item.name, item.ticker))
      );
      let currencies = [];
      try {
        const erResponse = await fetchWithRetry("https://open.er-api.com/v6/latest/USD", {}, 2);
        const data = await erResponse.json();
        const rates = data.rates || {};
        const eurRate = rates.EUR ? 1 / rates.EUR : 1.082;
        const mxnRate = rates.MXN || 18.254;
        const arsRate = rates.ARS || 921.5;
        const copRate = rates.COP || 4085;
        currencies = [
          { name: "EUR/USD", value: eurRate.toFixed(4), change: "+0.15%", isUp: true },
          { name: "USD/MXN", value: mxnRate.toFixed(4), change: "-0.32%", isUp: false },
          { name: "USD/ARS", value: arsRate.toFixed(2), change: "+0.10%", isUp: true },
          { name: "USD/COP", value: copRate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), change: "-0.45%", isUp: false }
        ];
      } catch (erErr) {
        console.warn("[Server API] Exchange rates fetch failing, returning templates:", erErr.message);
        currencies = [
          { name: "EUR/USD", value: "1.0820", change: "+0.15%", isUp: true },
          { name: "USD/MXN", value: "18.2540", change: "-0.32%", isUp: false },
          { name: "USD/ARS", value: "921.50", change: "+0.10%", isUp: true },
          { name: "USD/COP", value: "4,085.00", change: "-0.45%", isUp: false }
        ];
      }
      let cryptos = [];
      try {
        const geckoUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true";
        const geckoResponse = await fetchWithRetry(geckoUrl, {}, 2);
        const data = await geckoResponse.json();
        const btcVal = data.bitcoin?.usd || 67250;
        const btcChg = data.bitcoin?.usd_24h_change || 0;
        const ethVal = data.ethereum?.usd || 3520;
        const ethChg = data.ethereum?.usd_24h_change || 0;
        const solVal = data.solana?.usd || 145.5;
        const solChg = data.solana?.usd_24h_change || 0;
        cryptos = [
          { name: "BTC / USD", value: btcVal.toLocaleString("en-US", { minimumFractionDigits: 2 }), change: `${btcChg >= 0 ? "+" : ""}${btcChg.toFixed(2)}%`, isUp: btcChg >= 0 },
          { name: "ETH / USD", value: ethVal.toLocaleString("en-US", { minimumFractionDigits: 2 }), change: `${ethChg >= 0 ? "+" : ""}${ethChg.toFixed(2)}%`, isUp: ethChg >= 0 },
          { name: "SOL / USD", value: solVal.toLocaleString("en-US", { minimumFractionDigits: 2 }), change: `${solChg >= 0 ? "+" : ""}${solChg.toFixed(2)}%`, isUp: solChg >= 0 }
        ];
      } catch (geckoErr) {
        console.warn("[Server API] CoinGecko fetch failing, returning templates:", geckoErr.message);
        cryptos = [
          { name: "BTC / USD", value: "67,250.00", change: "+1.85%", isUp: true },
          { name: "ETH / USD", value: "3,520.00", change: "-0.42%", isUp: false },
          { name: "SOL / USD", value: "145.50", change: "+4.10%", isUp: true }
        ];
      }
      const payload = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        indices,
        currencies,
        cryptos
      };
      res.json(payload);
    } catch (err) {
      console.error("[Server API] Financials consolidated route error:", err.message || err);
      res.status(500).json({ error: "Failed to assemble consolidated financials payload" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
