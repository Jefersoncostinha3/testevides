// server.js
require('dotenv').config(); // Carrega variáveis de ambiente do .env
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Para lidar com o sistema de arquivos
const cron = require('node-cron');
// const ffmpeg = require('fluent-ffmpeg'); // Não precisamos mais do ffmpeg

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Define diretórios para uploads e arquivos processados
const UPLOADS_ORIGINAL_DIR = path.join(__dirname, 'uploads', 'original'); // Vídeos originais (serão temporários)
const UPLOADS_PROCESSED_DIR = path.join(__dirname, 'uploads', 'processed'); // Vídeos "finalizados"
const UPLOADS_THUMBS_DIR = path.join(__dirname, 'uploads', 'thumbnails'); // Miniaturas (não serão mais geradas automaticamente)

// --- Conexão com o MongoDB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado ao MongoDB!'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// --- Schema e Modelo do Vídeo ---
const videoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    originalFilename: { type: String, required: true }, // Nome do arquivo original
    processedFilename: { type: String, unique: true }, // Agora será o mesmo que originalFilename, mas movido para 'processed'
    thumbnailFilename: { type: String }, // Não será mais gerado automaticamente
    originalPath: { type: String, required: true },     // Caminho para o vídeo original temporário
    processedPath: { type: String },                    // Caminho para o vídeo final
    thumbnailPath: { type: String, default: '/placeholder-thumbnail.jpg' }, // Placeholder para a miniatura
    uploadDate: { type: Date, default: Date.now }
});
const Video = mongoose.model('Video', videoSchema);

// --- Configuração do Multer para Upload de Arquivos Originais ---
// Garante que os diretórios existam
[UPLOADS_ORIGINAL_DIR, UPLOADS_PROCESSED_DIR, UPLOADS_THUMBS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_ORIGINAL_DIR); // Salva o arquivo original temporariamente aqui
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
        fileSize: 5 * 1024 * 1024 // Limite de 5 MB
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']; // MP4, WebM, OGG, MOV, AVI, MKV
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não suportado. Apenas vídeos são permitidos!'), false);
        }
    }
});

// --- Middlewares ---
app.use(express.json()); // Para parsear JSON
app.use(express.urlencoded({ extended: true })); // Para parsear dados de formulário (do formulário HTML)
app.use(express.static(path.join(__dirname, 'public'))); // Serve os arquivos estáticos do front-end

// Serve os diretórios de vídeos processados estaticamente
app.use('/uploads/processed', express.static(UPLOADS_PROCESSED_DIR));
app.use('/uploads/thumbnails', express.static(UPLOADS_THUMBS_DIR)); 

// --- Rotas da API ---

// Rota de Upload de Vídeos (AGORA SEM TRANSCODIFICAÇÃO)
app.post('/api/upload', upload.single('video'), async (req, res) => {
    let finalVideoFilename = null; // Para cleanup em caso de erro
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo de vídeo enviado ou arquivo inválido.' });
        }

        const { title } = req.body;
        if (!title) {
            fs.unlinkSync(req.file.path); // Remove o arquivo original se não tiver título
            return res.status(400).json({ message: 'O título do vídeo é obrigatório.' });
        }

        const originalVideoPath = req.file.path; // Caminho temporário do arquivo recém-subido

        // Define o nome do arquivo final e o caminho de destino
        finalVideoFilename = path.basename(originalVideoPath);
        const finalVideoPath = path.join(UPLOADS_PROCESSED_DIR, finalVideoFilename);
        const processedVideoPublicPath = `/uploads/processed/${finalVideoFilename}`;

        console.log(`Copiando vídeo de: ${originalVideoPath} para: ${finalVideoPath}`);
        
        // --- ALTERAÇÃO AQUI: Usando copyFile e unlink em vez de rename ---
        await fs.promises.copyFile(originalVideoPath, finalVideoPath); // Copia o arquivo
        await fs.promises.unlink(originalVideoPath); // Apaga o arquivo original temporário
        // --- FIM DA ALTERAÇÃO ---

        console.log('Vídeo copiado e original removido. Salvando metadados...');

        // Salva os metadados do vídeo
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
        
        // Tenta remover o arquivo original temporário se ainda existir
        if (req.file && fs.existsSync(req.file.path)) {
            console.log(`Tentando apagar arquivo original temporário (após erro): ${req.file.path}`);
            fs.unlinkSync(req.file.path);
        }
        // Tenta remover o arquivo já copiado para processed, se o erro ocorreu após a cópia
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

// Rota para Listar Vídeos
app.get('/api/videos', async (req, res) => {
    try {
        const videos = await Video.find().sort({ uploadDate: -1 }); // Busca os vídeos mais recentes primeiro
        const formattedVideos = videos.map(video => ({
            _id: video._id,
            title: video.title,
            path: video.processedPath, // Usa o caminho para o vídeo salvo (original)
            thumbnailPath: video.thumbnailPath || '/placeholder-thumbnail.jpg', // Usa o default se thumbnail não existir
            uploadDate: video.uploadDate
        }));
        res.status(200).json(formattedVideos);
    } catch (error) {
        console.error('Erro ao buscar vídeos:', error);
        res.status(500).json({ message: 'Erro interno do servidor ao buscar vídeos.', error: error.message });
    }
});

// --- FUNÇÃO DE LIMPEZA DE VÍDEOS E METADADOS ---
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

        // 2. Apagar todos os registros de vídeos do MongoDB
        const result = await Video.deleteMany({});
        console.log(`Todos os ${result.deletedCount} registros de vídeos foram apagados do MongoDB.`);

        console.log('Tarefa de limpeza de vídeos concluída.');

    } catch (error) {
        console.error('Erro durante a limpeza de vídeos:', error);
    }
}

// --- AGENDADOR (CRON JOB) ---
cron.schedule('0 */6 * * *', () => {
    cleanAllVideos();
}, {
    timezone: "America/Sao_Paulo" // Ou o fuso horário que você desejar
});

// Rota padrão para servir o index.html (SPA - Single Page Application)
// Garante que o refresh da página ou acesso direto a rotas não existentes
// carregue o seu app React/Vue/Vanilla JS.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Inicia o Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    // Opcional: Limpar ao iniciar o servidor pela primeira vez
    // cleanAllVideos();
});
