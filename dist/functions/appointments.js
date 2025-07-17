"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppointment = createAppointment;
const supabase_1 = require("../services/supabase");
async function createAppointment({ clientId, date, title, description }) {
    const { data, error } = await supabase_1.supabase
        .from('appointments')
        .insert([{ client_id: clientId, date, title, description }]);
    if (error)
        throw error;
    return data;
}
