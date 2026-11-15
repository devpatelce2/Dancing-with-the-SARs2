// Offline fallback for naming open water / remote areas.
// [name, south, north, west, east] — checked in order, most specific first.
const SEAS = [
  ['Gulf of Khambhat', 20.3, 22.5, 71.8, 73.1],
  ['Gulf of Kutch', 22.2, 23.0, 68.5, 70.8],
  ['Persian Gulf', 24, 30.5, 48, 56.5],
  ['Gulf of Oman', 22.5, 26.5, 56.3, 61.8],
  ['Red Sea', 12.5, 28, 32.3, 43.5],
  ['Gulf of Aden', 11, 15, 43, 52],
  ['Arabian Sea', 5, 25, 51, 74],
  ['Bay of Bengal', 5, 22.5, 80, 95],
  ['Andaman Sea', 6, 18, 92, 100],
  ['South China Sea', 0, 23, 99, 121],
  ['East China Sea', 24, 33, 119, 131],
  ['Sea of Japan', 33, 52, 127, 142],
  ['Mediterranean Sea', 30, 46, -6, 36.5],
  ['Black Sea', 41, 47, 27.5, 41.8],
  ['Caspian Sea', 36.5, 47.2, 46.5, 54.8],
  ['North Sea', 51, 61, -4, 9],
  ['Baltic Sea', 53.5, 66, 9.5, 30.5],
  ['Caribbean Sea', 9, 22, -88, -60],
  ['Gulf of Mexico', 18, 30.7, -98, -81],
  ['Hudson Bay', 51, 64, -95, -78],
  ['Tasman Sea', -45, -30, 148, 175],
  ['Coral Sea', -25, -9, 143, 165],
  ['Bering Sea', 52, 66, 162, 180],
  ['Sea of Okhotsk', 45, 63, 135, 164],
]
const OCEANS = [
  ['Arctic Ocean', 66, 90, -180, 180],
  ['Southern Ocean', -90, -58, -180, 180],
  ['Indian Ocean', -58, 25, 20, 120],
  ['Pacific Ocean', -58, 66, 120, 180],
  ['Pacific Ocean', -58, 66, -180, -70],
  ['Atlantic Ocean', -58, 66, -70, 20],
]
const inBox = (b, lat, lon) => lat >= b[1] && lat <= b[2] && lon >= b[3] && lon <= b[4]

export function waterBodyName(lat, lon) {
  const sea = SEAS.find((b) => inBox(b, lat, lon))
  if (sea) return { name: sea[0], kind: 'Sea / Gulf' }
  const ocean = OCEANS.find((b) => inBox(b, lat, lon))
  if (ocean) return { name: ocean[0], kind: 'Ocean' }
  return null
}
