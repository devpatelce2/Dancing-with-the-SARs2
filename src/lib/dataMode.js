// Data mode switch. PRODUCTION is the default: no synthetic number is ever shown as an observation.
// Demo mode (synthetic trial provider) must be enabled explicitly: VITE_DEMO_MODE=true
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
export const DEMO_MODE = String(env.VITE_DEMO_MODE ?? '').toLowerCase() === 'true'
export const NO_DATA_MESSAGE = 'No processed SAR data available'
