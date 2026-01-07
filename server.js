const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

// Cargar variables de entorno
require('dotenv').config();

const app = express();

// Configuración de variables de entorno
const {
    PORT = 3000,
    CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    SESSION_SECRET = 'default_session_secret_change_this',
    DISCORD_TOKEN,
    NODE_ENV = 'production'
} = process.env;

// URLs definitivas para producción
const FINAL_WEBSITE_URL = 'https://cofonitabot.netlify.app';
const FINAL_API_URL = 'https://cofonitabot.onrender.com';
const FINAL_REDIRECT_URL = `${FINAL_API_URL}/auth/discord/callback`;

// DEBUG: Mostrar variables cargadas
console.log('🔧 Variables de entorno cargadas:');
console.log('   PORT:', PORT);
console.log('   NODE_ENV:', NODE_ENV);
console.log('   WEBSITE_URL (frontend):', FINAL_WEBSITE_URL);
console.log('   API_URL (backend):', FINAL_API_URL);
console.log('   REDIRECT_URL (final):', FINAL_REDIRECT_URL);
console.log('   CLIENT_ID:', CLIENT_ID ? '✓ Configurado' : '✗ No configurado');
console.log('   DISCORD_TOKEN:', DISCORD_TOKEN ? '✓ Configurado' : '✗ No configurado');

// Verificar variables de entorno
if (!CLIENT_ID) {
    console.error('❌ ERROR: CLIENT_ID no configurado');
    process.exit(1);
}

if (!DISCORD_CLIENT_SECRET) {
    console.error('❌ ERROR: DISCORD_CLIENT_SECRET no configurado');
    process.exit(1);
}

if (!DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN no configurado');
    process.exit(1);
}

// Validar que el callback URL sea accesible desde internet
if (FINAL_REDIRECT_URL.includes('localhost') || FINAL_REDIRECT_URL.includes('127.0.0.1')) {
    console.error('❌ ERROR: REDIRECT_URL no puede ser localhost en producción');
    process.exit(1);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// Configuración de sesión mejorada para producción
const MemoryStore = require('memorystore')(session);

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
        httpOnly: true,
        sameSite: 'lax'
    },
    name: 'cofonita.sid',
    store: new MemoryStore({
        checkPeriod: 86400000
    })
}));

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

// Cache para datos del bot
const botCache = {
    guilds: [],
    lastUpdate: null,
    stats: {
        totalServers: 0,
        totalUsers: 0,
        totalCommands: 0
    }
};

// Función para obtener servidores donde el bot está presente
async function getBotGuilds() {
    try {
        if (!DISCORD_TOKEN) {
            console.warn('⚠️  DISCORD_TOKEN no configurado, no se pueden obtener servidores del bot');
            return [];
        }
        
        const now = Date.now();
        if (botCache.lastUpdate && (now - botCache.lastUpdate) < 300000) {
            console.log('📦 Usando cache de servidores del bot');
            return botCache.guilds;
        }

        console.log('🔄 Obteniendo servidores del bot desde Discord API...');
        const botGuildsResponse = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
            timeout: 10000
        });

        botCache.guilds = botGuildsResponse.data;
        botCache.lastUpdate = now;
        console.log(`✅ Obtenidos ${botCache.guilds.length} servidores del bot`);
        
        return botCache.guilds;
    } catch (error) {
        console.error('❌ Error al obtener servidores del bot:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data);
        }
        return [];
    }
}

// Configurar estrategia de Discord
passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: FINAL_REDIRECT_URL,
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log(`🔍 Autenticando usuario: ${profile.username}#${profile.discriminator} (ID: ${profile.id})`);
        
        const enrichedProfile = {
            ...profile,
            accessToken,
            refreshToken,
            avatar_url: profile.avatar 
                ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=256`
                : `https://cdn.discordapp.com/embed/avatars/${profile.discriminator % 5}.png`
        };

        const botGuilds = await getBotGuilds();
        const botGuildIds = botGuilds.map(g => g.id);
        
        console.log(`🔍 Bot está en ${botGuildIds.length} servidores`);
        
        if (enrichedProfile.guilds) {
            console.log(`🔍 Usuario tiene ${enrichedProfile.guilds.length} servidores`);
            enrichedProfile.guilds = enrichedProfile.guilds.map(guild => {
                const isBotInstalled = botGuildIds.includes(guild.id);
                const isManageable = (guild.permissions & 0x8) === 0x8;
                
                return {
                    ...guild,
                    bot_installed: isBotInstalled,
                    manageable: isManageable,
                    login_url: `${FINAL_WEBSITE_URL}/login?guild_id=${guild.id}&redirect=${encodeURIComponent('/dashboard')}`
                };
            });
        }

        console.log(`✅ Autenticación exitosa para ${enrichedProfile.username}`);
        return done(null, enrichedProfile);
    } catch (error) {
        console.error('❌ Error en autenticación:', error.message);
        if (error.response) {
            console.error('   Response data:', error.response.data);
        }
        return done(error, null);
    }
}));

