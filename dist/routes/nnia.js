"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const promptBuilder_1 = require("../utils/promptBuilder");
const axios_1 = __importDefault(require("axios"));
const openai_1 = require("../services/openai");
const supabase_1 = require("../services/supabase");
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
const xlsx_1 = __importDefault(require("xlsx"));
const textract_1 = __importDefault(require("textract"));
const supabase_2 = require("../services/supabase");
const router = (0, express_1.Router)();
// POST /nnia/respond
router.post('/respond', async (req, res) => {
    const { clientId, message, source, visitorId, threadId } = req.body;
    if (!clientId || !message || !source) {
        res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        return;
    }
    try {
        // 1. Guardar mensaje del usuario en la tabla messages
        const { supabase } = require('../services/supabase');
        const timestamp = new Date().toISOString();
        const { error: userMsgError } = await supabase.from('messages').insert({
            client_id: clientId,
            sender: 'user',
            text: message,
            source: source,
            visitor_id: visitorId || null,
            timestamp
        });
        if (userMsgError) {
            console.error('Error insertando mensaje del usuario:', userMsgError);
            res.status(500).json({ error: 'Error insertando mensaje del usuario', details: userMsgError.message });
            return;
        }
        // 2. Obtener información pública del negocio (sin datos confidenciales)
        const businessData = await (0, supabase_1.getPublicBusinessData)(clientId);
        // 3. Obtener disponibilidad y tipos de cita
        const availability = await (0, supabase_1.getAvailabilityAndTypes)(clientId);
        // 3.1. Obtener datos de reservas si están configurados
        let reservationData = undefined;
        try {
            const { supabase } = require('../services/supabase');
            // Buscar configuración de reservas
            const { data: reservaConfig } = await supabase
                .from('reservation_configs')
                .select('*')
                .eq('client_id', clientId)
                .single();
            if (reservaConfig) {
                // Obtener reservas pendientes
                const { data: pendingReservations } = await supabase
                    .from('reservations')
                    .select('*')
                    .eq('client_id', clientId)
                    .gte('date', new Date().toISOString().split('T')[0])
                    .order('date', { ascending: true });
                reservationData = {
                    availability: reservaConfig.availability,
                    types: reservaConfig.types || [],
                    pendingReservations: pendingReservations || []
                };
            }
        }
        catch (e) {
            console.log('No hay configuración de reservas para este cliente');
        }
        // 4. Construir prompt personalizado con solo información pública y disponibilidad
        const prompt = (0, promptBuilder_1.buildPrompt)({ businessData, message, source, availability, reservationData });
        // 5. Elegir modelo según el canal
        let model = 'gpt-4o';
        // Si en el futuro quieres usar gpt-4 para el panel, puedes hacer:
        // if (source === 'client-panel') model = 'gpt-4';
        // 6. Llamar a la API de OpenAI con el modelo elegido
        const nniaResponse = await (0, openai_1.askNNIAWithModel)(prompt, model);
        let nniaMsg = nniaResponse.message;
        let citaCreada = null;
        let ticketCreado = null;
        let leadCreado = null;
        // 7. Guardar respuesta de NNIA en la tabla messages (se guardará después de todas las modificaciones)
        // 8. Detectar si NNIA quiere crear una cita
        if (nniaMsg && nniaMsg.trim().startsWith('CREAR_CITA:')) {
            try {
                const citaStr = nniaMsg.replace('CREAR_CITA:', '').trim();
                const citaData = JSON.parse(citaStr);
                citaData.client_id = clientId;
                if (!citaData.origin)
                    citaData.origin = source === 'client-panel' ? 'panel' : 'web';
                citaCreada = await (0, supabase_1.createAppointment)(citaData);
                nniaMsg = `✅ Cita agendada correctamente para ${citaCreada.name} el ${citaCreada.date} a las ${citaCreada.time} (${citaCreada.type}). Se ha enviado confirmación a tu panel.`;
            }
            catch (e) {
                nniaMsg = 'Ocurrió un error al intentar agendar la cita. Por favor, revisa los datos e inténtalo de nuevo.';
            }
        }
        // 8.1. Detectar si NNIA quiere crear una reserva
        if (nniaMsg && nniaMsg.trim().startsWith('CREAR_RESERVA:')) {
            try {
                const reservaStr = nniaMsg.replace('CREAR_RESERVA:', '').trim();
                const reservaData = JSON.parse(reservaStr);
                reservaData.client_id = clientId;
                if (!reservaData.origin)
                    reservaData.origin = source === 'client-panel' ? 'panel' : 'web';
                // Crear la reserva en la tabla reservations
                const { supabase } = require('../services/supabase');
                const { data: reservaCreada, error: reservaError } = await supabase
                    .from('reservations')
                    .insert([reservaData])
                    .select()
                    .single();
                if (reservaError)
                    throw reservaError;
                nniaMsg = `✅ Reserva confirmada para ${reservaData.name} el ${reservaData.date} a las ${reservaData.time} (${reservaData.people_count} personas). Se ha enviado confirmación a tu panel.`;
                // Crear notificación
                await (0, supabase_1.createNotification)({
                    client_id: clientId,
                    type: 'reservation',
                    title: 'Nueva reserva',
                    body: `Nueva reserva para ${reservaData.name} el ${reservaData.date} a las ${reservaData.time}`,
                    data: { reservationId: reservaCreada.id, visitorId }
                });
            }
            catch (e) {
                console.error('Error creando reserva:', e);
                nniaMsg = 'Ocurrió un error al intentar crear la reserva. Por favor, revisa los datos e inténtalo de nuevo.';
            }
        }
        // 8.2. Detectar si NNIA quiere crear un ticket
        if (nniaMsg && nniaMsg.trim().startsWith('CREAR_TICKET:')) {
            try {
                const ticketStr = nniaMsg.replace('CREAR_TICKET:', '').trim();
                const ticketData = JSON.parse(ticketStr);
                ticketData.client_id = clientId;
                ticketData.visitor_id = visitorId;
                ticketData.status = 'open';
                ticketData.created_at = new Date().toISOString();
                ticketCreado = await (0, supabase_1.createTicket)(ticketData);
                nniaMsg = `✅ He creado un ticket para que un responsable se ponga en contacto contigo pronto. Te notificaremos cuando te contacten.`;
                // Crear notificación
                await (0, supabase_1.createNotification)({
                    client_id: clientId,
                    type: 'ticket',
                    title: 'Nuevo ticket de soporte',
                    body: `Un visitante ha solicitado hablar con un responsable.`,
                    data: { ticketId: ticketCreado.id, visitorId }
                });
            }
            catch (e) {
                console.error('Error creando ticket:', e);
                nniaMsg = 'Ocurrió un error al crear el ticket. Por favor, inténtalo de nuevo.';
            }
        }
        // 9. Detectar si el mensaje o la respuesta de NNIA implica un ticket o lead
        // Lógica flexible: buscar frases clave en la respuesta de NNIA
        const ticketKeywords = [
            'responsable', 'humano', 'agente', 'soporte', 'te comunicamos', 'te contactará', 'espera un momento', 'derivar', 'atención personalizada', 'ticket', 'te transferimos', 'un encargado', 'un asesor', 'un especialista'
        ];
        const leadKeywords = [
            'correo', 'email', 'teléfono', 'contacto', 'déjanos tus datos', 'deja tus datos', 'te contactamos', 'te escribimos', 'te llamamos', 'deja tu email', 'deja tu número', 'deja tu teléfono', 'ponte en contacto', 'te responderemos', 'te avisamos', 'te notificamos'
        ];
        // Normalizar texto para búsqueda
        const lowerMsg = (nniaMsg || '').toLowerCase();
        const lowerUserMsg = (message || '').toLowerCase();
        // ¿Es ticket?
        const isTicket = ticketKeywords.some(k => lowerMsg.includes(k) || lowerUserMsg.includes(k));
        // ¿Es lead?
        const isLead = leadKeywords.some(k => lowerMsg.includes(k) || lowerUserMsg.includes(k));
        // 10. Si es ticket, crear ticket y notificación
        if (isTicket && visitorId) {
            ticketCreado = await (0, supabase_1.createTicket)({
                client_id: clientId,
                visitor_id: visitorId,
                visitor_name: null, // Se puede extraer si se implementa lógica adicional
                status: 'open',
                message: message,
                created_at: new Date().toISOString()
            });
            await (0, supabase_1.createNotification)({
                client_id: clientId,
                type: 'ticket',
                title: 'Nuevo ticket de soporte',
                body: `Un visitante ha solicitado hablar con un responsable.`,
                data: { ticketId: ticketCreado.id, visitorId }
            });
        }
        // 11. Si es lead, crear lead y notificación
        if (isLead && visitorId) {
            // Intentar extraer email y teléfono del mensaje del usuario o de la respuesta de NNIA
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const phoneRegex = /\+?\d[\d\s\-]{7,}/g;
            const emailMatch = (message.match(emailRegex) || lowerMsg.match(emailRegex) || [])[0] || null;
            const phoneMatch = (message.match(phoneRegex) || lowerMsg.match(phoneRegex) || [])[0] || null;
            leadCreado = await (0, supabase_1.createLead)({
                client_id: clientId,
                visitor_id: visitorId,
                visitor_name: null, // Se puede extraer si se implementa lógica adicional
                visitor_email: emailMatch,
                visitor_phone: phoneMatch,
                source: source,
                message: message,
                created_at: new Date().toISOString()
            });
            await (0, supabase_1.createNotification)({
                client_id: clientId,
                type: 'lead',
                title: 'Nuevo lead capturado',
                body: `NNIA ha capturado un nuevo lead de contacto de un visitante.`,
                data: { leadId: leadCreado.id, visitorId }
            });
        }
        // Comandos de gestión de documentos desde el chat
        // Formato esperado en la respuesta de NNIA:
        // CREAR_DOCUMENTO:{"name":"...","content":"..."}
        // EDITAR_DOCUMENTO:{"id":"...","name":"...","content":"..."}
        // ELIMINAR_DOCUMENTO:{"id":"..."}
        if (nniaMsg && nniaMsg.trim().startsWith('CREAR_DOCUMENTO:')) {
            try {
                const docStr = nniaMsg.replace('CREAR_DOCUMENTO:', '').trim();
                const docData = JSON.parse(docStr);
                const newDoc = await (0, supabase_1.createDocument)({
                    client_id: clientId,
                    name: docData.name || `Documento NNIA - ${new Date().toLocaleString()}`,
                    content: docData.content || '',
                });
                nniaMsg = `✅ El documento "${newDoc.name}" fue creado correctamente.`;
            }
            catch (e) {
                nniaMsg = 'Ocurrió un error al crear el documento. Por favor, revisa los datos e inténtalo de nuevo.';
            }
        }
        if (nniaMsg && nniaMsg.trim().startsWith('EDITAR_DOCUMENTO:')) {
            try {
                const editStr = nniaMsg.replace('EDITAR_DOCUMENTO:', '').trim();
                const editData = JSON.parse(editStr);
                const updated = await (0, supabase_1.updateDocument)(editData.id, clientId, {
                    name: editData.name,
                    content: editData.content
                });
                nniaMsg = `✅ El documento "${updated.name}" fue actualizado correctamente.`;
            }
            catch (e) {
                nniaMsg = 'Ocurrió un error al editar el documento. Por favor, revisa los datos e inténtalo de nuevo.';
            }
        }
        if (nniaMsg && nniaMsg.trim().startsWith('ELIMINAR_DOCUMENTO:')) {
            try {
                const delStr = nniaMsg.replace('ELIMINAR_DOCUMENTO:', '').trim();
                const delData = JSON.parse(delStr);
                await (0, supabase_1.deleteDocument)(delData.id, clientId);
                nniaMsg = `✅ El documento fue eliminado correctamente.`;
            }
            catch (e) {
                nniaMsg = 'Ocurrió un error al eliminar el documento. Por favor, revisa los datos e inténtalo de nuevo.';
            }
        }
        // Guardar respuesta final de NNIA en la tabla messages (después de todas las modificaciones)
        console.log('Respuesta de NNIA antes de guardar:', nniaMsg);
        if (nniaMsg) {
            const { error: nniaMsgError } = await supabase.from('messages').insert({
                client_id: clientId,
                sender: 'assistant',
                text: nniaMsg,
                source: 'nnia',
                visitor_id: visitorId || null,
                timestamp: new Date().toISOString()
            });
            if (nniaMsgError) {
                console.error('Error insertando mensaje de NNIA:', nniaMsgError);
            }
            else {
                console.log('Mensaje de NNIA guardado correctamente en la base de datos.');
            }
        }
        else {
            console.warn('nniaMsg está vacío, no se guarda respuesta de NNIA.');
        }
        res.json({
            success: true,
            nnia: nniaMsg,
            cita: citaCreada,
            ticket: ticketCreado,
            lead: leadCreado,
            allMessages: nniaResponse.allMessages
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud de NNIA', details: error.message });
    }
});
// Analizar documento subido
router.post('/analyze-document', async (req, res) => {
    const { clientId, file_url, file_type, prompt } = req.body;
    if (!clientId || !file_url || !file_type || !prompt) {
        res.status(400).json({ error: 'Faltan datos para analizar el documento. Por favor, intenta de nuevo.' });
        return;
    }
    try {
        // Descargar el archivo temporalmente
        const response = await axios_1.default.get(file_url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        let extractedText = '';
        if (file_type === 'pdf') {
            const data = await (0, pdf_parse_1.default)(buffer);
            extractedText = data.text;
        }
        else if (file_type === 'docx' || file_type === 'doc') {
            const result = await mammoth_1.default.extractRawText({ buffer });
            extractedText = result.value;
        }
        else if (file_type === 'txt') {
            extractedText = buffer.toString('utf-8');
        }
        else if (file_type === 'xlsx' || file_type === 'xls') {
            const workbook = xlsx_1.default.read(buffer, { type: 'buffer' });
            let text = '';
            workbook.SheetNames.forEach((sheetName) => {
                const sheet = workbook.Sheets[sheetName];
                const csv = xlsx_1.default.utils.sheet_to_csv(sheet);
                text += csv + '\n';
            });
            extractedText = text;
        }
        else {
            // Fallback: usar textract para otros tipos
            extractedText = await new Promise((resolve, reject) => {
                textract_1.default.fromBufferWithName('file.' + file_type, buffer, (err, text) => {
                    if (err)
                        reject(err);
                    else
                        resolve(text);
                });
            });
        }
        if (!extractedText || extractedText.trim().length < 10) {
            throw new Error('No se pudo leer el contenido del archivo. Asegúrate de que el documento no esté vacío o dañado.');
        }
        // Limitar el texto a 8000 caracteres para OpenAI (ajustable)
        const limitedText = extractedText.slice(0, 8000);
        const fullPrompt = `${prompt}\n\nTexto del documento:\n${limitedText}`;
        const nniaResponse = await (0, openai_1.askNNIAWithModel)([
            { role: 'user', content: fullPrompt }
        ], 'gpt-4o');
        res.json({ result: nniaResponse.message });
    }
    catch (error) {
        let userError = 'Ocurrió un problema al analizar el documento. Por favor, intenta de nuevo o prueba con otro archivo.';
        if (error.message && error.message.includes('No se pudo leer el contenido')) {
            userError = error.message;
        }
        else if (error.message && error.message.includes('Request failed with status code 403')) {
            userError = 'No se pudo acceder al archivo. Verifica que el archivo esté disponible y vuelve a intentarlo.';
        }
        else if (error.message && error.message.includes('timeout')) {
            userError = 'El análisis tardó demasiado. Por favor, intenta con un archivo más pequeño.';
        }
        res.status(500).json({ error: userError });
    }
});
// Gestión de citas (crear, actualizar, eliminar)
router.post('/appointments', async (req, res) => {
    // Aquí se recibirían los datos de la cita y se guardarían en Supabase
    // Ejemplo de respuesta:
    res.json({ success: true, message: 'Cita creada (pendiente de integración real)' });
});
router.put('/appointments/:id', async (req, res) => {
    try {
        const data = await (0, supabase_1.updateAppointment)(req.params.id, req.body);
        res.json({ success: true, appointment: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.delete('/appointments/:id', async (req, res) => {
    try {
        await (0, supabase_1.deleteAppointment)(req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Obtener citas del cliente
router.get('/appointments', async (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const data = await (0, supabase_1.getAppointments)(clientId);
        res.json({ success: true, appointments: Array.isArray(data) ? data : [] });
    }
    catch (error) {
        res.status(500).json({ error: error.message, appointments: [] });
    }
});
// Crear cita
router.post('/appointments', async (req, res) => {
    try {
        const data = await (0, supabase_1.createAppointment)(req.body);
        res.json({ success: true, appointment: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Obtener disponibilidad
router.get('/availability', async (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const data = await (0, supabase_1.getAvailability)(clientId);
        // Si no existe configuración, devolver valores por defecto
        if (!data) {
            const defaultConfig = {
                position: 'bottom-right',
                primaryColor: '#3b82f6',
                backgroundColor: '#ffffff',
                textColor: '#1f2937',
                welcomeMessage: '¡Hola! Soy NNIA, tu asistente virtual. ¿En qué puedo ayudarte?',
                autoOpen: false,
                showTimestamp: true,
                maxMessages: 50,
                scheduleEnabled: false,
                timezone: 'America/Mexico_City',
                hours: {
                    monday: { start: '09:00', end: '18:00', enabled: true },
                    tuesday: { start: '09:00', end: '18:00', enabled: true },
                    wednesday: { start: '09:00', end: '18:00', enabled: true },
                    thursday: { start: '09:00', end: '18:00', enabled: true },
                    friday: { start: '09:00', end: '18:00', enabled: true },
                    saturday: { start: '10:00', end: '16:00', enabled: false },
                    sunday: { start: '10:00', end: '16:00', enabled: false }
                },
                offlineMessage: 'Estamos fuera de horario. Te responderemos pronto.',
                widgetLogoUrl: null
            };
            res.json(defaultConfig);
            return;
        }
        res.json({ success: true, availability: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Guardar disponibilidad
router.post('/availability', async (req, res) => {
    const { clientId, days, hours, types } = req.body;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const data = await (0, supabase_1.setAvailability)(clientId, { days, hours, types });
        res.json({ success: true, availability: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Obtener notificaciones de un cliente
router.get('/notifications', async (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const data = await (0, supabase_1.getNotifications)(clientId);
        res.json({ success: true, notifications: Array.isArray(data) ? data : [] });
    }
    catch (error) {
        res.status(500).json({ error: error.message, notifications: [] });
    }
});
// Crear notificación
router.post('/notifications', async (req, res) => {
    try {
        const data = await (0, supabase_1.createNotification)(req.body);
        res.json({ success: true, notification: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Marcar notificación como leída
router.post('/notifications/:id/read', async (req, res) => {
    try {
        const data = await (0, supabase_1.markNotificationRead)(req.params.id);
        res.json({ success: true, notification: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// DOCUMENTOS NNIA
// Crear documento (ahora soporta folder_id)
router.post('/documents', async (req, res) => {
    const { clientId, name, content, file_url, file_type, folder_id } = req.body;
    if (!clientId || !name || !content) {
        res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        return;
    }
    try {
        const doc = await (0, supabase_1.createDocument)({ client_id: clientId, name, content, file_url, file_type, folder_id });
        res.json(doc);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Listar documentos de un cliente (por folder_id o raíz)
router.get('/documents', async (req, res) => {
    const { clientId, folderId } = req.query;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const docs = await (0, supabase_1.getDocuments)(clientId, folderId);
        res.json(docs);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Mover documento a otra carpeta
router.put('/documents/:id/move', async (req, res) => {
    const { clientId, folderId } = req.body;
    const { id } = req.params;
    if (!clientId || !id) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const doc = await (0, supabase_1.moveDocumentToFolder)(id, clientId, typeof folderId === 'undefined' ? null : folderId);
        res.json(doc);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Obtener documento individual
router.get('/documents/:id', async (req, res) => {
    const { clientId } = req.query;
    const { id } = req.params;
    if (!clientId || !id) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const doc = await (0, supabase_1.getDocumentById)(id, clientId);
        res.json(doc);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Actualizar documento
router.put('/documents/:id', async (req, res) => {
    const { clientId, name, content } = req.body;
    const { id } = req.params;
    if (!clientId || !id) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const doc = await (0, supabase_1.updateDocument)(id, clientId, { name, content });
        res.json(doc);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Eliminar documento
router.delete('/documents/:id', async (req, res) => {
    const { clientId } = req.query;
    const { id } = req.params;
    if (!clientId || !id) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const result = await (0, supabase_1.deleteDocument)(id, clientId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ===== ENDPOINTS PARA CARPETAS =====
// Crear carpeta
router.post('/folders', async (req, res) => {
    const { clientId, name } = req.body;
    if (!clientId || !name) {
        res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        return;
    }
    try {
        const folder = await (0, supabase_2.createFolder)({ client_id: clientId, name });
        res.json(folder);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Listar carpetas de un cliente
router.get('/folders', async (req, res) => {
    const { clientId } = req.query;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const folders = await (0, supabase_2.getFolders)(clientId);
        res.json(folders);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Eliminar carpeta
router.delete('/folders/:id', async (req, res) => {
    const { clientId } = req.query;
    const { id } = req.params;
    if (!clientId || !id) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const result = await (0, supabase_2.deleteFolder)(id, clientId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Renombrar carpeta
router.put('/folders/:id', async (req, res) => {
    const { clientId, name } = req.body;
    const { id } = req.params;
    if (!clientId || !id || !name) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const folder = await (0, supabase_2.renameFolder)(id, clientId, name);
        res.json(folder);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Listar documentos de una carpeta
router.get('/folders/:id/documents', async (req, res) => {
    const { clientId } = req.query;
    const { id } = req.params;
    if (!clientId || !id) {
        res.status(400).json({ error: 'Faltan parámetros' });
        return;
    }
    try {
        const docs = await (0, supabase_2.getDocumentsByFolder)(id, clientId);
        res.json(docs);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET /nnia/widget/config/:businessId
router.get('/widget/config/:businessId', async (req, res) => {
    const { businessId } = req.params;
    if (!businessId) {
        res.status(400).json({ error: 'Falta businessId' });
        return;
    }
    try {
        // Buscar configuración en widget_configs
        const { supabase } = require('../services/supabase');
        const { data, error } = await supabase
            .from('widget_configs')
            .select('config')
            .eq('business_id', businessId)
            .single();
        if (error && error.code !== 'PGRST116')
            throw error;
        if (data && data.config) {
            res.json(data.config);
            return;
        }
        // Si no existe, devolver configuración por defecto
        const defaultConfig = {
            position: 'bottom-right',
            primaryColor: '#3b82f6',
            backgroundColor: '#ffffff',
            textColor: '#1f2937',
            welcomeMessage: '¡Hola! Soy NNIA, tu asistente virtual. ¿En qué puedo ayudarte?',
            autoOpen: false,
            showTimestamp: true,
            maxMessages: 50,
            scheduleEnabled: false,
            timezone: 'America/Mexico_City',
            hours: {
                monday: { start: '09:00', end: '18:00', enabled: true },
                tuesday: { start: '09:00', end: '18:00', enabled: true },
                wednesday: { start: '09:00', end: '18:00', enabled: true },
                thursday: { start: '09:00', end: '18:00', enabled: true },
                friday: { start: '09:00', end: '18:00', enabled: true },
                saturday: { start: '10:00', end: '16:00', enabled: false },
                sunday: { start: '10:00', end: '16:00', enabled: false }
            },
            offlineMessage: 'Estamos fuera de horario. Te responderemos pronto.',
            widgetLogoUrl: null
        };
        res.json(defaultConfig);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// PUT /nnia/widget/config/:businessId
router.put('/widget/config/:businessId', async (req, res) => {
    const { businessId } = req.params;
    const config = req.body;
    if (!businessId || !config) {
        res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        return;
    }
    try {
        const { supabase } = require('../services/supabase');
        // UPSERT: si existe, actualiza; si no, inserta
        const { data, error } = await supabase
            .from('widget_configs')
            .upsert([
            {
                business_id: businessId,
                config: config,
                updated_at: new Date().toISOString()
            }
        ], { onConflict: ['business_id'] })
            .select();
        if (error)
            throw error;
        res.json({ success: true, config: data && data[0] ? data[0].config : config });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET /nnia/conversations?clientId=...
router.get('/conversations', async (req, res) => {
    const { clientId } = req.query;
    if (!clientId) {
        res.status(400).json({ error: 'Falta clientId' });
        return;
    }
    try {
        const { supabase } = require('../services/supabase');
        // Obtener el último mensaje de cada conversación (visitor_id)
        const { data, error } = await supabase.rpc('get_conversations', { p_client_id: clientId });
        if (error)
            throw error;
        res.json({ success: true, conversations: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET /nnia/messages?clientId=...&visitorId=...
router.get('/messages', async (req, res) => {
    const { clientId, visitorId } = req.query;
    if (!clientId || !visitorId) {
        res.status(400).json({ error: 'Faltan parámetros requeridos' });
        return;
    }
    try {
        const { supabase } = require('../services/supabase');
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('client_id', clientId)
            .eq('visitor_id', visitorId)
            .order('timestamp', { ascending: true });
        if (error)
            throw error;
        res.json({ success: true, messages: data });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
