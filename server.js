require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Diretórios de armazenamento
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_ORIG_DIR = path.join(__dirname, 'uploads', 'originals');
const UPLOADS_SIGNED_DIR = path.join(__dirname, 'uploads', 'signed');

[DATA_DIR, UPLOADS_ORIG_DIR, UPLOADS_SIGNED_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const DB_FILE = path.join(DATA_DIR, 'db.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ documents: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return { documents: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function cleanClientId(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const match = s.match(/([a-zA-Z0-9_-]+\.apps\.googleusercontent\.com)/i);
  if (match) return match[1];
  return s.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    const initial = {
      googleScriptUrl: (process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbybLYUxr9WrFVTsnjfeSD1ZFYE7lC357TRgucoUr7L-CGIhv61ohvaVWQ9_-7v8UJg7/exec').trim(),
      googleClientId: cleanClientId(process.env.GOOGLE_CLIENT_ID || '123122288720-p9h5ihla4u883kdpjh963s17g2ru3aki.apps.googleusercontent.com'),
      smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
      smtpPort: Number(process.env.SMTP_PORT || 587),
      smtpUser: process.env.SMTP_USER || '',
      smtpPass: process.env.SMTP_PASS || '',
      fromName: process.env.FROM_NAME || 'BiaAuth - Assinatura Digital'
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return {
      googleScriptUrl: (parsed.googleScriptUrl || process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbybLYUxr9WrFVTsnjfeSD1ZFYE7lC357TRgucoUr7L-CGIhv61ohvaVWQ9_-7v8UJg7/exec').trim(),
      googleClientId: cleanClientId(parsed.googleClientId || process.env.GOOGLE_CLIENT_ID || '123122288720-p9h5ihla4u883kdpjh963s17g2ru3aki.apps.googleusercontent.com'),
      smtpHost: parsed.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com',
      smtpPort: Number(parsed.smtpPort || process.env.SMTP_PORT || 587),
      smtpUser: parsed.smtpUser || process.env.SMTP_USER || '',
      smtpPass: parsed.smtpPass || process.env.SMTP_PASS || '',
      fromName: parsed.fromName || process.env.FROM_NAME || 'BiaAuth - Assinatura Digital'
    };
  } catch (e) {
    return {
      googleScriptUrl: (process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbybLYUxr9WrFVTsnjfeSD1ZFYE7lC357TRgucoUr7L-CGIhv61ohvaVWQ9_-7v8UJg7/exec').trim(),
      googleClientId: cleanClientId(process.env.GOOGLE_CLIENT_ID || '123122288720-p9h5ihla4u883kdpjh963s17g2ru3aki.apps.googleusercontent.com')
    };
  }
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Middlewares
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do Multer para upload de PDFs
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_ORIG_DIR);
  },
  filename: (req, file, cb) => {
    const docId = crypto.randomBytes(6).toString('hex');
    req.generatedDocId = docId;
    cb(null, `${docId}.pdf`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos PDF são permitidos.'));
    }
  }
});

// Função auxiliar para garantir texto compatível com WinAnsi (pdf-lib StandardFonts)
function safePdfText(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

// Função para calcular SHA-256 de um arquivo
function computeFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Validação de CPF
function isValidCPF(cpf) {
  const clean = String(cpf || '').replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(9), 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(10), 10)) return false;

  return true;
}

