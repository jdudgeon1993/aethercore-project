/**
 * Zen Sanctuary - AI Clock Server
 * * Update: Fixed 404 Model Not Found error by 
 * standardizing the model identifier.
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

// ── Initialize Gemini ─────────────────────────────────────────────
let genAI = null;
let model = null;

if (GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        
        // Use the specific model identifier string
        // If 'gemini-1.5-flash' continues to 404, 'gemini-1.5-flash-latest' is the fallback
        model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash', 
            generationConfig: {
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 256,
            }
        });
        console.log('Gemini AI initialized: gemini-1.5-flash');
    } catch (err) {
        console.error('Critical: Failed to initialize Gemini:', err.message);
    }
}

const SYSTEM_PROMPT = `You are Zen, an ambient AI presence that lives within a beautiful clock interface. 
You are calm, thoughtful, and helpful. Keep responses concise (1-3 sentences). 
Stay zen, avoid excessive punctuation.`;

let conversationHistory = [];

// ── Express Setup ─────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// ── Helper: Time Context ──────────────────────────────────────────
function getTimeContext() {
    const now = new Date();
    return `Current time: ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}`;
}

// ── API Routes ────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', aiEnabled: !!model });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message provided' });

        if (!model) {
            return res.status(503).json({ error: 'AI model not initialized' });
        }

        const timeContext = getTimeContext();
        const contextualMessage = `[${timeContext}]\n\nUser: ${message}`;

        // Ensure history is in the correct format for the SDK
        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
                { role: 'model', parts: [{ text: 'I am Zen. I am ready.' }] },
                ...conversationHistory
            ]
        });

        const result = await chat.sendMessage(contextualMessage);
        const responseText = await result.response.text();

        // Update local history
        conversationHistory.push({ role: 'user', parts: [{ text: message }] });
        conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });

        if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

        res.json({ response: responseText });
    } catch (error) {
        console.error('Chat error details:', error);
        
        // Check for specific 404/Model errors to give better feedback
        if (error.message.includes('404') || error.message.includes('not found')) {
            return res.status(404).json({ 
                error: 'Model Error', 
                response: 'Zen is having trouble finding its voice (API Model mismatch).' 
            });
        }

        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Start Server ──────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
    console.log(`🕐 Zen Sanctuary Online at http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
    server.close(() => console.log('Server gracefully terminated'));
});
