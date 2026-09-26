// ============================================================
// 7/24 SES KANALI KEEPER - RENDER SÜRÜMÜ + UPTIMEROBOT
// ============================================================
// Environment Variables:
//   DISCORD_TOKEN  → Discord selfbot token
//   GUILD_ID       → Sunucu ID
//   CHANNEL_ID     → Ses kanalı ID
//   PORT           → Render otomatik atar
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

if (!DISCORD_TOKEN) { console.error('[X] DISCORD_TOKEN eksik!'); process.exit(1); }
if (!GUILD_ID)      { console.error('[X] GUILD_ID eksik!');      process.exit(1); }
if (!CHANNEL_ID)    { console.error('[X] CHANNEL_ID eksik!');    process.exit(1); }

// ------------------------------------------------------------
// DURUM
// ------------------------------------------------------------
const baslangicZamani = Date.now();
let sonDurum = {
    bagli: false,
    kanal: null,
    sunucu: null,
    deneme: 0,
    sonHata: null,
    sonBaglanmaZamani: null,
    toplamBaglanma: 0,
    toplamKopma: 0
};

// ------------------------------------------------------------
// HEALTH CHECK SERVER
// ------------------------------------------------------------
const app = express();

// UPTIMEROBOT İÇİN ÖZEL ENDPOINT — her zaman 200 OK döner
// UptimeRobot buraya ping atacak, Render uyumayacak
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// UptimeRobot için ikinci endpoint (yedek)
app.get('/uptime', (req, res) => {
    res.status(200).send('OK');
});

// Render kendi health check'i için (opsiyonel)
app.get('/health', (req, res) => {
    // Discord durumu ne olursa olsun 200 dön (Render servisi kapatmasın)
    res.status(200).json({
        durum: sonDurum.bagli ? 'bagli' : 'bagli_degil',
        kanal: sonDurum.kanal,
        sunucu: sonDurum.sunucu,
        uptime_saniye: Math.floor((Date.now() - baslangicZamani) / 1000)
    });
});

// Detaylı durum (senin manuel kontrolün için)
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - baslangicZamani) / 1000);
    res.json({
        durum: sonDurum.bagli ? 'bagli' : 'bagli_degil',
        kanal: sonDurum.kanal,
        sunucu: sonDurum.sunucu,
        uptime_saniye: uptime,
        uptime_okunabilir: formatUptime(uptime),
        deneme_sayisi: sonDurum.deneme,
        son_hata: sonDurum.sonHata,
        son_baglanma: sonDurum.sonBaglanmaZamani,
        toplam_baglanma: sonDurum.toplamBaglanma,
        toplam_kopma: sonDurum.toplamKopma,
        ping_endpoint: '/ping',
        uptime_endpoint: '/uptime'
    });
});

function formatUptime(saniye) {
    const g = Math.floor(saniye / 86400);
    const s = Math.floor((saniye % 86400) / 3600);
    const d = Math.floor((saniye % 3600) / 60);
    const sn = saniye % 60;
    return `${g}g ${s}s ${d}d ${sn}sn`;
}

app.listen(PORT, () => {
    console.log('[✓] Health check server: port ' + PORT);
    console.log('[i] UptimeRobot endpoint : /ping');
    console.log('[i] UptimeRobot endpoint : /uptime');
    console.log('[i] Detaylı durum       : /');
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
        let guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
        if (!guild) throw new Error('Sunucu bulunamadı: ' + GUILD_ID);
        sonDurum.sunucu = guild.name;

        let channel = client.channels.cache.get(CHANNEL_ID);
        if (!channel) channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
        if (!channel) throw new Error('Ses kanalı bulunamadı: ' + CHANNEL_ID);
        if (!channel.isVoice()) throw new Error('Kanal ses kanalı değil: ' + channel.name);
        sonDurum.kanal = channel.name;

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

        console.log('[>] Bağlanılıyor (' + retrySayaci + '. deneme): ' + guild.name + ' / ' + channel.name);

        await client.voice.joinChannel(channel, {
            selfMute: false,
            selfDeaf: true,
            force: true
        });

        bagliKanalId = channel.id;
        sonDurum.bagli = true;
        sonDurum.sonHata = null;
        sonDurum.sonBaglanmaZamani = new Date().toISOString();
        sonDurum.toplamBaglanma++;
        retrySayaci = 0;
        console.log('[✓] Bağlandı: ' + channel.name + ' (' + guild.name + ')');

    } catch (err) {
        sonDurum.bagli = false;
        sonDurum.sonHata = err.message;
        console.log('[X] Bağlanma hatası (deneme ' + retrySayaci + '): ' + err.message);

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
// SES DURUMU DEĞİŞİKLİĞİ
// ------------------------------------------------------------
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (kapatiliyor) return;
    if (oldState.id !== client.user?.id) return;

    if (oldState.channelId && !newState.channelId) {
        console.log('[!] Ses kanalından atıldı, geri bağlanılıyor...');
        bagliKanalId = null;
        sonDurum.bagli = false;
        sonDurum.toplamKopma++;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            if (!kapatiliyor) { yenidenBaglaniyor = false; sesKanalinaBaglan(0); }
        }, 2000);
    }

    if (oldState.channelId && newState.channelId && newState.channelId !== CHANNEL_ID) {
        console.log('[!] Farklı kanala taşındı, hedef kanala dönülüyor...');
        bagliKanalId = null;
        sonDurum.bagli = false;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            if (!kapatiliyor) { yenidenBaglaniyor = false; sesKanalinaBaglan(0); }
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
    sonDurum.toplamKopma++;
});

client.on('shardReconnecting', () => {
    console.log('[*] Discord yeniden bağlanıyor...');
});

client.on('shardResume', () => {
    console.log('[✓] Discord bağlantısı yeniden kuruldu.');
    setTimeout(() => {
        if (!kapatiliyor) { yenidenBaglaniyor = false; sesKanalinaBaglan(0); }
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
