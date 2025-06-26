// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadSection = document.getElementById('uploadSection');
    const uploadForm = document.getElementById('uploadForm');
    const videoFile = document.getElementById('videoFile');
    const videoTitleInput = document.getElementById('videoTitle');
    const message = document.getElementById('message');
    const videosContainer = document.getElementById('videosContainer');
    const loadingMessage = videosContainer.querySelector('.loading-message'); // Adicionado

    // Elementos da Barra de Progresso e Indicador de Processamento
    const progressBarContainer = document.getElementById('progressBarContainer');
    const progressBar = document.getElementById('progressBar');
    const processingIndicator = document.getElementById('processingIndicator');

    // Função para exibir mensagens com estilo e transição
    const showMessage = (text, type = 'info') => {
        message.textContent = text;
        message.className = `message show`; // Reseta classes
        message.setAttribute('data-type', type); // Adiciona tipo para CSS
    };

    // Função para ocultar mensagens
    const hideMessage = () => {
        message.classList.remove('show');
        // Opcional: Limpar o texto após a transição
        setTimeout(() => message.textContent = '', 400); 
    };

    // Função para buscar e exibir vídeos
    const fetchVideos = async () => {
        videosContainer.innerHTML = ''; // Limpa antes de carregar
        if (loadingMessage) {
            loadingMessage.classList.remove('hidden'); // Mostra a mensagem de carregamento
            videosContainer.appendChild(loadingMessage);
        }

        try {
            const response = await fetch('/api/videos');
            if (!response.ok) {
                throw new Error('Erro ao buscar vídeos.');
            }
            const videos = await response.json();
            
            videosContainer.innerHTML = ''; // Limpa novamente após a busca
            
            if (videos.length === 0) {
                videosContainer.innerHTML = '<p class="loading-message">Nenhum vídeo disponível ainda. Seja o primeiro a enviar!</p>';
                return;
            }

            videos.forEach(video => {
                const videoItem = document.createElement('div');
                videoItem.classList.add('video-item');
                videoItem.innerHTML = `
                    <video controls src="${video.path}" poster="${video.thumbnailPath}"></video>
                    <h3>${video.title}</h3>
                    <p class="upload-date">Enviado em: ${new Date(video.uploadDate).toLocaleDateString('pt-BR')}</p>
                `;
                videosContainer.appendChild(videoItem);
            });
        } catch (error) {
            console.error('Erro ao buscar vídeos:', error);
            videosContainer.innerHTML = `<p class="loading-message" style="color: var(--accent-color);">Não foi possível carregar os vídeos: ${error.message}</p>`;
        }
    };

    uploadBtn.addEventListener('click', () => {
        uploadSection.classList.toggle('hidden');
        if (!uploadSection.classList.contains('hidden')) {
            hideMessage(); // Esconde mensagem ao abrir
            // Esconde e reseta a barra de progresso e o indicador ao abrir a seção de upload
            progressBarContainer.style.display = 'none';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            processingIndicator.classList.add('hidden');
        }
    });

    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        hideMessage(); // Esconde mensagens anteriores

        // Resetar e esconder a barra de progresso e o indicador antes de um novo envio
        progressBarContainer.style.display = 'none';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        processingIndicator.classList.add('hidden');

        if (videoFile.files.length === 0) {
            showMessage('Por favor, selecione um arquivo de vídeo.', 'error');
            return;
        }

        const file = videoFile.files[0];
        const maxSize = 15 * 1024 * 1024; // 15 MB em bytes

        if (file.size > maxSize) {
            showMessage(`O arquivo é muito grande. O tamanho máximo permitido é de 15 MB. Seu arquivo tem ${(file.size / (1024 * 1024)).toFixed(2)} MB.`, 'error');
            return;
        }

        const videoTitle = videoTitleInput.value.trim();
        if (!videoTitle) {
            showMessage('Por favor, insira um título para o vídeo.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('video', file);
        formData.append('title', videoTitle);

        // Mostrar a barra de progresso
        progressBarContainer.style.display = 'block';
        showMessage('Iniciando envio...', 'info');

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);

            // Evento de progresso do upload
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    progressBar.style.width = percentComplete + '%';
                    progressBar.textContent = Math.round(percentComplete) + '%';
                    showMessage(`Enviando vídeo: ${Math.round(percentComplete)}%`, 'info');
                }
            });

            // Evento quando o upload termina (sucesso ou falha)
            xhr.addEventListener('load', () => {
                processingIndicator.classList.add('hidden'); // Esconde o indicador de processamento ao receber resposta

                if (xhr.status >= 200 && xhr.status < 300) {
                    // Sucesso
                    const result = JSON.parse(xhr.responseText);
                    showMessage('Vídeo enviado e salvo com sucesso!', 'success');
                    uploadForm.reset();
                    uploadSection.classList.add('hidden');
                    progressBarContainer.style.display = 'none';
                    progressBar.style.width = '0%';
                    progressBar.textContent = '0%';
                    fetchVideos(); // Atualiza a lista de vídeos
                } else {
                    // Erro
                    const errorData = JSON.parse(xhr.responseText);
                    showMessage(`Erro ao enviar o vídeo: ${errorData.message || 'Erro desconhecido.'}`, 'error');
                    progressBarContainer.style.display = 'none';
                    progressBar.style.width = '0%';
                    progressBar.textContent = '0%';
                }
            });

            // Evento de erro de rede
            xhr.addEventListener('error', () => {
                processingIndicator.classList.add('hidden');
                showMessage(`Erro de rede ou servidor.`, 'error');
                progressBarContainer.style.display = 'none';
                progressBar.style.width = '0%';
                progressBar.textContent = '0%';
                console.error('Erro no upload via XHR:', xhr.statusText);
            });

            xhr.send(formData);
            
            showMessage('Vídeo enviado. Salvando no servidor...', 'info');
            processingIndicator.classList.remove('hidden');

        } 
        catch (error) {
            showMessage(`Erro inesperado: ${error.message}`, 'error');
            progressBarContainer.style.display = 'none';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            processingIndicator.classList.add('hidden');
            console.error('Erro geral no script:', error);
        }
    });

    fetchVideos(); // Carrega vídeos ao iniciar a página
});
