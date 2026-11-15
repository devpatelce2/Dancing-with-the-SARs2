// Single switch-point for surface-change data.
// PRODUCTION (default): synthetic trial values are NOT used for any displayed observation; the UI shows
// "No processed SAR data available" until real processed sites are present (see src/lib/siteData.js).
// DEMO (VITE_DEMO_MODE=true): the synthetic trial provider is kept, and the UI labels it as such.
import { trialProvider } from './trialData.js'
import { DEMO_MODE } from './dataMode.js'

export { DEMO_MODE }
export const provider = trialProvider // only reachable from UI code when DEMO_MODE is true
