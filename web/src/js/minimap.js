// The small map in the preview card (Leaflet, OpenStreetMap tiles). Loaded only when a card is shown.
import L from 'leaflet';

export function miniMap(el, lat, lng) {
  if (!el) return null;
  const map = L.map(el, { center: [lat, lng], zoom: 10, minZoom: 2, scrollWheelZoom: false, worldCopyJump: true, zoomControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>' }).addTo(map);
  L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="mini-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), keyboard: false }).addTo(map);
  return map;
}
