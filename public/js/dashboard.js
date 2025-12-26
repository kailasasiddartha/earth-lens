import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const firebaseConfig = { /* SAME AS ABOVE */ };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function initMap() {
  const { Map } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

  const map = new Map(document.getElementById("map"), {
    zoom: 3,
    center: { lat: 20, lng: 0 },
    mapId: "YOUR_MAP_ID" // Create a map ID in Cloud Console
  });

  const markers = {};
  const icons = {
    pothole: { bg: '#FF0000', glyph: 'P' },
    waste: { bg: '#FFA500', glyph: 'W' },
    pollution: { bg: '#0000FF', glyph: 'A' }
  };

  onSnapshot(collection(db, 'hazards'), snapshot => {
    snapshot.docChanges().forEach(change => {
      const data = change.doc.data();
      const id = change.doc.id;

      if (change.type === 'removed') {
        markers[id]?.remove();
        delete markers[id];
        return;
      }

      if (markers[id]) markers[id].remove();

      const pin = new PinElement({
        background: icons[data.category].bg,
        glyphColor: 'white',
        glyph: icons[data.category].glyph,
        scale: 1.4
      });

      const marker = new AdvancedMarkerElement({
        map,
        position: { lat: data.lat, lng: data.lng },
        content: pin.element,
        title: `${data.category.toUpperCase()} (${data.confidence}%)`
      });

      const info = new google.maps.InfoWindow({
        content: `<img src="${data.imageUrl}" style="width:200px;"><br>
                  <strong>${data.category}</strong><br>
                  Reasoning: ${data.reasoning}<br>
                  Confidence: ${data.confidence}%<br>
                  Time: ${new Date(data.timestamp).toLocaleString()}`
      });

      marker.addListener('click', () => info.open(map, marker));
      markers[id] = marker;
    });
  });

  document.getElementById('filter').onchange = e => {
    const filter = e.target.value;
    Object.values(markers).forEach(marker => {
      const cat = marker.title.split(' ')[0].toLowerCase();
      marker.map = (filter === 'all' || filter === cat) ? map : null;
    });
  };
}

initMap();
