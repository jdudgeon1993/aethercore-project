/**
 * Zen Sanctuary - AI Clock Server
 * VERSION: 3.0.0 - Stable Force
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';
const API_KEY = process.env.GEMINI_API_KEY;
const WEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const DEFAULT_CITY = process.env.DEFAULT_CITY || 'Nashville';

console.log('🚀 Initializing Zen Sanctuary [v3.1 Weather]...');
console.log('📍 Weather:', WEATHER_KEY ? 'Configured' : 'Not configured');
console.log('🏙️  Default city:', DEFAULT_CITY);

let model = null;
let activeName = "none";

async function bootAI() {
    if (!API_KEY) return console.error('❌ Missing GEMINI_API_KEY');

    // We force the 'v1' stable version to avoid v1beta 404s
    const genAI = new GoogleGenerativeAI(API_KEY);
    
    // Updated model list: trying 2.0/latest aliases first
    const candidates = [
        'gemini-1.5-flash',
        'gemini-2.0-flash', 
        'gemini-flash-latest',
        'gemini-1.5-pro'
    ];

    for (const name of candidates) {
        try {
            console.log(`📡 Handshake attempt: ${name}...`);
            // Attempt to get the model specifically from the stable v1 path
            const testModel = genAI.getGenerativeModel({ model: name }, { apiVersion: 'v1' });
            
            const test = await testModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                generationConfig: { maxOutputTokens: 1 }
            });

            model = testModel;
            activeName = name;
            console.log(`✅ CONNECTION ESTABLISHED: ${name}`);
            break; 
        } catch (err) {
            console.warn(`⚠️  ${name} unavailable: ${err.message}`);
        }
    }

    if (!model) console.error('🚨 HANDSHAKE FAILED: Please check Google Cloud Project "Generative Language API" status.');
}

bootAI();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// System prompt with weather awareness
const PROMPT = `You are Zen, a calm ambient AI within a clock. Max 2-3 sentences.
When weather data is provided, describe it naturally and poetically.
You're aware of time and can comment on the day.`;

let history = [];

// ── Weather Functions ─────────────────────────────────────────────
let weatherCache = { data: null, timestamp: 0 };

function isWeatherQuestion(msg) {
    const keywords = ['weather', 'temperature', 'temp', 'rain', 'snow', 'sunny', 'cloudy', 'wind', 'cold', 'hot', 'warm', 'outside', 'jacket', 'umbrella', 'forecast', 'humid'];
    return keywords.some(k => msg.toLowerCase().includes(k));
}

async function getWeather(city = DEFAULT_CITY) {
    if (!WEATHER_KEY) return null;

    // Cache for 10 minutes
    const now = Date.now();
    if (weatherCache.data && (now - weatherCache.timestamp) < 600000) {
        return weatherCache.data;
    }

    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${WEATHER_KEY}&units=imperial`;
        const res = await fetch(url);
        if (!res.ok) return null;

        const d = await res.json();
        const info = {
            city: d.name,
            temp: Math.round(d.main.temp),
            feels: Math.round(d.main.feels_like),
            desc: d.weather[0].description,
            humidity: d.main.humidity,
            wind: Math.round(d.wind.speed)
        };

        weatherCache = { data: info, timestamp: now };
        return info;
    } catch (e) {
        console.error('Weather error:', e.message);
        return null;
    }
}

function formatWeather(w) {
    if (!w) return '';
    return `\n[Weather: ${w.temp}°F (feels ${w.feels}°F), ${w.desc}, humidity ${w.humidity}%, wind ${w.wind}mph in ${w.city}]`;
}

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        active: !!model,
        model: activeName,
        weather: !!WEATHER_KEY,
        city: DEFAULT_CITY
    });
});

// Weather endpoint
app.get('/api/weather', async (req, res) => {
    if (!WEATHER_KEY) return res.status(503).json({ error: 'Weather not configured' });
    const weather = await getWeather(req.query.city);
    if (!weather) return res.status(500).json({ error: 'Weather fetch failed' });
    res.json(weather);
});

app.post('/api/chat', async (req, res) => {
    try {
        if (!model) return res.status(503).json({ error: 'AI Offline' });
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message' });

        // Add weather context if it's a weather question
        let contextMsg = message;
        if (isWeatherQuestion(message)) {
            const weather = await getWeather();
            contextMsg = message + formatWeather(weather);
        }

        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: PROMPT }] },
                { role: 'model', parts: [{ text: 'Understood.' }] },
                ...history
            ]
        });

        const result = await chat.sendMessage(contextMsg);
        const text = result.response.text();

        history.push({ role: 'user', parts: [{ text: message }] }, { role: 'model', parts: [{ text: text }] });
        if (history.length > 8) history = history.slice(-8);

        res.json({ response: text });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, HOST, () => console.log(`🕐 Zen Sanctuary Online on Port ${PORT}`));
