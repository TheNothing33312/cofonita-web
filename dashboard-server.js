const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();

// Configuración de producción
const {
    PORT = 10000,
    MAIN_SERVER_URL = 'https://cofonitabot.onrender.com',
    FRONTEND_URL = 'https://cofonitabot.netlify.app',
    SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    NODE_ENV = 'production'
} = process.env;

console.log('🚀 Dashboard Server - Configuración:');
console.log('   Puerto:', PORT);
console.log('   Backend principal:', MAIN_SERVER_URL);
console.log('   Frontend:', FRONTEND_URL);
console.log('   Entorno:', NODE_ENV);

// Middleware
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de sesión
const MemoryStore = require('memorystore')(session);

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({
        checkPeriod: 86400000 // 24 horas
    }),
    cookie: {
        secure: NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: true,
        sameSite: NODE_ENV === 'production' ? 'none' : 'lax'
    },
    name: 'cofonita.dashboard.sid'
}));

// Middleware de autenticación
const checkAuth = async (req, res, next) => {
    console.log('🔍 Verificando autenticación...');
    
    // 1. Verificar sesión local
    if (req.session.user) {
        console.log('✅ Usuario en sesión local:', req.session.user.username);
        return next();
    }

    try {
        console.log('🌐 Consultando backend principal para autenticación...');
        
        // 2. Verificar autenticación con backend principal
        const response = await axios.get(`${MAIN_SERVER_URL}/api/user`, {
            headers: {
                'Cookie': req.headers.cookie || '',
                'User-Agent': req.headers['user-agent'] || 'Dashboard-Server',
                'X-Forwarded-For': req.ip,
                'Accept': 'application/json'
            },
            withCredentials: true,
            timeout: 15000
        });

        if (response.data && response.data.success && response.data.user) {
            console.log('✅ Autenticado por backend principal:', response.data.user.username);
            
            // Guardar usuario en sesión local
            req.session.user = response.data.user;
            return next();
        }
    } catch (error) {
        console.log('⚠️ Error de autenticación:', error.message);
        if (error.response) {
            console.log('   Estado:', error.response.status);
            console.log('   Datos:', error.response.data);
        }
    }

    // 3. Redirigir al login
    console.log('❌ No autenticado, redirigiendo al login...');
    return res.redirect(`${FRONTEND_URL}/login?error=session_expired&redirect=${encodeURIComponent(req.originalUrl)}`);
};

// Middleware para pasar datos a las vistas
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.apiUrl = MAIN_SERVER_URL;
    res.locals.websiteUrl = FRONTEND_URL;
    next();
});

