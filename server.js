require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();

/* =====================
    MIDDLEWARES
===================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

/* USUARIO TEMPORAL (Contexto de sesión) */
app.use((req, res, next) => {
    const headerId = Number(req.headers['x-user-id']);
    req.userId = headerId > 0 ? headerId : 9; 
    next();
});

/* =====================
    CONEXIÓN MYSQL
===================== */
const db = mysql.createConnection({
    host: '127.0.0.1',
    port: '3306',
    user: 'root',
    password: 'Luisykevin1357#',
    database: 'ballers_db'
});

db.connect(err => {
    if (err) console.error('❌ Error DB:', err);
    else console.log('✅ Conectado a MySQL - Sistema CRM/SCM Activo');
});

function mysqlError(res, tag, err) {
    console.error(`❌ Error ${tag}:`, err);
    return res.status(500).json({
        ok: false,
        message: err.sqlMessage || err.message
    });
}

/* =====================
    DASHBOARD: MÉTRICAS CRM & SCM
===================== */
app.get('/api/admin/metrics', (req, res) => {
    const sqlBase = `
    SELECT 
        (SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente') as total_clientes,
        (SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente' AND verificado = 1) as activos,
        (SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente' AND verificado = 0) as inactivos,
        (SELECT COUNT(*) FROM productos WHERE stock <= stock_minimo) as stock_critico,
        (SELECT COUNT(*) FROM pedidos WHERE id LIKE 'AUTO-%') as reposiciones_push,
        (SELECT IFNULL(SUM(total), 0) FROM pedidos) as revenue
    `;

    const sqlInteracciones = `
    SELECT u.nombre, COUNT(i.id) as total 
    FROM usuarios u 
    LEFT JOIN interacciones_crm i ON u.id = i.usuario_id 
    WHERE u.rol = 'cliente' 
    GROUP BY u.id
    ORDER BY total DESC LIMIT 5
    `;

    const sqlRiesgo = `
    SELECT nombre, correo FROM usuarios 
    WHERE rol = 'cliente' AND id NOT IN (
        SELECT DISTINCT usuario_id FROM interacciones_crm 
        WHERE fecha > DATE_SUB(NOW(), INTERVAL 30 DAY)
    ) LIMIT 6
    `;

    db.query(sqlBase, (err, counts) => {
        if (err) return mysqlError(res, 'metrics counts', err);
        
        db.query(sqlInteracciones, (err2, interacciones) => {
            if (err2) return mysqlError(res, 'metrics interactions', err2);

            db.query(sqlRiesgo, (err3, riesgo) => {
                if (err3) return mysqlError(res, 'metrics risk', err3);

                res.json({
                    ...counts[0],
                    resumen: {
                        total_clientes: counts[0].total_clientes,
                        activos: counts[0].activos,
                        inactivos: counts[0].inactivos
                    },
                    interacciones: interacciones,
                    clientesRiesgo: []
                });
            });
        });
    });
});

/* =====================
    MÓDULO CRM: CLIENTES E HISTORIAL
===================== */
app.get('/api/usuarios', (req, res) => {
    db.query('SELECT id, nombre, correo, rol, verificado, etapa_crm FROM usuarios', (err, results) => {
        if (err) return mysqlError(res, 'get usuarios', err);
        res.json(results.map(u => ({
            ...u,
            estado: u.verificado ? 'activo' : 'bloqueado'
        })));
    });
});

app.get('/api/crm/historial', (req, res) => {
    const sql = `
        SELECT i.*, u.nombre as cliente_nombre 
        FROM interacciones_crm i 
        JOIN usuarios u ON i.usuario_id = u.id 
        ORDER BY i.fecha DESC`;
    db.query(sql, (err, results) => {
        if (err) return mysqlError(res, 'crm historial', err);
        res.json(results);
    });
});

app.post('/api/crm/interaccion', (req, res) => {
    const { usuario_id, tipo, descripcion } = req.body;
    const sql = 'INSERT INTO interacciones_crm (usuario_id, tipo, descripcion) VALUES (?, ?, ?)';
    db.query(sql, [usuario_id, tipo, descripcion], (err) => {
        if (err) return mysqlError(res, 'save interaccion', err);
        res.json({ ok: true });
    });
});

/* =====================
    MÓDULO SCM: PRODUCTOS Y PROVEEDORES
===================== */
app.get('/api/productos', (req, res) => {
    db.query('SELECT * FROM productos WHERE active = 1', (err, results) => {
        if (err) return mysqlError(res, 'get productos', err);
        res.json(results.map(p => ({
            id: p.id, name: p.nombre, price: Number(p.precio),
            category: (p.categoria || '').toLowerCase(), image: p.imagen || '', stock: p.stock
        })));
    });
});

app.get('/api/inventario', (req, res) => {
    db.query('SELECT id, nombre, precio, categoria, stock, stock_minimo, estrategia_logistica, active FROM productos', (err, results) => {
        if (err) return mysqlError(res, 'get inventario', err);
        res.json(results);
    });
});

