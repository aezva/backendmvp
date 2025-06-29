import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import nniaRoutes from './routes/nnia';

dotenv.config();
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'CARGADA' : 'VACÍA');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'CARGADA' : 'VACÍA');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

// Aquí se importarán las rutas de NNIA y Stripe
app.use('/nnia', nniaRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor NNIA escuchando en puerto ${PORT}`);
}); 