// Serializar usuario
passport.serializeUser((user, done) => {
    done(null, user);
});

// Deserializar usuario
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// Middleware de autenticación
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    console.log('🔒 Usuario no autenticado, redirigiendo a /login');
    res.redirect(`${FINAL_WEBSITE_URL}/login`);
};

// Middleware para CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', FINAL_WEBSITE_URL);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Middleware para pasar datos de usuario a las vistas
app.use((req, res, next) => {
    res.locals.user = req.isAuthenticated() ? req.user : null;
    res.locals.websiteUrl = FINAL_WEBSITE_URL;
    res.locals.apiUrl = FINAL_API_URL;
    next();
});

// Servir archivos HTML
app.get('/', (req, res) => {
    console.log('🏠 Sirviendo página principal del backend');
    res.json({
        service: 'Cofonita Auth Backend',
        status: 'running',
        website: FINAL_WEBSITE_URL,
        api: FINAL_API_URL,
        environment: NODE_ENV
    });
});

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        console.log('✅ Usuario ya autenticado, redirigiendo al dashboard');
        return res.redirect(`${FINAL_WEBSITE_URL}/dashboard`);
    }
    console.log('🔐 Sirviendo página de login');
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Ruta para el dashboard
app.get('/dashboard', isAuthenticated, (req, res) => {
    console.log('📊 Sirviendo dashboard para:', req.user.username);
    res.redirect(`${FINAL_WEBSITE_URL}/dashboard`);
});

// Ruta de Easter egg
app.get('/secret', (req, res) => {
    console.log('🥚 Easter egg encontrado');
    res.json({
        success: true,
        message: '🎮 Easter egg encontrado!',
        secret: 'COFONITA_SECRET_' + crypto.randomBytes(8).toString('hex'),
        timestamp: new Date().toISOString()
    });
});

// Ruta para obtener estadísticas del bot
app.get('/api/stats', async (req, res) => {
    try {
        const stats = {
            serverCount: botCache.guilds.length,
            userCount: 0,
            commandCount: 0,
            uptime: process.uptime(),
            version: '2.0.0'
        };
        
        console.log('📊 Sirviendo estadísticas del bot');
        res.json({
            success: true,
            stats: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error en /api/stats:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error obteniendo estadísticas' 
        });
    }
});

// API para el juego Undertale
app.get('/api/game/undertale', (req, res) => {
    console.log('🎮 Sirviendo API del juego');
    res.json({
        success: true,
        game: {
            name: 'Cofonita Battle',
            version: '1.0',
            difficulty: 'medium',
            boss: '🤖 Cofonita AI',
            maxHP: 20
        },
        timestamp: new Date().toISOString()
    });
});

// Ruta para iniciar autenticación con Discord
app.get('/auth/discord', (req, res, next) => {
    console.log('🔑 Iniciando autenticación OAuth2 con Discord');
    console.log('   Callback URL configurada:', FINAL_REDIRECT_URL);
    passport.authenticate('discord')(req, res, next);
});

// Callback de Discord OAuth2
app.get('/auth/discord/callback',
    (req, res, next) => {
        console.log('🔄 Procesando callback de Discord OAuth2');
        console.log('   URL de callback recibida:', req.url);
        passport.authenticate('discord', { 
            failureRedirect: `${FINAL_WEBSITE_URL}/login?error=auth_failed`
        })(req, res, next);
    },
    (req, res) => {
        console.log('✅ Autenticación exitosa para:', req.user?.username || 'usuario desconocido');
        const redirectUrl = `${FINAL_WEBSITE_URL}/dashboard`;
        console.log('   Redirigiendo a:', redirectUrl);
        res.redirect(redirectUrl);
    }
);

