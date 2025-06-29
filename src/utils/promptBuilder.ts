export function buildPrompt({ businessData, message, source, availability, pendingAppointments, reservationData }: { 
  businessData: any, 
  message: string, 
  source: string, 
  availability?: any, 
  pendingAppointments?: any[],
  reservationData?: { availability: any, types: any[], pendingReservations: any[] }
}) {
  // Obtener la fecha actual en formato largo en español
  const fechaActual = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Determinar el rol de NNIA según el canal/source
  let rol = '';
  if (source === 'client-panel') {
    rol = 'Eres la asistente personal del usuario, dueña o dueño del negocio. Responde de forma profesional, proactiva y con información interna del negocio.';
  } else {
    rol = 'Eres la asistente de ventas y atención al cliente del negocio. Atiendes a visitantes y potenciales clientes en la web o redes sociales. Solo usa información pública del negocio.';
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

  const instruccionReservas = `Si en la conversación tienes todos los datos para hacer una RESERVA (nombre, email, tipo de reserva, día, hora, número de personas), responde SOLO con la frase: CREAR_RESERVA: seguido de los datos en formato JSON, por ejemplo: CREAR_RESERVA: {"name":"María García","email":"maria@email.com","reservation_type":"Mesa para 4","date":"2024-06-20","time":"19:00","people_count":4,"origin":"web"}. IMPORTANTE: Evita hacer reservas en horarios ya ocupados.`;

  const instruccionGeneral = `${instruccionCitas}\n${instruccionReservas}\n\nDISTINGUE ENTRE CITAS Y RESERVAS: Las citas son para servicios profesionales (consultas, tratamientos, etc.). Las reservas son para espacios o mesas (restaurantes, hoteles, etc.). Si alguien pregunta por disponibilidad, sugiere opciones pero siempre permite que el usuario elija.`;

  // Solo retornar el mensaje del usuario, el contexto debe estar en la configuración del Assistant
  return [
    {
      role: 'user',
      content: `Hoy es ${fechaActual}. Información del negocio: ${JSON.stringify(businessContext)}. Configuración de citas: ${JSON.stringify(citaContext)}. Citas pendientes: ${JSON.stringify(citasPendientes)}. Configuración de reservas: ${JSON.stringify(reservaContext)}. Canal: ${source}. ${rol}\n${instruccionGeneral}\n\nMensaje del usuario: ${message}`,
    },
  ];
} 