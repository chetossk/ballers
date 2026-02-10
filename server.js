const express = require('express');
const path = require('path');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

/* =====================
   MIDDLEWARES
===================== */
app.use(cors());
app.use(express.json());

// Archivos estáticos
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
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

/* =====================
   REGISTRO USUARIOS
===================== */
app.post('/register', (req, res) => {
  const { nombre, email, password, role } = req.body;

  const sql = `
    INSERT INTO usuarios (nombre, correo, password, rol)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [nombre, email, password, role], (err) => {
    if (err) {
      console.error("❌ ERROR MYSQL:", err.sqlMessage);
      return res.status(500).json({
        message: "Error en la base de datos: " + err.sqlMessage
      });
    }
    res.json({ ok: true, message: "Usuario registrado" });
  });
});

/* =====================
   ADMIN - LISTAR USUARIOS
===================== */
app.get('/admin/usuarios', (req, res) => {
  db.query(
    'SELECT id, nombre, correo, rol, estado FROM usuarios',
    (err, results) => {
      if (err) {
        console.error("❌ Error al obtener usuarios:", err.sqlMessage);
        return res.status(500).json([]);
      }
      res.json(results);
    }
  );
});

/* =====================
   ADMIN - CREAR USUARIO
===================== */
app.post('/admin/usuarios', (req, res) => {
  const { nombre, correo, rol } = req.body;

  // contraseña temporal
  const password = '123456';

  const sql = `
    INSERT INTO usuarios (nombre, correo, password, rol, verificado)
    VALUES (?, ?, ?, ?, 0)
  `;

  db.query(sql, [nombre, correo, password, rol], (err) => {
    if (err) {
      console.error('❌ Error MySQL:', err.sqlMessage);
      return res.json({ ok: false });
    }

    res.json({ ok: true });
  });
});


/* =====================
   LOGIN
===================== */
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const sql = `
    SELECT rol
    FROM usuarios
    WHERE correo = ? AND password = ?
  `;

  db.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error("❌ Error login:", err.sqlMessage);
      return res.status(500).json({ success: false });
    }

    if (results.length > 0) {
      res.json({ success: true, role: results[0].rol });
    } else {
      res.status(401).json({
        success: false,
        message: "Credenciales incorrectas"
      });
    }
  });
});

/* =====================
   INICIAR SERVIDOR
===================== */
app.listen(3000, () => {
  console.log('🚀 Servidor en http://localhost:3000');
});
