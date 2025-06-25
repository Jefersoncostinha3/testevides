// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadSection = document.getElementById('uploadSection');
    const uploadForm = document.getElementById('uploadForm');
    const videoFile = document.getElementById('videoFile');
    const videoTitleInput = document.getElementById('videoTitle'); // Pegar o input do título
    const message = document.getElementById('message');
    const videosContainer = document.getElementById('videosContainer');

    // Função para buscar e exibir vídeos
    const fetchVideos = async () => {
        try {
            const response = await fetch('/api/videos'); // Rota da API para buscar vídeos
            if (!response.ok) {
                throw new Error('Erro ao buscar vídeos.');
            }
            const videos = await response.json();
            videosContainer.innerHTML = ''; // Limpa a lista existente

            if (videos.length === 0) {
                videosContainer.innerHTML = '<p>Nenhum vídeo disponível ainda. Seja o primeiro a enviar!</p>';
                return;
            }

            videos.forEach(video => {
                const videoItem = document.createElement('div');
                videoItem.classList.add('video-item');
                videoItem.innerHTML = `
                    <video controls src="${video.path}" poster="${video.thumbnailPath || ''}"></video>
                    <h3>${video.title}</h3>
                    <p>${video.description || ''}</p>
                `;
                videosContainer.appendChild(videoItem);
            });
        } catch (error) {
            console.error('Erro ao buscar vídeos:', error);
            videosContainer.innerHTML = `<p style="color: red;">Não foi possível carregar os vídeos: ${error.message}</p>`;
        }
    };

    // Alterna a visibilidade da seção de upload
    uploadBtn.addEventListener('click', () => {
        uploadSection.classList.toggle('hidden');
        if (!uploadSection.classList.contains('hidden')) {
            message.textContent = ''; // Limpa a mensagem ao abrir
        }
    });

    // Lógica para envio do formulário
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Impede o envio padrão do formulário

        message.textContent = ''; // Limpa mensagens anteriores
        message.style.color = 'red'; // Cor padrão para erros

        if (videoFile.files.length === 0) {
            message.textContent = 'Por favor, selecione um arquivo de vídeo.';
            return;
        }

        const file = videoFile.files[0];
        const maxSize = 5 * 1024 * 1024; // 5 MB em bytes

        if (file.size > maxSize) {
            message.textContent = `O arquivo é muito grande. O tamanho máximo permitido é de 5 MB. Seu arquivo tem ${(file.size / (1024 * 1024)).toFixed(2)} MB.`;
            return;
        }

        const videoTitle = videoTitleInput.value.trim();
        if (!videoTitle) {
            message.textContent = 'Por favor, insira um título para o vídeo.';
            return;
        }

        // Cria um objeto FormData para enviar o arquivo e o título
        const formData = new FormData();
        formData.append('video', file); // 'video' é o nome do campo esperado no back-end
        formData.append('title', videoTitle); // 'title' é o nome do campo esperado no back-end

        try {
            message.textContent = 'Enviando vídeo... Por favor, aguarde.';
            message.style.color = 'blue';

            // Faz a requisição POST para o seu back-end
            const response = await fetch('/api/upload', { // Rota da API para upload
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const result = await response.json();
                message.textContent = 'Vídeo enviado com sucesso!';
                message.style.color = 'green';
                uploadForm.reset(); // Limpa o formulário
                uploadSection.classList.add('hidden'); // Esconde a seção de upload
                fetchVideos(); // Atualiza a lista de vídeos
            } else {
                const errorData = await response.json(); // Pega a mensagem de erro do back-end
                message.textContent = `Erro ao enviar o vídeo: ${errorData.message || 'Erro desconhecido.'}`;
                message.style.color = 'red';
            }
        } catch (error) {
            message.textContent = `Erro de rede ou servidor: ${error.message}`;
            message.style.color = 'red';
            console.error('Erro no upload:', error);
        }
    });

    // Carrega os vídeos quando a página é carregada
    fetchVideos();
});