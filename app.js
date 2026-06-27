// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Mapa centrado en Lima
const map = L.map('map').setView([-12.0464, -77.0428], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

let ubicacionSeleccionada = null;
let marcadorUsuario = null;
let marcadorSeleccion = null;

const marcadoresAlertas = {};

const iconoAuto = L.divIcon({
  className: 'icono-auto',
  html: '🚗',
  iconSize: [35, 35],
  iconAnchor: [17, 17]
});

const tiposAlerta = {
  "Manifestación": { emoji: "📢", color: "#ff9800" },
  "Robo": { emoji: "🚨", color: "#d10000" },
  "Choque": { emoji: "💥", color: "#e53935" },
  "Atunes": { icono: "img/casco-azul.png", color: "#1976d2" },
  "Calle cerrada": { emoji: "⛔", color: "#424242" },
  "Zona peligrosa": { emoji: "⚠️", color: "#fbc02d" }
};

function obtenerEstadoAlerta(confirmaciones, negativos) {
  if (negativos >= 3 && negativos > confirmaciones) {
    return {
      texto: "Dudosa / posible falsa",
      emoji: "🔴",
      color: "#d32f2f"
    };
  }

  if (confirmaciones >= 3) {
    return {
      texto: "Confirmada por usuarios",
      emoji: "🟢",
      color: "#2e7d32"
    };
  }

  return {
    texto: "Poca confirmación",
    emoji: "🟡",
    color: "#f9a825"
  };
}

function crearIconoAlerta(tipo, confirmaciones = 0, negativos = 0) {
  const data = tiposAlerta[tipo] || { emoji: "⚠️", color: "#d10000" };
  const estado = obtenerEstadoAlerta(confirmaciones, negativos);

  if (data.icono) {
    return L.divIcon({
      className: 'icono-alerta-img',
      html: `
        <div style="border-color:${estado.color}" class="burbuja-alerta-img">
          <img src="${data.icono}" alt="${tipo}" />
        </div>
      `,
      iconSize: [52, 52],
      iconAnchor: [26, 26]
    });
  }

  return L.divIcon({
    className: 'icono-alerta',
    html: `
      <div style="background:${data.color}; border-color:${estado.color}" class="burbuja-alerta">
        ${data.emoji}
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
}

function obtenerFechaVencimiento(alerta) {
  if (alerta.expiresAt && alerta.expiresAt.toDate) {
    return alerta.expiresAt.toDate();
  }

  if (alerta.expiresAt) {
    return new Date(alerta.expiresAt);
  }

  return null;
}

function crearPopupAlerta(id, alerta) {
  const vence = obtenerFechaVencimiento(alerta);
  const comentarios = alerta.comentarios || [];
  const confirmaciones = alerta.confirmaciones || 0;
  const negativos = alerta.negativos || 0;
  const estado = obtenerEstadoAlerta(confirmaciones, negativos);

  const listaComentarios = comentarios.length
    ? comentarios.map(c => `<li>${c.texto || c}</li>`).join('')
    : '<li>Aún no hay comentarios</li>';

  return `
    <div class="popup-alerta">
      <strong>${alerta.tipo}</strong><br>
      <p>${alerta.descripcion}</p>

      <div style="margin:8px 0; padding:6px; border-radius:8px; background:${estado.color}; color:white;">
        ${estado.emoji} ${estado.texto}
      </div>

      <small>✅ Sigue activo: ${confirmaciones}</small><br>
      <small>⚠️ Ya pasó / falso: ${negativos}</small><br>
      <small>Se borra: ${vence ? vence.toLocaleTimeString() : 'pronto'}</small>

      <hr>

      <button 
        onclick="confirmarAlerta('${id}')" 
        style="width:100%; margin-top:6px; padding:8px; border:none; border-radius:8px; background:#2e7d32; color:white;"
      >
        ✅ Sigue activo
      </button>

      <button 
        onclick="negarAlerta('${id}')" 
        style="width:100%; margin-top:6px; padding:8px; border:none; border-radius:8px; background:#d32f2f; color:white;"
      >
        ⚠️ Ya pasó / falso
      </button>

      <hr>

      <strong>Comentarios</strong>
      <ul class="lista-comentarios">
        ${listaComentarios}
      </ul>

      <input 
        id="comentario-${id}" 
        type="text" 
        placeholder="Escribe un comentario..." 
        style="width:100%; padding:8px; box-sizing:border-box;"
      />

      <button 
        onclick="comentarAlerta('${id}')" 
        style="width:100%; margin-top:6px; padding:8px; border:none; border-radius:8px; background:#222; color:white;"
      >
        Comentar
      </button>
    </div>
  `;
}

window.confirmarAlerta = function(id) {
  db.collection("alertas").doc(id).update({
    confirmaciones: firebase.firestore.FieldValue.increment(1)
  })
  .catch((error) => {
    console.error("Error confirmando alerta:", error);
    alert("No se pudo confirmar.");
  });
};

window.negarAlerta = function(id) {
  db.collection("alertas").doc(id).update({
    negativos: firebase.firestore.FieldValue.increment(1)
  })
  .catch((error) => {
    console.error("Error marcando como falsa:", error);
    alert("No se pudo registrar.");
  });
};

window.comentarAlerta = function(id) {
  const input = document.getElementById(`comentario-${id}`);

  if (!input) return;

  const texto = input.value.trim();

  if (texto.length < 2) {
    alert('Escribe un comentario más claro.');
    return;
  }

  db.collection("alertas").doc(id).update({
    comentarios: firebase.firestore.FieldValue.arrayUnion({
      texto: texto,
      createdAt: new Date()
    })
  })
  .then(() => {
    input.value = '';
  })
  .catch((error) => {
    console.error("Error agregando comentario:", error);
    alert("No se pudo agregar el comentario.");
  });
};

function actualizarUbicacionUsuario(posicion) {
  const lat = posicion.coords.latitude;
  const lng = posicion.coords.longitude;
  const nuevaUbicacion = [lat, lng];

  if (!marcadorUsuario) {
    marcadorUsuario = L.marker(nuevaUbicacion, { icon: iconoAuto })
      .addTo(map)
      .bindPopup('Tu ubicación');

    map.setView(nuevaUbicacion, 16);
  } else {
    marcadorUsuario.setLatLng(nuevaUbicacion);
  }
}

function errorUbicacion() {
  console.log('No se pudo obtener la ubicación del usuario.');
}

navigator.geolocation.watchPosition(
  actualizarUbicacionUsuario,
  errorUbicacion,
  {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  }
);

map.on('click', function(e) {
  ubicacionSeleccionada = e.latlng;

  if (marcadorSeleccion) {
    marcadorSeleccion.setLatLng(e.latlng);
  } else {
    marcadorSeleccion = L.marker(e.latlng)
      .addTo(map)
      .bindPopup('Punto seleccionado para alerta');
  }

  marcadorSeleccion.openPopup();
});

document.getElementById('btn-alerta').addEventListener('click', function() {
  document.getElementById('panel-alerta').classList.remove('oculto');
});

document.getElementById('cerrar').addEventListener('click', function() {
  document.getElementById('panel-alerta').classList.add('oculto');
});

document.getElementById('publicar').addEventListener('click', function() {
  const tipo = document.getElementById('tipo').value;
  const descripcion = document.getElementById('descripcion').value.trim();

  if (!ubicacionSeleccionada) {
    alert('Primero toca el mapa donde ocurrió la alerta.');
    return;
  }

  if (descripcion.length < 5) {
    alert('Escribe una descripción un poco más clara.');
    return;
  }

  const latAlerta = ubicacionSeleccionada.lat;
  const lngAlerta = ubicacionSeleccionada.lng;

  const ahora = new Date();
  const vence = new Date(ahora.getTime() + 30 * 60 * 1000);

  db.collection("alertas").add({
    tipo: tipo,
    descripcion: descripcion,
    lat: latAlerta,
    lng: lngAlerta,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: vence,
    comentarios: [],
    confirmaciones: 0,
    negativos: 0
  })
  .then(() => {
    console.log("Alerta guardada en Firebase");

    document.getElementById('descripcion').value = '';
    document.getElementById('panel-alerta').classList.add('oculto');

    if (marcadorSeleccion) {
      map.removeLayer(marcadorSeleccion);
      marcadorSeleccion = null;
    }

    ubicacionSeleccionada = null;
  })
  .catch((error) => {
    console.error("Error guardando alerta:", error);
    alert("No se pudo guardar la alerta.");
  });
});

function dibujarAlerta(id, alerta) {
  if (!alerta.lat || !alerta.lng) return;

  const vence = obtenerFechaVencimiento(alerta);

  if (vence && vence <= new Date()) return;

  const confirmaciones = alerta.confirmaciones || 0;
  const negativos = alerta.negativos || 0;
  const icono = crearIconoAlerta(alerta.tipo, confirmaciones, negativos);

  if (marcadoresAlertas[id]) {
    marcadoresAlertas[id].setPopupContent(crearPopupAlerta(id, alerta));
    marcadoresAlertas[id].setIcon(icono);
    return;
  }

  const marcador = L.marker([alerta.lat, alerta.lng], { icon: icono })
    .addTo(map)
    .bindPopup(crearPopupAlerta(id, alerta));

  marcadoresAlertas[id] = marcador;

  if (vence) {
    const tiempoRestante = vence.getTime() - Date.now();

    setTimeout(() => {
      if (marcadoresAlertas[id]) {
        map.removeLayer(marcadoresAlertas[id]);
        delete marcadoresAlertas[id];
      }
    }, tiempoRestante);
  }
}

db.collection("alertas").onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const id = change.doc.id;
    const alerta = change.doc.data();

    if (change.type === "added" || change.type === "modified") {
      dibujarAlerta(id, alerta);
    }

    if (change.type === "removed") {
      if (marcadoresAlertas[id]) {
        map.removeLayer(marcadoresAlertas[id]);
        delete marcadoresAlertas[id];
      }
    }
  });
});