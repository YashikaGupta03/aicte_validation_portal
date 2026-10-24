import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter;
function get() {
  if (!transporter) {
    transporter = config.smtp.host
      ? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        })
      : nodemailer.createTransport({ jsonTransport: true }); // dev: nothing is sent
  }
  return transporter;
}

// Email must never break the main flow
export async function sendMail({ to, subject, text }) {
  if (!to || (Array.isArray(to) && !to.length)) return;
  try {
    const info = await get().sendMail({ from: config.smtp.from, to, subject, text });
    if (!config.smtp.host) console.log(`[mail:dev] to=${to} subject="${subject}"`);
    return info;
  } catch (err) {
    console.error('Email failed:', err.message);
  }
}
