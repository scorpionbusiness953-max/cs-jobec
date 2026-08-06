<<<<<<< HEAD
import 'dotenv/config';

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// Remplacez par votre numéro personnel au format international (ex: 243XXXXXXXXX sans le +)
const RECIPIENT_PHONE = '243836919179'; 

async function sendTestMessage() {
    const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        to: RECIPIENT_PHONE,
        type: 'text',
        text: {
            body: 'Bonjour ! Ceci est un test de notification d\'anniversaire depuis Espace RH & Promoteur 🚀'
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Message envoyé avec succès !', data);
        } else {
            console.error('❌ Erreur lors de l\'envoi :', data);
        }
    } catch (error) {
        console.error('⚠️ Erreur réseau ou exception :', error);
    }
}

=======
import 'dotenv/config';

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// Remplacez par votre numéro personnel au format international (ex: 243XXXXXXXXX sans le +)
const RECIPIENT_PHONE = '243836919179'; 

async function sendTestMessage() {
    const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        to: RECIPIENT_PHONE,
        type: 'text',
        text: {
            body: 'Bonjour ! Ceci est un test de notification d\'anniversaire depuis Espace RH & Promoteur 🚀'
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Message envoyé avec succès !', data);
        } else {
            console.error('❌ Erreur lors de l\'envoi :', data);
        }
    } catch (error) {
        console.error('⚠️ Erreur réseau ou exception :', error);
    }
}

>>>>>>> a3a592c1bc951e4c9834362566ef75b11497b7a8
sendTestMessage();