// server.js
require('dotenv').config(); // Carrega variáveis de ambiente do .env
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Para lidar com o sistema de arquivos
const cron = require('node-cron');
const ffmpeg = require('fluent-ffmpeg'); // Importa o ffmpeg

// Define o caminho para os binários do FFmpeg e FFprobe se não estiverem no PATH do sistema
// Geralmente não é necessário se FFmpeg estiver instalado corretamente e no PATH.
// ffmpeg.setFfmpegPath('/usr/bin/ffmpeg'); 
// ffmpeg.setFfprobePath('/usr/bin/ffprobe');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Define diretórios para uploads e arquivos processados
const UPLOADS_ORIGINAL_DIR = path.join(__dirname, 'uploads', 'original'); // Vídeos originais
const UPLOADS_PROCESSED_DIR = path.join(__dirname, 'uploads', 'processed'); // Vídeos transcodificados
const UPLOADS_THUMBS_DIR = path.join(__dirname, 'uploads', 'thumbnails'); // Miniaturas

// --- Conexão com o MongoDB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Conectado ao MongoDB!'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// --- Schema e Modelo do Vídeo ---
const videoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    originalFilename: { type: String, required: true }, // Nome do arquivo original no upload
    processedFilename: { type: String, unique: true }, // Nome do arquivo transcodificado
    thumbnailFilename: { type: String, unique: true }, // Nome do arquivo da miniatura
    originalPath: { type: String, required: true },     // Caminho para o vídeo original
    processedPath: { type: String },                    // Caminho para o vídeo transcodificado
    thumbnailPath: { type: String },                    // Caminho para a miniatura
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
        cb(null, UPLOADS_ORIGINAL_DIR); // Salva o arquivo original aqui
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
        const allowedMimes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']; // Adicione mais se necessário
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

// Serve os diretórios de vídeos processados e miniaturas estaticamente
app.use('/uploads/processed', express.static(UPLOADS_PROCESSED_DIR));
app.use('/uploads/thumbnails', express.static(UPLOADS_THUMBS_DIR));

// --- Funções de Processamento de Vídeo ---

// Função para gerar miniatura
function generateThumbnail(videoInputPath, outputFilename, callback) {
    const outputPath = path.join(UPLOADS_THUMBS_DIR, outputFilename);
    ffmpeg(videoInputPath)
        .screenshots({
            timestamps: ['00:00:01.000'], // Pega um frame no 1º segundo
            filename: outputFilename,
            folder: UPLOADS_THUMBS_DIR,
            size: '320x240' // Tamanho da miniatura
        })
        .on('end', () => {
            console.log(`Miniatura gerada: ${outputPath}`);
            callback(null, `/uploads/thumbnails/${outputFilename}`);
        })
        .on('error', (err) => {
            console.error('Erro ao gerar miniatura:', err);
            callback(err);
        });
}

// Função para transcodificar vídeo
function transcodeVideo(videoInputPath, outputFilename, callback) {
    const outputPath = path.join(UPLOADS_PROCESSED_DIR, outputFilename);
    
    // Cria uma instância do comando ffmpeg
    const command = ffmpeg(videoInputPath)
        .output(outputPath)
        .videoCodec('libx264') // Codec de vídeo padrão e compatível
        .audioCodec('aac')     // Codec de áudio padrão e compatível
        .format('mp4')         // Formato de saída MP4
        // --- NOVO TAMANHO DE RESOLUÇÃO: 480p de largura ---
        .size('480x?') // Reduz a resolução para 480px de largura, mantendo proporção.
        .addOption('-crf', '28') // Qualidade de vídeo. Valores mais altos (ex: 28) = menor qualidade/menor arquivo/mais rápido.
        .addOption('-preset', 'fast') // Velocidade de codificação. 'fast' é um bom equilíbrio, 'ultrafast' é mais rápido.
        .addOption('-movflags', 'faststart') // Otimiza para streaming web (metadados no início)
        // --- FIM DAS OPÇÕES ---
        .on('start', function(commandLine) {
            console.log('Spawned Ffmpeg with command: ' + commandLine);
        })
        .on('progress', function(progress) {
            console.log('Processing: ' + progress.percent + '% done');
        })
        .on('end', () => {
            console.log(`Vídeo transcodificado: ${outputPath}`);
            callback(null, `/uploads/processed/${outputFilename}`);
        })
        .on('error', (err, stdout, stderr) => {
            console.error('Erro ao transcodificar vídeo:', err.message);
            console.error('FFmpeg stdout:\n', stdout);
            console.error('FFmpeg stderr:\n', stderr);
            callback(err);
        });
        
    command.run(); // Executa o comando ffmpeg
}