function formatCPF(cpf) {
  const clean = String(cpf || '').replace(/\D/g, '');
  if (clean.length !== 11) return cpf;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

// Gera um PDF assinado EXCLUSIVO e INDIVIDUAL para um único signatário, sem alterar o documento original
async function buildIndividualSignedPdf(docRecord, sig) {
  const origBytes = fs.readFileSync(docRecord.originalPath);
  const pdfDoc = await PDFDocument.load(origBytes);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const originalPages = pdfDoc.getPages();

  // Carimba um rodapé discreto em todas as páginas originais referente exclusivamente a este assinante
  originalPages.forEach((page, idx) => {
    const { width } = page.getSize();
    page.drawRectangle({
      x: 20,
      y: 8,
      width: width - 40,
      height: 18,
      color: rgb(0.95, 0.97, 1),
      borderColor: rgb(0.75, 0.82, 0.95),
      borderWidth: 0.5
    });

    const footerText = safePdfText(
      `Assinado digitalmente por: ${sig.fullName} (CPF: ${sig.cpf}) | Cod: ${sig.verificationCode} | Pag. ${idx + 1}/${originalPages.length}`
    );
    page.drawText(footerText, {
      x: 26,
      y: 14,
      size: 7,
      font: fontRegular,
      color: rgb(0.15, 0.25, 0.45)
    });
  });

  // Adiciona página de Manifesto / Certificado de Assinatura Digital Individual
  const certPage = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = certPage.getSize();

  // Faixa superior azul escuro / índigo
  certPage.drawRectangle({
    x: 0,
    y: height - 85,
    width: width,
    height: 85,
    color: rgb(0.08, 0.16, 0.36)
  });

  certPage.drawText(safePdfText('MANIFESTO E CERTIFICADO DE ASSINATURA DIGITAL'), {
    x: 36,
    y: height - 38,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  certPage.drawText(
    safePdfText(
      `Plataforma BiaAuth | Validade Juridica conforme MP 2.200-2/2001 e Lei 14.063/2020 | ID: ${docRecord.id.toUpperCase()}`
    ),
    {
      x: 36,
      y: height - 58,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.8, 0.88, 1)
    }
  );

  // Quadro de resumo do documento
  certPage.drawRectangle({
    x: 36,
    y: height - 185,
    width: width - 72,
    height: 84,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.82, 0.86, 0.92),
    borderWidth: 1
  });

  certPage.drawText(safePdfText('DADOS DO DOCUMENTO ORIGINAL'), {
    x: 48,
    y: height - 118,
    size: 9.5,
    font: fontBold,
    color: rgb(0.1, 0.2, 0.4)
  });

  certPage.drawText(safePdfText(`Documento: ${docRecord.title}`), {
    x: 48,
    y: height - 134,
    size: 9,
    font: fontRegular,
    color: rgb(0.2, 0.2, 0.2)
  });

  certPage.drawText(safePdfText(`Proprietario: ${docRecord.ownerName} (${docRecord.ownerEmail})`), {
    x: 48,
    y: height - 149,
    size: 9,
    font: fontRegular,
    color: rgb(0.2, 0.2, 0.2)
  });

  certPage.drawText(safePdfText(`Hash SHA-256 Original: ${docRecord.originalHash}`), {
    x: 48,
    y: height - 165,
    size: 8,
    font: fontRegular,
    color: rgb(0.35, 0.35, 0.35)
  });

  const cursorY = height - 210;

  certPage.drawText(safePdfText('CERTIFICADO DE ASSINATURA INDIVIDUAL'), {
    x: 36,
    y: cursorY,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.16, 0.36)
  });

  const cardHeight = 145;
  const boxTop = cursorY - 16;
  const boxBottom = boxTop - cardHeight;

  // Card da assinatura única
  certPage.drawRectangle({
    x: 36,
    y: boxBottom,
    width: width - 72,
    height: cardHeight,
    color: rgb(1, 1, 1),
    borderColor: sig.authProvider === 'govbr' ? rgb(0.07, 0.32, 0.71) : rgb(0.18, 0.52, 0.35),
    borderWidth: 1.2
  });

  // Faixa lateral indicadora do provedor
  certPage.drawRectangle({
    x: 36,
    y: boxBottom,
    width: 6,
    height: cardHeight,
    color: sig.authProvider === 'govbr' ? rgb(0.07, 0.32, 0.71) : rgb(0.18, 0.52, 0.35)
  });

  const providerLabel =
    sig.authProvider === 'govbr'
      ? 'AUTENTICADO VIA GOV.BR'
      : 'AUTENTICADO VIA GOOGLE (GMAIL)';

  certPage.drawText(safePdfText(`SIGNATARIO - ${providerLabel}`), {
    x: 52,
    y: boxTop - 20,
    size: 9.5,
    font: fontBold,
    color: sig.authProvider === 'govbr' ? rgb(0.07, 0.32, 0.71) : rgb(0.15, 0.45, 0.28)
  });

  certPage.drawText(safePdfText(`Nome Completo: ${sig.fullName}`), {
    x: 52,
    y: boxTop - 38,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1)
  });

  certPage.drawText(
    safePdfText(`CPF: ${sig.cpf}   |   E-mail: ${sig.email}`),
    {
      x: 52,
      y: boxTop - 55,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.2, 0.2, 0.2)
    }
  );

  certPage.drawText(
    safePdfText(
      `Conta Autenticada: ${sig.authAccount || sig.fullName}   |   Data/Hora: ${sig.signedAtFormatted}   |   IP: ${sig.ip}`
    ),
    {
      x: 52,
      y: boxTop - 71,
      size: 8,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3)
    }
  );

  certPage.drawText(safePdfText(`Codigo de Verificacao: ${sig.verificationCode}`), {
    x: 52,
    y: boxTop - 87,
    size: 8.5,
    font: fontBold,
    color: rgb(0.15, 0.25, 0.45)
  });

  certPage.drawText(safePdfText(`Hash da Assinatura: ${sig.signatureHash}`), {
    x: 52,
    y: boxTop - 103,
    size: 7.2,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4)
  });

  // Área da rubrica / assinatura visual no canto direito do card
  certPage.drawRectangle({
    x: width - 210,
    y: boxBottom + 18,
    width: 162,
    height: 55,
    color: rgb(0.98, 0.99, 1),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 0.7
  });

  let drewImage = false;
  if (sig.signatureImage && sig.signatureImage.startsWith('data:image/png;base64,')) {
    try {
      const base64Data = sig.signatureImage.replace(/^data:image\/png;base64,/, '');
      const pngImage = await pdfDoc.embedPng(Buffer.from(base64Data, 'base64'));
      certPage.drawImage(pngImage, {
        x: width - 204,
        y: boxBottom + 24,
        width: 150,
        height: 43
      });
      drewImage = true;
    } catch (err) {
      drewImage = false;
    }
  }

  if (!drewImage) {
    certPage.drawText(safePdfText(sig.fullName), {
      x: width - 198,
      y: boxBottom + 40,
      size: 13,
      font: fontItalic,
      color: rgb(0.08, 0.18, 0.45)
    });
  }

  certPage.drawText(safePdfText('Assinatura Eletronica Validada'), {
    x: width - 185,
    y: boxBottom + 8,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.45, 0.45, 0.45)
  });

  // Rodapé do certificado
  certPage.drawText(
    safePdfText(
      'Este documento foi assinado eletronicamente de forma individual na plataforma BiaAuth. Integridade garantida por SHA-256.'
    ),
    {
      x: 36,
      y: 28,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4)
    }
  );

  const signedPdfBytes = await pdfDoc.save();
  const individualSignedPath = path.join(UPLOADS_SIGNED_DIR, `${docRecord.id}_${sig.id}.pdf`);
  fs.writeFileSync(individualSignedPath, signedPdfBytes);
  sig.signedPath = individualSignedPath;
  sig.signedHash = computeFileHash(individualSignedPath);
  return individualSignedPath;
}

