const twilio = require('twilio');
const { formatWhatsAppNumber } = require('./utils')

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsAppNumber = `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`;

const client = twilio(accountSid, authToken);

async function sendWhatsAppMessage(to, body) {
  try {
    const message = await client.messages.create({
      body: body,
      from: twilioWhatsAppNumber,
      to: formatWhatsAppNumber(to)
    });
    console.log(`WhatsApp message sent to ${to}: ${message.sid}`);
    return message;
  } catch (error) {
    console.error(`Failed to send WhatsApp message to ${to}:`, error);
    throw error;
  }
}

module.exports = {
  sendWhatsAppMessage
};