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
  "Accidente": { emoji: "🚑", color: "#c62828" },
  "Calle cerrada": { emoji: "⛔", color: "#424242" },
  "Zona peligrosa": { emoji: "⚠️", color: "#fbc02d" }
};

function crearIconoAlerta(tipo) {
  const data = tiposAlerta[tipo] || { emoji: "⚠️", color: "#d10000" };

  return L.divIcon({
    className: 'icono-alerta',
    html: `
      <div style="background:${data.color}" class="burbuja-alerta">
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

  const listaComentarios = comentarios.length
    ? comentarios.map(c => `<li>${c.texto || c}</li>`).join('')
    : '<li>Aún no hay comentarios</li>';

  return `
    <div class="popup-alerta">
      <strong>${alerta.tipo}</strong><br>
      <p>${alerta.descripcion}</p>

      <small>Se borra: ${vence ? vence.toLocaleTimeString() : 'pronto'}</small>

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
    console.log("Comentario agregado");
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
  const vence = new Date(ahora.getTime() + 3 * 60 * 1000);

  db.collection("alertas").add({
    tipo: tipo,
    descripcion: descripcion,
    lat: latAlerta,
    lng: lngAlerta,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: vence,
    comentarios: []
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

  if (marcadoresAlertas[id]) {
    marcadoresAlertas[id].setPopupContent(crearPopupAlerta(id, alerta));
    return;
  }

  const icono = crearIconoAlerta(alerta.tipo);

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