// Configura o transportador de e-mail (Usa SMTP real se configurado, ou cria conta de teste Ethereal automaticamente)
let cachedTestAccount = null;

async function getMailTransporter() {
  const settings = readSettings();

  if (settings.smtpUser && settings.smtpPass) {
    return {
      isRealSmtp: true,
      fromAddress: `"${settings.fromName || 'BiaAuth'}" <${settings.smtpUser}>`,
      transporter: nodemailer.createTransport({
        host: settings.smtpHost || 'smtp.gmail.com',
        port: Number(settings.smtpPort || 587),
        secure: Number(settings.smtpPort) === 465,
        auth: {
          user: settings.smtpUser,
          pass: settings.smtpPass
        }
      })
    };
  }

  if (!cachedTestAccount) {
    cachedTestAccount = await nodemailer.createTestAccount();
  }

  return {
    isRealSmtp: false,
    fromAddress: `"BiaAuth - Assinatura Digital" <${cachedTestAccount.user}>`,
    transporter: nodemailer.createTransport({
      host: cachedTestAccount.smtp.host,
      port: cachedTestAccount.smtp.port,
      secure: cachedTestAccount.smtp.secure,
      auth: {
        user: cachedTestAccount.user,
        pass: cachedTestAccount.pass
      }
    })
  };
}

