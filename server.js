const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

/* =====================
   MIDDLEWARES
===================== */
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (usa SOLO UNA carpeta)
app.use(express.static(path.join(__dirname, 'src')));

/* =====================
   CONEXIÓN A MYSQL
===================== */
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Luisykevin1357#',
  database: 'ballers_db'
});

db.connect(err => {
  if (err) {
    console.error('❌ Error DB:', err);
  } else {
    console.log('✅ Conectado a MySQL');
  }
});

/* =====================
   API PRODUCTOS
===================== */
app.get('/api/productos', (req, res) => {
  db.query('SELECT * FROM productos', (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error obteniendo productos" });
    }
    res.json(results);
  });
});

/* =====================
   REGISTRO USUARIOS
===================== */
app.post('/api/register', async (req, res) => {
  try {
    const { nombre, email, password, role } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({ message: 'Faltan datos' });
    }

    db.query(
      'SELECT id FROM usuarios WHERE correo = ?',
      [email],
      async (err, results) => {

        if (err) return res.status(500).json({ message: 'Error del servidor' });

        if (results.length > 0) {
          return res.status(400).json({ message: 'El correo ya está registrado' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const sql = `
          INSERT INTO usuarios (nombre, correo, password, rol, verificado)
          VALUES (?, ?, ?, ?, 0)
        `;

        db.query(sql, [nombre, email, passwordHash, role || 'cliente'], (err2) => {
          if (err2) return res.status(500).json({ message: 'Error al registrar' });

          res.status(201).json({ message: 'Usuario registrado correctamente' });
        });
      }
    );

  } catch (error) {
    res.status(500).json({ message: 'Error del servidor' });
  }
});

/* =====================
   LOGIN
===================== */
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const sql = `
    SELECT id, nombre, password, rol
    FROM usuarios
    WHERE correo = ?
  `;

  db.query(sql, [email], async (err, results) => {

    if (err) return res.status(500).json({ success: false });

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Correo no registrado'
      });
    }

    const usuario = results[0];

    try {
      const passwordValido = await bcrypt.compare(password, usuario.password);

      if (!passwordValido) {
        return res.status(401).json({
          success: false,
          message: 'Contraseña incorrecta'
        });
      }

      res.json({
        success: true,
        user: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol
        }
      });

    } catch (error) {
      res.status(500).json({ success: false });
    }

  });
});

/* =====================
   CARRITO
===================== */
app.post('/api/carrito', (req, res) => {
  const { usuario_id, producto_id, cantidad } = req.body;

  const sql = `
    INSERT INTO carrito (usuario_id, producto_id, cantidad)
    VALUES (?, ?, ?)
  `;

  db.query(sql, [usuario_id, producto_id, cantidad], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error agregando al carrito" });
    }
    res.json({ message: "Producto agregado al carrito" });
  });
});

/* =====================
   FINALIZAR COMPRA
===================== */
app.post('/api/finalizar-compra', (req, res) => {

  const { usuario_id } = req.body;

  const obtenerCarrito = `
    SELECT c.producto_id, c.cantidad, p.precio
    FROM carrito c
    JOIN productos p ON c.producto_id = p.id
    WHERE c.usuario_id = ?
  `;

  db.query(obtenerCarrito, [usuario_id], (err, items) => {

    if (err) return res.status(500).json({ error: "Error obteniendo carrito" });

    if (items.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    let pendientes = items.length;

    items.forEach(item => {

      const total = item.precio * item.cantidad;

      const insertarVenta = `
        INSERT INTO ventas (usuario_id, producto_id, cantidad, total)
        VALUES (?, ?, ?, ?)
      `;

      db.query(insertarVenta, [
        usuario_id,
        item.producto_id,
        item.cantidad,
        total
      ], (err2) => {

        if (err2) {
          console.error(err2);
          return res.status(500).json({ error: "Error registrando venta" });
        }

        pendientes--;

        if (pendientes === 0) {
          db.query("DELETE FROM carrito WHERE usuario_id = ?", [usuario_id]);
          res.json({ message: "Compra finalizada correctamente" });
        }

      });

    });

  });

});

/* =====================
   MÉTRICAS ADMIN
===================== */
app.get('/api/admin/metricas', (req, res) => {

  const metricas = {};

  db.query(
    "SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'cliente'",
    (err, r1) => {

      if (err) return res.status(500).json(err);
      metricas.totalClientes = r1[0].total;

      db.query(
        "SELECT COUNT(*) AS total FROM ventas",
        (err2, r2) => {

          if (err2) return res.status(500).json(err2);
          metricas.totalVentas = r2[0].total;

          db.query(
            "SELECT IFNULL(SUM(total),0) AS ingresos FROM ventas",
            (err3, r3) => {

              if (err3) return res.status(500).json(err3);
              metricas.ingresos = r3[0].ingresos;

              res.json(metricas);

            }
          );
        }
      );
    }
  );
});

/* =====================
   INICIAR SERVIDOR
===================== */
app.listen(3000, () => {
  console.log('🚀 Servidor en http://localhost:3000');
});
