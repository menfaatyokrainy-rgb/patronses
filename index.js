// ============================================================
// ULTRA LUXURY DISCORD VOICE KEEPER & MANAGEMENT DASHBOARD
// ============================================================
const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'Emir0203'; // ENV veya varsayılan şifre

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------
// DURUM METRİKLERİ VE SİSTEM TESPİTİ
// ------------------------------------------------------------
const systemStats = {
    startTime: Date.now(),
    connectedGuild: null,
    connectedChannel: null,
    status: 'DISCONNECTED', // CONNECTED, CONNECTING, DISCONNECTED
    reconnectCount: 0,
    disconnectCount: 0,
    logs: [],
    currentGuildId: process.env.GUILD_ID || null,
    currentChannelId: process.env.CHANNEL_ID || null
};

function logToSystem(msg, type = 'INFO') {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    const logEntry = { timestamp, msg, type };
    systemStats.logs.unshift(logEntry);
    if (systemStats.logs.length > 50) systemStats.logs.pop();
    console.log(`[${timestamp}] [${type}] ${msg}`);
}

// ------------------------------------------------------------
// AUTH MIDDLEWARE (GÜVENLİK)
// ------------------------------------------------------------
const authCheck = (req, res, next) => {
    const authHeader = req.headers['x-panel-auth'];
    if (authHeader === PANEL_PASSWORD) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Yetkisiz Erişim! Geçersiz Şifre.' });
    }
};

// ------------------------------------------------------------
// DISCORD SELFBOT CLIENT
// ------------------------------------------------------------
const client = new Client({ checkUpdate: false });

async function joinVoiceChannel(guildId, channelId) {
    try {
        systemStats.status = 'CONNECTING';
        logToSystem(`Kanala bağlanma isteği gönderildi: Guild [${guildId}] Channel [${channelId}]`, 'STATE');

        let guild = client.guilds.cache.get(guildId);
        if (!guild) guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) throw new Error('Sunucu bulunamadı!');

        let channel = client.channels.cache.get(channelId);
        if (!channel) channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) throw new Error('Kanal bulunamadı!');
        if (!channel.isVoice()) throw new Error('Seçilen kanal ses kanalı değil!');

        await client.voice.joinChannel(channel, {
            selfMute: false,
            selfDeaf: true,
            force: true
        });

        systemStats.connectedGuild = { id: guild.id, name: guild.name, icon: guild.iconURL() };
        systemStats.connectedChannel = { id: channel.id, name: channel.name };
        systemStats.currentGuildId = guild.id;
        systemStats.currentChannelId = channel.id;
        systemStats.status = 'CONNECTED';
        systemStats.reconnectCount++;

        logToSystem(`Başarıyla bağlandı: ${guild.name} / ${channel.name}`, 'SUCCESS');
        return { success: true, message: `Bağlandı: ${channel.name}` };
    } catch (err) {
        systemStats.status = 'DISCONNECTED';
        logToSystem(`Bağlantı Hatası: ${err.message}`, 'ERROR');
        return { success: false, message: err.message };
    }
}

client.once('ready', async () => {
    logToSystem(`Hesap Aktif: ${client.user.tag}`, 'SUCCESS');
    
    // Varsayılan ENV değişkenleri varsa otomatik bağlan
    if (systemStats.currentGuildId && systemStats.currentChannelId) {
        await joinVoiceChannel(systemStats.currentGuildId, systemStats.currentChannelId);
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.id !== client.user?.id) return;

    if (oldState.channelId && !newState.channelId) {
        logToSystem('Ses kanalından atıldınız! Otomatik geri bağlanılıyor...', 'WARN');
        systemStats.status = 'DISCONNECTED';
        systemStats.disconnectCount++;
        if (systemStats.currentGuildId && systemStats.currentChannelId) {
            setTimeout(() => joinVoiceChannel(systemStats.currentGuildId, systemStats.currentChannelId), 3000);
        }
    }
});

// ------------------------------------------------------------
// EXPRESS REST API ENDPOINTS
// ------------------------------------------------------------

// UptimeRobot / Render Health Check
app.get('/ping', (req, res) => res.status(200).send('PONG'));

// Şifre Doğrulama API
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === PANEL_PASSWORD) {
        res.json({ success: true, token: PANEL_PASSWORD });
    } else {
        res.status(401).json({ success: false, message: 'Hatalı Parola!' });
    }
});

// Sistem İstatistikleri & Durum API
app.get('/api/stats', authCheck, (req, res) => {
    const memoryUsage = process.memoryUsage();
    res.json({
        uptime: Math.floor((Date.now() - systemStats.startTime) / 1000),
        status: systemStats.status,
        botUser: client.user ? {
            tag: client.user.tag,
            avatar: client.user.displayAvatarURL(),
            id: client.user.id
        } : null,
        connectedGuild: systemStats.connectedGuild,
        connectedChannel: systemStats.connectedChannel,
        reconnectCount: systemStats.reconnectCount,
        disconnectCount: systemStats.disconnectCount,
        memoryUsage: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        logs: systemStats.logs
    });
});

// Hesaptaki Sunucuları ve Ses Kanallarını Listeleme API
app.get('/api/guilds', authCheck, async (req, res) => {
    if (!client.user) return res.status(503).json({ success: false, message: 'Discord İstemcisi Hazır Değil' });

    try {
        const guildsData = client.guilds.cache.map(guild => {
            const voiceChannels = guild.channels.cache
                .filter(ch => ch.isVoice())
                .map(ch => ({ id: ch.id, name: ch.name, userCount: ch.members.size }));

            return {
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png',
                memberCount: guild.memberCount,
                voiceChannels
            };
        });

        res.json({ success: true, guilds: guildsData });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Manuel Ses Kanalına Bağlanma API
app.post('/api/connect', authCheck, async (req, res) => {
    const { guildId, channelId } = req.body;
    if (!guildId || !channelId) {
        return res.status(400).json({ success: false, message: 'Eksik Parametre!' });
    }
    const result = await joinVoiceChannel(guildId, channelId);
    res.json(result);
});

// Ses Kanalından Ayrılma API
app.post('/api/disconnect', authCheck, async (req, res) => {
    try {
        if (client.voice && client.voice.adapters) {
            client.voice.adapters.forEach(adapter => adapter.destroy());
        }
        systemStats.status = 'DISCONNECTED';
        systemStats.connectedGuild = null;
        systemStats.connectedChannel = null;
        logToSystem('Ses kanalından manuel olarak ayrılındı.', 'WARN');
        res.json({ success: true, message: 'Bağlantı Kesildi' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ------------------------------------------------------------
// SERVER LAUNCH
// ------------------------------------------------------------
app.listen(PORT, () => {
    logToSystem(`Panel sunucusu aktif: Port ${PORT}`, 'INFO');
});

if (DISCORD_TOKEN) {
    client.login(DISCORD_TOKEN).catch(err => {
        logToSystem(`Discord Giriş Başarısız: ${err.message}`, 'ERROR');
    });
} else {
    logToSystem('DISCORD_TOKEN bulunamadı! Lütfen Environment Variable olarak ekleyin.', 'ERROR');
}