// Envia os e-mails automáticos OBRIGATORIAMENTE para o Proprietário e para o Signatário
async function sendSignatureEmails(docRecord, signature) {
  const results = {
    ownerEmailSent: false,
    ownerEmailPreviewUrl: null,
    signerEmailSent: false,
    signerEmailPreviewUrl: null,
    isRealSmtp: false,
    error: null
  };

  const settings = readSettings();
  const providerName =
    signature.authProvider === 'govbr' ? 'Gov.br (Governo Federal)' : 'Google (Gmail)';
  const safeSignerName = signature.fullName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFileName = `${docRecord.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_Assinado_${safeSignerName}.pdf`;
  const pdfFilePath = signature.signedPath || docRecord.signedPath;

  const ownerHtml = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #1e3a8a, #2563eb); color: #ffffff; padding: 24px;">
        <h2 style="margin: 0; font-size: 20px;">Documento Assinado Digitalmente!</h2>
        <p style="margin: 6px 0 0; opacity: 0.9; font-size: 14px;">Plataforma BiaAuth - Notificação Automática ao Proprietário</p>
      </div>
      <div style="padding: 24px; color: #1e293b; background: #ffffff;">
        <p>Olá, <strong>${docRecord.ownerName}</strong>!</p>
        <p>O documento <strong>"${docRecord.title}"</strong> que você disponibilizou acabou de ser assinado digitalmente de forma individual. O arquivo PDF exclusivo desta assinatura segue <strong>em anexo neste e-mail</strong>.</p>
        
        <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px; font-size: 15px; color: #1e3a8a;">Dados do Signatário</h3>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Nome Completo:</strong> ${signature.fullName}</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>CPF:</strong> ${signature.cpf}</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>E-mail do Signatário:</strong> ${signature.email}</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Autenticação:</strong> ${providerName} (${signature.authAccount})</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Data e Hora:</strong> ${signature.signedAtFormatted}</p>
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Código de Verificação:</strong> ${signature.verificationCode}</p>
        </div>

        <p style="font-size: 13px; color: #64748b;">O PDF anexado contém o certificado individual e o hash criptográfico SHA-256 de integridade.</p>
      </div>
    </div>
  `;

  const signerHtml = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #0f766e, #10b981); color: #ffffff; padding: 24px;">
        <h2 style="margin: 0; font-size: 20px;">Sua Cópia do Documento Assinado</h2>
        <p style="margin: 6px 0 0; opacity: 0.9; font-size: 14px;">Comprovante e Arquivo PDF Assinado - BiaAuth</p>
      </div>
      <div style="padding: 24px; color: #1e293b; background: #ffffff;">
        <p>Olá, <strong>${signature.fullName}</strong>!</p>
        <p>Enviamos em anexo a sua via oficial do documento <strong>"${docRecord.title}"</strong> assinado digitalmente por você para o seu arquivo pessoal.</p>
        
        <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; border-radius: 6px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px; font-size: 15px; color: #065f46;">Resumo da sua Assinatura</h3>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Documento:</strong> ${docRecord.title}</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Proprietário:</strong> ${docRecord.ownerName} (${docRecord.ownerEmail})</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Signatário:</strong> ${signature.fullName} (CPF: ${signature.cpf})</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Login utilizado:</strong> ${providerName}</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Data/Hora:</strong> ${signature.signedAtFormatted}</p>
          <p style="margin: 4px 0; font-size: 13px; color: #065f46;"><strong>Código de Verificação:</strong> ${signature.verificationCode}</p>
        </div>

        <p style="font-size: 13px; color: #64748b;">Guarde este e-mail e o arquivo PDF em anexo para seus registros.</p>
      </div>
    </div>
  `;

  // Helper para chamar o Google Apps Script tratando redirecionamentos POST -> GET e verificando erros do script
  async function sendViaGoogleAppsScript(payload) {
    const response = await fetch(settings.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {}

    if (parsed && parsed.ok === true) {
      return { ok: true };
    }
    if (parsed && parsed.error) {
      return { ok: false, error: parsed.error };
    }
    // Se o Apps Script retornou página HTML de login/permissão ou erro de execução
    if (text.includes('script.google.com') || text.includes('<!DOCTYPE html>') || !response.ok) {
      return {
        ok: false,
        error: 'O Google Apps Script exigiu permissão ou retornou página HTML. Verifique se foi implantado como "Qualquer pessoa" (Anyone).'
      };
    }
    return { ok: response.ok };
  }

  // MODO 1: Envio Real via Google Apps Script (HTTPS - Funciona 100% no plano gratuito do Render!)
  if (settings.googleScriptUrl && settings.googleScriptUrl.startsWith('https://script.google.com')) {
    try {
      const pdfBase64 = fs.readFileSync(pdfFilePath).toString('base64');

      // 1) Envia OBRIGATORIAMENTE para o proprietário cadastrado
      if (docRecord.ownerEmail) {
        const ownerCheck = await sendViaGoogleAppsScript({
          to: docRecord.ownerEmail.trim(),
          subject: `[BiaAuth] Documento Assinado: "${docRecord.title}" por ${signature.fullName}`,
          htmlBody: ownerHtml,
          fileName: safeFileName,
          pdfBase64
        });
        if (ownerCheck.ok) {
          results.ownerEmailSent = true;
          results.isRealSmtp = true;
        } else {
          results.error = ownerCheck.error;
        }
      }

      // 2) Envia OBRIGATORIAMENTE para o signatário (para seu arquivo pessoal)
      if (signature.email) {
        const signerCheck = await sendViaGoogleAppsScript({
          to: signature.email.trim(),
          subject: `[BiaAuth] Sua Cópia do Documento Assinado: "${docRecord.title}"`,
          htmlBody: signerHtml,
          fileName: safeFileName,
          pdfBase64
        });
        if (signerCheck.ok) {
          results.signerEmailSent = true;
          results.isRealSmtp = true;
        } else if (!results.error) {
          results.error = signerCheck.error;
        }
      }

      // Se ambos (ou o proprietário) foram enviados com sucesso pelo Google Script, retorna!
      // Caso tenha falhado, cai para o MODO 2 (SMTP / Ethereal) como contingência para não perder o comprovante
      return results;
    } catch (err) {
      console.error('Erro ao enviar via Google Apps Script:', err);
      results.error = err.message;
    }
  }

  // MODO 2: SMTP / Ethereal (Contingência ou quando SMTP direto está configurado)
  try {
    const { transporter, fromAddress, isRealSmtp } = await getMailTransporter();
    if (isRealSmtp) results.isRealSmtp = true;

    if (!results.ownerEmailSent && docRecord.ownerEmail) {
      const ownerInfo = await transporter.sendMail({
        from: fromAddress,
        to: docRecord.ownerEmail.trim(),
        subject: `[BiaAuth] Documento Assinado: "${docRecord.title}" por ${signature.fullName}`,
        html: ownerHtml,
        attachments: [
          {
            filename: safeFileName,
            path: pdfFilePath,
            contentType: 'application/pdf'
          }
        ]
      });

      results.ownerEmailSent = true;
      results.ownerEmailPreviewUrl = nodemailer.getTestMessageUrl(ownerInfo) || null;
    }

    if (!results.signerEmailSent && signature.email) {
      const signerInfo = await transporter.sendMail({
        from: fromAddress,
        to: signature.email.trim(),
        subject: `[BiaAuth] Sua Cópia do Documento Assinado: "${docRecord.title}"`,
        html: signerHtml,
        attachments: [
          {
            filename: safeFileName,
            path: pdfFilePath,
            contentType: 'application/pdf'
          }
        ]
      });

      results.signerEmailSent = true;
      results.signerEmailPreviewUrl = nodemailer.getTestMessageUrl(signerInfo) || null;
    }
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err);
    results.error = err.message;
  }

  return results;
}

