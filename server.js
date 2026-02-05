/**
 * Zen Sanctuary - AI Clock Server
 * VERSION: 3.2.0 - Weather + Rate Limit Fix
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
let activeName = "gemini-2.0-flash";

// Initialize model without test calls (saves API quota)
if (API_KEY) {
    const genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    console.log('✅ AI Model ready: gemini-2.0-flash');
} else {
    console.error('❌ Missing GEMINI_API_KEY');
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// System prompt with weather and reminder awareness
const PROMPT = `You are Zen, a calm ambient AI within a clock. Max 2-3 sentences.
When weather data is provided, describe it naturally and poetically.
You're aware of time and can comment on the day.
When asked to set a reminder, acknowledge it warmly and confirm the time.`;

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

// ── Reminder Parsing ─────────────────────────────────────────────
app.post('/api/parse-reminder', async (req, res) => {
    try {
        if (!model) return res.status(503).json({ error: 'AI Offline' });
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message' });

        const now = new Date();
        const parsePrompt = `Extract reminder details from this message. Current time: ${now.toLocaleString()}.
Message: "${message}"

Respond ONLY with JSON in this exact format (no other text):
{"isReminder": true/false, "task": "what to remind about", "minutesFromNow": number}

Examples:
"remind me to call mom in 30 minutes" -> {"isReminder": true, "task": "call mom", "minutesFromNow": 30}
"set a reminder for 5 minutes to check the oven" -> {"isReminder": true, "task": "check the oven", "minutesFromNow": 5}
"what's the weather" -> {"isReminder": false, "task": "", "minutesFromNow": 0}`;

        const result = await model.generateContent(parsePrompt);
        const text = result.response.text().trim();

        // Try to parse the JSON response
        try {
            // Extract JSON from response (handle markdown code blocks)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                res.json(parsed);
            } else {
                res.json({ isReminder: false, task: '', minutesFromNow: 0 });
            }
        } catch {
            res.json({ isReminder: false, task: '', minutesFromNow: 0 });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, HOST, () => console.log(`🕐 Zen Sanctuary Online on Port ${PORT}`));
