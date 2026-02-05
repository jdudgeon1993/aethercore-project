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

console.log('🚀 Initializing Zen Sanctuary [v3.0 Stable]...');

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

// System prompt remains lean
const PROMPT = "You are Zen, a calm ambient AI. Max 2 sentences.";
let history = [];

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', active: !!model, model: activeName });
});

app.post('/api/chat', async (req, res) => {
    try {
        if (!model) return res.status(503).json({ error: 'AI Offline' });
        const { message } = req.body;

        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: PROMPT }] },
                { role: 'model', parts: [{ text: 'Understood.' }] },
                ...history
            ]
        });

        const result = await chat.sendMessage(message);
        const text = result.response.text();

        history.push({ role: 'user', parts: [{ text: message }] }, { role: 'model', parts: [{ text: text }] });
        if (history.length > 8) history = history.slice(-8);

        res.json({ response: text });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, HOST, () => console.log(`🕐 Zen Sanctuary Online on Port ${PORT}`));