// ============================================================================
// ROTAS DA API
// ============================================================================

// 1. Listar todos os documentos (para histórico rápido do proprietário na página inicial)
app.get('/api/documents', (req, res) => {
  const db = readDB();
  const list = db.documents
    .slice()
    .reverse()
    .map((d) => ({
      id: d.id,
      title: d.title,
      ownerName: d.ownerName,
      ownerEmail: d.ownerEmail,
      createdAt: d.createdAt,
      createdAtFormatted: d.createdAtFormatted,
      signaturesCount: d.signatures.length,
      signatures: d.signatures
    }));
  res.json({ documents: list });
});

// 2. Gerar um PDF de exemplo caso o usuário queira testar sem fazer upload
app.post('/api/documents/sample', async (req, res) => {
  try {
    const { ownerName, ownerEmail, title } = req.body;
    if (!ownerName || !ownerEmail) {
      return res.status(400).json({ error: 'Informe o nome e o e-mail do proprietário.' });
    }

    const docId = crypto.randomBytes(6).toString('hex');
    const docTitle = title || 'Contrato de Prestação de Serviços - Exemplo';
    const origPath = path.join(UPLOADS_ORIG_DIR, `${docId}.pdf`);
    const signedPath = path.join(UPLOADS_SIGNED_DIR, `${docId}.pdf`);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const { width, height } = page.getSize();

    page.drawText(safePdfText(docTitle.toUpperCase()), {
      x: 50,
      y: height - 80,
      size: 16,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4)
    });

    const paragraphs = [
      `Proprietario / Emitente: ${ownerName} (${ownerEmail})`,
      `Data de Emissao: ${new Date().toLocaleDateString('pt-BR')}`,
      '',
      '1. OBJETO DO DOCUMENTO',
      'Este documento foi disponibilizado na plataforma BiaAuth para coleta de assinatura',
      'eletronica com autenticacao via conta Google (Gmail) ou Gov.br.',
      '',
      '2. DECLARACAO DE CONCORDANCIA',
      'Ao assinar digitalmente este documento, o signatario declara que leu e concorda',
      'integralmente com os termos aqui descritos, confirmando sua identidade por meio de',
      'seu Nome Completo, CPF e autenticacao eletronica.',
      '',
      '3. VALIDADE JURIDICA',
      'As partes reconhecem a validade juridica da assinatura eletronica realizada nesta',
      'plataforma, nos termos do Art. 10, paragrafo 2 da Medida Provisoria n 2.200-2/2001',
      'e da Lei n 14.063/2020.',
      '',
      '4. ENVIO AUTOMATICO',
      'Apos a conclusao da assinatura, o documento assinado juntamente com o Manifesto de',
      'Certificacao Criptografica (SHA-256) sera encaminhado automaticamente ao proprietario',
      'e, opcionalmente, ao e-mail do assinante.'
    ];

    let y = height - 130;
    for (const line of paragraphs) {
      const isHeading = /^[1-4]\./.test(line);
      page.drawText(safePdfText(line), {
        x: 50,
        y,
        size: isHeading ? 11.5 : 10.5,
        font: isHeading ? fontBold : fontReg,
        color: isHeading ? rgb(0.1, 0.2, 0.4) : rgb(0.2, 0.2, 0.2)
      });
      y -= line === '' ? 14 : 20;
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(origPath, pdfBytes);
    fs.copyFileSync(origPath, signedPath);

    const origHash = computeFileHash(origPath);
    const now = new Date();

    const newDoc = {
      id: docId,
      title: docTitle,
      ownerName: ownerName.trim(),
      ownerEmail: ownerEmail.trim(),
      originalFileName: 'Documento_Exemplo.pdf',
      originalPath: origPath,
      signedPath: signedPath,
      originalHash: origHash,
      signedHash: origHash,
      createdAt: now.toISOString(),
      createdAtFormatted: now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      signatures: []
    };

    const db = readDB();
    db.documents.push(newDoc);
    writeDB(db);

    res.json({
      success: true,
      document: newDoc,
      shareUrl: `${req.protocol}://${req.get('host')}/assinar/${docId}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar documento de exemplo: ' + err.message });
  }
});

// 3. Upload de PDF pelo Proprietário
app.post('/api/documents', upload.single('pdfFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Por favor, selecione um arquivo PDF válido.' });
    }

    const { ownerName, ownerEmail, title } = req.body;
    if (!ownerName || !ownerEmail) {
      return res.status(400).json({ error: 'O nome e o e-mail do proprietário são obrigatórios.' });
    }

    const docId = req.generatedDocId;
    const origPath = req.file.path;
    const signedPath = path.join(UPLOADS_SIGNED_DIR, `${docId}.pdf`);

    // Inicialmente o arquivo assinado é uma cópia do original
    fs.copyFileSync(origPath, signedPath);

    const origHash = computeFileHash(origPath);
    const now = new Date();
    const cleanTitle = (title && title.trim()) || req.file.originalname.replace(/\.pdf$/i, '');

    const newDoc = {
      id: docId,
      title: cleanTitle,
      ownerName: ownerName.trim(),
      ownerEmail: ownerEmail.trim(),
      originalFileName: req.file.originalname,
      originalPath: origPath,
      signedPath: signedPath,
      originalHash: origHash,
      signedHash: origHash,
      createdAt: now.toISOString(),
      createdAtFormatted: now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      signatures: []
    };

    const db = readDB();
    db.documents.push(newDoc);
    writeDB(db);

    res.json({
      success: true,
      document: newDoc,
      shareUrl: `${req.protocol}://${req.get('host')}/assinar/${docId}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao disponibilizar documento: ' + err.message });
  }
});

// Rota amigável de Link Único Permanente do Documento Original: /assinar/:id
app.get('/assinar/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assinar.html'));
});

