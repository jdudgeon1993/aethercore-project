/**
 * Zen Sanctuary - AI Clock Server
 * REVISED: Feb 2026
 * Fix: 404 Model Not Found / API Version mismatch
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
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('Starting Zen Sanctuary Server...');

// ── Initialize Gemini with Fallback Logic ─────────────────────────
let model = null;

async function initializeAI() {
    if (!GEMINI_API_KEY) {
        console.error('ERROR: GEMINI_API_KEY not found in environment.');
        return;
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // We will try these in order of preference
    const modelOptions = [
        'gemini-1.5-flash-latest', 
        'gemini-1.5-flash',
        'gemini-pro'
    ];

    for (const modelName of modelOptions) {
        try {
            console.log(`Attempting to initialize model: ${modelName}...`);
            const attemptModel = genAI.getGenerativeModel({ model: modelName });
            
            // Perform a tiny "handshake" test to see if the model actually exists
            await attemptModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                generationConfig: { maxOutputTokens: 1 }
            });

            model = attemptModel;
            console.log(`✅ Success! Using model: ${modelName}`);
            break; 
        } catch (err) {
            console.warn(`⚠️ Model ${modelName} failed or 404ed. Trying next...`);
        }
    }

    if (!model) {
        console.error('❌ CRITICAL: All model initialization attempts failed.');
    }
}

// Run initialization
initializeAI();

const SYSTEM_PROMPT = `You are Zen, an ambient AI presence that lives within a beautiful clock interface. 
You are calm and concise (1-2 sentences). No excessive punctuation.`;

let conversationHistory = [];

// ── Express Setup ─────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// ── API Routes ────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        aiActive: !!model,
        modelName: model?.model || 'none'
    });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message' });

        if (!model) {
            return res.status(503).json({ error: 'AI currently unavailable' });
        }

        // Format history for the Google SDK
        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
                { role: 'model', parts: [{ text: 'I am Zen. Understood.' }] },
                ...conversationHistory
            ]
        });

        const result = await chat.sendMessage(message);
        const responseText = await result.response.text();

        // Keep history lean (last 6 turns)
        conversationHistory.push({ role: 'user', parts: [{ text: message }] });
        conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });
        if (conversationHistory.length > 12) conversationHistory = conversationHistory.slice(-12);

        res.json({ response: responseText });
    } catch (error) {
        console.error('Chat Error:', error.message);
        res.status(500).json({ 
            error: 'Zen is having a moment of silence.',
            details: error.message 
        });
    }
});

// ── Start Server ──────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
    console.log('\x1b[36m%s\x1b[0m', `
 ╭─────────────────────────────────────────╮
 │                                         │
 │   🕐 Zen Sanctuary Server Running       │
 │                                         │
 │   Local: http://localhost:${PORT}        │
 │   API:   http://localhost:${PORT}/api    │
 │                                         │
 ╰─────────────────────────────────────────╯
    `);
});

process.on('SIGTERM', () => {
    server.close(() => console.log('Server terminated'));
});
