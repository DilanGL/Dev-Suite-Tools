const express = require('express');
const cors = require('cors');
const axios = require('axios');
const RSSParser = require('rss-parser');
require('dotenv').config();

const app = express();
const parser = new RSSParser();
const PORT = process.env.PORT || 3000;

// Configuración de CORS GLOBAL: Esto permite que tu GitHub Pages se conecte sin bloqueos
app.use(cors({
    origin: '*' 
}));
app.use(express.json());

/**
 * GET /api/financials
 * Retorna precios de Cripto (CoinGecko) y Divisas (Frankfurter) reales y en vivo
 */
app.get('/api/financials', async (req, res) => {
    try {
        const [cryptoRes, forexRes] = await Promise.all([
            axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'),
            axios.get('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY')
        ]);

        const responseData = {
            crypto: {
                bitcoin: cryptoRes.data.bitcoin.usd,
                ethereum: cryptoRes.data.ethereum.usd
            },
            forex: forexRes.data.rates,
            timestamp: new Date().toISOString()
        };

        res.json(responseData);
    } catch (error) {
        console.error('Financials Error:', error.message);
        res.status(503).json({ error: "Servicio financiero temporalmente caído" });
    }
});

/**
 * GET /api/news/favorites
 * Obtiene feeds estables de tecnología, economía y entretenimiento
 */
app.get('/api/news/favorites', async (req, res) => {
    // Reemplazamos por feeds RSS públicos y estables que no dan errores de acceso
    const feeds = [
        { category: 'technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' }, 
        { category: 'economy', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' }, 
        { category: 'entertainment', url: 'http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' }
    ];

    try {
        const results = await Promise.all(feeds.map(async (feed) => {
            try {
                const data = await parser.parseURL(feed.url);
                return {
                    category: feed.category,
                    articles: data.items.slice(0, 5).map(item => ({
                        title: item.title,
                        link: item.link,
                        pubDate: item.pubDate,
                        contentSnippet: item.contentSnippet || ""
                    }))
                };
            } catch (feedError) {
                console.error(`Error en feed ${feed.category}:`, feedError.message);
                return { category: feed.category, articles: [] }; // Si uno falla, no rompe los demás
            }
        }));

        res.json(results);
    } catch (error) {
        console.error('News Favorites Error:', error.message);
        res.status(500).json({ error: "Error al obtener feeds de noticias" });
    }
});

/**
 * GET /api/news/search?q=tema
 * Busca en Google News RSS y filtra por la fecha de hoy
 */
app.get('/api/news/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: "Parámetro de búsqueda 'q' es requerido" });
    }

    try {
        const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=MX&ceid=MX:es-419`;
        const feed = await parser.parseURL(searchUrl);
        
        const today = new Date().toDateString();

        // Filtrar artículos publicados hoy de forma estricta
        const filteredArticles = feed.items.filter(item => {
            const itemDate = new Date(item.pubDate).toDateString();
            return itemDate === today;
        }).map(item => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
            source: item.source ? item.source._ : "Fuente"
        }));

        res.json({
            query: query,
            count: filteredArticles.length,
            articles: filteredArticles
        });
    } catch (error) {
        console.error('Search Error:', error.message);
        res.status(500).json({ error: "Error en la búsqueda de noticias" });
    }
});

// Inicio del servidor
app.listen(PORT, () => {
    console.log(`CleanFeed AI Backend operativo en puerto ${PORT}`);
});
