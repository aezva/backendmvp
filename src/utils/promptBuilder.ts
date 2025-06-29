export function buildPrompt({ businessData, message, source, availability }: { businessData: any, message: string, source: string, availability?: any }) {
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

  // Instrucción especial para agendar citas
  const citaInstruccion = `Si en la conversación tienes todos los datos para agendar una cita (nombre, email, tipo, día y hora), responde SOLO con la frase: CREAR_CITA: seguido de los datos en formato JSON, por ejemplo: CREAR_CITA: {"name":"Juan Pérez","email":"juan@email.com","type":"phone","date":"2024-06-20","time":"10:00","origin":"web"}`;

  // Solo retornar el mensaje del usuario, el contexto debe estar en la configuración del Assistant
  return [
    {
      role: 'user',
      content: `Información del negocio: ${JSON.stringify(businessContext)}. Configuración de citas: ${JSON.stringify(citaContext)}. Canal: ${source}. ${rol}\n${citaInstruccion}\n\nMensaje del usuario: ${message}`,
    },
  ];
} 