// API para obtener información del usuario
app.get('/api/user', isAuthenticated, (req, res) => {
    console.log('👤 Sirviendo información del usuario:', req.user.username);
    res.json({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            avatar_url: req.user.avatar_url,
            guilds: req.user.guilds || []
        }
    });
});

// API para obtener estadísticas del bot
app.get('/api/bot/stats', isAuthenticated, async (req, res) => {
    try {
        console.log('📈 Obteniendo estadísticas del bot para:', req.user.username);
        
        const manageableServers = req.user.guilds?.filter(g => g.manageable).length || 0;
        
        await getBotGuilds();
        
        const stats = {
            totalServers: botCache.guilds.length,
            manageableServers: manageableServers,
            totalUsers: 0,
            uptime: 99.8,
            commandsUsed: 0
        };

        console.log(`📊 Stats: ${stats.totalServers} servidores totales, ${stats.manageableServers} administrables`);
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('❌ Error al obtener estadísticas:', error.message);
        res.json({
            success: true,
            stats: {
                totalServers: botCache.guilds.length || 0,
                manageableServers: req.user.guilds?.filter(g => g.manageable).length || 0,
                totalUsers: 0,
                uptime: 99.8,
                commandsUsed: 0
            }
        });
    }
});

// API para obtener información de servidor específico
app.get('/api/guild/:guildId', isAuthenticated, async (req, res) => {
    try {
        const { guildId } = req.params;
        console.log(`🏰 Solicitando información del servidor: ${guildId}`);
        
        const userGuild = req.user.guilds?.find(g => g.id === guildId);
        
        if (!userGuild) {
            console.log(`❌ Servidor ${guildId} no encontrado para el usuario`);
            return res.status(404).json({ 
                success: false, 
                error: 'Servidor no encontrado' 
            });
        }

        console.log(`✅ Servidor encontrado: ${userGuild.name}`);
        res.json({
            success: true,
            guild: userGuild
        });
    } catch (error) {
        console.error('❌ Error al obtener información del servidor:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
});

// API para conectar servidor
app.post('/api/guild/:guildId/connect', isAuthenticated, (req, res) => {
    try {
        const { guildId } = req.params;
        console.log(`🔗 Conectando al servidor: ${guildId}`);
        
        const userGuild = req.user.guilds?.find(g => g.id === guildId);
        
        if (!userGuild) {
            console.log(`❌ Servidor ${guildId} no encontrado`);
            return res.status(404).json({ 
                success: false, 
                error: 'Servidor no encontrado' 
            });
        }
        
        if (!userGuild.manageable) {
            console.log(`❌ Usuario no tiene permisos en el servidor ${guildId}`);
            return res.status(403).json({ 
                success: false, 
                error: 'No tienes permisos en este servidor' 
            });
        }

        const loginUrl = `${FINAL_WEBSITE_URL}/login?guild_id=${guildId}&redirect=${encodeURIComponent('/dashboard')}`;
        
        console.log(`✅ Enlace de login generado para ${guildId}`);
        res.json({
            success: true,
            message: 'Redirigiendo a inicio de sesión...',
            login_url: loginUrl
        });
    } catch (error) {
        console.error('❌ Error al generar enlace:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error al generar enlace' 
        });
    }
});

// Ruta para obtener enlace de login directo para un servidor
app.get('/api/login/:guildId', isAuthenticated, (req, res) => {
    try {
        const { guildId } = req.params;
        console.log(`🔗 Generando enlace de login para servidor: ${guildId}`);
        
        const userGuild = req.user.guilds?.find(g => g.id === guildId);
        
        if (!userGuild) {
            console.log(`❌ Servidor ${guildId} no encontrado`);
            return res.status(404).json({ 
                success: false, 
                error: 'Servidor no encontrado' 
            });
        }

        const loginUrl = `${FINAL_WEBSITE_URL}/login?guild_id=${guildId}&redirect=${encodeURIComponent('/dashboard')}`;
        
        console.log(`✅ Enlace generado: ${loginUrl}`);
        res.json({
            success: true,
            login_url: loginUrl
        });
    } catch (error) {
        console.error('❌ Error al generar enlace:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error al generar enlace' 
        });
    }
});

