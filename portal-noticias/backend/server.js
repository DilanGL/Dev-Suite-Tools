const express = require('express');
const cors = require('cors');
const axios = require('axios');
const RSSParser = require('rss-parser');
require('dotenv').config();

const app = express();
const parser = new RSSParser();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Encabezados para que Yahoo Finance no bloquee el backend de Render
const YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * UTILERÍA: Obtener datos reales de Yahoo Finance para Índices y Divisas
 * Trae precio actual, cambio porcentual e histórico real en un solo viaje
 */
async function getYahooData(ticker, range = '1d', interval = '15m') {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`;
        const res = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 5000 });
        
        const result = res.data.chart.result[0];
        const meta = result.meta;
        const prices = result.indicators.quote[0].close.filter(p => p !== null);
        const timestamps = result.timestamp || [];
        
        const currentValue = meta.regularMarketPrice;
        const previousClose = meta.previousClose || currentValue;
        const changePercent = ((currentValue - previousClose) / previousClose) * 100;

        return {
            success: true,
            currentValue,
            changePercent: changePercent.toFixed(2) + '%',
            isUp: changePercent >= 0,
            prices,
            timestamps
        };
    } catch (error) {
        console.error(`Error consultando Yahoo Finance para ${ticker}:`, error.message);
        throw error; // Propagar error para manejo estricto
    }
}

/**
 * GET /api/financials
 * Consulta en tiempo real sin simulaciones
 */
app.get('/api/financials', async (req, res) => {
    try {
        // Consultas en paralelo a fuentes reales
        const [sp500, nasdaq, dow, btc, eth, sol, eur, mxn, cop] = await Promise.all([
            getYahooData('^GSPC'), // S&P 500
            getYahooData('^IXIC'), // NASDAQ
            getYahooData('^DJI'),  // Dow Jones
            getYahooData('BTC-USD'),
            getYahooData('ETH-USD'),
            getYahooData('SOL-USD'),
            getYahooData('EURUSD=X'),
            getYahooData('MXN=X'),
            getYahooData('COP=X')
        ]);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            indices: [
                { name: "S&P 500", value: sp500.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2 }), change: sp500.changePercent, isUp: sp500.isUp },
                { name: "NASDAQ", value: nasdaq.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2 }), change: nasdaq.changePercent, isUp: nasdaq.isUp },
                { name: "DOW JONES", value: dow.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2 }), change: dow.changePercent, isUp: dow.isUp }
            ],
            currencies: [
                { name: "EUR / USD", value: eur.currentValue.toFixed(4), change: eur.changePercent, isUp: eur.isUp },
                { name: "USD / MXN", value: mxn.currentValue.toFixed(4), change: mxn.changePercent, isUp: mxn.isUp },
                { name: "USD / COP", value: cop.currentValue.toFixed(2), change: cop.changePercent, isUp: cop.isUp }
            ],
            cryptos: [
                { name: "BTC / USD", value: btc.currentValue.toLocaleString('en-US'), change: btc.changePercent, isUp: btc.isUp },
                { name: "ETH / USD", value: eth.currentValue.toLocaleString('en-US'), change: eth.changePercent, isUp: eth.isUp },
                { name: "SOL / USD", value: sol.currentValue.toFixed(2), change: sol.changePercent, isUp: sol.isUp }
            ]
        });
    } catch (error) {
        // Error real si las APIs fallan (Regla: No inventar datos)
        res.status(502).json({ success: false, error: "Error real al consultar los proveedores financieros externos." });
    }
});

/**
 * GET /api/chart
 * Mapea rangos reales basados en lo que tu frontend pide (24H, 7D, 1M)
 */
app.get('/api/chart', async (req, res) => {
    const assetName = req.query.ticker || 'BTC / USD';
    const timeframe = req.query.range || '7d'; // '24h', '7d', '1m'

    // Traducir nombres del front a tickers reales de Yahoo Finance
    const tickerMap = {
        'S&P 500': '^GSPC', 'NASDAQ': '^IXIC', 'DOW JONES': '^DJI',
        'BTC / USD': 'BTC-USD', 'ETH / USD': 'ETH-USD', 'SOL / USD': 'SOL-USD',
        'EUR / USD': 'EURUSD=X', 'USD / MXN': 'MXN=X', 'USD / COP': 'COP=X'
    };

    const ticker = tickerMap[assetName] || 'BTC-USD';

    // Mapear intervalos válidos de Yahoo Finance para no sobrecargar datos
    let range = '7d';
    let interval = '1h';

    if (timeframe.toUpperCase() === '24H') { range = '1d'; interval = '15m'; }
    else if (timeframe.toUpperCase() === '7D') { range = '7d'; interval = '1h'; }
    else if (timeframe.toUpperCase() === '1M') { range = '30d'; interval = '1d'; }

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`;
        const yahooRes = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 5000 });
        
        const result = yahooRes.data.chart.result[0];
        const prices = result.indicators.quote[0].close.filter(p => p !== null);
        const timestamps = result.timestamp || [];

        // Generar etiquetas de fecha humanas basadas en datos reales de mercado
        const labels = timestamps.slice(-prices.length).map(ts => {
            const date = new Date(ts * 1000);
            return timeframe.toUpperCase() === '24H' 
                ? date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                : date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        });

        res.json({
            ticker: assetName,
            prices: prices,
            labels: labels,
            chart: yahooRes.data.chart
        });
    } catch (error) {
        res.status(502).json({ error: "Error al recopilar el histórico real de mercado." });
    }
});

/**
 * ENDPOINTS DE NOTICIAS RSS ORIGINALES (Sin alteraciones JSON)
 */
app.get('/api/news', async (req, res) => {
    try {
        const response = await axios.get('https://feeds.bbci.co.uk/news/technology/rss.xml', { responseType: 'text', timeout: 5000 });
        res.set('Content-Type', 'text/xml');
        res.send(response.data);
    } catch (error) {
        res.status(502).send("Error al consultar el RSS de noticias.");
    }
});

app.get('/api/news/search', async (req, res) => {
    const query = req.query.q || '';
    try {
        const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=MX&ceid=MX:es-419`;
        const response = await axios.get(searchUrl, { responseType: 'text', timeout: 5000 });
        res.set('Content-Type', 'text/xml');
        res.send(response.data);
    } catch (error) {
        res.status(502).send("Error en la consulta del buscador RSS.");
    }
});

app.listen(PORT, () => {
    console.log(`Servidor 100% verídico financiero corriendo en puerto ${PORT}`);
});
