# BiaAuth — Plataforma Gratuita de Assinatura Digital 📄✍️

O **BiaAuth** é uma plataforma web gratuita de assinatura eletrônica de documentos em PDF, com autenticação via **Google (Gmail)** ou **gov.br**, validação de **CPF**, geração de **Manifesto e Certificado Criptográfico (SHA-256)** no próprio PDF e envio automático por e-mail.

---

## ✨ Funcionalidades

1. **Disponibilização de PDF pelo Proprietário:** Upload simples de documentos PDF com geração instantânea de link único de assinatura.
2. **Compartilhamento Rápido:** Botões para copiar o link ou enviar diretamente pelo WhatsApp.
3. **Visualizador Integrado:** O assinante lê o documento PDF diretamente na página antes de assinar.
4. **Autenticação Google (Gmail) ou gov.br:** Identificação obrigatória antes da assinatura.
5. **Dados do Assinante e Rubrica:**
   - Nome Completo (obrigatório)
   - CPF com máscara e validação matemática (obrigatório)
   - E-mail (facultativo)
   - Rubrica visual automática (caligráfica) ou desenhada na tela.
6. **Carimbo e Certificado no PDF:** Adiciona rodapé de validação em todas as páginas e anexa a página final de **Manifesto e Certificado de Assinatura Digital** com Hash SHA-256.
7. **Envio Automático por E-mail:**
   - Envia automaticamente o PDF assinado para o e-mail do **proprietário**.
   - Caso o **assinante** deseje, envia também uma cópia para o e-mail dele.

---

## 🚀 Como executar o projeto localmente

### Pré-requisitos
- [Node.js](https://nodejs.org/) instalado.

### Passo a passo
1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicie o servidor:
   ```bash
   npm start
   ```
   *(No Windows, você também pode dar dois cliques no arquivo `Iniciar_BiaAuth.bat`)*
3. Acesse no navegador:
   ```
   http://localhost:3000
   ```
