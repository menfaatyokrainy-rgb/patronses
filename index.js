// ============================================================
// 7/24 SES KANALI KEEPER - RENDER SÜRÜMÜ
// ============================================================
// Environment Variables:
//   DISCORD_TOKEN  → Discord selfbot token
//   GUILD_ID       → Sunucu ID
//   CHANNEL_ID     → Ses kanalı ID
//   PORT           → Render otomatik atar (health check için)
// ============================================================

const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

// ------------------------------------------------------------
// ENV DEĞİŞKENLERİ
// ------------------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID      = process.env.GUILD_ID;
const CHANNEL_ID    = process.env.CHANNEL_ID;
const PORT          = process.env.PORT || 3000;

if (!DISCORD_TOKEN) {
    console.error('[X] DISCORD_TOKEN ortam değişkeni eksik!');
    process.exit(1);
}
if (!GUILD_ID) {
    console.error('[X] GUILD_ID ortam değişkeni eksik!');
    process.exit(1);
}
if (!CHANNEL_ID) {
    console.error('[X] CHANNEL_ID ortam değişkeni eksik!');
    process.exit(1);
}

// ------------------------------------------------------------
// HEALTH CHECK SERVER (Render için)
// ------------------------------------------------------------
const app = express();
let sonDurum = {
    bagli: false,
    kanal: null,
    sunucu: null,
    baslangic: Date.now(),
    deneme: 0,
    sonHata: null
};

app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - sonDurum.baslangic) / 1000);
    res.json({
        durum: sonDurum.bagli ? 'bagli' : 'bagli_degil',
        kanal: sonDurum.kanal,
        sunucu: sonDurum.sunucu,
        uptime_saniye: uptime,
        deneme_sayisi: sonDurum.deneme,
        son_hata: sonDurum.sonHata
    });
});

app.get('/health', (req, res) => {
    res.status(sonDurum.bagli ? 200 : 503).send(sonDurum.bagli ? 'OK' : 'NOT CONNECTED');
});

app.listen(PORT, () => {
    console.log('[✓] Health check server: port ' + PORT);
});

// ------------------------------------------------------------
// CLIENT
// ------------------------------------------------------------
const client = new Client({ checkUpdate: false });

let bagliKanalId = null;
let yenidenBaglaniyor = false;
let kapatiliyor = false;
let retrySayaci = 0;
let retryTimer = null;

// ------------------------------------------------------------
// SES KANALINA BAĞLAN (RETRY'Lİ)
// ------------------------------------------------------------
async function sesKanalinaBaglan(denemeNo) {
    if (yenidenBaglaniyor || kapatiliyor) return;
    yenidenBaglaniyor = true;
    retrySayaci = (denemeNo || 0) + 1;
    sonDurum.deneme = retrySayaci;

    try {
        // Sunucuyu al
        let guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) {
            guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        }
        if (!guild) {
            throw new Error('Sunucu bulunamadı: ' + GUILD_ID);
        }
        sonDurum.sunucu = guild.name;

        // Kanalı al
        let channel = client.channels.cache.get(CHANNEL_ID);
        if (!channel) {
            channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
        }
        if (!channel) {
            throw new Error('Ses kanalı bulunamadı: ' + CHANNEL_ID);
        }
        if (!channel.isVoice()) {
            throw new Error('Kanal ses kanalı değil: ' + channel.name);
        }
        sonDurum.kanal = channel.name;

        // Zaten bağlı mı?
        const me = guild.members.me;
        if (me && me.voice && me.voice.channelId === channel.id) {
            console.log('[i] Zaten bağlı: ' + channel.name);
            bagliKanalId = channel.id;
            sonDurum.bagli = true;
            sonDurum.sonHata = null;
            yenidenBaglaniyor = false;
            retrySayaci = 0;
            return;
        }

        // Bağlan
        console.log('[>] Bağlanılıyor (' + retrySayaci + '. deneme): ' + guild.name + ' / ' + channel.name);

        await client.voice.joinChannel(channel, {
            selfMute: false,
            selfDeaf: true,
            force: true
        });

        bagliKanalId = channel.id;
        sonDurum.bagli = true;
        sonDurum.sonHata = null;
        retrySayaci = 0;
        console.log('[✓] Bağlandı: ' + channel.name + ' (' + guild.name + ')');

    } catch (err) {
        sonDurum.bagli = false;
        sonDurum.sonHata = err.message;
        console.log('[X] Bağlanma hatası (deneme ' + retrySayaci + '): ' + err.message);

        // Exponential backoff: 5, 10, 20, 40, 60, 60... saniye
        let bekle = Math.min(5 * Math.pow(2, retrySayaci - 1), 60);
        console.log('[i] ' + bekle + ' saniye sonra tekrar denenecek...');

        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            yenidenBaglaniyor = false;
            sesKanalinaBaglan(retrySayaci);
        }, bekle * 1000);
        return;
    }

    yenidenBaglaniyor = false;
}

