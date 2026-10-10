const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const http = require('http');

let latestQR = ''; // Kigezo cha kimataifa cha kuhifadhi QR code ya sasa

const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (latestQR) {
        try {
            const urlImage = await qrcode.toDataURL(latestQR);
            res.end(`
                <html>
                    <body style="text-align:center; font-family:sans-serif; margin-top:50px;">
                        <h2>Changanua QR Code hii kuunganisha Z-Aura Bot</h2>
                        <img src="${urlImage}" alt="WhatsApp QR Code" style="width:300px; height:300px;"/>
                        <p>Ikiwa haijafanya kazi, fanya refresh ukurasa huu.</p>
                    </body>
                </html>
            `);
        } catch (err) {
            res.end('Imeshindikana kutengeneza QR Code.');
        }
    } else {
        res.end('<h3>Z-Aura WhatsApp Bot ipo hewani na tayari imeunganishwa au inasubiri QR code mpya... Fanya refresh!</h3>');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Seva inasikiliza kwenye port ${PORT}`);
});

const userState = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr; // Inasasisha QR code ya kimataifa ili ionekane kwenye browser
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log('Muunganisho umekatika. Sababu:', reason);
            if (reason !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log('Akaunti imetolewa. Futa auth_info_baileys na uanze upya.');
            }
        } else if (connection === 'open') {
            latestQR = ''; // Ikishaunganishwa, tunafuta QR code
            console.log('✅ Bot imeunganishwa mafanikio kwenye WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const senderID = m.key.remoteJid;
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text;
        if (!messageText) return;

        const text = messageText.trim();
        const lowerText = text.toLowerCase();

        // Kanuni ya 1: Mteja akituma 0, menu, hi, au hello - safisha state na umpe menyu kuu
        if (lowerText === '0' || lowerText === 'menu' || lowerText === 'hi' || lowerText === 'mambo' || lowerText === 'habari' || lowerText === 'kwema' || lowerText === 'hello') {
            delete userState[senderID];
            const menuText = `Habari, karibu Z-Aura Home & Fragrance 👋\n\nTafadhali chagua aina ya (Combo) unayohitaji kwa kutuma namba husika 🔢\n\nTuma namba **0** wakati wowote kurudi kwenye menyu kuu.\n\n1️⃣ 🧺 LAUNDRY CARE COMBOS\n2️⃣ 👶 BABY CARE COMBOS\n3️⃣ 🧼 HOME CLEANING COMBOS\n4️⃣ 🌸 AIR FRAGRANCE COMBOS\n5️⃣ 🚗 CAR CARE COMBOS`;
            await sock.sendMessage(senderID, { text: menuText });
            return;
        }

        // Hatua ya kusubiri Jina la Mteja na Uhakiki wake
        if (userState[senderID] && userState[senderID].step === 'awaiting_name') {
            if (!isNaN(text) || text.length < 3) {
                await sock.sendMessage(senderID, { text: "⚠️ Samahani, tafadhali andika **jina lako kamili** (sio namba au herufi fupi):" });
                return;
            }

            userState[senderID].name = text;
            userState[senderID].step = 'awaiting_location';
            await sock.sendMessage(senderID, { text: `Asante **${text}**! Sasa tafadhali andika **eneo lako unaloishi** na namba ya simu ya kupokelea mzigo (Mfano: Kinondoni, Dar es Salaam):` });
            return;
        }

        // Hatua ya kusubiri Eneo na Uhakiki wake
        if (userState[senderID] && userState[senderID].step === 'awaiting_location') {
            if (!isNaN(text) || text.length < 2) {
                await sock.sendMessage(senderID, { text: "⚠️ Tafadhali andika jina la eneo lako unaloishi vizuri (Mfano: Mikocheni, Dar es Salaam):" });
                return;
            }

            const customerLocation = text;
            const orderedItem = userState[senderID].item;
            const customerName = userState[senderID].name;

            await sock.sendMessage(senderID, { 
                text: `🎉 Hongera sana ${customerName}!\n\nOda yako ya **${orderedItem}** imepokelewa kikamilifu.\n📍 Eneo lako: ${customerLocation}\n\nUsimamizi wa Z-Aura Home & Fragrance utawasiliana nawe hivi punde kwa ajili ya malipo na kuletewa mzigo wako. Asante sana! 🙏\n\nTuma namba **0** kurudi kwenye menyu kuu.` 
            });

            console.log(`\n📦 ODA MPYA IMETHIBITISHWA!\nJina: ${customerName}\nBidhaa: ${orderedItem}\nEneo: ${customerLocation}\nNamba ya WhatsApp: ${senderID}\n`);
            
            delete userState[senderID];
            return;
        }

        // Menyu Kuu ya Makundi
        if (lowerText === '1') {
            await sock.sendMessage(senderID, { text: `🧺 **LAUNDRY CARE COMBOS**\nHusaidia kupata nguo safi, laini na zenye harufu nzuri kwa muda mrefu. Huondoa madoa na harufu zisizopendeza, na kuacha nguo zikiwa fresh na tayari kuvaliwa.\nTuma namba ya combo unayotaka kuagiza:\n\n11. Z-AURA LAUNDRY STARTER\n12. Z-AURA FRESH LAUNDRY COMBO\n13. Z-AURA PREMIUM LAUNDRY COLLECTION\n14. Z-AURA FAMILY LAUNDRY PACK\n\nTuma **0** kurudi kwenye menyu kuu.` });
        }
        else if (lowerText === '2') {
            await sock.sendMessage(senderID, { text: `👶 **BABY CARE COMBOS**\nImeandaliwa maalum kwa ajili ya nguo za watoto, kusaidia kuziweka safi, laini na zenye harufu mwanana. Hufaa kwa matumizi ya kila siku na husaidia kutunza upole wa nguo zinazogusa ngozi ya mtoto.\nTuma namba ya combo unayotaka kuagiza:\n\n21. Z-AURA BABY CLOTHES CARE PACK\n\nTuma **0** kurudi kwenye menyu kuu.` });
        }
        else if (lowerText === '3') {
            await sock.sendMessage(senderID, { text: `🧼 **HOME CLEANING COMBOS**\nKifurushi kamili cha usafi wa nyumbani kinachokusaidia kuokoa muda, kuacha kila sehemu ikiwa safi na kung'aa, huku kikiongeza harufu nzuri na freshness ya kudumu.\nTuma namba ya combo unayotaka kuagiza:\n\n31. Z-AURA KITCHEN POWER COMBO\n32. Z-AURA BATHROOM & TOILET POWER PACK\n33. Z-AURA DEEP CLEAN HOME COMBO\n34. Z-AURA APPLIANCE CARE PACK\n\nTuma **0** kurudi kwenye menyu kuu.` });
        }
        else if (lowerText === '4') {
            await sock.sendMessage(senderID, { text: `🌸 **AIR FRAGRANCE COMBOS**\nHuondoa harufu zisizopendeza za sebleni, jikoni,bafuni,chooni, unyevunyevu na moshi, na kuacha nyumba ikiwa safi, fresh na yenye harufu nzuri kwa muda wote.\nTuma namba ya combo unayotaka kuagiza:\n41. Z-AURA HOME FRESH STARTER\n42. Z-AURA PREMIUM HOME FRAGRANCE\n43. Z-AURA BIN & SPACE FRESH PACK\n\nTuma **0** kurudi kwenye menyu kuu.` });
        }
        else if (lowerText === '5') {
            await sock.sendMessage(senderID, { text: `🚗 **CAR CARE COMBOS**\nSafisha na linda interior ya gari lako kwa urahisi. Husaidia kusafisha dashibodi na viti vya ngozi, huku ikisaidia kuvihifadhi katika hali nzuri na kuacha harufu ya kifahari na ya kuvutia.\nTuma namba ya combo unayotaka kuagiza:\n51. Z-AURA CAR FRESH STARTER\n52. Z-AURA CAR INTERIOR CARE\n53. Z-AURA PREMIUM CAR CLEAN AND FRESH\n\nTuma **0** kurudi kwenye menyu kuu.` });
        }

        // Vifurushi vya Laundry (11 - 14)
        else if (lowerText === '11') {
            userState[senderID] = { item: 'Z-AURA LAUNDRY STARTER', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA LAUNDRY STARTER (Basic)**\n\nWilko Laundry Gel Fresh Cotton 1L\nFairy Original Fabric Conditioner\nDr. Beckmann 3-in-1 Colour & Dirt Collector Sheets\nM Pre-Wash Stain Remover\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '12') {
            userState[senderID] = { item: 'Z-AURA FRESH LAUNDRY COMBO (Standard)', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA FRESH LAUNDRY COMBO (Standard)**\n\nLenor Fabric Conditioner Spring Awakening\nFairy Original Fabric Conditioner\nLenor Crease Releaser Exotic Bloom\nFebreze Fabric Freshener Lenor Exotic Bloom 500ml\nGel Beads\nMr Sheen Oxi Ultra 400g\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '13') {
            userState[senderID] = { item: 'Z-AURA PREMIUM LAUNDRY COLLECTION', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA PREMIUM LAUNDRY COLLECTION**\n\nWilko Laundry Gel Fresh Cotton\nLenor Outdoorable Fabric Conditioner\nLenor Fabric Conditioner Spring Awakening\nLenor Crease Releaser\nDr. Beckmann Colour & Dirt Collector\nM Pre-Wash Stain Remover\nGel Beads\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '14') {
            userState[senderID] = { item: 'Z-AURA FAMILY LAUNDRY PACK', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA FAMILY LAUNDRY PACK**\n\nGenesis Vibrant Detergent 750ml\nSta-Soft Spring Fresh 2L\nSta-Soft Aromatherapy Passion 2L\nDr. Beckmann Colour Collector\nM Pre-Wash Stain Remover\nHome Butler Laundry Bag\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }

        // Vifurushi vya Baby (21)
        else if (lowerText === '21') {
            userState[senderID] = { item: 'Z-AURA BABY CLOTHES CARE PACK', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA BABY CLOTHES CARE PACK**\n\nElizabeth Anne Baby Liquid Laundry Wash\nSta-Soft Ultra Concentrate Sensitive 1L\nDr. Beckmann Colour & Dirt Collector Sheets\nHome Butler Laundry Bag\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }

        // Vifurushi vya Home Cleaning (31 - 34)
        else if (lowerText === '31') {
            userState[senderID] = { item: 'Z-AURA KITCHEN POWER COMBO', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA KITCHEN POWER COMBO**\n\nAstonish Air Fryer Cleaner Degreaser\nAstonish Kitchen Cleaner Zesty Lemon\nAstonish Specialist Grease Lift\nElbow Grease Soda Crystals\nElbow Grease Bicarbonate Soda\nElbow Grease Gloves\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '32') {
            userState[senderID] = { item: 'Z-AURA BATHROOM & TOILET POWER PACK (Hygiene Pack)', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA BATHROOM & TOILET POWER PACK**\n\nAstonish White Jasmine & Basil Bathroom Cleaner\nAstonish Daily Shower Shine\nHarpic Original 750ml & Power Plus Original\nHarpic Lavender Toilet Cleaner\nDomestos Lavender Blast Thick Bleach & 50g Toilet Cleaner\nToilet Block 50g & Harpic Rimblock\nDuzzit Window Squeegee & Dish Brush Round\nElbow Grease Gloves (Large)\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '33') {
            userState[senderID] = { item: 'Z-AURA DEEP CLEAN HOME COMBO (All-In-One)', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA DEEP CLEAN HOME COMBO**\n\nAstonish Multi-Surface Cleaner Orange Grove\nAstonish Specialist Antibacterial Surface Cleanser\nMr Muscle Floor & All-Purpose Cleaner\nMr Sheen Daily Surface 1L\nDomestos Thick Bleach Summer Fresh\nSuper Brite Floor & Tile Cleaner Lavender\nAstonish Multipurpose Cleaner Bleach\nMr Muscle Shower Shine Cleaner & Superbrite 500ml\nJeyes Homeguard Bleach Citrus\nM Thick Bleach Lavender Bloom\nCobra Multi Surface Cleaner Lavender\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '34') {
            userState[senderID] = { item: 'Z-AURA APPLIANCE CARE PACK (Protection-And-Shine)', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA APPLIANCE CARE PACK**\n\nKwa ajili ya kutunza vifaa vyako vya nyumbani. Husaidia kuondoa scale na mabaki ya chokaa, kusafisha washing machine, na kung'arisha stainless steel kwa mwonekano safi na wa kuvutia.\n\nElbow Grease Kettle Descaler\nDuzzit Washing Machine Cleaner Lemon\nAstonish Stainless Steel Cleaner\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }

        // Vifurushi vya Air Fragrance (41 - 43)
        else if (lowerText === '41') {
            userState[senderID] = { item: 'Z-AURA HOME FRESH STARTER (Basic)', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA HOME FRESH STARTER**\n\nAirwick\nMystify Lavender Gel Air Freshener\nMystify Citrus Fruit Gel Air Freshener\nShield Fresh 24 Lavender\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '42') {
            userState[senderID] = { item: 'Z-AURA PREMIUM HOME FRAGRANCE', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA PREMIUM HOME FRAGRANCE**\n\nFebreze Air Freshener Peony & Cedar 185ml\nRS Fleur Home perfume\nRS Oud Forest\nRS Vanilla Bean\nFebreze Fabric Freshener Lenor Exotic Bloom\nFebreze Fabric Refresher Enchanted Wildflowers & Alpine Escape\nFebreze Fabric Plum Cherry\nMystify Gel Air Freshener & Shield Fresh 24 Tropical\nAirwick 250ml & Hanging Dehumidifier\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '43') {
            userState[senderID] = { item: 'Z-AURA BIN & SPACE FRESH PACK', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA BIN & SPACE FRESH PACK**\n\nBin Brite Citronella Lemon\nBin Brite Mediterranean Sun\nBin Brite Berry Blast\nBin Brite Spring Blossom\nSmall Space Dehumidifier\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }

        // Vifurushi vya Car Care (51 - 53)
        else if (lowerText === '51') {
            userState[senderID] = { item: 'Z-AURA CAR FRESH STARTER (Basic)', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA CAR FRESH STARTER**\n\nRS Fleur\nRS Vanilla Bean\nCar Fragrance Spicy Leather\nShield Fresh\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '52') {
            userState[senderID] = { item: 'Z-AURA CAR INTERIOR CARE', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA CAR INTERIOR CARE**\n\nShield Cockpit Dashboard Protector\nShield Leather Care 400ml\nShield Sheen Silicone\nShield Splash N Dash Sponge\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else if (lowerText === '53') {
            userState[senderID] = { item: 'Z-AURA PREMIUM CAR CLEAN AND FRESH', step: 'awaiting_name' };
            await sock.sendMessage(senderID, { text: "✅ **Z-AURA PREMIUM CAR CLEAN AND FRESH**\n\nOptimo Auto Washing Liquid\nShield Cockpit Dashboard Protector & Leather Care\nShield Sheen Silicone & Splash N Dash Sponge\nRS Leather Secret & Car Fragrance Spicy Leather\nRS Fleur, Oud Forest & Vanilla Bean\n\nIli kuweka oda ya kifurushi hiki, tafadhali andika **jina lako kamili**:" });
        }
        else {
            await sock.sendMessage(senderID, { text: "Samahani, tuma namba **0** au neno **menu** kuona orodha kuu." });
        }
    });
}

startBot();
