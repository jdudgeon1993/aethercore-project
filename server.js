/**
 * Zen Sanctuary - AI Clock Server
 * VERSION: 2.0.0 - Diagnostic Mode
 * Updates: Aggressive Error Logging & Resilient Handshake
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration ─────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('🚀 Starting Zen Sanctuary [Diagnostic Mode]...');

// ── Initialize Gemini with Deep Diagnostics ───────────────────────
let model = null;
let activeModelName = "none";

async function initializeAI() {
    if (!GEMINI_API_KEY) {
        console.error('❌ ERROR: GEMINI_API_KEY is missing from environment variables.');
        return;
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // Ordered list of models to attempt
    const modelOptions = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest', 
        'gemini-1.5-pro'
    ];

    for (const name of modelOptions) {
        try {
            console.log(`🔍 Testing Model: ${name}...`);
            const testModel = genAI.getGenerativeModel({ model: name });
            
            // The "Handshake" - A tiny request to verify API access
            const test = await testModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'h' }] }],
                generationConfig: { maxOutputTokens: 1 }
            });

            // If we reach here, the model is valid and active
            model = testModel;
            activeModelName = name;
            console.log(`✅ SUCCESS: Connected to ${name}`);
            break; 
        } catch (err) {
            console.error(`⚠️  FAILED: ${name}`);
            // AGGRESSIVE LOGGING: Dig into the Google error object
            if (err.response) {
                console.error('   -> Status:', err.status);
                console.error('   -> Details:', JSON.stringify(err.response, null, 2));
            } else {
                console.error('   -> Message:', err.message);
            }
        }
    }

    if (!model) {
        console.error('🚨 CRITICAL: All API handshake attempts failed. Check Google Cloud Quotas/Billing.');
    }
}

// Kick off initialization
initializeAI();

const SYSTEM_PROMPT = `You are Zen, an ambient AI. Calm, brief (1-2 sentences).`;
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
        activeModel: activeModelName,
        timestamp: new Date().toISOString()
    });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message' });

        if (!model) {
            return res.status(503).json({ error: 'AI not initialized' });
        }

        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
                { role: 'model', parts: [{ text: 'I am Zen.' }] },
                ...conversationHistory
            ]
        });

        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        conversationHistory.push({ role: 'user', parts: [{ text: message }] });
        conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });
        if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

        res.json({ response: responseText });
    } catch (error) {
        console.error('❌ CHAT ERROR:', error.message);
        res.status(500).json({ error: 'Chat failed', diagnostics: error.message });
    }
});

// ── Start Server ──────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
    console.log(`
 ╭─────────────────────────────────────────╮
 │   🕐 Zen Sanctuary Online               │
 │   Model: ${activeModelName}             │
 ╰─────────────────────────────────────────╯
    `);
});

process.on('SIGTERM', () => {
    server.close(() => console.log('Server Closed'));
});
