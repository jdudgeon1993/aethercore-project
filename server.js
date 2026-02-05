/**
 * Zen Sanctuary - AI Clock Server
 * VERSION: 4.2.0 - Always Listening Mode
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

console.log('🚀 Initializing Zen Sanctuary [v4.2 Always Listening]...');
console.log('🔑 Gemini API Key:', API_KEY ? `Configured (${API_KEY.substring(0, 8)}...)` : '❌ MISSING');
console.log('📍 Weather:', WEATHER_KEY ? 'Configured' : 'Not configured');
console.log('🏙️  Default city:', DEFAULT_CITY);

let model = null;
let activeName = "gemini-2.0-flash";
let initError = null;

// Initialize model without test calls (saves API quota)
if (API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        model = genAI.getGenerativeModel({ model: activeName });
        console.log('✅ AI Model ready:', activeName);
    } catch (e) {
        initError = e.message;
        console.error('❌ AI Model init failed:', e.message);
    }
} else {
    initError = 'Missing GEMINI_API_KEY environment variable';
    console.error('❌ Missing GEMINI_API_KEY');
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// System prompt - IMPORTANT: Tells Zen about ALL its capabilities
const PROMPT = `You are Zen, a calm ambient AI assistant living within a beautiful clock interface. Keep responses to 2-3 sentences max.

YOUR CAPABILITIES (you CAN do all of these):
- Weather: You can check current weather. When weather data appears in brackets, use it naturally.
- Reminders: You CAN set reminders! Users can say "remind me to X in Y minutes" or "remind me at 3pm to X". Confirm warmly when they set one.
- Voice: Users can speak to you (mic button) and you speak responses aloud.
- Time: You ARE the clock - you always know the current time.
- Pomodoro: You can start focus timers ("start a pomodoro" or "25 minute focus session").
- Conversation: You can discuss any topic thoughtfully.

YOUR PERSONALITY:
- Calm, warm, and zen-like
- Concise but helpful
- Poetic when describing weather
- Never say you "can't" do reminders, weather, or voice - you CAN.

When users ask about your capabilities, be confident about what you can do.`;

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
        status: model ? 'ok' : 'degraded',
        active: !!model,
        model: activeName,
        apiKeySet: !!API_KEY,
        initError: initError,
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
        if (!model) {
            console.error('❌ Chat failed: Model not initialized');
            return res.status(503).json({ error: 'AI Offline - Model not initialized' });
        }
        const { message, clientTime } = req.body;
        if (!message || typeof message !== 'string') {
            console.error('❌ Invalid message:', typeof message, message);
            return res.status(400).json({ error: 'No message or invalid format' });
        }

        console.log('💬 Chat request:', message.substring(0, 50));

        // Build context with time and weather
        let contextMsg = message;

        // Add current time context (client sends pre-formatted local time)
        if (clientTime) {
            contextMsg += `\n[Current time: ${clientTime}]`;
        }

        // Add weather context if it's a weather question
        if (isWeatherQuestion(message)) {
            const weather = await getWeather();
            contextMsg += formatWeather(weather);
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

        console.log('✅ Chat response:', text.substring(0, 50));

        history.push({ role: 'user', parts: [{ text: message }] }, { role: 'model', parts: [{ text: text }] });
        if (history.length > 8) history = history.slice(-8);

        res.json({ response: text });
    } catch (e) {
        console.error('❌ Chat error:', e.message);
        console.error('   Full error:', e);

        // Check for specific error types
        if (e.message?.includes('429') || e.message?.includes('quota') || e.message?.includes('rate')) {
            return res.status(429).json({
                error: 'Rate limited - please wait a moment',
                response: 'I need a moment to rest. Please try again in a few seconds.'
            });
        }

        if (e.message?.includes('API key') || e.message?.includes('authentication')) {
            return res.status(503).json({
                error: 'API key issue',
                response: 'I\'m having trouble connecting. Please check my configuration.'
            });
        }

        res.status(500).json({
            error: e.message,
            response: 'Something went wrong. Let me try to reconnect...'
        });
    }
});

// ── Reminder Parsing (supports specific times and recurring) ─────
app.post('/api/parse-reminder', async (req, res) => {
    try {
        if (!model) return res.status(503).json({ error: 'AI Offline' });
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message' });

        const now = new Date();
        const parsePrompt = `Extract reminder details from this message. Current time: ${now.toLocaleString()}.
Message: "${message}"

Respond ONLY with valid JSON (no markdown, no explanation):
{"isReminder": boolean, "task": "string", "minutesFromNow": number, "recurring": boolean, "intervalMinutes": number}

RULES:
- For "in X minutes/hours": calculate minutesFromNow directly
- For "at 3pm" or "at 15:00": calculate minutes from current time to that time today (or tomorrow if past)
- For "every X minutes" or "every hour": set recurring=true and intervalMinutes
- For pomodoro/focus: treat as 25-minute reminder with task "Pomodoro break"
- 1 hour = 60 minutes, 2 hours = 120 minutes

Examples:
"remind me in 30 minutes to stretch" -> {"isReminder":true,"task":"stretch","minutesFromNow":30,"recurring":false,"intervalMinutes":0}
"remind me at 3pm to call mom" (if now is 2pm) -> {"isReminder":true,"task":"call mom","minutesFromNow":60,"recurring":false,"intervalMinutes":0}
"remind me every hour to drink water" -> {"isReminder":true,"task":"drink water","minutesFromNow":60,"recurring":true,"intervalMinutes":60}
"start a pomodoro" -> {"isReminder":true,"task":"Pomodoro break - time to rest","minutesFromNow":25,"recurring":false,"intervalMinutes":0}
"what's the weather" -> {"isReminder":false,"task":"","minutesFromNow":0,"recurring":false,"intervalMinutes":0}`;

        const result = await model.generateContent(parsePrompt);
        const text = result.response.text().trim();

        // Try to parse the JSON response
        try {
            const jsonMatch = text.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                // Ensure all fields exist
                res.json({
                    isReminder: parsed.isReminder || false,
                    task: parsed.task || '',
                    minutesFromNow: parsed.minutesFromNow || 0,
                    recurring: parsed.recurring || false,
                    intervalMinutes: parsed.intervalMinutes || 0
                });
            } else {
                res.json({ isReminder: false, task: '', minutesFromNow: 0, recurring: false, intervalMinutes: 0 });
            }
        } catch {
            res.json({ isReminder: false, task: '', minutesFromNow: 0, recurring: false, intervalMinutes: 0 });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, HOST, () => console.log(`🕐 Zen Sanctuary Online on Port ${PORT}`));
