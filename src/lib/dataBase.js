// Where the processed site data (sites.json, <site>/timeseries.json, <site>/ts/*.png) is served from.
// It MUST follow Vite's `base` (BASE_URL). A hard-coded '/data' only works when the app is served from the site root;
// under a sub-path (GitHub Pages: /Dancing-with-the-SARs2/) it returns the wrong page, no site loads and the Story tab
// falls back to "No radar data has been processed for this place yet".
export const DATA_BASE = `${import.meta.env?.BASE_URL ?? '/'}data`
