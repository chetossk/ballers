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

app.use(express.static(path.join(__dirname, 'src'))); // Tu carpeta principal
app.use('/assets', express.static(path.join(__dirname, 'assets'))); // Para rutas /assets/...
app.use('/img', express.static(path.join(__dirname, 'img')));       // Para rutas /img/...
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Por si subes fotos nuevas


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
    MÓDULO SCM: MOVIMIENTOS E INVENTARIO
===================== */

// REGISTRO DE MOVIMIENTOS (Entradas/Salidas)
app.post('/api/inventario/movimiento', (req, res) => {
    const { producto_id, tipo, cantidad, motivo } = req.body;
    
    const sqlMov = `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES (?,?,?,?)`;
    db.query(sqlMov, [producto_id, tipo, cantidad, motivo], (err) => {
        if (err) return res.status(500).json(err);

        const op = (tipo === 'entrada') ? '+' : '-';
        const sqlUpdate = `UPDATE productos SET stock = stock ${op} ? WHERE id = ?`;
        
        db.query(sqlUpdate, [cantidad, producto_id], (err2) => {
            if (err2) return res.status(500).json(err2);

            if (tipo === 'salida') {
                db.query(`SELECT stock, stock_minimo, estrategia_logistica FROM productos WHERE id = ?`, [producto_id], (err3, rows) => {
                    const p = rows[0];
                    if (p && p.estrategia_logistica === 'PUSH' && p.stock <= p.stock_minimo) {
                        const autoId = 'AUTO-' + Math.floor(Math.random() * 999);
                        db.query(`INSERT INTO pedidos (id, usuario_id, total, estado, direccion) VALUES (?, 1, 0, 'pendiente', 'SCM: REPOSICIÓN AUTOMÁTICA')`, [autoId]);
                    }
                });
            }
            res.json({ ok: true, message: 'Inventario actualizado' });
        });
    });
});

