import express from "express";
import cors from "cors";

async function fetchWithRetry(url: string, options?: RequestInit, retries = 3): Promise<Response> {
  let lastError: any = null;
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[Server Fetch] Fetching ${url} (Attempt ${i + 1}/${retries})...`);
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      lastError = e;
    }
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 500 : 1500));
  }
  throw lastError || new Error(`Failed to fetch ${url} after ${retries} retries`);
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Habilitar CORS para que tu frontend en GitHub Pages pueda consultar sin bloqueos
  app.use(cors({ origin: '*' }));

  // Ruta raíz para validar rápidamente en el navegador si Render está vivo
  app.get("/", (req, res) => {
    res.send("📡 API de NeutroNews activa, purificada y respondiendo en tiempo real.");
  });

  // EndPoint: Google News RSS
  app.get("/api/news", async (req, res) => {
    try {
      const q = req.query.q as string;
      const url = q 
        ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=US&ceid=US:es`
        : \"https://news.google.com/rss?hl=es-419&gl=US&ceid=US:es\";
      
      const response = await fetchWithRetry(url);
      const xml = await response.text();
      res.type("application/xml").send(xml);
    } catch (err: any) {
      console.error("[Server API] News route error:", err.message || err);
      res.status(500).json({ error: "Failed to fetch news feed" });
    }
  });

  // EndPoint: Yahoo Finance Charts
  app.get("/api/chart", async (req, res) => {
    try {
      const ticker = req.query.ticker as string || "^GSPC";
      const range = req.query.range as string || "1d";
      const interval = req.query.interval as string || "15m";

      if (!ticker) {
        return res.status(400).json({ error: "Missing required 'ticker' parameter" });
      }

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
      const response = await fetchWithRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      console.error("[Server API] Chart route error:", err.message || err);
      res.status(500).json({ error: `Failed to fetch chart for ${req.query.ticker}` });
    }
  });

  // EndPoint: Finanzas Consolidadas (Yahoo + CoinGecko)
  app.get("/api/financials", async (req, res) => {
    try {
      let indices = [];
      let currencies = [];
      let cryptos = [];

      // 1. Yahoo Finance (Índices y Divisas)
      try {
        const yahooUrl = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EGSPC,%5EIXIC,%5EDJI,COP%3DX,MXN%3DX,EURUSD%3DX";
        const yRes = await fetchWithRetry(yahooUrl, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        const yData = await yRes.json();
        const quotes = yData.quoteResponse?.result || [];

        quotes.forEach((q: any) => {
          const isUp = q.regularMarketChange >= 0;
          const changeStr = `${isUp ? "+" : ""}${q.regularMarketChangePercent?.toFixed(2)}%`;
          const item = {
            name: q.symbol === "^GSPC" ? "S&P 500" :
                  q.symbol === "^IXIC" ? "Nasdaq" :
                  q.symbol === "^DJI" ? "Dow Jones" :
                  q.symbol === "COP=X" ? "USD / COP" :
                  q.symbol === "MXN=X" ? "USD / MXN" :
                  q.symbol === "EURUSD=X" ? "EUR / USD" : q.shortName || q.symbol,
            value: q.regularMarketPrice?.toLocaleString("en-US", { minimumFractionDigits: 2 }) || "0.00",
            change: changeStr,
            isUp,
            url: `https://finance.yahoo.com/quote/${q.symbol}`
          };

          if (q.symbol.startsWith("^")) indices.push(item);
          else currencies.push(item);
        });
      } catch (yErr: any) {
        console.warn("[Server API] Yahoo Finance fetch failed, using fallbacks:", yErr.message);
        indices = [
          { name: "S&P 500", value: "5,115.30", change: "+0.45%", isUp: true },
          { name: "Nasdaq", value: "16,110.20", change: "+0.82%", isUp: true },
          { name: "Dow Jones", value: "38,980.00", change: "-0.12%", isUp: false }
        ];
        currencies = [
          { name: "USD / COP", value: "3,950.00", change: "-0.50%", isUp: false },
          { name: "USD / MXN", value: "16.85", change: "+0.15%", isUp: true },
          { name: "EUR / USD", value: "1.0850", change: "+0.08%", isUp: true }
        ];
      }

      // 2. CoinGecko (Criptomonedas)
      try {
        const geckoUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true";
        const gRes = await fetchWithRetry(geckoUrl);
        const gData = await gRes.json();

        const btcVal = gData.bitcoin?.usd || 65000;
        const btcChg = gData.bitcoin?.usd_24h_change || 0;
        const ethVal = gData.ethereum?.usd || 3400;
        const ethChg = gData.ethereum?.usd_24h_change || 0;
        const solVal = gData.solana?.usd || 140;
        const solChg = gData.solana?.usd_24h_change || 0;

        cryptos = [
          { name: "BTC / USD", value: btcVal.toLocaleString("en-US", { minimumFractionDigits: 2 }), change: `${btcChg >= 0 ? "+" : ""}${btcChg.toFixed(2)}%`, isUp: btcChg >= 0 },
          { name: "ETH / USD", value: ethVal.toLocaleString("en-US", { minimumFractionDigits: 2 }), change: `${ethChg >= 0 ? "+" : ""}${ethChg.toFixed(2)}%`, isUp: ethChg >= 0 },
          { name: "SOL / USD", value: solVal.toLocaleString("en-US", { minimumFractionDigits: 2 }), change: `${solChg >= 0 ? "+" : ""}${solChg.toFixed(2)}%`, isUp: solChg >= 0 }
        ];
      } catch (geckoErr: any) {
        console.warn("[Server API] CoinGecko fetch failed, using fallbacks:", geckoErr.message);
        cryptos = [
          { name: "BTC / USD", value: "67,250.00", change: "+1.85%\", isUp: true },
          { name: "ETH / USD", value: "3,520.00", change: "-0.42%\", isUp: false },
          { name: "SOL / USD", value: "145.50", change: "+4.10%\", isUp: true }
        ];
      }

      res.json({
        timestamp: new Date().toISOString(),
        indices,
        currencies,
        cryptos
      });
    } catch (err: any) {
      console.error("[Server API] Financials route error:", err.message || err);
      res.status(500).json({ error: "Failed to assemble financials payload" });
    }
  });

  app.listen(PORT, () => {
    console.log(`[Server] API pura corriendo exitosamente en el puerto ${PORT}`);
  });
}

startServer();
