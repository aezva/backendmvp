"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocumentsByFolder = exports.renameFolder = exports.deleteFolder = exports.getFolders = exports.createFolder = exports.deleteDocument = exports.updateDocument = exports.getDocumentById = exports.moveDocumentToFolder = exports.getDocuments = exports.createDocument = exports.autoArchiveOldTicketsAndLeads = exports.createLead = exports.createTicket = exports.getReservationAvailabilityAndTypes = exports.deleteReservation = exports.updateReservation = exports.setReservationAvailability = exports.getReservationAvailability = exports.deleteReservationType = exports.updateReservationType = exports.createReservationType = exports.getReservationTypes = exports.createReservation = exports.getReservations = exports.markNotificationRead = exports.getNotifications = exports.deleteAppointment = exports.updateAppointment = exports.getAvailabilityAndTypes = exports.setAvailability = exports.getAvailability = exports.createAppointment = exports.createNotification = exports.getAppointments = exports.getPublicBusinessData = exports.getClientData = exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
console.log('DEBUG SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('DEBUG SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? '[PRESENTE]' : '[VACÍA]');
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
async function getClientData(clientId) {
    // Ejemplo: obtener datos del cliente desde la tabla 'clients'
    const { data, error } = await exports.supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
    if (error)
        throw error;
    return data;
}
exports.getClientData = getClientData;
async function getPublicBusinessData(clientId) {
    // Obtener business_name desde clients
    const { data: client, error: clientError } = await exports.supabase
        .from('clients')
        .select('id, business_name')
        .eq('id', clientId)
        .single();
    if (clientError)
        throw clientError;
    // Obtener información pública del negocio desde business_info
    const { data: businessInfo, error: businessError } = await exports.supabase
        .from('business_info')
        .select('*')
        .eq('client_id', clientId)
        .single();
    if (businessError)
        throw businessError;
    // Combinar los datos
    const combined = {
        business_name: client.business_name,
        ...businessInfo
    };
    // Filtrar campos vacíos o nulos para limpiar la respuesta
    const cleanData = Object.fromEntries(Object.entries(combined).filter(([_, value]) => value !== null && value !== undefined && value !== ''));
    return cleanData;
}
exports.getPublicBusinessData = getPublicBusinessData;
// Obtener citas de un cliente
async function getAppointments(clientId) {
    const { data, error } = await exports.supabase
        .from('appointments')
        .select('*')
        .eq('client_id', clientId)
        .order('date', { ascending: true })
        .order('time', { ascending: true });
    if (error)
        throw error;
    return data;
}
exports.getAppointments = getAppointments;
// Helper para limpiar notificación antes de insertar
function cleanNotificationInput(notification) {
    const { id, read, created_at, ...rest } = notification;
    return {
        ...rest,
        data: typeof rest.data === 'object' && rest.data !== null ? rest.data : {},
    };
}
// Crear notificación
async function createNotification(notification) {
    const clean = cleanNotificationInput(notification);
    const { data, error } = await exports.supabase
        .from('notifications')
        .insert([clean])
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.createNotification = createNotification;
// Helper para obtener el id de business_info a partir de client_id
async function getBusinessInfoIdByClientId(clientId) {
    const { data, error } = await exports.supabase
        .from('business_info')
        .select('id')
        .eq('client_id', clientId)
        .single();
    if (error)
        throw error;
    return data.id;
}
// En createAppointment, obtener el id de business_info y usarlo en la notificación
async function createAppointment(appointment) {
    // Forzar status 'pending' si no viene definido
    const citaData = { ...appointment, status: appointment.status || 'pending' };
    const { data, error } = await exports.supabase
        .from('appointments')
        .insert([citaData])
        .select();
    if (error)
        throw error;
    const cita = data[0];
    // Intentar crear notificación asociada, pero no fallar si hay error
    if (cita && cita.client_id) {
        try {
            const businessInfoId = await getBusinessInfoIdByClientId(cita.client_id);
            await createNotification({
                client_id: businessInfoId,
                type: 'cita',
                title: 'Nueva cita agendada',
                body: `Se ha agendado una cita para ${cita.name || ''} el ${cita.date} a las ${cita.time}.`,
                data: { appointmentId: cita.id },
            });
        }
        catch (notifError) {
            console.error('Error creando notificación:', notifError);
        }
    }
    return cita;
}
exports.createAppointment = createAppointment;
// Obtener disponibilidad de un cliente
async function getAvailability(clientId) {
    const { data, error } = await exports.supabase
        .from('business_info')
        .select('appointment_days, appointment_hours, appointment_types')
        .eq('client_id', clientId)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error; // PGRST116 = no rows found
    // Adaptar a formato esperado por el frontend
    return data ? {
        days: data.appointment_days ? data.appointment_days.split(',') : [],
        hours: data.appointment_hours || '',
        types: data.appointment_types ? data.appointment_types.split(',') : []
    } : { days: [], hours: '', types: [] };
}
exports.getAvailability = getAvailability;
// Guardar o actualizar disponibilidad
async function setAvailability(clientId, availability) {
    const { data, error } = await exports.supabase
        .from('business_info')
        .update({
        appointment_days: availability.days,
        appointment_hours: availability.hours,
        appointment_types: availability.types
    })
        .eq('client_id', clientId)
        .select();
    if (error)
        throw error;
    return data && data[0] ? {
        days: data[0].appointment_days ? data[0].appointment_days.split(',') : [],
        hours: data[0].appointment_hours || '',
        types: data[0].appointment_types ? data[0].appointment_types.split(',') : []
    } : { days: [], hours: '', types: [] };
}
exports.setAvailability = setAvailability;
// Obtener disponibilidad y tipos de cita de un cliente (helper para NNIA)
async function getAvailabilityAndTypes(clientId) {
    const { data, error } = await exports.supabase
        .from('business_info')
        .select('appointment_days, appointment_hours, appointment_types')
        .eq('client_id', clientId)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data ? {
        days: data.appointment_days ? data.appointment_days.split(',') : [],
        hours: data.appointment_hours || '',
        types: data.appointment_types ? data.appointment_types.split(',') : []
    } : { days: [], hours: '', types: [] };
}
exports.getAvailabilityAndTypes = getAvailabilityAndTypes;
// Actualizar una cita
async function updateAppointment(id, updates) {
    const { data, error } = await exports.supabase
        .from('appointments')
        .update(updates)
        .eq('id', id)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.updateAppointment = updateAppointment;
// Eliminar una cita
async function deleteAppointment(id) {
    const { error } = await exports.supabase
        .from('appointments')
        .delete()
        .eq('id', id);
    if (error)
        throw error;
    return { success: true };
}
exports.deleteAppointment = deleteAppointment;
// Obtener notificaciones de un cliente
async function getNotifications(clientId) {
    const { data, error } = await exports.supabase
        .from('notifications')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (error)
        throw error;
    return data;
}
exports.getNotifications = getNotifications;
// Marcar notificación como leída
async function markNotificationRead(id) {
    const { data, error } = await exports.supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.markNotificationRead = markNotificationRead;
// ===== FUNCIONES PARA RESERVAS =====
// Obtener reservas de un cliente
async function getReservations(clientId) {
    const { data, error } = await exports.supabase
        .from('reservations')
        .select('*')
        .eq('client_id', clientId)
        .order('date', { ascending: true })
        .order('time', { ascending: true });
    if (error)
        throw error;
    return data;
}
exports.getReservations = getReservations;
// Crear una reserva
async function createReservation(reservation) {
    // Forzar status 'pending' si no viene definido
    const reservationData = { ...reservation, status: reservation.status || 'pending' };
    const { data, error } = await exports.supabase
        .from('reservations')
        .insert([reservationData])
        .select();
    if (error)
        throw error;
    const reserva = data[0];
    // Intentar crear notificación asociada, pero no fallar si hay error
    if (reserva && reserva.client_id) {
        try {
            const businessInfoId = await getBusinessInfoIdByClientId(reserva.client_id);
            await createNotification({
                client_id: businessInfoId,
                type: 'reserva',
                title: 'Nueva reserva realizada',
                body: `Se ha realizado una reserva para ${reserva.name || ''} el ${reserva.date} a las ${reserva.time} (${reserva.reservation_type}).`,
                data: { reservationId: reserva.id },
            });
        }
        catch (notifError) {
            console.error('Error creando notificación de reserva:', notifError);
        }
    }
    return reserva;
}
exports.createReservation = createReservation;
// Obtener tipos de reserva de un cliente
async function getReservationTypes(clientId) {
    const { data, error } = await exports.supabase
        .from('reservation_types')
        .select('*')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('name', { ascending: true });
    if (error)
        throw error;
    return data;
}
exports.getReservationTypes = getReservationTypes;
// Crear tipo de reserva
async function createReservationType(reservationType) {
    const { data, error } = await exports.supabase
        .from('reservation_types')
        .insert([reservationType])
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.createReservationType = createReservationType;
// Actualizar tipo de reserva
async function updateReservationType(id, updates) {
    const { data, error } = await exports.supabase
        .from('reservation_types')
        .update(updates)
        .eq('id', id)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.updateReservationType = updateReservationType;
// Eliminar tipo de reserva (desactivar)
async function deleteReservationType(id) {
    const { data, error } = await exports.supabase
        .from('reservation_types')
        .update({ is_active: false })
        .eq('id', id)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.deleteReservationType = deleteReservationType;
// Obtener disponibilidad de reservas de un cliente
async function getReservationAvailability(clientId) {
    const { data, error } = await exports.supabase
        .from('reservation_availability')
        .select('*')
        .eq('client_id', clientId)
        .single();
    if (error && error.code !== 'PGRST116')
        throw error;
    return data ? {
        days: data.days ? data.days.split(',') : [],
        hours: data.hours || '',
        advance_booking_days: data.advance_booking_days || 30
    } : { days: [], hours: '', advance_booking_days: 30 };
}
exports.getReservationAvailability = getReservationAvailability;
// Guardar o actualizar disponibilidad de reservas
async function setReservationAvailability(clientId, availability) {
    const { data, error } = await exports.supabase
        .from('reservation_availability')
        .upsert({
        client_id: clientId,
        days: availability.days,
        hours: availability.hours,
        advance_booking_days: availability.advance_booking_days
    })
        .select();
    if (error)
        throw error;
    return data && data[0] ? {
        days: data[0].days ? data[0].days.split(',') : [],
        hours: data[0].hours || '',
        advance_booking_days: data[0].advance_booking_days || 30
    } : { days: [], hours: '', advance_booking_days: 30 };
}
exports.setReservationAvailability = setReservationAvailability;
// Actualizar una reserva
async function updateReservation(id, updates) {
    const { data, error } = await exports.supabase
        .from('reservations')
        .update(updates)
        .eq('id', id)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.updateReservation = updateReservation;
// Eliminar una reserva
async function deleteReservation(id) {
    const { error } = await exports.supabase
        .from('reservations')
        .delete()
        .eq('id', id);
    if (error)
        throw error;
    return { success: true };
}
exports.deleteReservation = deleteReservation;
// Obtener disponibilidad y tipos de reserva de un cliente (helper para NNIA)
async function getReservationAvailabilityAndTypes(clientId) {
    const [availability, types] = await Promise.all([
        getReservationAvailability(clientId),
        getReservationTypes(clientId)
    ]);
    return {
        availability,
        types: types || []
    };
}
exports.getReservationAvailabilityAndTypes = getReservationAvailabilityAndTypes;
// Crear ticket
async function createTicket(ticketData) {
    const { data, error } = await exports.supabase
        .from('tickets')
        .insert([ticketData])
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.createTicket = createTicket;
// Crear lead
async function createLead(leadData) {
    const { data, error } = await exports.supabase
        .from('leads')
        .insert([leadData])
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.createLead = createLead;
/**
 * Archiva automáticamente tickets y leads con más de 7 días de antigüedad y estado distinto de 'archived'.
 * Retorna el número de elementos archivados por tipo.
 */
async function autoArchiveOldTicketsAndLeads() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Archivar tickets
    const { data: ticketData, error: ticketError } = await exports.supabase
        .from('tickets')
        .update({ status: 'archived' })
        .lt('created_at', sevenDaysAgo)
        .neq('status', 'archived')
        .select('*');
    // Archivar leads
    const { data: leadData, error: leadError } = await exports.supabase
        .from('leads')
        .update({ status: 'archived' })
        .lt('created_at', sevenDaysAgo)
        .neq('status', 'archived')
        .select('*');
    if (ticketError || leadError)
        throw ticketError || leadError;
    return { tickets: ticketData ? ticketData.length : 0, leads: leadData ? leadData.length : 0 };
}
exports.autoArchiveOldTicketsAndLeads = autoArchiveOldTicketsAndLeads;
// DOCUMENTOS NNIA
// Crear documento (ahora soporta folder_id)
async function createDocument(document) {
    const { data, error } = await exports.supabase
        .from('documents')
        .insert([document])
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.createDocument = createDocument;
// Listar documentos de un cliente (solo raíz si folder_id es null)
async function getDocuments(clientId, folderId) {
    let query = exports.supabase
        .from('documents')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (typeof folderId !== 'undefined') {
        query = query.eq('folder_id', folderId);
    }
    else {
        query = query.is('folder_id', null);
    }
    const { data, error } = await query;
    if (error)
        throw error;
    return data;
}
exports.getDocuments = getDocuments;
// Mover documento a otra carpeta
async function moveDocumentToFolder(documentId, clientId, folderId) {
    const { data, error } = await exports.supabase
        .from('documents')
        .update({ folder_id: folderId })
        .eq('id', documentId)
        .eq('client_id', clientId)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.moveDocumentToFolder = moveDocumentToFolder;
// Obtener documento individual
async function getDocumentById(id, clientId) {
    const { data, error } = await exports.supabase
        .from('documents')
        .select('*')
        .eq('id', id)
        .eq('client_id', clientId)
        .single();
    if (error)
        throw error;
    return data;
}
exports.getDocumentById = getDocumentById;
// Actualizar documento
async function updateDocument(id, clientId, updates) {
    const { data, error } = await exports.supabase
        .from('documents')
        .update(updates)
        .eq('id', id)
        .eq('client_id', clientId)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.updateDocument = updateDocument;
// Eliminar documento
async function deleteDocument(id, clientId) {
    const { error } = await exports.supabase
        .from('documents')
        .delete()
        .eq('id', id)
        .eq('client_id', clientId);
    if (error)
        throw error;
    return { success: true };
}
exports.deleteDocument = deleteDocument;
// ===== FUNCIONES PARA CARPETAS =====
// Crear carpeta
async function createFolder(folder) {
    const { data, error } = await exports.supabase
        .from('folders')
        .insert([folder])
        .select();
    if (error)
        throw error;
    return data[0];
}
exports.createFolder = createFolder;
// Listar carpetas de un cliente
async function getFolders(clientId) {
    const { data, error } = await exports.supabase
        .from('folders')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (error)
        throw error;
    return data;
}
exports.getFolders = getFolders;
// Eliminar carpeta (y poner folder_id a null en documentos de esa carpeta)
async function deleteFolder(id, clientId) {
    // Primero, poner folder_id a null en documentos de esa carpeta
    await exports.supabase
        .from('documents')
        .update({ folder_id: null })
        .eq('folder_id', id)
        .eq('client_id', clientId);
    // Luego, eliminar la carpeta
    const { error } = await exports.supabase
        .from('folders')
        .delete()
        .eq('id', id)
        .eq('client_id', clientId);
    if (error)
        throw error;
    return { success: true };
}
exports.deleteFolder = deleteFolder;
// Renombrar carpeta
async function renameFolder(id, clientId, name) {
    const { data, error } = await exports.supabase
        .from('folders')
        .update({ name })
        .eq('id', id)
        .eq('client_id', clientId)
        .select();
    if (error)
        throw error;
    return data && data[0];
}
exports.renameFolder = renameFolder;
// Listar documentos de una carpeta
async function getDocumentsByFolder(folderId, clientId) {
    const { data, error } = await exports.supabase
        .from('documents')
        .select('*')
        .eq('folder_id', folderId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (error)
        throw error;
    return data;
}
exports.getDocumentsByFolder = getDocumentsByFolder;
