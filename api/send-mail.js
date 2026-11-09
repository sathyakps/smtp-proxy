import nodemailer from 'nodemailer';
import crypto from 'crypto';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAndValidateEmails(input) {
  if (!input) return [];
  const list = Array.isArray(input) 
    ? input 
    : String(input).split(',').map(e => e.trim());
  
  const cleaned = list.map(e => String(e).trim()).filter(Boolean);
  for (const email of cleaned) {
    if (!EMAIL_REGEX.test(email)) {
      return null; 
    }
  }
  return cleaned;
}

export default async function handler(req, res) {
  // 1. Handle GET requests for testing environment variables & connection
  if (req.method === 'GET') {
    const missingVars = [];
    if (!process.env.GMAIL_USER) missingVars.push('GMAIL_USER');
    if (!process.env.GMAIL_PASS) missingVars.push('GMAIL_PASS');
    if (!process.env.EMAIL_API_KEY) missingVars.push('EMAIL_API_KEY');

    if (missingVars.length > 0) {
      return res.status(500).json({
        ok: false,
        error: `Missing required environment variables: ${missingVars.join(', ')}`,
        missingVariables: missingVars
      });
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    try {
      await transporter.verify();
      return res.status(200).json({
        ok: true,
        message: 'SMTP configuration, credentials, and API key are fully valid!'
      });
    } catch (error) {
      console.error('SMTP Verify Error:', error.message);
      return res.status(502).json({
        ok: false,
        error: 'SMTP connection failed with provided credentials',
        details: error.message
      });
    }
  }

  // 2. Handle POST requests for sending mail
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 100 * 1024) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // Check if server environment variable is missing
  const serverApiKey = process.env.EMAIL_API_KEY;
  if (!serverApiKey) {
    return res.status(500).json({ 
      ok: false, 
      error: 'Server configuration error: EMAIL_API_KEY is missing on the server environment variables.' 
    });
  }

  // Check if client provided authorization header
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ 
      ok: false, 
      error: 'Unauthorized: Missing Authorization header. Please provide "Bearer <EMAIL_API_KEY>"' 
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      ok: false, 
      error: 'Unauthorized: Invalid Authorization format. Expected "Bearer <EMAIL_API_KEY>"' 
    });
  }

  const clientToken = authHeader.split(' ')[1];
  let isAuthorized = false;
  try {
    if (clientToken.length === serverApiKey.length) {
      isAuthorized = crypto.timingSafeEqual(
        Buffer.from(clientToken), 
        Buffer.from(serverApiKey)
      );
    }
  } catch (err) {
    isAuthorized = false;
  }

  if (!isAuthorized) {
    return res.status(401).json({ 
      ok: false, 
      error: 'Unauthorized: Provided EMAIL_API_KEY is incorrect.' 
    });
  }

  const { recipient, subject, message, html, cc, bcc, replyTo, senderName } = req.body || {};

  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ error: 'Invalid or missing subject' });
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing message body' });
  }

  const toList = parseAndValidateEmails(recipient);
  const ccList = parseAndValidateEmails(cc);
  const bccList = parseAndValidateEmails(bcc);

  if (!toList || toList.length === 0 || ccList === null || bccList === null) {
    return res.status(400).json({ error: 'Malformed or invalid email addresses in recipient, cc, or bcc' });
  }

  const totalRecipientsCount = toList.length + ccList.length + bccList.length;
  if (totalRecipientsCount > 50) {
    return res.status(400).json({ error: 'Recipient count exceeds maximum limit of 50' });
  }

  let validatedReplyTo = undefined;
  if (replyTo) {
    if (typeof replyTo !== 'string' || !EMAIL_REGEX.test(replyTo.trim())) {
      return res.status(400).json({ error: 'Invalid replyTo address' });
    }
    validatedReplyTo = replyTo.trim();
  }

  const fromEmail = process.env.EMAIL_FROM_ADDRESS || process.env.GMAIL_USER;
  const displayName = typeof senderName === 'string' && senderName.trim() ? senderName.trim() : 'Vercel App';

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  try {
    const mailOptions = {
      from: `"${displayName}" <${fromEmail}>`,
      to: toList.join(', '),
      subject: subject.trim(),
      text: message,
    };

    if (html && typeof html === 'string') {
      mailOptions.html = html;
    }
    if (ccList.length > 0) {
      mailOptions.cc = ccList.join(', ');
    }
    if (bccList.length > 0) {
      mailOptions.bcc = bccList.join(', ');
    }
    if (validatedReplyTo) {
      mailOptions.replyTo = validatedReplyTo;
    }

    const info = await transporter.sendMail(mailOptions);

    return res.status(200).json({
      ok: true,
      messageId: info.messageId,
    });

  } catch (error) {
    console.error('SMTP Connection/Auth Error:', {
      message: error.message,
      code: error.code,
      command: error.command
    });

    return res.status(502).json({
      ok: false,
      error: 'Failed to deliver email through provider',
    });
  }
}