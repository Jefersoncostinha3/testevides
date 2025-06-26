// server.js (Última versão enviada e corrigida)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

const UPLOADS_ORIGINAL_DIR = path.join(__dirname, 'uploads', 'original');
const UPLOADS_PROCESSED_DIR = path.join(__dirname, 'uploads', 'processed');
const UPLOADS_THUMBS_DIR = path.join(__dirname, 'uploads', 'thumbnails');

mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado ao MongoDB!'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

const videoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    originalFilename: { type: String, required: true },
    processedFilename: { type: String, unique: true }, // Este campo é o que causa o erro se for null ou duplicado
    thumbnailFilename: { type: String },
    originalPath: { type: String, required: true },
    processedPath: { type: String },
    thumbnailPath: { type: String, default: '/placeholder-thumbnail.jpg' },
    uploadDate: { type: Date, default: Date.now }
});
const Video = mongoose.model('Video', videoSchema);

[UPLOADS_ORIGINAL_DIR, UPLOADS_PROCESSED_DIR, UPLOADS_THUMBS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_ORIGINAL_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não suportado. Apenas vídeos são permitidos!'), false);
        }
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/processed', express.static(UPLOADS_PROCESSED_DIR));
app.use('/uploads/thumbnails', express.static(UPLOADS_THUMBS_DIR)); 

app.post('/api/upload', upload.single('video'), async (req, res) => {
    let finalVideoFilename = null;
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo de vídeo enviado ou arquivo inválido.' });
        }

        const { title } = req.body;
        if (!title) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'O título do vídeo é obrigatório.' });
        }

        const originalVideoPath = req.file.path;
        finalVideoFilename = path.basename(originalVideoPath);
        const finalVideoPath = path.join(UPLOADS_PROCESSED_DIR, finalVideoFilename);
        const processedVideoPublicPath = `/uploads/processed/${finalVideoFilename}`;

        console.log(`Copiando vídeo de: ${originalVideoPath} para: ${finalVideoPath}`);
        
        await fs.promises.copyFile(originalVideoPath, finalVideoPath);
        await fs.promises.unlink(originalVideoPath);

        console.log('Vídeo copiado e original removido. Salvando metadados...');

        const newVideo = new Video({
            title: title,
            originalFilename: req.file.filename,
            processedFilename: finalVideoFilename, 
            originalPath: originalVideoPath, 
            processedPath: processedVideoPublicPath, 
        });

        await newVideo.save();
        res.status(201).json({ message: 'Vídeo enviado e salvo com sucesso (sem transcodificação)!', video: newVideo });

    } catch (error) {
        console.error('Erro FINAL no upload ou salvamento de vídeo (sem transcodificação):', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            console.log(`Tentando apagar arquivo original temporário (após erro): ${req.file.path}`);
            fs.unlinkSync(req.file.path);
        }
        if (finalVideoFilename) {
            const potentialFinalPath = path.join(UPLOADS_PROCESSED_DIR, finalVideoFilename);
            if (fs.existsSync(potentialFinalPath)) {
                console.log(`Tentando apagar arquivo processado (mas com erro): ${potentialFinalPath}`);
                fs.unlinkSync(potentialFinalPath);
            }
        }

        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: `O arquivo é muito grande. O tamanho máximo permitido é de 5 MB.` });
            }
            return res.status(400).json({ message: `Erro no upload: ${error.message}` });
        }
        res.status(500).json({ message: 'Erro interno do servidor ao enviar vídeo (sem transcodificação).', error: error.message });
    }
});

app.get('/api/videos', async (req, res) => {
    try {
        const videos = await Video.find().sort({ uploadDate: -1 });
        const formattedVideos = videos.map(video => ({
            _id: video._id,
            title: video.title,
            path: video.processedPath,
            thumbnailPath: video.thumbnailPath || '/placeholder-thumbnail.jpg',
            uploadDate: video.uploadDate
        }));
        res.status(200).json(formattedVideos);
    } catch (error) {
        console.error('Erro ao buscar vídeos:', error);
        res.status(500).json({ message: 'Erro interno do servidor ao buscar vídeos.', error: error.message });
    }
});

async function cleanAllVideos() {
    console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] Iniciando tarefa de limpeza de vídeos...`);
    try {
        const directoriesToClean = [UPLOADS_ORIGINAL_DIR, UPLOADS_PROCESSED_DIR, UPLOADS_THUMBS_DIR]; 

        for (const dir of directoriesToClean) {
            fs.readdir(dir, (err, files) => {
                if (err) {
                    console.error(`Erro ao ler diretório ${dir}:`, err);
                    return;
                }
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    fs.unlink(filePath, err => {
                        if (err) {
                            console.error(`Erro ao apagar o arquivo ${filePath}:`, err);
                        } else {
                            console.log(`Arquivo ${filePath} apagado com sucesso.`);
                        }
                    });
                }
            });
        }

        const result = await Video.deleteMany({});
        console.log(`Todos os ${result.deletedCount} registros de vídeos foram apagados do MongoDB.`);

        console.log('Tarefa de limpeza de vídeos concluída.');

    } catch (error) {
        console.error('Erro durante a limpeza de vídeos:', error);
    }
}

cron.schedule('0 */6 * * *', () => {
    cleanAllVideos();
}, {
    timezone: "America/Sao_Paulo"
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    // cleanAllVideos(); // Descomente aqui para limpar o DB e arquivos no início do servidor
});
