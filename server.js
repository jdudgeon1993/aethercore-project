/**
 * Zen Sanctuary - AI Clock Server
 *
 * Backend server that powers the AI assistant capabilities:
 * - Gemini AI for conversation
 * - Weather API integration (Phase 4)
 * - Reminder management (Phase 7)
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
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Log startup info for debugging
console.log('Starting Zen Sanctuary Server...');
console.log('PORT:', PORT);
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? `Set (${GEMINI_API_KEY.slice(0, 8)}...)` : 'NOT SET');

// Don't crash if API key is missing - let health check report it
let apiKeyMissing = false;
if (!GEMINI_API_KEY) {
    console.error('WARNING: GEMINI_API_KEY not found in environment variables');
    console.error('AI features will be disabled until the key is configured');
    apiKeyMissing = true;
}

// ── Initialize Gemini ─────────────────────────────────────────────
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 256, // Keep responses concise
        }
    });
    console.log('Gemini AI initialized successfully');
}

// System prompt that defines the AI's personality
const SYSTEM_PROMPT = `You are Zen, an ambient AI presence that lives within a beautiful clock interface. You are calm, thoughtful, and helpful.

Key traits:
- You are aware of time. The current time will be provided with each message.
- Keep responses concise — 1-3 sentences typically. You're ambient, not verbose.
- Your tone is warm but calm, like a wise friend who speaks thoughtfully.
- You can discuss any topic with intelligence and nuance.
- When asked about the time, respond naturally — you ARE the clock.
- Avoid excessive punctuation, emojis, or excitement. Stay zen.

You live within a visual clock that shows time through glowing rings, orbiting sparks, and a breathing central core. Your responses should feel like they come from that serene presence.

When you don't know something, say so simply. Don't make things up.`;

// Conversation history (in-memory, per-session)
// In production, you'd want to store this per-user
let conversationHistory = [];

// ── Express Setup ─────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve index.html and assets

// ── Helper: Get current time context ──────────────────────────────
function getTimeContext() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const timeStr = `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const date = now.getDate();

    return `Current time: ${timeStr} on ${dayName}, ${monthName} ${date}`;
}

// ── API Routes ────────────────────────────────────────────────────

// Health check with diagnostics
app.get('/api/health', (req, res) => {
    res.json({
        status: apiKeyMissing ? 'degraded' : 'ok',
        aiEnabled: !apiKeyMissing,
        time: new Date().toISOString(),
        config: {
            port: PORT,
            geminiKey: GEMINI_API_KEY ? 'configured' : 'missing'
        }
    });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Check if AI is configured
        if (!model) {
            return res.status(503).json({
                error: 'AI not configured',
                response: 'Zen is not yet awakened. Please configure the GEMINI_API_KEY in Railway environment variables.'
            });
        }

        // Build the prompt with context
        const timeContext = getTimeContext();
        const contextualMessage = `[${timeContext}]\n\nUser: ${message}`;

        // Add to conversation history
        conversationHistory.push({
            role: 'user',
            parts: [{ text: contextualMessage }]
        });

        // Keep history manageable (last 10 exchanges)
        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-20);
        }

        // Create chat with history
        const chat = model.startChat({
            history: [
                {
                    role: 'user',
                    parts: [{ text: SYSTEM_PROMPT }]
                },
                {
                    role: 'model',
                    parts: [{ text: 'I understand. I am Zen, the ambient presence within the clock. I will be calm, concise, and helpful.' }]
                },
                ...conversationHistory.slice(0, -1) // All but the last message
            ]
        });

        // Send the message
        const result = await chat.sendMessage(contextualMessage);
        const response = result.response.text();

        // Add response to history
        conversationHistory.push({
            role: 'model',
            parts: [{ text: response }]
        });

        res.json({
            response,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            error: 'Failed to get response',
            details: error.message
        });
    }
});

// Clear conversation history
app.post('/api/chat/clear', (req, res) => {
    conversationHistory = [];
    res.json({ status: 'cleared' });
});

// ── Start Server ──────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`
╭─────────────────────────────────────────╮
│                                         │
│   🕐 Zen Sanctuary Server Running       │
│                                         │
│   Local:  http://localhost:${PORT}         │
│   API:    http://localhost:${PORT}/api     │
│                                         │
│   Press Ctrl+C to stop                  │
│                                         │
╰─────────────────────────────────────────╯
    `);
});
