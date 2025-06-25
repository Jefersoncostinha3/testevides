// server.js
require('dotenv').config(); // Carrega variáveis de ambiente do .env
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Para lidar com o sistema de arquivos

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const UPLOADS_DIR = path.join(__dirname, 'uploads'); // Pasta para armazenar os vídeos

// --- Conexão com o MongoDB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado ao MongoDB!'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// --- Schema e Modelo do Vídeo ---
const videoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    filename: { type: String, required: true, unique: true }, // Nome do arquivo no servidor
    path: { type: String, required: true, unique: true },     // Caminho acessível via URL
    uploadDate: { type: Date, default: Date.now }
});
const Video = mongoose.model('Video', videoSchema);

// --- Configuração do Multer para Upload de Arquivos ---
// Cria a pasta 'uploads' se ela não existir
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR); // Onde os arquivos serão salvos
    },
    filename: (req, file, cb) => {
        // Gera um nome de arquivo único para evitar colisões
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
    }
});

// Filtro de arquivo para aceitar apenas vídeos e limitar o tamanho
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB em bytes
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['video/mp4', 'video/webm', 'video/ogg']; // Tipos MIME de vídeo comuns
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não suportado. Apenas vídeos (mp4, webm, ogg) são permitidos!'), false);
        }
    }
});

// --- Middlewares ---
app.use(express.json()); // Para parsear JSON
app.use(express.urlencoded({ extended: true })); // Para parsear dados de formulário
app.use(express.static(path.join(__dirname, 'public'))); // Serve os arquivos estáticos do front-end

// Serve a pasta de uploads estaticamente para que os vídeos possam ser acessados
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Rotas da API ---

// Rota de Upload de Vídeos
app.post('/api/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo de vídeo enviado ou arquivo inválido.' });
        }

        const { title } = req.body;
        if (!title) {
            // Se não houver título, exclui o arquivo que foi salvo
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'O título do vídeo é obrigatório.' });
        }

        // Salva os metadados do vídeo no MongoDB
        const newVideo = new Video({
            title: title,
            filename: req.file.filename,
            path: `/uploads/${req.file.filename}` // Caminho público para acessar o vídeo
        });

        await newVideo.save();
        res.status(201).json({ message: 'Vídeo enviado com sucesso!', video: newVideo });

    } catch (error) {
        console.error('Erro no upload de vídeo:', error);
        // Se houver um erro, tenta remover o arquivo se ele foi salvo
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        // Erro do Multer (ex: tamanho, tipo de arquivo)
        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: `O arquivo é muito grande. O tamanho máximo permitido é de 5 MB.` });
            }
            return res.status(400).json({ message: `Erro no upload: ${error.message}` });
        }
        res.status(500).json({ message: 'Erro interno do servidor ao enviar vídeo.', error: error.message });
    }
});

// Rota para Listar Vídeos
app.get('/api/videos', async (req, res) => {
    try {
        const videos = await Video.find().sort({ uploadDate: -1 }); // Busca os vídeos mais recentes
        res.status(200).json(videos);
    } catch (error) {
        console.error('Erro ao buscar vídeos:', error);
        res.status(500).json({ message: 'Erro interno do servidor ao buscar vídeos.', error: error.message });
    }
});

// Rota padrão para servir o index.html (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Inicia o Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});