// 4. Obter detalhes de um documento pelo ID
app.get('/api/documents/:id', (req, res) => {
  const db = readDB();
  const doc = db.documents.find((d) => d.id === req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'Documento não encontrado.' });
  }
  res.json({
    document: {
      id: doc.id,
      title: doc.title,
      ownerName: doc.ownerName,
      ownerEmail: doc.ownerEmail,
      originalFileName: doc.originalFileName,
      originalHash: doc.originalHash,
      signedHash: doc.signedHash,
      createdAt: doc.createdAt,
      createdAtFormatted: doc.createdAtFormatted,
      signatures: doc.signatures
    }
  });
});

// 5. Visualizar / Baixar o PDF (Por padrão sempre retorna o documento ORIGINAL em branco; se informar ?sigId=..., retorna o PDF exclusivo daquela assinatura)
app.get('/api/documents/:id/pdf', (req, res) => {
  const db = readDB();
  const doc = db.documents.find((d) => d.id === req.params.id);
  if (!doc) {
    return res.status(404).send('Documento não encontrado.');
  }

  let targetPath = doc.originalPath;
  let suffix = '';

  if (req.query.sigId) {
    const sig = doc.signatures.find((s) => s.id === req.query.sigId);
    if (sig && sig.signedPath && fs.existsSync(sig.signedPath)) {
      targetPath = sig.signedPath;
      const safeSigner = sig.fullName.replace(/[^a-zA-Z0-9_-]/g, '_');
      suffix = `_Assinado_${safeSigner}`;
    }
  }

  if (!fs.existsSync(targetPath)) {
    return res.status(404).send('Arquivo PDF não encontrado no servidor.');
  }

  const downloadName = `${doc.title.replace(/[^a-zA-Z0-9_-]/g, '_')}${suffix}.pdf`;

  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
  }
  res.setHeader('Content-Type', 'application/pdf');
  fs.createReadStream(targetPath).pipe(res);
});

