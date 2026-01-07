const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Configuración
const {
    DASHBOARD_PORT = 4000,
    MAIN_SERVER_URL = 'https://cofonitabot.onrender.com',
    DASHBOARD_SESSION_SECRET = process.env.SESSION_SECRET || 'dashboard-secret',
    NODE_ENV = 'production'
} = process.env;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// Configuración de sesión
app.use(session({
    secret: DASHBOARD_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: true,
        sameSite: 'lax'
    },
    name: 'dashboard.sid'
}));

// Middleware de autenticación mejorado
const checkAuth = async (req, res, next) => {
    // Si ya hay sesión local
    if (req.session.user) {
        return next();
    }

    try {
        // Verificar sesión en el servidor principal
        const response = await axios.get(`${MAIN_SERVER_URL}/api/user`, {
            headers: { 
                Cookie: req.headers.cookie || '',
                'User-Agent': 'Dashboard-Server'
            },
            withCredentials: true,
            timeout: 5000
        });

        if (response.data?.success) {
            req.session.user = {
                ...response.data.user,
                last_login: new Date().toISOString()
            };
            return next();
        }
    } catch (error) {
        console.log('⚠️  Sesión no válida:', error.message);
    }

    // Redirigir al login
    return res.redirect(`https://cofonitabot.netlify.app/login?redirect=${encodeURIComponent(req.originalUrl)}`);
};

// Dashboard HTML - Servir dashboard.html estático
app.get('/dashboard', checkAuth, async (req, res) => {
    try {
        // Leer el archivo dashboard.html
        const dashboardPath = path.join(__dirname, 'dashboard.html');
        let html = fs.readFileSync(dashboardPath, 'utf8');
        
        const user = req.session.user;
        
        // Función para escapar HTML
        const escapeHtml = (text) => {
            if (!text) return '';
            return text.toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };
        
        // Preparar datos del usuario
        const safeUsername = escapeHtml(user.username || 'Usuario');
        const safeDiscriminator = escapeHtml(user.discriminator || '0000');
        const safeAvatar = user.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        // Obtener servidores administrables
        const manageableServers = user.guilds?.filter(g => g.manageable) || [];
        const serverCount = manageableServers.length;
        
        // Generar HTML de servidores - CORREGIDO: Usar login_url en lugar de invite_url
        let serversHTML = '';
        if (manageableServers.length > 0) {
            serversHTML = manageableServers.map((guild, index) => {
                const safeName = escapeHtml(guild.name);
                const icon = guild.icon 
                    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`
                    : null;
                
                return `
                <div class="server-card" data-guild-id="${guild.id}">
                    <div class="server-header">
                        <div class="server-icon">
                            ${icon 
                                ? `<img src="${icon}" alt="${safeName}" 
                                     onerror="this.onerror=null; this.parentElement.innerHTML='<i class=\\'fas fa-server\\'></i>'; this.parentElement.style.background=\\'var(--primary-gradient)\\';" loading="lazy">`
                                : `<i class="fas fa-server"></i>`}
                        </div>
                        <div>
                            <div class="server-name">${safeName}</div>
                            <div class="server-info">
                                <span class="server-status ${guild.bot_installed ? 'status-online' : 'status-offline'}">
                                    <i class="fas fa-circle"></i>
                                    ${guild.bot_installed ? 'Bot disponible' : 'Acceso requerido'}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="server-actions">
                        ${guild.bot_installed 
                            ? `<button class="btn btn-primary configure-btn" data-guild-id="${guild.id}">
                                 <i class="fas fa-cog"></i> Configurar
                               </button>`
                            : `<button class="btn btn-primary connect-btn" data-guild-id="${guild.id}">
                                 <i class="fas fa-sign-in-alt"></i> Conectar
                               </button>`
                        }
                    </div>
                </div>
                `;
            }).join('');
        } else {
            serversHTML = `
                <div class="no-servers">
                    <i class="fas fa-server fa-3x"></i>
                    <h3>No tienes servidores administrables</h3>
                    <p>Los servidores donde eres administrador aparecerán aquí</p>
                    <button class="btn btn-primary" id="refreshServersBtn">
                        <i class="fas fa-sync-alt"></i> Actualizar Lista
                    </button>
                </div>
            `;
        }
        
        // Obtener estadísticas del servidor principal
        let statsData = {
            totalServers: serverCount,
            totalUsers: 0,
            commandsUsed: 0,
            uptime: 99.8
        };
        
        try {
            const statsResponse = await axios.get(`${MAIN_SERVER_URL}/api/bot/stats`, {
                headers: { 
                    Cookie: req.headers.cookie || '',
                    'User-Agent': 'Dashboard-Server'
                },
                withCredentials: true,
                timeout: 3000
            });
            
            if (statsResponse.data?.success) {
                statsData = { ...statsData, ...statsResponse.data.stats };
            }
        } catch (error) {
            console.log('⚠️  Usando estadísticas básicas:', error.message);
        }
        
        // Reemplazar variables en el HTML
        const replacements = {
            '\\${username}': safeUsername,
            '\\${discriminator}': safeDiscriminator,
            '\\${avatarUrl}': safeAvatar,
            '\\${serverCount}': serverCount,
            '\\${serversHTML}': serversHTML,
            '\\${totalServers}': statsData.totalServers,
            '\\${totalUsers}': statsData.totalUsers > 1000 
                ? Math.round(statsData.totalUsers / 1000) + 'K' 
                : statsData.totalUsers,
            '\\${commandsUsed}': statsData.commandsUsed > 1000 
                ? Math.round(statsData.commandsUsed / 1000) + 'K' 
                : statsData.commandsUsed,
            '\\${uptime}': statsData.uptime
        };
        
        Object.entries(replacements).forEach(([key, value]) => {
            html = html.replace(new RegExp(key, 'g'), value);
        });
        
        res.send(html);
    } catch (error) {
        console.error('❌ Error cargando dashboard:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error - Dashboard</title>
                <style>
                    body { 
                        font-family: 'Inter', sans-serif;
                        background: #0F172A;
                        color: #F8FAFC;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        padding: 20px;
                    }
                    .error-container {
                        text-align: center;
                        max-width: 500px;
                        padding: 40px;
                        background: rgba(30, 41, 59, 0.8);
                        backdrop-filter: blur(20px);
                        border-radius: 16px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                    }
                    .error-icon {
                        font-size: 64px;
                        color: #EF4444;
                        margin-bottom: 20px;
                    }
                    h1 { font-size: 32px; margin-bottom: 15px; }
                    p { color: #94A3B8; margin-bottom: 25px; }
                    .btn {
                        display: inline-flex;
                        align-items: center;
                        gap: 10px;
                        background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%);
                        color: white;
                        padding: 14px 28px;
                        border-radius: 12px;
                        text-decoration: none;
                        font-weight: 600;
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <div class="error-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h1>Error del Dashboard</h1>
                    <p>No se pudo cargar el panel de control.</p>
                    <a href="https://cofonitabot.netlify.app/dashboard" class="btn">
                        <i class="fas fa-redo"></i> Reintentar
                    </a>
                    <a href="https://cofonitabot.netlify.app/login" class="btn" style="margin-left: 10px;">
                        <i class="fas fa-sign-in-alt"></i> Volver a Login
                    </a>
                </div>
            </body>
            </html>
        `);
    }
});

// API para conectar servidor (nueva)
app.post('/api/guild/:guildId/connect', checkAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const user = req.session.user;
        
        const userGuild = user.guilds?.find(g => g.id === guildId);
        
        if (!userGuild || !userGuild.manageable) {
            return res.status(403).json({ 
                success: false, 
                error: 'No tienes permisos en este servidor' 
            });
        }

        // Obtener enlace de login del servidor principal
        const response = await axios.get(`${MAIN_SERVER_URL}/api/login/${guildId}`, {
            headers: { 
                Cookie: req.headers.cookie || '',
                'User-Agent': 'Dashboard-Server'
            },
            withCredentials: true,
            timeout: 5000
        });

        if (response.data.success) {
            res.json({
                success: true,
                login_url: response.data.login_url
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Error obteniendo enlace de conexión'
            });
        }
    } catch (error) {
        console.error('❌ Error conectando servidor:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error al conectar servidor' 
        });
    }
});

