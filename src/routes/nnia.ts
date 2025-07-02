import { Router, Request, Response } from 'express';
import { buildPrompt } from '../utils/promptBuilder';
import { askNNIAWithModel } from '../services/openai';
import { getClientData, getPublicBusinessData, getAppointments, createAppointment, getAvailability, setAvailability, getAvailabilityAndTypes, updateAppointment, deleteAppointment, getNotifications, createNotification, markNotificationRead, createTicket, createLead } from '../services/supabase';

const router = Router();

// POST /nnia/respond
router.post('/respond', async (req: Request, res: Response) => {
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
    const businessData = await getPublicBusinessData(clientId);
    // 3. Obtener disponibilidad y tipos de cita
    const availability = await getAvailabilityAndTypes(clientId);

    // 4. Construir prompt personalizado con solo información pública y disponibilidad
    const prompt = buildPrompt({ businessData, message, source, availability });

    // 5. Elegir modelo según el canal
    let model = 'gpt-4o';
    // Si en el futuro quieres usar gpt-4 para el panel, puedes hacer:
    // if (source === 'client-panel') model = 'gpt-4';

    // 6. Llamar a la API de OpenAI con el modelo elegido
    const nniaResponse = await askNNIAWithModel(prompt, model);
    let nniaMsg = nniaResponse.message;
    let citaCreada = null;
    let ticketCreado = null;
    let leadCreado = null;

    // 7. Guardar respuesta de NNIA en la tabla messages
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
        // No detenemos el flujo, pero lo reportamos en la respuesta
      }
    }

    // 8. Detectar si NNIA quiere crear una cita
    if (nniaMsg && nniaMsg.trim().startsWith('CREAR_CITA:')) {
      try {
        const citaStr = nniaMsg.replace('CREAR_CITA:', '').trim();
        const citaData = JSON.parse(citaStr);
        citaData.client_id = clientId;
        if (!citaData.origin) citaData.origin = source === 'client-panel' ? 'panel' : 'web';
        citaCreada = await createAppointment(citaData);
        nniaMsg = `✅ Cita agendada correctamente para ${citaCreada.name} el ${citaCreada.date} a las ${citaCreada.time} (${citaCreada.type}). Se ha enviado confirmación a tu panel.`;
      } catch (e) {
        nniaMsg = 'Ocurrió un error al intentar agendar la cita. Por favor, revisa los datos e inténtalo de nuevo.';
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
      ticketCreado = await createTicket({
        client_id: clientId,
        visitor_id: visitorId,
        visitor_name: null, // Se puede extraer si se implementa lógica adicional
        status: 'open',
        message: message,
        created_at: new Date().toISOString()
      });
      await createNotification({
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
      leadCreado = await createLead({
        client_id: clientId,
        visitor_id: visitorId,
        visitor_name: null, // Se puede extraer si se implementa lógica adicional
        visitor_email: emailMatch,
        visitor_phone: phoneMatch,
        source: source,
        message: message,
        created_at: new Date().toISOString()
      });
      await createNotification({
        client_id: clientId,
        type: 'lead',
        title: 'Nuevo lead capturado',
        body: `NNIA ha capturado un nuevo lead de contacto de un visitante.`,
        data: { leadId: leadCreado.id, visitorId }
      });
    }

    res.json({
      success: true,
      nnia: nniaMsg,
      cita: citaCreada,
      ticket: ticketCreado,
      lead: leadCreado,
      allMessages: nniaResponse.allMessages
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error procesando la solicitud de NNIA', details: error.message });
  }
});

// Análisis de documentos (subida y análisis)
router.post('/analyze-document', async (req: Request, res: Response) => {
  // Aquí se recibiría la URL o el archivo del documento
  // Se analizaría el documento y se guardaría el resumen en Supabase
  // Ejemplo de respuesta:
  res.json({ success: true, summary: 'Resumen del documento (pendiente de integración real)' });
});

// Gestión de citas (crear, actualizar, eliminar)
router.post('/appointments', async (req: Request, res: Response) => {
  // Aquí se recibirían los datos de la cita y se guardarían en Supabase
  // Ejemplo de respuesta:
  res.json({ success: true, message: 'Cita creada (pendiente de integración real)' });
});

router.put('/appointments/:id', async (req: Request, res: Response) => {
  try {
    const data = await updateAppointment(req.params.id, req.body);
    res.json({ success: true, appointment: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/appointments/:id', async (req: Request, res: Response) => {
  try {
    await deleteAppointment(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener citas del cliente
router.get('/appointments', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await getAppointments(clientId);
    res.json({ success: true, appointments: Array.isArray(data) ? data : [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message, appointments: [] });
  }
});

// Crear cita
router.post('/appointments', async (req: Request, res: Response) => {
  try {
    const data = await createAppointment(req.body);
    res.json({ success: true, appointment: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener disponibilidad
router.get('/availability', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await getAvailability(clientId);
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar disponibilidad
router.post('/availability', async (req: Request, res: Response) => {
  const { clientId, days, hours, types } = req.body;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await setAvailability(clientId, { days, hours, types });
    res.json({ success: true, availability: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener notificaciones de un cliente
router.get('/notifications', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await getNotifications(clientId);
    res.json({ success: true, notifications: Array.isArray(data) ? data : [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message, notifications: [] });
  }
});

// Crear notificación
router.post('/notifications', async (req: Request, res: Response) => {
  try {
    const data = await createNotification(req.body);
    res.json({ success: true, notification: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Marcar notificación como leída
router.post('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const data = await markNotificationRead(req.params.id);
    res.json({ success: true, notification: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /nnia/widget/config/:businessId
router.get('/widget/config/:businessId', async (req: Request, res: Response) => {
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
    if (error && error.code !== 'PGRST116') throw error;
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /nnia/widget/config/:businessId
router.put('/widget/config/:businessId', async (req: Request, res: Response) => {
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
    if (error) throw error;
    res.json({ success: true, config: data && data[0] ? data[0].config : config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router; 