// Servir dashboard.html con datos inyectados
app.get('/dashboard', checkAuth, async (req, res) => {
    try {
        const user = req.session.user;
        console.log('📊 Sirviendo dashboard para:', user.username);
        
        // Leer el archivo HTML
        const dashboardPath = path.join(__dirname, 'dashboard.html');
        let html = await fs.readFile(dashboardPath, 'utf8');
        
        // Preparar datos del usuario
        const userData = {
            id: user.id,
            username: user.username || 'Usuario',
            discriminator: user.discriminator || '0000',
            avatar_url: user.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png',
            guilds: user.guilds || []
        };
        
        // Función para escapar HTML
        const escapeHtml = (text) => {
            if (!text) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };
        
        // Función para formatear números
        const formatNumber = (num) => {
            if (!num) return '0';
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        };
        
        // Generar HTML de servidores
        let serversHTML = '';
        const manageableGuilds = userData.guilds.filter(g => g.manageable);
        
        if (manageableGuilds.length > 0) {
            serversHTML = manageableGuilds.map(guild => {
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
                                     onerror="this.onerror=null; this.parentElement.innerHTML='<i class=\\'fas fa-server\\'></i>'; this.parentElement.style.background='linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)';" loading="lazy">`
                                : `<i class="fas fa-server"></i>`}
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div class="server-name">${safeName}</div>
                            <div class="server-info">
                                <span class="server-status ${guild.bot_installed ? 'status-online' : 'status-offline'}">
                                    <i class="fas fa-circle"></i>
                                    ${guild.bot_installed ? 'Bot conectado' : 'Conectar bot'}
                                </span>
                                <span style="color: var(--text-muted); font-size: 12px;">
                                    <i class="fas fa-users"></i>
                                    ${guild.approximate_member_count ? formatNumber(guild.approximate_member_count) : '?'}
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
                                 <i class="fas fa-plug"></i> Conectar
                               </button>`
                        }
                        <button class="btn btn-secondary view-btn" data-guild-id="${guild.id}">
                            <i class="fas fa-eye"></i> Ver
                        </button>
                    </div>
                </div>
                `;
            }).join('');
        } else {
            serversHTML = `
                <div class="no-servers">
                    <i class="fas fa-server fa-3x"></i>
                    <h3>No tienes servidores administrables</h3>
                    <p>Los servidores donde tengas permisos de administrador aparecerán aquí</p>
                    <button class="btn btn-primary" onclick="window.location.reload()">
                        <i class="fas fa-sync-alt"></i> Recargar
                    </button>
                </div>
            `;
        }
        
        // Obtener estadísticas del bot
        let statsData = {
            totalServers: 0,
            totalUsers: 0,
            commandsUsed: 0,
            uptime: 99.8
        };
        
        try {
            console.log('📈 Obteniendo estadísticas del bot...');
            const statsResponse = await axios.get(`${MAIN_SERVER_URL}/api/bot/stats`, {
                headers: {
                    'Cookie': req.headers.cookie || '',
                    'User-Agent': 'Dashboard-Server'
                },
                withCredentials: true,
                timeout: 10000
            });
            
            if (statsResponse.data && statsResponse.data.success) {
                statsData = statsResponse.data.stats;
                console.log('✅ Estadísticas obtenidas');
            }
        } catch (error) {
            console.log('⚠️ Error obteniendo estadísticas:', error.message);
            // Usar datos por defecto
            statsData.totalServers = manageableGuilds.length;
        }
        
        // Preparar reemplazos
        const replacements = {
            '{{USERNAME}}': escapeHtml(userData.username),
            '{{DISCRIMINATOR}}': escapeHtml(userData.discriminator),
            '{{AVATAR_URL}}': userData.avatar_url,
            '{{SERVER_COUNT}}': manageableGuilds.length,
            '{{SERVERS_HTML}}': serversHTML,
            '{{TOTAL_SERVERS}}': formatNumber(statsData.totalServers || manageableGuilds.length),
            '{{TOTAL_USERS}}': formatNumber(statsData.totalUsers || 0),
            '{{COMMANDS_USED}}': formatNumber(statsData.commandsUsed || 0),
            '{{UPTIME}}': statsData.uptime ? statsData.uptime.toFixed(1) : '99.8',
            '{{API_URL}}': MAIN_SERVER_URL,
            '{{WEBSITE_URL}}': FRONTEND_URL,
            '{{SERVERS_PLURAL}}': manageableGuilds.length !== 1 ? 'es' : '',
            '{{ADMIN_PLURAL}}': manageableGuilds.length !== 1 ? 's' : ''
        };
        
        // Reemplazar todas las variables
        Object.keys(replacements).forEach(key => {
            const regex = new RegExp(key, 'g');
            html = html.replace(regex, replacements[key]);
        });
        
        // Enviar HTML procesado
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(html);
        
        console.log('✅ Dashboard servido exitosamente');
        
    } catch (error) {
        console.error('❌ Error crítico al servir dashboard:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error - Dashboard Cofonita</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: linear-gradient(135deg, #0A0A14 0%, #121220 100%);
                        color: white;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 20px;
                    }
                    .error-box {
                        background: rgba(255, 255, 255, 0.1);
                        backdrop-filter: blur(20px);
                        border-radius: 20px;
                        padding: 40px;
                        max-width: 500px;
                        text-align: center;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    }
                    .error-icon {
                        font-size: 80px;
                        background: linear-gradient(135deg, #FF6B8B 0%, #5A67D8 100%);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        margin-bottom: 20px;
                    }
                    h1 { font-size: 24px; margin-bottom: 10px; }
                    p { color: #A0A0C0; margin-bottom: 30px; line-height: 1.6; }
                    .btn {
                        display: inline-flex;
                        align-items: center;
                        gap: 10px;
                        background: linear-gradient(135deg, #FF6B8B 0%, #5A67D8 100%);
                        color: white;
                        padding: 12px 24px;
                        border-radius: 10px;
                        text-decoration: none;
                        font-weight: 600;
                        border: none;
                        cursor: pointer;
                        transition: transform 0.2s;
                        margin: 5px;
                    }
                    .btn:hover { transform: translateY(-2px); }
                    .btn-secondary {
                        background: rgba(255, 255, 255, 0.1);
                    }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <div class="error-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h1>Error al cargar el Dashboard</h1>
                    <p>Hubo un problema al cargar tu panel de control. Esto puede deberse a problemas de conexión o sesión expirada.</p>
                    <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;">
                        <button class="btn" onclick="window.location.reload()">
                            <i class="fas fa-redo"></i> Reintentar
                        </button>
                        <button class="btn btn-secondary" onclick="window.location.href='${FRONTEND_URL}/login'">
                            <i class="fas fa-sign-in-alt"></i> Volver al Login
                        </button>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// API endpoints (proxy al backend principal)
app.get('/api/user', checkAuth, (req, res) => {
    res.json({
        success: true,
        user: req.session.user
    });
});

app.get('/api/bot/stats', checkAuth, async (req, res) => {
    try {
        const response = await axios.get(`${MAIN_SERVER_URL}/api/bot/stats`, {
            headers: {
                'Cookie': req.headers.cookie || '',
                'User-Agent': 'Dashboard-Server'
            },
            withCredentials: true,
            timeout: 10000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error.message);
        res.json({
            success: true,
            stats: {
                totalServers: req.session.user.guilds?.filter(g => g.manageable).length || 0,
                totalUsers: 0,
                commandsUsed: 0,
                uptime: 99.8
            }
        });
    }
});

app.post('/api/guild/:guildId/connect', checkAuth, async (req, res) => {
    try {
        const { guildId } = req.params;
        const user = req.session.user;
        
        // Verificar permisos
        const userGuild = user.guilds?.find(g => g.id === guildId && g.manageable);
        if (!userGuild) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos para administrar este servidor'
            });
        }
        
        // Proxy al backend principal
        const response = await axios.post(`${MAIN_SERVER_URL}/api/guild/${guildId}/connect`, {}, {
            headers: {
                'Cookie': req.headers.cookie || '',
                'User-Agent': 'Dashboard-Server'
            },
            withCredentials: true,
            timeout: 10000
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Error conectando servidor:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al conectar el bot al servidor'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'cofonita-dashboard',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        authenticated: !!req.session.user,
        urls: {
            main_server: MAIN_SERVER_URL,
            frontend: FRONTEND_URL
        }
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect(`${MAIN_SERVER_URL}/logout`);
    });
});

// Ruta raíz - redirige al dashboard
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect(`${FRONTEND_URL}/login`);
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>404 - No encontrado</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #0A0A14 0%, #121220 100%);
                    color: white;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    text-align: center;
                }
                .container {
                    max-width: 600px;
                }
                h1 { 
                    font-size: 120px; 
                    margin: 0; 
                    background: linear-gradient(135deg, #FF6B8B 0%, #5A67D8 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                h2 { font-size: 28px; margin: 20px 0; }
                p { color: #A0A0C0; margin-bottom: 30px; line-height: 1.6; }
                .btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    background: linear-gradient(135deg, #FF6B8B 0%, #5A67D8 100%);
                    color: white;
                    padding: 12px 24px;
                    border-radius: 10px;
                    text-decoration: none;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                .btn:hover { transform: translateY(-2px); }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>404</h1>
                <h2>Página no encontrada</h2>
                <p>La página que buscas no existe en el dashboard de Cofonita.</p>
                <button class="btn" onclick="window.location.href='/dashboard'">
                    <i class="fas fa-arrow-left"></i> Volver al Dashboard
                </button>
            </div>
        </body>
        </html>
    `);
});

// Error handler global
app.use((err, req, res, next) => {
    console.error('🔥 Error global:', err);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        message: 'Por favor, intenta más tarde o contacta con soporte.'
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 DASHBOARD COFONITA - PRODUCCIÓN');
    console.log('='.repeat(60));
    console.log(`✅ Servidor corriendo en puerto: ${PORT}`);
    console.log(`📊 Dashboard: https://cofonitabot.onrender.com/dashboard`);
    console.log(`🔗 Frontend: ${FRONTEND_URL}`);
    console.log(`🔧 Backend principal: ${MAIN_SERVER_URL}`);
    console.log(`🔐 Entorno: ${NODE_ENV}`);
    console.log('='.repeat(60));
    console.log('💡 URLs importantes:');
    console.log(`   • Login: ${FRONTEND_URL}/login`);
    console.log(`   • Dashboard: https://cofonitabot.onrender.com/dashboard`);
    console.log(`   • Health check: https://cofonitabot.onrender.com/health`);
    console.log(`   • API User: https://cofonitabot.onrender.com/api/user`);
    console.log('='.repeat(60) + '\n');
});

module.exports = app;