// 6. Assinar o Documento (Processo Único e Individual)
app.post('/api/documents/:id/sign', async (req, res) => {
  try {
    const db = readDB();
    const doc = db.documents.find((d) => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }

    const {
      authProvider,
      authAccount,
      fullName,
      cpf,
      email,
      signatureImage
    } = req.body;

    if (!authProvider || !['google', 'govbr'].includes(authProvider)) {
      return res.status(400).json({
        error: 'É necessário fazer login com sua conta Google (Gmail) ou Gov.br antes de assinar.'
      });
    }

    if (!fullName || fullName.trim().split(/\s+/).length < 2) {
      return res.status(400).json({ error: 'Por favor, informe o seu Nome Completo (nome e sobrenome).' });
    }

    if (!cpf || !isValidCPF(cpf)) {
      return res.status(400).json({ error: 'Por favor, informe um CPF válido.' });
    }

    // Se o usuário autenticou com Google e por algum motivo o campo email veio vazio, aproveita o e-mail da conta Google
    let finalEmail = (email || '').trim();
    if (!finalEmail && authAccount && authAccount.includes('@')) {
      finalEmail = authAccount.split(' ')[0].trim();
    }

    if (!finalEmail || !finalEmail.includes('@')) {
      return res.status(400).json({
        error: 'O e-mail do signatário é obrigatório para o envio automático da sua cópia do documento assinado.'
      });
    }

    const now = new Date();
    const formattedDate = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const formattedCpf = formatCPF(cpf);
    const verificationCode = `BIA-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    const clientIp =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const sigHash = crypto
      .createHash('sha256')
      .update(`${doc.originalHash}|${fullName.trim()}|${formattedCpf}|${authProvider}|${now.toISOString()}`)
      .digest('hex');

    const signatureRecord = {
      id: crypto.randomBytes(6).toString('hex'),
      authProvider,
      authAccount: authAccount || (authProvider === 'govbr' ? `Gov.br (${formattedCpf})` : finalEmail),
      fullName: fullName.trim(),
      cpf: formattedCpf,
      email: finalEmail,
      sendCopy: true,
      signedAt: now.toISOString(),
      signedAtFormatted: formattedDate,
      ip: clientIp,
      verificationCode,
      signatureHash: sigHash,
      signatureImage: signatureImage || null
    };

    // Gera um PDF assinado EXCLUSIVO para este signatário (o documento original permanece intacto!)
    await buildIndividualSignedPdf(doc, signatureRecord);

    doc.signatures.push(signatureRecord);

    // Salva no banco
    writeDB(db);

    // Dispara OBRIGATORIAMENTE os e-mails com o PDF individual para o proprietário cadastrado e para o signatário
    const emailResults = await sendSignatureEmails(doc, signatureRecord);

    res.json({
      success: true,
      signature: signatureRecord,
      emailResults,
      downloadUrl: `/api/documents/${doc.id}/pdf?sigId=${signatureRecord.id}&download=1`,
      viewSignedUrl: `/api/documents/${doc.id}/pdf?sigId=${signatureRecord.id}`
    });
  } catch (err) {
    console.error('Erro ao assinar documento:', err);
    res.status(500).json({ error: 'Erro ao processar assinatura: ' + err.message });
  }
});

// 7. Obter configurações públicas (Google Client ID para o Login Oficial do Google)
app.get('/api/public-config', (req, res) => {
  const s = readSettings();
  res.json({
    googleClientId: s.googleClientId || ''
  });
});

// 8. Verificar Token Oficial do Google Auth (Google Identity Services)
app.post('/api/auth/google-verify', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Token do Google não fornecido.' });
    }

    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    const payload = await verifyRes.json();

    if (!verifyRes.ok || !payload.email) {
      return res.status(401).json({ error: 'Token do Google inválido ou expirado.' });
    }

    res.json({
      success: true,
      user: {
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture || null,
        emailVerified: payload.email_verified === 'true' || payload.email_verified === true
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao validar login do Google: ' + err.message });
  }
});

// 9. Obter e Salvar Configurações de E-mail e Google Auth
app.get('/api/settings/email', (req, res) => {
  const s = readSettings();
  res.json({
    googleScriptUrl: s.googleScriptUrl || '',
    googleClientId: s.googleClientId || '',
    smtpHost: s.smtpHost || 'smtp.gmail.com',
    smtpPort: s.smtpPort || 587,
    smtpUser: s.smtpUser || '',
    hasPassword: Boolean(s.smtpPass),
    fromName: s.fromName || 'BiaAuth - Assinatura Digital'
  });
});

app.post('/api/settings/email', (req, res) => {
  const current = readSettings();
  const { googleScriptUrl, googleClientId, smtpHost, smtpPort, smtpUser, smtpPass, fromName } = req.body;

  const updated = {
    googleScriptUrl: googleScriptUrl !== undefined ? googleScriptUrl.trim() : (current.googleScriptUrl || ''),
    googleClientId: googleClientId !== undefined ? cleanClientId(googleClientId) : cleanClientId(current.googleClientId || ''),
    smtpHost: (smtpHost || current.smtpHost || 'smtp.gmail.com').trim(),
    smtpPort: Number(smtpPort || current.smtpPort || 587),
    smtpUser: smtpUser !== undefined ? smtpUser.trim() : (current.smtpUser || ''),
    smtpPass: smtpPass ? smtpPass.trim() : (current.smtpPass || ''),
    fromName: (fromName || current.fromName || 'BiaAuth - Assinatura Digital').trim()
  };

  writeSettings(updated);
  res.json({
    success: true,
    isConfigured: Boolean(updated.googleScriptUrl || (updated.smtpUser && updated.smtpPass)),
    hasGoogleAuth: Boolean(updated.googleClientId)
  });
});

// 10. Testar Envio de E-mail (Google Apps Script ou SMTP)
app.post('/api/settings/test-email', async (req, res) => {
  try {
    const { testEmail } = req.body;
    if (!testEmail || !testEmail.includes('@')) {
      return res.status(400).json({ error: 'Informe um e-mail válido para realizar o teste.' });
    }

    const settings = readSettings();
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <h2 style="color: #1e3a8a;">Teste de Envio Automático — BiaAuth</h2>
        <p>Este é um e-mail de teste disparado pela plataforma <strong>BiaAuth</strong>.</p>
        <p>Se você recebeu esta mensagem na sua caixa de entrada, o envio automático para o <strong>Proprietário</strong> e para o <strong>Signatário</strong> está funcionando perfeitamente!</p>
      </div>
    `;

    if (settings.googleScriptUrl && settings.googleScriptUrl.startsWith('https://script.google.com')) {
      const samplePdf = await PDFDocument.create();
      const p = samplePdf.addPage([400, 200]);
      p.drawText('PDF de Teste BiaAuth - Envio OK', { x: 40, y: 100, size: 14 });
      const pdfBytes = await samplePdf.save();

      const gsRes = await fetch(settings.googleScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          to: testEmail.trim(),
          subject: '[BiaAuth] Teste de Envio de E-mail Automático',
          htmlBody,
          fileName: 'Teste_BiaAuth.pdf',
          pdfBase64: Buffer.from(pdfBytes).toString('base64')
        }),
        redirect: 'follow'
      });

      const text = await gsRes.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {}

      if (parsed && parsed.ok) {
        return res.json({ success: true, message: `E-mail real enviado com sucesso para ${testEmail} via Google Apps Script!` });
      }
      return res.status(400).json({
        error: (parsed && parsed.error) || 'O Google Apps Script não confirmou o envio. Verifique se na implantação do script a opção "Quem pode acessar" está definida como "Qualquer pessoa".'
      });
    }

    return res.status(400).json({
      error: 'Configure primeiro a URL do Google Apps Script e clique em Salvar antes de testar.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao testar envio: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`=====================================================`);
  console.log(`  BiaAuth - Plataforma de Assinatura Digital Gratuita`);
  console.log(`  Servidor rodando em: http://localhost:${PORT}`);
  console.log(`=====================================================`);
});

