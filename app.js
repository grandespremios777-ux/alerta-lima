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
  const vence = new Date(ahora.getTime() + 30 * 1000);

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
  if (marcadoresAlertas[id]) return;
  if (!alerta.lat || !alerta.lng) return;

  const ahora = new Date();

  let vence = null;

  if (alerta.expiresAt && alerta.expiresAt.toDate) {
    vence = alerta.expiresAt.toDate();
  } else if (alerta.expiresAt) {
    vence = new Date(alerta.expiresAt);
  }

  if (vence && vence <= ahora) return;

  const icono = crearIconoAlerta(alerta.tipo);

  const marcador = L.marker([alerta.lat, alerta.lng], { icon: icono })
    .addTo(map)
    .bindPopup(`
      <div class="popup-alerta">
        <strong>${alerta.tipo}</strong><br>
        <p>${alerta.descripcion}</p>
        <small>Se borra: ${vence ? vence.toLocaleTimeString() : 'pronto'}</small>
      </div>
    `);

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

    if (change.type === "added") {
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