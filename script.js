// script.js
document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadSection = document.getElementById('uploadSection');
    const uploadForm = document.getElementById('uploadForm');
    const videoFile = document.getElementById('videoFile');
    const message = document.getElementById('message');

    uploadBtn.addEventListener('click', () => {
        uploadSection.classList.toggle('hidden'); // Alterna a visibilidade da seção de upload
    });

    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Impede o envio padrão do formulário

        message.textContent = ''; // Limpa mensagens anteriores

        if (videoFile.files.length === 0) {
            message.textContent = 'Por favor, selecione um arquivo de vídeo.';
            return;
        }

        const file = videoFile.files[0];
        const maxSize = 10 * 1024 * 1024; // 10 MB em bytes

        if (file.size > maxSize) {
            message.textContent = `O arquivo é muito grande. O tamanho máximo permitido é de 10 MB. Seu arquivo tem ${Math.round(file.size / (1024 * 1024))} MB.`;
            return;
        }

        // --- ATENÇÃO: ESTA É A PARTE QUE REQUER UM BACK-END ---
        // Aqui você faria uma requisição para o seu servidor (back-end)
        // para realmente enviar o arquivo.

        // Exemplo de como seria o fetch (apenas ilustrativo, não funcionará sem um servidor)
        // const formData = new FormData();
        // formData.append('video', file);
        // formData.append('title', document.getElementById('videoTitle').value);

        // try {
        //     const response = await fetch('/upload-video', { // Substitua '/upload-video' pela sua rota de API
        //         method: 'POST',
        //         body: formData,
        //     });

        //     if (response.ok) {
        //         const result = await response.json();
        //         message.textContent = 'Vídeo enviado com sucesso!';
        //         message.style.color = 'green';
        //         uploadForm.reset(); // Limpa o formulário
        //         uploadSection.classList.add('hidden'); // Esconde a seção de upload
        //         // Aqui você poderia adicionar o vídeo à lista na interface
        //     } else {
        //         const errorText = await response.text();
        //         message.textContent = `Erro ao enviar o vídeo: ${errorText}`;
        //         message.style.color = 'red';
        //     }
        // } catch (error) {
        //     message.textContent = `Erro de rede ou servidor: ${error.message}`;
        //     message.style.color = 'red';
        // }
        // -----------------------------------------------------

        // Para fins de demonstração SEM BACK-END:
        message.textContent = `Arquivo "${file.name}" (Tamanho: ${Math.round(file.size / (1024 * 1024))} MB) pronto para ser enviado. Necessita de um servidor para o upload real.`;
        message.style.color = 'orange';
    });
});