// ------------------------------------------------------------
// READY
// ------------------------------------------------------------
client.once('ready', async () => {
    console.log('[✓] Giriş yapıldı: ' + client.user.tag);
    console.log('[i] Sunucu: ' + GUILD_ID);
    console.log('[i] Kanal : ' + CHANNEL_ID);
    console.log('');
    await sesKanalinaBaglan(0);
});

// ------------------------------------------------------------
// SES DURUMU DEĞİŞİKLİĞİ (atılırsa / taşınırsa geri bağlan)
// ------------------------------------------------------------
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (kapatiliyor) return;
    if (oldState.id !== client.user?.id) return;

    // Kanalından atıldı
    if (oldState.channelId && !newState.channelId) {
        console.log('[!] Ses kanalından atıldı, geri bağlanılıyor...');
        bagliKanalId = null;
        sonDurum.bagli = false;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            if (!kapatiliyor) {
                yenidenBaglaniyor = false;
                sesKanalinaBaglan(0);
            }
        }, 2000);
    }

    // Başka kanala taşındı
    if (oldState.channelId && newState.channelId && newState.channelId !== CHANNEL_ID) {
        console.log('[!] Farklı kanala taşındı, hedef kanala dönülüyor...');
        bagliKanalId = null;
        sonDurum.bagli = false;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            if (!kapatiliyor) {
                yenidenBaglaniyor = false;
                sesKanalinaBaglan(0);
            }
        }, 2000);
    }
});

// ------------------------------------------------------------
// HATA YÖNETİMİ
// ------------------------------------------------------------
client.on('error', (err) => {
    console.log('[X] Client hatası: ' + err.message);
});

client.on('shardDisconnect', () => {
    if (kapatiliyor) return;
    console.log('[!] Bağlantı koptu.');
    sonDurum.bagli = false;
});

client.on('shardReconnecting', () => {
    console.log('[*] Discord yeniden bağlanıyor...');
});

client.on('shardResume', () => {
    console.log('[✓] Discord bağlantısı yeniden kuruldu.');
    setTimeout(() => {
        if (!kapatiliyor) {
            yenidenBaglaniyor = false;
            sesKanalinaBaglan(0);
        }
    }, 3000);
});

// ------------------------------------------------------------
// PERİYODİK KONTROL (her 30 saniyede bir)
// ------------------------------------------------------------
setInterval(() => {
    if (kapatiliyor) return;
    if (!client || !client.user) return;

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const me = guild.members.me;
    if (!me) return;

    const suAnkiKanal = me.voice?.channelId;
    if (suAnkiKanal !== CHANNEL_ID) {
        console.log('[!] Bağlı değil (kanal: ' + (suAnkiKanal || 'yok') + '), yeniden bağlanılıyor...');
        bagliKanalId = null;
        sonDurum.bagli = false;
        if (!yenidenBaglaniyor) {
            yenidenBaglaniyor = false;
            sesKanalinaBaglan(0);
        }
    } else {
        sonDurum.bagli = true;
    }
}, 30000);

// ------------------------------------------------------------
// LOGIN
// ------------------------------------------------------------
(async () => {
    try {
        await client.login(DISCORD_TOKEN);
    } catch (err) {
        console.log('[X] Giriş hatası: ' + err.message);
        console.log('[i] 30 saniye sonra tekrar denenecek...');
        setTimeout(() => {
            client.login(DISCORD_TOKEN).catch((e) => {
                console.log('[X] Tekrar giriş hatası: ' + e.message);
            });
        }, 30000);
    }
})();

// ------------------------------------------------------------
// KAPATMA
// ------------------------------------------------------------
process.on('SIGINT', async () => {
    console.log('\n[*] Kapatılıyor...');
    kapatiliyor = true;
    try {
        if (retryTimer) clearTimeout(retryTimer);
        if (client.voice && client.voice.adapters) {
            client.voice.adapters.forEach(a => { try { a.destroy(); } catch {} });
        }
        client.destroy();
    } catch {}
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[*] SIGTERM alındı, kapatılıyor...');
    kapatiliyor = true;
    try { client.destroy(); } catch {}
    process.exit(0);
});
