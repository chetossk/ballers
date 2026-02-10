const API = 'http://localhost:3000/api';

async function mostrarCatalogo() {
    console.log("intentando cargar productos..."); // Mensaje de prueba
    try {
        const res = await fetch(`${API}/productos`);
        const data = await res.json();
        
        console.log("Datos recibidos:", data); // Mira si llegan datos de MySQL

        const grid = document.getElementById('grid-productos'); 
        if (!grid) {
            console.error("No se encontró el ID grid-productos en el HTML");
            return;
        }

        if (data.length === 0) {
            grid.innerHTML = "<h2>No hay productos en la base de datos.</h2>";
            return;
        }

        grid.innerHTML = data.map(p => `
            <div class="tarjeta-producto">
                <div class="img-producto">
                    <img src="${p.imagen}" alt="${p.nombre}" onerror="this.src='assets/img/placeholder.jpg'">
                </div>
                <div class="detalles-producto">
                    <span class="categoria-tag">${p.categoria}</span>
                    <h3>${p.nombre}</h3>
                    <div class="precio-container">
                        <span class="moneda">$</span>
                        <span class="precio-valor">${p.precio}</span>
                    </div>
                    <button class="btn-comprar" onclick="registrarInteres('${p.categoria}')">
                        AGREGAR AL CARRITO
                    </button>
                </div>
            </div>
        `).join('');

        console.log("¡Catálogo renderizado!");
    } catch (e) { 
        console.error("Error de conexión con la API:", e); 
        document.getElementById('grid-productos').innerHTML = "<h2>Error al conectar con el servidor</h2>";
    }
}

window.onload = mostrarCatalogo;