// API para datos enriquecidos
app.get('/api/dashboard/enhanced', checkAuth, (req, res) => {
    try {
        const user = req.session.user;
        
        const enhancedData = {
            success: true,
            user: {
                ...user,
                enhanced: {
                    join_date: new Date().toISOString(),
                    activity_score: 0,
                    server_rank: 0,
                    badges: []
                }
            },
            stats: {
                enhanced: {
                    daily_growth: 0,
                    peak_hours: [],
                    popular_commands: [],
                    response_time: 0
                }
            },
            analytics: {
                realtime: {
                    active_users: 0,
                    commands_per_minute: 0,
                    server_load: 0
                }
            }
        };
        
        res.json(enhancedData);
    } catch (error) {
        console.error('❌ Error en API mejorada:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        service: 'cofonita-dashboard',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        authenticated: !!req.session.user
    };
    
    res.json(health);
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Error al destruir sesión:', err);
        res.redirect('https://cofonitabot.onrender.com/logout');
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>404 - No encontrado</title>
            <style>
                body { 
                    font-family: 'Inter', sans-serif;
                    background: #0F172A;
                    color: #F8FAFC;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                    padding: 20px;
                    text-align: center;
                }
                .container {
                    max-width: 600px;
                    padding: 40px;
                    background: rgba(30, 41, 59, 0.8);
                    backdrop-filter: blur(20px);
                    border-radius: 16px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                h1 { 
                    font-size: 120px;
                    margin: 0;
                    background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                h2 { font-size: 32px; margin: 20px 0; }
                p { color: #94A3B8; margin-bottom: 30px; }
                .btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%);
                    color: white;
                    padding: 14px 28px;
                    border-radius: 12px;
                    text-decoration: none;
                    font-weight: 600;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>404</h1>
                <h2>Página no encontrada</h2>
                <p>La página que estás buscando no existe en el dashboard.</p>
                <a href="/dashboard" class="btn">
                    <i class="fas fa-tachometer-alt"></i> Volver al Dashboard
                </a>
            </div>
        </body>
        </html>
    `);
});

// Iniciar servidor
const server = app.listen(DASHBOARD_PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Dashboard Cofonita');
    console.log('='.repeat(50));
    console.log(`✅ Servidor corriendo en: http://localhost:${DASHBOARD_PORT}`);
    console.log(`🔗 Dashboard: http://localhost:${DASHBOARD_PORT}/dashboard`);
    console.log(`🔐 Servidor principal: ${MAIN_SERVER_URL}`);
    console.log(`🏥 Health check: http://localhost:${DASHBOARD_PORT}/health`);
    console.log('='.repeat(50) + '\n');
});

// Manejo de cierre
process.on('SIGTERM', () => {
    console.log('🔄 Cerrando servidor dashboard...');
    server.close(() => {
        console.log('✅ Servidor dashboard cerrado');
        process.exit(0);
    });
});

module.exports = app;