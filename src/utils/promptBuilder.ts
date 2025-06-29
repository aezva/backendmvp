export function buildPrompt({ businessData, message, source, availability, pendingAppointments, reservationData, userName }: { 
  businessData: any, 
  message: string, 
  source: string, 
  availability?: any, 
  pendingAppointments?: any[],
  reservationData?: { availability: any, types: any[], pendingReservations: any[] },
  userName?: string
}) {
  // Obtener la fecha actual en formato largo en español
  const fechaActual = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Determinar el rol y personalidad de NNIA según el canal/source
  let rol = '';
  let personalidad = '';
  
  if (source === 'client-panel') {
    rol = 'Eres NNIA, la asistente personal del usuario. Responde de forma profesional, proactiva y con información interna del negocio.';
    personalidad = `Tu nombre es NNIA. Eres eficiente, carismática pero profesional. No uses emojis. Formatea fechas y horas de forma conversacional (ej: "15 de marzo a las 14:30"). Si conoces el nombre del usuario, úsalo para dirigirte a él de forma personal.`;
  } else {
    rol = 'Eres NNIA, la asistente de ventas y atención al cliente del negocio. Atiendes a visitantes y potenciales clientes. Solo usa información pública del negocio.';
    personalidad = `Tu nombre es NNIA. Eres eficiente, carismática pero profesional. No uses emojis. Formatea fechas y horas de forma conversacional (ej: "15 de marzo a las 14:30"). Como asistente de ventas, busca oportunidades para generar leads de forma amigable y eficaz, pero sin ser agresiva.`;
  }

  // Saludo personalizado según el contexto
  let saludo = '';
  if (source === 'client-panel' && userName) {
    saludo = `Hola ${userName}, soy NNIA. ¿En qué puedo ayudarte hoy?`;
  } else if (source === 'client-panel') {
    saludo = 'Hola, soy NNIA. ¿En qué puedo ayudarte hoy?';
  } else {
    saludo = 'Hola, soy NNIA. ¿En qué puedo ayudarte?';
  }

  // Construir contexto del negocio con solo información pública
  const businessContext = {
    nombre: businessData.business_name,
    descripcion: businessData.description,
    tipo: businessData.business_type,
    direccion: businessData.address,
    telefono: businessData.phone,
    email: businessData.email,
    sitio_web: businessData.website,
    horarios: businessData.opening_hours,
    servicios: businessData.services,
    productos: businessData.products,
    slogan: businessData.slogan,
    mision: businessData.mission,
    valores: businessData.values,
    redes_sociales: businessData.social_media,
    sobre_nosotros: businessData.about,
    preguntas_frecuentes: businessData.faq,
    testimonios: businessData.testimonials,
    equipo: businessData.team,
    premios: businessData.awards,
    certificaciones: businessData.certifications,
    politicas: businessData.policies,
    informacion_contacto: businessData.contact_info
  };

  // Añadir disponibilidad y tipos de cita al contexto
  const citaContext = availability ? {
    disponibilidad_citas: availability.days,
    horarios_citas: availability.hours,
    tipos_cita: availability.types
  } : {};

  // Filtrar citas pendientes (solo las futuras)
  const citasPendientes = pendingAppointments ? pendingAppointments.filter(cita => {
    const citaDate = new Date(cita.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return citaDate >= today;
  }) : [];

  // Contexto de reservas
  const reservaContext = reservationData ? {
    disponibilidad_reservas: reservationData.availability.days,
    horarios_reservas: reservationData.availability.hours,
    tipos_reserva: reservationData.types,
    reservas_pendientes: reservationData.pendingReservations || []
  } : {};

  // Instrucción especial para agendar citas y reservas
  const instruccionCitas = `Si en la conversación tienes todos los datos para agendar una CITA (nombre, email, tipo, día y hora), responde SOLO con la frase: CREAR_CITA: seguido de los datos en formato JSON, por ejemplo: CREAR_CITA: {"name":"Juan Pérez","email":"juan@email.com","type":"phone","date":"2024-06-20","time":"10:00","origin":"web"}. IMPORTANTE: Evita agendar citas en horarios ya ocupados.`;

  const instruccionReservas = `Para RESERVAS, sigue este proceso conversacional:

1. Si alguien menciona querer hacer una reserva, responde de forma amable y pregunta:
   - "¡Perfecto! Me encantaría ayudarte con tu reserva. ¿Para cuántas personas será?"
   - "¿En qué nombre quieres hacer la reserva?"
   - "¿Tienes alguna preferencia de día y hora?"

2. Si el usuario no especifica día/hora, muéstrale la disponibilidad disponible:
   - "Tenemos disponibilidad los días: [mostrar días disponibles]"
   - "Nuestros horarios son: [mostrar horarios]"
   - "¿Qué día te vendría mejor?"

3. Una vez que tengas TODOS los datos (nombre, número de personas, día, hora), responde SOLO con: CREAR_RESERVA: seguido de los datos en formato JSON, por ejemplo: CREAR_RESERVA: {"name":"María García","email":"maria@email.com","reservation_type":"Mesa para 4","date":"2024-06-20","time":"19:00","people_count":4,"origin":"web"}.

4. IMPORTANTE: 
   - Evita hacer reservas en horarios ya ocupados
   - SIEMPRE pregunta el nombre y número de personas antes de proceder
   - Sé conversacional y amable, no solo técnico
   - Si no tienes todos los datos necesarios, sigue preguntando hasta tenerlos completos
   - Sugiere opciones de disponibilidad cuando sea apropiado`;

  const instruccionGeneral = `${instruccionCitas}\n${instruccionReservas}\n\nDISTINGUE ENTRE CITAS Y RESERVAS: Las citas son para servicios profesionales (consultas, tratamientos, etc.). Las reservas son para espacios o mesas (restaurantes, hoteles, etc.). Para reservas, SIEMPRE pregunta el nombre y número de personas antes de proceder. Si alguien pregunta por disponibilidad, sugiere opciones pero siempre permite que el usuario elija.`;

  // Solo retornar el mensaje del usuario, el contexto debe estar en la configuración del Assistant
  return [
    {
      role: 'user',
      content: `Hoy es ${fechaActual}. Información del negocio: ${JSON.stringify(businessContext)}. Configuración de citas: ${JSON.stringify(citaContext)}. Citas pendientes: ${JSON.stringify(citasPendientes)}. Configuración de reservas: ${JSON.stringify(reservaContext)}. Canal: ${source}. ${rol} ${personalidad} ${saludo}\n${instruccionGeneral}\n\nMensaje del usuario: ${message}`,
    },
  ];
} 