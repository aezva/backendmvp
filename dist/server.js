"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const nnia_1 = __importDefault(require("./routes/nnia"));
dotenv_1.default.config();
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'CARGADA' : 'VACÍA');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'CARGADA' : 'VACÍA');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY);
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
app.use((0, morgan_1.default)('dev'));
// Aquí se importarán las rutas de NNIA y Stripe
app.use('/nnia', nnia_1.default);
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor NNIA escuchando en puerto ${PORT}`);
});
