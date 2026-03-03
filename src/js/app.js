const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// --- MIDDLEWARES (Configuración del servidor) ---
app.use(cors());
app.use(express.json()); // Para entender datos JSON enviados desde el front
app.use(express.urlencoded({ extended: true })); // Para entender formularios tradicionales

// Servir archivos estáticos: Esto asegura que el navegador encuentre tus carpetas
app.use(express.static(path.join(__dirname))); 

// --- BASE DE DATOS (Conexión y Tablas) ---
const db = new sqlite3.Database('./ballers.db', (err) => {
    if (err) {
        console.error("❌ ERROR CRÍTICO AL ABRIR DB:", err.message);
    } else {
        console.log("✅ Conexión exitosa a SQLite (ballers.db)");
    }
});

db.serialize(() => {
    // 1. Tabla de Usuarios (Administración)
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        correo TEXT UNIQUE NOT NULL,
        rol TEXT DEFAULT 'cliente',
        estado TEXT DEFAULT 'activo'
    )`);

    // 2. Tabla de Pedidos (Compras)
    db.run(`CREATE TABLE IF NOT EXISTS pedidos (
        id TEXT PRIMARY KEY,
        fecha TEXT NOT NULL,
        estado TEXT NOT NULL,
        direccion TEXT NOT NULL,
        total REAL NOT NULL
    )`);

    // 3. Tabla de Artículos por Pedido (Detalle)
    db.run(`CREATE TABLE IF NOT EXISTS pedido_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id TEXT,
        nombre TEXT NOT NULL,
        cantidad INTEGER NOT NULL,
        precio REAL NOT NULL,
        FOREIGN KEY(pedido_id) REFERENCES pedidos(id)
    )`);
});

// --- RUTAS DE LA API ---

// --- SECCIÓN: USUARIOS ---

// Obtener lista de usuarios
app.get('/admin/usuarios', (req, res) => {
    db.all("SELECT * FROM usuarios", [], (err, rows) => {
        if (err) return res.status(500).json({ ok: false, msg: err.message });
        res.json(rows);
    });
});

// Guardar nuevo usuario
app.post('/admin/usuarios', (req, res) => {
    const { nombre, correo, rol, estado } = req.body;
    
    if (!nombre || !correo) return res.status(400).json({ ok: false, msg: "Faltan campos obligatorios" });

    const sql = `INSERT INTO usuarios (nombre, correo, rol, estado) VALUES (?, ?, ?, ?)`;
    db.run(sql, [nombre, correo, rol, estado], function(err) {
        if (err) {
            console.log("❌ Error al insertar usuario:", err.message);
            return res.status(400).json({ ok: false, msg: "El correo ya existe" });
        }
        res.json({ ok: true, id: this.lastID });
    });
});

// --- SECCIÓN: COMPRAS (PEDIDOS) ---

// Obtener todas las compras con sus artículos detallados
app.get('/api/mis-compras', (req, res) => {
    const sql = `
        SELECT p.*, pi.nombre as it_nombre, pi.cantidad, pi.precio 
        FROM pedidos p 
        LEFT JOIN pedido_items pi ON p.id = pi.pedido_id
        ORDER BY p.fecha DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Agrupar artículos por pedido
        const pedidos = {};
        rows.forEach(r => {
            if (!pedidos[r.id]) {
                pedidos[r.id] = { 
                    id: r.id, 
                    date: r.fecha, 
                    status: r.estado, 
                    address: r.direccion, 
                    total: r.total, 
                    items: [] 
                };
            }
            if (r.it_nombre) {
                pedidos[r.id].items.push({ name: r.it_nombre, qty: r.cantidad, price: r.precio });
            }
        });
        res.json(Object.values(pedidos));
    });
});

// --- MANEJO DE ERRORES 404 ---
app.use((req, res) => {
    res.status(404).send("<h1>404 - Lo sentimos, esta página no existe en el servidor</h1>");
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`
    ================================================
    🏀 BALLERS BACKEND ACTIVO
    🚀 URL: http://localhost:${PORT}
    📂 Archivos estáticos servidos desde: ${__dirname}
    ================================================
    `);
});