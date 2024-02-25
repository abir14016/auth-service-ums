import nodemailer from 'nodemailer';
import config from '../../../config';

export async function sendLoginEmail(to: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: config.email,
      pass: config.appPass,
    },
  });

  await transporter.sendMail({
    from: config.email, // sender address
    to, // list of receivers
    subject: 'Welcome To University Management System Platform', // Subject line
    html, // html body
  });
}