// Logout
app.get('/logout', (req, res) => {
    const username = req.user?.username || 'desconocido';
    console.log(`👋 Usuario cerrando sesión: ${username}`);
    
    req.logout((err) => {
        if (err) {
            console.error('❌ Error al cerrar sesión:', err);
            return res.redirect(FINAL_WEBSITE_URL);
        }
        
        req.session.destroy((err) => {
            if (err) {
                console.error('❌ Error al destruir sesión:', err);
            }
            console.log(`✅ Sesión cerrada para ${username}`);
            res.redirect(`${FINAL_WEBSITE_URL}/login?success=logout`);
        });
    });
});

// Health check
app.get('/health', (req, res) => {
    const healthStatus = {
        status: 'ok',
        service: 'cofonita-auth-backend',
        authenticated: req.isAuthenticated(),
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: process.uptime(),
        urls: {
            website: FINAL_WEBSITE_URL,
            api: FINAL_API_URL,
            redirect: FINAL_REDIRECT_URL
        }
    };

    console.log('🏥 Health check solicitado');
    res.json(healthStatus);
});

// Ruta de inicio de sesión
app.get('/connect', (req, res) => {
    const guildId = req.query.guild_id;
    
    let loginUrl = `${FINAL_WEBSITE_URL}/login`;
    
    if (guildId) {
        loginUrl += `?guild_id=${guildId}&redirect=${encodeURIComponent('/dashboard')}`;
    }
    
    console.log(`🔗 Redirigiendo a login: ${loginUrl}`);
    res.redirect(loginUrl);
});

// Ruta para obtener enlace de login directo
app.get('/api/login-url', (req, res) => {
    const { guild_id } = req.query;
    
    let loginUrl = `${FINAL_WEBSITE_URL}/login`;
    
    if (guild_id) {
        loginUrl += `?guild_id=${guild_id}&redirect=${encodeURIComponent('/dashboard')}`;
    }
    
    console.log(`🔗 Generando enlace de login: ${loginUrl}`);
    res.json({
        success: true,
        login_url: loginUrl
    });
});

// 404 handler
app.use((req, res) => {
    console.log(`❌ Ruta no encontrada: ${req.path}`);
    res.status(404).json({ 
        error: 'Ruta no encontrada',
        path: req.path,
        available_routes: ['/auth/discord', '/api/user', '/api/stats', '/health', '/login', '/logout']
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    
    const errorResponse = {
        error: 'Error interno del servidor',
        message: NODE_ENV === 'development' ? err.message : 'Algo fue mal bro, estoy sad. Diselo a Salvox',
        timestamp: new Date().toISOString()
    };
    
    res.status(500).json(errorResponse);
});

// Iniciar servidor
const serverPort = parseInt(PORT, 10) || 3000;
app.listen(serverPort, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVICIO DE AUTENTICACIÓN COFONITA INICIADO');
    console.log('='.repeat(60));
    console.log(`📌 Entorno: ${NODE_ENV.toUpperCase()}`);
    console.log(`🌐 Frontend (Netlify): ${FINAL_WEBSITE_URL}`);
    console.log(`🔧 Backend (Render): ${FINAL_API_URL}`);
    console.log(`🔐 Callback URL para Discord: ${FINAL_REDIRECT_URL}`);
    console.log(`🔑 Iniciar autenticación: ${FINAL_API_URL}/auth/discord`);
    console.log(`🏥 Health Check: ${FINAL_API_URL}/health`);
    console.log(`🎮 Easter Egg: ${FINAL_API_URL}/secret`);
    console.log('='.repeat(60));
    console.log(`📝 Configuración de Discord Developer Portal:`);
    console.log(`   ✅ REDIRECT_URL configurada: ${FINAL_REDIRECT_URL}`);
    console.log('='.repeat(60));
    console.log(`💡 URLs importantes para tu frontend:`);
    console.log(`   • Login: ${FINAL_WEBSITE_URL}/login`);
    console.log(`   • Dashboard: ${FINAL_WEBSITE_URL}/dashboard`);
    console.log(`   • Iniciar sesión: ${FINAL_WEBSITE_URL}/login`);
    console.log('='.repeat(60) + '\n');
});

module.exports = app;