app.post('/api/productos/nuevo', (req, res) => {
    const { nombre, precio, categoria, imagen, stock, stock_minimo, estrategia } = req.body;
    const sql = `INSERT INTO productos (nombre, precio, categoria, imagen, stock, stock_minimo, estrategia_logistica, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`;
    db.query(sql, [nombre, precio, categoria, imagen, stock, stock_minimo || 5, estrategia || 'PULL'], (err, result) => {
        if (err) return mysqlError(res, 'new product', err);
        res.json({ ok: true, id: result.insertId });
    });
});

app.get('/api/proveedores', (req, res) => {
    db.query('SELECT * FROM proveedores', (err, results) => {
        if (err) return mysqlError(res, 'get proveedores', err);
        res.json(results);
    });
});

app.post('/api/proveedores', (req, res) => {
    const { nombre, contacto, telefono, email, categoria } = req.body;
    const sql = 'INSERT INTO proveedores (nombre, contacto, telefono, email, categoria) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [nombre, contacto, telefono, email, categoria], (err, result) => {
        if (err) return mysqlError(res, 'new provider', err);
        res.json({ message: 'Proveedor registrado', id: result.insertId });
    });
});

/* =====================
    MÓDULO SCM: CHECKOUT & PUSH LOGIC
===================== */
app.post('/api/checkout', (req, res) => {
    const { direccion, total } = req.body;
    const pedidoId = 'B-' + Math.floor(Math.random() * 10000);

    db.query('SELECT producto_id, cantidad FROM carrito WHERE usuario_id = ?', [req.userId], (err, items) => {
        if (err || items.length === 0) return res.status(400).json({ ok: false, message: 'Carrito vacío' });

        const sqlPed = 'INSERT INTO pedidos (id, usuario_id, total, direccion, estado) VALUES (?, ?, ?, ?, "en_transito")';
        db.query(sqlPed, [pedidoId, req.userId, total, direccion], (err2) => {
            if (err2) return mysqlError(res, 'checkout main', err2);

            items.forEach(item => {
                db.query('SELECT stock, stock_minimo, estrategia_logistica, nombre FROM productos WHERE id = ?', [item.producto_id], (err3, rows) => {
                    const prod = rows[0];
                    const nuevoStock = prod.stock - item.cantidad;
                    db.query('UPDATE productos SET stock = ? WHERE id = ?', [nuevoStock, item.producto_id]);

                    if (nuevoStock <= prod.stock_minimo && prod.estrategia_logistica === 'PUSH') {
                        const autoId = 'AUTO-' + Math.floor(Math.random() * 999);
                        db.query('INSERT INTO pedidos (id, usuario_id, total, estado, direccion) VALUES (?, 1, 0, "pendiente", "SCM: REPOSICIÓN AUTOMÁTICA")');
                    }
                });
                db.query('INSERT INTO pedido_items (pedido_id, nombre, cantidad, precio) SELECT ?, nombre, ?, precio FROM productos WHERE id = ?', [pedidoId, item.cantidad, item.producto_id]);
            });

            db.query('DELETE FROM carrito WHERE usuario_id = ?', [req.userId]);
            res.json({ ok: true, pedidoId });
        });
    });
});

/* =====================
    AUTENTICACIÓN Y SEGUIMIENTO
===================== */
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM usuarios WHERE correo = ?', [email.toLowerCase().trim()], async (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ success: false, message: 'No existe' });
        const match = await bcrypt.compare(password, results[0].password);
        if (match) res.json({ success: true, id: results[0].id, role: results[0].rol });
        else res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    });
});

app.get('/api/seguimiento/:id', (req, res) => {
    db.query('SELECT id, estado, direccion FROM pedidos WHERE UPPER(id) = UPPER(?)', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ ok: false });
        const mapa = { 'pendiente': 0, 'preparando': 1, 'enviado': 2, 'en_transito': 3, 'entregado': 4 };
        res.json({ id: results[0].id, statusIndex: mapa[results[0].estado] || 0, city: results[0].direccion });
    });
});

/* =====================
    CARRITO (AUXILIAR)
===================== */
app.get('/api/carrito', (req, res) => {
    db.query(`SELECT c.id, c.producto_id, c.cantidad AS quantity, p.nombre AS name, p.precio AS price, p.imagen AS image FROM carrito c JOIN productos p ON c.producto_id = p.id WHERE c.usuario_id = ?`, [req.userId], (err, results) => {
        if (err) return mysqlError(res, 'get cart', err);
        res.json(results);
    });
});

app.post('/api/carrito', (req, res) => {
    const { producto_id, cantidad } = req.body;
    db.query('INSERT INTO carrito (usuario_id, producto_id, cantidad) VALUES (?, ?, ?)', [req.userId, producto_id, cantidad], (err) => {
        if (err) return mysqlError(res, 'add cart', err);
        res.json({ ok: true });
    });
});

app.delete('/api/carrito/:id', (req, res) => {
    db.query('DELETE FROM carrito WHERE id = ? AND usuario_id = ?', [req.params.id, req.userId], (err) => {
        if (err) return mysqlError(res, 'del cart', err);
        res.json({ ok: true });
    });
});

/* =====================
    INICIO DE SERVIDOR
===================== */
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`
    =========================================
    🚀 SERVIDOR BALLERS CRM/SCM INICIADO
    🔗 URL: http://localhost:${PORT}
    =========================================
    `);
});