// --- Rotas da API ---

// Rota de Upload de Vídeos
app.post('/api/upload', upload.single('video'), async (req, res) => {
    let processedFilename, thumbnailFilename; // Declarar fora do try para acesso no catch
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo de vídeo enviado ou arquivo inválido.' });
        }

        const { title } = req.body;
        if (!title) {
            fs.unlinkSync(req.file.path); // Remove o arquivo original se não tiver título
            return res.status(400).json({ message: 'O título do vídeo é obrigatório.' });
        }

        const originalVideoPath = req.file.path;
        const baseFilename = path.parse(req.file.filename).name;
        processedFilename = `${baseFilename}_processed.mp4`; // Atribuir aqui
        thumbnailFilename = `${baseFilename}_thumb.jpg`;     // Atribuir aqui

        console.log('Iniciando processamento de vídeo...');
        // Promessas para gerar miniatura e transcodificar o vídeo em paralelo
        const [thumbnailPublicPath, processedVideoPublicPath] = await Promise.all([
            new Promise((resolve, reject) => generateThumbnail(originalVideoPath, thumbnailFilename, (err, path) => err ? reject(err) : resolve(path))),
            new Promise((resolve, reject) => transcodeVideo(originalVideoPath, processedFilename, (err, path) => err ? reject(err) : resolve(path)))
        ]);
        console.log('Processamento de vídeo concluído (Promise.all resolvido).');

        // Opcional: Remover o vídeo original após o processamento bem-sucedido
        fs.unlink(originalVideoPath, (err) => {
            if (err) console.error(`Erro ao apagar arquivo original ${originalVideoPath}:`, err);
            else console.log(`Arquivo original ${originalVideoPath} apagado.`);
        });

        // Salva os metadados do vídeo (incluindo paths da miniatura e do vídeo processado)
        const newVideo = new Video({
            title: title,
            originalFilename: req.file.filename,
            processedFilename: processedFilename,
            thumbnailFilename: thumbnailFilename,
            originalPath: originalVideoPath,
            processedPath: processedVideoPublicPath,
            thumbnailPath: thumbnailPublicPath
        });

        await newVideo.save();
        res.status(201).json({ message: 'Vídeo enviado e processado com sucesso!', video: newVideo });

    } catch (error) {
        console.error('Erro FINAL no upload ou processamento de vídeo:', error);
        // Tenta remover os arquivos se o erro ocorreu APÓS o upload inicial
        if (req.file && fs.existsSync(req.file.path)) {
            console.log(`Tentando apagar original: ${req.file.path}`);
            fs.unlinkSync(req.file.path);
        }
        // Verificar se os nomes de arquivo foram definidos antes de tentar construir o path
        if (processedFilename) {
            const processedFilePath = path.join(UPLOADS_PROCESSED_DIR, processedFilename);
            if (fs.existsSync(processedFilePath)) {
                 console.log(`Tentando apagar processado: ${processedFilePath}`);
                 fs.unlinkSync(processedFilePath);
            }
        }
        if (thumbnailFilename) {
            const thumbnailFilePath = path.join(UPLOADS_THUMBS_DIR, thumbnailFilename);
            if (fs.existsSync(thumbnailFilePath)) {
                 console.log(`Tentando apagar miniatura: ${thumbnailFilePath}`);
                 fs.unlinkSync(thumbnailFilePath);
            }
        }

        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: `O arquivo é muito grande. O tamanho máximo permitido é de 5 MB.` });
            }
            return res.status(400).json({ message: `Erro no upload: ${error.message}` });
        }
        res.status(500).json({ message: 'Erro interno do servidor ao enviar e processar vídeo.', error: error.message });
    }
});

// Rota para Listar Vídeos (agora pegando o path do vídeo processado e da miniatura)
app.get('/api/videos', async (req, res) => {
    try {
        const videos = await Video.find().sort({ uploadDate: -1 }); // Busca os vídeos mais recentes primeiro
        // Mapeia para retornar apenas os paths processados e da miniatura para o frontend
        const formattedVideos = videos.map(video => ({
            _id: video._id,
            title: video.title,
            path: video.processedPath, // Usa o vídeo transcodificado
            thumbnailPath: video.thumbnailPath, // Usa a miniatura
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
        // 1. Apagar os arquivos físicos das pastas
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
