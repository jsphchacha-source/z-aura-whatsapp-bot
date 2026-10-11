
require('dotenv').config();

const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const pino = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const PORT = Number(process.env.PORT || 3000);
const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const QR_TOKEN = process.env.QR_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

let latestQR = '';
let botSocket = null;
let isStarting = false;
let reconnectTimer = null;
let shuttingDown = false;

const conversationSchema = new mongoose.Schema({
  whatsappId: { type: String, unique: true, required: true },
  itemCode: String,
  item: String,
  step: String,
  name: String,
  location: String,
  phone: String,
  updatedAt: { type: Date, default: Date.now },
});

const orderSchema = new mongoose.Schema({
  whatsappId: { type: String, required: true, index: true },
  customerName: { type: String, required: true },
  customerLocation: { type: String, required: true },
  customerPhone: { type: String, required: true },
  itemCode: { type: String, required: true },
  item: { type: String, required: true },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

const Conversation =
  mongoose.models.Conversation ||
  mongoose.model('Conversation', conversationSchema);

const Order =
  mongoose.models.Order ||
  mongoose.model('Order', orderSchema);

const products = {
  '11': {
    category: '1',
    name: 'Z-AURA LAUNDRY STARTER',
    details: [
      'Wilko Laundry Gel Fresh Cotton 1L',
      'Fairy Original Fabric Conditioner',
      'Dr. Beckmann 3-in-1 Colour & Dirt Collector Sheets',
      'M Pre-Wash Stain Remover',
    ],
  },
  '12': {
    category: '1',
    name: 'Z-AURA FRESH LAUNDRY COMBO (Standard)',
    details: [
      'Lenor Fabric Conditioner Spring Awakening',
      'Fairy Original Fabric Conditioner',
      'Lenor Crease Releaser Exotic Bloom',
      'Febreze Fabric Freshener Lenor Exotic Bloom 500ml',
      'Gel Beads',
      'Mr Sheen Oxi Ultra 400g',
    ],
  },
  '13': {
    category: '1',
    name: 'Z-AURA PREMIUM LAUNDRY COLLECTION',
    details: [
      'Wilko Laundry Gel Fresh Cotton',
      'Lenor Outdoorable Fabric Conditioner',
      'Lenor Fabric Conditioner Spring Awakening',
      'Lenor Crease Releaser',
      'Dr. Beckmann Colour & Dirt Collector',
      'M Pre-Wash Stain Remover',
      'Gel Beads',
    ],
  },
  '14': {
    category: '1',
    name: 'Z-AURA FAMILY LAUNDRY PACK',
    details: [
      'Genesis Vibrant Detergent 750ml',
      'Sta-Soft Spring Fresh 2L',
      'Sta-Soft Aromatherapy Passion 2L',
      'Dr. Beckmann Colour Collector',
      'M Pre-Wash Stain Remover',
      'Home Butler Laundry Bag',
    ],
  },
  '21': {
    category: '2',
    name: 'Z-AURA BABY CLOTHES CARE PACK',
    details: [
      'Elizabeth Anne Baby Liquid Laundry Wash',
      'Sta-Soft Ultra Concentrate Sensitive 1L',
      'Dr. Beckmann Colour & Dirt Collector Sheets',
      'Home Butler Laundry Bag',
    ],
  },
  '31': {
    category: '3',
    name: 'Z-AURA KITCHEN POWER COMBO',
    details: [
      'Astonish Air Fryer Cleaner Degreaser',
      'Astonish Kitchen Cleaner Zesty Lemon',
      'Astonish Specialist Grease Lift',
      'Elbow Grease Soda Crystals',
      'Elbow Grease Bicarbonate Soda',
      'Elbow Grease Gloves',
    ],
  },
  '32': {
    category: '3',
    name: 'Z-AURA BATHROOM & TOILET POWER PACK',
    details: [
      'Astonish White Jasmine & Basil Bathroom Cleaner',
      'Astonish Daily Shower Shine',
      'Harpic Original 750ml & Power Plus Original',
      'Harpic Lavender Toilet Cleaner',
      'Domestos Lavender Blast Thick Bleach & 50g Toilet Cleaner',
      'Toilet Block 50g & Harpic Rimblock',
      'Duzzit Window Squeegee & Dish Brush Round',
      'Elbow Grease Gloves (Large)',
    ],
  },
  '33': {
    category: '3',
    name: 'Z-AURA DEEP CLEAN HOME COMBO',
    details: [
      'Astonish Multi-Surface Cleaner Orange Grove',
      'Astonish Specialist Antibacterial Surface Cleanser',
      'Mr Muscle Floor & All-Purpose Cleaner',
      'Mr Sheen Daily Surface 1L',
      'Domestos Thick Bleach Summer Fresh',
      'Super Brite Floor & Tile Cleaner Lavender',
      'Astonish Multipurpose Cleaner Bleach',
      'Mr Muscle Shower Shine Cleaner & Superbrite 500ml',
      'Jeyes Homeguard Bleach Citrus',
      'M Thick Bleach Lavender Bloom',
      'Cobra Multi Surface Cleaner Lavender',
    ],
  },
  '34': {
    category: '3',
    name: 'Z-AURA APPLIANCE CARE PACK (Protection & Shine)',
    details: [
      'Elbow Grease Kettle Descaler',
      'Elbow Grease Descaler 3×25ml',
      'Duzzit Washing Machine Cleaner Lemon',
      'Duzzit Washing Machine Cleaner',
      'Astonish Stainless Steel Cleaner',
    ],
  },
  '41': {
    category: '4',
    name: 'Z-AURA HOME FRESH STARTER',
    details: [
      'Airwick',
      'Mystify Lavender Gel Air Freshener',
      'Mystify Citrus Fruit Gel Air Freshener',
      'Shield Fresh 24 Lavender',
    ],
  },
  '42': {
    category: '4',
    name: 'Z-AURA PREMIUM HOME FRAGRANCE',
    details: [
      'Febreze Air Freshener Peony & Cedar 185ml',
      'RS Fleur Home perfume',
      'RS Oud Forest',
      'RS Vanilla Bean',
      'Febreze Fabric Freshener Lenor Exotic Bloom',
      'Febreze Fabric Refresher Enchanted Wildflowers & Alpine Escape',
      'Febreze Fabric Plum Cherry',
      'Mystify Gel Air Freshener & Shield Fresh 24 Tropical',
      'Airwick 250ml & Hanging Dehumidifier',
    ],
  },
  '43': {
    category: '4',
    name: 'Z-AURA BIN & SPACE FRESH PACK',
    details: [
      'Bin Brite Citronella Lemon',
      'Bin Brite Mediterranean Sun',
      'Bin Brite Berry Blast',
      'Bin Brite Spring Blossom',
      'Small Space Dehumidifier',
    ],
  },
  '51': {
    category: '5',
    name: 'Z-AURA CAR FRESH STARTER',
    details: [
      'RS Fleur',
      'RS Vanilla Bean',
      'Car Fragrance Spicy Leather',
      'Shield Fresh',
    ],
  },
  '52': {
    category: '5',
    name: 'Z-AURA CAR INTERIOR CARE',
    details: [
      'Shield Cockpit Dashboard Protector',
      'Shield Leather Care 400ml',
      'Shield Sheen Silicone',
      'Shield Splash N Dash Sponge',
    ],
  },
  '53': {
    category: '5',
    name: 'Z-AURA PREMIUM CAR CLEAN AND FRESH',
    details: [
      'Optimo Auto Washing Liquid',
      'Shield Cockpit Dashboard Protector & Leather Care',
      'Shield Sheen Silicone & Splash N Dash Sponge',
      'RS Leather Secret & Car Fragrance Spicy Leather',
      'RS Fleur, Oud Forest & Vanilla Bean',
    ],
  },
};

const categoryMenus = {
  '1': {
    title: '🧺 LAUNDRY CARE COMBOS',
    description:
      'Husaidia kupata nguo safi, laini na zenye harufu nzuri. Pia husaidia kutunza nguo na kushughulikia madoa kulingana na bidhaa iliyotumika.',
    codes: ['11', '12', '13', '14'],
  },
  '2': {
    title: '👶 BABY CARE COMBOS',
    description:
      'Vifurushi vya usafi wa nguo za watoto. Tafadhali fuata maelekezo ya bidhaa na chagua bidhaa inayofaa mahitaji ya mtoto wako.',
    codes: ['21'],
  },
  '3': {
    title: '🧼 HOME CLEANING COMBOS',
    description:
      'Vifurushi vya kusafisha jikoni, bafuni, chooni, sakafuni na baadhi ya vifaa vya nyumbani. Tumia kila bidhaa kulingana na lebo yake.',
    codes: ['31', '32', '33', '34'],
  },
  '4': {
    title: '🌸 AIR FRAGRANCE COMBOS',
    description:
      'Bidhaa za kuboresha harufu ya nyumbani na kusaidia kupunguza harufu zisizopendeza.',
    codes: ['41', '42', '43'],
  },
  '5': {
    title: '🚗 CAR CARE COMBOS',
    description:
      'Bidhaa za kusafisha na kutunza sehemu za ndani za gari, pamoja na bidhaa za kuongeza harufu nzuri.',
    codes: ['51', '52', '53'],
  },
};

function mainMenu() {
  return [
    'Habari, karibu Z-Aura Home & Fragrance 👋',
    '',
    'Chagua aina ya combo kwa kutuma namba husika.',
    '',
    'Tuma 0 wakati wowote kurudi kwenye menyu kuu.',
    '',
    '1️⃣ 🧺 LAUNDRY CARE COMBOS',
    '2️⃣ 👶 BABY CARE COMBOS',
    '3️⃣ 🧼 HOME CLEANING COMBOS',
    '4️⃣ 🌸 AIR FRAGRANCE COMBOS',
    '5️⃣ 🚗 CAR CARE COMBOS',
  ].join('\n');
}

function categoryMessage(categoryCode) {
  const category = categoryMenus[categoryCode];

  if (!category) return mainMenu();

  const comboList = category.codes
    .map((code) => `${code}. ${products[code].name}`)
    .join('\n');

  return `${category.title}

${category.description}

Tuma namba ya combo unayotaka kuagiza:

${comboList}

Tuma 0 kurudi kwenye menyu kuu.`;
}

function productMessage(code) {
  const product = products[code];

  return `✅ ${product.name}

${product.details.map((item) => `• ${item}`).join('\n')}

Ili kuendelea na oda, andika jina lako kamili.

Tuma 0 kughairi na kurudi kwenye menyu kuu.`;
}

function getMessageText(message) {
  if (!message) return '';

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  ).trim();
}

async function getState(senderID) {
  return Conversation.findOne({ whatsappId: senderID }).lean();
}

async function saveState(senderID, state) {
  await Conversation.updateOne(
    { whatsappId: senderID },
    {
      $set: {
        whatsappId: senderID,
        ...state,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function clearState(senderID) {
  await Conversation.deleteOne({ whatsappId: senderID });
}

async function sendText(sock, senderID, text) {
  await sock.sendMessage(senderID, { text });
}

async function processMessage(sock, message) {
  if (!message?.message || message.key?.fromMe) return;

  const senderID = message.key?.remoteJid;

  if (
    !senderID ||
    senderID === 'status@broadcast' ||
    senderID.endsWith('@g.us')
  ) {
    return;
  }

  const text = getMessageText(message.message);

  if (!text) return;

  const lowerText = text.toLowerCase();

  const menuWords = [
    '0',
    'menu',
    'hi',
    'mambo',
    'habari',
    'kwema',
    'hello',
    'start',
  ];

  if (menuWords.includes(lowerText)) {
    await clearState(senderID);
    await sendText(sock, senderID, mainMenu());
    return;
  }

  const state = await getState(senderID);

  // Hatua ya kwanza: kupokea jina la mteja
  if (state?.step === 'awaiting_name') {
    if (text.length < 3 || /^\d+$/.test(text)) {
      await sendText(
        sock,
        senderID,
        'Tafadhali andika jina lako kamili.',
      );
      return;
    }

    await saveState(senderID, {
      itemCode: state.itemCode,
      item: state.item,
      step: 'awaiting_location',
      name: text,
    });

    await sendText(
      sock,
      senderID,
      `Asante ${text}.

Sasa andika eneo lako, mfano: Mikocheni, Dar es Salaam.`,
    );
    return;
  }

  // Hatua ya pili: kupokea eneo la mteja
  if (state?.step === 'awaiting_location') {
    if (text.length < 2 || /^\d+$/.test(text)) {
      await sendText(
        sock,
        senderID,
        'Tafadhali andika eneo lako (address), mfano: Mikocheni, Dar es Salaam.',
      );
      return;
    }

    await saveState(senderID, {
      itemCode: state.itemCode,
      item: state.item,
      step: 'awaiting_phone',
      name: state.name,
      location: text,
    });

    await sendText(
      sock,
      senderID,
      'Asante. Sasa tuma namba ya simu utakayotumia kupokea mzigo, mfano: 07XXXXXXXX au +2557XXXXXXXX.',
    );
    return;
  }

  // Hatua ya tatu: kupokea namba ya simu na kuhifadhi oda
  if (state?.step === 'awaiting_phone') {
    const phone = text.replace(/[\s()-]/g, '');

    if (!/^\+?\d{10,12}$/.test(phone)) {
      await sendText(
        sock,
        senderID,
        'Namba haijaonekana kuwa sahihi. Tuma namba yenye tarakimu 10 hadi 12, kwa mfano +2557XXXXXXXX.',
      );
      return;
    }

    try {
      const order = await Order.create({
        whatsappId: senderID,
        customerName: state.name,
        customerLocation: state.location,
        customerPhone: phone,
        itemCode: state.itemCode,
        item: state.item,
      });

      await clearState(senderID);

      await sendText(
        sock,
        senderID,
        `Asante ${order.customerName}.

Ombi lako la oda limepokelewa.

Combo: ${order.item}
Eneo: ${order.customerLocation}
Simu ya kupokea mzigo: ${order.customerPhone}
Namba ya oda: ${order._id}

Team ya Z-Aura Home & Fragrance itawasiliana nawe kuthibitisha upatikanaji, bei, malipo na usafirishaji.

Tuma 0 kurudi kwenye menyu kuu.`,
      );

      console.log(
        `ODA MPYA: ${order._id} | ${order.item} | ${order.customerName} | ${order.customerPhone}`,
      );
    } catch (error) {
      console.error('Imeshindikana kuhifadhi oda:', error);

      await sendText(
        sock,
        senderID,
        'Samahani, oda haijahifadhiwa kwa sababu ya hitilafu ya mfumo. Taarifa zako bado hazijatumwa kama oda. Tafadhali jaribu tena baada ya muda au tuma 0 kuanza upya.',
      );
    }

    return;
  }

  // Mteja akichagua kundi la bidhaa
  if (categoryMenus[lowerText]) {
    await sendText(sock, senderID, categoryMessage(lowerText));
    return;
  }

  // Mteja akichagua combo maalumu
  if (products[lowerText]) {
    const product = products[lowerText];

    await saveState(senderID, {
      itemCode: lowerText,
      item: product.name,
      step: 'awaiting_name',
    });

    await sendText(sock, senderID, productMessage(lowerText));
    return;
  }

  // Jibu la mteja lisipotambulika
  await sendText(
    sock,
    senderID,
    `Samahani, sijaelewa chaguo lako.

${mainMenu()}

Ukiwa tayari kuchagua combo, tuma namba yake kama 11, 21, 31 au 53.`,
  );
}

 // Ukurasa wa QR unalindwa na token. Weka QR_TOKEN kwenye .env.
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`,
  );

  if (requestUrl.pathname !== '/') {
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Ukurasa haujapatikana.');
    return;
  }

  if (
    !QR_TOKEN ||
    requestUrl.searchParams.get('token') !== QR_TOKEN
  ) {
    res.writeHead(403, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Ufikiaji umekataliwa.');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });

  if (!latestQR) {
    res.end(`<!doctype html>
<html lang="sw">
<head>
<meta charset="utf-8">
<title>Z-Aura Bot</title>
</head>
<body style="font-family:Arial;text-align:center;margin:40px">
<h2>Z-Aura WhatsApp Bot</h2>
<p>QR haipo kwa sasa. Huenda bot imeunganishwa tayari.</p>
<p>Refresh ukurasa baada ya muda mfupi.</p>
</body>
</html>`);
    return;
  }

  try {
    const image = await qrcode.toDataURL(latestQR);

    res.end(`<!doctype html>
<html lang="sw">
<head>
<meta charset="utf-8">
<title>Z-Aura QR</title>
</head>
<body style="font-family:Arial;text-align:center;margin:40px">
<h2>Unganisha Z-Aura WhatsApp Bot</h2>
<p>WhatsApp, Linked Devices, Link a Device. Changanua QR hii.</p>
<img src="${image}" alt="WhatsApp QR"
style="width:300px;max-width:90%;height:auto">
<p>QR ikikataa, refresh ukurasa ili kupata QR mpya.</p>
</body>
</html>`);
  } catch (error) {
    console.error('Hitilafu ya QR:', error.message);
    res.end('Imeshindikana kutengeneza QR Code.');
  }
});

async function startBot() {
  if (isStarting || shuttingDown) return;

  isStarting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_FOLDER);

   
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });

    botSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQR = qr;

        console.log(
          'QR mpya imetengenezwa. Fungua ukurasa wa QR uliolindwa na token.',
        );
      }

      if (connection === 'connecting') {
        console.log('Z-Aura Bot inaunganisha na WhatsApp...');
      }

      if (connection === 'open') {
        latestQR = '';
        console.log('Z-Aura Bot imeunganishwa na WhatsApp.');
      }

      if (connection === 'close') {
        latestQR = '';
        botSocket = null;

        const reason =
          lastDisconnect?.error?.output?.statusCode;

        console.log('WhatsApp imekatika. Sababu:', reason);

        if (shuttingDown) {
          isStarting = false;
          return;
        }

        if (reason === DisconnectReason.loggedOut) {
          console.error(
            'Session ya WhatsApp imekataliwa. Unganisha kifaa upya kwa QR.',
          );

          isStarting = false;
          return;
        }

        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            isStarting = false;

            startBot().catch((error) => {
              console.error(
                'Hitilafu ya kuunganisha tena:',
                error,
              );
            });
          }, 5000);
        }
      }
    });

    sock.ev.on(
      'messages.upsert',
      async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const message of messages || []) {
          try {
            await processMessage(sock, message);
          } catch (error) {
            console.error(
              'Hitilafu ya kushughulikia ujumbe:',
              error,
            );

            const senderID = message?.key?.remoteJid;

            if (senderID && !message.key?.fromMe) {
              try {
                await sendText(
                  sock,
                  senderID,
                  'Samahani, hitilafu imetokea. Tafadhali tuma 0 kuanza tena.',
                );
              } catch (sendError) {
                console.error(
                  'Imeshindikana kutuma ujumbe wa hitilafu:',
                  sendError.message,
                );
              }
            }
          }
        }
      },
    );
  } catch (error) {
    console.error('Imeshindikana kuanzisha bot:', error);

    isStarting = false;

    if (!reconnectTimer && !shuttingDown) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        startBot().catch((err) => {
          console.error(
            'Hitilafu ya kuanzisha tena:',
            err,
          );
        });
      }, 5000);
    }
  }
}

async function shutdown(signal) {
  console.log(`\n${signal} imepokelewa. Inazima mfumo...`);

  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (botSocket) {
      botSocket.end(undefined);
      botSocket = null;
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error(
      'Hitilafu wakati wa kuzima:',
      error.message,
    );
  }

  server.close((error) => {
    if (error) {
      console.error('Hitilafu ya kufunga seva:', error.message);
      process.exitCode = 1;
    }

    process.exit();
  });

  setTimeout(() => {
    console.error('Muda wa kuzima mfumo umeisha.');
    process.exit(1);
  }, 5000).unref();
}

async function main() {
  if (!MONGODB_URI) {
    throw new Error(
      'Weka MONGODB_URI kwenye faili la .env kabla ya kuanzisha bot.',
    );
  }

  if (!QR_TOKEN || QR_TOKEN.length < 20) {
    throw new Error(
      'Weka QR_TOKEN yenye angalau herufi 20 kwenye faili la .env.',
    );
  }

  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB imeunganishwa.');

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Seva inasikiliza kwenye port ${PORT}.`);
  });

  await startBot();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  console.error('Mfumo haujaanza:', error.message);
  process.exitCode = 1;
});

