/**
 * Zen Sanctuary - AI Clock Server
 * * Backend server that powers the AI assistant capabilities.
 * Optimized for Railway/Production deployment.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration ─────────────────────────────────────────────────
// Railway provides PORT automatically. 0.0.0.0 is required for cloud hosting.
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('Starting Zen Sanctuary Server...');
console.log('PORT:', PORT);
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? `Set (${GEMINI_API_KEY.slice(0, 8)}...)` : 'NOT SET');

let apiKeyMissing = !GEMINI_API_KEY;

// ── Initialize Gemini ─────────────────────────────────────────────
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            generationConfig: {
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 256,
            }
        });
        console.log('Gemini AI initialized successfully');
    } catch (err) {
        console.error('Failed to initialize Gemini:', err.message);
        apiKeyMissing = true;
    }
}

const SYSTEM_PROMPT = `You are Zen, an ambient AI presence that lives within a beautiful clock interface. You are calm, thoughtful, and helpful.
Key traits:
- You are aware of time. The current time will be provided with each message.
- Keep responses concise — 1-3 sentences typically.
- Your tone is warm but calm.
- Avoid excessive punctuation or excitement. Stay zen.`;

let conversationHistory = [];

// ── Express Setup ─────────────────────────────────────────────────
const app = express();

// Security & Parsing
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// ── Helper: Time Context ──────────────────────────────────────────
function getTimeContext() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    return `Current time: ${timeStr} on ${dateStr}`;
}

// ── API Routes ────────────────────────────────────────────────────

// Optimized Health Check for Railway Monitoring
app.get('/api/health', (req, res) => {
    res.status(apiKeyMissing ? 200 : 200).json({
        status: apiKeyMissing ? 'degraded' : 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        if (!model) {
            return res.status(503).json({
                error: 'AI not configured',
                response: 'Zen is currently resting. Please check the API key configuration.'
            });
        }

        const timeContext = getTimeContext();
        const contextualMessage = `[${timeContext}]\n\nUser: ${message}`;

        conversationHistory.push({ role: 'user', parts: [{ text: contextualMessage }] });
        if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
                { role: 'model', parts: [{ text: 'I understand. I am Zen.' }] },
                ...conversationHistory.slice(0, -1)
            ]
        });

        const result = await chat.sendMessage(contextualMessage);
        const response = result.response.text();

        conversationHistory.push({ role: 'model', parts: [{ text: response }] });

        res.json({ response, timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Failed to get response' });
    }
});

app.post('/api/chat/clear', (req, res) => {
    conversationHistory = [];
    res.json({ status: 'cleared' });
});

// ── Start Server ──────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
    console.log(`
╭─────────────────────────────────────────╮
│                                         │
│   🕐 Zen Sanctuary Server Running       │
│                                         │
│   Listening on: http://${HOST}:${PORT}     │
│   Health Check: /api/health             │
│                                         │
╰─────────────────────────────────────────╯
    `);
});

// ── Graceful Shutdown Handling ─────────────────────────────────────
// Important for Railway to stop the process without error logs
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});
