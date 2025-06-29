import { supabase } from '../services/supabase';

export async function createAppointment({ clientId, date, title, description }: { clientId: string, date: string, title: string, description: string }) {
  const { data, error } = await supabase
    .from('appointments')
    .insert([{ client_id: clientId, date, title, description }]);
  if (error) throw error;
  return data;
} 