// Reporte: Rotación Lenta
app.get('/api/scm/reportes/rotacion-lenta', (req, res) => {
    const sql = `
        SELECT id, nombre, stock, stock_minimo, estrategia_logistica 
        FROM productos 
        WHERE active = 1 AND id NOT IN (
            SELECT DISTINCT producto_id FROM movimientos_inventario 
            WHERE tipo='salida' AND motivo='venta' AND fecha > DATE_SUB(NOW(), INTERVAL 30 DAY)
        )`;
    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

// Reporte: Más Vendidos
app.get('/api/scm/reportes/mas-vendidos', (req, res) => {
    const sql = `
        SELECT p.nombre, SUM(m.cantidad) as cantidad_vendida 
        FROM movimientos_inventario m 
        JOIN productos p ON m.producto_id = p.id 
        WHERE m.tipo='salida' AND m.motivo='venta' 
        GROUP BY p.id ORDER BY cantidad_vendida DESC LIMIT 5`;
    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

// Métricas Dashboard
app.get('/api/scm/dashboard', (req, res) => {
    const sqlCritico = "SELECT nombre, stock, stock_minimo FROM productos WHERE stock < stock_minimo AND active = 1";
    const sqlTop = "SELECT nombre, stock FROM productos ORDER BY stock DESC LIMIT 5";
    const sqlLento = `
        SELECT nombre, stock FROM productos 
        WHERE active = 1 AND id NOT IN (
            SELECT DISTINCT producto_id FROM movimientos_inventario 
            WHERE tipo='salida' AND fecha > DATE_SUB(NOW(), INTERVAL 30 DAY)
        ) LIMIT 5`;

    db.query(sqlCritico, (err, criticos) => {
        if (err) return res.status(500).json(err);
        db.query(sqlTop, (err, top) => {
            if (err) return res.status(500).json(err);
            db.query(sqlLento, (err, lento) => {
                if (err) return res.status(500).json(err);
                const madurez = criticos.length === 0 ? "Excelente" : (criticos.length < 3 ? "Estable" : "Crítico");
                res.json({
                    madurez: madurez,
                    inventarioCritico: criticos,
                    topVendidos: top,
                    rotacionLenta: lento
                });
            });
        });
    });
});

app.post('/api/recibir-pedido/:id', async (req, res) => {
    const pedidoId = req.params.id;

    try {
        // 1. Obtener datos del pedido
        const [pedidos] = await db.promise().query(
            "SELECT producto_id, cantidad FROM pedidos_proveedor WHERE id = ?", 
            [pedidoId]
        );

        const { producto_id, cantidad } = pedidos[0];

        // 2. Actualizar el pedido a RECIBIDO
        await db.promise().query("UPDATE pedidos_proveedor SET estado = 'RECIBIDO' WHERE id = ?", [pedidoId]);

        // 3. ACTUALIZACIÓN DOBLE: Sumamos a 'stock' y a 'stock_actual'
        // Esto garantiza que se refleje en cualquier parte del sistema
        await db.promise().query(
            "UPDATE productos SET stock = stock + ?, stock_actual = stock_actual + ? WHERE id = ?", 
            [cantidad, cantidad, producto_id]
        );

        res.json({ success: true, message: "Inventario actualizado en ambas columnas" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/kpis-erp', async (req, res) => {
    try {
        // Suma de todas las ventas
        const [ingresos] = await db.promise().query("SELECT SUM(total) as total FROM ordenes_empresariales");
        // Conteo de órdenes
        const [ordenes] = await db.promise().query("SELECT COUNT(*) as total FROM ordenes_empresariales");
        // Suma de stock total
        const [stock] = await db.promise().query("SELECT SUM(stock_actual) as total FROM productos");

        res.json({
            ingresos: ingresos[0].total || 0,
            ordenes: ordenes[0].total || 0,
            stock: stock[0].total || 0
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});


// RUTA PARA LOS KPIs DEL DASHBOARD
app.get('/api/dashboard-stats', async (req, res) => {
    try {
        // 1. Suma total de ventas (Ingresos)
        const [ventas] = await db.promise().query("SELECT SUM(total) as total FROM ordenes_empresariales");
        
        // 2. Conteo de órdenes (Órdenes Procesadas)
        const [ordenes] = await db.promise().query("SELECT COUNT(*) as conteo FROM ordenes_empresariales");
        
        // 3. Conteo de clientes únicos (Clientes Activos)
        const [clientes] = await db.promise().query("SELECT COUNT(DISTINCT usuario_id) as total FROM ordenes_empresariales");
        
        // 4. Suma de stock_actual (Stock Disponible)
        const [inventario] = await db.promise().query("SELECT SUM(stock_actual) as total_stock FROM productos");

        res.json({
            ingresos: ventas[0].total || 0,
            procesadas: ordenes[0].conteo || 0,
            clientes: clientes[0].total || 0,
            stock: inventario[0].total_stock || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.post('/api/reportes/guardar', async (req, res) => {
    const { ingresos, ordenes, stock, usuario_id } = req.body;
    try {
        await db.promise().query(
            "INSERT INTO reportes_erp (ingresos_totales, ordenes_procesadas, stock_disponible, usuario_generador) VALUES (?, ?, ?, ?)",
            [ingresos, ordenes, stock, usuario_id]
        );
        res.json({ success: true, message: "Reporte guardado en base de datos" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// RUTA PARA CLIENTES (Basada en tu tabla 'usuarios')
app.get('/api/clientes-list', (req, res) => {
    const sql = "SELECT id, nombre, correo AS email FROM usuarios"; 
    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ Error SQL Clientes:", err.message);
            // Si falla la DB, mandamos un dato de prueba para que no se vea vacío
            return res.json([{ id: 0, nombre: "Error de conexión", email: err.code }]);
        }
        res.json(results.length > 0 ? results : [{ id: 1, nombre: "Sin clientes", email: "N/A" }]);
    });
});

// RUTA PARA PROCESOS (Basada en tu tabla 'recursos' o lógica de SCM)
app.get('/api/procesos-stats', (req, res) => {
    // Usaremos la tabla recursos para simular estados de proceso si no tienes tabla de órdenes
    const sql = "SELECT nombre_recurso AS paso, estado FROM recursos";
    db.query(sql, (err, results) => {
        if (err || results.length === 0) {
            // Datos por defecto si la tabla está vacía o falla
            return res.json([
                { paso: 'Validación SCM', estado: 'Operativo' },
                { paso: 'Logística Ballers', estado: 'En espera' }
            ]);
        }
        res.json(results);
    });
});

// RUTA PARA PRODUCTOS (Para quitar el 404 que te salía)
app.get('/api/productos-list', (req, res) => {
    const sql = "SELECT id, nombre, stock_actual FROM productos";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Verifica que diga exactamente '/api/recursos-list'
app.get('/api/recursos-list', (req, res) => {
    // Usamos los nombres de columnas que vimos en tu captura anterior
    const sql = "SELECT nombre_recurso, tipo, estado, descripcion FROM recursos";
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error en MySQL:", err);
            return res.status(500).json({ error: err.message });
        }
        // IMPORTANTE: Esto envía el JSON que el frontend sí entiende
        res.json(results); 
    });
});

;

/* =====================
    MÓDULO CARRITO (COMPLETO)
===================== */

// 1. Obtener el carrito de un usuario (GET)
app.get('/api/carrito', (req, res) => {
    const userId = req.headers['x-user-id'] || 9; // El ID que manda el frontend
    
    // Consulta SQL para traer los productos unidos con la tabla productos para obtener fotos y precios
    const sql = `
        SELECT c.id, p.nombre as name, p.precio as price, p.imagen as image, c.cantidad as quantity
        FROM carrito c
        JOIN productos p ON c.producto_id = p.id
        WHERE c.usuario_id = ?`;

    db.query(sql, [userId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows); // Esto es lo que espera el cart.html
    });
});

// 2. Actualizar cantidad (PUT)
app.put('/api/carrito/:id', (req, res) => {
    const { id } = req.params;
    const { cantidad } = req.body;
    db.query("UPDATE carrito SET cantidad = ? WHERE id = ?", [cantidad, id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// 3. Eliminar del carrito (DELETE)
app.delete('/api/carrito/:id', (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM carrito WHERE id = ?", [id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// 4. Modifica tu POST actual para que REALMENTE guarde en la DB
app.post('/api/carrito', (req, res) => {
    const { usuario_id, producto_id, cantidad } = req.body;
    
    if (!usuario_id || !producto_id) {
        return res.status(400).json({ success: false, message: "Faltan datos" });
    }

    const sql = "INSERT INTO carrito (usuario_id, producto_id, cantidad) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE cantidad = cantidad + ?";
    db.query(sql, [usuario_id, producto_id, cantidad || 1, cantidad || 1], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Añadido" });
    });
});


/* =====================
    MÓDULO: HISTORIAL DE COMPRAS (CLIENTE)
     =====================*/

app.get('/api/mis-compras', (req, res) => {
    // Usamos usuario_id como aparece en tu captura de MySQL
    const userId = req.headers['x-user-id'] || 9;

    // Ajustamos los nombres: 'usuario_id' y 'fecha'
    const sqlPedidos = `SELECT id, total, estado as status, fecha as date FROM ordenes_empresariales WHERE usuario_id = ? ORDER BY fecha DESC`;

    db.query(sqlPedidos, [userId], (err, pedidos) => {
        if (err) {
            console.error("❌ Error en SQL Pedidos:", err);
            return res.status(500).json({ error: err.message });
        }

        if (pedidos.length === 0) return res.json([]);

        const ids = pedidos.map(p => p.id);

        // Consulta para los artículos
        const sqlItems = `
            SELECT oi.orden_id, oi.cantidad as qty, p.nombre as name, oi.precio_unitario as price
            FROM orden_items oi
            JOIN productos p ON oi.producto_id = p.id
            WHERE oi.orden_id IN (?)`;

        db.query(sqlItems, [ids], (err2, items) => {
            if (err2) {
                console.error("❌ Error en SQL Items:", err2);
                return res.status(500).json({ error: err2.message });
            }

            // Agrupamos items por pedido
            const respuesta = pedidos.map(p => ({
                ...p,
                items: items.filter(i => i.orden_id === p.id),
                address: "Dirección en perfil" // O la columna que uses para envío
            }));

            res.json(respuesta);
        });
    });
});


app.post('/api/checkout', async (req, res) => {
    const userId = req.headers['x-user-id'] || 9;

    db.beginTransaction(async (err) => {
        if (err) return res.status(300).json({ success: false, message: "Error de transacción" });

        try {
            // 1. Obtener items del carrito
            const [rawItems] = await db.promise().query(
                "SELECT c.producto_id, c.cantidad, p.precio FROM carrito c JOIN productos p ON c.producto_id = p.id WHERE c.usuario_id = ?", 
                [userId]
            );

            if (rawItems.length === 0) return db.rollback(() => res.status(400).json({ success: false, message: "Carrito vacío" }));

            // --- NUEVA LÓGICA: AGRUPAR REPETIDOS ---
            const itemsAgrupados = rawItems.reduce((acc, current) => {
                const existente = acc.find(item => item.producto_id === current.producto_id);
                if (existente) {
                    existente.cantidad += current.cantidad;
                } else {
                    acc.push({ ...current });
                }
                return acc;
            }, []);
            // ---------------------------------------

            const total = itemsAgrupados.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);

            // 2. Crear cabecera
            const [orden] = await db.promise().query(
                "INSERT INTO ordenes_empresariales (cliente_id, usuario_id, total, estado, fecha) VALUES (?, ?, ?, 'pendiente', NOW())",
                [userId, userId, total]
            );
            const ordenId = orden.insertId;

            // 3. Insertar items (ya sin duplicados)
            for (const item of itemsAgrupados) {
                await db.promise().query(
                    "INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)",
                    [ordenId, item.producto_id, item.cantidad, item.precio]
                );
                
                await db.promise().query(
                    "UPDATE productos SET stock = stock - ? WHERE id = ?",
                    [item.cantidad, item.producto_id]
                );
            }

            await db.promise().query("DELETE FROM carrito WHERE usuario_id = ?", [userId]);

            db.commit(() => {
                res.json({ success: true, message: "¡Compra exitosa!", ordenId });
            });

        } catch (error) {
            db.rollback(() => {
                res.status(500).json({ success: false, message: error.message });
            });
        }
    });
});

// Estrategias Logísticas
app.get('/api/scm/estrategias', (req, res) => {
    const sql = "SELECT id, nombre, stock, estrategia_logistica FROM productos WHERE active = 1";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/scm/cambiar-estrategia', (req, res) => {
    const { id, nuevaEstrategia } = req.body;
    const sql = "UPDATE productos SET estrategia_logistica = ? WHERE id = ?";
    db.query(sql, [nuevaEstrategia, id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ ok: true });
    });
});

/* =====================
    DASHBOARD: MÉTRICAS CRM
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

    db.query(sqlBase, (err, counts) => {
        if (err) return mysqlError(res, 'metrics counts', err);
        res.json({ ...counts[0] });
    });
});

/* =====================
    MÓDULO SCM: SOLICITUDES Y PROVEEDORES
===================== */

// 1. Crear solicitud (Poner en espera)
app.post('/api/solicitudes', (req, res) => {
    const { producto_id, proveedor_id, cantidad } = req.body;
    const sql = "INSERT INTO solicitudes (producto_id, proveedor_id, cantidad, estado) VALUES (?, ?, ?, 'pendiente')";
    db.query(sql, [producto_id, proveedor_id, cantidad], (err) => {
        if (err) return res.status(500).json({ ok: false, error: err });
        res.json({ success: true });
    });
});

// 2. Ver historial completo (Pendientes y Recibidos)
app.get('/api/solicitudes/pendientes', (req, res) => {
    const sql = `
        SELECT s.*, p.nombre as producto_nombre, prov.nombre as proveedor_nombre 
        FROM solicitudes s
        JOIN productos p ON s.producto_id = p.id
        JOIN proveedores prov ON s.proveedor_id = prov.id
        ORDER BY s.fecha DESC LIMIT 20`;
        
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ ok: false, error: err });
        res.json(results);
    });
});


app.post('/api/solicitudes/confirmar', (req, res) => {
    // Asegúrate de que desde el frontend envíes estos 3 datos exactos
    const { solicitud_id, producto_id, cantidad } = req.body; 
    
    if (!solicitud_id || !producto_id || !cantidad) {
        return res.status(400).json({ success: false, message: "Faltan datos en la petición" });
    }

    db.beginTransaction((err) => {
        if (err) return res.status(500).json({ success: false, message: "Error en transacción" });

        // 1. SUMAR AL STOCK (Módulo SCM)
        const sqlStock = "UPDATE productos SET stock = stock + ? WHERE id = ?";
        db.query(sqlStock, [Number(cantidad), producto_id], (err1) => {
            if (err1) return db.rollback(() => res.status(500).json({ success: false, message: "Error al sumar stock" }));

            // 2. CAMBIAR ESTADO (A 'completado' según el ENUM de tu imagen 5e4cd8)
            const sqlSolicitud = "UPDATE solicitudes SET estado = 'completado' WHERE id = ?";
            db.query(sqlSolicitud, [solicitud_id], (err2) => {
                if (err2) return db.rollback(() => res.status(500).json({ success: false, message: "Error al actualizar estado" }));
                
                db.commit((errC) => {
                    if (errC) return db.rollback(() => res.status(500).json({ success: false, message: "Error commit" }));
                    res.json({ success: true, message: "¡Stock actualizado y Solicitud cerrada!" });
                });
            });
        });
    });
});


/* =====================
    3.1 FUNDAMENTOS ERP: MÓDULO ÓRDENES
===================== */

// POST /ordenes - Crear una nueva orden y conectar recursos
app.post('/api/ordenes', async (req, res) => {
    const { cliente_id, usuario_id, productos } = req.body;

    console.log("📦 BODY:", req.body); // DEBUG

    if (!cliente_id || !productos || !Array.isArray(productos)) {
        return res.status(400).json({ ok: false, error: "Datos inválidos" });
    }

    db.beginTransaction(async (err) => {
        if (err) return res.status(500).json({ ok: false, error: "Error transacción" });

        try {
            const [ordenRes] = await db.promise().query(
                "INSERT INTO ordenes_empresariales (cliente_id, usuario_id, total, estado) VALUES (?, ?, 0, 'pendiente')",
                [cliente_id, usuario_id || 1]
            );

            const ordenId = ordenRes.insertId;
            let total = 0;

            for (const item of productos) {

    const productoId = Number(item.id || item.producto_id);
    const cantidad = Number(item.cant || item.cantidad);

    // 🔴 VALIDACIÓN
    if (isNaN(productoId) || isNaN(cantidad)) {
        throw new Error("Datos inválidos en producto");
    }

    const [rows] = await db.promise().query(
        "SELECT precio FROM productos WHERE id = ?",
        [productoId]
    );

    if (!rows.length) {
        throw new Error("Producto no existe en BD");
    }

    const precio = Number(rows[0].precio);
    const subtotal = precio * cantidad;

    total += subtotal;

    await db.promise().query(
        "INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)",
        [ordenId, productoId, cantidad, precio]
    );
}

            await db.promise().query(
                "UPDATE ordenes_empresariales SET total = ? WHERE id = ?",
                [total, ordenId]
            );

            db.commit(() => {
                res.json({ ok: true, ordenId });
            });

        } catch (error) {
            console.error("🔥 ERROR ORDEN:", error.message);
            db.rollback(() => {
                res.status(500).json({ ok: false, error: error.message });
            });
        }
    });
});

app.get('/api/ordenes', (req, res) => {
    const sql = `
        SELECT 
            o.id,
            u.nombre AS cliente,
            o.fecha,
            o.total,
            o.estado
        FROM ordenes_empresariales o 
        JOIN usuarios u ON o.cliente_id = u.id 
        ORDER BY o.fecha DESC
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            console.error("Error SQL:", err);
            return res.status(500).json(err);
        }
        res.json(rows);
    });
});

// GET /ordenes/{id} - Detalle de una orden específica
app.get('/api/ordenes/:id', (req, res) => {
    const sql = `
        SELECT oi.*, p.nombre 
        FROM orden_items oi 
        JOIN productos p ON oi.producto_id = p.id 
        WHERE oi.orden_id = ?`;
    db.query(sql, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

// PUT /ordenes/{id}/estado - Actualizar estado del proceso
app.post('/api/ordenes/estado', (req, res) => {
    const { id, estado } = req.body;
    db.query("UPDATE ordenes_empresariales SET estado = ? WHERE id = ?", [estado, id], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ ok: true });
    });
});

/* =====================
    3.2 BENEFICIOS ERP: AUTOMATIZACIÓN
===================== */

app.post('/api/ordenes/procesar', async (req, res) => {
    const { cliente_id, items, usuario_id } = req.body; 

    db.beginTransaction(async (err) => {
        if (err) return res.status(500).json({ ok: false, message: "Error Transacción" });

        try {
            // BUSCAMOS EL PRIMER ADMIN SI NO VIENE UN USUARIO_ID
            let idFinal = usuario_id;
            if (!idFinal) {
                const [admin] = await db.promise().query("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1");
                idFinal = admin.length > 0 ? admin[0].id : cliente_id; // Respaldo si no hay admin
            }

            // A. CREAR ORDEN
            const [ordenRes] = await db.promise().query(
                "INSERT INTO ordenes_empresariales (cliente_id, usuario_id, total, estado) VALUES (?, ?, 0, 'completada')",
                [cliente_id, idFinal]
            );
            
            // ... (el resto de tu código de stock y movimientos que ya tienes)
            const ordenId = ordenRes.insertId;
            let totalVenta = 0;

            for (const item of items) {
                // Obtener datos del producto para el cálculo
                const [pData] = await db.promise().query("SELECT precio, nombre, stock FROM productos WHERE id = ?", [item.id]);
                const producto = pData[0];
                const subtotal = producto.precio * item.cant;
                totalVenta += subtotal;

                // B. REDUCIR STOCK AUTOMÁTICAMENTE (SCM)
                await db.promise().query(
                    "UPDATE productos SET stock = stock - ? WHERE id = ?", 
                    [item.cant, item.id]
                );

                // C. REGISTRAR MOVIMIENTO (Historial/Trazabilidad)
                await db.promise().query(
                    "INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES (?, 'salida', ?, ?)",
                    [item.id, item.cant, `Venta Automática ERP - Orden #${ordenId}`]
                );

                // D. GUARDAR DETALLE (Relación)
                await db.promise().query(
                    "INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)",
                    [ordenId, item.id, item.cant, producto.precio]
                );
            }

            // Actualizar el total final de la orden empresarial
            await db.promise().query("UPDATE ordenes_empresariales SET total = ? WHERE id = ?", [totalVenta, ordenId]);

            db.commit(() => {
                res.json({ 
                    ok: true, 
                    message: "¡Proceso Automatizado Exitoso!",
                    detalles: `Stock actualizado, Movimiento registrado y Orden #${ordenId} generada.` 
                });
            });

        } catch (error) {
            db.rollback(() => {
                console.error("Error en automatización:", error);
                res.status(500).json({ ok: false, message: "Error en el proceso automático", error: error.message });
            });
        }
    });
});

/* =====================
    3.3 ETAPAS DE ADOPCIÓN (MADUREZ)
===================== */

// GET /erp/estado - Obtener el nivel actual de madurez
app.get('/api/erp/estado', (req, res) => {
    db.query("SELECT nivel_madurez, ultima_evaluacion FROM erp_config WHERE id = 1", (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows[0] || { nivel_madurez: 'Básico' });
    });
});

// PUT /erp/estado - Actualizar el nivel de implementación
app.post('/api/erp/estado', (req, res) => {
    const { nuevoNivel } = req.body;
    const sql = "UPDATE erp_config SET nivel_madurez = ? WHERE id = 1";
    
    db.query(sql, [nuevoNivel], (err) => {
        if (err) return res.status(500).json({ ok: false, error: err });
        res.json({ ok: true, message: `Nivel actualizado a: ${nuevoNivel}` });
    });
});


/* =====================
    3.4 EVALUACIÓN ERP: MÉTRICAS PARA EL DASHBOARD
===================== */

app.get('/api/admin/metrics', (req, res) => {
    // Consulta masiva para alimentar todos tus KPIs y Gráficas del HTML
    const sqlBase = `
    SELECT 
        (SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente') as total_clientes,
        (SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente' AND verificado = 1) as activos,
        (SELECT COUNT(*) FROM usuarios WHERE rol = 'cliente' AND verificado = 0) as inactivos,
        (SELECT COUNT(*) FROM productos WHERE stock <= stock_minimo AND active = 1) as stock_critico,
        (SELECT COUNT(*) FROM solicitudes WHERE estado = 'pendiente') as reposiciones_push,
        (SELECT IFNULL(SUM(total), 0) FROM ordenes_empresariales WHERE estado != 'cancelada') as revenue
    `;

    db.query(sqlBase, (err, counts) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });

        // Consulta adicional para "Clientes en Riesgo" (Sección Roja de tu HTML)
        const sqlRiesgo = "SELECT nombre, correo FROM usuarios WHERE rol = 'cliente' AND verificado = 0 LIMIT 5";
        
        db.query(sqlRiesgo, (err2, clientesRiesgo) => {
            if (err2) return res.status(500).json({ ok: false });

            // Enviamos TODO en un solo objeto para que tu JS lo reciba
            res.json({
                ...counts[0],
                clientesRiesgo: clientesRiesgo // Esto llena la cuadrícula roja
            });
        });
    });
});

/* =====================
    3.5 TECNOLOGÍAS COMERCIALES: ROLES Y SEGURIDAD
===================== */

// Endpoint de Login con validación de Rol
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const sql = "SELECT id, nombre, rol, password FROM usuarios WHERE correo = ?";

    db.query(sql, [email.toLowerCase().trim()], async (err, results) => {
        if (err || results.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
        }

        const match = await bcrypt.compare(password, results[0].password);
        if (match) {
            // Enviamos el rol para que el Frontend sepa qué menú mostrar
            res.json({ 
                success: true, 
                user: { 
                    id: results[0].id, 
                    nombre: results[0].nombre, 
                    rol: results[0].rol 
                } 
            });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }
    });
});

// Middleware de Seguridad: Simulación de permisos por módulo
function verificarPermiso(rolRequerido) {
    return (req, res, next) => {
        const userRol = req.headers['x-user-role']; // El frontend debe enviar esto
        if (userRol === 'administrador' || userRol === rolRequerido) {
            next();
        } else {
            res.status(403).json({ 
                ok: false, 
                message: `Acceso Denegado: Se requiere rol de ${rolRequerido}` 
            });
        }
    };
}

// Ejemplo de Endpoints Protegidos
app.get('/api/admin/config', verificarPermiso('administrador'), (req, res) => {
    res.json({ message: "Configuración sensible del ERP" });
});

app.get('/api/logistica/rutas', verificarPermiso('logistica'), (req, res) => {
    res.json({ message: "Rutas de entrega SCM" });
});

/* =====================
    CATÁLOGOS
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
    AUTENTICACIÓN
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