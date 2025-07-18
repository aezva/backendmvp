"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askNNIAWithAssistantAPI = exports.askNNIAWithModel = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const openai_1 = __importDefault(require("openai"));
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = process.env.OPENAI_ASSISTANT_ID || '';
// Función para chat directo con modelo (sin Assistant API)
async function askNNIAWithModel(messages, model = 'gpt-4o') {
    // Convertir los mensajes al tipo correcto para OpenAI
    const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));
    const completion = await openai.chat.completions.create({
        model,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 1024,
    });
    return {
        message: completion.choices[0]?.message?.content || '',
        allMessages: completion.choices,
    };
}
exports.askNNIAWithModel = askNNIAWithModel;
async function askNNIAWithAssistantAPI(messages, threadId) {
    // 1. Si no hay thread, crear uno nuevo
    let thread = threadId;
    if (!thread) {
        const threadRes = await openai.beta.threads.create();
        thread = threadRes.id;
    }
    // 2. Solo añadir mensajes de usuario (no system)
    const userMsg = messages.find(m => m.role === 'user');
    if (userMsg) {
        await openai.beta.threads.messages.create(thread, {
            role: 'user',
            content: userMsg.content,
        });
    }
    // 3. Ejecutar el assistant (run)
    const run = await openai.beta.threads.runs.create(thread, {
        assistant_id: assistantId,
        // tools: [ ... ] // Aquí puedes definir herramientas si las tienes
    });
    // 4. Esperar a que el run termine (polling)
    let runStatus = run.status;
    let runResult = run;
    while (runStatus === 'queued' || runStatus === 'in_progress') {
        await new Promise((r) => setTimeout(r, 400));
        runResult = await openai.beta.threads.runs.retrieve(run.id, { thread_id: thread });
        runStatus = runResult.status;
    }
    // 5. Obtener los mensajes finales del thread
    const messagesFinales = await openai.beta.threads.messages.list(thread);
    const lastMessage = messagesFinales.data.find((msg) => msg.role === 'assistant');
    let assistantText = '';
    if (lastMessage && lastMessage.content && Array.isArray(lastMessage.content)) {
        const textBlock = lastMessage.content.find((block) => block.type === 'text');
        if (textBlock && 'text' in textBlock && textBlock.text && 'value' in textBlock.text) {
            assistantText = textBlock.text.value;
        }
    }
    return {
        threadId: thread,
        run: runResult,
        message: assistantText,
        allMessages: messagesFinales.data,
    };
}
exports.askNNIAWithAssistantAPI = askNNIAWithAssistantAPI;
