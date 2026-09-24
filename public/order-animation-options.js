export const ORDER_ANIMATIONS = Object.freeze([
  { id: 'scooter', name: 'Scooter delivery', detail: 'Pack, load, and ride', color: '#087f73' },
  { id: 'van', name: 'Courier van', detail: 'A parcel on its next journey', color: '#367ca5' },
  { id: 'bicycle', name: 'Bicycle courier', detail: 'A lighter little journey', color: '#51835b' },
  { id: 'conveyor', name: 'Packing line', detail: 'From product to parcel', color: '#487c98' },
  { id: 'gift', name: 'Gift wrapped', detail: 'Finished with a ribbon', color: '#c45c73' },
  { id: 'bag', name: 'Shopping bag', detail: 'A boutique-style finish', color: '#9d6750' },
  { id: 'express', name: 'Express parcel', detail: 'A quick, playful send-off', color: '#c66b35' },
  { id: 'doorstep', name: 'Home sweet home', detail: 'A parcel meets a doorstep', color: '#687bab' },
  { id: 'receipt', name: 'Receipt reveal', detail: 'A crisp confirmation', color: '#35776d' },
  { id: 'celebration', name: 'Little celebration', detail: 'A joyful burst of color', color: '#b66363' },
].map(option => Object.freeze(option)));

export function validOrderAnimation(style) {
  return style === 'none' || ORDER_ANIMATIONS.some(option => option.id === style);
}

export function normalizeOrderAnimation(value) {
  return {
    style: validOrderAnimation(value?.style) ? value.style : 'none',
    durationMs: Number.isInteger(value?.durationMs) && value.durationMs >= 2000 && value.durationMs <= 5000 ? value.durationMs : 3500,
  };
}
