import { Router, Request, Response } from 'express';
import { buildPrompt } from '../utils/promptBuilder';
import { askNNIAWithModel } from '../services/openai';
import { getClientData, getPublicBusinessData, getAppointments, createAppointment, getAvailability, setAvailability, getAvailabilityAndTypes, updateAppointment, deleteAppointment, getNotifications, createNotification, markNotificationRead, getReservations, createReservation, getReservationAvailabilityAndTypes, getReservationTypes, createReservationType, updateReservationType, deleteReservationType, getReservationAvailability, setReservationAvailability, updateReservation, deleteReservation, supabase } from '../services/supabase';

const router = Router();

// POST /nnia/respond
router.post('/respond', async (req: Request, res: Response) => {
  const { clientId, message, source, visitorId, threadId } = req.body;

  if (!clientId || !message || !source) {
    res.status(400).json({ error: 'Faltan parámetros requeridos.' });
    return;
  }

  try {
    // 1. Obtener información pública del negocio (sin datos confidenciales)
    const businessData = await getPublicBusinessData(clientId);
    
    // 2. Obtener información del cliente si está en el panel
    let userName = null;
    if (source === 'client-panel') {
      try {
        const clientData = await getClientData(clientId);
        if (clientData && clientData.name) {
          // Extraer solo el primer nombre
          userName = clientData.name.split(' ')[0];
        }
      } catch (error) {
        console.log('No se pudo obtener el nombre del cliente:', error);
      }
    }
    
    // 3. Obtener disponibilidad y tipos de cita
    const availability = await getAvailabilityAndTypes(clientId);
    // 4. Obtener citas pendientes para evitar conflictos
    const pendingAppointments = await getAppointments(clientId);
    // 5. Obtener datos de reservas (disponibilidad, tipos y pendientes)
    const reservationData = await getReservationAvailabilityAndTypes(clientId);
    const pendingReservations = await getReservations(clientId);

    // 6. Construir prompt personalizado con toda la información
    const prompt = buildPrompt({ 
      businessData, 
      message, 
      source, 
      availability, 
      pendingAppointments,
      reservationData: {
        ...reservationData,
        pendingReservations
      },
      userName
    });

    // 7. Elegir modelo según el canal
    let model = 'gpt-4o';
    // Si en el futuro quieres usar gpt-4 para el panel, puedes hacer:
    // if (source === 'client-panel') model = 'gpt-4';

    // 8. Llamar a la API de OpenAI con el modelo elegido
    const nniaResponse = await askNNIAWithModel(prompt, model);
    let nniaMsg = nniaResponse.message;
    let citaCreada = null;
    let reservaCreada = null;

    // 9. Detectar si NNIA quiere crear una cita
    if (nniaMsg && nniaMsg.trim().startsWith('CREAR_CITA:')) {
      try {
        const citaStr = nniaMsg.replace('CREAR_CITA:', '').trim();
        const citaData = JSON.parse(citaStr);
        // Agregar client_id y origin si falta
        citaData.client_id = clientId;
        if (!citaData.origin) citaData.origin = source === 'client-panel' ? 'panel' : 'web';
        citaCreada = await createAppointment(citaData);
        nniaMsg = `✅ Cita agendada correctamente para ${citaCreada.name} el ${citaCreada.date} a las ${citaCreada.time} (${citaCreada.type}). Se ha enviado confirmación a tu panel.`;
      } catch (e) {
        nniaMsg = 'Ocurrió un error al intentar agendar la cita. Por favor, revisa los datos e inténtalo de nuevo.';
      }
    }

    // 10. Detectar si NNIA quiere crear una reserva
    if (nniaMsg && nniaMsg.trim().startsWith('CREAR_RESERVA:')) {
      try {
        const reservaStr = nniaMsg.replace('CREAR_RESERVA:', '').trim();
        const reservaData = JSON.parse(reservaStr);
        // Agregar client_id y origin si falta
        reservaData.client_id = clientId;
        if (!reservaData.origin) reservaData.origin = source === 'client-panel' ? 'panel' : 'web';
        reservaCreada = await createReservation(reservaData);
        nniaMsg = `✅ Reserva realizada correctamente para ${reservaCreada.name} el ${reservaCreada.date} a las ${reservaCreada.time} (${reservaCreada.reservation_type}). Se ha enviado confirmación a tu panel.`;
      } catch (e) {
        nniaMsg = 'Ocurrió un error al intentar realizar la reserva. Por favor, revisa los datos e inténtalo de nuevo.';
      }
    }

    res.json({
      success: true,
      nnia: nniaMsg,
      cita: citaCreada,
      reserva: reservaCreada,
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

// ===== RUTAS PARA RESERVAS =====

// Obtener reservas del cliente
router.get('/reservations', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await getReservations(clientId);
    res.json({ success: true, reservations: Array.isArray(data) ? data : [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message, reservations: [] });
  }
});

// Crear reserva
router.post('/reservations', async (req: Request, res: Response) => {
  try {
    const data = await createReservation(req.body);
    res.json({ success: true, reservation: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar reserva
router.put('/reservations/:id', async (req: Request, res: Response) => {
  try {
    const data = await updateReservation(req.params.id, req.body);
    res.json({ success: true, reservation: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar reserva
router.delete('/reservations/:id', async (req: Request, res: Response) => {
  try {
    await deleteReservation(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener tipos de reserva
router.get('/reservation-types', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await getReservationTypes(clientId);
    res.json({ success: true, types: Array.isArray(data) ? data : [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message, types: [] });
  }
});

// Crear tipo de reserva
router.post('/reservation-types', async (req: Request, res: Response) => {
  try {
    const data = await createReservationType(req.body);
    res.json({ success: true, type: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar tipo de reserva
router.put('/reservation-types/:id', async (req: Request, res: Response) => {
  try {
    const data = await updateReservationType(req.params.id, req.body);
    res.json({ success: true, type: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar tipo de reserva
router.delete('/reservation-types/:id', async (req: Request, res: Response) => {
  try {
    const data = await deleteReservationType(req.params.id);
    res.json({ success: true, type: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener disponibilidad de reservas
router.get('/reservation-availability', async (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await getReservationAvailability(clientId);
    res.json({ success: true, availability: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar disponibilidad de reservas
router.post('/reservation-availability', async (req: Request, res: Response) => {
  const { clientId, days, hours, advance_booking_days } = req.body;
  if (!clientId) {
    res.status(400).json({ error: 'Falta clientId' });
    return;
  }
  try {
    const data = await setReservationAvailability(clientId, { days, hours, advance_booking_days });
    res.json({ success: true, availability: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoints para configuración del widget
router.get('/widget/config/:businessId', async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;
    
    // Obtener configuración del widget desde Supabase
    const { data, error } = await supabase
      .from('widget_configs')
      .select('*')
      .eq('business_id', businessId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error al obtener configuración del widget:', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

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
        offlineMessage: 'Estamos fuera de horario. Te responderemos pronto.'
      };
      
      return res.json(defaultConfig);
    }

    res.json(data.config);
  } catch (error) {
    console.error('Error en GET /widget/config/:businessId:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.put('/widget/config/:businessId', async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;
    const config = req.body;
    
    // Validar que el businessId existe
    const { data: business, error: businessError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Upsert configuración del widget
    const { data, error } = await supabase
      .from('widget_configs')
      .upsert({
        business_id: businessId,
        config: config,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error al guardar configuración del widget:', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en PUT /widget/config/:businessId:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router; 