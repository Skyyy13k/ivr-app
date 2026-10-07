const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Variables d'environnement (à définir sur Railway)
const ACCOUNT_SID = process.env.TWILIO_SID;
const AUTH_TOKEN = process.env.TWILIO_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

let client = null;
try {
    client = twilio(ACCOUNT_SID, AUTH_TOKEN);
} catch (e) {
    console.log('Twilio pas encore configuré');
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const sessions = {};

// Menu vocal
app.post('/voice/incoming', (req, res) => {
    const callSid = req.body.CallSid;
    const from = req.body.From;

    sessions[callSid] = {
        digits: [],
        digitsString: '',
        from: from,
        startTime: Date.now()
    };

    broadcast(callSid, { type: 'incoming', from: from });

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="fr-FR" voice="Polly.Celine">
        Bonjour, vous êtes bien connecté au service.
    </Say>
    <Gather input="dtmf" numDigits="1" timeout="10" action="/voice/gather" method="POST">
        <Say language="fr-FR" voice="Polly.Celine">
            Appuyez sur 1 pour l'option une.
            Appuyez sur 2 pour l'option deux.
            Appuyez sur 3 pour l'option trois.
            Appuyez sur 4 pour l'option quatre.
            Appuyez sur 5 pour parler à un agent.
        </Say>
    </Gather>
    <Say language="fr-FR">Aucune saisie. Au revoir.</Say>
    <Hangup/>
</Response>`);
});

// Réception des touches
app.post('/voice/gather', (req, res) => {
    const callSid = req.body.CallSid;
    const digit = req.body.Digits || '';
    const from = req.body.From;

    if (!sessions[callSid]) {
        sessions[callSid] = { digits: [], digitsString: '', from: from, startTime: Date.now() };
    }

    if (digit) {
        sessions[callSid].digits.push(digit);
        sessions[callSid].digitsString += digit;

        broadcast(callSid, {
            type: 'digit',
            value: digit,
            all: sessions[callSid].digitsString,
            from: from
        });
    }

    const messages = {
        '1': 'Option une sélectionnée.',
        '2': 'Option deux sélectionnée.',
        '3': 'Option trois sélectionnée.',
        '4': 'Option quatre sélectionnée.',
        '5': 'Connexion à un agent.'
    };
    const confirmMsg = messages[digit] || 'Choix enregistré.';

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="fr-FR" voice="Polly.Celine">${confirmMsg}</Say>
    <Pause length="1"/>
    <Redirect method="POST">/voice/incoming</Redirect>
</Response>`);
});

// Statut
app.post('/voice/status', (req, res) => {
    const callSid = req.body.CallSid;
    const status = req.body.CallStatus;

    broadcast(callSid, { type: 'status', value: status });

    if (status === 'completed' && sessions[callSid]) {
        broadcast(callSid, {
            type: 'ended',
            summary: {
                from: sessions[callSid].from,
                digits: sessions[callSid].digitsString,
                duration: Math.round((Date.now() - sessions[callSid].startTime) / 1000)
            }
        });
    }
    res.sendStatus(200);
});

// Liste des sessions
app.get('/api/sessions', (req, res) => {
    const list = Object.keys(sessions).map(sid => ({
        callSid: sid,
        from: sessions[sid].from,
        digits: sessions[sid].digitsString,
        duration: Math.round((Date.now() - sessions[sid].startTime) / 1000)
    }));
    res.json(list);
});

// Healthcheck
app.get('/', (req, res) => {
    res.send('Serveur IVR en ligne ✓');
});

// WebSocket
wss.on('connection', (ws) => {
    console.log('Dashboard connecté');
    ws.on('close', () => {
        Object.keys(sessions).forEach(sid => {
            if (sessions[sid].sockets) {
                sessions[sid].sockets = sessions[sid].sockets.filter(s => s !== ws);
            }
        });
    });
});

function broadcast(callSid, payload) {
    const msg = JSON.stringify({ callSid, ...payload });
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Serveur IVR en ligne sur port ' + PORT);
});