const express = require('express');
const path = require('path');

const app = express();

// Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔥 Servir archivos estáticos SIEMPRE primero
app.use('/assets', express.static(path.join(__dirname, 'src/assets')));
app.use('/css', express.static(path.join(__dirname, 'src/css')));
app.use('/js', express.static(path.join(__dirname, 'src/js')));

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

// ❗ Catch-all AL FINAL (si lo necesitas)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🔥 Servidor corriendo en http://localhost:${PORT}`);
});
