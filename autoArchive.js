// Script para archivar automáticamente tickets y leads antiguos
const { autoArchiveOldTicketsAndLeads } = require('./src/services/supabase');

(async () => {
  try {
    const result = await autoArchiveOldTicketsAndLeads();
    console.log(`Archivado automático completado: ${result.tickets} tickets y ${result.leads} leads archivados.`);
    process.exit(0);
  } catch (error) {
    console.error('Error en archivado automático:', error);
    process.exit(1);
  }
})(); 